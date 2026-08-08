
/** Per-side border widths: set in the inspector, honoured on canvas and in the published file. */

import { APP, ARTIFACTS, launch } from './harness.mjs';

const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

const stamp = Date.now();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const sides = (target, sel) =>
  target.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      t: cs.borderTopWidth, r: cs.borderRightWidth,
      b: cs.borderBottomWidth, l: cs.borderLeftWidth,
      style: cs.borderTopStyle,
    };
  }, sel);

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', 'Bo Rder');
  await page.fill('input[type="email"]', `bord${stamp}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 30000 });

  await page.locator('button:has-text("Blank")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: 30000 });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  await page.waitForSelector('header >> text=Live', { timeout: 20000 });
  await page.waitForTimeout(1500);

  // Insert a section to style.
  await page.locator('button[aria-label="Insert"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Section")').first().click();
  await page.waitForTimeout(1200);

  /* ------------------------------------------------- open Border, unlink sides */

  const borderHeader = page.locator('button:has(.panel-title:text-is("Border"))').first();
  await borderHeader.click();
  await page.waitForTimeout(500);

  check('the Border section has its own Style row', (await page.locator('label:text-is("Style")').count()) > 0);

  const linkToggle = page.locator('button[aria-label="Set border sides individually"]');
  await linkToggle.click();
  await page.waitForTimeout(600);

  const fieldCount = await page
    .locator('input[aria-label="Top"], input[aria-label="Right"], input[aria-label="Bottom"], input[aria-label="Left"]')
    .count();
  check('unlinking reveals four per-side fields', fieldCount === 4, `${fieldCount} fields`);

  /* --------------------------------------------------- set only top and left */

  for (const [title, value] of [['Top', '6'], ['Left', '3']]) {
    const f = page.locator(`input[aria-label="${title}"]`).first();
    await f.fill(value);
    await f.press('Enter');
    await page.waitForTimeout(700);
  }

  const onCanvas = await sides(page, '.cre8-frame.cre8-editing section');
  check('the canvas shows only the sides that were set',
    onCanvas?.t === '6px' && onCanvas?.l === '3px' && onCanvas?.r === '0px' && onCanvas?.b === '0px',
    JSON.stringify(onCanvas));
  check('a width implies a style, so it is actually visible',
    onCanvas?.style === 'solid', onCanvas?.style ?? 'none');

  /* --------------------------------------------------------------- published */

  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: 60000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(800);
  const onSite = await sides(site, 'section');
  check('the published page matches the canvas exactly',
    JSON.stringify(onSite) === JSON.stringify(onCanvas),
    `${JSON.stringify(onSite)} vs ${JSON.stringify(onCanvas)}`);

  /* ------------------------------------------- relinking writes all four again */

  await page.bringToFront();
  await page.locator('button[aria-label="Link border sides"]').click();
  await page.waitForTimeout(400);
  const linked = page.locator('input[aria-label="Border width"]').first();
  await linked.fill('2');
  await linked.press('Enter');
  await page.waitForTimeout(800);

  const relinked = await sides(page, '.cre8-frame.cre8-editing section');
  check('relinking sets every side together',
    relinked && ['t', 'r', 'b', 'l'].every((k) => relinked[k] === '2px'), JSON.stringify(relinked));
} catch (error) {
  check('harness completed', false, error.message);
  await page.screenshot({ path: `${ARTIFACTS}/fail-borders.png` }).catch(() => {});
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
