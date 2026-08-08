/**
 * Static checks over every block in the registry.
 *
 * These read straight off the `NodeSpec` tree — no browser, no server, about a
 * second to run. They catch the class of mistake that is invisible in a
 * screenshot of one block at one width and obvious only after a library has
 * fifty of them: a colour that ignores the theme, a grid with no narrow
 * behaviour, a heading level that skips, an image with nothing to announce.
 *
 * The render sweep in `tests/render` covers what only a browser can answer.
 * This covers what a browser is too slow to ask about every block, every
 * commit.
 */

import { createReport } from '../report.mjs';
import { layers, loadBlocks, walk } from './load-blocks.mjs';

const report = createReport();
const { BLOCKS, BLOCK_CATEGORIES } = loadBlocks();

const CATEGORY_IDS = new Set(BLOCK_CATEGORIES.map((c) => c.id));

/* --------------------------------------------------------------------------
 * Token discipline
 * ----------------------------------------------------------------------- */

/**
 * Literal colours that are depictions rather than brand.
 *
 * A macOS window's traffic lights are those colours; re-theming them would
 * make the mock stop reading as a window. Everything else must come from a
 * token, or an inserted block imports a second colour scheme into the
 * project.
 */
const LITERAL_COLOURS = new Map([
  ['#ff5f57', 'macOS close button, depicted literally'],
  ['#febc2e', 'macOS minimise button, depicted literally'],
  ['#28c840', 'macOS zoom button, depicted literally'],
  ['#f5a623', 'review star gold — a rating convention, not brand'],
  ['#22c55e', 'healthy-status green in the product mock'],
]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNCTIONAL_COLOUR = /\b(?:rgba?|hsla?)\s*\(/;

function colourOffences(value) {
  const out = [];
  for (const hex of String(value).match(HEX) ?? []) {
    if (!LITERAL_COLOURS.has(hex.toLowerCase())) out.push(hex);
  }
  if (FUNCTIONAL_COLOUR.test(String(value))) out.push(String(value).slice(0, 40));
  return out;
}

/* --------------------------------------------------------------------------
 * Checks, one function per rule
 * ----------------------------------------------------------------------- */

function checkTokens(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    for (const { where, styles } of layers(node)) {
      for (const [prop, value] of Object.entries(styles)) {
        if (value === undefined) continue;
        for (const offence of colourOffences(value)) {
          bad.push(`${path} ${where}.${prop}: ${offence}`);
        }
        if (prop === 'fontFamily' && !String(value).startsWith('var(')) {
          bad.push(`${path} ${where}.fontFamily is not a token: ${value}`);
        }
      }
    }
  }
  return bad;
}

/** A grid of more than one column has to say what it does when narrow. */
function checkResponsive(spec) {
  const bad = [];
  let sawNarrowLayer = false;

  for (const { node, path } of walk(spec)) {
    if (node.responsive?.mobile || node.responsive?.tablet) sawNarrowLayer = true;

    const columns = node.styles?.gridTemplateColumns;
    if (!columns) continue;
    const multi = /repeat\(\s*([2-9]|\d\d)/.test(columns) || columns.trim().split(/\s+/).length > 1;
    if (!multi) continue;

    const override =
      node.responsive?.mobile?.gridTemplateColumns ?? node.responsive?.tablet?.gridTemplateColumns;
    if (!override) bad.push(`${path}: ${columns} with no narrow override`);
  }

  if (!sawNarrowLayer) bad.push('the block declares no tablet or mobile styles at all');
  return bad;
}

/**
 * A card that spans columns has to stop spanning when the grid stops having
 * them.
 *
 * `grid-column: span 2` inside `grid-template-columns: 1fr` does not clamp —
 * the browser invents an implicit second column and the section quietly goes
 * back to two cramped columns on a phone. Releasing the template is not
 * enough; the span itself has to be released too. Nothing overflows, so the
 * width checks pass and only a screenshot shows it.
 */
function checkColumnSpans(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    const span = node.styles?.gridColumn;
    if (!span || !/span\s+[2-9]/.test(span)) continue;
    const released = ['mobile', 'tablet'].some((bp) => {
      const value = node.responsive?.[bp]?.gridColumn;
      return value === 'auto' || value === '1' || value === 'span 1';
    });
    if (!released) bad.push(`${path}: ${span} with no narrow reset`);
  }
  return bad;
}

/**
 * Multi-track `fr` columns have to be able to shrink.
 *
 * A bare `1fr` is `minmax(auto, 1fr)`, and `auto` floors at min-content — so a
 * track holding an image with an aspect ratio, or one long word, refuses to go
 * below that and takes the width from its neighbour. A 50/50 split renders as
 * 35/65. Nothing overflows and nothing warns; the section is just wrong. Use
 * `cols()`, which spells the tracks `minmax(0, Nfr)`.
 */
function checkShrinkableTracks(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    for (const { where, styles } of layers(node)) {
      const tracks = styles.gridTemplateColumns;
      if (!tracks) continue;
      // A single track cannot steal width from a sibling, and `1fr` alone is
      // the ordinary way to say "one column".
      const parts = tracks.trim().split(/\s+(?![^(]*\))/);
      if (parts.length < 2) continue;
      if (/(^|[\s(])[\d.]+fr/.test(tracks) && !tracks.includes('minmax(')) {
        bad.push(`${path} ${where}: ${tracks}`);
      }
    }
  }
  return bad;
}

/** Heading levels may descend, but not by more than one step at a time. */
function checkHeadings(spec) {
  const bad = [];
  let previous = null;
  for (const { node, path } of walk(spec)) {
    if (node.type !== 'heading') continue;
    const level = Number(node.props?.level ?? 2);
    if (previous !== null && level > previous + 1) {
      bad.push(`${path}: h${previous} → h${level} skips a level`);
    }
    previous = level;
  }
  return bad;
}

const LAZY_ALT = new Set(['', 'image', 'photo', 'picture', 'img', 'graphic']);

function checkAltText(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (node.type !== 'image') continue;
    const alt = String(node.props?.alt ?? '').trim();
    if (LAZY_ALT.has(alt.toLowerCase())) bad.push(`${path}: alt is "${alt}"`);
  }
  return bad;
}

/** Anything clickable has to react to the pointer. */
function checkInteractiveStates(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (node.type !== 'button' && node.type !== 'link') continue;
    const hover = node.states?.hover;
    if (!hover || Object.keys(hover).length === 0) bad.push(`${path}: no hover state`);
  }
  return bad;
}

/** Every node needs a name, or the layer tree is a column of "Frame". */
function checkNames(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (node.name !== undefined && String(node.name).trim() === '') bad.push(`${path}: empty name`);
  }
  return bad;
}

const RULES = [
  ['every colour and font comes from a token', checkTokens],
  ['multi-column layouts have narrow-width behaviour', checkResponsive],
  ['column spans are released when the grid narrows', checkColumnSpans],
  ['fr tracks can shrink below their content', checkShrinkableTracks],
  ['heading levels do not skip', checkHeadings],
  ['images carry alt text worth reading', checkAltText],
  ['buttons and links respond to hover', checkInteractiveStates],
  ['every node is named for the layer tree', checkNames],
];

/* --------------------------------------------------------------------------
 * Run
 * ----------------------------------------------------------------------- */

report.group(`Registry — ${BLOCKS.length} blocks`);

const ids = BLOCKS.map((b) => b.id);
report.check('block ids are unique', new Set(ids).size === ids.length);
report.check(
  'every block has a known category',
  BLOCKS.every((b) => CATEGORY_IDS.has(b.category)),
  BLOCKS.filter((b) => !CATEGORY_IDS.has(b.category))
    .map((b) => `${b.id}:${b.category}`)
    .join(' ') || 'all valid'
);
report.check(
  'every block has a description',
  BLOCKS.every((b) => b.description?.trim()),
  BLOCKS.filter((b) => !b.description?.trim())
    .map((b) => b.id)
    .join(' ') || 'all present'
);

// Built once — `build()` is pure, but calling it six times per block is waste.
const built = BLOCKS.map((block) => ({ block, spec: block.build() }));

for (const [rule, fn] of RULES) {
  report.group(rule);
  for (const { block, spec } of built) {
    const bad = fn(spec);
    report.check(block.id, bad.length === 0, bad.slice(0, 3).join(' | '));
  }
}

/* --------------------------------------------------------------------------
 * The checks check themselves
 *
 * A lint that passes on its first run has not yet been shown to do anything —
 * a regex that quietly stops matching looks exactly like a clean codebase. So
 * each rule is handed something it must reject. If one of these ever passes,
 * that rule has become a no-op and the blocks it "approves" mean nothing.
 * ----------------------------------------------------------------------- */

const VIOLATIONS = [
  [
    checkTokens,
    'a raw hex colour',
    { type: 'section', name: 'S', styles: { color: '#bada55' }, responsive: { mobile: {} } },
  ],
  [
    checkTokens,
    'an rgba() value',
    {
      type: 'section',
      name: 'S',
      styles: { backgroundColor: 'rgba(0,0,0,.5)' },
      responsive: { mobile: {} },
    },
  ],
  [
    checkTokens,
    'a hex hidden in a hover state',
    { type: 'section', name: 'S', states: { hover: { color: '#123456' } } },
  ],
  [
    checkTokens,
    'a hard-coded font stack',
    { type: 'text', name: 'T', styles: { fontFamily: 'Helvetica, Arial, sans-serif' } },
  ],
  [
    checkResponsive,
    'a three-column grid with no narrow override',
    {
      type: 'grid',
      name: 'G',
      styles: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
      responsive: { mobile: { gap: '8px' } },
    },
  ],
  [checkResponsive, 'a block with no narrow styles at all', { type: 'section', name: 'S' }],
  [
    checkShrinkableTracks,
    'a two-track fr split that cannot shrink',
    { type: 'grid', name: 'G', styles: { gridTemplateColumns: '1.05fr 0.95fr' } },
  ],
  [
    checkColumnSpans,
    'a card spanning two columns with no narrow reset',
    { type: 'frame', name: 'F', styles: { gridColumn: 'span 2' }, responsive: { mobile: { gap: '8px' } } },
  ],
  [
    checkHeadings,
    'a heading level that skips',
    {
      type: 'section',
      name: 'S',
      responsive: { mobile: {} },
      children: [
        { type: 'heading', name: 'A', props: { level: 2 } },
        { type: 'heading', name: 'B', props: { level: 4 } },
      ],
    },
  ],
  [checkAltText, 'an image with no alt', { type: 'image', name: 'I', props: {} }],
  [checkAltText, 'an image whose alt is "photo"', { type: 'image', name: 'I', props: { alt: 'photo' } }],
  [checkInteractiveStates, 'a button with no hover', { type: 'button', name: 'B', props: {} }],
  [checkNames, 'a node with a blank name', { type: 'frame', name: '   ' }],
];

report.group('the checks would catch a violation');
for (const [fn, description, spec] of VIOLATIONS) {
  report.check(`rejects ${description}`, fn(spec).length > 0);
}

report.finish();
