/**
 * Data conditions, and the property they were designed around.
 *
 * Stage 3 of `STATE-AND-CONDITIONS.md` claims two things, and both are about
 * output rather than about code:
 *
 * **The state engine is not modified.** A condition on the visit resolves to a
 * value and from there is indistinguishable from a switch — same selector
 * shape, same weight, same expansion into one element per alternative. The
 * static suite proves that against compiled CSS. What is left for a browser is
 * the half a browser owns: that the value is *right*, and that it is right at
 * the first paint.
 *
 * **There is no flash.** Not a short one — none. A classic inline script in
 * `<head>` blocks parsing, so the attribute every data rule keys on is set
 * before a single element of the body exists. The check for that is structural
 * (where the script is in the file) rather than visual, because "did it flash"
 * is not a question a screenshot can answer honestly — a flash is one frame,
 * and not catching one is not the same as there not being one.
 *
 * The third property is the one the whole project keeps: with no scripting at
 * all the page is still coherent. Not blank, not both copies at once — the
 * version the designer chose to ship.
 */

import { APP, launch, openProject, publish, signUp, unbalanced } from './harness.mjs';
import { createReport } from '../report.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const insert = async (name) => {
  const card = page.locator(`button:has(span:text-is("${name}"))`).first();
  if (!(await card.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Insert"]').first().click();
    await card.waitFor({ state: 'visible', timeout: 8000 });
  }
  await card.click();
  await page.waitForTimeout(1100);
};

/** What is actually legible on a rendered page, ignoring the hidden half. */
const VISIBLE_TEXT = () => {
  const out = [];
  for (const el of document.querySelectorAll('[class*="-v"]')) {
    if (!/\bc-[a-z0-9]+-v[0-9]+\b/.test(el.className)) continue;
    if (el.getBoundingClientRect().height > 0) out.push((el.textContent ?? '').trim());
  }
  return out.filter(Boolean).join(' | ');
};

try {
  await signUp(page, 'Dana Lightfoot', 'data');
  const id = await openProject(page, 'Blank');

  // A page with no data conditions first, so "nothing about data reaches a
  // page that has none" is measured against a page that has none rather than
  // asserted about the one that does.
  await insert('Section');
  await publish(page);
  const plain = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'a page with no data conditions carries nothing about data',
    !plain.includes('data-cre8-data') && !/<script/i.test(plain),
    plain.includes('data-cre8-data') ? 'attribute leaked' : 'clean'
  );

  await insert('Opening hours');
  await publish(page);
  const html = await (await fetch(`${APP}/s/${id}/`)).text();

  /* --------------------------------------------- 1. what the file contains */

  report.check('the published markup is balanced', unbalanced(html).length === 0);

  report.check(
    'both versions ship, so a crawler reads them and a printout is right',
    html.includes('Open now') && html.includes('Closed for the night'),
    [html.includes('Open now') && 'open', html.includes('Closed for the night') && 'closed']
      .filter(Boolean)
      .join(' + ') || 'neither'
  );
  report.check(
    'and so do both button labels',
    html.includes('Call the team') && html.includes('Leave a message')
  );

  const rootTag = /<html[^>]*>/.exec(html)?.[0] ?? '';
  report.check(
    'the document element carries a value to start from',
    /data-cre8-data="[^"]*time:[a-z]+/.test(rootTag),
    rootTag.slice(0, 90)
  );
  report.check(
    'and it is the one the site chose to ship, not a value invented at random',
    rootTag.includes('time:afternoon'),
    /data-cre8-data="([^"]*)"/.exec(rootTag)?.[1] ?? 'none'
  );

  /* ------------------------------------------ 2. where the resolver sits */

  const headEnd = html.indexOf('</head>');
  const bodyStart = html.indexOf('<body');
  const scriptAt = html.indexOf('<script>', html.indexOf('<style>'));

  report.check(
    'the resolver runs from the head, before the body is parsed',
    scriptAt > 0 && scriptAt < headEnd && scriptAt < bodyStart,
    scriptAt < 0 ? 'no script in the head' : `at ${scriptAt}, head ends ${headEnd}`
  );
  report.check(
    'and it is a classic inline script, so the browser has to wait for it',
    !/<script[^>]*\s(src|defer|async)[^>]*>/i.test(html.slice(0, headEnd)),
    'blocking'
  );
  // The click runtime and the data resolver are separate scripts for separate
  // jobs, and a page should carry only the ones it needs. This block has no
  // switch on it at all.
  const scripts = html.match(/<script[^>]*>/g) ?? [];
  report.check(
    'a page with no switch carries the resolver and nothing else',
    scripts.length === 1 && !html.includes('data-cre8-switch'),
    `${scripts.length} script(s), ${html.includes('data-cre8-switch') ? 'has' : 'no'} switch`
  );

  /* --------------------------------------------- 3. it resolves correctly */

  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  const resolved = await site.evaluate(() => {
    const hour = new Date().getHours();
    return {
      tokens: document.documentElement.getAttribute('data-cre8-data') ?? '',
      expected:
        'time:' + (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night'),
    };
  });
  report.check(
    'the visitor’s own clock decides, not the server’s',
    resolved.tokens.includes(resolved.expected),
    `${resolved.tokens} — wanted ${resolved.expected}`
  );
  report.check(
    'a direct visit is read as direct rather than guessed at',
    resolved.tokens.includes('referrer:direct'),
    resolved.tokens
  );

  const shown = await site.evaluate(VISIBLE_TEXT);
  const night = resolved.expected === 'time:night';
  report.check(
    'exactly one version is on screen',
    shown.split(' | ').length === 2 && shown.includes(night ? 'Closed' : 'Open now'),
    shown
  );
  await site.close();

  /*
   * And again with the clock held at each end of the condition, because the
   * check above only ever tests whatever hour it happens to run at.
   *
   * That is not a hypothetical gap. The negative half of a data condition
   * compiled to an ancestor prefix that `<body>` satisfied, so it matched
   * always: the night copy was hidden at night as well as by day, and the
   * strip showed *nothing* between nine in the evening and midnight. The suite
   * ran in the afternoon and was green for months.
   */
  for (const [hour, expect, absent] of [
    [22, 'Closed', 'Open now'],
    [14, 'Open now', 'Closed'],
  ]) {
    const pinned = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await pinned.clock.setFixedTime(new Date(2026, 0, 15, hour, 0, 0));
    const at = await pinned.newPage();
    await at.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
    await at.waitForTimeout(400);
    const text = await at.evaluate(VISIBLE_TEXT);
    report.check(
      `at ${hour}:00 the page shows one version and it is the right one`,
      text.includes(expect) && !text.includes(absent),
      text || 'nothing on screen'
    );
    await pinned.close();
  }

  /* ---------------------------------------------- 4. a link that carries one */

  const tagged = await ctx.newPage();
  await tagged.goto(`${APP}/s/${id}/?ref=Acme%20Corp&utm_source=`, {
    waitUntil: 'domcontentloaded',
  });
  const params = await tagged.evaluate(
    () => document.documentElement.getAttribute('data-cre8-data') ?? ''
  );
  report.check(
    'a link parameter becomes a value the page can key on',
    params.includes('query.ref:acme-corp'),
    params
  );
  report.check(
    'slugged to what a selector can hold, so a campaign name cannot break the CSS',
    !/query\.[^ ]*[^a-z0-9.:-]/.test(params),
    params
  );
  report.check(
    'and an empty parameter is dropped rather than written as nothing',
    !params.includes('query.utm-source'),
    params
  );
  await tagged.close();

  /* ------------------------------------------- 5. and with no scripting */

  const quiet = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 1000 },
  });
  const noJs = await quiet.newPage();
  await noJs.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  const withoutJs = await noJs.evaluate(VISIBLE_TEXT);
  report.check(
    'with scripting off the page is still coherent — one version, not both',
    withoutJs.split(' | ').length === 2,
    withoutJs
  );
  report.check(
    'and it is the version the site ships, which is a decision rather than an accident',
    withoutJs.includes('Open now'),
    withoutJs
  );
  await quiet.close();

  /* --------------------------------------------------- 6. and on the canvas */

  await page.bringToFront();
  const canvas = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const out = [];
    for (const el of frame?.querySelectorAll('[class*="-v"]') ?? []) {
      if (!/\bc-[a-z0-9]+-v[0-9]+\b/.test(el.className)) continue;
      if (el.getBoundingClientRect().height > 0) out.push((el.textContent ?? '').trim());
    }
    return { tokens: frame?.getAttribute('data-cre8-data') ?? '', shown: out.filter(Boolean).join(' | ') };
  });
  report.check(
    'the canvas carries the same attribute the published page does',
    canvas.tokens.includes('time:'),
    canvas.tokens || 'none'
  );
  report.check(
    'so the editor shows the version it would ship, by the same rule',
    canvas.shown.includes('Open now') && !canvas.shown.includes('Closed'),
    canvas.shown
  );

  /* ------------------------------------------------------- 7. and in preview */

  // Preview answers "what will a visitor get", so unlike the canvas it does
  // not show the value the designer picked — it ships the fallback and then
  // resolves it, which is what the published page does.
  await page.locator('button:has-text("Preview")').first().click();
  await page.waitForTimeout(900);
  const preview = await page.evaluate(() => {
    const frames = [...document.querySelectorAll('.cre8-frame')];
    const frame = frames.find((f) => !f.classList.contains('cre8-editing'));
    const out = [];
    for (const el of frame?.querySelectorAll('[class*="-v"]') ?? []) {
      if (!/\bc-[a-z0-9]+-v[0-9]+\b/.test(el.className)) continue;
      if (el.getBoundingClientRect().height > 0) out.push((el.textContent ?? '').trim());
    }
    const hour = new Date().getHours();
    return {
      tokens: frame?.getAttribute('data-cre8-data') ?? '',
      shown: out.filter(Boolean).join(' | '),
      expected:
        'time:' + (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night'),
    };
  });
  report.check(
    'preview resolves the value rather than showing the one being designed against',
    preview.tokens.includes(preview.expected),
    `${preview.tokens} — wanted ${preview.expected}`
  );
  report.check(
    'and one version is on screen there too',
    preview.shown.split(' | ').length === 2,
    preview.shown
  );
} finally {
  await browser.close();
}

report.finish();
