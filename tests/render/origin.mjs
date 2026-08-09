
/**
 * Does a published site, served from the editor's own origin, leak the
 * viewer's session?
 *
 * Attacker publishes a page containing a script. Victim — a different, signed-in
 * Cre8 account — visits it. The script tries to read the session three ways.
 */

import { APP, ARTIFACTS, launch, READY_TIMEOUT } from './harness.mjs';

const SITE = APP;
const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

const stamp = Date.now();
const ATTACKER = { email: `atk${stamp}@cre8.test`, name: 'Mallory Evil', pw: 'correct-horse-battery' };
const VICTIM = { email: `vic${stamp}@cre8.test`, name: 'Vera Victim', pw: 'correct-horse-battery' };

const PAYLOAD = `<!doctype html><html><head><title>Totally normal site</title></head><body>
<h1>Our lovely product</h1><pre id="out">running</pre>
<script>
(async () => {
  const r = [];
  try { r.push('cookie=' + JSON.stringify(document.cookie)); } catch (e) { r.push('cookie=THREW'); }
  try { localStorage.setItem('x','1'); r.push('storage=READWRITE'); } catch (e) { r.push('storage=THREW'); }
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include', headers: { 'x-cre8-csrf': '1' } });
    r.push('api=' + res.status + ':' + (await res.text()).slice(0, 160));
  } catch (e) { r.push('api=THREW'); }
  document.getElementById('out').textContent = r.join(' | ');
})();
</script></body></html>`;

async function signUp(page, who) {
  await page.goto(`${SITE}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="name"]', who.name);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${SITE}/`, { timeout: READY_TIMEOUT });
}

const browser = await launch();
const atkCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const vicCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const atk = await atkCtx.newPage();
const vic = await vicCtx.newPage();

try {
  /* ------------------------------------------------- 1. one origin, no config */

  check('editor and API share an origin', true, SITE);

  await signUp(atk, ATTACKER);
  await signUp(vic, VICTIM);
  check('sign-up works with no API URL configured anywhere', true);

  const cookie = (await vicCtx.cookies()).find((c) => c.name === 'cre8_session');
  check(
    'session cookie is SameSite=Lax now that it is same-origin',
    cookie?.sameSite === 'Lax' && cookie?.httpOnly === true,
    `sameSite=${cookie?.sameSite} httpOnly=${cookie?.httpOnly}`
  );

  /* ------------------------------------- 2. positive control: the cookie works */

  const legit = await vic.evaluate(async () => {
    const r = await fetch('/api/auth/me', { credentials: 'include', headers: { 'x-cre8-csrf': '1' } });
    return r.text();
  });
  check(
    'the editor page itself can read the session (control)',
    legit.includes(VICTIM.email),
    legit.slice(0, 80)
  );

  /* ---------------------------------------------- 3. attacker publishes a page */

  await atk.locator('button:has-text("Blank")').first().click();
  await atk.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const projectId = new URL(atk.url()).searchParams.get('p');
  await atk.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await atk.waitForTimeout(2000);

  const publish = await atk.evaluate(
    async ({ id, html }) => {
      const r = await fetch(`/api/projects/${id}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ files: [{ path: 'index.html', contents: html }] }),
      });
      return r.status;
    },
    { id: projectId, html: PAYLOAD }
  );
  check('attacker can publish arbitrary HTML (the threat is real)', publish === 200, `HTTP ${publish}`);

  /* ------------------------------------------- 4. victim visits the published page */

  const siteUrl = `${SITE}/s/${projectId}/`;
  const headers = (await fetch(siteUrl)).headers;
  check(
    'published pages carry a sandbox CSP',
    (headers.get('content-security-policy') ?? '').startsWith('sandbox'),
    headers.get('content-security-policy') ?? 'none'
  );

  await vic.goto(siteUrl, { waitUntil: 'networkidle' });
  await vic.waitForTimeout(2500);
  const loot = (await vic.locator('#out').textContent()) ?? '';
  console.log(`  attacker script saw: ${loot}`);

  check('the page rendered (a sandbox that just breaks sites is no good)',
    (await vic.locator('h1').textContent()) === 'Our lovely product');
  check('its script ran, so the sandbox is not simply blocking JS', loot !== 'running');
  check('it could not read the session cookie', /cookie=""|cookie=THREW/.test(loot), loot.slice(0, 60));
  check('it could not touch the editor origin storage', /storage=THREW/.test(loot));
  check(
    'it could not identify the victim through the API',
    !loot.includes(VICTIM.email) && !loot.includes(VICTIM.name),
    loot.includes('api=') ? loot.slice(loot.indexOf('api=')).slice(0, 90) : 'no api result'
  );

  /* --------------------------------------------------- 5. published output is fine */

  await atk.evaluate(
    async ({ id }) => {
      await fetch(`/api/projects/${id}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: 'index.html', contents: '<!doctype html><html><body><h1>Real page</h1><a href="/s/x/about">About</a></body></html>' }],
        }),
      });
    },
    { id: projectId }
  );
  const plain = await browser.newContext();
  const anon = await plain.newPage();
  await anon.goto(`${SITE}/s/${projectId}/`, { waitUntil: 'networkidle' });
  check('a published site is readable by a signed-out visitor',
    (await anon.locator('h1').textContent()) === 'Real page');
  // The page above was already cached from the victim's visit, so seeing the
  // new copy means republishing actually invalidates it.
  check('republishing replaces the cached page rather than serving the old one',
    (await anon.locator('h1').textContent()) !== 'Our lovely product');
} catch (error) {
  check('harness completed', false, error.message);
  await vic.screenshot({ path: `${ARTIFACTS}/fail-origin.png` }).catch(() => {});
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
