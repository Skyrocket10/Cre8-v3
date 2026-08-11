/**
 * Form submissions from a published site.
 *
 * This is the only write endpoint with no account behind it, so most of what
 * follows is about what it refuses. A published page runs no script — the
 * browser posts the form natively and follows the redirect — so the checks
 * drive a real form rather than calling fetch, because a native POST is the
 * thing that actually has to work.
 */

import { APP, launch, openProject, publish, READY_TIMEOUT } from './harness.mjs';
import { createReport } from '../report.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** Post like a browser would: urlencoded body, no custom headers. */
const post = (id, fields, headers = {}) =>
  fetch(`${APP}/api/f/${id}/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', 'Formy Tester');
  await page.fill('input[type="email"]', `form${Date.now()}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: READY_TIMEOUT });

  const id = await openProject(page, 'Blank');

  /* ------------------------------------------------- 1. the form gets a target */

  const card = page.locator('button:has(span:text-is("Form"))').first();
  if (!(await card.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Insert"]').first().click();
    await card.waitFor({ state: 'visible', timeout: 8000 });
  }
  await card.click();
  await page.waitForTimeout(1200);
  await publish(page);

  const html = await (await fetch(`${APP}/s/${id}/`)).text();
  const action = /<form[^>]*\saction="([^"]+)"/.exec(html)?.[1] ?? '';
  report.check(
    'a published form posts to this project’s endpoint',
    action.includes(`/api/f/${id}/`),
    action || 'no action attribute'
  );
  report.check(
    'the action is absolute, so it works from a site on its own domain',
    /^https?:\/\//.test(action),
    action
  );
  report.check('the published page still ships no script', !/<script/i.test(html));

  /* ------------------------------------------- 2. a real browser submission */

  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  await site.locator('form input').first().fill('Real Visitor');

  /*
   * Pressed, not submitted.
   *
   * This used to call `form.submit()`, which posts the form whatever the
   * button does — so it proved the endpoint worked and never proved a visitor
   * could reach it. They could not: every button the app rendered carried
   * `type="button"`, including the Send on every contact form it shipped, and
   * this check stayed green throughout. The button is the feature.
   */
  const send = site.locator('form button[type="submit"]').first();
  report.check(
    'the published form has a button that submits it',
    await send.isVisible().catch(() => false),
    (await site.locator('form button').first().getAttribute('type')) ?? 'no button'
  );
  // Wait on the navigation the submit causes. `waitForLoadState` resolves
  // against the document already loaded, so it returns before the POST has
  // even left and the URL read afterwards is the old one.
  await Promise.all([
    site.waitForURL(/sent=1|\/api\/f\//, { timeout: 15000 }).catch(() => {}),
    send.click(),
  ]);
  await site.waitForTimeout(500);
  report.check(
    'and pressing it sends the visitor back to the page they were on',
    site.url().startsWith(`${APP}/s/${id}/`) && site.url().includes('sent=1'),
    site.url()
  );
  await site.close();

  /* --------------------------------------------------- 3. what it refuses */

  const noCsrf = await post(id, { email: 'a@b.test' });
  report.check(
    'a plain form post is accepted without a CSRF header',
    noCsrf.ok || noCsrf.status === 303,
    `HTTP ${noCsrf.status}`
  );
  report.check(
    'with no referer it answers with its own page rather than redirecting blind',
    noCsrf.status === 200 && (await noCsrf.clone().text()).includes('Thanks'),
    `HTTP ${noCsrf.status}`
  );

  const unknown = await post('does-not-exist', { email: 'a@b.test' });
  report.check(
    'a submission to a project that does not exist is a 404',
    unknown.status === 404,
    `HTTP ${unknown.status}`
  );

  const empty = await post(id, {});
  report.check('an empty submission is refused', empty.status === 400, `HTTP ${empty.status}`);

  // Byte-identical to a success, so a bot learns nothing from the difference.
  const real = await post(id, { email: 'ok@real.test' }, { referer: `${APP}/s/${id}/` });
  const trapped = await post(
    id,
    { email: 'bot@spam.test', _trap: 'I am a robot' },
    { referer: `${APP}/s/${id}/` }
  );
  report.check(
    'the honeypot answers exactly like a success',
    trapped.status === real.status &&
      trapped.headers.get('location') === real.headers.get('location'),
    `HTTP ${trapped.status} → ${trapped.headers.get('location')}`
  );

  const offsite = await post(
    id,
    { email: 'a@b.test', _redirect: 'https://evil.test/collect' },
    { referer: `${APP}/s/${id}/` }
  );
  const target = offsite.headers.get('location') ?? '';
  report.check(
    'it will not redirect off the site that posted to it',
    !target.includes('evil.test'),
    target
  );

  const big = await post(id, { note: 'x'.repeat(200_000) });
  report.check('an oversized field does not error', big.ok || big.status === 303, `HTTP ${big.status}`);

  /* ------------------------------------------------------- 4. reading back */

  const listed = await page.evaluate(async (projectId) => {
    const res = await fetch(`/api/projects/${projectId}/submissions`, {
      headers: { 'x-cre8-csrf': '1' },
      credentials: 'include',
    });
    return { status: res.status, body: await res.json() };
  }, id);

  report.check('the owner can read the submissions', listed.status === 200, `HTTP ${listed.status}`);
  const rows = listed.body?.submissions ?? [];
  report.check(
    'the honeypot submission was never stored',
    rows.every((row) => row.payload?.email !== 'bot@spam.test'),
    `${rows.length} stored`
  );
  report.check(
    'the real submission is there, with its field',
    rows.some((row) => Object.values(row.payload ?? {}).includes('Real Visitor')),
    JSON.stringify(rows[rows.length - 1]?.payload ?? {}).slice(0, 80)
  );
  report.check(
    'an oversized field was clipped rather than stored whole',
    rows.every((row) => Object.values(row.payload ?? {}).every((v) => String(v).length <= 8000)),
    `longest ${Math.max(0, ...rows.flatMap((r) => Object.values(r.payload ?? {}).map((v) => String(v).length)))}`
  );
  report.check(
    'no visitor IP address is handed to the site owner',
    !JSON.stringify(rows).includes('ip') || rows.every((row) => !('ipHash' in row) && !('ip' in row)),
    Object.keys(rows[0] ?? {}).join(' ')
  );

  /* ------------------------------------------------ 5. the Submissions panel */

  // A payload that would be a formula if a spreadsheet took it literally, and
  // markup if anything built HTML from it.
  await post(
    id,
    { name: '=cmd|calc!A1', message: '<img src=x onerror=alert(1)>' },
    { referer: `${APP}/s/${id}/` }
  );

  await page.bringToFront();
  await page.locator('button[aria-label="Submissions"]').first().click();
  await page.waitForTimeout(1200);

  const panel = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('article')];
    return {
      count: cards.length,
      // textContent, so an injected tag would show as text if it were escaped
      // and be missing if it had been parsed as markup.
      text: cards.map((c) => c.textContent ?? '').join(' | '),
      injected: document.querySelectorAll('img[src="x"]').length,
    };
  });

  report.check('the panel lists the submissions', panel.count > 0, `${panel.count} cards`);
  report.check(
    'a visitor’s field value is shown',
    panel.text.includes('Real Visitor'),
    panel.text.slice(0, 70)
  );
  report.check(
    'markup in a payload is rendered as text, not as markup',
    panel.injected === 0 && panel.text.includes('<img src=x'),
    `${panel.injected} injected elements`
  );

  const csv = await page.evaluate(async (projectId) => {
    const res = await fetch(`/api/projects/${projectId}/submissions`, {
      headers: { 'x-cre8-csrf': '1' },
      credentials: 'include',
    });
    const { submissions } = await res.json();
    // Same shaping the panel's download does, asserted on the value that
    // matters: a cell starting with `=` is a formula to a spreadsheet.
    const risky = submissions.flatMap((row) =>
      Object.values(row.payload ?? {}).filter((v) => /^[=+\-@]/.test(String(v)))
    );
    return risky;
  }, id);
  report.check(
    'a formula-shaped value is present to be defended against',
    csv.length > 0,
    csv.join(' ')
  );

  /* ------------------------------------- 6. someone else's project is closed */

  const stranger = await ctx.newPage();
  await stranger.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await stranger.fill('input[autocomplete="name"]', 'Nosy Parker');
  await stranger.fill('input[type="email"]', `nosy${Date.now()}@cre8.test`);
  await stranger.fill('input[type="password"]', 'correct-horse-battery');
  await stranger.click('button[type="submit"]');
  await stranger.waitForURL(`${APP}/`, { timeout: READY_TIMEOUT });

  const denied = await stranger.evaluate(async (projectId) => {
    const res = await fetch(`/api/projects/${projectId}/submissions`, {
      headers: { 'x-cre8-csrf': '1' },
      credentials: 'include',
    });
    return res.status;
  }, id);
  report.check(
    'someone outside the project cannot read its submissions',
    denied === 403 || denied === 404,
    `HTTP ${denied}`
  );
} catch (error) {
  report.check('forms suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
