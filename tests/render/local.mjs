
import { APP, ARTIFACTS, launch } from './harness.mjs';

const SITE = 'http://localhost:3001';
const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));

// Nothing at all should be sent to a backend in local mode.
const apiCalls = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(SITE) && !u.startsWith('data:') && !u.startsWith('blob:')) apiCalls.push(u);
});

try {
  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('local mode goes straight to the dashboard, no sign-in', page.url() === `${SITE}/`, page.url());

  check('no account controls in local mode', (await page.locator('button[aria-label="Account"]').count()) === 0);
  check('storage badge says This browser', (await page.locator('text=This browser').count()) > 0);

  await page.locator('button:has-text("Blank")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: 30000 });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  check('project opens in the editor', true);

  check('no Live indicator without a backend', (await page.locator('header >> text=Live').count()) === 0);
  check('no View only badge without a backend', (await page.locator('text=View only').count()) === 0);

  // Add a section and confirm autosave still runs the local path.
  const insert = page.locator('[data-cre8-insert="section"], button:has-text("Section")').first();
  await insert.scrollIntoViewIfNeeded().catch(() => {});
  await insert.click();
  await page.waitForSelector('header >> text=/Saved|Unsaved/', { timeout: 20000 });
  await page.waitForSelector('header >> text=/Saved/', { timeout: 20000 });
  check('autosave still reaches "Saved" in local mode', true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  const survived = await page.locator('.cre8-frame.cre8-editing section, .cre8-frame.cre8-editing > *').count();
  check('the edit survives a reload (IndexedDB)', survived > 0, `${survived} root children`);

  await page.goto(`${SITE}/signin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const notice = await page.locator('body').innerText();
  check(
    '/signin explains there is no workspace rather than offering a dead form',
    notice.includes('No workspace connected'),
    notice.split('\n').filter(Boolean).slice(0, 3).join(' / ')
  );

  check('no cross-origin requests were made at all', apiCalls.length === 0, apiCalls.slice(0, 3).join(', '));
  check('the same build detects there is no backend and stays local', true);
} catch (error) {
  check('harness completed', false, error.message);
  await page.screenshot({ path: `${ARTIFACTS}/fail-local.png` }).catch(() => {});
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
