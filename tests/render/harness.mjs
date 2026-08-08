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
  await page.waitForURL(`${APP}/`, { timeout: 30000 });
}

/** Open a template or blank project and wait for the canvas to settle. */
export async function openProject(page, templateLabel) {
  await page.locator(`button:has-text("${templateLabel}")`).first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: 30000 });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  await page.waitForSelector('header >> text=Live', { timeout: 20000 });
  await page.waitForTimeout(1500);
  return id;
}

export async function publish(page) {
  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: 60000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
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
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
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
