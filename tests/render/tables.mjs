/**
 * The table family, and the nesting rules that keep it intact.
 *
 * Tables are the one place where "the canvas draws what the document says"
 * stops being enough. The canvas builds its DOM with React, which puts
 * elements exactly where it is told. Publishing writes a string, and the
 * browser parses that string under the HTML tree-construction rules — which
 * move a `<div>` out of a `<table>` and discard a `<td>` with no row around
 * it. Both happen silently, and the result is a published page that does not
 * match the one the designer approved.
 *
 * So the question these ask is not "does it look right" but "did the parser
 * agree with us": the cells counted in the source have to be the cells the
 * browser ends up with, and the editor has to refuse to build the trees where
 * it wouldn't.
 */

import { APP, launch, openProject, publish, signUp, unbalanced } from './harness.mjs';
import { createReport } from '../report.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

// React shouts about invalid nesting through console.error rather than by
// throwing, which is exactly the class of problem this suite is about — so it
// is collected instead of ignored.
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

const insertBlock = async (name) => {
  const card = page.locator(`button:has(span:text-is("${name}"))`).first();
  if (!(await card.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Insert"]').first().click();
    await card.waitFor({ state: 'visible', timeout: 8000 });
  }
  await card.click();
  await page.waitForTimeout(1100);
};

try {
  await signUp(page, 'Tabitha Rowe', 'table');
  const id = await openProject(page, 'Blank');

  await insertBlock('Data table');
  await insertBlock('Comparison table');

  /* ----------------------------------------------- 1. the canvas builds it */

  const canvas = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const tables = [...(frame?.querySelectorAll('table') ?? [])];
    return {
      tables: tables.length,
      // `tbody` is emitted rather than left to the parser, so it has to be
      // there in the DOM React built as well as in the published string.
      bodies: frame?.querySelectorAll('table > tbody').length ?? 0,
      captions: frame?.querySelectorAll('table > caption').length ?? 0,
      rows: frame?.querySelectorAll('tr').length ?? 0,
      cells: frame?.querySelectorAll('td, th').length ?? 0,
      colHeaders: frame?.querySelectorAll('th[scope="col"]').length ?? 0,
      rowHeaders: frame?.querySelectorAll('th[scope="row"]').length ?? 0,
      // Nothing between the table and its rows.
      strays: [...(frame?.querySelectorAll('table > *') ?? [])]
        .map((el) => el.tagName.toLowerCase())
        .filter((tag) => !['caption', 'tbody', 'thead', 'tfoot', 'colgroup'].includes(tag)),
    };
  });

  report.check('two tables render on the canvas', canvas.tables === 2, `${canvas.tables} tables`);
  report.check(
    'each one has the tbody the parser would have inserted',
    canvas.bodies === canvas.tables,
    `${canvas.bodies} of ${canvas.tables}`
  );
  report.check('a caption comes through', canvas.captions === 1, `${canvas.captions} captions`);
  report.check('column headers say which column they head', canvas.colHeaders >= 4, `${canvas.colHeaders}`);
  report.check('row headers say which row they head', canvas.rowHeaders >= 5, `${canvas.rowHeaders}`);
  report.check(
    'nothing sits between a table and its rows',
    canvas.strays.length === 0,
    canvas.strays.join(' ') || 'clean'
  );
  report.check(
    'React reports no invalid nesting',
    !consoleErrors.some((line) => /validateDOMNesting|cannot appear as a child/i.test(line)),
    consoleErrors.find((line) => /validateDOMNesting/i.test(line))?.slice(0, 90) ?? 'silent'
  );

  /* ------------------------------------ 2. the parser agrees with the file */

  await publish(page);
  const html = await (await fetch(`${APP}/s/${id}/`)).text();

  const sourceCells = (html.match(/<t[dh][\s>]/g) ?? []).length;
  const sourceRows = (html.match(/<tr[\s>]/g) ?? []).length;

  report.check('the published markup is balanced', unbalanced(html).length === 0, unbalanced(html).join(' '));
  report.check('the published page ships no script', !/<script/i.test(html));
  report.check(
    'the file carries the tbody rather than leaving it to the parser',
    (html.match(/<tbody>/g) ?? []).length === 2,
    `${(html.match(/<tbody>/g) ?? []).length}`
  );
  report.check(
    'the caption is the first thing inside its table',
    /<table[^>]*><caption>/.test(html),
    /<caption>/.test(html) ? 'in place' : 'missing'
  );

  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  const parsed = await site.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    return {
      tables: tables.length,
      rows: document.querySelectorAll('tr').length,
      cells: document.querySelectorAll('td, th').length,
      // A foster-parented element lands immediately *before* the table, so
      // this is where the damage would show up if it had happened.
      fostered: tables.filter((t) => {
        const prior = t.previousElementSibling;
        return prior?.matches('div, p, span') && prior.querySelector('td, th, tr');
      }).length,
      // The relationship that makes a table a table rather than a picture of
      // one: `cellIndex` and `rowIndex` only exist because the DOM knows the
      // grid, and a screen reader reads the same structure.
      grid: tables.map((t) => `${t.rows.length}x${t.rows[0]?.cells.length ?? 0}`).join(' '),
    };
  });

  report.check(
    'every cell in the file survived parsing',
    parsed.cells === sourceCells && sourceCells > 0,
    `${sourceCells} written, ${parsed.cells} parsed`
  );
  report.check(
    'every row survived parsing',
    parsed.rows === sourceRows && sourceRows > 0,
    `${sourceRows} written, ${parsed.rows} parsed`
  );
  report.check('nothing was foster-parented out of a table', parsed.fostered === 0);
  report.check(
    'the browser reads them as real grids',
    /^\d+x\d+ \d+x\d+$/.test(parsed.grid) && !parsed.grid.includes('x0'),
    parsed.grid
  );
  report.check(
    'the canvas and the published page hold the same cells',
    canvas.cells === parsed.cells,
    `${canvas.cells} on canvas, ${parsed.cells} published`
  );

  /* ---------------------------- 3. the table scrolls rather than overflows */

  for (const width of [390, 1440]) {
    await site.setViewportSize({ width, height: 900 });
    await site.waitForTimeout(250);
    const overflow = await site.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    report.check(`the page does not scroll sideways at ${width}`, overflow <= 1, `${overflow}px over`);
  }

  // Back to the narrow viewport the question is about — the loop above left
  // it at 1440, where of course the table fits.
  await site.setViewportSize({ width: 390, height: 900 });
  await site.waitForTimeout(250);
  const scrolls = await site.evaluate(() => {
    const table = document.querySelector('table');
    const scroller = table?.parentElement;
    return scroller ? scroller.scrollWidth > scroller.clientWidth : false;
  });
  report.check(
    'at 390 the table scrolls inside its own box instead',
    scrolls,
    scrolls ? 'scroller active' : 'table fits — check the min-width'
  );
  await site.close();

  /* -------------------------------- 4. the editor refuses illegal nesting */

  // Selecting a row and adding a heading must not put the heading inside the
  // `<tr>`. It renders there perfectly well on the canvas; the parser throws
  // it out on publish, and the designer finds out from the live site.
  await page.bringToFront();
  await page.locator('button[aria-label="Layers"]').first().click();
  await page.waitForTimeout(500);
  const rowLayer = page.locator('[data-layer-row]:has-text("Header row")').first();
  await rowLayer.click();
  await page.waitForTimeout(400);

  await page.locator('button[aria-label="Insert"]').first().click();
  await page.locator('button:has(span:text-is("Heading"))').first().click();
  await page.waitForTimeout(900);

  const afterInsert = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    return {
      strayInRow: frame?.querySelectorAll('tr > :not(td):not(th)').length ?? 0,
      headings: frame?.querySelectorAll('h1, h2, h3, h4, h5, h6').length ?? 0,
    };
  });

  report.check(
    'a heading added while a row is selected does not land in the row',
    afterInsert.strayInRow === 0,
    `${afterInsert.strayInRow} strays inside a <tr>`
  );
  report.check(
    'it was still added somewhere',
    afterInsert.headings > 0,
    `${afterInsert.headings} headings on the page`
  );

  await publish(page);
  const after = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'and the published rows still contain only cells',
    !/<tr[^>]*>\s*<(?!t[dh][\s>])/.test(after),
    'rows clean'
  );
  report.check(
    'the published cell count is unchanged',
    (after.match(/<t[dh][\s>]/g) ?? []).length === sourceCells,
    `${(after.match(/<t[dh][\s>]/g) ?? []).length} vs ${sourceCells}`
  );
} catch (error) {
  report.check('tables suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
