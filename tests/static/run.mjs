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
const { BLOCKS, BLOCK_CATEGORIES, ICON_NAMES, ELEMENTS, PLACEHOLDER_MIN_HEIGHT, canContain } =
  loadBlocks();
const KNOWN_ICONS = new Set(ICON_NAMES);

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
  // `--c-danger` is in the default theme now, but a document created before it
  // was added carries a theme without it, and an unset variable makes the
  // declaration invalid — an error message would silently render as body text.
  ['#dc2626', 'fallback for --c-danger in themes that predate the token'],
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

/**
 * An icon name has to be one the renderer actually has.
 *
 * `iconMarkup` falls back to `sparkles` for anything unknown, so a typo, or a
 * plausible-sounding name the set does not carry, renders as a perfectly
 * pleasant wrong glyph. A directory of twelve integrations came out with five
 * identical sparkles and nothing anywhere reported a problem.
 */
function checkIconNames(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (node.type !== 'icon') continue;
    const name = String(node.props?.name ?? '');
    if (!KNOWN_ICONS.has(name)) bad.push(`${path}: no icon called "${name}"`);
  }
  return bad;
}

/**
 * Children only where the element can hold them.
 *
 * A `link` is `container: false` — it renders its `text` prop and ignores
 * anything nested inside it. Building a row out of one does not error, does not
 * warn, and does not overflow; the row simply comes out empty, and every
 * structural check passes on a section with nothing in it.
 */
function checkContainerChildren(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (!node.children?.length) continue;
    const element = ELEMENTS[node.type];
    if (element && !element.container) {
      bad.push(`${path}: <${node.type}> holds ${node.children.length} children but renders none`);
    }
  }
  return bad;
}

/**
 * A small image has to clear the empty-slot floor.
 *
 * An image with no source renders as a placeholder carrying
 * `min-height: ${PLACEHOLDER_MIN_HEIGHT}px` so the slot stays visible and
 * clickable. That is a different property from `height`, so specificity does
 * not settle it — the floor simply wins, and an avatar sized 96px comes out
 * 96 by 120. It is right in production once a photo is set and wrong for the
 * whole time the designer is looking at it.
 */
function checkPlaceholderFloor(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (node.type !== 'image') continue;
    const height = /^(\d+(?:\.\d+)?)px$/.exec(String(node.styles?.height ?? ''));
    if (!height || Number(height[1]) >= PLACEHOLDER_MIN_HEIGHT) continue;
    if (node.styles?.minHeight === undefined) {
      bad.push(`${path}: height ${height[0]} under the ${PLACEHOLDER_MIN_HEIGHT}px placeholder floor`);
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

/**
 * No parent/child pair the HTML parser would rearrange.
 *
 * The canvas builds its DOM with React, which puts elements exactly where it
 * is told. Publishing writes a string, and the browser parses that string
 * under the HTML tree-construction rules — which move a `<div>` out of a
 * `<table>` and drop a `<td>` that has no row. Both are silent, and both
 * produce a published page that does not match the one on screen. Drag and
 * drop refuses these pairs; a block is written in code, so nothing refuses
 * them until here.
 */
function checkNesting(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    for (const child of node.children ?? []) {
      if (!canContain(node.type, child.type)) {
        bad.push(`${path}: <${node.type}> cannot hold <${child.type}>`);
      }
    }
  }
  return bad;
}

/**
 * A popover reference has to name a popover — or a dialog — in the same block.
 *
 * `popoverButton` defers the link as a name, and `buildTree` resolves it once
 * the nodes have ids. A name with a typo in it resolves to nothing, the prop
 * is dropped, and the button becomes an ordinary button that looks wired and
 * is not.
 */
function checkPopoverRefs(spec) {
  const bad = [];
  const names = new Set();
  for (const { node } of walk(spec)) {
    if (node.type === 'popover' || node.type === 'dialog') names.add(node.name);
  }
  for (const { node, path } of walk(spec)) {
    const target = node.props?.popoverTarget;
    if (typeof target !== 'string') continue;
    const wanted = target.replace(/^popover@/, '');
    if (!names.has(wanted)) bad.push(`${path}: opens "${wanted}", which is not in this block`);
  }
  return bad;
}

/**
 * A switch has to be wired to itself.
 *
 * Every part of one fails quietly when it is wrong. A case with no group
 * above it gets no generated rule, so it is simply always visible. A control
 * that sets a value nothing listens for is a button that does nothing when
 * clicked. A group whose default matches no case opens showing none of them.
 * None of these throw, none of them look wrong in code, and all three are
 * obvious the moment somebody uses the page.
 */
function checkSwitches(spec) {
  const bad = [];

  const walkGroup = (node, groupKey, groupCases) => {
    for (const child of node.children ?? []) {
      const key = child.props?.switchKey;
      if (key) {
        const cases = new Set();
        collectCases(child, cases);
        const initial = child.props?.switchDefault;
        if (cases.size === 0) {
          bad.push(`${child.name ?? child.type}: switch "${key}" has no cases beneath it`);
        } else if (initial && !cases.has(initial)) {
          bad.push(`${child.name ?? child.type}: ships as "${initial}", which is not one of its cases`);
        }
        // Tabs pair one panel to one tab, and the runtime mints the ids from
        // the case value. Two panels on the same value would take the same id
        // and `aria-controls` would point at whichever the browser kept.
        if (child.props?.switchRole === 'tabs') {
          const counts = new Map();
          countCases(child, counts);
          for (const [value, n] of counts) {
            if (n > 1) bad.push(`${child.name ?? child.type}: ${n} panels share the tab "${value}"`);
          }
          const tabValues = new Set();
          collectSets(child, tabValues);
          for (const value of cases) {
            if (!tabValues.has(value)) bad.push(`${child.name ?? child.type}: panel "${value}" has no tab`);
          }
        }
        walkGroup(child, key, cases);
        continue;
      }
      if (!groupKey) {
        if (child.props?.switchCase) {
          bad.push(`${child.name ?? child.type}: shown when "${child.props.switchCase}", but no switch encloses it`);
        }
        if (child.props?.switchSet) {
          bad.push(`${child.name ?? child.type}: sets "${child.props.switchSet}", but no switch encloses it`);
        }
      } else if (child.props?.switchSet && !groupCases.has(child.props.switchSet)) {
        bad.push(`${child.name ?? child.type}: sets "${child.props.switchSet}", which no case listens for`);
      }
      walkGroup(child, groupKey, groupCases);
    }
  };

  // A case may name several values — `all brand` is how a filter gets its
  // catch-all — so everything below reads the list, not the string.
  const values = (raw) => String(raw ?? '').split(/[\s,]+/).filter(Boolean);

  const countCases = (node, into) => {
    for (const child of node.children ?? []) {
      for (const value of values(child.props?.switchCase)) {
        into.set(value, (into.get(value) ?? 0) + 1);
      }
      if (!child.props?.switchKey) countCases(child, into);
    }
  };

  const collectSets = (node, into) => {
    for (const child of node.children ?? []) {
      if (child.props?.switchSet) into.add(child.props.switchSet);
      if (!child.props?.switchKey) collectSets(child, into);
    }
  };

  const collectCases = (node, into) => {
    for (const child of node.children ?? []) {
      for (const value of values(child.props?.switchCase)) into.add(value);
      // A nested group owns its own cases; stop before crossing into one.
      if (!child.props?.switchKey) collectCases(child, into);
    }
  };

  walkGroup(spec, spec.props?.switchKey ?? '', new Set());
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
  ['every icon name exists in the registry', checkIconNames],
  ['children are only where an element can render them', checkContainerChildren],
  ['no nesting the HTML parser would rearrange', checkNesting],
  ['every popover button names a popover in its block', checkPopoverRefs],
  ['every switch is wired to its own cases', checkSwitches],
  ['small images clear the empty-slot floor', checkPlaceholderFloor],
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
  [
    checkPlaceholderFloor,
    'an avatar-sized image that the placeholder floor would stretch',
    { type: 'image', name: 'I', props: { alt: 'A face' }, styles: { height: '96px' } },
  ],
  [
    checkContainerChildren,
    'children nested inside a link, which renders none',
    { type: 'link', name: 'L', props: { text: '' }, children: [{ type: 'text', name: 'T' }] },
  ],
  [
    checkNesting,
    'a frame parked between a table and its rows',
    {
      type: 'table',
      name: 'T',
      children: [{ type: 'frame', name: 'F', children: [{ type: 'tableRow', name: 'R' }] }],
    },
  ],
  [
    checkNesting,
    'a table cell with no row around it',
    { type: 'frame', name: 'F', children: [{ type: 'tableCell', name: 'C' }] },
  ],
  [
    checkPopoverRefs,
    'a button opening a popover that is not in the block',
    { type: 'frame', name: 'F', children: [{ type: 'button', name: 'B', props: { popoverTarget: 'popover@Ghost' } }] },
  ],
  [
    checkSwitches,
    'a case with no switch above it',
    { type: 'frame', name: 'F', children: [{ type: 'text', name: 'T', props: { switchCase: 'annual' } }] },
  ],
  [
    checkSwitches,
    'a control setting a value nothing listens for',
    {
      type: 'frame',
      name: 'Root',
      children: [
        {
          type: 'frame',
          name: 'G',
          props: { switchKey: 'billing', switchDefault: 'monthly' },
          children: [
            { type: 'text', name: 'A', props: { switchCase: 'monthly' } },
            { type: 'button', name: 'B', props: { switchSet: 'yearly' } },
          ],
        },
      ],
    },
  ],
  [
    checkSwitches,
    'two tab panels sharing one tab',
    {
      type: 'frame',
      name: 'Root',
      children: [
        {
          type: 'frame',
          name: 'T',
          props: { switchKey: 'view', switchDefault: 'a', switchRole: 'tabs' },
          children: [
            { type: 'button', name: 'A', props: { switchSet: 'a' } },
            { type: 'frame', name: 'P1', props: { switchCase: 'a' } },
            { type: 'frame', name: 'P2', props: { switchCase: 'a' } },
          ],
        },
      ],
    },
  ],
  [
    checkSwitches,
    'a tab panel with no tab to open it',
    {
      type: 'frame',
      name: 'Root',
      children: [
        {
          type: 'frame',
          name: 'T',
          props: { switchKey: 'view', switchDefault: 'a', switchRole: 'tabs' },
          children: [
            { type: 'button', name: 'A', props: { switchSet: 'a' } },
            { type: 'frame', name: 'P1', props: { switchCase: 'a' } },
            { type: 'frame', name: 'P2', props: { switchCase: 'b' } },
          ],
        },
      ],
    },
  ],
  [
    checkSwitches,
    'a switch that ships as a case it does not have',
    {
      type: 'frame',
      name: 'Root',
      children: [
        {
          type: 'frame',
          name: 'G',
          props: { switchKey: 'billing', switchDefault: 'weekly' },
          children: [{ type: 'text', name: 'A', props: { switchCase: 'monthly' } }],
        },
      ],
    },
  ],
  [
    checkIconNames,
    'an icon name the renderer does not have',
    { type: 'icon', name: 'I', props: { name: 'definitely-not-an-icon' } },
  ],
  [checkAltText, 'an image whose alt is "photo"', { type: 'image', name: 'I', props: { alt: 'photo' } }],
  [checkInteractiveStates, 'a button with no hover', { type: 'button', name: 'B', props: {} }],
  [checkNames, 'a node with a blank name', { type: 'frame', name: '   ' }],
];

report.group('the checks would catch a violation');
for (const [fn, description, spec] of VIOLATIONS) {
  report.check(`rejects ${description}`, fn(spec).length > 0);
}

report.finish();
