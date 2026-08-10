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

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport } from '../report.mjs';
import { layers, loadBlocks, walk } from './load-blocks.mjs';
import {
  databaseWith,
  indexesOf,
  loadSchemaModule,
  runnerFor,
  shapeOf,
} from './load-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const report = createReport();
const {
  BLOCKS,
  BLOCK_CATEGORIES,
  ICON_NAMES,
  ELEMENTS,
  PLACEHOLDER_MIN_HEIGHT,
  canContain,
  migrateDocument,
  buildTree,
  generateNodeCss,
  renderPage,
  generateSite,
  createEmptyDocument,
  hydrateDocument,
  ops,
  components: componentLib,
} = loadBlocks();

/** The selector of the first generated rule mentioning `needle`. */
const selectorOf = (css, needle) =>
  css.split('\n').find((line) => line.includes(needle) && line.endsWith('{'))?.slice(0, -1) ?? '';

/**
 * A selector with its `:where()` groups removed.
 *
 * Balanced rather than a regex, because the groups nest — `:where(:not(:is(…
 * )))` — and a non-greedy `\)` stops at the wrong bracket. What is left has to
 * be the node's class alone, or the rule out-ranks the ones around it.
 */
const withoutWhere = (selector) => {
  let out = '';
  for (let i = 0; i < selector.length; i++) {
    if (!selector.startsWith(':where(', i)) {
      out += selector[i];
      continue;
    }
    let depth = 0;
    for (i += 6; i < selector.length; i++) {
      if (selector[i] === '(') depth++;
      else if (selector[i] === ')' && --depth === 0) break;
    }
  }
  return out.trim();
};
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
  const at = (node) => node.name ?? node.type;

  /**
   * The unnamed state conditions a node carries, split by what they do.
   *
   * Both kinds store the literal, and the two read opposite ways round.
   *
   * A **hiding** rule says *when this, hide*, so `isNot X` is "hide unless X",
   * which makes X a value something depends on, and `is X` is "hide when X",
   * which does not.
   *
   * A **content** rule says *when this, read differently*, and it expands into
   * two elements: one for the value and one for everything else. So `is X`
   * makes X depended on, and — unlike the hiding case — guarantees that some
   * other value is meaningful too, because the base element is exactly the
   * "anything else" branch.
   */
  const conditionsOf = (node, wanted) => {
    const out = [];
    for (const rule of node.rules ?? []) {
      if (Boolean(rule.set) !== (wanted === 'content')) continue;
      for (const condition of rule.when ?? []) {
        if (condition.kind === 'state' && !condition.key) out.push(condition);
      }
    }
    return out;
  };

  /** Everything a state can be told to be, and every test made against it. */
  const survey = (group) => {
    const depends = new Set();
    const negated = new Set();
    const sets = [];
    const panelCounts = new Map();

    const record = (node, counting) => {
      for (const condition of conditionsOf(node, 'hiding')) {
        for (const value of condition.values) {
          (condition.op === 'isNot' ? depends : negated).add(value);
          // A variant is not a panel: a tab opens one element, and content
          // rules produce a pair that are the same element saying two things.
          if (counting && condition.op === 'isNot') {
            panelCounts.set(value, (panelCounts.get(value) ?? 0) + 1);
          }
        }
      }
      for (const condition of conditionsOf(node, 'content')) {
        for (const value of condition.values) {
          depends.add(value);
          // The base element covers every value this one does not, so a
          // default outside the list is tested for rather than orphaned.
          negated.add(value);
        }
      }
    };

    // The group's own condition, which is how a dismissible thing hides
    // itself — it belongs to this state, not to whatever encloses it.
    record(group, false);
    const own = conditionsOf(group, 'hiding');

    const walk = (node) => {
      for (const child of node.children ?? []) {
        record(child, true);
        if (child.props?.switchSet) sets.push({ node: child, value: child.props.switchSet });
        // A nested state owns everything below it.
        if (!child.props?.switchKey) walk(child);
      }
    };
    walk(group);
    return { depends, negated, sets, panelCounts, selfCondition: own.length > 0 };
  };

  const walkGroups = (node, enclosed) => {
    for (const child of node.children ?? []) {
      const key = child.props?.switchKey;
      if (!key) {
        if (!enclosed) {
          // A condition naming a state explicitly may reach further up than
          // this walk has seen, so only an unnamed one is provably orphaned.
          for (const kind of ['hiding', 'content']) {
            for (const condition of conditionsOf(child, kind)) {
              bad.push(
                `${at(child)}: conditional on "${condition.values.join(' ')}", but no state encloses it`
              );
            }
          }
          if (child.props?.switchSet) {
            bad.push(`${at(child)}: sets "${child.props.switchSet}", but no state encloses it`);
          }
        }
        walkGroups(child, enclosed);
        continue;
      }

      const { depends, negated, sets, panelCounts, selfCondition } = survey(child);
      const known = new Set([...depends, ...negated]);

      if (known.size === 0) {
        bad.push(`${at(child)}: state "${key}" has nothing that depends on it`);
      }

      // A value nothing names is only meaningful when *some* condition is
      // satisfied by "anything else" — a negated one, the state's owner hiding
      // itself, or a content rule, whose base element is the "anything else"
      // branch by construction. Otherwise it is a typo that blanks the group.
      const anyOtherValueMatters = negated.size > 0 || selfCondition;

      const initial = child.props?.switchDefault;
      if (initial && known.size && !known.has(initial) && !anyOtherValueMatters) {
        bad.push(`${at(child)}: ships as "${initial}", which nothing tests for`);
      }

      for (const { node: setter, value } of sets) {
        if (!known.has(value) && !anyOtherValueMatters) {
          bad.push(`${at(setter)}: sets "${value}", which nothing listens for`);
        }
      }

      if (child.props?.switchRole === 'tabs') {
        // Tabs pair one panel to one tab, and the runtime mints the ids from
        // the value. Two panels on one value would take the same id.
        for (const [value, n] of panelCounts) {
          if (n > 1) bad.push(`${at(child)}: ${n} panels share the tab "${value}"`);
        }
        const tabValues = new Set(sets.map((s) => s.value));
        for (const value of panelCounts.keys()) {
          if (!tabValues.has(value)) bad.push(`${at(child)}: panel "${value}" has no tab`);
        }
      }

      walkGroups(child, true);
    }
  };

  walkGroups(spec, Boolean(spec.props?.switchKey));
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

/**
 * The props that used to say when an element was on screen.
 *
 * A document that still carries them is upgraded on load, and that path has
 * to keep working — but a *block* is source, and one written with them would
 * be authoring against a shape the editor no longer writes. The migration
 * would quietly rescue it, which is exactly why nothing would notice.
 */
const RETIRED_PROPS = ['switchCase', 'whenIs', 'whenState', 'whenNot', 'hideMode'];

function checkRetiredProps(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    for (const prop of RETIRED_PROPS) {
      if (node.props?.[prop] !== undefined) {
        bad.push(`${path}: "${prop}" is a retired prop — write it as a rule`);
      }
    }
  }
  return bad;
}

/**
 * A node that varies its content must vary it on one state, exclusively.
 *
 * `set` makes a node render as one element per alternative, all of them in the
 * published file, with a rule hiding the ones that do not apply. If two of
 * those rules could hold at once, each element would have to say "show me when
 * mine matches and no later one does", and the number of generated conditions
 * would grow with the square of the rules.
 *
 * Requiring one state and disjoint values keeps it linear. The escape hatch
 * for the rare genuine case is to nest an element and put the second condition
 * on that. The renderer skips a rule it cannot fit, so without this check a
 * block would ship with its second alternative silently doing nothing.
 */
const SETTABLE = new Set([
  'text', 'html', 'label', 'alt', 'src', 'href', 'name', 'caption', 'placeholder', 'value', 'title',
]);

function checkContentRules(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    const setting = (node.rules ?? []).filter(
      (rule) => rule.set && Object.keys(rule.set).some((prop) => SETTABLE.has(prop))
    );
    if (!setting.length) continue;

    // Every variant carries the node's id in its class, and a popover also
    // carries it as a DOM id — which would then appear twice in one document.
    if (node.type === 'popover' || node.type === 'dialog') {
      bad.push(`${path}: ${node.type} content cannot vary — both copies would take the same id`);
    }

    // A switch value and a data source are the same axis here, which is the
    // claim stage 3 makes: content that changes with the time of day and
    // content that changes with a toggle expand identically.
    const axisOf = (condition) => {
      if (condition.kind === 'state') return condition.key || 'the nearest state';
      if (condition.kind === 'data') return condition.source;
      return null;
    };

    let axis = null;
    const claimed = new Map();
    for (const rule of setting) {
      const unsettable = Object.keys(rule.set).filter((prop) => !SETTABLE.has(prop));
      if (unsettable.length) {
        bad.push(`${path}: "${unsettable.join(', ')}" is structure, not content — it cannot be set`);
      }
      if (rule.when.length !== 1 || rule.part || rule.breakpoint) {
        bad.push(`${path}: a content rule takes exactly one plain condition`);
        continue;
      }
      const condition = rule.when[0];
      const found = axisOf(condition);
      if (found === null || condition.op !== 'is' || !condition.values?.length) {
        bad.push(
          `${path}: content varies on "${condition.kind}", which is not a value it can expand on`
        );
        continue;
      }
      if (axis === null) axis = found;
      else if (found !== axis) {
        bad.push(
          `${path}: content varies on both "${axis}" and "${found}" — ` +
            'nest an element for the second'
        );
      }
      for (const value of condition.values) {
        if (claimed.has(value)) bad.push(`${path}: two alternatives both answer to "${value}"`);
        claimed.set(value, true);
      }
    }
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
  ['no block still says when it shows in props', checkRetiredProps],
  ['content varies on one state, exclusively', checkContentRules],
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

/**
 * "Shown when the nearest state is X", as a fixture writes it.
 *
 * A rule stores the literal — *hide when it isn't X* — so spelling one out by
 * hand in each fixture is four lines of inverted logic apiece, and one of them
 * would eventually say `is` and quietly stop testing anything.
 */
const shownWhen = (value) => [
  {
    id: `case-${value}`,
    when: [{ kind: 'state', key: '', op: 'isNot', values: value.split(' ') }],
    apply: { display: 'none' },
  },
];

/** "Shown when the nearest state is X" on a spec, optionally naming the state. */
const switchCaseSpec = (value, node, state = '') => ({
  ...node,
  rules: [
    {
      id: `case-${value}`,
      when: [{ kind: 'state', key: state, op: 'isNot', values: [value] }],
      apply: { display: 'none' },
    },
  ],
});

/** "When the state is X, the text reads Y" — the shape `set` expands. */
const saysWhen = (value, set, key = '') => ({
  id: `set-${value}`,
  when: [{ kind: 'state', key, op: 'is', values: value.split(' ') }],
  apply: {},
  set,
});

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
    // Was a link, until a link became something that can hold children. An
    // image cannot and never will — it is a void element, so a child of one is
    // content that exists in the document and in no rendered page.
    'children nested inside an image, which renders none',
    {
      type: 'image',
      name: 'I',
      props: { alt: 'A photo' },
      children: [{ type: 'text', name: 'T' }],
    },
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
    { type: 'frame', name: 'F', children: [{ type: 'text', name: 'T', rules: shownWhen('annual') }] },
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
            { type: 'text', name: 'A', rules: shownWhen('monthly') },
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
            { type: 'frame', name: 'P1', rules: shownWhen('a') },
            { type: 'frame', name: 'P2', rules: shownWhen('a') },
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
            { type: 'frame', name: 'P1', rules: shownWhen('a') },
            { type: 'frame', name: 'P2', rules: shownWhen('b') },
          ],
        },
      ],
    },
  ],
  [
    checkSwitches,
    'a switch that ships as a value nothing tests for',
    {
      type: 'frame',
      name: 'Root',
      children: [
        {
          type: 'frame',
          name: 'G',
          props: { switchKey: 'billing', switchDefault: 'weekly' },
          children: [{ type: 'text', name: 'A', rules: shownWhen('monthly') }],
        },
      ],
    },
  ],
  [
    checkSwitches,
    'a state nothing depends on',
    {
      type: 'frame',
      name: 'Root',
      children: [{ type: 'frame', name: 'G', props: { switchKey: 'k', switchDefault: 'a' } }],
    },
  ],
  [
    checkRetiredProps,
    'a block that still hides itself with a prop',
    { type: 'text', name: 'T', props: { whenIs: 'annual' } },
  ],
  [
    checkContentRules,
    'two alternatives that could both be on screen at once',
    {
      type: 'text',
      name: 'T',
      rules: [saysWhen('annual', { text: 'a' }), saysWhen('annual monthly', { text: 'b' })],
    },
  ],
  [
    checkContentRules,
    'content varying on two different states',
    {
      type: 'text',
      name: 'T',
      rules: [
        saysWhen('annual', { text: 'a' }),
        saysWhen('pro', { text: 'b' }, 'plan'),
      ],
    },
  ],
  [
    checkContentRules,
    'a rule setting something structural rather than content',
    { type: 'text', name: 'T', rules: [saysWhen('annual', { text: 'a', switchKey: 'oops' })] },
  ],
  [
    checkContentRules,
    'content varying on a state and on the visit at once',
    {
      type: 'text',
      name: 'T',
      rules: [
        saysWhen('annual', { text: 'a' }),
        {
          id: 'd',
          when: [{ kind: 'data', source: 'time', op: 'is', values: ['night'] }],
          apply: {},
          set: { text: 'b' },
        },
      ],
    },
  ],
  [
    checkContentRules,
    'content varying on a hover, which cannot expand into elements',
    {
      type: 'text',
      name: 'T',
      rules: [{ id: 'r', when: [{ kind: 'pointer', pseudo: 'hover' }], apply: {}, set: { text: 'a' } }],
    },
  ],
  [
    checkContentRules,
    'a popover whose content varies, so both copies take its id',
    { type: 'popover', name: 'P', rules: [saysWhen('open', { title: 'a' })] },
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

/* --------------------------------------------------------------------------
 * Loading an older document
 *
 * `migrateDocument` runs on every project every time it is opened, and it
 * rewrites the part of a node that decides whether the node is visible. There
 * is no louder failure available and no quieter one either: get it wrong and
 * somebody's page silently loses a section.
 *
 * Two properties matter beyond "it converts". It must recognise the *shape*
 * rather than trust the version — the field was written and never read, so a
 * document saved last year and one saved last week both claim `1` — and it
 * must be safe to run twice, because that is what "recognise the shape"
 * costs if you get it wrong.
 * ----------------------------------------------------------------------- */

const asDocument = (nodes) => ({
  version: 1,
  nodes: Object.fromEntries(nodes.map((node, i) => [`n${i}`, { id: `n${i}`, props: {}, ...node }])),
});

report.group('a document saved before rules still opens');

{
  const doc = migrateDocument(
    asDocument([
      { props: { whenIs: 'annual' } },
      { props: { whenIs: 'free', whenNot: true, hideMode: 'keep' } },
      { props: { switchCase: 'monthly' } },
      { props: { whenIs: 'pro', whenState: 'plan' } },
      { states: { hover: { color: 'red' } } },
      { props: { switchSet: 'annual' }, states: { pressed: { color: 'red' } } },
      { states: { pressed: { color: 'red' } } },
      { states: { backdrop: { backgroundColor: 'black' } } },
    ])
  );
  const at = (i) => doc.nodes[`n${i}`];
  const only = (i) => at(i).rules?.[0];
  const when = (i) => only(i)?.when?.[0];

  report.check('the version is the one the code understands now', doc.version === 2, doc.version);
  report.check(
    '"shown when annual" becomes "hide unless annual"',
    when(0)?.op === 'isNot' && when(0)?.values.join() === 'annual',
    `${when(0)?.op} ${when(0)?.values}`
  );
  report.check(
    'and it hides by taking the space, as it did',
    only(0)?.apply.display === 'none'
  );
  report.check(
    '"shown unless free" flips the other way',
    when(1)?.op === 'is' && when(1)?.values.join() === 'free',
    `${when(1)?.op} ${when(1)?.values}`
  );
  report.check(
    'and "leave the space" survives as visibility',
    only(1)?.apply.visibility === 'hidden' && only(1)?.apply.display === undefined
  );
  report.check(
    'the older spelling is understood too',
    when(2)?.op === 'isNot' && when(2)?.values.join() === 'monthly'
  );
  report.check('a named state keeps its name', when(3)?.key === 'plan', when(3)?.key);
  report.check(
    'hover becomes a pointer condition',
    when(4)?.kind === 'pointer' && when(4)?.pseudo === 'hover' && only(4)?.apply.color === 'red'
  );
  report.check(
    'pressed becomes a condition on the value the control sets',
    when(5)?.kind === 'state' && when(5)?.op === 'is' && when(5)?.values.join() === 'annual',
    `${when(5)?.kind} ${when(5)?.op} ${when(5)?.values}`
  );
  // Rather than invent a condition the author never wrote: `pressed` only
  // ever meant anything next to a `switchSet`, and a rule with no condition
  // would paint the control as permanently selected.
  report.check('and is dropped when there is no value to press', !at(6).rules?.length);
  report.check(
    'a backdrop becomes a part, not a condition',
    only(7)?.part === 'backdrop' && only(7)?.when.length === 0
  );
  report.check(
    'the props it used to live in are gone',
    Object.values(doc.nodes).every((node) =>
      RETIRED_PROPS.every((prop) => node.props[prop] === undefined)
    )
  );
  report.check(
    'and so is the states record',
    Object.values(doc.nodes).every((node) => node.states === undefined)
  );

  // Running it twice is not a hypothetical: the version is stamped by the
  // same function, so anything that reads a half-migrated document — a
  // collaborator's patch arriving mid-load — goes through here again.
  const again = migrateDocument(JSON.parse(JSON.stringify(doc)));
  report.check(
    'running it a second time changes nothing',
    JSON.stringify(again) === JSON.stringify(doc)
  );
}

/* --------------------------------------------------------------------------
 * Data conditions
 *
 * The gate for stage 3 is that the state engine is not modified, which is a
 * claim about generated output — so it is checked against generated output.
 * A data condition must compile to the same shape a state condition does, at
 * the same weight, and must drive the same expansion into elements.
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * What reaches a published file
 *
 * Two things the templates cannot check, because they have no components and
 * name no states: that a page carries only the component styles it renders,
 * and that the only attributes on it are ones something reads.
 * ----------------------------------------------------------------------- */

report.group('a published page carries only what it uses');

{
  /** A document with two components, one of them placed on the page. */
  const withComponents = () => {
    const doc = createEmptyDocument('Components');
    const page = doc.pages[0];

    const used = buildTree(
      { type: 'frame', name: 'Used master', styles: { backgroundColor: '#abcdef' } },
      doc.nodes
    );
    const spare = buildTree(
      { type: 'frame', name: 'Spare master', styles: { backgroundColor: '#fedcba' } },
      doc.nodes
    );
    doc.components = [
      { id: 'c-used', name: 'Used', rootNodeId: used.rootId, createdAt: 0 },
      { id: 'c-spare', name: 'Spare', rootNodeId: spare.rootId, createdAt: 0 },
    ];

    const instance = buildTree(
      { type: 'instance', name: 'An instance', props: { componentId: 'c-used' } },
      doc.nodes
    );
    doc.nodes[instance.rootId].parentId = page.rootNodeId;
    doc.nodes[page.rootNodeId].children.push(instance.rootId);
    return { doc, page };
  };

  const { doc, page } = withComponents();
  const html = renderPage(doc, page, {});

  report.check(
    'the styles of a component it places are in the page',
    html.includes('#abcdef'),
    html.includes('#abcdef') ? 'present' : 'missing'
  );
  report.check(
    'and the styles of one it does not place are not',
    !html.includes('#fedcba'),
    html.includes('#fedcba') ? 'every page pays for every component' : 'left out'
  );

  /*
   * Every `data-` attribute on a published page has to be read by something —
   * the runtime, or the generated CSS. Two were written here for a while that
   * were read by neither, which costs bytes on every conditional element and
   * makes the next person maintain a thing that does nothing.
   */
  const READ = new Set([
    'data-cre8-root', // the reset's scope
    'data-cre8-switch', // the group, read by the runtime and every state selector
    'data-cre8-value', //   its current value
    'data-cre8-set', // a control, read by the click handler
    'data-cre8-quiet', //   and by the part that decides what to announce
    'data-cre8-tabs', // upgrades a group to a tab set
    'data-cre8-case', // which value an element answers to, for tab pairing
    'data-cre8-not', //   and whether it answers by disappearing
    'data-cre8-data', // the visit, read by every data selector
  ]);

  const switched = buildTree({
    type: 'frame',
    name: 'Group',
    props: { switchKey: 'plan', switchDefault: 'free', switchRole: 'tabs' },
    children: [
      { type: 'button', name: 'Pro', props: { label: 'Pro', switchSet: 'pro' } },
      switchCaseSpec('pro', { type: 'text', name: 'Panel', props: { text: 'Pro things' } }),
      switchCaseSpec('free', { type: 'text', name: 'Other', props: { text: 'Free things' } }, 'plan'),
    ],
  }, doc.nodes);
  doc.nodes[switched.rootId].parentId = page.rootNodeId;
  doc.nodes[page.rootNodeId].children.push(switched.rootId);

  const wired = renderPage(doc, page, {});
  const shipped = [...new Set([...wired.matchAll(/\sdata-[a-z0-9-]+/g)].map((m) => m[0].trim()))];
  const unread = shipped.filter((name) => !READ.has(name));
  report.check(
    'every data- attribute on the page is one something reads',
    unread.length === 0,
    unread.length ? unread.join(' ') : `${shipped.length} attributes, all read`
  );

  // A condition naming a state explicitly reaches past the group it sits in,
  // so calling it a case of that group would let a tab set adopt it.
  report.check(
    'a condition on a state further up does not advertise itself as a case',
    // On an element, not in the script: the runtime names the attribute in a
    // selector of its own, and counting that would report one case too many.
    (wired.match(/\sdata-cre8-case=/g) ?? []).length === 1,
    `${(wired.match(/\sdata-cre8-case=/g) ?? []).length} cases on elements, expected 1`
  );
}

report.group('a condition on the visit compiles like one on a state');

{
  const data = (source, op, values, extra = {}) => ({
    id: `d-${source}`,
    when: [{ kind: 'data', source, op, values }],
    apply: {},
    ...extra,
  });

  const compile = (rules, props = {}) => {
    const { nodes } = buildTree({ type: 'frame', name: 'Root', props, children: [
      { type: 'text', name: 'T', props: { text: 'base' }, rules },
    ] });
    return generateNodeCss(nodes, { mode: 'media' });
  };

  const styling = compile([data('time', 'is', ['night'], { apply: { color: 'red' } })]);
  report.check(
    'it hangs off the document element rather than a group it has to find',
    styling.includes(':where(:is([data-cre8-data~="time:night"]))'),
    /:where\([^{]*data-cre8-data[^{]*/.exec(styling)?.[0]?.trim() ?? 'no rule'
  );
  report.check(
    'and weighs the same as everything else, so order is still precedence',
    /^\s*\.c-[a-z0-9]+$/.test(withoutWhere(selectorOf(styling, 'data-cre8-data'))),
    withoutWhere(selectorOf(styling, 'data-cre8-data'))
  );

  const negated = compile([data('time', 'isNot', ['night'], { apply: { color: 'red' } })]);
  report.check(
    '“isn’t” is one :not(:is()), the same as a state’s',
    negated.includes(':where(:not(:is([data-cre8-data~="time:night"])))')
  );

  const many = compile([data('time', 'is', ['evening', 'night'], { apply: { color: 'red' } })]);
  report.check(
    'and several values are one :is(), so two of them do not out-rank one',
    many.includes(':is([data-cre8-data~="time:evening"],[data-cre8-data~="time:night"])')
  );

  const param = compile([data('query.ref', 'is', ['acme'], { apply: { color: 'red' } })]);
  report.check(
    'a link parameter is a source like any other',
    param.includes('[data-cre8-data~="query.ref:acme"]')
  );

  // The real proof of the layering: a data condition drives the *stage 2*
  // expansion with nothing added for it. If this works, the two stages are
  // genuinely one mechanism rather than two that resemble each other.
  const expanded = compile([data('time', 'is', ['night'], { set: { text: 'closed' } })]);
  report.check(
    'and it expands content into elements, exactly as a switch value does',
    expanded.includes(':where(:is([data-cre8-data~="time:night"])) .c-') &&
      expanded.includes(':where(:not(:is([data-cre8-data~="time:night"]))) .c-'),
    'both halves of the pair'
  );

  // A source nothing on the page mentions must not appear anywhere, or every
  // site would carry a resolver for conditions it does not have.
  report.check(
    'a page with no data conditions generates nothing about data',
    !compile([]).includes('data-cre8-data')
  );
}

/* --------------------------------------------------------------------------
 * Output size
 *
 * Two transforms make the published stylesheet about half the size it was, and
 * both are the kind that work until the day they quietly do not: one merges
 * rules, which is only safe where nothing can be reordered relative to
 * something it overlaps, and the other rewrites declarations, which is only
 * safe where all four sides are present. So both are checked for the saving
 * *and* for the case they must refuse.
 * ----------------------------------------------------------------------- */

report.group('the published stylesheet earns its size');

{
  const compile = (spec) => {
    const { nodes } = buildTree(spec);
    return generateNodeCss(nodes, { mode: 'media' });
  };
  const twins = (n, styles) => ({
    type: 'frame',
    name: 'Root',
    children: Array.from({ length: n }, (_, i) => ({ type: 'frame', name: `C${i}`, styles })),
  });

  const identical = compile(twins(6, { color: 'var(--c-text)', fontSize: '14px' }));
  report.check(
    'nodes styled identically share one rule instead of six',
    (identical.match(/color: var\(--c-text\)/g) ?? []).length === 1,
    `${(identical.match(/color: var\(--c-text\)/g) ?? []).length} copies of the declarations`
  );
  const merged = identical.split('\n').find((line) => line.includes('color'))
    ? (identical.match(/^([^{\n]*)\{[^}]*color: var\(--c-text\)/m) ?? [])[1]
    : '';
  report.check(
    'and every one of them is still named by it',
    (merged?.match(/\.c-[a-z0-9]+/g) ?? []).length === 6,
    `${(merged?.match(/\.c-[a-z0-9]+/g) ?? []).length} selectors on the shared rule`
  );

  // The rule that keeps merging honest. Two nodes share a body in the base
  // layer *and* one of them has a conditional rule with that same body. The
  // conditional one must not be hoisted up to join them: it sits after the
  // base layer because that is what decides which of them wins.
  const withRule = compile({
    type: 'frame',
    name: 'Root',
    children: [
      { type: 'frame', name: 'A', styles: { color: 'red' } },
      {
        type: 'frame',
        name: 'B',
        styles: { color: 'red' },
        rules: [{ id: 'h', when: [{ kind: 'pointer', pseudo: 'hover' }], apply: { color: 'red' } }],
      },
    ],
  });
  const baseBlock = withRule.split('\n\n')[0] ?? '';
  report.check(
    'a conditional rule is never merged into the base layer, whatever it says',
    !baseBlock.includes(':hover') && withRule.includes(':hover'),
    baseBlock.includes(':hover') ? 'hoisted' : 'left where it was'
  );

  const sides = compile(
    twins(1, {
      paddingTop: '10px',
      paddingRight: '20px',
      paddingBottom: '10px',
      paddingLeft: '20px',
    })
  );
  report.check(
    'four sides of padding come out as one declaration',
    sides.includes('padding: 10px 20px') && !sides.includes('padding-top'),
    /padding[^;]*/.exec(sides)?.[0] ?? 'none'
  );

  // Margin rather than padding: a frame ships with padding on all four sides,
  // so a fixture that set three of them would still have four and would prove
  // the opposite of what it claims.
  const three = compile(twins(1, { marginTop: '10px', marginRight: '20px', marginBottom: '10px' }));
  report.check(
    'three of them do not, because a shorthand would invent the fourth',
    three.includes('margin-top') && !/margin: /.test(three),
    /margin: /.test(three) ? 'collapsed anyway' : 'left as longhands'
  );

  const elliptical = compile(
    twins(1, {
      borderTopLeftRadius: '10px 20px',
      borderTopRightRadius: '10px 20px',
      borderBottomRightRadius: '10px 20px',
      borderBottomLeftRadius: '10px 20px',
    })
  );
  report.check(
    'and an elliptical corner is left alone, since folding four would reshape it',
    elliptical.includes('border-top-left-radius') && !/border-radius: /.test(elliptical),
    /border-radius: /.test(elliptical) ? 'collapsed a two-value corner' : 'left as longhands'
  );
}

{
  // The shape check, stated on its own: a document that lies about its
  // version must still be converted, or the field's history becomes a bug.
  const lying = migrateDocument({
    version: 2,
    nodes: { a: { id: 'a', props: { whenIs: 'annual' } } },
  });
  report.check(
    'a document claiming to be current is converted on its shape',
    lying.nodes.a.rules?.length === 1 && lying.nodes.a.props.whenIs === undefined
  );
}

{
  /*
   * Collection *shapes* travel with the document, because a field list is a
   * design decision — versioned, undone and exported with everything else.
   * The rows they describe do not: they live in D1, and a document that
   * carried thousands of them would stop fitting in IndexedDB and stop
   * travelling through the collaboration socket on every keystroke.
   */
  const collections = [
    { id: 'posts', name: 'Posts', slugField: 'title', fields: [{ key: 'title', label: 'Title', type: 'text' }] },
  ];
  const loaded = hydrateDocument({ collections });
  report.check(
    'a collection’s shape survives loading',
    loaded.collections?.[0]?.fields?.[0]?.key === 'title',
    JSON.stringify(loaded.collections?.[0]?.fields ?? null)
  );
  report.check(
    'and a document with none does not grow an empty list',
    hydrateDocument({}).collections === undefined,
    JSON.stringify(hydrateDocument({}).collections ?? null)
  );

  /*
   * `repeat` and `bind` are node fields, and every stored document goes
   * through `hydrateDocument` on the way in — which normalises nodes field by
   * field. A normaliser that rebuilt a node instead of patching it would drop
   * these two silently, and the symptom would be a designer's bound list
   * turning back into placeholder copy on reload.
   */
  const bound = hydrateDocument({
    nodes: {
      a: {
        id: 'a',
        type: 'stack',
        name: 'Feed',
        parentId: null,
        children: [],
        props: {},
        styles: {},
        meta: {},
        repeat: { collection: 'posts', limit: 3 },
      },
      b: { id: 'b', type: 'text', name: 'T', props: {}, bind: { text: 'title' } },
    },
  });
  report.check(
    'a repeater survives being loaded',
    bound.nodes.a.repeat?.collection === 'posts' && bound.nodes.a.repeat?.limit === 3,
    JSON.stringify(bound.nodes.a.repeat ?? null)
  );
  report.check(
    'and so does a binding',
    bound.nodes.b.bind?.text === 'title',
    JSON.stringify(bound.nodes.b.bind ?? null)
  );
}

/* --------------------------------------------------------------------------
 * The repeater
 *
 * D2's gate has three halves, and the third is the one that would kill the
 * idea if it were false:
 *
 *   > A bound list renders identically on canvas and published, **with no
 *   > script**, and **the stylesheet does not grow by a single rule** as
 *   > records are added.
 *
 * The canvas half is checked in the browser, by `tests/render/repeat.mjs`,
 * because it needs a canvas. The other two are properties of a generated file
 * and are checked here — against the file, not against a description of it.
 *
 * The rest of this section is the behaviour the two renderers share, checked
 * once at the point where it is observable: which rows appear, in what order,
 * and what a record is allowed to overwrite.
 * ----------------------------------------------------------------------- */

report.group('a bound list publishes as elements');

{
  const row = (id, data, extra = {}) => ({
    id,
    collectionId: 'posts',
    position: 0,
    published: true,
    data,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  });

  const POSTS = [
    row('r1', { title: 'Second', tag: 'news' }, { position: 1 }),
    row('r2', { title: 'First', tag: 'news' }, { position: 0 }),
    row('r3', { title: 'Third', tag: 'guide' }, { position: 2 }),
    row('r4', { title: 'Draft', tag: 'news' }, { position: 3, published: false }),
  ];

  /** A page holding one repeater over `posts`, whose card shows the title. */
  const blog = (repeat, card) => {
    const doc = createEmptyDocument('Blog');
    const page = doc.pages[0];
    const list = buildTree(
      {
        type: 'grid',
        name: 'Posts',
        repeat,
        children: [
          {
            type: 'frame',
            name: 'Card',
            styles: { backgroundColor: '#abcdef' },
            children: [card ?? { type: 'paragraph', name: 'Title', props: { text: 'Untitled' }, bind: { text: 'title' } }],
          },
        ],
      },
      doc.nodes
    );
    doc.nodes[list.rootId].parentId = page.rootNodeId;
    doc.nodes[page.rootNodeId].children.push(list.rootId);
    return { doc, page };
  };

  /** One document, rendered against whatever rows it is handed. */
  const site = (repeat, card) => {
    const { doc, page } = blog(repeat, card);
    return (records) =>
      renderPage(doc, page, records === null ? {} : { records: { posts: records } });
  };

  const publish = (repeat, records = POSTS, card) => site(repeat, card)(records);

  const bodyOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('</body>'));
  const styleOf = (html) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const titles = (html) => [...bodyOf(html).matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);
  // Counted in the body, never in the stylesheet: the rules for a repeated
  // subtree are emitted whether or not a single row exists, which is the
  // property this section is about and would make a whole-file count read one
  // card on an empty collection.
  const boxes = (html) => (bodyOf(html).match(/<div[^>]*>/g) ?? []).length;

  const plain = publish({ collection: 'posts' });

  report.check(
    'one element per published record, in the order the collection is in',
    titles(plain).join(' › ') === 'First › Second › Third',
    titles(plain).join(' › ') || 'nothing rendered'
  );
  report.check(
    'and an unpublished record is not on the page at all',
    !plain.includes('Draft'),
    plain.includes('Draft') ? 'a draft was published' : 'left out'
  );

  /*
   * The economy of the whole feature. Every copy of a repeated subtree carries
   * the classes the node already had, because it *is* the same node — so the
   * stylesheet for one row and the stylesheet for two hundred are the same
   * bytes. Variants needed a class each because each could be styled
   * differently; repeats cannot, which is what makes them repeats.
   */
  const feed = site({ collection: 'posts' });
  const one = feed([POSTS[1]]);
  const many = feed(
    Array.from({ length: 200 }, (_, i) => row(`rec-${i}`, { title: `Post ${i}` }, { position: i }))
  );
  report.check(
    'two hundred rows generate exactly the stylesheet one row does',
    styleOf(one) === styleOf(many),
    styleOf(one) === styleOf(many)
      ? `${styleOf(one).length} bytes either way`
      : `${styleOf(one).length} → ${styleOf(many).length} bytes`
  );
  report.check(
    'and all two hundred are really there',
    (many.match(/<p[^>]*>Post \d+<\/p>/g) ?? []).length === 200,
    `${(many.match(/<p[^>]*>Post \d+<\/p>/g) ?? []).length} rows`
  );
  report.check(
    'a bound list ships no script',
    !many.includes('<script'),
    many.includes('<script') ? 'a runtime was added' : 'HTML and CSS only'
  );
  // The rows are in the file as *elements*. Nothing that identifies a record —
  // its id, its collection, its flags — has any business being there, and a
  // record id is the sharpest test of that: it appears nowhere in the design,
  // so if one turns up in the output something serialised the collection.
  report.check(
    'and no copy of the records for a script to have read',
    !many.includes('rec-') && !many.includes('collectionId'),
    /rec-\d+|collectionId/.exec(many)?.[0] ?? 'elements only'
  );

  /* --- Which rows, and in what order ------------------------------------ */

  const filtered = publish({
    collection: 'posts',
    filter: [{ field: 'tag', op: 'is', value: 'guide' }],
  });
  report.check(
    'a filter is applied before anything is rendered',
    titles(filtered).join(' › ') === 'Third',
    titles(filtered).join(' › ') || 'nothing rendered'
  );

  const contains = publish({
    collection: 'posts',
    filter: [{ field: 'title', op: 'has', value: 'IR' }],
  });
  report.check(
    '“contains” reads the prose it is typed against, not a key',
    contains.includes('First') && contains.includes('Third') && !contains.includes('Second'),
    titles(contains).join(' › ') || 'nothing rendered'
  );

  const sorted = publish({ collection: 'posts', sort: { field: 'title', direction: 'desc' } });
  report.check(
    'a sort orders by the field rather than by the collection',
    titles(sorted).join(' › ') === 'Third › Second › First',
    titles(sorted).join(' › ') || 'nothing rendered'
  );

  // Not `localeCompare`: it consults ICU data that differs between a browser
  // and a Worker, and D3's gate is that the two produce the same bytes.
  const tied = publish({ collection: 'posts', sort: { field: 'tag', direction: 'asc' } });
  report.check(
    'records the sort cannot separate fall back to their position, not to chance',
    titles(tied).join(' › ') === 'Third › First › Second',
    titles(tied).join(' › ') || 'nothing rendered'
  );

  const capped = publish({ collection: 'posts', limit: 2 });
  report.check(
    'a limit is a count of elements, not a hint',
    titles(capped).join(' › ') === 'First › Second',
    titles(capped).join(' › ') || 'nothing rendered'
  );

  // Stated as a number in `LIMITS` and enforced where it can be seen. A
  // repeater asked for ten thousand rows publishes five hundred, because the
  // alternative is a designer discovering the ceiling as a slow page.
  const flood = publish(
    { collection: 'posts', limit: 10000 },
    Array.from({ length: 600 }, (_, i) => row(`f${i}`, { title: `Flood ${i}` }, { position: i }))
  );
  report.check(
    'and one past the ceiling is clamped rather than honoured',
    titles(flood).length === 500,
    `${titles(flood).length} rows, expected 500`
  );

  /* --- What a record may overwrite -------------------------------------- */

  const partial = publish({ collection: 'posts' }, [row('r5', { tag: 'news' })]);
  report.check(
    'a field the record does not carry leaves the design-time copy alone',
    titles(partial).join('') === 'Untitled',
    titles(partial).join('') || 'nothing rendered'
  );
  const emptied = publish({ collection: 'posts' }, [row('r6', { title: '' })]);
  report.check(
    'but a field it carries empty really is empty — the record has said',
    titles(emptied).join('') === '',
    titles(emptied).join('') || '(empty)'
  );

  /*
   * `level` rather than something like `switchKey`, and the difference matters:
   * a check has to be able to fail. The switch attributes are read off the
   * node, so binding one of those would be refused by code that has nothing to
   * do with binding and the check would pass for the wrong reason. A heading's
   * level is read off the *variant's* props — the same object `bind` writes
   * into — so this really is `isSettable` doing the refusing.
   */
  const structural = publish({ collection: 'posts' }, [row('r8', { title: 'First', rank: 1 })], {
    type: 'heading',
    name: 'Title',
    props: { text: 'Untitled', level: 3 },
    bind: { text: 'title', level: 'rank' },
  });
  report.check(
    'a record cannot bind structure, only content',
    structural.includes('<h3') && !structural.includes('<h1'),
    /<h\d/.exec(structural)?.[0] ?? 'no heading rendered'
  );

  // A `set` from a condition has to beat the record: "when out of stock, say
  // Sold out" is a deliberate exception to what the row says, and it is the
  // documented order — base → bind → set — read left to right.
  const overridden = publish({ collection: 'posts' }, [POSTS[1]], {
    type: 'paragraph',
    name: 'Title',
    props: { text: 'Untitled' },
    bind: { text: 'title' },
    rules: [
      {
        id: 'night',
        when: [{ kind: 'data', source: 'time', op: 'is', values: ['night'] }],
        apply: {},
        set: { text: 'Closed for the night' },
      },
    ],
  });
  report.check(
    'a condition still overrides what the record says',
    overridden.includes('>Closed for the night<') && overridden.includes('>First<'),
    'both alternatives in the file'
  );

  // The image case, which is the one that is wrong in a way nobody notices:
  // `srcset` outranks `src`, so a bound picture with the uploaded one's ladder
  // still attached shows the uploaded one.
  const swapped = publish({ collection: 'posts' }, [row('r7', { cover: '/cover.webp' })], {
    type: 'image',
    name: 'Cover',
    props: {
      src: '/placeholder.webp',
      srcset: '/placeholder-480.webp 480w, /placeholder-960.webp 960w',
      width: 960,
      height: 540,
      alt: 'A post cover',
    },
    bind: { src: 'cover' },
  });
  report.check(
    'binding an image drops the ladder the uploaded one came with',
    swapped.includes('src="/cover.webp"') && !swapped.includes('srcset'),
    swapped.includes('srcset') ? 'stale srcset outranks the bound src' : 'src only'
  );

  /* --- Nothing to show --------------------------------------------------- */

  report.check(
    'an empty collection publishes an empty list, not an invented row',
    titles(feed([])).length === 0,
    `${titles(feed([])).length} rows`
  );
  report.check(
    'and so does a page published with no records loaded at all',
    titles(feed(null)).length === 0,
    `${titles(feed(null)).length} rows`
  );
  report.check(
    'a repeater pointing at a collection that has gone renders nothing',
    titles(publish({ collection: 'deleted' })).length === 0,
    `${titles(publish({ collection: 'deleted' })).length} rows`
  );

  /*
   * The repeating node itself is emitted once — the grid stays a grid, and it
   * is what is inside it that multiplies. Counted structurally: the body holds
   * the page root, the grid, and one card per row, so the total moves by
   * exactly one as a record is added and by nothing else.
   */
  report.check(
    'the repeating element is drawn once however many rows it holds',
    boxes(feed([])) === 2 && boxes(one) === 3 && boxes(plain) === 5,
    `${boxes(feed([]))} / ${boxes(one)} / ${boxes(plain)} boxes for 0 / 1 / 3 rows`
  );
}

/* --------------------------------------------------------------------------
 * The Worker's platform
 *
 * D3 puts the renderer inside the Worker, which means `src/lib` is now
 * type-checked twice: once by the app's compiler, with the DOM, and once by
 * the Worker's, without it. The second one is load-bearing and easy to
 * silence.
 *
 * The temptation, the first time a shared module fails on `document`, is to
 * add `"DOM"` to the Worker's `lib`. It compiles. It also loses: the DOM lib
 * beats `@cloudflare/workers-types`, so `Request`, `Response`, `FormData` and
 * `caches` quietly become the browser's — the Worker would then be checked
 * against a platform it is not running on, and the failures land at runtime.
 *
 * Cheap to check, and the check is the only thing standing between a tired
 * afternoon and that outcome.
 * ----------------------------------------------------------------------- */

report.group('the Worker is checked against the platform it runs on');

{
  const read = (file) =>
    readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
      // The configs are JSONC; comments would break the parse and are not
      // what any of this is about.
      .replace(/^\s*\/\/.*$/gm, '');

  for (const config of ['workers/tsconfig.json', 'workers/sites/tsconfig.json']) {
    const parsed = JSON.parse(read(config));
    const libs = (parsed.compilerOptions?.lib ?? []).map((l) => String(l).toLowerCase());
    report.check(
      `${config} does not pull in the DOM`,
      !libs.some((l) => l.startsWith('dom')),
      libs.join(', ') || '(none)'
    );
    report.check(
      `${config} is typed against the Workers runtime`,
      (parsed.compilerOptions?.types ?? []).some((t) => String(t).includes('workers-types')),
      (parsed.compilerOptions?.types ?? []).join(', ') || '(none)'
    );
  }

  /*
   * One crossing, so "does the Worker depend on the app?" stays a question
   * with a one-file answer. Everything imported over that line is bundled into
   * every Worker invocation, which is a cost worth having to look at.
   */
  const crossings = [];
  const walkDir = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name.endsWith('.ts') && /from '\.\.[./]*\/src\//.test(readFileSync(full, 'utf8'))) {
        crossings.push(path.relative(ROOT, full));
      }
    }
  };
  walkDir(path.join(ROOT, 'workers'));
  report.check(
    'exactly one Worker file reaches into the app’s source',
    crossings.length === 1 && crossings[0] === path.join('workers', 'src', 'lib', 'render.ts'),
    crossings.join(', ') || 'none — has the renderer stopped being shared?'
  );
}

/* --------------------------------------------------------------------------
 * Routes
 *
 * D4's gate:
 *
 *   > A blog of thirty posts publishes thirty files plus a paginated index,
 *   > every one reachable and every one in the sitemap.
 *
 * All of that is a property of generated files, so it is checked against
 * generated files. The browser half — that the URLs actually serve — is in
 * `tests/render/routes.mjs`; what is here is the routing itself, which is
 * where the arithmetic lives and where an off-by-one hides.
 * ----------------------------------------------------------------------- */

/*
 * The fixture is out here rather than inside the block because D6 reuses it:
 * "what does a republish write" is a question about two renders of the same
 * blog, and building a second, slightly different blog to ask it would make
 * the answer about the fixture.
 */
const row = (id, title, position) => ({
  id,
  collectionId: 'posts',
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  position,
  published: true,
  data: { title, blurb: `About ${title}` },
  createdAt: 0,
  updatedAt: 0,
});

const POSTS = Array.from({ length: 30 }, (_, i) => row(`p${i}`, `Post ${i + 1}`, i));

/**
 * A blog: an index that paginates ten at a time, and a detail page beside
 * it sharing the slug — the way a folder holds both an index and its
 * contents.
 */
const blog = ({ paginate = 10, dynamic = true } = {}) => {
  const doc = createEmptyDocument('Blog');
  const home = doc.pages[0];

  const index = buildTree(
    {
      type: 'stack',
      name: 'Feed',
      repeat: { collection: 'posts', paginate },
      children: [
        {
          type: 'link',
          name: 'Card',
          props: { text: 'A post', href: 'page:pg-post' },
          bind: { text: 'title' },
        },
      ],
    },
    doc.nodes
  );
  doc.nodes[index.rootId].parentId = home.rootNodeId;
  doc.nodes[home.rootNodeId].children.push(index.rootId);

  // The two pager links, which is what `series:` exists for.
  const pager = buildTree(
    {
      type: 'stack',
      name: 'Pager',
      children: [
        { type: 'link', name: 'Older', props: { text: 'Older', href: 'series:next' } },
        { type: 'link', name: 'Newer', props: { text: 'Newer', href: 'series:prev' } },
      ],
    },
    doc.nodes
  );
  doc.nodes[pager.rootId].parentId = home.rootNodeId;
  doc.nodes[home.rootNodeId].children.push(pager.rootId);

  if (dynamic) {
    const detail = buildTree(
      {
        type: 'page',
        name: 'Post',
        children: [
          { type: 'heading', name: 'Title', props: { text: 'A title' }, bind: { text: 'title' } },
          { type: 'link', name: 'Home', props: { text: 'Home', href: `page:${home.id}` } },
        ],
      },
      doc.nodes
    );
    doc.pages.push({
      id: 'pg-post',
      name: 'Post',
      slug: 'blog',
      rootNodeId: detail.rootId,
      order: 1,
      meta: {},
      dynamic: { collection: 'posts' },
    });
  }
  return doc;
};

report.group('a collection becomes pages');

{
  const site = generateSite(blog(), { records: { posts: POSTS } });
  const paths = site.files.map((f) => f.path);
  const html = (path) => site.files.find((f) => f.path === path)?.contents ?? '';

  report.check(
    'thirty posts become thirty files',
    POSTS.every((r) => paths.includes(`blog/${r.slug}/index.html`)),
    `${paths.filter((p) => p.startsWith('blog/') && !/^blog\/\d+\//.test(p)).length} record pages`
  );
  report.check(
    'and the index becomes three, ten at a time',
    paths.includes('index.html') && paths.includes('2/index.html') && paths.includes('3/index.html'),
    paths.filter((p) => p === 'index.html' || /^\d+\/index\.html$/.test(p)).join(' ')
  );
  report.check(
    'page one keeps the page’s own address rather than inventing /1/',
    !paths.includes('1/index.html'),
    paths.includes('1/index.html') ? 'a second URL for the same content' : 'no /1/'
  );

  const titles = (page) => [...html(page).matchAll(/>Post (\d+)</g)].map((m) => Number(m[1]));
  report.check(
    'each index file carries its own ten, in order and without overlap',
    titles('index.html').join() === '1,2,3,4,5,6,7,8,9,10' &&
      titles('2/index.html').join() === '11,12,13,14,15,16,17,18,19,20' &&
      titles('3/index.html').join() === '21,22,23,24,25,26,27,28,29,30',
    `${titles('index.html').length} / ${titles('2/index.html').length} / ${titles('3/index.html').length}`
  );

  /* --- Reachable ------------------------------------------------------- */

  report.check(
    'a card links to its own record’s page, not to a template',
    html('index.html').includes('href="blog/post-1/"') &&
      html('index.html').includes('href="blog/post-10/"'),
    /href="blog\/[a-z0-9-]+\/"/.exec(html('index.html'))?.[0] ?? 'no record link'
  );
  report.check(
    'and the link from a record page back home climbs the right number of levels',
    html('blog/post-1/index.html').includes('href="../../"'),
    /href="\.\.[^"]*"/.exec(html('blog/post-1/index.html'))?.[0] ?? 'no link home'
  );
  report.check(
    'a record page binds the record, not the design-time copy',
    html('blog/post-7/index.html').includes('>Post 7<') &&
      !html('blog/post-7/index.html').includes('>A title<'),
    'bound'
  );

  const pager = (page, text) =>
    new RegExp(`<a[^>]*>${text}</a>`).exec(html(page))?.[0] ??
    new RegExp(`<a[^>]*hidden[^>]*>${text}</a>`).exec(html(page))?.[0] ??
    'absent';
  report.check(
    'the first page offers a way on and no way back',
    /href="2\/"/.test(pager('index.html', 'Older')) && /hidden/.test(pager('index.html', 'Newer')),
    `older=${pager('index.html', 'Older')} newer=${pager('index.html', 'Newer')}`
  );
  report.check(
    'the middle page offers both, relative to where it sits',
    /href="\.\.\/3\/"/.test(pager('2/index.html', 'Older')) &&
      /href="\.\.\/"/.test(pager('2/index.html', 'Newer')),
    `older=${pager('2/index.html', 'Older')} newer=${pager('2/index.html', 'Newer')}`
  );
  report.check(
    'and the last offers no way on — hidden rather than pointed at nothing',
    /hidden/.test(pager('3/index.html', 'Older')) && !/href/.test(pager('3/index.html', 'Older')),
    pager('3/index.html', 'Older')
  );
  report.check(
    'the series says so in the head, for a crawler that reads no pager',
    html('2/index.html').includes('<link rel="prev"') &&
      html('2/index.html').includes('<link rel="next"') &&
      !html('index.html').includes('<link rel="prev"'),
    'prev and next where they belong'
  );

  /* --- In the sitemap --------------------------------------------------- */

  const sitemap = html('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  report.check(
    'every generated page is in the sitemap, and nothing else is',
    locs.length === site.pageCount && locs.length === 33,
    `${locs.length} urls for ${site.pageCount} pages`
  );
  report.check(
    'including every record and every slice of the index',
    locs.includes('/blog/post-30/') && locs.includes('/2/') && locs.includes('/3/'),
    locs.slice(0, 4).join(' ')
  );

  /* --- The numbers that must be refused --------------------------------- */

  const tooMany = Array.from({ length: 1200 }, (_, i) => row(`x${i}`, `Extra ${i}`, i));
  let refused = '';
  try {
    generateSite(blog({ paginate: 1000 }), { records: { posts: tooMany } });
  } catch (error) {
    refused = String(error.message);
  }
  report.check(
    'a route past the ceiling is refused, and says what the ceiling is',
    refused.includes('more than 1000') && refused.includes('Post'),
    refused || 'it wrote them'
  );
  // The clamp a repeater lives under is five hundred, and applying it here
  // would have capped a blog at five hundred posts with no error at all —
  // the worst kind of limit, since nothing tells you it happened.
  const nineHundred = Array.from({ length: 900 }, (_, i) => row(`n${i}`, `Nine ${i}`, i));
  report.check(
    'and a route below it publishes every record, not the repeater’s five hundred',
    generateSite(blog({ paginate: 0 }), { records: { posts: nineHundred } }).files.filter((f) =>
      /^blog\/[a-z0-9-]+\/index\.html$/.test(f.path)
    ).length === 900,
    `${generateSite(blog({ paginate: 0 }), { records: { posts: nineHundred } }).files.filter((f) => /^blog\/[a-z0-9-]+\/index\.html$/.test(f.path)).length} record pages`
  );

  let collided = '';
  try {
    // A record slugged `2` lands exactly where the index's second page goes.
    const doc = blog({ paginate: 1 });
    doc.pages[1].slug = '';
    generateSite(doc, { records: { posts: [row('a', '2', 0), row('b', 'Other', 1)] } });
  } catch (error) {
    collided = String(error.message);
  }
  report.check(
    'and two pages wanting one URL is refused rather than raced',
    collided.includes('/2/index.html'),
    collided || 'one of them silently won'
  );

  /* --- Nothing changes for a site with neither -------------------------- */

  const plain = generateSite(blog({ paginate: 0, dynamic: false }), { records: { posts: POSTS } });
  report.check(
    'a page with no pagination and no route is still exactly one file',
    plain.files.filter((f) => f.path.endsWith('.html')).length === 1 && plain.pageCount === 1,
    `${plain.pageCount} pages`
  );
}

/* --------------------------------------------------------------------------
 * Republishing
 *
 * D6's gate is two sentences, and only one of them needs a browser:
 *
 *   > Editing a record updates the live site with no manual publish, and
 *   > republishing an unchanged collection writes nothing.
 *
 * The second half rests on a premise nothing else in this suite states: that
 * the generator is a *function* of the document and the records. If it were
 * not — one Map iterated in insertion order here and hash order there, one
 * timestamp, one id from a counter — every file would hash differently every
 * time, the manifest would never match, and "writes nothing" would quietly
 * mean "writes everything" while the diff code looked perfectly correct.
 *
 * So this checks the premise directly, then checks the arithmetic that rests
 * on it: which files a change moves, and which it leaves alone. The Worker's
 * side of it — that the unmoved ones are genuinely not written to R2 — is in
 * `tests/render/republish.mjs`, because only a running Worker can answer that.
 * ----------------------------------------------------------------------- */

report.group('a republish writes only what moved');

{
  /*
   * One document, rendered many times. Built once rather than per render, and
   * the first version of this was not — which made every check below fail at
   * once, because `buildTree` mints fresh node ids and node ids are in the
   * class names. A useful reminder of what the premise is actually about: the
   * bytes are a function of the *document*, and two documents that look the
   * same on screen are not the same document.
   */
  const DOC = blog();
  const render = (records, doc = DOC) => {
    const site = generateSite(doc, { records: { posts: records } });
    return new Map(site.files.map((f) => [f.path, f.contents]));
  };

  /** Paths whose bytes differ, in either direction. */
  const moved = (before, after) => {
    const paths = new Set([...before.keys(), ...after.keys()]);
    return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
  };

  const base = render(POSTS);

  /* --- The premise ------------------------------------------------------- */

  report.check(
    'the same document and the same records produce the same bytes',
    moved(base, render(POSTS)).length === 0,
    moved(base, render(POSTS)).join(', ') || `${base.size} files, all identical`
  );

  /*
   * And through the trip the Worker actually makes. A published document is
   * read out of D1 as text, parsed and hydrated — so if hydration invents
   * anything, or if any part of the render reflects object identity rather
   * than value, the server's bytes would differ from these on every publish.
   */
  const roundTripped = hydrateDocument(JSON.parse(JSON.stringify(DOC)));
  report.check(
    'and so does the same document after a trip through JSON and hydration',
    moved(base, render(POSTS, roundTripped)).length === 0,
    moved(base, render(POSTS, roundTripped)).join(', ') || 'identical'
  );

  /* --- What one edit costs ----------------------------------------------- */

  /*
   * Post 7 is on the first page of the index and on its own page, and nowhere
   * else. Two files out of thirty-three, which is the whole argument for the
   * manifest: without it this is thirty-three writes.
   */
  const edited = POSTS.map((r) => (r.id === 'p6' ? { ...r, data: { ...r.data, title: 'Rewritten' } } : r));
  report.check(
    'editing one record moves exactly the files that show it',
    moved(base, render(edited)).join() === 'blog/post-7/index.html,index.html',
    moved(base, render(edited)).join(', ') || 'nothing moved'
  );
  report.check(
    'and leaves the sitemap alone, because no URL changed',
    base.get('sitemap.xml') === render(edited).get('sitemap.xml'),
    'sitemap untouched'
  );

  /*
   * A slug is a URL, so renaming the file is the point rather than a side
   * effect — and the old one has to be taken away, or the post is on the
   * internet twice.
   */
  const reslugged = POSTS.map((r) => (r.id === 'p6' ? { ...r, slug: 'seven' } : r));
  const after = render(reslugged);
  report.check(
    'changing a slug adds the new page and abandons the old one',
    after.has('blog/seven/index.html') && !after.has('blog/post-7/index.html'),
    [...moved(base, after)].join(', ')
  );

  /* --- What a deletion costs --------------------------------------------- */

  const minusOne = render(POSTS.filter((r) => r.id !== 'p29'));
  report.check(
    'deleting a record takes its page off the site',
    [...base.keys()].filter((path) => !minusOne.has(path)).join() === 'blog/post-30/index.html',
    [...base.keys()].filter((path) => !minusOne.has(path)).join(', ') || 'nothing removed'
  );
  report.check(
    'and does not disturb the twenty-nine that remain',
    moved(base, minusOne).filter((p) => /^blog\//.test(p)).join() === 'blog/post-30/index.html',
    moved(base, minusOne).join(', ')
  );

  /*
   * Ten deletions take a whole slice of the index with them. That one is
   * easier to miss than a record page and worse to leave behind: `/3/` would
   * keep serving ten posts that are not in the collection any more, with the
   * pager on `/2/` no longer pointing at it, so nothing would ever reveal it.
   */
  const minusTen = render(POSTS.slice(0, 20));
  report.check(
    'and dropping enough records takes a page of the index with them',
    [...base.keys()].filter((path) => !minusTen.has(path)).includes('3/index.html'),
    [...base.keys()].filter((path) => !minusTen.has(path)).join(', ')
  );

  /* --- What an addition costs -------------------------------------------- */

  /*
   * Four files, and the fourth is the interesting one: `/3/` was the last page
   * of the series, so its "Older" link was hidden and its head carried no
   * `rel=next`. A thirty-first post gives it somewhere to point. Worth writing
   * down because the obvious expectation — "a new post touches the new post's
   * page and the new index slice" — is wrong, and a diff that got it right by
   * accident would be indistinguishable from one that rewrote everything.
   */
  const plusOne = render([...POSTS, row('p30', 'Post 31', 30)]);
  report.check(
    'adding a record writes its page, its slice, and the page that now links on',
    moved(base, plusOne).join() ===
      '3/index.html,4/index.html,blog/post-31/index.html,sitemap.xml',
    moved(base, plusOne).join(', ')
  );
  report.check(
    'and leaves everything it is not on — thirty-three of thirty-five files',
    !moved(base, plusOne).some((path) => ['index.html', '2/index.html'].includes(path)) &&
      base.size - moved(base, plusOne).filter((p) => base.has(p)).length === 33,
    `${base.size - moved(base, plusOne).filter((p) => base.has(p)).length} of ${base.size} untouched`
  );
}

/* --------------------------------------------------------------------------
 * …and the Worker only has one way to do it
 *
 * The manifest is a claim about the contents of a bucket, kept in a different
 * store. It stays true only for as long as every write goes through the code
 * that maintains it — a second `SITES.put` anywhere would put a file on a site
 * that the manifest does not know about, which means it can never be deleted
 * and never be recognised as unchanged.
 *
 * Same shape of argument for the trigger: the site follows a collection only
 * if *every* way of changing that collection says so. A new handler that
 * forgets is not a bug anyone would see; the site would simply stop updating
 * for one kind of edit.
 * ----------------------------------------------------------------------- */

report.group('there is one way to publish and one way to trigger it');

{
  const workerFiles = [];
  const walkWorker = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkWorker(full);
      else if (entry.name.endsWith('.ts')) workerFiles.push(full);
    }
  };
  walkWorker(path.join(ROOT, 'workers', 'src'));

  const writers = workerFiles
    .filter((file) => /\bSITES\.(put|delete)\(/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file))
    .sort();
  report.check(
    'exactly one Worker file writes to the sites bucket',
    writers.length === 1 && writers[0] === path.join('workers', 'src', 'lib', 'publish.ts'),
    writers.join(', ') || 'nothing writes — has publishing moved?'
  );

  const callers = workerFiles
    .filter((file) => /\bpublishSite\(/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file))
    .sort();
  report.check(
    'and it is called from the route and the alarm, and nowhere else',
    callers.join() ===
      [
        path.join('workers', 'src', 'lib', 'publish.ts'),
        path.join('workers', 'src', 'room.ts'),
        path.join('workers', 'src', 'routes', 'projects.ts'),
      ].join(),
    callers.join(', ')
  );

  /*
   * A Durable Object that fetches itself does not make a request, it makes a
   * deadlock — the second call waits for the first to finish and the first is
   * waiting for the second. The alarm publishes, and publishing reads a
   * document, so the temptation is right there.
   */
  const roomSource = readFileSync(path.join(ROOT, 'workers', 'src', 'room.ts'), 'utf8');
  report.check(
    'the room never reaches for its own document through the room',
    !/\b(roomUrl|liveDocument)\b/.test(roomSource) && !/\broom\(this\.env/.test(roomSource),
    /\b(roomUrl|liveDocument)\b/.exec(roomSource)?.[0] ?? 'reads this.doc directly'
  );

  /* --- Every record write says so ---------------------------------------- */

  /**
   * Handlers `recordRoutes` dispatches for a mutating method that never
   * mention `contentChanged`.
   *
   * Read off the dispatch table rather than by looking for SQL: the SQL is in
   * two shared helpers, so a scan for `INSERT` would find `insert()` and clear
   * every handler that calls it.
   */
  const mutatorsMissingPing = (source) => {
    const missing = [];
    for (const [, , name] of source.matchAll(
      /method === '(POST|PUT|DELETE)'\)\s*return (\w+)\(/g
    )) {
      const at = source.indexOf(`function ${name}(`);
      if (at < 0) {
        missing.push(`${name} (not found)`);
        continue;
      }
      const end = source.indexOf('\n}\n', at);
      if (!source.slice(at, end < 0 ? undefined : end).includes('contentChanged')) {
        missing.push(name);
      }
    }
    return missing;
  };

  const recordsSource = readFileSync(
    path.join(ROOT, 'workers', 'src', 'routes', 'records.ts'),
    'utf8'
  );
  const dispatched = [
    ...recordsSource.matchAll(/method === '(POST|PUT|DELETE)'\)\s*return (\w+)\(/g),
  ];
  report.check(
    'every record write tells the room its content moved',
    mutatorsMissingPing(recordsSource).length === 0,
    mutatorsMissingPing(recordsSource).join(', ') || `${dispatched.length} handlers, all reporting`
  );
  report.check(
    'and there were three of them to check',
    dispatched.length === 3,
    dispatched.map((m) => m[2]).join(', ')
  );
  // The rule reads source with a regex, which is a thing that can quietly stop
  // matching. A handler with the call taken out has to be caught.
  report.check(
    'the rule catches a handler that forgot',
    mutatorsMissingPing(
      recordsSource.replace(/await contentChanged\([^)]*\);/, '/* removed */')
    ).length === 1,
    'a missing ping is found'
  );
}

/* --------------------------------------------------------------------------
 * Publish history
 *
 * The claim is narrow and the narrowness is the design:
 *
 *   > A version is a design somebody published. Restoring one re-publishes
 *   > that design against today's records.
 *
 * Which rests on a rule from D6 that is stated nowhere near it: a design
 * change never republishes on its own. If that stopped being true, storing the
 * document on manual publishes only would silently stop capturing every design
 * the site has served — some would reach the internet through an alarm and
 * never be recorded. The two live in different files and nothing connects
 * them, so the connection is made here.
 * ----------------------------------------------------------------------- */

report.group('a version is a design somebody published');

{
  const source = (file) => readFileSync(path.join(ROOT, file), 'utf8');
  const publish = source(path.join('workers', 'src', 'lib', 'publish.ts'));
  const room = source(path.join('workers', 'src', 'room.ts'));
  const history = source(path.join('workers', 'src', 'lib', 'history.ts'));

  /*
   * The premise. The alarm publishes with nobody credited, and the publisher
   * stores a document only when somebody is — so an automatic republish can
   * never create a version, and a design that reached the site only through
   * one would be unrecoverable.
   */
  report.check(
    'the alarm credits nobody, which is what makes an automatic republish not a version',
    /publishedBy:\s*null/.test(room),
    /publishedBy:[^,\n]*/.exec(room)?.[0] ?? 'the alarm names a publisher'
  );
  report.check(
    'and the publisher stores the design only when somebody asked',
    /document:\s*options\.publishedBy\s*\?\s*document\s*:\s*null/.test(publish),
    /document:[^,\n]*/.exec(publish.slice(publish.indexOf('recordDeployment')))?.[0] ?? 'not conditional'
  );

  /*
   * And the rule that makes those two add up to "every design is captured".
   * The trigger fires on record writes; if it ever fired on a document write,
   * a design could go live with no version behind it.
   */
  const records = source(path.join('workers', 'src', 'routes', 'records.ts'));
  const projects = source(path.join('workers', 'src', 'routes', 'projects.ts'));
  report.check(
    'a design change still does not republish itself, which the above depends on',
    /\bcontentChanged\(/.test(records) && !/\bcontentChanged\(/.test(projects),
    /\bcontentChanged\(/.test(projects)
      ? 'saving a document now triggers a republish — versions would be missed'
      : 'records only'
  );

  /* --- Restoring ---------------------------------------------------------- */

  /*
   * A restore has to go through the room. Publishing the old document without
   * writing it back would leave the editor showing the design that was
   * replaced, and the next ordinary save would undo the restore — silently,
   * and for the person who asked for it.
   */
  const restore = projects.slice(projects.indexOf('export async function handleRestoreDeployment'));
  const body = restore.slice(0, restore.indexOf('\n}\n'));
  report.check(
    'restoring writes the design through the room before it publishes',
    body.indexOf('roomUrl(') > 0 && body.indexOf('roomUrl(') < body.indexOf('publishSite('),
    body.indexOf('roomUrl(') < 0 ? 'never reaches the room' : 'room first, publish second'
  );
  report.check(
    'and it republishes rather than writing files of its own',
    /publishSite\(/.test(body) && !/SITES\./.test(body),
    /SITES\./.test(body) ? 'a second writer' : 'one publish path'
  );

  /*
   * Content is not part of a version. The whole seam rests on the restore
   * never touching the records table — a restore that did would take a week of
   * posts down to put a layout back.
   */
  report.check(
    'and nothing about restoring touches a record',
    !/\bFROM records\b|\bDELETE FROM records\b|\bINSERT INTO records\b/.test(history) &&
      !/\brecords\b/.test(body),
    'the records table is not named on the restore path'
  );

  /* --- The listing ------------------------------------------------------- */

  /*
   * The document is the largest column in the database and a listing has no
   * use for it. Selecting it to compute `restorable` would mean reading every
   * stored design to draw a dialog.
   */
  const listing = history.slice(history.indexOf('export async function listDeployments'));
  const query = listing.slice(0, listing.indexOf('.all<'));
  report.check(
    'listing the history never reads a stored design',
    /document IS NOT NULL/.test(query) && !/SELECT[^;]*\bd\.document\b\s*[,\n]/.test(query),
    /d\.document\b\s*,/.test(query) ? 'the listing selects the document' : 'only the one bit it needs'
  );

  /* --- Both ceilings ------------------------------------------------------ */

  /*
   * Two bounds on two different things. Collapsing them would tie how far back
   * you can restore to how much history you can read, and a busy collection
   * republishes often enough that the log would swallow the versions.
   */
  report.check(
    'old designs stop being restorable without the log losing the entry',
    /UPDATE deployments SET document = NULL/.test(history) &&
      /DELETE FROM deployments/.test(history),
    'one ceiling empties the document, the other removes the row'
  );
  const restorable = Number(/const RESTORABLE = (\d+)/.exec(history)?.[1] ?? 0);
  const logged = Number(/const LOGGED = (\d+)/.exec(history)?.[1] ?? 0);
  report.check(
    'and the log outlives the designs in it',
    restorable > 0 && logged > restorable,
    `${restorable} restorable, ${logged} logged`
  );

  /* --- The schema keeps up ------------------------------------------------ */

  /*
   * Columns were added to tables that already exist everywhere, and SQLite
   * cannot add them from `CREATE TABLE IF NOT EXISTS`. What closes that gap is
   * `/api/admin/schema` — so the two places somebody deploying will look have
   * to name it, and it has to be a route rather than a paragraph.
   */
  const schema = source(path.join('workers', 'schema.sql'));
  const readme = source('README.md');
  const router = source(path.join('workers', 'src', 'index.ts'));
  report.check(
    'the upgrade path is written where somebody deploying would look',
    schema.includes('/api/admin/schema') && readme.includes('/api/admin/schema'),
    [schema.includes('/api/admin/schema') ? 'schema.sql' : '', readme.includes('/api/admin/schema') ? 'README' : '']
      .filter(Boolean)
      .join(' and ') || 'neither'
  );
  report.check(
    'and it is a route, not a paragraph',
    /head === 'admin'/.test(router) && /parts\[1\] === 'schema'/.test(router),
    'wired in workers/src/index.ts'
  );
}

/* --------------------------------------------------------------------------
 * Links and buttons hold things
 *
 * They did not, until they did, and the change has one property worth pinning
 * down above all others: **every document that existed before it must render
 * exactly as it did**. That works because both renderers short-circuit on the
 * text prop — a button with no children still emits its label and nothing
 * else. Break that and the regression is silent and total, so it is checked
 * against generated markup rather than against the code that generates it.
 * ----------------------------------------------------------------------- */

report.group('a link can hold a subtree, and an empty one has not changed');

{
  const page = (children) => {
    const doc = createEmptyDocument('Clickable');
    const home = doc.pages[0];
    const built = buildTree(children, doc.nodes);
    doc.nodes[built.rootId].parentId = home.rootNodeId;
    doc.nodes[home.rootNodeId].children.push(built.rootId);
    return doc;
  };

  const htmlOf = (doc) =>
    generateSite(doc).files.find((f) => f.path === 'index.html')?.contents ?? '';

  /* --- The compatibility claim ------------------------------------------- */

  const plain = htmlOf(
    page({ type: 'link', name: 'Plain', props: { text: 'Learn more', href: '#' } })
  );
  report.check(
    'a link with no children still publishes as its label and nothing else',
    /<a[^>]*>Learn more<\/a>/.test(plain),
    /<a[^>]*>[^<]*<\/a>/.exec(plain)?.[0] ?? 'no anchor'
  );

  const button = htmlOf(
    page({ type: 'button', name: 'Plain', props: { label: 'Get started', href: '#' } })
  );
  report.check(
    'and so does a button',
    /<a[^>]*>Get started<\/a>/.test(button),
    /<a[^>]*>[^<]*<\/a>/.exec(button)?.[0] ?? 'no anchor'
  );

  /* --- The new thing ------------------------------------------------------ */

  const card = htmlOf(
    page({
      type: 'link',
      name: 'Card',
      props: { text: 'Ignored once there are children', href: '#' },
      children: [
        { type: 'heading', name: 'Title', props: { text: 'A whole card', level: 3 } },
        { type: 'paragraph', name: 'Body', props: { text: 'Clickable end to end.' } },
      ],
    })
  );
  report.check(
    'a link with children publishes them, inside the anchor',
    /<a[^>]*>.*<h3[^>]*>A whole card<\/h3>.*<\/a>/s.test(card),
    /<a[^>]*>.{0,60}/s.exec(card)?.[0] ?? 'no anchor'
  );
  report.check(
    'and the label it is no longer showing is not published beside them',
    !card.includes('Ignored once there are children'),
    card.includes('Ignored once there are children') ? 'both rendered' : 'children only'
  );

  const icon = htmlOf(
    page({
      type: 'button',
      name: 'Icon button',
      props: { label: 'unused', href: '#' },
      children: [
        { type: 'icon', name: 'Glyph', props: { name: 'arrow-right' } },
        { type: 'text', name: 'Words', props: { text: 'Continue' } },
      ],
    })
  );
  report.check(
    'a button can hold an icon beside its words',
    /<svg/.test(icon) && icon.includes('Continue'),
    /<a[^>]*>.{0,40}/s.exec(icon)?.[0] ?? 'no anchor'
  );

  /* --- What is still refused ---------------------------------------------- */

  /*
   * The parser does not reject a control inside a link — it lifts it out and
   * puts it beside the link, so the canvas and the published page disagree
   * with nothing reporting a problem. Exactly the failure the table rules
   * exist for, which is why this is a rule and not a guideline.
   */
  const refused = ['link', 'button', 'input', 'select', 'textarea', 'checkbox', 'details'];
  const allowed = ['heading', 'paragraph', 'text', 'image', 'icon', 'frame', 'stack', 'grid'];
  report.check(
    'a link refuses every kind of control',
    refused.every((type) => !canContain('link', type)),
    refused.filter((type) => canContain('link', type)).join(', ') || 'all refused'
  );
  report.check(
    'a button refuses them too',
    refused.every((type) => !canContain('button', type)),
    refused.filter((type) => canContain('button', type)).join(', ') || 'all refused'
  );
  report.check(
    'and both take everything that is not one',
    allowed.every((type) => canContain('link', type) && canContain('button', type)),
    allowed.filter((type) => !canContain('link', type)).join(', ') || `${allowed.length} kinds`
  );
  // The rule is a single condition over a flag that is easy to forget on a new
  // element type, so it is worth knowing it can still fire.
  report.check(
    'the refusal is real, not a vacuous truth about types nobody nests',
    canContain('frame', 'button') && canContain('stack', 'link'),
    'an ordinary container still takes a control'
  );
}

/* --------------------------------------------------------------------------
 * A corrupt document still opens
 *
 * `hydrateDocument` runs over every project every time one is opened, and it
 * has always repaired the obvious holes — a node with no `children`, no
 * `props`, no `styles`. `rules` was the one it did not, and the difference
 * mattered more than the others: `variantsOf` reaches straight for
 * `rule.when`, so a node whose rules arrived as a string threw during render,
 * and a thrown render used to take the whole editor with it.
 *
 * Repaired rather than refused. Half a document on screen is worth more than
 * an explanation of why there is none, and a rule nobody can read was not
 * going to draw anything anyway.
 * ----------------------------------------------------------------------- */

report.group('a document with damage in it still draws');

{
  const withNode = (extra) => {
    const doc = createEmptyDocument('Damaged');
    const home = doc.pages[0];
    const id = 'dmg0node00';
    doc.nodes[id] = {
      id,
      type: 'heading',
      name: 'Heading',
      parentId: home.rootNodeId,
      children: [],
      props: { text: 'Still here', level: 2 },
      styles: { desktop: { fontSize: '24px' } },
      meta: {},
      ...extra,
    };
    doc.nodes[home.rootNodeId].children.push(id);
    return JSON.parse(JSON.stringify(doc));
  };

  const survives = (extra) => {
    try {
      const doc = hydrateDocument(withNode(extra));
      const html = generateSite(doc).files.find((f) => f.path === 'index.html')?.contents ?? '';
      return html.includes('Still here') ? 'draws' : 'drew nothing';
    } catch (error) {
      return `threw: ${error.message}`;
    }
  };

  const damage = {
    'no children': { children: null },
    'no props': { props: null },
    'no styles': { styles: null },
    'no meta': { meta: undefined },
    'rules as a string': { rules: 'hover' },
    'rules as a number': { rules: 7 },
    'a null among the rules': { rules: [null] },
    'a rule with no condition list': { rules: [{ id: 'r', apply: { color: 'red' } }] },
  };

  /*
   * Two different claims, and conflating them cost a false failure: every
   * shape must render *without throwing*, and most must still show their text.
   * A node whose `props` arrived null has genuinely lost its text — there is
   * nothing to draw and that is the repair working, not failing.
   */
  for (const [what, extra] of Object.entries(damage)) {
    const outcome = survives(extra);
    report.check(`a node with ${what} does not throw`, !outcome.startsWith('threw'), outcome);
  }
  const keepsText = Object.entries(damage).filter(([, extra]) => extra.props !== null);
  report.check(
    'and everything that did not lose its props still shows them',
    keepsText.every(([, extra]) => survives(extra) === 'draws'),
    keepsText.filter(([, extra]) => survives(extra) !== 'draws').map(([what]) => what).join(', ') ||
      `${keepsText.length} shapes`
  );

  // Repair must not be indiscriminate: a rule the renderer *can* read has to
  // come through untouched, or "nothing crashed" would be bought by throwing
  // away everybody's hover styles.
  const mixed = hydrateDocument(
    withNode({
      rules: [
        null,
        'garbage',
        { id: 'good', when: [{ kind: 'state', state: 'hover' }], apply: { color: 'red' } },
      ],
    })
  );
  report.check(
    'and a readable rule survives a pass that threw its neighbours away',
    mixed.nodes.dmg0node00?.rules?.length === 1 &&
      mixed.nodes.dmg0node00?.rules?.[0]?.id === 'good',
    `${mixed.nodes.dmg0node00?.rules?.length ?? 0} kept: ${(mixed.nodes.dmg0node00?.rules ?? []).map((r) => r.id).join(', ') || 'none'}`
  );

  // Twice, because hydration runs on every open and a repair that is not
  // idempotent is a document that degrades a little each time it is looked at.
  const twice = hydrateDocument(
    JSON.parse(JSON.stringify(hydrateDocument(withNode({ rules: [null, { id: 'r2', when: [], apply: {} }] }))))
  );
  report.check(
    'and running the repair twice changes nothing the first pass left',
    twice.nodes.dmg0node00?.rules?.length === 1,
    `${twice.nodes.dmg0node00?.rules?.length ?? 0} rules after two passes`
  );
}

/* --------------------------------------------------------------------------
 * The inspector offers what the renderer supports
 *
 * Twice now the panel has been narrower than the model behind it, in the same
 * shape both times: a control gated on an element's *type* when the thing it
 * writes is type-agnostic. The gap is invisible from either side — the
 * renderer looks complete, the panel looks deliberate — and the only way to
 * find it is to compare them, so that comparison lives here.
 * ----------------------------------------------------------------------- */

report.group('the panel is not narrower than the model');

{
  const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
  const content = read(path.join('src', 'components', 'inspector', 'section-content.tsx'));
  const model = read(path.join('src', 'lib', 'renderer', 'element-model.ts'));
  const inspector = read(path.join('src', 'components', 'inspector', 'inspector.tsx'));
  const layout = read(path.join('src', 'components', 'inspector', 'sections-layout.tsx'));

  /*
   * Any node can drive a switch — `applySwitch` writes the attribute for
   * whatever carries the prop, and says so. The panel used to ask whether the
   * element was a button or a link first.
   */
  report.check(
    'anything can be made to drive a switch, because anything can',
    /\bapplySwitch\b/.test(model) &&
      !/type === 'button' \|\| type === 'link'\) && <SwitchSetterSection/.test(content),
    /type === '\w+' \|\| type === '\w+'\) && <SwitchSetterSection/.exec(content)?.[0] ??
      'ungated'
  );
  // And the thing that makes ungating safe: it draws nothing when there is no
  // switch above it. Without that, every element in the library would grow an
  // Interaction section offering an empty menu.
  report.check(
    'and it still draws nothing when there is no switch above it',
    /useStatesInScope\(\)[\s\S]{0,200}?if \(states\.length === 0\) return null;/.test(content),
    'self-hiding'
  );

  /* --- Multi-selection ---------------------------------------------------- */

  /*
   * The three sections a multi-selection is *for* were the three it did not
   * have. Checked by name against the single-selection list rather than by
   * counting, so adding a section to one and forgetting the other is caught.
   */
  const sectionsIn = (source, marker) => {
    const at = source.indexOf(marker);
    const body = source.slice(at, source.indexOf('\n}', at));
    return new Set([...body.matchAll(/<(\w+Section) \/>/g)].map((m) => m[1]));
  };
  const single = sectionsIn(inspector, 'function SingleSelection(');
  const multi = sectionsIn(inspector, 'function MultiSelection(');
  const wanted = ['LayoutSection', 'FlexChildSection', 'PositionSection'];

  report.check(
    'a multi-selection can lay out, grow and pin — the three it is for',
    wanted.every((name) => multi.has(name)),
    wanted.filter((name) => !multi.has(name)).join(', ') || wanted.join(', ')
  );
  /*
   * Four sections are single-selection by nature, and they share a criterion
   * rather than being four separate exceptions: each writes to one node's own
   * content or contract — its text, its binding, its conditions, the props it
   * lets an instance change — rather than to how it is drawn. Everything that
   * describes *drawing* applies to any number of nodes at once, and that is
   * what this check is for.
   */
  const OWN_CONTRACT = [
    'ContentSection',
    'DataSection',
    'RulesSection',
    'ComponentPropertySection',
  ];
  const singleOnly = [...single].filter((name) => !multi.has(name) && !OWN_CONTRACT.includes(name));
  report.check(
    'and there is nothing left that only one element can be given',
    singleOnly.length === 0,
    singleOnly.join(', ') || `${multi.size} sections, ${single.size} for one`
  );

  /*
   * Those sections decide whether to draw at all. Reading `selection[0]` made
   * that decision on behalf of a whole selection from its first member, so a
   * multi-selection starting with a heading lost the Layout controls the
   * frames beside it needed.
   */
  report.check(
    'and a section that can hide asks the whole selection, not its first member',
    !/const id = s\.selection\[0\];[\s\S]{0,240}?getElement\([^)]*\)\.container/.test(layout),
    /s\.selection\[0\]/.test(layout) ? 'still reads selection[0] to decide' : 'asks all of them'
  );
}

/* --------------------------------------------------------------------------
 * The suites are wired up, and address the app rather than guessing at it
 *
 * Two ways a browser suite stops being worth anything without ever going red.
 *
 * It can simply never run — a file in `tests/render` that nothing invokes
 * rots quietly, and the first anyone hears of it is a rewrite.
 *
 * Or it can run against the wrong element. `collections.mjs` found the left
 * panel with `nav + div`, which means "the sidebar" only until the *page being
 * edited* has a `<nav>` of its own — and then it matches canvas content. It
 * passed for months because that suite happens to use a Blank project. A green
 * suite checking the wrong element is worse than a missing one, because it
 * reads as proof.
 * ----------------------------------------------------------------------- */

report.group('every browser suite runs, and none of them guess');

{
  const dir = path.join(ROOT, 'tests', 'render');
  const suites = readdirSync(dir)
    .filter((name) => name.endsWith('.mjs') && !['run.mjs', 'harness.mjs'].includes(name))
    .map((name) => name.replace(/\.mjs$/, ''))
    .sort();

  const runner = readFileSync(path.join(dir, 'run.mjs'), 'utf8');
  const listed = [...runner.matchAll(/^\s*\['([\w-]+)',/gm)].map((m) => m[1]).sort();

  const orphans = suites.filter((name) => !listed.includes(name));
  report.check(
    'every suite in the directory is in the list the runner walks',
    orphans.length === 0,
    orphans.join(', ') || `${suites.length} suites, all wired up`
  );
  const ghosts = listed.filter((name) => !suites.includes(name));
  report.check(
    'and the list names nothing that is not there',
    ghosts.length === 0,
    ghosts.join(', ') || `${listed.length} listed`
  );
  report.check(
    'and the table in tests/README.md describes each of them',
    (() => {
      const readme = readFileSync(path.join(ROOT, 'tests', 'README.md'), 'utf8');
      return suites.every((name) => readme.includes(`\`${name}\``));
    })(),
    suites
      .filter((name) => !readFileSync(path.join(ROOT, 'tests', 'README.md'), 'utf8').includes(`\`${name}\``))
      .join(', ') || `${suites.length} documented`
  );

  /*
   * Sibling-combinator locators rooted at a bare tag name. The editor's chrome
   * and the document being edited share one DOM, so any selector that does not
   * say which of the two it means will eventually find the other.
   */
  const ambiguous = [];
  for (const name of suites) {
    const source = readFileSync(path.join(dir, `${name}.mjs`), 'utf8');
    for (const [, selector] of source.matchAll(/locator\('([a-z]+ ?\+ ?[a-z]+)'\)/g)) {
      ambiguous.push(`${name}: ${selector}`);
    }
  }
  report.check(
    'no suite finds a panel by what happens to sit next to a bare tag',
    ambiguous.length === 0,
    ambiguous.join(', ') || `${suites.length} suites scanned`
  );
  // A regex over source is a thing that can quietly stop matching.
  report.check(
    'and the scan would still recognise the selector that caused this',
    /locator\('([a-z]+ ?\+ ?[a-z]+)'\)/.test("page.locator('nav + div')"),
    'the original is caught'
  );
}

/* --------------------------------------------------------------------------
 * A switch, and the selector that could not match
 *
 * `{ kind: 'control', pseudo: 'checked' }` has been in the model since the
 * native primitives landed, and on the two elements it exists for it did
 * nothing at all. A checkbox renders as a `<label>` wrapping the real input —
 * that is what makes the words a hit target — so the node's class lands on
 * the label, and `.c-abc:where(:checked)` compiles, ships, and matches
 * nothing. A styled "on" state simply never appeared, with no error to say
 * why. Exactly the failure mode this suite exists for: valid output that is
 * quietly inert.
 * ----------------------------------------------------------------------- */

report.group('a checked control can be styled, and says it is a switch');

{
  const withRule = (type) => {
    const doc = createEmptyDocument('Toggle');
    const id = 'ctl0000001';
    doc.nodes[id] = {
      id,
      type,
      name: 'Control',
      parentId: doc.pages[0].rootNodeId,
      children: [],
      props: { label: 'Email digest', name: 'digest', role: 'switch', checked: true },
      styles: { desktop: { color: 'var(--c-text)' } },
      meta: {},
      rules: [
        {
          id: 'r-on',
          when: [{ kind: 'control', pseudo: 'checked' }],
          apply: { borderColor: 'var(--c-primary)' },
        },
      ],
    };
    doc.nodes[doc.pages[0].rootNodeId].children.push(id);
    return doc;
  };

  const selectorFor = (type) =>
    generateNodeCss(withRule(type).nodes, { mode: 'media', includeStates: true })
      .split('\n')
      .find((line) => line.includes(':checked')) ?? '';

  report.check(
    'a checked rule on a checkbox asks whether it *contains* something checked',
    selectorFor('checkbox').includes(':has(:checked)'),
    selectorFor('checkbox').trim() || 'no rule emitted'
  );
  report.check(
    'and so does one on a radio, for the same reason',
    selectorFor('radio').includes(':has(:checked)'),
    selectorFor('radio').trim() || 'no rule emitted'
  );
  /*
   * And not everywhere. A `<select>` or a bare input carries its own class,
   * so `:has()` there would ask whether it contains a checked *descendant* —
   * a different question, and one that is always false.
   */
  report.check(
    'a control that is its own element still uses the plain pseudo-class',
    selectorFor('select').includes(':where(:checked)') &&
      !selectorFor('select').includes(':has('),
    selectorFor('select').trim() || 'no rule emitted'
  );

  /* --- The semantics ------------------------------------------------------ */

  const published = (type) =>
    generateSite(withRule(type)).files.find((f) => f.path === 'index.html')?.contents ?? '';

  report.check(
    'a checkbox asked to be a switch is announced as one',
    /<input [^>]*role="switch"/.test(published('checkbox')),
    /<input [^>]*>/.exec(published('checkbox'))?.[0] ?? 'no input'
  );
  report.check(
    'and it is still a checkbox underneath, so it submits and it is keyboard-operable',
    /<input [^>]*type="checkbox"/.test(published('checkbox')),
    'type survives the role'
  );
  /*
   * A radio is one of several and a group of switches is not a thing, so the
   * role is refused there rather than passed through — an announcement that
   * contradicts the behaviour is worse than none.
   */
  report.check(
    'a radio is not allowed to claim it, whatever the prop says',
    !/role="switch"/.test(published('radio')),
    /<input [^>]*>/.exec(published('radio'))?.[0] ?? 'no input'
  );
}

/* --------------------------------------------------------------------------
 * Characters that should not be in source
 *
 * Twice now a file has ended up holding a byte that makes every tool treat it
 * as binary: once a literal `\x00` where an escape was meant, once a
 * zero-width space smuggled into a comment to stop `*` `/` closing it early.
 * Neither breaks the build. Both make `grep` answer "binary file matches" and
 * refuse to show the line, which is a bad thing to discover while looking for
 * something else.
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * A deployed database can catch up with the code
 *
 * `schema.sql` is re-runnable, but `CREATE TABLE IF NOT EXISTS` does nothing to
 * a table that already exists and SQLite has no `ADD COLUMN IF NOT EXISTS`. So
 * every column added to a shipped table lives in `LATE_COLUMNS` instead, and
 * `/api/admin/schema` applies it. Two lists that must agree, one of which is
 * only ever exercised on somebody else's database — which is exactly the shape
 * of thing to check here, in a real SQLite engine, on every commit.
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * An instance can say something for itself
 *
 * Component properties, and the one claim everything else rests on: an
 * override changes props, never styles. Two instances draw from the same
 * master nodes and therefore carry the same classes — so the moment an
 * override could touch a style, every instance would need a class of its own
 * and the whole cascade would have to learn what an instance is.
 *
 * Driven through the real operations rather than by hand-writing the document
 * they are supposed to produce: half of these are checks about what
 * `exposeProperty` and `detachInstance` actually do.
 * ----------------------------------------------------------------------- */

report.group('an instance can say something for itself');

{
  const html = (doc) =>
    generateSite(doc).files.find((f) => f.path === 'index.html')?.contents ?? '';
  // Out of the page, not out of a file: a published site inlines its
  // stylesheet, and looking for a `.css` that is not there compares one empty
  // string with another — which is what the self-check below is for, and what
  // it caught on the first run.
  const css = (doc) => [...html(doc).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n');

  /**
   * A card component with a heading, a picture and a badge, plus `count`
   * instances of it on the page.
   *
   * Built by promoting a real subtree, so the master is whatever
   * `createComponentFromNode` makes rather than a shape hand-assembled to suit
   * the checks below.
   */
  const withCard = (count = 2) => {
    const doc = createEmptyDocument('Cards');
    const home = doc.pages[0];
    const root = doc.nodes[home.rootNodeId];

    const built = buildTree(
      {
        type: 'stack',
        name: 'Card',
        children: [
          { type: 'heading', name: 'Title', props: { text: 'Master title', level: 3 } },
          {
            type: 'image',
            name: 'Shot',
            props: {
              src: '/master.webp',
              alt: 'Master',
              srcset: '/master-400.webp 400w, /master-800.webp 800w',
              width: 800,
              height: 600,
            },
          },
          { type: 'text', name: 'Badge', props: { text: 'New' } },
        ],
      },
      doc.nodes
    );
    doc.nodes[built.rootId].parentId = home.rootNodeId;
    root.children.push(built.rootId);

    const made = ops.createComponentFromNode(doc, built.rootId, 'Card');
    const instances = [made.instanceId];
    for (let n = 1; n < count; n++) {
      instances.push(ops.insertInstance(doc, made.component.id, home.rootNodeId));
    }

    const master = doc.nodes[made.component.rootNodeId];
    const inside = (name) => master.children.map((id) => doc.nodes[id]).find((n) => n.name === name);

    return { doc, component: made.component, instances, inside };
  };

  const expose = (doc, component, node, kind) => {
    const target = componentLib.exposableTargets(node).find((t) => t.type === kind);
    return ops.exposeProperty(doc, component.id, node.id, target);
  };

  /** Ids of a subtree, captured before something is about to remove it. */
  const collectSubtreeIds = (doc, rootId) => {
    const out = [];
    const walkFrom = (id) => {
      const n = doc.nodes[id];
      if (!n) return;
      out.push(id);
      for (const child of n.children) walkFrom(child);
    };
    walkFrom(rootId);
    return out;
  };

  /* --- What an instance changes ------------------------------------------ */

  {
    const { doc, component, instances, inside } = withCard(2);
    const title = expose(doc, component, inside('Title'), 'text');
    ops.setInstanceOverride(doc, instances[0], title.id, 'First card');
    ops.setInstanceOverride(doc, instances[1], title.id, 'Second card');

    const out = html(doc);
    report.check(
      'two instances of one component can say two different things',
      out.includes('First card') && out.includes('Second card'),
      [out.includes('First card') && 'first', out.includes('Second card') && 'second']
        .filter(Boolean)
        .join(' and ') || 'neither'
    );
    report.check(
      'and neither of them says what the master says',
      !out.includes('Master title'),
      out.includes('Master title') ? 'the master text is still in the file' : 'master text gone'
    );
  }

  /* --- The claim the whole design rests on -------------------------------- */

  {
    const same = withCard(2);
    const differing = withCard(2);
    const property = expose(
      differing.doc,
      differing.component,
      differing.inside('Title'),
      'text'
    );
    ops.setInstanceOverride(differing.doc, differing.instances[0], property.id, 'One');
    ops.setInstanceOverride(differing.doc, differing.instances[1], property.id, 'Two');

    // Node ids are minted per document, so the two stylesheets can only be
    // compared once the ids are taken out of the class names. What is left is
    // the shape of the sheet — how many rules, in what order, saying what.
    const shape = (text) => text.replace(/c-[a-z0-9]+/g, 'c-x');

    report.check(
      'a customised instance does not add one byte to the stylesheet',
      shape(css(differing.doc)) === shape(css(same.doc)),
      `${css(differing.doc).length} vs ${css(same.doc).length} bytes`
    );
    report.check(
      'and the comparison is between sheets with something in them',
      css(same.doc).length > 200,
      `${css(same.doc).length} bytes`
    );
  }

  /* --- Visibility --------------------------------------------------------- */

  {
    const { doc, component, instances, inside } = withCard(2);
    const badge = expose(doc, component, inside('Badge'), 'visible');
    ops.setInstanceOverride(doc, instances[1], badge.id, false);

    const out = html(doc);
    report.check(
      'an instance can drop a node the others keep',
      (out.match(/New/g) ?? []).length === 1,
      `${(out.match(/New/g) ?? []).length} badges published`
    );

    // The mirror: a node the master hides, shown by one instance. Without it
    // the property would only ever subtract, and "optional extra, off by
    // default" is the commoner design of the two.
    const back = withCard(2);
    back.doc.nodes[back.inside('Badge').id].meta.hidden = true;
    const shown = expose(back.doc, back.component, back.inside('Badge'), 'visible');
    ops.setInstanceOverride(back.doc, back.instances[0], shown.id, true);

    const hiddenOut = html(back.doc);
    report.check(
      'and can show one the master hides',
      (hiddenOut.match(/New/g) ?? []).length === 1,
      `${(hiddenOut.match(/New/g) ?? []).length} of 2 instances show it`
    );
  }

  /* --- The srcset trap ---------------------------------------------------- */

  /*
   * The mistake this is here for was nearly shipped. An uploaded image carries
   * a `srcset` ladder and an intrinsic size describing one file; override
   * `src` and all three are about a different picture — and `srcset` outranks
   * `src`, so the master's photo is what a visitor sees however carefully the
   * property was set. Exactly the trap `boundProps` documents for records.
   */
  {
    const { doc, component, instances, inside } = withCard(1);
    const picture = expose(doc, component, inside('Shot'), 'image');
    ops.setInstanceOverride(doc, instances[0], picture.id, '/mine.webp');

    const out = html(doc);
    report.check(
      'overriding an image drops the ladder that described the old one',
      out.includes('/mine.webp') && !out.includes('srcset') && !out.includes('master-800'),
      /<img[^>]*>/.exec(out)?.[0]?.slice(0, 120) ?? 'no image'
    );
    report.check(
      'and the ladder is there when nothing is overriding it',
      html(withCard(1).doc).includes('srcset'),
      'the master publishes its own srcset'
    );
  }

  /* --- Detaching ---------------------------------------------------------- */

  {
    const { doc, component, instances, inside } = withCard(2);
    const title = expose(doc, component, inside('Title'), 'text');
    const badge = expose(doc, component, inside('Badge'), 'visible');
    ops.setInstanceOverride(doc, instances[0], title.id, 'Kept through detach');
    ops.setInstanceOverride(doc, instances[0], badge.id, false);

    const rootId = ops.detachInstance(doc, instances[0]);
    const detached = [rootId, ...(doc.nodes[rootId]?.children ?? [])].map((id) => doc.nodes[id]);

    report.check(
      'detaching keeps what the instance was saying',
      detached.some((n) => n?.props.text === 'Kept through detach'),
      detached.map((n) => n?.name).join(', ')
    );
    report.check(
      'including what it was hiding',
      detached.some((n) => n?.name === 'Badge' && n.meta.hidden === true),
      detached.find((n) => n?.name === 'Badge')?.meta.hidden === true ? 'still hidden' : 'came back'
    );
    report.check(
      'and the instance that was left alone is untouched',
      html(doc).includes('Master title'),
      'the second instance still follows the master'
    );
  }

  /* --- Records still win -------------------------------------------------- */

  /*
   * An override is the node's props as far as everything downstream is
   * concerned, which is what makes a record beat it. Inside a repeater it has
   * to: every row is the same instance node, so an override that outranked the
   * binding would print one row's text in all of them.
   */
  {
    const { doc, component, instances, inside } = withCard(1);
    doc.collections = [
      {
        id: 'posts',
        name: 'Posts',
        slug: 'posts',
        fields: [{ id: 'title', name: 'Title', key: 'title', type: 'text' }],
      },
    ];
    doc.nodes[inside('Title').id].bind = { text: 'title' };

    const title = expose(doc, component, inside('Title'), 'text');
    ops.setInstanceOverride(doc, instances[0], title.id, 'What the instance says');

    const home = doc.pages[0];
    const root = doc.nodes[home.rootNodeId];
    root.repeat = { collection: 'posts' };

    const records = {
      posts: [
        { id: 'a', collectionId: 'posts', slug: 'a', position: 0, published: true, createdAt: 1, updatedAt: 1, data: { title: 'Row one' } },
        { id: 'b', collectionId: 'posts', slug: 'b', position: 1, published: true, createdAt: 2, updatedAt: 2, data: { title: 'Row two' } },
      ],
    };
    const out = generateSite(doc, { records }).files.find((f) => f.path === 'index.html')?.contents ?? '';

    report.check(
      'a record beats an override, so every row says its own thing',
      out.includes('Row one') && out.includes('Row two') && !out.includes('What the instance says'),
      out.includes('What the instance says')
        ? 'the override printed in every row'
        : 'two rows, two titles'
    );
  }

  /* --- Housekeeping ------------------------------------------------------- */

  {
    const { doc, component, instances, inside } = withCard(1);
    const title = expose(doc, component, inside('Title'), 'text');

    report.check(
      'the same prop cannot be exposed twice',
      expose(doc, component, inside('Title'), 'text') === null,
      `${component.properties.length} property after a second attempt`
    );
    report.check(
      'and a node outside the master cannot be exposed at all',
      ops.exposeProperty(doc, component.id, doc.pages[0].rootNodeId, {
        type: 'text',
        prop: 'text',
        label: 'Text',
      }) === null,
      'refused'
    );

    ops.setInstanceOverride(doc, instances[0], title.id, 'Something');
    ops.removeComponentProperty(doc, component.id, title.id);
    report.check(
      'removing a property takes the values with it',
      doc.nodes[instances[0]].overrides === undefined,
      JSON.stringify(doc.nodes[instances[0]].overrides ?? null)
    );

    const gone = withCard(1);
    const badge = expose(gone.doc, gone.component, gone.inside('Badge'), 'visible');
    ops.removeNodes(gone.doc, [gone.inside('Badge').id]);
    report.check(
      'and deleting the node it pointed at prunes the property',
      !(gone.component.properties ?? []).some((p) => p.id === badge.id),
      `${(gone.component.properties ?? []).length} properties left`
    );
  }

  /* --- Damage ------------------------------------------------------------- */

  {
    const { doc, component, instances, inside } = withCard(1);
    expose(doc, component, inside('Title'), 'text');
    doc.nodes[instances[0]].overrides = 'not an object';
    doc.components[0].properties = ['nonsense', null, 42];

    let drew = '';
    let threw = null;
    try {
      drew = html(hydrateDocument(JSON.parse(JSON.stringify(doc))));
    } catch (error) {
      threw = error;
    }
    report.check(
      'a document with damaged overrides still draws',
      threw === null && drew.includes('Master title'),
      threw ? String(threw.message).slice(0, 90) : 'repaired and drawn'
    );
  }

  /* --- Variants ----------------------------------------------------------- */

  /*
   * The other half, and the one an override deliberately cannot do.
   *
   * A property changes what an element says because two instances share one
   * set of nodes. A variant changes how it *looks* because it is a different
   * set of nodes — its own ids, its own classes, its own rules. So the two
   * claims here are opposites and both have to hold: an override must not move
   * the stylesheet, and a variant must.
   */
  {
    const { doc, component, instances, inside } = withCard(2);
    const title = expose(doc, component, inside('Title'), 'text');
    ops.setInstanceOverride(doc, instances[0], title.id, 'Primary card');
    ops.setInstanceOverride(doc, instances[1], title.id, 'Secondary card');

    const variant = ops.addVariant(doc, component.id, 'Secondary');
    ops.setInstanceVariant(doc, instances[1], variant.id);

    report.check(
      'a variant is a tree of its own, not a copy of a pointer',
      Boolean(variant) &&
        variant.rootNodeId !== component.rootNodeId &&
        Boolean(doc.nodes[variant.rootNodeId]),
      `default ${component.rootNodeId}, variant ${variant?.rootNodeId}`
    );

    // The point of the whole feature: the second card can look different.
    doc.nodes[doc.nodes[variant.rootNodeId].children[0]].styles.desktop = { color: '#b91c1c' };

    const out = html(doc);
    report.check(
      'and an instance wearing it keeps the words it had chosen',
      out.includes('Primary card') && out.includes('Secondary card'),
      out.includes('Secondary card')
        ? 'the property followed the instance across'
        : 'switching variant lost the override'
    );
    report.check(
      'because the property gained the counterpart in the new tree',
      title.nodeIds.length === 2 && title.nodeIds.every((id) => Boolean(doc.nodes[id])),
      `${title.nodeIds.length} nodes: ${title.nodeIds.join(', ')}`
    );
    report.check(
      'and the two look different, which is what a property could not do',
      css(doc).includes('#b91c1c') || css(doc).includes('rgb(185'),
      'the variant contributes rules of its own'
    );

    /*
     * Each page pays only for the trees it draws. Keyed by tree rather than by
     * component, which is the bug this was written against: keying by
     * component would have shipped the default's rules to a page that only
     * ever draws the secondary look.
     */
    const onlyVariant = withCard(1);
    const second = ops.addVariant(onlyVariant.doc, onlyVariant.component.id, 'Secondary');
    onlyVariant.doc.nodes[onlyVariant.inside('Title').id].styles.desktop = { color: '#123456' };
    ops.setInstanceVariant(onlyVariant.doc, onlyVariant.instances[0], second.id);

    report.check(
      'a page draws one tree and pays for one tree',
      !css(onlyVariant.doc).includes('#123456'),
      css(onlyVariant.doc).includes('#123456')
        ? 'the unused default tree shipped its rules'
        : 'only the variant on screen'
    );
  }

  /* --- Variants: housekeeping --------------------------------------------- */

  {
    const { doc, component, instances, inside } = withCard(1);
    const title = expose(doc, component, inside('Title'), 'text');
    const variant = ops.addVariant(doc, component.id, 'Secondary');
    ops.setInstanceVariant(doc, instances[0], variant.id);
    ops.setInstanceOverride(doc, instances[0], title.id, 'Says its piece');

    const detachedRoot = ops.detachInstance(doc, instances[0]);
    const detached = [detachedRoot, ...(doc.nodes[detachedRoot]?.children ?? [])].map(
      (id) => doc.nodes[id]
    );
    report.check(
      'detaching an instance detaches the tree it was wearing',
      detached.some((n) => n?.props.text === 'Says its piece'),
      detached.map((n) => n?.name).join(', ')
    );

    const removing = withCard(1);
    const gone = ops.addVariant(removing.doc, removing.component.id, 'Secondary');
    ops.setInstanceVariant(removing.doc, removing.instances[0], gone.id);
    const strandedNodes = collectSubtreeIds(removing.doc, gone.rootNodeId);
    ops.removeVariant(removing.doc, removing.component.id, gone.id);

    report.check(
      'deleting a variant puts its instances back on the default',
      removing.doc.nodes[removing.instances[0]].props.variantId === undefined &&
        html(removing.doc).includes('Master title'),
      'the instance draws the default again'
    );
    report.check(
      'and takes its nodes with it rather than orphaning them',
      strandedNodes.every((id) => removing.doc.nodes[id] === undefined),
      `${strandedNodes.filter((id) => removing.doc.nodes[id]).length} of ${strandedNodes.length} left behind`
    );

    const deleting = withCard(1);
    const extra = ops.addVariant(deleting.doc, deleting.component.id, 'Secondary');
    const every = [
      ...collectSubtreeIds(deleting.doc, deleting.component.rootNodeId),
      ...collectSubtreeIds(deleting.doc, extra.rootNodeId),
    ];
    ops.deleteComponent(deleting.doc, deleting.component.id);
    report.check(
      'deleting the component takes every tree, not just the default',
      every.every((id) => deleting.doc.nodes[id] === undefined),
      `${every.filter((id) => deleting.doc.nodes[id]).length} of ${every.length} left behind`
    );

    // A variant root is a root. Deleting one through the ordinary node path
    // would leave the component pointing at nothing.
    const guarded = withCard(1);
    const protectedVariant = ops.addVariant(guarded.doc, guarded.component.id, 'Secondary');
    ops.removeNodes(guarded.doc, [protectedVariant.rootNodeId]);
    report.check(
      'and a variant root cannot be deleted as if it were an ordinary node',
      Boolean(guarded.doc.nodes[protectedVariant.rootNodeId]),
      'refused'
    );
  }

  /* --- Falsification ------------------------------------------------------ */

  /*
   * The two checks above that could most easily be true by accident, made to
   * fail on purpose. The stylesheet comparison is the one that matters: two
   * empty strings are also identical.
   */
  {
    const { doc, component, instances, inside } = withCard(2);
    const title = expose(doc, component, inside('Title'), 'text');
    ops.setInstanceOverride(doc, instances[0], title.id, 'Only here');
    // Reach past the operation and put the value under a name no property has,
    // which is what a stale key looks like after a property is removed.
    doc.nodes[instances[1]].overrides = { 'no-such-property': 'Should not appear' };

    const out = html(doc);
    report.check(
      'a value with no property behind it changes nothing',
      !out.includes('Should not appear') && out.includes('Only here'),
      out.includes('Should not appear') ? 'a stale key was rendered' : 'ignored'
    );

    const shape = (text) => text.replace(/c-[a-z0-9]+/g, 'c-x');
    const withStyle = withCard(2);
    withStyle.doc.nodes[withStyle.inside('Title').id].styles.desktop = { color: '#ff0000' };
    report.check(
      'and the stylesheet check would notice a sheet that did change',
      shape(css(withStyle.doc)) !== shape(css(withCard(2).doc)),
      'a style on the master moves the sheet, as it must'
    );
  }
}

report.group('a database that predates a column can still get it');

{
  const schemaSql = readFileSync(path.join(ROOT, 'workers/schema.sql'), 'utf8');
  const { LATE_COLUMNS, LATE_INDEXES, ensureSchema, inspectSchema, looksLikeMissingColumn } =
    loadSchemaModule();

  const fresh = databaseWith(schemaSql);
  const target = shapeOf(fresh);

  /**
   * `schema.sql` with the late columns taken back out — a stand-in for a
   * database deployed before they existed.
   *
   * Comments go first so a stripped column cannot leave a trailing comma
   * stranded behind two lines of prose, and the removal is per-table because
   * `document` is a column on both `projects` and `deployments` and only one
   * of them is late.
   */
  const stripColumn = (sql, table, column) => {
    const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    if (start < 0) throw new Error(`no CREATE TABLE for ${table}`);
    const end = sql.indexOf(');', start);
    const block = sql.slice(start, end);
    const line = new RegExp(`^[ \\t]*${column}[ \\t]+(TEXT|INTEGER|REAL|BLOB)\\b[^\\n]*\\n`, 'm');
    // Loud on purpose. A strip that quietly matched nothing would leave the
    // column in place and make every check below pass without doing anything.
    if (!line.test(block)) throw new Error(`no ${table}.${column} declaration to remove`);
    return sql.slice(0, start) + block.replace(line, '') + sql.slice(end);
  };

  const asItWas = () => {
    let sql = schemaSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
    for (const { table, column } of LATE_COLUMNS) sql = stripColumn(sql, table, column);
    for (const { name } of LATE_INDEXES) {
      sql = sql.replace(new RegExp(`^CREATE[^;]*\\b${name}\\b[^;]*;`, 'm'), '');
    }
    return sql.replace(/,(\s*)\)/g, '$1)');
  };

  /**
   * A shape, compared by name and type rather than by position.
   *
   * `ALTER TABLE … ADD COLUMN` appends, so an upgraded `projects` ends
   * `…, created_at, updated_at, subdomain, site_manifest` where a fresh one has
   * the two in the middle. Nothing reads a column by index — every query in the
   * Worker names them — so the difference is real and does not matter, and
   * pretending otherwise would leave a check that can never pass.
   */
  const canonical = (shape) =>
    Object.keys(shape)
      .sort()
      .map((table) => {
        const columns = Object.keys(shape[table]).sort();
        return `${table}(${columns.map((c) => `${c} ${shape[table][c]}`).join(', ')})`;
      })
      .join('; ');

  report.check(
    'every late column is a column the schema file declares, at the same type',
    LATE_COLUMNS.every((c) => target[c.table]?.[c.column] === c.type),
    LATE_COLUMNS.map((c) => `${c.table}.${c.column} ${target[c.table]?.[c.column] ?? '—'}`).join(', ')
  );

  // Built once, from the full list, and reused by the falsification below —
  // which shortens the list, and would otherwise stop stripping the very
  // column it is trying to prove the absence of.
  const OLD_SQL = asItWas();

  const old = databaseWith(OLD_SQL);
  const before = shapeOf(old);
  const gap = LATE_COLUMNS.filter((c) => before[c.table]?.[c.column] === undefined);

  report.check(
    'the older database really is missing all four',
    gap.length === LATE_COLUMNS.length,
    `${gap.length}/${LATE_COLUMNS.length} absent`
  );

  // What a deploy would hit before anybody notices: the publisher writing a
  // column that is not there. Caught by message, because D1 gives it no code —
  // so the message is read off the engine rather than remembered.
  let insertMessage = '';
  let selectMessage = '';
  try {
    old.prepare(`SELECT site_manifest FROM projects`).all();
  } catch (error) {
    selectMessage = error.message;
  }
  try {
    old.prepare(`INSERT INTO projects (id, site_manifest) VALUES ('x', 'y')`).run();
  } catch (error) {
    insertMessage = error.message;
  }

  report.check(
    'and SQLite says so in a way the error handler recognises',
    Boolean(selectMessage) &&
      Boolean(insertMessage) &&
      looksLikeMissingColumn(new Error(selectMessage)) &&
      looksLikeMissingColumn(new Error(insertMessage)),
    [selectMessage, insertMessage].filter(Boolean).join(' / ') || 'no error raised'
  );
  report.check(
    'without matching an error that means something else',
    !looksLikeMissingColumn(new Error('D1_ERROR: no such table: projects')) &&
      !looksLikeMissingColumn(new Error('UNIQUE constraint failed: projects.subdomain')),
    'no such table and a constraint failure both pass through'
  );

  const applied = await ensureSchema(runnerFor(old));

  report.check(
    'the upgrade lands the older database on the shipped schema exactly',
    canonical(shapeOf(old)) === canonical(target),
    applied.added.join(', ') || 'nothing added'
  );
  report.check(
    'including the index that could not exist until its column did',
    LATE_INDEXES.every((i) => indexesOf(old).includes(i.name)) &&
      JSON.stringify(indexesOf(old)) === JSON.stringify(indexesOf(fresh)),
    applied.indexes.join(', ') || 'no index created'
  );
  report.check(
    'and it says it is done',
    applied.ready && applied.pending.length === 0,
    JSON.stringify({ ready: applied.ready, pending: applied.pending })
  );

  const again = await ensureSchema(runnerFor(old));
  report.check(
    'running it twice is running it once',
    again.added.length === 0 && again.indexes.length === 0 && again.ready,
    `${again.present.length} already present`
  );

  const onFresh = await inspectSchema(runnerFor(fresh));
  report.check(
    'a database built from the schema file needs nothing',
    onFresh.ready && onFresh.pending.length === 0 && onFresh.missingTables.length === 0,
    `${onFresh.present.length} present`
  );

  // A database with no tables is not a database behind by two columns, and
  // patching columns onto tables that do not exist is not the fix.
  const bare = await ensureSchema(runnerFor(databaseWith('SELECT 1')));
  report.check(
    'an uninitialised database is named as such, not patched',
    bare.missingTables.length > 0 && bare.added.length === 0 && !bare.ready,
    `missing ${bare.missingTables.join(', ')}`
  );

  /*
   * The list that will actually rot.
   *
   * Everything above proves the mechanism works on the columns it knows about.
   * The failure this is here for is the other one: somebody adds a column to a
   * shipped table in `schema.sql` next year, fresh databases get it, every
   * deployment does not, and nothing says a word. So the columns of every
   * table that has already shipped are pinned here. A new *table* is safe and
   * is ignored — `CREATE TABLE IF NOT EXISTS` handles those.
   */
  const SHIPPED = {
    users: 'id email name verifier auth_version avatar_hue created_at updated_at',
    sessions: 'token_hash user_id created_at expires_at user_agent',
    teams: 'id name created_by created_at personal',
    team_members: 'team_id user_id role created_at',
    invites: 'id team_id email role token_hash invited_by created_at expires_at accepted_at',
    projects: 'id team_id created_by name document page_count version created_at updated_at',
    deployments: 'id project_id published_by published_at page_count bytes r2_prefix',
    assets: 'id project_id name type r2_key bytes created_at',
    form_submissions: 'id project_id form_id payload ip_hash user_agent created_at',
    records: 'id project_id collection_id slug position published data created_at updated_at',
  };

  const late = new Set(LATE_COLUMNS.map((c) => `${c.table}.${c.column}`));
  const unaccounted = [];
  for (const [table, pinned] of Object.entries(SHIPPED)) {
    const known = new Set(pinned.split(' '));
    for (const column of Object.keys(target[table] ?? {})) {
      if (!known.has(column) && !late.has(`${table}.${column}`)) {
        unaccounted.push(`${table}.${column}`);
      }
    }
  }

  report.check(
    'no shipped table has gained a column that deployments will never see',
    unaccounted.length === 0,
    unaccounted.length
      ? `${unaccounted.join(', ')} — add to LATE_COLUMNS in workers/src/lib/schema.ts, ` +
          'or to SHIPPED here if the table is new'
      : `${Object.keys(SHIPPED).length} tables pinned`
  );
  report.check(
    'and the pin describes tables that exist',
    Object.keys(SHIPPED).every((t) => target[t]) &&
      Object.keys(target).every((t) => SHIPPED[t]),
    Object.keys(target).filter((t) => !SHIPPED[t]).join(', ') || 'every table accounted for'
  );

  /*
   * Falsification. Both checks that matter are checks about convergence, and
   * convergence between two lists derived from the same file is exactly the
   * kind of thing that can be true by construction. So: take an entry out of
   * the list and confirm the database stops arriving.
   */
  const crippled = databaseWith(OLD_SQL);
  const dropped = LATE_COLUMNS.splice(2, 1)[0];
  const partial = await ensureSchema(runnerFor(crippled));
  LATE_COLUMNS.splice(2, 0, dropped);

  report.check(
    'a column missing from the list is a column the database never gets',
    canonical(shapeOf(crippled)) !== canonical(target) &&
      shapeOf(crippled)[dropped.table]?.[dropped.column] === undefined,
    `dropped ${dropped.table}.${dropped.column}; upgrade added ${partial.added.join(', ')}`
  );
  report.check(
    'and the list is back',
    LATE_COLUMNS.length === 4 && LATE_COLUMNS[2] === dropped,
    LATE_COLUMNS.map((c) => c.column).join(', ')
  );
}

report.group('nothing in the tree reads as binary');

{
  // Control characters minus the three that are ordinary text (tab, newline,
  // carriage return), plus the invisibles that have no business in source: the
  // zero-width space, the two joiners, and a byte-order mark anywhere at all.
  //
  // Written as escapes, obviously — a rule spelled with the characters it
  // forbids would fail itself, which is a funnier way to learn the lesson than
  // anyone needs.
  const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/;
  const SKIP = new Set(['node_modules', '.git', '.next', 'out', '.wrangler', '.artifacts']);
  const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.jsonc', '.md', '.css', '.sql']);

  const offenders = [];
  let scanned = 0;
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
        continue;
      }
      if (!EXTENSIONS.has(path.extname(entry.name))) continue;
      scanned++;
      const text = readFileSync(full, 'utf8');
      const at = text.search(FORBIDDEN);
      if (at >= 0) {
        offenders.push(`${path.relative(ROOT, full)}:${text.slice(0, at).split('\n').length}`);
      }
    }
  };
  scan(ROOT);

  report.check(
    'no source file carries a control character or an invisible',
    offenders.length === 0,
    offenders.join(', ') || `${scanned} files, all readable`
  );
  report.check(
    'and the scan actually looked at the tree',
    scanned > 100,
    `${scanned} files`
  );
  // The rule has to be able to fire, and a character class this fiddly proves
  // nothing by being read.
  report.check(
    'the rule catches each kind it is written for',
    ['\u0000', '\u200B', '\uFEFF', '\u0001'].every((c) => FORBIDDEN.test(`text${c}text`)) &&
      !FORBIDDEN.test('ordinary text\n\twith a tab\r\n'),
    'NUL, zero-width space, BOM and a stray control byte'
  );
}

report.finish();
