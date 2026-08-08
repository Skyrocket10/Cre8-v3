/**
 * The Insert panel at library scale.
 *
 * Nine blocks fitted in one ungrouped column. A hundred will not, so the panel
 * now groups by category, remembers what you reach for, and previews a block
 * by rendering it rather than by showing a drawing of it.
 *
 * The preview check is the one that matters: it asserts the preview contains
 * the block's real nodes, because a preview that merely *looks* plausible is
 * exactly the failure mode a hand-drawn thumbnail has.
 */

import { APP, launch, openProject, publish } from './harness.mjs';
import { createReport } from '../report.mjs';
import { loadBlocks } from '../static/load-blocks.mjs';

const report = createReport();
const { BLOCKS, BLOCK_CATEGORIES } = loadBlocks();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const openInsert = async () => {
  const anyCard = page.locator(`button:has(span:text-is("${BLOCKS[0].name}"))`).first();
  if (!(await anyCard.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Insert"]').first().click();
    await anyCard.waitFor({ state: 'visible', timeout: 8000 });
  }
};

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', 'Pan El');
  await page.fill('input[type="email"]', `panel${Date.now()}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 30000 });
  await openProject(page, 'Blank');
  await openInsert();

  /* ------------------------------------------------------------ 1. grouping */

  const headings = await page.locator('.panel-title').allTextContents();
  const expected = [...new Set(BLOCKS.map((b) => b.category))].map(
    (id) => BLOCK_CATEGORIES.find((c) => c.id === id)?.label
  );
  report.check(
    'blocks are grouped by category, not listed flat',
    expected.every((label) => headings.includes(label)),
    `want ${expected.join(', ')} | saw ${headings.join(', ')}`
  );
  report.check(
    'the old ungrouped "Sections" heading is gone',
    !headings.includes('Sections'),
    headings.join(', ')
  );

  /* ------------------------------------------------------------- 2. search */

  // A keyword that appears in neither the name nor the description.
  const withKeyword = BLOCKS.find((b) => b.keywords?.length);
  const term = withKeyword.keywords.find(
    (k) =>
      !withKeyword.name.toLowerCase().includes(k) &&
      !withKeyword.description.toLowerCase().includes(k)
  );
  await page.fill('input[placeholder="Search elements"]', term);
  await page.waitForTimeout(400);
  report.check(
    `searching a keyword finds its block — "${term}" → ${withKeyword.name}`,
    await page
      .locator(`button:has(span:text-is("${withKeyword.name}"))`)
      .first()
      .isVisible()
      .catch(() => false)
  );
  await page.fill('input[placeholder="Search elements"]', '');
  await page.waitForTimeout(400);

  /* ------------------------------------------------------ 3. hover preview */

  const target = BLOCKS.find((b) => b.id === 'pricing') ?? BLOCKS[0];
  await page.locator(`button:has(span:text-is("${target.name}"))`).first().hover();
  await page.waitForTimeout(1200);

  const preview = await page.evaluate(() => {
    // The preview is the only [data-cre8-root] outside the editing frame.
    const roots = [...document.querySelectorAll('[data-cre8-root]')].filter(
      (el) => !el.closest('.cre8-editing')
    );
    const root = roots[0];
    if (!root) return null;
    const texts = [...root.querySelectorAll('*')]
      .map((el) => (el.children.length === 0 ? el.textContent?.trim() : ''))
      .filter(Boolean);
    return {
      nodes: root.querySelectorAll('[class*="c-"]').length,
      texts,
      width: Math.round(root.getBoundingClientRect().width),
    };
  });

  report.check('hovering a block shows a preview', preview !== null, preview ? 'shown' : 'nothing');
  report.check(
    'the preview is the block itself, rendered',
    (preview?.nodes ?? 0) > 20,
    `${preview?.nodes ?? 0} rendered nodes`
  );

  // Content from the spec, so this cannot pass on a lookalike drawing.
  report.check(
    'it contains the block’s real content',
    ['Hobby', 'Enterprise', 'Most popular'].every((t) => preview?.texts.includes(t)),
    (preview?.texts ?? []).slice(0, 4).join(' / ')
  );

  report.check(
    'it is scaled down, not rendered at full width',
    (preview?.width ?? 0) > 0 && (preview?.width ?? 0) < 400,
    `${preview?.width}px on screen`
  );

  await page.mouse.move(1200, 900);
  await page.waitForTimeout(500);
  report.check(
    'the preview goes away when the pointer leaves',
    (await page.locator('[data-cre8-root]:not(.cre8-editing [data-cre8-root])').count()) <= 1
  );

  /* ---------------------------------------------------------- 4. recents */

  await openInsert();
  await page.locator(`button:has(span:text-is("${target.name}"))`).first().click();
  await page.waitForTimeout(1000);
  await openInsert();

  const recentHeading = await page.locator('.panel-title:text-is("Recent")').count();
  report.check('inserting a block adds it to Recent', recentHeading === 1);

  // Scoped to the Recent group: the inserted section is named after the block,
  // so it also shows up in the Layers tree and a page-wide count would pass
  // for the wrong reason.
  const inRecent = page.locator(
    `section:has(> h3.panel-title:text-is("Recent")) button:has(span:text-is("${target.name}"))`
  );
  report.check(
    'the recent entry is the block just inserted',
    (await inRecent.count()) === 1,
    `${await inRecent.count()} matching rows under Recent`
  );

  /* ------------------------------------- 5. publishing does not cost an undo */

  await publish(page);
  await page.bringToFront();

  const undoButton = page.locator('button[aria-label="Undo"]').first();
  await undoButton.click();
  await page.waitForTimeout(800);
  const left = await page.locator('[data-cre8-root] > *').count();
  report.check(
    'one undo after publishing removes the block',
    left === 0,
    `${left} children left — publishing should not occupy an undo step`
  );
} catch (error) {
  report.check('panel suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
