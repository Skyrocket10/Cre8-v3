/**
 * Shared setup for the browser suites.
 *
 * These run against a real Worker — `npm run preview` in another terminal, or
 * any deployment via CRE8_TEST_URL. They are slower than the static checks and
 * answer the questions only a browser can: does the published markup parse,
 * does the canvas compute the same styles as production, does the page fit its
 * own viewport.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { createReport } from '../report.mjs';

export const APP = process.env.CRE8_TEST_URL ?? 'http://localhost:8787';

/**
 * Where suites drop screenshots and downloads.
 *
 * Absolute, because some of it is loaded back through `file://` — a relative
 * path there produces `file://tests/...`, which the browser reads as a host
 * name and rejects.
 */
export const ARTIFACTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../.artifacts'
);

/** Widths the library is expected to hold up at. */
export const WIDTHS = [390, 768, 1440];

/**
 * Find a Chromium without downloading one.
 *
 * Playwright normally manages its own browsers, but a sandbox usually has one
 * already and no network budget to fetch a second. Preferring the installed
 * copy keeps the suite runnable where it actually runs.
 */
function chromiumPath() {
  if (process.env.CRE8_CHROMIUM) return process.env.CRE8_CHROMIUM;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;

  const dirs = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const exe = path.join(root, dir, 'chrome-linux/chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

export async function launch(options = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      'playwright is not installed — run `npm install` (the render suites need it;\n' +
        'the static checks in tests/static do not).'
    );
    process.exit(2);
  }
  const executablePath = chromiumPath();
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), ...options });
}

/** A fresh account, so suites never collide over a shared workspace. */
export async function signUp(page, name, tag) {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', name);
  await page.fill('input[type="email"]', `${tag}${Date.now()}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: READY_TIMEOUT });
}

/** Open a template or blank project and wait for the canvas to settle. */
export async function openProject(page, templateLabel) {
  await page.locator(`button:has-text("${templateLabel}")`).first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  return id;
}

/**
 * Make an inspector section visible, adding it if the element has not used it.
 *
 * The panel shows a section because it is essential to that kind of element or
 * because the element holds something in it; everything else is behind Add. So
 * "open the Border section" is two different gestures depending on the element
 * in front of you, and a suite whose subject is not the inspector should not
 * have to know which — it wants the rows.
 *
 * Three steps, each skipped when it is already true: add it, expand it, done.
 * Returns whether the section ended up on screen, so a check can say that
 * rather than time out thirty seconds later inside a click.
 */
export async function openInspectorSection(page, title) {
  const panel = page.locator('aside').last();
  const header = () => panel.locator(`button:has(.panel-title:text-is("${title}"))`).first();

  if (!(await header().count())) {
    const add = panel.locator('button:has-text("Add")').last();
    if (!(await add.count())) return false;
    await add.click();
    await page.waitForTimeout(300);
    const offer = page
      .locator('.anim-pop')
      .last()
      .locator(`button:has(span:text-is("${title}"))`)
      .first();
    if (!(await offer.count())) {
      await page.keyboard.press('Escape');
      return false;
    }
    await offer.click();
    await page.waitForTimeout(400);
  }

  if (!(await header().count())) return false;
  // Idempotent: sections remember whether they are open, and clicking one that
  // is already open closes it.
  if ((await header().getAttribute('aria-expanded')) !== 'true') {
    await header().click();
    await page.waitForTimeout(300);
  }
  return true;
}

/**
 * Publish, and wait long enough that a slow write is not read as a failure.
 *
 * Three minutes, which is absurd for a request that normally takes two
 * seconds — and that is the point. A local `wrangler dev` writes D1 and R2 to
 * disk on one thread, and by the sixtieth block of a sweep a publish
 * occasionally takes over a minute. At 60s that surfaced as a suite failing on
 * whichever block happened to be unlucky, which is the worst possible signal:
 * it looks exactly like a regression in that block. A generous ceiling costs
 * nothing when things are healthy and turns a flake back into what it is.
 *
 * Override with `CRE8_PUBLISH_TIMEOUT` when running against a deployment,
 * where a slow publish really is worth failing on.
 */
export const PUBLISH_TIMEOUT = Number(process.env.CRE8_PUBLISH_TIMEOUT ?? 180000);

/**
 * Waiting for the editor to come up — signing in, opening a project, the
 * collaboration socket reporting Live.
 *
 * Same reasoning as `PUBLISH_TIMEOUT` and the same trade. These were twenty
 * and thirty seconds, which is many times what any of them takes when the
 * machine is idle and occasionally not enough when it is on its fifteenth
 * suite. A suite that fails here has told you nothing about the thing it
 * exists to check.
 */
export const READY_TIMEOUT = Number(process.env.CRE8_READY_TIMEOUT ?? 60000);

export async function publish(page) {
  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: PUBLISH_TIMEOUT });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

/* --------------------------------------------------------------------------
 * Seeding a document
 *
 * Some things a suite needs to check have no inspector control yet — a
 * repeater, a custom head — and some have one that would take twenty
 * interactions to drive. Both are reached the same way: read the document,
 * change it as a plain object here in Node, write it back.
 *
 * Not a back door. It is the route a collaborator's whole-document change
 * takes, so the room broadcasts a resync and an open canvas picks it up
 * exactly as it would from another person.
 * ----------------------------------------------------------------------- */

/** Same-origin from the page, so the session cookie and CSRF header come free. */
export function getDocument(page, projectId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    if (!response.ok) throw new Error(`GET project: HTTP ${response.status}`);
    const { document: doc } = await response.json();
    return doc;
  }, projectId);
}

/** Returns the HTTP status, so a suite can assert the seed landed. */
export function saveDocument(page, doc) {
  return page.evaluate(async (body) => {
    const response = await fetch(`/api/projects`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.status;
  }, doc);
}

/** A scene node with the fields every one of them carries, and nothing else. */
export function node(id, type, name, extra = {}) {
  return {
    id,
    type,
    name,
    parentId: null,
    children: [],
    props: {},
    styles: {},
    meta: {},
    ...extra,
  };
}

/**
 * Re-key a published page's measurements into the canvas's class names.
 *
 * Published pages cut each node id to four characters — the ids are the
 * highest-entropy bytes on the page and barely compress, so shortening them is
 * most of what the output optimisation wins. The canvas keeps the full id,
 * because its per-node caches are keyed on identity and renumbering on every
 * insert would cost more than the bytes are worth.
 *
 * So the two surfaces name the same element differently, and something has to
 * bridge them. A prefix can be: it is a property of the id alone, needing no
 * knowledge of how the page was assembled. An id whose prefix collides with
 * another on the same page is published in full, which is why the full name is
 * tried as well.
 *
 * Anything with no counterpart is simply left out, exactly as before — the
 * comparison has always been over the intersection, because the canvas renders
 * a few elements a visitor never sees.
 */
export function toCanvasKeys(published, canvas) {
  const out = {};
  for (const cls of Object.keys(canvas)) {
    const short = `c-${cls.slice(2, 2 + 4)}`;
    const value = published[cls] ?? published[short];
    if (value !== undefined) out[cls] = value;
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Markup
 * ----------------------------------------------------------------------- */

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
  // SVG shapes, which the icon renderer emits self-closed.
  'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use',
]);

/**
 * Tags that open and never close, or close having never opened.
 *
 * Worth checking on every page: an unclosed `<div>` does not throw, it nests
 * the entire rest of the document inside itself, and the only symptom is a
 * layout that looks subtly wrong far from the cause.
 */
export function unbalanced(html) {
  const body = html
    .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
    // `script` and `style` are raw-text elements: the parser does not look
    // for tags inside them and neither should this. Without that, `i < n`
    // in the behaviour runtime reads as an opening `<n>` that never closes,
    // and every page carrying a switch looks broken.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');
  const counts = new Map();
  for (const [, tag] of body.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    const t = tag.toLowerCase();
    if (!VOID.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  for (const [, tag] of body.matchAll(/<\/([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    const t = tag.toLowerCase();
    counts.set(t, (counts.get(t) ?? 0) - 1);
  }
  return [...counts].filter(([, n]) => n !== 0);
}
