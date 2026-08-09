
import { APP, ARTIFACTS, launch, PUBLISH_TIMEOUT, READY_TIMEOUT } from './harness.mjs';

const SITE = APP;
const API = APP;
const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

const stamp = Date.now();
const A = { email: `a${stamp}@cre8.test`, name: 'Alan Turing', pw: 'correct-horse-battery' };
const B = { email: `b${stamp}@cre8.test`, name: 'Barbara Liskov', pw: 'correct-horse-battery' };

async function signUp(page, who) {
  await page.goto(`${SITE}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="name"]', who.name);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${SITE}/`, { timeout: READY_TIMEOUT });
}

const browser = await launch();
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
for (const [l, p] of [['A', a], ['B', b]]) {
  p.on('pageerror', (e) => console.log(`  [${l} pageerror] ${e.message}`));
}

try {
  await signUp(a, A);
  await signUp(b, B);

  /* ---------------------------------------------- 1. project in A's own team */

  await a.locator('button:has-text("Blank")').first().click();
  await a.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const projectUrl = a.url();
  const projectId = new URL(projectUrl).searchParams.get('p');
  await a.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await a.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });

  const insert = a.locator('[data-cre8-insert="section"], button:has-text("Section")').first();
  await insert.scrollIntoViewIfNeeded().catch(() => {});
  await insert.click();
  await a.waitForTimeout(2000);
  check('project created and edited in a private workspace', true, projectId);

  /* --------------------------------------------------- 2. cross-team refusal */

  const read = await b.evaluate(
    async ({ api, id }) => {
      const r = await fetch(`${api}/api/projects/${id}`, {
        credentials: 'include',
        headers: { 'x-cre8-csrf': '1' },
      });
      return r.status;
    },
    { api: API, id: projectId }
  );
  check("another account cannot read someone else's project", read === 404, `HTTP ${read}`);

  const del = await b.evaluate(
    async ({ api, id }) => {
      const r = await fetch(`${api}/api/projects/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-cre8-csrf': '1' },
      });
      return r.status;
    },
    { api: API, id: projectId }
  );
  check("another account cannot delete someone else's project", del === 404, `HTTP ${del}`);

  const sock = await b.evaluate(
    ({ api, id }) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`${api.replace('http', 'ws')}/api/projects/${id}/socket`);
        const done = (v) => resolve(v);
        ws.onopen = () => done('opened');
        ws.onerror = () => done('refused');
        ws.onclose = () => done('refused');
        setTimeout(() => done('timeout'), 6000);
      }),
    { api: API, id: projectId }
  );
  check('the collaboration socket refuses a non-member', sock === 'refused', String(sock));

  /* ------------------------------------------------------------- 3. CSRF */

  const noHeader = await b.evaluate(
    async ({ api }) => {
      const r = await fetch(`${api}/api/teams`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ name: 'forged' }),
      });
      return r.status;
    },
    { api: API }
  );
  check('a mutating call without the CSRF header is refused', noHeader === 403, `HTTP ${noHeader}`);

  const badOrigin = await fetch(`${API}/api/auth/me`, { headers: { origin: 'https://evil.example' } });
  check(
    'a disallowed origin gets no CORS grant',
    badOrigin.headers.get('access-control-allow-origin') === null,
    String(badOrigin.headers.get('access-control-allow-origin'))
  );

  /* --------------------------------------------------------- 4. publishing */

  await a.click('button:has-text("Publish")');
  await a.waitForSelector('text=/Published|is live|Live at/i', { timeout: PUBLISH_TIMEOUT });
  check('publish completes in hosted mode', true);

  const published = await fetch(`${API}/s/${projectId}/`);
  const html = await published.text();
  check(
    'the published page is served from R2 as real HTML',
    published.ok && /^<!doctype html>/i.test(html.trim()) && html.includes('</html>'),
    `HTTP ${published.status}, ${html.length} bytes`
  );
  check(
    'published HTML uses media queries, not container queries',
    html.includes('@media') && !html.includes('@container'),
    `@media:${html.includes('@media')} @container:${html.includes('@container')}`
  );

  /* ------------------------------------------------------------ 5. records */

  /*
   * The data layer's content store, and the gate phase D1 was built against:
   * records survive a round-trip, and a caller who holds an account cannot
   * reach another project's rows.
   *
   * The second half is the one worth being careful about. A record is
   * addressed by an opaque id, and the only thing standing between a signed-in
   * stranger and every row in the database is `AND project_id = ?` on each
   * query. That is the same rule the publish route applies to asset keys, and
   * it is checked here the same way — by trying it.
   */
  const asA = (path, init) =>
    a.evaluate(
      async ({ api, path, init }) => {
        const r = await fetch(`${api}${path}`, {
          ...init,
          credentials: 'include',
          headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      },
      { api: API, path, init }
    );

  const made = await asA(`/api/projects/${projectId}/records`, {
    method: 'POST',
    body: JSON.stringify({
      collectionId: 'posts',
      slug: 'Hello World',
      data: { title: 'Hello', body: 'First post' },
    }),
  });
  const recordId = made.body?.record?.id;
  check('a record can be created', made.status === 200 && Boolean(recordId), `HTTP ${made.status}`);
  check(
    'its fields come back as an object, not the string they were stored as',
    made.body?.record?.data?.title === 'Hello',
    JSON.stringify(made.body?.record?.data ?? null)
  );
  check(
    'and its slug is narrowed to something a URL can hold',
    made.body?.record?.slug === 'hello-world',
    made.body?.record?.slug ?? 'none'
  );

  const listed = await asA(`/api/projects/${projectId}/records?collection=posts`, {});
  check(
    'it is listed under its collection',
    listed.body?.total === 1 && listed.body?.records?.[0]?.id === recordId,
    `${listed.body?.total} record(s)`
  );
  check(
    'and a collection nobody has written to is empty rather than an error',
    (await asA(`/api/projects/${projectId}/records?collection=nothing`, {})).body?.total === 0
  );

  const patched = await asA(`/api/projects/${projectId}/records/${recordId}`, {
    method: 'PUT',
    body: JSON.stringify({ published: false }),
  });
  check(
    'a partial update leaves everything it did not mention alone',
    patched.body?.record?.published === false && patched.body?.record?.data?.title === 'Hello',
    JSON.stringify(patched.body?.record ?? null).slice(0, 90)
  );

  const clash = await asA(`/api/projects/${projectId}/records`, {
    method: 'POST',
    body: JSON.stringify({ collectionId: 'posts', slug: 'hello-world', data: {} }),
  });
  check(
    'two records cannot claim the same slug in one collection',
    clash.status === 409,
    `HTTP ${clash.status} — ${clash.body?.error ?? ''}`
  );

  const tooBig = await asA(`/api/projects/${projectId}/records`, {
    method: 'POST',
    body: JSON.stringify({ collectionId: 'posts', data: { blob: 'x'.repeat(70 * 1024) } }),
  });
  check('an oversized record is refused rather than stored', tooBig.status === 400, `HTTP ${tooBig.status}`);

  const notAnObject = await asA(`/api/projects/${projectId}/records`, {
    method: 'POST',
    body: JSON.stringify({ collectionId: 'posts', data: ['not', 'fields'] }),
  });
  check('so is one whose fields are not fields', notAnObject.status === 400, `HTTP ${notAnObject.status}`);

  // B holds a perfectly good account. Everything below is B pointing it at A's
  // project, which is the only thing keeping these rows private.
  const asB = (path, init) =>
    b.evaluate(
      async ({ api, path, init }) => {
        const r = await fetch(`${api}${path}`, {
          ...init,
          credentials: 'include',
          headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
        });
        return r.status;
      },
      { api: API, path, init }
    );

  check(
    'a stranger cannot list another project’s records',
    (await asB(`/api/projects/${projectId}/records?collection=posts`, {})) === 404,
    `HTTP ${await asB(`/api/projects/${projectId}/records?collection=posts`, {})}`
  );
  check(
    'nor read one by id',
    (await asB(`/api/projects/${projectId}/records/${recordId}`, {})) === 404
  );
  check(
    'nor write one into it',
    (await asB(`/api/projects/${projectId}/records`, {
      method: 'POST',
      body: JSON.stringify({ collectionId: 'posts', data: { title: 'theirs' } }),
    })) === 404
  );
  check(
    'nor delete one',
    (await asB(`/api/projects/${projectId}/records/${recordId}`, { method: 'DELETE' })) === 404
  );

  // The sharper version: B has a project of their own, so the access check
  // passes — and the record still must not be reachable through it, because
  // the id belongs to somebody else's project.
  await b.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await b.locator('button:has-text("Blank")').first().click();
  await b.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const bProjectId = new URL(b.url()).searchParams.get('p');
  await b.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });

  check(
    'and cannot reach it by id through a project they do own',
    (await asB(`/api/projects/${bProjectId}/records/${recordId}`, {})) === 404,
    `HTTP ${await asB(`/api/projects/${bProjectId}/records/${recordId}`, {})}`
  );
  check(
    'nor overwrite it that way',
    (await asB(`/api/projects/${bProjectId}/records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify({ data: { title: 'overwritten' } }),
    })) === 404
  );

  const survived = await asA(`/api/projects/${projectId}/records/${recordId}`, {});
  check(
    'A’s record is exactly as A left it',
    survived.body?.record?.data?.title === 'Hello' && survived.body?.record?.published === false,
    JSON.stringify(survived.body?.record?.data ?? null)
  );

  check(
    'and A can delete their own',
    (await asA(`/api/projects/${projectId}/records/${recordId}`, { method: 'DELETE' })).status === 200
  );

  /* --------------------------------------- 6. viewer cannot mutate anything */

  // Invite B as a viewer to a shared team, then have B try to edit.
  await a.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await a.click('header button:has(svg.lucide-chevron-down)');
  await a.click('button:has-text("New workspace")');
  await a.fill('input[placeholder="Design team"]', 'Studio');
  await a.click('div[role="dialog"] button:has-text("Create")');
  await a.waitForSelector('header button:has-text("Studio")', { timeout: 15000 });

  await a.click('header button:has(svg.lucide-users)');
  await a.fill('input[placeholder="teammate@company.com"]', B.email);
  await a.locator('div[role="dialog"] button:has-text("Editor")').first().click();
  await a.locator('button:has-text("Viewer")').last().click();
  await a.click('div[role="dialog"] button:has-text("Invite")');
  const inviteUrl = await a.locator('input[readonly]').inputValue();
  await a.keyboard.press('Escape');

  await b.goto(inviteUrl, { waitUntil: 'networkidle' });
  await b.click('button:has-text("Join")');
  await b.waitForURL(`${SITE}/`, { timeout: READY_TIMEOUT });
  await b.waitForSelector('header button:has-text("Studio")', { timeout: 15000 });
  check('an existing account can accept an invite with one click', true);

  // A fresh load with Studio active. Studio has no projects of its own, so a
  // project from A's *personal* workspace showing up here would mean the
  // adapter listed with the wrong team.
  await a.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await a.waitForSelector('header button:has-text("Studio")', { timeout: 15000 });
  await a.waitForTimeout(1200);
  const bleed = await a.locator('text=Your projects').count();
  check('a new workspace does not list another workspace\'s projects', bleed === 0);

  await a.locator('button:has-text("Blank")').first().click();
  await a.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const sharedUrl = a.url();
  await a.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await a.waitForTimeout(1500);

  await b.goto(sharedUrl, { waitUntil: 'networkidle' });
  await b.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await b.waitForSelector('text=View only', { timeout: READY_TIMEOUT });

  const before = await b.locator('.cre8-frame.cre8-editing > *').count();
  const bInsert = b.locator('[data-cre8-insert="section"], button:has-text("Section")').first();
  await bInsert.scrollIntoViewIfNeeded().catch(() => {});
  await bInsert.click().catch(() => {});
  await b.waitForTimeout(1500);
  const after = await b.locator('.cre8-frame.cre8-editing > *').count();
  check("a viewer's insert does nothing to the document", after === before, `${before} → ${after}`);
  check(
    'a viewer is told why their edit did not apply',
    (await b.locator('text=view-only access').count()) > 0
  );

  const aCount = await a.locator('.cre8-frame.cre8-editing > *').count();
  check("the viewer's attempt never reached the editor's canvas", aCount === before, `${aCount}`);
} catch (error) {
  check('harness completed', false, error.message);
  for (const [l, p] of [['a', a], ['b', b]]) {
    await p.screenshot({ path: `${ARTIFACTS}/fail-sec-${l}.png` }).catch(() => {});
  }
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
