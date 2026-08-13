/**
 * The stress template, measured.
 *
 * `templates/stress.ts` is a document built to break layouts, and the value of
 * it is entirely in numbers a browser produces: how far a page scrolls
 * sideways, whether three cards in a row are the same height, where a jump
 * actually lands. A screenshot shows those to a person and a suite has to be
 * told them, so this is where the findings in `docs/COMPONENT-LIBRARY.md` come
 * from and how they stay true.
 *
 * ## Over `file://`, not over a Worker
 *
 * Every other suite here drives a real deployment because it needs one — an
 * account, a publish, a route. This needs a rendered page and nothing else, so
 * it generates the site with the same `generateSite` the Worker calls and opens
 * the files from disk. That makes it runnable with no server, and it means the
 * measurements do not depend on a placeholder photo host the sandbox cannot
 * reach. The pages this measures have no external images by design.
 *
 *     node tests/render/stress.mjs
 *
 * ## What it is for
 *
 * Half of these were the *evidence for a gap* before the properties existed —
 * the text page scrolled 732px sideways at 390 and nothing could be set that
 * would help. They are now the evidence the gap is closed, which is the same
 * measurement with the opposite expected value, and worth strictly more than
 * an assertion that a declaration reaches the stylesheet.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createReport, launch, ARTIFACTS, WIDTHS } from './harness.mjs';
import { loadBlocks } from '../static/load-blocks.mjs';

const report = createReport();
const { TEMPLATES, generateSite } = loadBlocks();

const template = TEMPLATES.find((one) => one.id === 'stress');
if (!template) {
  report.check('the stress template is registered', false, 'no template with id "stress"');
  report.finish();
  process.exit(1);
}

/* ------------------------------------------------------------ on to disk -- */

const OUT = path.join(ARTIFACTS, 'stress');
const site = generateSite(template.build(), { records: {} });
for (const file of site.files) {
  const target = path.join(OUT, file.path);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.contents);
}
const pageOf = (slug) => `file://${path.join(OUT, slug, 'index.html')}`;

const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();

/*
 * No webfont, on purpose, and it is worth two paragraphs.
 *
 * Every published page links Google Fonts for Inter. Waiting for `load` with
 * that link in the head means waiting for a request this sandbox cannot make,
 * which took the suite from seconds to eighty seconds a page — the first
 * version of this ran for twelve minutes and nothing in the output said why.
 *
 * Blocking it is better than not waiting for it. A measurement suite whose
 * numbers depend on whether the machine running it could reach a font host
 * gives different answers in CI and on a laptop, and the interesting numbers
 * here are ratios and overflows rather than glyph widths: whether a word fits,
 * whether three cards agree, where a jump lands. Those hold in any font. The
 * ones quoted in the write-up are therefore in the fallback stack, and
 * reproducible anywhere.
 */
await context.route('**://fonts.{googleapis,gstatic}.com/**', (route) => route.abort());

/** Whatever a callback returns, measured with the viewport at one width. */
const at = async (width, url, fn) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url, { waitUntil: 'load' });
  return page.evaluate(fn);
};

/**
 * The same callback at each width, on one navigation.
 *
 * Resizing rather than reloading, because a published page's breakpoints are
 * `@media` queries against the real viewport and resizing re-evaluates them —
 * the reload buys nothing and costs the load. Three widths across six pages is
 * eighteen navigations the first version of this did and this one does six.
 */
const across = async (url, widths, fn) => {
  await page.goto(url, { waitUntil: 'load' });
  const out = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    out.push([width, await page.evaluate(fn)]);
  }
  return out;
};

/* ------------------------------------------------- nothing scrolls sideways */

report.group('no page pushes past its own viewport');

{
  /*
   * The measurement that produced finding 1. It is `scrollWidth` against
   * `clientWidth` on the document rather than a sweep of bounding rects,
   * because the thing that overflowed was inline text inside a box that
   * itself fitted — no element's rect was over, and the page scrolled anyway.
   */
  for (const { slug, name } of [
    { slug: '', name: 'Overview' },
    { slug: 'text', name: 'Text' },
    { slug: 'layout', name: 'Layout' },
    { slug: 'media', name: 'Media' },
    { slug: 'forms', name: 'Forms' },
    { slug: 'interactive', name: 'Interactive' },
  ]) {
    const measured = await across(pageOf(slug), WIDTHS, () => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    const over = measured
      .filter(([, spill]) => spill > 0)
      .map(([width, spill]) => `${width}: ${spill}px`);
    report.check(
      `${name} fits at every width`,
      over.length === 0,
      over.length ? over.join(', ') : `0px at ${WIDTHS.join('/')}`
    );
  }
}

/* ------------------------------------------------------ a word that cannot */

report.group('a word with no break opportunity');

{
  const measured = await at(390, pageOf('text'), () => {
    /*
     * Found by width rather than by name, because a published page carries no
     * node names — and deliberately not by which one overflows, since that is
     * the thing being measured and cannot also be how they are identified.
     * Two boxes, both 180px, in the order the template puts them.
     */
    const pair = [...document.querySelectorAll('div')].filter(
      (el) => Math.round(el.getBoundingClientRect().width) === 180
    );
    const of = (el) =>
      el ? { over: el.scrollWidth - el.clientWidth, height: Math.round(el.offsetHeight) } : null;
    return { count: pair.length, before: of(pair[0]), after: of(pair[1]) };
  });

  report.check(
    'the two 180px boxes are both on the page',
    measured.count === 2,
    `${measured.count} boxes measured 180px wide`
  );
  report.check(
    'the one with nothing set still overflows its box',
    (measured.before?.over ?? 0) > 100,
    // The "before" half has to keep failing, or the "after" half proves
    // nothing: a pair where both fit would pass for the wrong reason if the
    // long word were ever shortened.
    `${measured.before?.over ?? '?'}px of the word is outside the box`
  );
  report.check(
    'and the one set to break it does not',
    measured.after?.over === 0,
    `${measured.after?.over ?? '?'}px over, wrapped to ${measured.after?.height ?? '?'}px tall`
  );
  report.check(
    'which costs height, because the letters had to go somewhere',
    (measured.after?.height ?? 0) > (measured.before?.height ?? 0),
    `${measured.before?.height ?? '?'}px before, ${measured.after?.height ?? '?'}px after`
  );
}

/* ------------------------------------------------------------- truncation */

report.group('a card grid stops being as tall as its longest item');

{
  const rows = await at(1440, pageOf('text'), () => {
    /*
     * Scoped to the Truncation section and partitioned by what the browser
     * computed, rather than found by position.
     *
     * Two earlier versions of this got the wrong elements twice, in opposite
     * directions. Matching every unclamped paragraph on the page found six —
     * three of them the wrapping cases further up. Then taking "the second
     * grid in the section" found the *clamped* row, because the two-up layout
     * the cases sit in is itself a grid, so the card grids are the second and
     * third. Asking each paragraph what its own line-clamp is cannot miss
     * either way.
     */
    const section = [...document.querySelectorAll('h2')]
      .find((h) => h.textContent.trim() === 'Truncation')
      ?.closest('section');
    const paragraphs = [...(section?.querySelectorAll('span') ?? [])].filter(
      (el) =>
        el.textContent.startsWith('A paragraph long enough') &&
        // Not the trimmed table's cell, which holds the same opening words and
        // is the *other* case in this section. Three cards is three heights;
        // a fourth number in the list is a different demonstration.
        !el.closest('table')
    );
    const clampedText = paragraphs.filter(
      (el) => getComputedStyle(el).webkitLineClamp === '2'
    );
    const height = (el) => Math.round(el.getBoundingClientRect().height);
    return {
      clamped: clampedText.map(height),
      /*
       * Content taller than the box, which is what "the text is really being
       * cut" means. The first version asked whether the computed `display` was
       * `-webkit-box` and it is not: this Chromium reimplemented
       * `-webkit-line-clamp` on block layout and reports `flow-root`. A fact
       * about the browser rather than about the page — the check was asserting
       * the mechanism instead of the effect, which is the mistake.
       */
      cut: clampedText.map((el) => el.scrollHeight - el.clientHeight),
      unclamped: paragraphs
        .filter((el) => getComputedStyle(el).webkitLineClamp === 'none')
        .map(height),
    };
  });

  report.check(
    'the clamped cards are the same height as each other',
    rows.clamped.length === 3 && new Set(rows.clamped).size === 1,
    // Three strings of 40, 300 and 120 characters. Equal heights is the whole
    // claim: it is what a card grid needs and what nothing could express.
    `${rows.clamped.join(' / ')}px for three very unequal strings`
  );
  report.check(
    'and the text really is being cut, not merely carrying a declaration',
    // The 300-character card has to be the one with content left over. The
    // 40-character one fits in two lines and has none, which is why this asks
    // for *some* overflow rather than all three.
    rows.cut.filter((n) => n > 100).length === 1 && rows.cut.filter((n) => n === 0).length >= 1,
    `${rows.cut.map((n) => `${n}px hidden`).join(', ')}`
  );
  report.check(
    'the same three strings unclamped are not',
    rows.unclamped.length >= 2 && new Set(rows.unclamped).size > 1,
    `${rows.unclamped.join(' / ')}px — the row is as tall as its longest`
  );

  const trimmed = await at(1440, pageOf('text'), () => {
    const cell = [...document.querySelectorAll('td')].find(
      (el) => getComputedStyle(el).textOverflow === 'ellipsis'
    );
    if (!cell) return null;
    const style = getComputedStyle(cell);
    /*
     * How wide the text *would* be, measured rather than read off the element.
     *
     * `scrollWidth` is the obvious question and a table cell answers it
     * wrongly: it reports the clipped width, so a cell showing an ellipsis and
     * one showing nothing of the sort both come back equal to `clientWidth`.
     * Drawing the same string in the same font on a canvas gives the width the
     * browser had to fit, and comparing the two is the honest form of "there
     * is more here than there is room for".
     */
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      needed: Math.round(context.measureText(cell.textContent).width),
      room: Math.round(cell.clientWidth),
      lines: Math.round(cell.getBoundingClientRect().height),
      wraps: style.whiteSpace,
    };
  });
  report.check(
    'a table cell trims one line instead, because its display is load-bearing',
    Boolean(trimmed) && trimmed.needed > trimmed.room * 2 && trimmed.wraps === 'nowrap',
    // A clamp cannot be used here: `display: -webkit-box` on a `td` stops it
    // being a cell, and the row falls apart. This is the case `textOverflow`
    // is in the vocabulary for.
    trimmed
      ? `${trimmed.needed}px of text in ${trimmed.room}px of cell, on one ${trimmed.lines}px line`
      : 'no ellipsis cell found'
  );
}

/* ---------------------------------------------------------- rearrangement */

report.group('an arrangement that differs from the layer list');

{
  const laid = await at(1440, pageOf('layout'), () => {
    const read = (el) => ({
      el,
      n: el.textContent.trim(),
      x: Math.round(el.getBoundingClientRect().left),
      w: Math.round(el.getBoundingClientRect().width),
      order: getComputedStyle(el).order,
      rotate: getComputedStyle(el).rotate,
      scale: getComputedStyle(el).scale,
      translate: getComputedStyle(el).translate,
      justifySelf: getComputedStyle(el).justifySelf,
    });
    const all = [...document.querySelectorAll('div')]
      .filter((el) => el.children.length === 1 && /^[1-9]$/.test(el.textContent.trim()))
      .map(read);

    const moved = all.find((b) => b.order !== 'normal' && b.order !== '0');
    /*
     * The reordered box's own siblings, left to right — not "everything on the
     * same line". Cases are laid out two-up, so the box beside this one on the
     * screen belongs to a different case entirely, and grouping by vertical
     * position read `5 1 2 3 4 1 2`: the right answer with two strangers on
     * the end.
     */
    const row = moved
      ? [...moved.el.parentElement.children]
          .map(read)
          .sort((a, b) => a.x - b.x)
          .map((b) => b.n)
      : [];
    return {
      row: row.join(''),
      movedOrder: moved?.order ?? 'none',
      selfPlaced: all.find((b) => b.justifySelf === 'center') ?? null,
      transformed: all.filter(
        (b) => b.rotate !== 'none' || b.scale !== 'none' || b.translate !== 'none'
      ),
    };
  });

  report.check(
    'a box drawn first without being moved in the tree',
    laid.row === '51234',
    // Document order is 1 2 3 4 5 and the fifth carries `order: -1`. Reading
    // the drawn row left to right is the only way to see that it worked;
    // the computed value alone would pass on an element nothing laid out.
    `drawn ${laid.row.split('').join(' ')} with order: ${laid.movedOrder}`
  );

  const cell = laid.selfPlaced;
  report.check(
    'one grid item placed across its cell, against what the grid said',
    Boolean(cell) && cell.w < 120,
    // Stretched it would fill half the container; centred it is its own
    // width. The number is the difference between the two.
    cell ? `${cell.w}px wide inside a stretching grid` : 'no self-placed item'
  );

  report.check(
    'rotate, scale and translate each land on their own element',
    laid.transformed.length === 4 &&
      laid.transformed.filter((b) => b.rotate !== 'none').length === 2 &&
      laid.transformed.filter((b) => b.scale !== 'none').length === 2 &&
      laid.transformed.filter((b) => b.translate !== 'none').length === 2,
    laid.transformed
      .map((b) => `${b.n}: ${[b.rotate, b.scale, b.translate].filter((v) => v !== 'none').join(' ')}`)
      .join('; ') || 'nothing transformed'
  );
}

/* ------------------------------------------------------- where a jump lands */

report.group('a jump can stop somewhere other than 96px');

{
  /*
   * A short viewport, and it is not arbitrary.
   *
   * `scroll-margin-top` does not depend on how tall the window is, but whether
   * a browser can *honour* it does: the scroll stops at the end of the
   * document, so a target near the bottom needs `viewport − margin` worth of
   * content beneath it or it lands lower than it asked. At 900 this measured
   * 231px against a requested 220 — an eleven-pixel shortfall that reads like
   * a broken property and is a short page. 500 leaves room to spare, and the
   * `atBottom` flag below is what tells the two apart if it ever stops.
   */
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.goto(pageOf('layout'), { waitUntil: 'load' });

  const landed = await page.evaluate(async () => {
    const follow = async (words) => {
      const link = [...document.querySelectorAll('a')].find((a) =>
        a.textContent.includes(words)
      );
      const id = link?.getAttribute('href')?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return null;
      // `instant`, because this reads a position and a smooth scroll is still
      // moving when it does. The offset is the same either way.
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        top: Math.round(target.getBoundingClientRect().top),
        margin: getComputedStyle(target).scrollMarginTop,
        /*
         * Whether the browser could scroll as far as it was asked to. A target
         * near the end of a document lands where the page runs out instead of
         * where its margin asks, and reports a number that looks like a broken
         * property — the first run of this measured 721px for exactly that
         * reason. Recorded so a wrong number can be told from a short page.
         */
        atBottom:
          Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 1,
      };
    };
    return { deep: await follow('Stops lower'), plain: await follow('which sets nothing') };
  });

  report.check(
    'the section that asked for more clearance gets it',
    Math.abs((landed.deep?.top ?? 0) - 220) <= 2 && landed.deep?.atBottom === false,
    // 220 is what that section asks for. 96 is what the reset gives everything
    // with an id, and what this used to be stuck at. `atBottom` is reported
    // either way, because a number that is off by ten and a page that ran out
    // of room look identical without it.
    landed.deep
      ? `landed ${landed.deep.top}px down against ${landed.deep.margin} asked for, ` +
        `${landed.deep.atBottom ? 'with the page scrolled to its end' : 'mid-document'}`
      : 'no jump link'
  );
  report.check(
    'and the section beside it that asks for nothing still gets 96',
    landed.plain?.margin === '96px',
    /*
     * The pair is what makes either number mean anything: one section
     * overriding the reset and one inheriting it, on the same page, in the same
     * stylesheet. Read off the computed value rather than from where it landed,
     * because this one is the last thing on the page and a browser cannot
     * scroll past the end to satisfy it.
     */
    landed.plain
      ? `scroll-margin-top ${landed.plain.margin}, and it is ${
          landed.plain.atBottom ? 'the end of the page' : 'mid-document'
        }`
      : 'no second jump link'
  );
}

await browser.close();
report.finish();
