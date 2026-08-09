/**
 * Every block, swept.
 *
 * Inserts each block from the registry into a blank page on its own, publishes,
 * and asks the four questions that a library can only answer in a browser:
 *
 *   1. does the published markup parse — no tag left open;
 *   2. does the canvas compute the same styles as the published file;
 *   3. does the block fit its own viewport at 390, 768 and 1440;
 *   4. does anything inside it overflow the section it lives in.
 *
 * This is the generalisation of `fidelity.mjs`, which asks the same things of
 * one template. Pointed at the whole registry it becomes the thing that lets
 * the library grow: a block that breaks one of these fails before it ships,
 * rather than after a designer publishes a page built on it.
 *
 * One block per project on purpose. A block that only looks right sandwiched
 * between two others is not finished, and inserting them together would hide
 * exactly that.
 */

import { APP, WIDTHS, launch, openProject, publish, unbalanced } from './harness.mjs';
import { createReport } from '../report.mjs';
import { loadBlocks } from '../static/load-blocks.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/**
 * Computed styles keyed by the generated class, which both surfaces share.
 *
 * A closed popover is skipped, and it is the only skip in here. Design time
 * and published are supposed to differ for exactly one element: the canvas
 * renders a popover without the attribute so its contents can be reached,
 * while published it stays hidden until a button opens it. Comparing the two
 * would report `flex` against `none` on every page that has one — a real
 * difference, deliberately made, and asserted in both directions by the
 * native suite rather than waved through here.
 */
const COLLECT = () => {
  const out = {};
  const root = document.querySelector('.cre8-frame.cre8-editing') ?? document.body;
  for (const el of root.querySelectorAll('[class]')) {
    const cls = [...el.classList].find((c) => c.startsWith('c-'));
    if (!cls || out[cls]) continue;
    if (el.closest('[popover]:not(:popover-open)')) continue;
    const cs = getComputedStyle(el);
    out[cls] = [
      cs.display, cs.color, cs.backgroundColor, cs.flexDirection,
      cs.justifyContent, cs.fontSize, cs.fontWeight, cs.borderTopWidth,
    ].join('|');
  }
  return out;
};

try {
  /* ---------------------------------------------- 1. what is in the registry */

  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', 'Block Sweep');
  await page.fill('input[type="email"]', `sweep${Date.now()}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 30000 });

  // Driven from the registry, not from whatever the panel happens to render:
  // a block that exists but never reaches the Insert panel is itself a bug,
  // and scraping the DOM for the list would quietly skip it instead of failing.
  const { BLOCKS } = loadBlocks();
  const names = BLOCKS.map((b) => b.name);
  report.check('the registry has blocks to sweep', names.length > 0, `${names.length} blocks`);

  /* ------------------------------------------------- 2. one project per block */

  const id = await openProject(page, 'Blank');

  // Count children of the page root, not of the frame: the frame also holds
  // the editor's selection and hover overlays, which are not document nodes.
  const rootChildren = () => page.locator('[data-cre8-root] > *').count();
  const baseline = await rootChildren();

  for (const name of names) {
    report.group(name);

    const card = page.locator(`button:has(span:text-is("${name}"))`).first();
    // The Insert control toggles, so clicking it unconditionally closes the
    // panel on every second block. Open it only when it is not already open.
    if (!(await card.isVisible().catch(() => false))) {
      await page.locator('button[aria-label="Insert"]').first().click();
    }
    // Wait for the card rather than for a duration — the panel animates in,
    // and a fixed pause is the difference between a green sweep and a silent
    // zero-block one.
    const listed = await card
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!report.check(`${name}: reaches the Insert panel`, listed)) continue;

    await card.click();
    await page.waitForTimeout(1400);

    const canvas = await page.evaluate(COLLECT);
    await publish(page);

    // 2a. Markup parses.
    const html = await (await fetch(`${APP}/s/${id}/`)).text();
    const bad = unbalanced(html);
    report.check(
      `${name}: published markup is balanced`,
      bad.length === 0,
      bad.map(([t, n]) => `${t}:${n > 0 ? '+' : ''}${n}`).join(' ') || 'all closed'
    );

    // 2b. Canvas and published agree.
    const site = await ctx.newPage();
    await site.setViewportSize({ width: 1440, height: 1000 });
    await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
    await site.waitForTimeout(600);
    const published = await site.evaluate(COLLECT);

    const shared = Object.keys(published).filter((c) => c in canvas);
    const diffs = shared.filter((c) => canvas[c] !== published[c]);
    report.check(
      `${name}: canvas and published agree`,
      shared.length > 0 && diffs.length === 0,
      `${shared.length} shared, ${diffs.length} differ` +
        (diffs.length ? ` — ${diffs[0]}: ${canvas[diffs[0]]} vs ${published[diffs[0]]}` : '')
    );

    // 2c and 2d. Fits, at every width, inside and out.
    for (const width of WIDTHS) {
      await site.setViewportSize({ width, height: 1000 });
      await site.waitForTimeout(250);
      const fit = await site.evaluate((vw) => {
        const doc = document.documentElement;
        const over = [];

        // Wider than the viewport is only a bug if the reader cannot get to
        // it. Content inside a box that scrolls sideways — a table, a card
        // rail — is reachable by design, and the whole point of putting it
        // there. What this is looking for is content that has simply escaped.
        const reachable = (el) => {
          for (let node = el.parentElement; node; node = node.parentElement) {
            const overflowX = getComputedStyle(node).overflowX;
            if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
            if (node.scrollWidth > node.clientWidth) return true;
          }
          return false;
        };

        for (const el of document.querySelectorAll('[class*="c-"]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          // 1px of tolerance: sub-pixel rounding is not a layout bug.
          if (r.right > vw + 1 || r.left < -1) {
            if (reachable(el)) continue;
            over.push(`${el.tagName.toLowerCase()}@${Math.round(r.left)}..${Math.round(r.right)}`);
          }
        }
        return { scrollWidth: doc.scrollWidth, over: over.slice(0, 2) };
      }, width);

      report.check(
        `${name}: fits at ${width}`,
        fit.scrollWidth <= width + 1 && fit.over.length === 0,
        fit.scrollWidth > width + 1
          ? `page scrolls to ${fit.scrollWidth}`
          : fit.over.join(' ') || 'no overflow'
      );
    }

    await site.close();

    // Back to an empty page for the next block. One project throughout keeps
    // the sweep quick, and undo is the honest way to get there — if a block
    // cannot be cleanly removed, that is worth knowing too.
    await page.bringToFront();

    // The toolbar button rather than Ctrl+Z: inserting leaves focus in the
    // Insert panel's search field, where the shortcut handler deliberately
    // ignores keys, and clicking the frame to move focus does not work either
    // because the selection overlay intercepts the pointer.
    //
    // Looped rather than pressed once, because a block insert is not always a
    // single history entry — and the loop reports what it took, so a block
    // that needs an unexpected number says so instead of hiding it.
    const undoButton = page.locator('button[aria-label="Undo"]').first();
    let steps = 0;
    while ((await rootChildren()) > baseline && steps < 8) {
      if (await undoButton.isDisabled()) break;
      await undoButton.click();
      await page.waitForTimeout(500);
      steps++;
    }

    const left = await rootChildren();
    if (
      !report.check(
        `${name}: undo restores the empty page`,
        left === baseline,
        `${left} children after ${steps} undo${steps === 1 ? '' : 's'}` +
          ((await undoButton.isDisabled()) ? ', undo now disabled' : '')
      )
    ) {
      break;
    }
  }
} catch (error) {
  report.check('sweep completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
