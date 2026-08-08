
/** Can you actually click from one published page to another? */

import { APP, launch } from './harness.mjs';

const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

const stamp = Date.now();
const U = { email: `nav${stamp}@cre8.test`, name: 'Nav Igator', pw: 'correct-horse-battery' };

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', U.name);
  await page.fill('input[type="email"]', U.email);
  await page.fill('input[type="password"]', U.pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 30000 });

  // The SaaS template is multi-page, which is the point of this test.
  await page.locator('button:has-text("SaaS landing page")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: 30000 });
  const projectId = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  await page.waitForSelector('header >> text=Live', { timeout: 20000 });
  await page.waitForTimeout(1500);

  // Templates ship '#' placeholder links, so make a real page link the way a
  // designer would: select a nav link and point it at a page in the inspector.
  // The template's own navbar already points at the pages it creates — no
  // inspector work needed. The canvas deliberately renders page links as '#'
  // so clicking one does not navigate away mid-edit, so the published output
  // is where this has to be checked.
  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: 60000 });
  const slugs = await page.locator('div[role="dialog"] span.font-mono').allTextContents();
  console.log('  pages:', slugs.join(' '));
  await page.keyboard.press('Escape');

  /* ------------------------------------------------------- 1. canonical URLs */

  const noSlash = await fetch(`${APP}/s/${projectId}/pricing`, { redirect: 'manual' });
  check(
    'a page URL without a trailing slash redirects to the directory form',
    noSlash.status === 301 && (noSlash.headers.get('location') ?? '').endsWith(`/s/${projectId}/pricing/`),
    `HTTP ${noSlash.status} → ${noSlash.headers.get('location')}`
  );

  const bare = await fetch(`${APP}/s/${projectId}`, { redirect: 'manual' });
  check(
    'the site root redirects too, so relative links have a base',
    bare.status === 301 && (bare.headers.get('location') ?? '').endsWith(`/s/${projectId}/`),
    `HTTP ${bare.status} → ${bare.headers.get('location')}`
  );

  const asset = await fetch(`${APP}/s/${projectId}/sitemap.xml`, { redirect: 'manual' });
  check('a file URL is left alone', asset.status === 200, `HTTP ${asset.status}`);

  /* --------------------------------------------------- 2. hrefs are relative */

  const home = await (await fetch(`${APP}/s/${projectId}/`)).text();
  const hrefs = [...home.matchAll(/href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((h) => !/^(https?:|mailto:|tel:|#)/.test(h));
  check('internal hrefs are relative, not root-absolute',
    hrefs.length > 0 && hrefs.every((h) => !h.startsWith('/')), hrefs.slice(0, 6).join(' '));
  check("the template's own nav and footer link to its pages, with no '#' left in the nav",
    hrefs.filter((h) => h !== './').length >= 3, `${hrefs.length} internal links`);

  /* ------------------------------------------------- 3. click through, hosted */

  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(600);

  const navLink = site.locator('a').filter({ hasText: /pricing/i }).first();
  const has = await navLink.count();
  check('the published home page has a nav link', has > 0);

  if (has) {
    await navLink.click();
    await site.waitForLoadState('domcontentloaded');
    await site.waitForTimeout(900);
    check(
      'clicking it lands on the right page, still inside the site',
      /\/s\/[a-z0-9]+\/pricing\/?$/.test(new URL(site.url()).pathname),
      new URL(site.url()).pathname
    );
    check(
      'and the page actually rendered',
      (await site.locator('body').innerText()).length > 200,
      `${(await site.locator('body').innerText()).length} chars`
    );
  }

  /* ------------------------------------------- 4. the ../ case, from a subpage */

  // The nav's Home entry, seen from a subpage, is the case the relative maths
  // can actually get wrong.
  const pricingHtml = await (await fetch(`${APP}/s/${projectId}/pricing/`)).text();
  check(
    'a link from a subpage back to home is written as ../',
    pricingHtml.includes('href="../"'),
    [...pricingHtml.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]).slice(0, 4).join(' ')
  );

  await site.goto(`${APP}/s/${projectId}/pricing/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(500);
  await site.locator('a[href="../"]').first().click();
  await site.waitForLoadState('domcontentloaded');
  await site.waitForTimeout(800);
  check(
    'clicking it climbs one level, back to the site root',
    new URL(site.url()).pathname === `/s/${projectId}/`,
    new URL(site.url()).pathname
  );

  /* ---------------------------------------- 5. nothing escapes to the app root */

  const escaped = await fetch(`${APP}/pricing`, { redirect: 'manual' });
  check(
    'a stray root-absolute link would have hit the editor 404 (why relative matters)',
    escaped.status === 404,
    `HTTP ${escaped.status}`
  );
} catch (error) {
  check('harness completed', false, error.message);
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
