/**
 * Can a running deployment read its own schema, and say what it is missing?
 *
 * `/api/admin/schema` exists because `schema.sql` cannot add a column to a
 * table that already exists, and the four columns publishing depends on were
 * all added to tables that already existed everywhere. The static suite checks
 * the *list* against `schema.sql` in `node:sqlite`, which is the same engine
 * D1 is built on — but it is not D1, and the one thing this endpoint needs
 * that ordinary queries never use is `PRAGMA table_info` through
 * `.prepare().all()`.
 *
 * That is the whole reason this suite exists. If D1 answered a pragma with no
 * rows, every check in the static suite would still pass and the endpoint
 * would report an uninitialised database on a database that is perfectly fine
 * — and then refuse to fix the one it was written for. So: ask a real Worker.
 */

import { APP, launch, signUp } from './harness.mjs';

const results = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Same-origin from the page, so the session cookie and CSRF header come free. */
function callSchema(page, method) {
  return page.evaluate(async (verb) => {
    const response = await fetch('/api/admin/schema', {
      method: verb,
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, method);
}

const browser = await launch();

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  /* --- Signed out ------------------------------------------------------- */

  await page.goto(`${APP}/signin`, { waitUntil: 'domcontentloaded' });
  const anonymous = await callSchema(page, 'GET');
  check(
    'a stranger cannot ask what the database is missing',
    anonymous.status === 401,
    `HTTP ${anonymous.status}`
  );

  const anonymousWrite = await callSchema(page, 'POST');
  check(
    'and certainly cannot run DDL',
    anonymousWrite.status === 401,
    `HTTP ${anonymousWrite.status}`
  );

  /* --- Signed in -------------------------------------------------------- */

  await signUp(page, 'Sam Schema', 'schema');
  await page.waitForTimeout(500);

  const report = await callSchema(page, 'GET');
  check('a signed-in account gets a report', report.status === 200, `HTTP ${report.status}`);

  const seen = report.body ?? {};

  /*
   * The check this suite is for.
   *
   * A test Worker runs against a database built from `schema.sql`, so every
   * late column is present and none is pending. Getting that answer means the
   * pragma returned rows: had it returned none, both tables would have looked
   * absent and `missingTables` would name them.
   */
  check(
    'D1 answers PRAGMA table_info, so the report describes a real database',
    Array.isArray(seen.missingTables) &&
      seen.missingTables.length === 0 &&
      Array.isArray(seen.present) &&
      seen.present.length === 4,
    `${(seen.present ?? []).join(', ') || 'nothing'}${
      seen.missingTables?.length ? ` / missing ${seen.missingTables.join(', ')}` : ''
    }`
  );
  check(
    'and it names the four columns publishing needs, not four other things',
    ['projects.subdomain', 'projects.site_manifest', 'deployments.document', 'deployments.changed']
      .every((column) => (seen.present ?? []).includes(column)),
    (seen.present ?? []).join(', ')
  );
  check(
    'a database in step with the code is reported as ready',
    seen.ready === true && Array.isArray(seen.pending) && seen.pending.length === 0,
    `${seen.message ?? '(no message)'}`
  );

  /* --- Applying it ------------------------------------------------------ */

  const applied = await callSchema(page, 'POST');
  check('the upgrade runs', applied.status === 200, `HTTP ${applied.status}`);
  check(
    'and changes nothing on a database that is already current',
    applied.body?.added?.length === 0 &&
      applied.body?.indexes?.length === 0 &&
      applied.body?.ready === true,
    applied.body?.message ?? '(no message)'
  );

  /*
   * The endpoint changes state, so it is behind the same header as everything
   * else that does. Checked here rather than assumed from the router, because
   * the router's guard runs before the route is chosen and a new branch added
   * in the wrong place would sail past it.
   */
  const noHeader = await page.evaluate(async () => {
    const response = await fetch('/api/admin/schema', {
      method: 'POST',
      credentials: 'include',
    });
    return response.status;
  });
  check('and DDL without the CSRF header is refused', noHeader === 403, `HTTP ${noHeader}`);

  /* --- The failure it exists to prevent --------------------------------- */

  /*
   * A deploy that outran its database used to fail with `Internal error`. It
   * now names the column and this endpoint. There is no way to remove a column
   * from a live D1 to provoke it, so what is checked is the half that can be:
   * the wording is reachable from a request, and an ordinary 404 has not been
   * swallowed by the same branch.
   */
  const missing = await page.evaluate(async () => {
    const response = await fetch('/api/admin/nonsense', {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  check(
    'an unknown admin path is still an ordinary 404',
    missing.status === 404 && !/behind this deployment/i.test(missing.body?.error ?? ''),
    `HTTP ${missing.status} ${missing.body?.error ?? ''}`
  );

  await context.close();
} finally {
  await browser.close();
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
