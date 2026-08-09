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
  createEmptyDocument,
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

report.finish();
