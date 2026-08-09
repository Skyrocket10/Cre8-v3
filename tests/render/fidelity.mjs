
/**
 * Editor ≈ published.
 *
 * The architecture's central claim is that one renderer drives the canvas and
 * the published file. These are the checks that claim needs: the published
 * markup has to be well-formed, and the same nodes have to compute to the same
 * styles on both surfaces.
 *
 * Both bugs this was written for hid from a screenshot of the editor: a
 * divider emitted as an unclosed `<div>` nested half the page inside itself,
 * and a reset rule at higher specificity than the node's own class repainted
 * every primary button.
 */

import { APP, launch, PUBLISH_TIMEOUT, READY_TIMEOUT, toCanvasKeys, unbalanced } from './harness.mjs';

const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

/** Computed styles keyed by the generated class, which both surfaces share. */
const styleMap = (target) =>
  target.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root) return {};
    const out = {};
    for (const el of root.querySelectorAll('[class^="c-"], [class*=" c-"]')) {
      const cls = [...el.classList].find((c) => c.startsWith('c-'));
      if (!cls || out[cls]) continue;
      const cs = getComputedStyle(el);
      out[cls] = [cs.display, cs.gridTemplateColumns, cs.color, cs.backgroundColor,
        cs.flexDirection, cs.justifyContent, cs.fontSize, cs.fontWeight].join('|');
    }
    return out;
  }, rootSel => rootSel);

const stamp = Date.now();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', 'Fi Delity');
  await page.fill('input[type="email"]', `fid${stamp}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: READY_TIMEOUT });

  await page.locator('button:has-text("SaaS landing page")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(2000);

  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: PUBLISH_TIMEOUT });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  /* ------------------------------------------------- 1. the markup is closed */

  for (const path of ['', 'pricing/', 'about/', 'contact/']) {
    const html = await (await fetch(`${APP}/s/${id}/${path}`)).text();
    const bad = unbalanced(html);
    check(`/${path || ''} has balanced markup`, bad.length === 0,
      bad.map(([t, n]) => `${t}:${n > 0 ? '+' : ''}${n}`).join(' ') || 'all closed');
  }

  /* ------------------------------------------ 1b. and it is not wasteful */

  /*
   * A budget rather than a snapshot. Snapshotting the exact byte count would
   * fail on every copy edit, which trains people to update the number without
   * reading it; a ceiling only moves when something structural regresses.
   *
   * The numbers below are roughly a third above what the SaaS template
   * currently produces, and the template is the largest thing the library can
   * build — four pages, every block type, the whole theme. If a page of it
   * ever needs 60 KB of stylesheet again, something stopped being shared.
   */
  const home = await (await fetch(`${APP}/s/${id}/`)).text();
  const stylesheet = /<style>([\s\S]*?)<\/style>/.exec(home)?.[1] ?? '';
  const bytes = (s) => new TextEncoder().encode(s).length;

  check('the stylesheet stays under its budget', bytes(stylesheet) < 34000,
    `${bytes(stylesheet)} bytes of css`);
  check('and the whole page does', bytes(home) < 60000, `${bytes(home)} bytes`);

  // The shortening is what most of that budget rests on, so it is asserted
  // directly: a published class is the `c-` prefix and four characters, not
  // the ten-character id the editor uses.
  const classes = [...new Set(
    [...home.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
  )].filter(Boolean);
  const long = classes.filter((c) => /^c-[a-z0-9]{5,}$/.test(c));
  // Ids are random, so on a page of two hundred nodes a few will share their
  // first four characters — and those keep their full length by design. So the
  // check is not "none are long" but "every long one had to be": each must
  // share a prefix with something else here. That fails if the shortening
  // silently stops working, and passes however the dice land.
  const heads = classes.map((c) => c.slice(0, 6));
  const justified = long.every((c) => heads.filter((h) => h === c.slice(0, 6)).length > 1);
  check('published class names are cut down from the editor’s ids',
    classes.length > 50 && long.length < classes.length / 10 && justified,
    `${classes.length} classes, ${long.length} kept full length` +
      (long.length ? ` — ${justified ? 'all collide on a prefix' : `unexplained: ${long[0]}`}` : ''));

  /* ------------------------------ 2. the same nodes compute the same styles */

  // Canvas frame is 1440 wide; match the viewport so media and container
  // queries resolve at the same width on both sides.
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.cre8-frame{transform:none!important}';
    document.head.appendChild(s);
  });
  const canvas = await page.evaluate(() => {
    const root = document.querySelector('.cre8-frame.cre8-editing');
    if (!root) return {};
    const out = {};
    for (const el of root.querySelectorAll('[class]')) {
      const cls = [...el.classList].find((c) => c.startsWith('c-'));
      if (!cls || out[cls]) continue;
      const cs = getComputedStyle(el);
      out[cls] = [cs.display, cs.gridTemplateColumns, cs.color, cs.backgroundColor,
        cs.flexDirection, cs.justifyContent, cs.fontWeight, cs.fontSize,
        cs.lineHeight].join('|');
    }
    return out;
  });

  const site = await ctx.newPage();
  await site.setViewportSize({ width: 1440, height: 1000 });
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(1000);
  const published = await site.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('[class]')) {
      const cls = [...el.classList].find((c) => c.startsWith('c-'));
      if (!cls || out[cls]) continue;
      const cs = getComputedStyle(el);
      out[cls] = [cs.display, cs.gridTemplateColumns, cs.color, cs.backgroundColor,
        cs.flexDirection, cs.justifyContent, cs.fontWeight, cs.fontSize,
        cs.lineHeight].join('|');
    }
    return out;
  });

  const matched = toCanvasKeys(published, canvas);
  const shared = Object.keys(matched);
  // gridTemplateColumns resolves to used pixel values, which legitimately
  // differ with width; compare everything else exactly.
  const drop = (v) => v.split('|').filter((_, i) => i !== 1).join('|');
  const diffs = shared.filter((c) => drop(canvas[c]) !== drop(matched[c]));
  check('canvas and published agree on computed styles', diffs.length === 0,
    `${shared.length} shared nodes, ${diffs.length} differ` +
      (diffs.length ? ` — e.g. ${diffs[0]}: ${drop(canvas[diffs[0]])} vs ${drop(matched[diffs[0]])}` : ''));
  check('the comparison actually covered the page', shared.length > 40, `${shared.length} nodes`);

  /* ----------------------------------------- 3. the two bugs, named directly */

  const pricing = await ctx.newPage();
  await pricing.setViewportSize({ width: 1440, height: 1000 });
  await pricing.goto(`${APP}/s/${id}/pricing/`, { waitUntil: 'domcontentloaded' });
  await pricing.waitForTimeout(800);
  const grid = await pricing.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(
      (e) => getComputedStyle(e).display === 'grid' && e.textContent?.includes('Hobby')
    );
    return el ? { cols: getComputedStyle(el).gridTemplateColumns, kids: el.children.length } : null;
  });
  check('the pricing cards lay out as three columns', grid?.kids === 3 && grid.cols.split(' ').length === 3,
    JSON.stringify(grid));

  const cta = await site.evaluate(() => {
    const el = [...document.querySelectorAll('a')].find((e) => e.textContent?.trim() === 'Start building free');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor };
  });
  check('a primary button keeps its own text colour, not the page default',
    cta?.color === 'rgb(255, 255, 255)', JSON.stringify(cta));

  /* ---------------------------------- 4. the minifier keeps selectors intact */

  const html = await (await fetch(`${APP}/s/${id}/`)).text();
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  check('descendant combinators survive minification',
    css.includes('] :focus-visible') || css.includes(') :focus-visible'),
    (css.match(/[^{]{0,24}:focus-visible/) ?? ['not found'])[0]);
} catch (error) {
  check('harness completed', false, error.message);
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
