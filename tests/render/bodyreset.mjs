
/**
 * Does the published page start where the canvas says it does?
 *
 * The editor's page root sits inside a frame element with no UA margin; a
 * published root sits in <body>, which has 8px. Measure both.
 */

import { APP, launch } from './harness.mjs';

const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

const stamp = Date.now();
const U = { email: `body${stamp}@cre8.test`, name: 'Bo Dee', pw: 'correct-horse-battery' };

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', U.name);
  await page.fill('input[type="email"]', U.email);
  await page.fill('input[type="password"]', U.pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 30000 });

  await page.locator('button:has-text("SaaS landing page")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: 30000 });
  const projectId = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  await page.waitForSelector('header >> text=Live', { timeout: 20000 });
  await page.waitForTimeout(1500);

  // Where does the page root sit inside the canvas frame?
  const inCanvas = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const root = frame?.querySelector('[data-cre8-root]');
    if (!frame || !root) return null;
    const f = frame.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    return { left: Math.round((r.left - f.left) * 100) / 100, width: Math.round(r.width) };
  });
  check('the canvas root is flush with its frame', inCanvas?.left === 0, JSON.stringify(inCanvas));

  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: 60000 });
  await page.waitForTimeout(1000);

  /* ------------------------------------------------------ the published page */

  const site = await ctx.newPage();
  await site.setViewportSize({ width: 1200, height: 800 });
  await site.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(1200);

  const measured = await site.evaluate(() => {
    const body = getComputedStyle(document.body);
    const root = document.querySelector('[data-cre8-root]');
    const r = root?.getBoundingClientRect();
    return {
      bodyMargin: body.margin,
      bodyPadding: body.padding,
      rootLeft: r ? Math.round(r.left) : null,
      rootWidth: r ? Math.round(r.width) : null,
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  console.log('  measured:', JSON.stringify(measured));

  check('body has no margin', measured.bodyMargin === '0px', measured.bodyMargin);
  check('body has no padding', measured.bodyPadding === '0px', measured.bodyPadding);
  check('the published root starts at x=0', measured.rootLeft === 0, `x=${measured.rootLeft}`);
  check(
    'the root fills the viewport width',
    measured.rootWidth === measured.viewport,
    `${measured.rootWidth} vs ${measured.viewport}`
  );
  check(
    'the page does not scroll horizontally',
    measured.scrollWidth <= measured.viewport,
    `scrollWidth ${measured.scrollWidth} vs ${measured.viewport}`
  );

  // A full-bleed section should touch both edges.
  const bleed = await site.evaluate(() => {
    const section = document.querySelector('[data-cre8-root] > *');
    if (!section) return null;
    const r = section.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), vw: document.documentElement.clientWidth };
  });
  check(
    'a full-bleed section touches both edges',
    bleed !== null && bleed.left === 0 && bleed.right === bleed.vw,
    JSON.stringify(bleed)
  );
} catch (error) {
  check('harness completed', false, error.message);
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
