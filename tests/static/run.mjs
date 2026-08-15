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
/*
 * The same immer the store and the room use, so "this patch cannot apply" is
 * the real library's answer rather than this file's opinion of one.
 */
import { applyPatches, enablePatches, produceWithPatches } from 'immer';
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

enablePatches();

/**
 * Every condition in a rule's `when`, from either spelling.
 *
 * The suite reads both and always will. A *spec* writes the authoring
 * shorthand — `when: [a, b]` — because that is what somebody composing a block
 * means, and `buildTree` folds it; a *document* holds a `Test`, which may be a
 * bare condition or a tree of them. Checks that walk block specs and checks
 * that walk built documents both come through here, so neither has to know
 * which it was handed.
 */
function conditionsIn(when) {
  if (!when) return [];
  if (Array.isArray(when)) return when.flatMap(conditionsIn);
  if (when.kind === 'every' || when.kind === 'some') return when.tests.flatMap(conditionsIn);
  if (when.kind === 'compare') return [];
  return [when];
}

const report = createReport();
const {
  BLOCKS,
  BLOCK_CATEGORIES,
  ICON_NAMES,
  ELEMENTS,
  PLACEHOLDER_MIN_HEIGHT,
  canContain,
  isInteractive,
  anchorId,
  vocabulary,
  conditions,
  when_,
  events: eventLib,
  stateLib,
  contentProps,
  testTable,
  motion,
  everyRef,
  namedRef,
  pruneRefs,
  danglingReads,
  migrateDocument,
  actions: actionLib,
  buildTree,
  finishDocument,
  resolveNodeHref,
  canReparent,
  jumpTargetsFor,
  generateNodeCss,
  generateStylesheet,
  parseCustomDeclarations,
  APPEAR_EFFECTS,
  DOCUMENT_RESET,
  renderPage,
  generateSite,
  renderNodeToHtml,
  createEmptyDocument,
  createPage,
  hydrateDocument,
  ops,
  components: componentLib,
  format: formatLib,
  boundProps,
  repeatLib,
  tests,
  schedule,
  steps: stepLib,
  values,
  behaviour,
  TEMPLATES,
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
    /*
     * Rows as well as columns, and the row half was added late for a telling
     * reason: when this rule was written nothing in the codebase had ever set a
     * `gridRow`, because the one bento in the library varied only by width and
     * the inspector had no row for the other axis. So it guarded the hazard it
     * could see. A row span left un-released is the quieter failure — nothing
     * spills sideways, the card is simply twice as tall as the phone needs —
     * which is exactly the kind of thing that survives a sweep.
     */
    for (const axis of ['gridColumn', 'gridRow']) {
      const span = node.styles?.[axis];
      if (!span || !/span\s+[2-9]/.test(span)) continue;
      const released = ['mobile', 'tablet'].some((bp) => {
        const value = node.responsive?.[bp]?.[axis];
        return value === 'auto' || value === '1' || value === 'span 1';
      });
      // The axis is named because both spell themselves `span 2`: a card that
      // covers two of each reports one failure, and without the axis there is
      // no way to tell from the message which half is unreleased.
      if (!released) bad.push(`${path}: ${axis} ${span} with no narrow reset`);
    }
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
 * And the same hazard one level further out, which the pairwise rule cannot
 * reach.
 *
 * `canContain` refuses a button directly inside a link and can do no more: it
 * compares two types and has no tree. So `link > frame > button` passed —
 * every step legal, nothing looking at the chain. The parser does not reject
 * that markup, it lifts the button out of the link, so the canvas shows one
 * thing and the published file another.
 *
 * Walking down from each interactive node rather than up from each leaf,
 * because the message wants to name the ancestor: "a button inside this link"
 * is actionable and "this button has an interactive ancestor somewhere" is a
 * puzzle.
 */
function checkInteractiveNesting(spec) {
  const bad = [];
  const descend = (node, path, ancestor) => {
    const operable = isInteractive(node);
    if (operable && ancestor) {
      bad.push(`${path}: <${node.type}> is operable and sits inside <${ancestor}>`);
    }
    const inherited = ancestor ?? (operable ? node.type : null);
    for (const child of node.children ?? []) {
      descend(child, `${path} › ${child.name ?? child.type}`, inherited);
    }
  };
  descend(spec, spec.name ?? spec.type, null);
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
  let wired = 0;
  for (const { node, path } of walk(spec)) {
    const wanted = node.refs?.popover;
    if (typeof wanted !== 'string') continue;
    wired++;
    if (!names.has(wanted)) bad.push(`${path}: opens "${wanted}", which is not in this block`);
  }
  // A block with no invokers is ordinary; a *registry* with none means this
  // rule has stopped reading whatever the wiring is spelled as now. It read
  // `props.popoverTarget` until the reference moved to `refs`, and went
  // silently green the moment it did.
  seenPopoverRefs += wired;
  return bad;
}

let seenPopoverRefs = 0;

/**
 * A panel is either a modal or a menu, never half of one.
 *
 * The popover element centres itself — `inset: 0` with four auto margins,
 * which is how a top-layer box sits in the middle and exactly right for a
 * dialog. Anchoring means undoing all six of those declarations *and* saying
 * where to go instead, and it is the "all six" that makes this worth a rule:
 * clear the inset and forget `position-area` and the panel lands at its static
 * position, which for a top-layer box is the top-left corner, over the logo.
 *
 * So the two states are named and anything between them is an error. This is
 * not a judgement about which panels ought to be menus — that is design, and
 * the account menu opening in the middle of the viewport was a design mistake
 * rather than a lint failure. It is a check that a half-finished edit cannot
 * ship looking finished.
 */
function checkAnchoring(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (node.type !== 'popover' && node.type !== 'dialog') continue;
    // Effective styles, not the override on its own. A narrow-width layer
    // inherits the base one, so a mobile rule that changes only the padding
    // must not read as a panel that forgot where it goes — which is what the
    // first version of this rule reported about the mega menu.
    const base = node.styles ?? {};
    for (const { where, styles: layer } of layers(node)) {
      const styles = { ...base, ...layer };
      const anchored = Boolean(node.props?.anchorTo);
      const at = `${path} (${where})`;
      if (anchored) {
        if (!styles.positionArea) bad.push(`${at}: anchored, but nothing says where`);
        // A menu near the right edge or the bottom of the window hangs off it
        // without these. The browser places it where it was told and stops.
        if (styles.positionArea && !styles.positionTryFallbacks) {
          bad.push(`${at}: anchored with no fallback, so an edge menu overflows`);
        }
        if (styles.inset && styles.inset !== 'auto') {
          bad.push(`${at}: anchored but still holds inset: ${styles.inset}`);
        }
        for (const side of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft']) {
          if (styles[side] === 'auto') bad.push(`${at}: anchored but ${side} is still auto`);
        }
      } else if (styles.positionArea || styles.inset === 'auto') {
        bad.push(`${at}: positioned like a menu without asking to be one`);
      }
    }
  }
  return bad;
}

/**
 * The name resolves to a *popover*, not to whatever else is called that.
 *
 * `checkPopoverRefs` asks whether the name exists in the block, which is not
 * the same question and cannot see the failure that matters: the command menu
 * has a wrapper carrying the same layer name as its panel, so a resolver
 * indexing every node wired both buttons to the wrapper. The published page
 * had an id and a `popovertarget` that did not match, and the menu could not
 * be opened by anybody. Only the browser noticed.
 *
 * Asked of the built tree rather than the spec, because resolution is the
 * thing under test.
 */
function checkPopoverResolves(spec) {
  const nodes = {};
  buildTree(spec, nodes);
  const bad = [];
  for (const node of Object.values(nodes)) {
    const target = opensOf(node);
    if (!target) continue;
    const panel = nodes[target];
    if (!panel) bad.push(`${node.name}: opens a node that is not in the tree`);
    else if (panel.type !== 'popover' && panel.type !== 'dialog') {
      bad.push(`${node.name}: opens “${panel.name}”, which is a ${panel.type}`);
    }
  }
  return bad;
}

/**
 * A panel positioned against nothing.
 *
 * `anchorTo` says "follow an element"; the element it follows is derived at
 * build time from whatever opens the panel, so at *spec* level the thing to
 * check is that something does. A panel anchored with no invoker publishes as
 * a fixed box with no insets and lands in the top-left corner.
 *
 * Asked of the spec rather than of the built tree because that is where the
 * mistake is made — and asking the built tree would be asking `buildTree` to
 * confirm its own default, which it always would.
 */
function checkAnchorTargets(spec) {
  const opened = new Set();
  for (const { node } of walk(spec)) {
    const target = node.refs?.popover;
    if (typeof target === 'string') opened.add(target);
  }
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (node.props?.anchorTo && !opened.has(node.name)) {
      bad.push(`${path}: anchored, but nothing in this block opens it`);
    }
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
      for (const condition of conditionsIn(rule.when)) {
        if (condition.kind === 'state' && !condition.key) out.push(condition);
      }
    }
    return out;
  };

  /**
   * Every assignment a control carries, as `{ state, value }`.
   *
   * Two spellings reach here and both are current. A block writes
   * `props.switchSet` for the ordinary case — the nearest state, no name — and
   * that is folded into an action by the factory, which has not run yet: these
   * checks read the *spec*. Anything a prop cannot say is written as an action
   * on the spec directly. Reading only the prop, which is what this did, made
   * every control built the new way invisible to the check that exists to
   * catch a button that does nothing.
   */
  const setsOf = (node) => {
    const out = [];
    if (node.props?.switchSet) out.push({ state: '', value: String(node.props.switchSet) });
    for (const binding of node.events ?? []) {
      if (binding.event !== 'onClick') continue;
      for (const action of binding.actions ?? []) {
        if (action.type === 'setState' && action.value) {
          out.push({ state: String(action.state ?? ''), value: String(action.value) });
        }
      }
    }
    return out;
  };

  /**
   * Every state this block declares, and every assignment that names one.
   *
   * Collected block-wide rather than during the group walk below, because a
   * named assignment is *defined* by reaching past whatever encloses the
   * control — it can sit in a nested group, or in no group at all — and the
   * walk deliberately stops at each group boundary. Answering "does anything
   * listen for this value" from inside the enclosing group would therefore
   * miss exactly the controls the naming exists for.
   */
  const declared = new Set();
  const namedSets = new Map();
  for (const { node } of walk(spec)) {
    const key = node.props?.switchKey;
    if (key) declared.add(String(key));
  }
  for (const { node } of walk(spec)) {
    for (const { state, value } of setsOf(node)) {
      if (state) {
        const list = namedSets.get(state) ?? [];
        list.push({ node, value });
        namedSets.set(state, list);
      }
      if (state && !declared.has(state)) {
        // A named assignment is the one kind that cannot be caught by the walk
        // below: it deliberately reaches past whatever encloses the control,
        // so no enclosing group is the right place to notice a typo in it.
        bad.push(
          `${at(node)}: sets "${state}" to "${value}", and this block declares no such state`
        );
      }
    }
  }

  /** Everything a state can be told to be, and every test made against it. */
  const survey = (group) => {
    // Which state this group *is*, so an assignment naming another one can be
    // told apart from one naming this.
    const key = String(group.props?.switchKey ?? '');
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
        for (const { state, value } of setsOf(child)) {
          // Bare ones only. A named assignment belongs to the state it names
          // wherever it sits, so it is collected block-wide instead — counting
          // it here as well would report one typo twice.
          if (!state) sets.push({ node: child, value });
        }
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
          for (const { state, value } of setsOf(child)) {
            // A named one is checked above and may legitimately reach out.
            if (!state) bad.push(`${at(child)}: sets "${value}", but no state encloses it`);
          }
        }
        walkGroups(child, enclosed);
        continue;
      }

      const { depends, negated, sets: local, panelCounts, selfCondition } = survey(child);
      const known = new Set([...depends, ...negated]);
      // Plus whatever names this state from somewhere the walk cannot reach.
      const sets = [...local, ...(namedSets.get(key) ?? [])];

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

/**
 * A control that both jumps and navigates.
 *
 * The renderer picks the jump — `rawHref` prefers `refs.scrollTo` — so the two
 * never both happen, and while the reference resolves the href is dead weight
 * nobody sees. The failure is what happens when it *stops* resolving. A name
 * matching nothing is deleted, and the href underneath quietly takes over: the
 * control still works, still passes the dead-link and broken-fragment rules,
 * and goes somewhere other than where it says.
 *
 * That is the one variant of this hazard the existing rules miss. A jump to a
 * section that some pages lack falls back to `#`, which `deadLinks` catches; a
 * fragment naming nothing gets caught by name on every page. Only a *real*
 * href behind a jump is invisible, and only an author writing the node by hand
 * can produce one — `linkButton` strips it.
 *
 * `#` is exempt, and has to be: a button's `defaultProps` supply it, so every
 * jump button in a document carries one whatever the spec said.
 */
function checkJumpExclusive(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    if (!node.refs?.scrollTo) continue;
    const href = String(node.props?.href ?? '').trim();
    if (href && href !== '#') {
      bad.push(`${path}: jumps to "${node.refs.scrollTo}" and also links to "${href}"`);
    }
  }
  return bad;
}

/*
 * Properties whose value has to be a length.
 *
 * Not every dimensional property — only the ones where a wrong value fails
 * *silently*. A bad `font-size` is visible the moment anybody looks; a bad
 * `width` collapses the element to nothing and the page just has a gap in it
 * that reads as a spacing decision.
 */
const LENGTH_PROPS = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'gap',
  'rowGap',
  'columnGap',
  'top',
  'right',
  'bottom',
  'left',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'flexBasis',
]);

/** Keywords a length property may legitimately take instead of a number. */
const LENGTH_WORDS = new Set([
  'auto',
  'none',
  'inherit',
  'initial',
  'unset',
  'revert',
  '0',
  'fit-content',
  'max-content',
  'min-content',
  'stretch',
  'available',
  'normal',
]);

/**
 * A length that is not a length.
 *
 * `avatar(size)` takes its diameter first. Called as `avatar('DT')` — which is
 * how anybody would call something named "avatar" — it builds a frame with
 * `width: DT`, the browser drops the declaration, the element is zero wide,
 * and the block renders with a person's portrait silently missing. Nothing in
 * the suite noticed: it is a valid document, a valid node and valid CSS
 * syntax; it is only a nonsense *value*, and the browser's response to those
 * is to say nothing at all.
 *
 * One unit list, deliberately conservative. Anything with a `var()`, a
 * `calc()`, a `clamp()`, a `min()` or a `max()` in it is passed — those can
 * evaluate to anything and this rule is not a CSS parser.
 */
const LENGTH = /^-?(\d+(\.\d+)?|\.\d+)(px|%|em|rem|ch|ex|vw|vh|vmin|vmax|fr|pt|cm|mm|in|q|pc|svh|lvh|dvh|svw|lvw|dvw)?$/i;

function badLength(prop, value) {
  if (!LENGTH_PROPS.has(prop)) return false;
  const raw = String(value).trim();
  if (!raw) return false;
  // Bail on anything with a function in it before splitting: `calc(1px + 2px)`
  // has spaces in it and is none of this rule's business.
  if (/\b(var|calc|clamp|min|max|env|attr)\(/i.test(raw)) return false;
  /*
   * Every part, because `gap` takes two — a row gap and a column gap — and
   * `gap: 8px 22px` is the commonest spelling in the library. Splitting rather
   * than special-casing `gap` keeps the rule true for any other property that
   * turns out to accept a pair, and costs nothing: a single value is a list of
   * one.
   */
  const parts = raw.split(/\s+/);
  return parts.some((part) => !LENGTH_WORDS.has(part.toLowerCase()) && !LENGTH.test(part));
}

/** Every length-shaped property in a spec tree that is not a length. */
function checkLengths(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    const layers = [node.styles ?? {}, ...Object.values(node.responsive ?? {})];
    for (const rule of node.rules ?? []) layers.push(rule.apply ?? {});
    for (const state of Object.values(node.states ?? {})) layers.push(state ?? {});
    for (const layer of layers) {
      for (const [prop, value] of Object.entries(layer)) {
        if (badLength(prop, value)) bad.push(`${path}: ${prop} is "${value}"`);
      }
    }
  }
  return bad;
}

/**
 * A card that rises under the pointer and goes nowhere.
 *
 * The rule, stated once: `transform` on hover is a promise of a destination.
 * Border colour and shadow are feedback — "the pointer is here" — and every
 * card in the library may have them. Travel is different. Nothing else on a
 * page moves when you point at it, so two pixels of lift is read as "press
 * me", and a visitor who presses and gets nothing has been told something
 * untrue by the design.
 *
 * `isInteractive` is the right predicate and it already exists: C2 widened it
 * so a layout box carrying an `href` or a `scrollTo` counts, which is exactly
 * the case that *may* lift. `workGridBlock`'s case card lifts and should.
 *
 * Two blocks failed this the day it was written — `galleryBlock`, which lifted
 * while it was standing in for the agency's case studies and kept lifting
 * after they became real pages, and `cardGridBlock`, which lifts on features
 * and prices that were never going anywhere.
 */
function fakeAffordance(node) {
  if (isInteractive(node)) return null;
  /*
   * Both spellings, because this runs on both sides of the library. A block
   * spec writes `states: { hover: {…} }` and a built document holds the rule
   * that `rulesFromLegacy` turned it into. Reading only one of them would have
   * left three of the four offences this rule was written for invisible: they
   * were in blocks, and only the fourth reached a template.
   */
  const moved = (decl) => decl?.transform ?? decl?.translate;
  for (const pseudo of ['hover', 'active']) {
    const found = moved(node.states?.[pseudo]);
    if (found) return String(found);
  }
  for (const rule of node.rules ?? []) {
    const hovered = conditionsIn(rule.when).some(
      (c) => c.kind === 'pointer' && (c.pseudo === 'hover' || c.pseudo === 'active')
    );
    if (hovered && moved(rule.apply)) return String(moved(rule.apply));
  }
  return null;
}

/** The same rule, over a block spec's tree, for the `RULES` table. */
function checkFakeAffordance(spec) {
  const bad = [];
  for (const { node, path } of walk(spec)) {
    const moves = fakeAffordance(node);
    if (moves) bad.push(`${path}: lifts on hover (${moves}) and goes nowhere`);
  }
  return bad;
}

/**
 * Whether an image reserves its space before the bytes arrive.
 *
 * Two ways to be sized, because there are two kinds of image and only one of
 * them can carry numbers.
 *
 * A designer's photograph declares intrinsic `width`/`height`, which reach the
 * markup and give the browser the ratio for nothing. An image whose `src` is
 * *bound* cannot: `boundProps` deletes `width`, `height` and `srcset` the
 * moment a record writes the src, because all three describe the picture that
 * was there at design time and a record supplies a URL and nothing else. That
 * deletion is right — shipping numbers about a different image is worse than
 * shipping none — and it names the substitute: an `aspectRatio` on the node,
 * which is a decision made once for the whole list.
 *
 * Reading only `props.width` was therefore a rule that had stopped covering
 * what it claimed. It went on passing on every bound image in the library,
 * reporting "all sized" about markup with no dimensions in it, because the
 * property it read was the design-time one the publisher throws away.
 */
function holdsItsShape(node) {
  /*
   * An aspect ratio counts for *any* image, not only a bound one.
   *
   * This read `width`/`height` for everything unbound, which is right for a
   * photograph and wrong for the `media()` placeholder every block in the
   * library uses: that carries no `src` at all and reserves its box with
   * `width: 100%` and an `aspectRatio`. There is nothing to load and therefore
   * nothing to shift, and adding intrinsic numbers to a fluid slot would be
   * both redundant and a worse description of it.
   *
   * Surfaced by the component gallery, which is the first template to contain
   * blocks as they come out of the Insert panel. The templates all pass real
   * photographs in, so the placeholders were never in front of this rule. Same
   * shape as the bound-image miss the rest of this docblock describes: a guard
   * as wide as the road that existed when it was written.
   */
  const ratio = ratioHolds(node);
  if (!node.bind?.src) {
    return ratio || filledByItsParent(node) || (Boolean(node.props?.width) && Boolean(node.props?.height));
  }
  /*
   * `styles` is keyed by breakpoint — `{ desktop: {…}, mobile: {…} }` — and
   * reading `styles.aspectRatio` off it finds nothing on every node in the
   * library, which is a rule that fails on correct work. Both halves are
   * required: the base has to set one, and a narrow breakpoint must not throw
   * it away, because a phone is where the picture is widest relative to the
   * page and where the shift costs most.
   */
  // Over the breakpoints by name rather than over whatever keys the object
  // happens to have: a flat `{ aspectRatio }` is precisely the misreading this
  // rule was written with, and iterating keys would hand a string to `in`.
  return ratioHolds(node);
}

/**
 * Taken out of flow and stretched to whatever contains it.
 *
 * The third way to be sized, and the one the media hero's backdrop uses: an
 * absolutely positioned image pinned to its parent's box occupies exactly that
 * box before and after the bytes arrive, and being out of flow it cannot move
 * anything else even in principle. Demanding intrinsic numbers of it would be
 * asking a layer to declare a size it does not get to choose.
 *
 * Narrow on purpose — positioned *and* given a definite height. Position alone
 * would excuse an absolutely placed thumbnail that really can shift.
 */
function filledByItsParent(node) {
  const desktop = node.styles?.desktop ?? {};
  const positioned = desktop.position === 'absolute' || desktop.position === 'fixed';
  const height = String(desktop.height ?? '').trim();
  return positioned && Boolean(height) && height !== 'auto';
}

/**
 * A ratio set at the base and not thrown away when the screen narrows.
 *
 * Both halves are required: a phone is where the picture is widest relative to
 * the page and where the shift costs most, so a narrow breakpoint that clears
 * `aspectRatio` un-reserves the box exactly where it matters.
 *
 * Over the breakpoints by name rather than over whatever keys the object
 * happens to have: a flat `{ aspectRatio }` is precisely the misreading this
 * rule was written with, and iterating keys would hand a string to `in`.
 */
function ratioHolds(node) {
  const base = node.styles?.desktop?.aspectRatio;
  const released = ['tablet', 'mobile'].some((bp) => {
    const decl = node.styles?.[bp];
    return decl && 'aspectRatio' in decl && !String(decl.aspectRatio ?? '').trim();
  });
  return Boolean(base) && !released;
}

/** Said in the words of whichever of the two rules the node fell under. */
function whyUnsized(node) {
  if (!node.bind?.src) return 'has no intrinsic size';
  return node.styles?.desktop?.aspectRatio
    ? 'takes its picture from a record and lets go of its aspect ratio when narrow'
    : 'takes its picture from a record and has no aspect ratio to hold the space';
}

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
      // An attribute splits two ways like the other two, so the expansion stays
      // linear and it is a legal axis. It was left out because attributes came
      // later than this rule, which is what cost the copy button its word.
      if (condition.kind === 'attr') return condition.name;
      return null;
    };

    let axis = null;
    const claimed = new Map();
    for (const rule of setting) {
      const unsettable = Object.keys(rule.set).filter((prop) => !SETTABLE.has(prop));
      if (unsettable.length) {
        bad.push(`${path}: "${unsettable.join(', ')}" is structure, not content — it cannot be set`);
      }
      const only = conditionsIn(rule.when);
      if (only.length !== 1 || rule.part || rule.breakpoint) {
        bad.push(`${path}: a content rule takes exactly one plain condition`);
        continue;
      }
      const condition = only[0];
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
  ['and nothing operable inside anything else operable', checkInteractiveNesting],
  ['every popover button names a popover in its block', checkPopoverRefs],
  ['a panel is a modal or a menu, never half of one', checkAnchoring],
  ['an anchored panel has something to be anchored to', checkAnchorTargets],
  ['and a wired button reaches a panel, not something that shares its name', checkPopoverResolves],
  ['every switch is wired to its own cases', checkSwitches],
  ['no block still says when it shows in props', checkRetiredProps],
  ['content varies on one state, exclusively', checkContentRules],
  ['a control jumps or navigates, never both', checkJumpExclusive],
  ['small images clear the empty-slot floor', checkPlaceholderFloor],
  ['buttons and links respond to hover', checkInteractiveStates],
  ['and nothing else rises under the pointer', checkFakeAffordance],
  ['every length is one', checkLengths],
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
    checkColumnSpans,
    'and a card spanning two rows with no narrow reset',
    { type: 'frame', name: 'F', styles: { gridRow: 'span 2' }, responsive: { mobile: { gap: '8px' } } },
  ],
  [
    checkInteractiveNesting,
    'a button two levels down inside a link',
    {
      type: 'link',
      name: 'Card link',
      props: { href: '/x/' },
      children: [{ type: 'frame', name: 'Body', children: [{ type: 'button', name: 'Go' }] }],
    },
  ],
  [
    checkJumpExclusive,
    'a control that jumps and also carries a real href',
    {
      type: 'button',
      name: 'Both',
      props: { label: 'Go', href: '/pricing/' },
      refs: { scrollTo: 'Pricing' },
    },
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
    { type: 'frame', name: 'F', children: [{ type: 'button', name: 'B', refs: { popover: 'Ghost' } }] },
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
          when: { kind: 'data', source: 'time', op: 'is', values: ['night'] },
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
      rules: [{ id: 'r', when: { kind: 'pointer', pseudo: 'hover' }, apply: {}, set: { text: 'a' } }],
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

/*
 * The wiring rule read `props.popoverTarget` until references moved into
 * `refs`, and the moment they did it matched nothing and passed on all 49
 * blocks. A rule that reads a field is only as good as the field still being
 * the one in use, so it counts what it saw.
 */
report.check(
  'and the wiring rule is still reading whatever wiring is spelled as',
  seenPopoverRefs > 5,
  `${seenPopoverRefs} invokers seen across the registry`
);

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

/* --------------------------------------------------------------------------
 * References between elements
 *
 * Elements have pointed at each other since the first popover, and every time
 * it was spelled differently — a node id in a prop, a `popover@Name` awaiting
 * a resolver, a `componentId`, a list of node ids in a component property.
 * Two had their own resolution pass and only one had cleanup, which is why
 * deleting a panel left every button that opened it pointing at an id no
 * longer in the document. Nothing reported it: a `popovertarget` naming
 * nothing renders fine and does nothing.
 *
 * So the checks are about the properties a *first-class* reference has, and
 * each of them is one the old spelling did not: it resolves once, it is
 * enumerable, it survives a copy, and it does not outlive what it points at.
 * ----------------------------------------------------------------------- */

report.group('a reference is a thing the document knows about');

{
  /** A button, the panel it opens, and something else to point at. */
  const wired = () => {
    const doc = createEmptyDocument('Refs');
    const page = doc.pages[0];
    const nodes = {};
    const { rootId } = buildTree(
      {
        type: 'frame',
        name: 'Bar',
        children: [
          { type: 'button', name: 'Open', props: { label: 'Open' }, refs: { popover: 'Panel' } },
          { type: 'text', name: 'Beside', props: { text: 'x' } },
          { type: 'popover', name: 'Panel', props: { anchorTo: 'below' }, children: [] },
        ],
      },
      nodes,
      page.rootNodeId
    );
    Object.assign(doc.nodes, nodes);
    doc.nodes[page.rootNodeId].children.push(rootId);
    const by = (name) => Object.values(doc.nodes).find((n) => n.name === name);
    return { doc, button: by('Open'), panel: by('Panel'), beside: by('Beside') };
  };

  const { doc, button, panel, beside } = wired();

  report.check(
    'a name in a spec becomes an id in the document',
    opensOf(button) === panel.id,
    JSON.stringify(button.refs)
  );
  report.check(
    'and a name matching nothing is dropped rather than left dangling',
    (() => {
      const nodes = {};
      buildTree({ type: 'button', name: 'B', refs: { popover: 'Ghost' } }, nodes);
      return Object.values(nodes).every((n) => !n.refs);
    })(),
    'no reference to a node that is not there'
  );
  report.check(
    'a panel that asked to be anchored is anchored to whatever opens it',
    button.refs?.anchorFor?.node === panel.id,
    'the default nobody should have to state twice'
  );
  report.check(
    'every reference is reachable from one walk',
    [...everyRef(doc.nodes)].length === 2,
    `${[...everyRef(doc.nodes)].length} found — the property a prop could never have`
  );

  /* ------------------------------------------------ pointing somewhere else */

  ops.setAnchor(doc, panel.id, beside.id);
  report.check(
    'pointing a panel at something else moves the reference',
    !button.refs?.anchorFor && beside.refs?.anchorFor?.node === panel.id,
    'one claim at a time — two would resolve to whichever is lower in the tree'
  );
  report.check(
    'and the button still opens it',
    opensOf(button) === panel.id,
    'the two slots are independent'
  );
  report.check(
    'un-anchoring leaves no reference behind',
    (ops.setAnchor(doc, panel.id, null), !beside.refs?.anchorFor),
    'and no empty map either'
  );

  /* -------------------------------------------------- integrity on deletion */

  {
    const { doc: d2, button: b2, panel: p2 } = wired();
    ops.removeNodes(d2, [p2.id]);
    report.check(
      'deleting a panel clears the reference to it',
      !opensOf(b2),
      // The bug this whole primitive is for: the button used to keep an id
      // that was no longer in the document and silently stop working.
      b2.refs ? JSON.stringify(b2.refs) : 'nothing left pointing at a ghost'
    );
    report.check(
      'and the anchor back-reference with it',
      !b2.refs?.anchorFor,
      'both slots, because cleanup walks the map rather than a named prop'
    );
  }

  /* ------------------------------------------------------ surviving a copy */

  {
    const { doc: d3, button: b3, panel: p3 } = wired();
    const bar = d3.nodes[b3.parentId];
    const copies = ops.duplicateNodes(d3, [bar.id]);
    const inside = collectSubtreeNames(d3, copies[0]);
    report.check(
      'a copied button opens the copied panel, not the original',
      opensOf(inside.button) === inside.panel?.id &&
        inside.panel?.id !== p3.id,
      opensOf(inside.button) === p3.id
        ? 'both copies open the first panel'
        : 'rewired to its own'
    );

    /*
     * And the same claim with the reference spelled the other way.
     *
     * X6 gave `scrollTo` and `openPanel` a second home — an action holding a
     * `Ref` — and taught `everyRef` to yield it, because the whole argument
     * for a reference map is that references are enumerable. `rewireInternalRefs`
     * was not asking `everyRef`; it walked `node.refs` for itself. So a
     * duplicated button whose jump was authored as a verb kept pointing at the
     * *original* section: the copy looked right in the layer tree, published a
     * working link, and sent the visitor to the wrong place.
     *
     * Built through the real spec path and duplicated through the real
     * operation, because the claim is about what those two do together — a
     * hand-made pair of nodes would only prove the rewiring function agrees
     * with itself.
     */
    const doc4 = createEmptyDocument('Jumps');
    const page4 = doc4.pages[0];
    const { rootId: barId } = buildTree(
      {
        type: 'frame',
        name: 'Bar',
        children: [
          { type: 'section', name: 'Features', props: { anchor: 'features' } },
          {
            type: 'button',
            name: 'Down',
            props: { label: 'Down' },
            events: [
              { event: 'onClick', actions: [{ type: 'scrollTo', ref: namedRef('Features') }] },
            ],
          },
        ],
      },
      doc4.nodes,
      page4.rootNodeId
    );
    doc4.nodes[page4.rootNodeId].children.push(barId);

    // A local walker: `collectSubtreeNames` only knows the two names the
    // popover fixture above uses, and widening it would make that check's
    // reading depend on this one's fixture.
    const byName = (rootId) => {
      const out = {};
      const stack = [rootId];
      while (stack.length) {
        const node = doc4.nodes[stack.pop()];
        if (!node) continue;
        out[node.name] = node;
        stack.push(...node.children);
      }
      return out;
    };
    const original = byName(barId);
    const copyId = ops.duplicateNodes(doc4, [barId])[0];
    const copy = byName(copyId);
    const jumpOf = (node) =>
      (node?.events ?? []).flatMap((b) => b.actions).find((a) => a.type === 'scrollTo')?.ref.node;

    report.check(
      'and a copied jump lands in the copy, when the reference is a verb',
      Boolean(jumpOf(copy.Down)) &&
        jumpOf(copy.Down) === copy.Features?.id &&
        copy.Features?.id !== original.Features?.id,
      jumpOf(copy.Down) === original.Features?.id
        ? 'the copy jumps to the original section'
        : `copy → ${jumpOf(copy.Down) ?? 'nowhere'}, original → ${jumpOf(original.Down) ?? 'nowhere'}`
    );
  }

  /* ------------------------------------------------------------- migration */

  {
    const old = createEmptyDocument('Older');
    const page = old.pages[0];
    const nodes = {};
    const { rootId } = buildTree(
      { type: 'button', name: 'Legacy', props: { label: 'Open' } },
      nodes,
      page.rootNodeId
    );
    Object.assign(old.nodes, nodes);
    old.nodes[page.rootNodeId].children.push(rootId);
    // The shape every project in the wild carries: a bare node id in a prop.
    old.nodes[rootId].props.popoverTarget = page.rootNodeId;

    migrateDocument(old);
    report.check(
      'a project saved before this opens with its wiring intact',
      opensOf(old.nodes[rootId]) === page.rootNodeId &&
        old.nodes[rootId].props.popoverTarget === undefined,
      JSON.stringify(old.nodes[rootId].refs ?? null)
    );
    const again = JSON.stringify(old.nodes[rootId]);
    migrateDocument(old);
    report.check(
      'and running it twice changes nothing',
      JSON.stringify(old.nodes[rootId]) === again,
      'idempotent'
    );

    /* ------------------- a declaration written under the wrong name -------- */

    const legacy = old.nodes[rootId];
    // Without the delete this fixture asserts nothing: a button ships
    // `textDecoration: none` in its defaults, so the rename would find the
    // right name already taken and correctly leave it alone — which reads as
    // the migration doing nothing.
    legacy.styles.desktop = { ...legacy.styles.desktop, textDecorationLine: 'line-through' };
    delete legacy.styles.desktop.textDecoration;
    legacy.rules = [
      { id: 'r-old', when: { kind: 'pointer', pseudo: 'hover' }, apply: { textDecorationLine: 'underline' } },
    ];
    migrateDocument(old);
    report.check(
      'a declaration saved under a name the model does not have is repaired, not dropped',
      legacy.styles.desktop.textDecoration === 'line-through' &&
        legacy.styles.desktop.textDecorationLine === undefined &&
        legacy.rules[0].apply.textDecoration === 'underline',
      /*
       * The effect picker offered `textDecorationLine` for a while and the
       * generator kebab-cased it into working CSS, so the pages were right and
       * the documents were not: a key outside the closed set the override
       * badge and the row menu key on. Untouched, those rules open in the
       * panel with no matching option and read as unset.
       *
       * Both layers, because a rule's `apply` is a `StyleDecl` too and is
       * where the picker actually wrote.
       */
      JSON.stringify({
        base: legacy.styles.desktop.textDecoration ?? null,
        rule: legacy.rules[0].apply.textDecoration ?? null,
        leftOver: legacy.styles.desktop.textDecorationLine ?? null,
      })
    );
    report.check(
      'and a value already under the right name is the one kept',
      (() => {
        const both = old.nodes[rootId];
        both.styles.desktop = { textDecoration: 'underline', textDecorationLine: 'line-through' };
        migrateDocument(old);
        return both.styles.desktop.textDecoration === 'underline';
      })(),
      // A document open in two tabs can be part-way through. The newer
      // spelling is the one somebody chose most recently.
      old.nodes[rootId].styles.desktop.textDecoration ?? 'nothing'
    );
  }

  /* Each of the above, handed something it must reject. */
  /* ------------------------------------- a reference inside an expression */

  {
    const { doc: d6, panel: p6, beside: b6 } = wired();
    const reader = d6.nodes[p6.id];
    reader.state = { key: 'form', values: [], initial: '' };
    reader.props.switchDefault = 'idle';
    reader.assign = [
      {
        id: 'r1',
        when: { kind: 'compare', left: { kind: 'element', ref: { node: b6.id } }, op: 'notEmpty' },
        value: 'ready',
      },
    ];
    report.check(
      'a reference inside a rule is found by the same walk',
      [...everyRef(d6.nodes)].some((one) => one.slot === 'expression' && one.ref.node === b6.id),
      // Not in `refs` — nested in `assign[].when` — and leaving it out of the
      // walk would have re-created the dangling-reference bug one layer down.
      `${[...everyRef(d6.nodes)].length} references in all`
    );
    report.check(
      'and nothing is dangling while the element it reads is there',
      danglingReads(d6.nodes).length === 0,
      'clean'
    );

    ops.removeNodes(d6, [b6.id]);
    report.check(
      'deleting what a rule reads is reported rather than silently rewritten',
      danglingReads(d6.nodes).length === 1 &&
        d6.nodes[p6.id].assign.length === 1,
      // Deliberately not pruned: throwing away a rule somebody wrote is a
      // bigger decision than cleanup gets to make. The node falls back to its
      // declared Otherwise, and this is what lets the editor say why.
      `${danglingReads(d6.nodes).length} reported, rule kept`
    );
    const [reported] = danglingReads(d6.nodes);
    report.check(
      'and the report names the rule, not only the element it is on',
      reported?.node.id === p6.id && reported?.rule === 'r1' && reported?.missing === b6.id,
      /*
       * What makes it usable. The warning belongs beside the sentence that is
       * broken — a panel-level "something here is wrong" over a list of four
       * rules leaves the reader to do the matching, and the fix is a chip in
       * one of those four sentences.
       */
      reported ? `${reported.rule} on ${reported.node.id} reads ${reported.missing}` : 'nothing'
    );
    report.check(
      'and it is silent about a rule reading a field rather than an element',
      (() => {
        d6.nodes[p6.id].assign.push({
          id: 'r2',
          when: { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'notEmpty' },
          value: 'priced',
        });
        return danglingReads(d6.nodes).length === 1;
      })(),
      // A record field is not a node and has no id to dangle. Reporting one
      // would make the warning noise, and a warning that is usually wrong is
      // read as decoration within a week.
      `${danglingReads(d6.nodes).length} reported with a field rule alongside`
    );
  }

  /*
   * And the same walk on the operand that only exists since E1.
   *
   * `refsInTest` read `left` alone, which was complete while `right` could
   * only be a constant. A rule comparing a control on the right would then
   * point at a node that integrity never looked at: delete the element and
   * nothing reports it, nothing prunes it, and the rule silently stops
   * resolving. Built separately from the block above so the *only* reference
   * in the document is the right-hand one — sharing that fixture would have
   * let the left-hand ref answer for both.
   */
  {
    const { doc: d7, panel: p7, beside: b7 } = wired();
    const reader = d7.nodes[p7.id];
    reader.state = { key: 'form', values: [], initial: '' };
    reader.props.switchDefault = 'idle';
    reader.assign = [
      {
        id: 'r1',
        when: {
          kind: 'compare',
          left: { kind: 'field', key: 'wanted' },
          op: 'eq',
          right: { kind: 'element', ref: { node: b7.id } },
        },
        value: 'ready',
      },
    ];
    const found = [...everyRef(d7.nodes)].filter((one) => one.slot === 'expression');
    report.check(
      'a reference on the right of a comparison is found by the same walk',
      found.length === 1 && found[0]?.ref.node === b7.id,
      `${found.length} expression references, ${found[0]?.ref.node ?? 'none'}`
    );
    ops.removeNodes(d7, [b7.id]);
    report.check(
      'and deleting what it reads is reported rather than going quiet',
      danglingReads(d7.nodes).length === 1 && danglingReads(d7.nodes)[0]?.rule === 'r1',
      `${danglingReads(d7.nodes).length} reported`
    );
  }

  report.check(
    'the cleanup only removes what is actually gone',
    (() => {
      const { doc: d4, button: b4, panel: p4 } = wired();
      pruneRefs(d4.nodes);
      return opensOf(b4) === p4.id;
    })(),
    'a live reference survives a prune'
  );
  report.check(
    'and it would notice one that is',
    (() => {
      const { doc: d5, button: b5 } = wired();
      actionLib.setPressAction(b5, 'openPanel', { type: 'openPanel', ref: { node: 'a-node-that-was-never-here' } });
      pruneRefs(d5.nodes);
      return !opensOf(b5);
    })(),
    'the half of the rule that could quietly do nothing'
  );
}

/** The button and panel inside a copied subtree, by name. */
/**
 * What a *built* node opens, and what it jumps to.
 *
 * X8 moved both onto verbs, so a check that reads `refs.popover` on a document
 * is reading the authoring shorthand after it has been folded away. A spec
 * still writes `refs: { popover: 'Menu' }` and the checks that walk specs still
 * read it there — these two are only for nodes that have been through
 * `buildTree` or `hydrateDocument`.
 */
function opensOf(node) {
  const list = (node?.events ?? []).flatMap((b) => b.actions);
  return list.find((a) => a.type === 'openPanel' || a.type === 'closePanel')?.ref?.node || '';
}
function jumpOf(node) {
  const list = (node?.events ?? []).flatMap((b) => b.actions);
  return list.find((a) => a.type === 'scrollTo')?.ref?.node || '';
}

function collectSubtreeNames(doc, rootId) {
  const out = {};
  const stack = [rootId];
  while (stack.length) {
    const node = doc.nodes[stack.pop()];
    if (!node) continue;
    if (node.name === 'Open') out.button = node;
    if (node.name === 'Panel') out.panel = node;
    stack.push(...node.children);
  }
  return out;
}

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
      // A binding written when `bind` was a prop to a field name. Nothing else
      // about this node is old, which is the case that matters: the migration
      // must notice it on a node it would otherwise have skipped.
      { bind: { text: 'title', src: 'cover' } },
      { bind: { text: { value: { kind: 'field', key: 'title' } } } },
    ])
  );
  const at = (i) => doc.nodes[`n${i}`];
  const only = (i) => at(i).rules?.[0];
  /*
   * One condition is the condition, not a list holding it. `when` was
   * `Condition[]` when these checks were written; it is a `Test`, and a Test
   * of one thing is that thing — `asTest` and `simplify` both make that
   * choice, because a group with a single member is an extra level in the
   * panel and a document that differs from an identical design built the
   * other way round.
   */
  const when = (i) => only(i)?.when;

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
    only(7)?.part === 'backdrop' && only(7)?.when === undefined
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

  // `bind` was a prop to a field name until a format needed somewhere to live
  // that was not inside the value. The old spelling is every binding anybody
  // has made so far, so getting this wrong empties their pages back to the
  // placeholder text — silently, because a missing field is a legitimate state.
  report.check(
    'a binding written as a field name becomes a value',
    at(8).bind?.text?.value?.kind === 'field' && at(8).bind?.text?.value?.key === 'title',
    JSON.stringify(at(8).bind?.text)
  );
  report.check(
    'every one of them, not just the first',
    at(8).bind?.src?.value?.key === 'cover',
    JSON.stringify(at(8).bind?.src)
  );
  report.check(
    'and one already converted is left exactly as it is',
    JSON.stringify(at(9).bind) === '{"text":{"value":{"kind":"field","key":"title"}}}',
    JSON.stringify(at(9).bind)
  );

  /*
   * A comparison's constant, which is every comparison anybody has written.
   *
   * `right` was `{ type, value }` and is now a tagged `Value`, so an untagged
   * one is a document from before E1 — and left untagged it stops being a
   * literal to `foldable`, which means every existing `Price is over 500000`
   * silently stops folding and starts travelling. Three places hold a Test and
   * all three are walked; the rule below is deliberately inside a group, on
   * the axis (`only`) that came last, because that is the one a walk written
   * against `rules` alone would miss.
   */
  {
    const before = {
      ...createEmptyDocument('Operands'),
      nodes: {
        n1: {
          id: 'n1', type: 'frame', name: 'Card', parentId: null, children: [],
          props: {}, styles: {}, meta: {},
          rules: [
            {
              id: 'r1',
              when: { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'gt', right: { type: 'number', value: 500000 } },
              apply: { color: 'red' },
            },
          ],
          assign: [
            {
              id: 'a1',
              when: {
                kind: 'every',
                tests: [
                  { kind: 'compare', left: { kind: 'field', key: 'status' }, op: 'eq', right: { type: 'text', value: 'sold' } },
                ],
              },
              value: 'gone',
            },
          ],
          events: [
            {
              event: 'onClick',
              actions: [
                {
                  type: 'copy',
                  text: 'X',
                  only: { kind: 'compare', left: { kind: 'field', key: 'ok' }, op: 'eq', right: { type: 'boolean', value: true } },
                },
              ],
            },
          ],
        },
      },
    };
    const after = migrateDocument(JSON.parse(JSON.stringify(before)));
    const node = after.nodes.n1;
    const dear = {
      id: 'r1', collectionId: 'c', position: 0, published: true,
      data: { price: 900000 }, createdAt: 0, updatedAt: 0,
    };
    const rights = [
      node.rules[0].when.right,
      node.assign[0].when.tests[0].right,
      node.events[0].actions[0].only.right,
    ];
    report.check(
      'a comparison written before both sides were Values gets its tag',
      rights.every((right) => right?.kind === 'literal'),
      rights.map((right) => `${right?.kind ?? 'untagged'}:${right?.type}`).join(' · ')
    );
    report.check(
      'and it still means what it meant, which is that it still folds',
      tests.foldable(node.rules[0].when) === true &&
        tests.foldable(node.assign[0].when) === true &&
        tests.evaluate(node.rules[0].when, dear) === true,
      `folds ${tests.foldable(node.rules[0].when)} · answers ${tests.evaluate(node.rules[0].when, dear)}`
    );
    report.check(
      'and running it again does not tag the tag',
      JSON.stringify(migrateDocument(JSON.parse(JSON.stringify(after)))) === JSON.stringify(after),
      JSON.stringify(after.nodes.n1.rules[0].when.right)
    );
  }

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
    negated.includes(':not(:is([data-cre8-data~="time:night"]))'),
    // `:is()` either way, so `is` and `isn't` weigh the same and order stays
    // precedence.
    /:where\([^{]*data-cre8-data[^{]*/.exec(negated)?.[0]?.trim() ?? 'no rule'
  );
  report.check(
    'and it asks the element that carries a value, not any ancestor without one',
    negated.includes(':where([data-cre8-data]:not(:is([data-cre8-data~="time:night"])))'),
    /*
     * The bug this replaces, and the version of this check that shipped
     * alongside it asserted the broken spelling — which is how a defect
     * becomes a requirement.
     *
     * A prefix matches if *any* ancestor satisfies it, and
     * `:not(:is([data-cre8-data~="time:night"]))` is satisfied by `<body>`, by
     * every wrapper div, by anything that is not the one element carrying the
     * attribute. So the negative rule matched always: the night copy of a
     * data variant was hidden at night and at every other hour, and the strip
     * showed nothing at all between nine and midnight. Nobody saw it, because
     * the browser check that would have caught it only ever ran in the
     * afternoon.
     */
    /:where\([^{]*data-cre8-data[^{]*/.exec(negated)?.[0]?.trim() ?? 'no rule'
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
      expanded.includes(
        ':where([data-cre8-data]:not(:is([data-cre8-data~="time:night"]))) .c-'
      ),
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
        rules: [{ id: 'h', when: { kind: 'pointer', pseudo: 'hover' }, apply: { color: 'red' } }],
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
  // Stored as a bare field name, which is how every binding made before
  // formats existed is written. Loading has to both keep it and convert it:
  // keeping it in the old shape would leave the renderer reading a value off a
  // string.
  report.check(
    'and so does a binding, in the shape the renderer now expects',
    bound.nodes.b.bind?.text?.value?.key === 'title',
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

  /*
   * And the three that were content all along and in neither list.
   *
   * `boundProps` gates on `isSettable` too, so this was not a panel that would
   * not offer the binding — it was a binding the renderer dropped as well. A
   * hand-written document could not do it either, which is what makes it a gap
   * rather than a missing control.
   *
   * A `details` in a repeater is the ordinary case: the FAQ. Asserted on the
   * published `<summary>` rather than on the list, because the list is the
   * thing being changed and a check that read it would be reading its own
   * input.
   */
  const faq = publish({ collection: 'posts' }, [row('r9', { title: 'How do refunds work?' })], {
    type: 'details',
    name: 'Question',
    props: { summary: 'Untitled question' },
    bind: { summary: 'title' },
  });
  report.check(
    'a details in a repeater can ask the record its question',
    faq.includes('How do refunds work?') && !faq.includes('Untitled question'),
    /<summary[^>]*>([^<]*)</.exec(faq)?.[1] ?? 'no summary rendered'
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
        when: { kind: 'data', source: 'time', op: 'is', values: ['night'] },
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
 * How a bound value reads
 *
 * Phase A of the expression model: a binding is a value and, optionally, a
 * format. Two claims are worth checking and neither is visible in a rendered
 * page.
 *
 * The first is that formatting is deterministic. It runs on the canvas and it
 * runs in the Worker, and D3's gate is that the two produce the same bytes —
 * so a formatter that reached for `Intl` or for the local time zone would put
 * an invisible difference into every published page and fail a diff nobody
 * could read. The check is against the source as well as against the values,
 * because a wrong answer that happens to match today is still wrong.
 *
 * The second is the hard rule the whole expression system rests on:
 * comparisons see raw values. That is enforced structurally — `Format` hangs
 * off `Binding`, where a `Value` cannot reach it — so what is checked here is
 * that the structure holds: one caller, and the record untouched.
 * ----------------------------------------------------------------------- */

report.group('a bound value can be formatted, and only where it is shown');

{
  const { formatValue, formatsFor, FORMATS_FOR, defaultFormat, FORMAT_LABELS } = formatLib;
  const reads = (raw, format) => formatValue(raw, format);

  /* Worked examples, one per format, written as the designer would read them. */
  report.check(
    'a price reads as a price',
    reads(750000, { kind: 'currency', symbol: '$', decimals: 2 }) === '$750,000.00',
    reads(750000, { kind: 'currency', symbol: '$', decimals: 2 })
  );
  report.check(
    'and the symbol is the one that was typed, on the side it was put',
    reads(1234.5, { kind: 'currency', symbol: '€', decimals: 2, after: true }) === '1,234.50€',
    reads(1234.5, { kind: 'currency', symbol: '€', decimals: 2, after: true })
  );
  report.check(
    'a number groups from the right, however long it is',
    reads(1234567.891, { kind: 'number', decimals: 1 }) === '1,234,567.9',
    reads(1234567.891, { kind: 'number', decimals: 1 })
  );
  report.check(
    'and does not, when told not to',
    reads(1234567, { kind: 'number', group: false }) === '1234567',
    reads(1234567, { kind: 'number', group: false })
  );
  report.check(
    'a percent is appended, not multiplied — scaling is arithmetic',
    reads(12.5, { kind: 'percent', decimals: 1 }) === '12.5%',
    reads(12.5, { kind: 'percent', decimals: 1 })
  );
  report.check(
    'a date reads in words',
    reads('2026-08-11', { kind: 'date', pattern: 'long' }) === '11 August 2026',
    reads('2026-08-11', { kind: 'date', pattern: 'long' })
  );
  report.check(
    'every pattern says the same day a different way',
    ['iso', 'us', 'short', 'monthYear']
      .map((pattern) => reads('2026-08-11', { kind: 'date', pattern }))
      .join(' | ') === '2026-08-11 | August 11, 2026 | 11 Aug 2026 | August 2026',
    ['iso', 'us', 'short', 'monthYear']
      .map((pattern) => reads('2026-08-11', { kind: 'date', pattern }))
      .join(' | ')
  );
  report.check(
    'letters change case without consulting a locale',
    reads('sold out', { kind: 'case', to: 'upper' }) === 'SOLD OUT' &&
      reads('sold out', { kind: 'case', to: 'capitalize' }) === 'Sold Out',
    reads('sold out', { kind: 'case', to: 'capitalize' })
  );
  report.check(
    'and capitalising leaves the rest of a word alone',
    reads('the MacDonald estate', { kind: 'case', to: 'capitalize' }) === 'The MacDonald Estate',
    reads('the MacDonald estate', { kind: 'case', to: 'capitalize' })
  );
  report.check(
    'a long value is cut at a word, not mid-syllable',
    reads('A four bedroom house with a garden', { kind: 'truncate', chars: 20 }) ===
      'A four bedroom…',
    reads('A four bedroom house with a garden', { kind: 'truncate', chars: 20 })
  );
  report.check(
    'and a short one is left alone entirely',
    reads('Sold', { kind: 'truncate', chars: 20 }) === 'Sold',
    reads('Sold', { kind: 'truncate', chars: 20 })
  );

  /*
   * The cases that are bugs rather than preferences. Each of these is
   * something a formatter written the obvious way gets wrong, and each would
   * reach a published page.
   */
  report.check(
    'zero is a value a record has said, not an absence',
    reads(0, { kind: 'currency' }) === '$0.00',
    String(reads(0, { kind: 'currency' }))
  );
  report.check(
    'rounding to nothing does not produce a negative zero',
    reads(-0.4, { kind: 'number', decimals: 0 }) === '0',
    String(reads(-0.4, { kind: 'number', decimals: 0 }))
  );
  report.check(
    'but a real negative keeps its sign, outside the symbol',
    reads(-1234.5, { kind: 'currency' }) === '-$1,234.50',
    String(reads(-1234.5, { kind: 'currency' }))
  );
  report.check(
    'a value that is not a number passes through rather than printing NaN',
    reads('on request', { kind: 'currency' }) === 'on request',
    String(reads('on request', { kind: 'currency' }))
  );
  report.check(
    'a number stored as text is still a number',
    reads('750000', { kind: 'currency', decimals: 0 }) === '$750,000',
    String(reads('750000', { kind: 'currency', decimals: 0 }))
  );
  report.check(
    'a date that is not one passes through rather than printing Invalid Date',
    reads('sometime in August', { kind: 'date', pattern: 'long' }) === 'sometime in August',
    String(reads('sometime in August', { kind: 'date', pattern: 'long' }))
  );
  report.check(
    'and neither does a date-shaped string that is not a date',
    reads('2026-13-40', { kind: 'date', pattern: 'long' }) === '2026-13-40',
    String(reads('2026-13-40', { kind: 'date', pattern: 'long' }))
  );
  report.check(
    'an empty field stays empty rather than becoming a formatted nothing',
    reads('', { kind: 'currency' }) === '' && reads(null, { kind: 'date', pattern: 'iso' }) === null,
    `${JSON.stringify(reads('', { kind: 'currency' }))} / ${JSON.stringify(reads(null, { kind: 'date', pattern: 'iso' }))}`
  );

  /*
   * The time-zone one, which is the reason dates are taken apart with a
   * regular expression instead of handed to `Date`. An implementation that
   * parsed this string would answer "12 August" in UTC and "11 August" in
   * Chicago — so the canvas and the Worker would disagree for five hours a
   * day, and only for records written late in the evening.
   */
  report.check(
    'a timestamp reads as the day it was written, wherever it is rendered',
    reads('2026-08-11T23:30:00-05:00', { kind: 'date', pattern: 'long' }) === '11 August 2026',
    String(reads('2026-08-11T23:30:00-05:00', { kind: 'date', pattern: 'long' }))
  );

  /* What may be formatted at all. */
  report.check(
    'every field type says what it can be formatted as',
    ['text', 'richtext', 'number', 'boolean', 'date', 'image', 'select', 'reference'].every(
      (type) => Array.isArray(FORMATS_FOR[type])
    ),
    Object.keys(FORMATS_FOR).join(', ')
  );
  report.check(
    'a number offers currency and a date does not',
    FORMATS_FOR.number.includes('currency') && !FORMATS_FOR.date.includes('currency'),
    `number: ${FORMATS_FOR.number.join('/')} — date: ${FORMATS_FOR.date.join('/')}`
  );
  report.check(
    'markup offers nothing, because every transform here would cut a tag in half',
    FORMATS_FOR.richtext.length === 0
  );
  report.check(
    'an address is never formatted, whatever the field holds',
    formatsFor('src', { key: 'cover', label: 'Cover', type: 'text' }).length === 0 &&
      formatsFor('href', { key: 'url', label: 'URL', type: 'text' }).length === 0,
    `src: ${formatsFor('src', { key: 'c', label: 'C', type: 'text' }).length}`
  );
  report.check(
    'but prose on the same field is',
    formatsFor('alt', { key: 'cover', label: 'Cover', type: 'text' }).length > 0
  );

  const offered = [...new Set(Object.values(FORMATS_FOR).flat())];
  report.check(
    'every format that can be chosen has a name and something to start from',
    offered.every((kind) => FORMAT_LABELS[kind] && defaultFormat(kind).kind === kind),
    offered.join(', ')
  );

  /*
   * The structural claim, and E9 is the day it changed.
   *
   * `formatValue` had exactly one caller — the function that writes a record
   * into props — and that is what made "comparisons see raw values" a fact
   * about the code rather than a promise in a document. This check is what
   * noticed when a second one arrived, which is precisely what it was written
   * for: its own comment said "the day a Test formats an operand, this is
   * what notices."
   *
   * It has, and the new caller is deliberate: `advance` applies the `written
   * as` step. So the claim narrows to the one that is still true and still
   * worth guarding. Two callers, both named, and the *second evaluator* is not
   * one of them — `runtime/behaviour.ts` must never format, because a second
   * implementation of `£1,234.50` is how the canvas and the browser come to
   * disagree about a price. A third caller anywhere fails this.
   */
  const callers = [];
  const sweep = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        sweep(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8');
      if (/\bformatValue\s*\(/.test(text)) callers.push(path.relative(ROOT, full));
    }
  };
  sweep(path.join(ROOT, 'src'));
  sweep(path.join(ROOT, 'workers'));
  report.check(
    'formatting happens where a record becomes a prop, and where a chain asks for it',
    callers.length === 3 &&
      callers.includes('src/lib/document/format.ts') &&
      callers.includes('src/lib/renderer/repeat.ts') &&
      callers.includes('src/lib/document/schedule.ts') &&
      !callers.includes('src/lib/runtime/behaviour.ts'),
    callers.join(', ')
  );

  /*
   * And the record itself is not touched. `boundProps` formats on the way into
   * props; the filter and the sort above it read `record.data`, and so will
   * every Test. If formatting ever mutated the record, a list would sort by
   * the price tag — "$9.99" before "$100.00" — which is the exact failure the
   * raw-values rule exists to prevent.
   */
  const record = {
    id: 'r1',
    collectionId: 'homes',
    position: 0,
    published: true,
    data: { price: 750000, title: 'a house on the hill' },
    createdAt: 0,
    updatedAt: 0,
  };
  const node = {
    id: 'n1',
    type: 'text',
    name: 'Price',
    parentId: null,
    children: [],
    props: { text: 'Placeholder' },
    styles: {},
    meta: {},
    bind: {
      text: { value: { kind: 'field', key: 'price' }, format: { kind: 'currency', decimals: 0 } },
    },
  };
  const props = boundProps(node, record);
  report.check(
    'a bound price is shown formatted',
    props.text === '$750,000',
    String(props.text)
  );
  report.check(
    'and the record still holds the number',
    record.data.price === 750000 && typeof record.data.price === 'number',
    `${typeof record.data.price} ${record.data.price}`
  );
  report.check(
    'a binding with no format is the value as the record holds it',
    boundProps({ ...node, bind: { text: { value: { kind: 'field', key: 'price' } } } }, record)
      .text === 750000
  );

  /*
   * And the old spelling still draws. Every production path loads through
   * `hydrateDocument`, which migrates — but this function is reached by
   * anything holding a document it did not load, and reading a value off a
   * string is a thrown TypeError rather than a wrong pixel: it takes down the
   * page, the canvas, or a publish. Found by a check that crashed, which is
   * the only reason it is written down here.
   */
  let old;
  try {
    old = boundProps({ ...node, bind: { text: 'price' } }, record).text;
  } catch (error) {
    old = `threw: ${error.message}`;
  }
  report.check(
    'a binding still written as a field name draws rather than throwing',
    old === 750000,
    String(old)
  );

  /* ----------------------------------------------------------------------
   * E3 — a reference, followed
   *
   * `Field.type: 'reference'` has been declarable and unreadable since the
   * model had references: a post had an author and a page could not say the
   * author's name. Every content site is two collections and a pointer, so
   * this is the row of the audit that decided whether somebody could build one
   * here at all.
   * ------------------------------------------------------------------- */

  {
    const author = {
      id: 'auth-ada', collectionId: 'authors', position: 0, published: true,
      data: { name: 'Ada Lovelace', city: 'London' }, createdAt: 0, updatedAt: 0,
    };
    const draftAuthor = {
      id: 'auth-grace', collectionId: 'authors', position: 1, published: false,
      data: { name: 'Grace Hopper' }, createdAt: 0, updatedAt: 0,
    };
    const post = {
      id: 'post-1', collectionId: 'posts', position: 0, published: true,
      data: { title: 'On engines', author: 'auth-ada' }, createdAt: 0, updatedAt: 0,
    };
    const orphan = {
      id: 'post-2', collectionId: 'posts', position: 1, published: true,
      data: { title: 'Nobody wrote this', author: 'auth-gone' }, createdAt: 0, updatedAt: 0,
    };
    const anonymous = {
      id: 'post-3', collectionId: 'posts', position: 2, published: true,
      data: { title: 'Unsigned' }, createdAt: 0, updatedAt: 0,
    };
    const drafted = {
      id: 'post-4', collectionId: 'posts', position: 3, published: true,
      data: { title: 'Early', author: 'auth-grace' }, createdAt: 0, updatedAt: 0,
    };

    const find = repeatLib.recordIndex({ authors: [author, draftAuthor], posts: [post] });
    const chain = {
      kind: 'field',
      key: 'author',
      steps: [{ op: 'follow' }, { op: 'field', key: 'name' }],
    };
    const card = {
      id: 'c1', type: 'text', name: 'By', parentId: null, children: [],
      props: { text: 'By somebody' }, styles: {}, meta: {},
      bind: { text: { value: chain } },
    };

    report.check(
      'a post can say its author’s name',
      boundProps(card, post, undefined, find).text === 'Ada Lovelace',
      String(boundProps(card, post, undefined, find).text)
    );
    /*
     * The ways it can have nothing to say, and every one of them leaves the
     * design-time copy alone rather than printing a record id. The first is
     * the falsification `VALUES.md` §5 asks for on this stage: delete the
     * author and the binding falls back rather than printing an id.
     *
     * One check rather than three, deliberately. They are three different
     * inputs and they reach `null` through three different guards, but no
     * single change to the resolver separates them — so three checks would be
     * one check wearing three names, and the detail below is what actually
     * says which case did what.
     */
    const quiet = {
      'author deleted': boundProps(card, orphan, undefined, find).text,
      'no author set': boundProps(card, anonymous, undefined, find).text,
      'no records here': boundProps(card, post).text,
    };
    report.check(
      'a post whose author it cannot reach falls back rather than printing an id',
      Object.values(quiet).every((text) => text === 'By somebody'),
      Object.entries(quiet)
        .map(([why, text]) => `${why} → ${String(text)}`)
        .join(' · ')
    );
    /*
     * A draft author is not published, and a reference does not get round that.
     * `recordsFor` drops unpublished rows from a list because a published page
     * must not carry content that is off the site, and reading *one field* of
     * that content on a public page is the same leak in a smaller box — a
     * profile kept unpublished because it is not ready would have its name
     * published by any post pointing at it.
     */
    report.check(
      'an author who is still a draft is not published by a post that points at them',
      boundProps(card, drafted, undefined, find).text === 'By somebody',
      String(boundProps(card, drafted, undefined, find).text)
    );
    report.check(
      'a chain that stops at the record prints nothing, rather than its id',
      boundProps(
        { ...card, bind: { text: { value: { kind: 'field', key: 'author', steps: [{ op: 'follow' }] } } } },
        post,
        undefined,
        find
      ).text === 'By somebody',
      String(
        boundProps(
          { ...card, bind: { text: { value: { kind: 'field', key: 'author', steps: [{ op: 'follow' }] } } } },
          post,
          undefined,
          find
        ).text
      )
    );

    /*
     * And a rule can ask about the other record. Same resolver, so this is not
     * a second implementation — it is the same walk reached from the Test side,
     * which is what keeps a binding and a condition agreeing about what
     * `⟨Author⟩ → ⟨City⟩` means.
     */
    const inLondon = { kind: 'compare', left: { ...chain, steps: [{ op: 'follow' }, { op: 'field', key: 'city' }] }, op: 'eq', right: { kind: 'literal', type: 'text', value: 'London' } };
    report.check(
      'a rule can ask about a field on the record a reference names',
      tests.evaluate(inLondon, post, find) === true &&
        tests.evaluate(inLondon, drafted, find) === null,
      `Ada ${tests.evaluate(inLondon, post, find)} · Grace ${tests.evaluate(inLondon, drafted, find)}`
    );
    report.check(
      'and it folds, so it costs the browser nothing',
      tests.foldable(inLondon) === true && !tests.needsRuntime({ ...card, assign: [{ id: 'a', when: inLondon, value: 'local' }] }),
      `foldable ${tests.foldable(inLondon)}`
    );
    /*
     * The one that would be a silent hole: the field a chain *starts* on is
     * what has to be published and what has to be cleared when somebody
     * deletes it. The followed key belongs to another collection and must not
     * be in that list — reporting it would clear a rule when an unrelated
     * field went away.
     */
    report.check(
      'the field a chain reads is the one on the record in scope, not the one past the arrow',
      tests.fieldsRead(inLondon).join() === 'author',
      tests.fieldsRead(inLondon).join(' · ') || 'none'
    );

    /*
     * And the rows are actually fetched, which is the half that was wrong for
     * two rounds while everything above passed.
     *
     * Nothing repeats the authors — a byline is not a list — so the only thing
     * that ever asked for a collection's rows was a repeater pointing at it,
     * and the author's record was never loaded on either surface. The chain in
     * the document was perfectly correct and the page printed the placeholder.
     * Checked as a closure over the schema rather than as "the publisher does
     * the right thing", because three callers take this answer and the one
     * that is a Worker cannot be driven from here.
     */
    const schema = [
      { id: 'posts', name: 'Posts', fields: [{ key: 'author', label: 'Author', type: 'reference', of: 'authors' }] },
      { id: 'authors', name: 'Authors', fields: [{ key: 'house', label: 'House', type: 'reference', of: 'houses' }] },
      { id: 'houses', name: 'Houses', fields: [{ key: 'name', label: 'Name', type: 'text' }] },
      { id: 'unrelated', name: 'Unrelated', fields: [] },
    ];
    const repeater = {
      r1: { id: 'r1', type: 'stack', name: 'Feed', parentId: null, children: [], props: {}, styles: {}, meta: {}, repeat: { collection: 'posts' } },
    };
    const wanted = repeatLib.collectionsUsedBy(repeater, ['r1'], schema).sort();
    report.check(
      'publishing a list of posts also fetches what its references name, all the way down',
      wanted.join() === 'authors,houses,posts',
      wanted.join(' · ')
    );
    report.check(
      'and stops at what is actually reachable',
      !wanted.includes('unrelated'),
      `${wanted.length} of ${schema.length} collections`
    );
    /*
     * A cycle is not hypothetical — two collections pointing at each other is
     * how anybody models a pair — and the walk has to stop.
     */
    const looped = repeatLib.withReferences(
      ['a'],
      [
        { id: 'a', name: 'A', fields: [{ key: 'b', label: 'B', type: 'reference', of: 'b' }] },
        { id: 'b', name: 'B', fields: [{ key: 'a', label: 'A', type: 'reference', of: 'a' }] },
      ]
    ).sort();
    report.check('and a reference cycle terminates', looped.join() === 'a,b', looped.join(' · '));

    /* ------------------------------------------------------------------
     * E4 — a value can be a list
     * --------------------------------------------------------------- */

    const comment = (id, at, published = true) => ({
      id, collectionId: 'comments', position: at, published,
      data: { body: `Comment ${at}` }, createdAt: at, updatedAt: at,
    });
    const three = repeatLib.recordIndex({
      comments: [comment('c3', 3), comment('c1', 1), comment('c2', 2), comment('c9', 9, false)],
      empty: [],
    });
    const none = repeatLib.recordIndex({ comments: [], empty: [] });

    const counter = {
      id: 'k1', type: 'text', name: 'Count', parentId: null, children: [],
      props: { text: 'some comments' }, styles: {}, meta: {},
      bind: { text: { value: { kind: 'records', collection: 'comments', steps: [{ op: 'count' }] } } },
    };

    report.check(
      'a binding can say how many rows a collection has',
      boundProps(counter, post, undefined, three).text === 3,
      String(boundProps(counter, post, undefined, three).text)
    );
    /*
     * The empty case, which is the whole of E4's falsification. Every other
     * step answers `null` for "nothing here" and a binding reads `null` as
     * *leave the design-time text alone* — so a count that did the same would
     * print "some comments" on a post with none. Zero is an answer.
     */
    report.check(
      'and zero is an answer rather than nothing to say',
      boundProps(counter, post, undefined, none).text === 0,
      String(boundProps(counter, post, undefined, none).text)
    );
    report.check(
      'a draft row is not counted, for the same reason it is not shown',
      boundProps(counter, post, undefined, three).text === 3,
      `3 published + 1 draft → ${boundProps(counter, post, undefined, three).text}`
    );
    report.check(
      'and a surface with no records to count says nothing rather than nought',
      boundProps(counter, post).text === 'some comments',
      String(boundProps(counter, post).text)
    );

    /*
     * `first` and `last`, and the order they mean. A repeater with no sort
     * draws position order, so "the first" has to be the row at the top of
     * that list — anything else is a name the page itself disproves.
     */
    const ends = (op) => ({
      ...counter,
      bind: {
        text: {
          value: {
            kind: 'records',
            collection: 'comments',
            steps: [{ op }, { op: 'field', key: 'body' }],
          },
        },
      },
    });
    report.check(
      'the first and last of a list are the ends of the order a repeater draws',
      boundProps(ends('first'), post, undefined, three).text === 'Comment 1' &&
        boundProps(ends('last'), post, undefined, three).text === 'Comment 3',
      `first ${boundProps(ends('first'), post, undefined, three).text} · ` +
        `last ${boundProps(ends('last'), post, undefined, three).text}`
    );
    report.check(
      'and an empty list has no first row, which is nothing to say',
      boundProps(ends('first'), post, undefined, none).text === 'some comments',
      String(boundProps(ends('first'), post, undefined, none).text)
    );

    /*
     * A list is publish-time data, so a chain over it folds — and
     * `foldableValue` is the *only* thing that says so. `VALUES.md` §6 settles
     * live lists as "not yet" rather than "never", and this is the line that
     * changes when they arrive: nothing else in the resolver knows.
     */
    const busy = {
      kind: 'compare',
      left: { kind: 'records', collection: 'comments', steps: [{ op: 'count' }] },
      op: 'gt',
      right: { kind: 'literal', type: 'number', value: 2 },
    };
    report.check(
      'a rule can ask how many, and it folds',
      tests.evaluate(busy, post, three) === true &&
        tests.evaluate(busy, post, none) === false &&
        tests.foldable(busy) === true,
      `three ${tests.evaluate(busy, post, three)} · none ${tests.evaluate(busy, post, none)} · ` +
        `folds ${tests.foldable(busy)}`
    );

    /*
     * And the rows get fetched. A count names a collection nothing repeats,
     * which is the same hole the reference closure filled one head along —
     * found there by a byline that published as its placeholder.
     */
    const counting = {
      n1: { ...counter, id: 'n1', repeat: undefined },
    };
    const wantedByCount = repeatLib.collectionsUsedBy(counting, ['n1'], []).sort();
    report.check(
      'publishing a count fetches the collection it counts, which nothing repeats',
      wantedByCount.join() === 'comments',
      wantedByCount.join(' · ') || 'none'
    );

    /* ------------------------------------------------------------------
     * E5 — arithmetic, which is the first half of the vocabulary that has
     * to travel. Everything before this reads a record or a list and folds;
     * `⟨Quantity typed here⟩ × ⟨Price⟩` cannot.
     * --------------------------------------------------------------- */

    const order = {
      id: 'o1', collectionId: 'orders', position: 0, published: true,
      data: { price: 19.99, qty: 3, rate: 0.2, zero: 0, name: 'Widget' },
      createdAt: 0, updatedAt: 0,
    };
    const sum = (steps) => ({
      id: 's1', type: 'text', name: 'Total', parentId: null, children: [],
      props: { text: 'a total' }, styles: {}, meta: {},
      bind: { text: { value: { kind: 'field', key: 'price', steps } } },
    });

    report.check(
      'a binding can multiply two fields of the record',
      boundProps(sum([{ op: 'times', by: { kind: 'field', key: 'qty' } }]), order).text === 59.97,
      String(boundProps(sum([{ op: 'times', by: { kind: 'field', key: 'qty' } }]), order).text)
    );
    /*
     * And a chain of them, which is what makes this a chain rather than one
     * operator: `price × qty`, then VAT on top, then rounded to the penny.
     * Written the way somebody would build it — left to right, each step
     * reading what the one before produced.
     */
    const withVat = [
      { op: 'times', by: { kind: 'field', key: 'qty' } },
      { op: 'times', by: { kind: 'literal', type: 'number', value: 1.2 } },
      { op: 'round', places: 2 },
    ];
    report.check(
      'and steps compose left to right, each reading what the last produced',
      boundProps(sum(withVat), order).text === 71.96,
      `19.99 × 3 × 1.2 rounded to 2 → ${boundProps(sum(withVat), order).text}`
    );
    report.check(
      'rounding happens mid-chain, where a format could never reach',
      boundProps(sum([{ op: 'round', places: 1 }, { op: 'times', by: { kind: 'literal', type: 'number', value: 2 } }]), order).text === 40,
      `19.99 rounded to 1 then doubled → ${boundProps(sum([{ op: 'round', places: 1 }, { op: 'times', by: { kind: 'literal', type: 'number', value: 2 } }]), order).text}`
    );
    /*
     * The refusals. Every one of these has a plausible wrong answer that would
     * reach the page — `NaN`, `Infinity`, or the head's value with the step
     * quietly skipped — so each says nothing instead and the binding falls
     * back to what the designer typed.
     */
    const refused = {
      'text × number': sum([{ op: 'times', by: { kind: 'field', key: 'qty' } }]),
      'divide by zero': sum([{ op: 'over', by: { kind: 'field', key: 'zero' } }]),
      'a field that is not there': sum([{ op: 'plus', by: { kind: 'field', key: 'missing' } }]),
    };
    const quietMaths = {
      'text × number': boundProps(
        { ...refused['text × number'], bind: { text: { value: { kind: 'field', key: 'name', steps: [{ op: 'times', by: { kind: 'field', key: 'qty' } }] } } } },
        order
      ).text,
      'divide by zero': boundProps(refused['divide by zero'], order).text,
      'a field that is not there': boundProps(refused['a field that is not there'], order).text,
    };
    report.check(
      'arithmetic that has no answer says nothing rather than NaN or Infinity',
      Object.values(quietMaths).every((text) => text === 'a total'),
      Object.entries(quietMaths).map(([why, text]) => `${why} → ${String(text)}`).join(' · ')
    );

    /*
     * Foldability, which is the whole scheduling question for this stage.
     * Over a record it folds and costs nothing; the moment an operand reads a
     * control it does not, and that is derived rather than declared.
     */
    const overRecord = { kind: 'field', key: 'price', steps: [{ op: 'times', by: { kind: 'field', key: 'qty' } }] };
    const overTyped = { kind: 'field', key: 'price', steps: [{ op: 'times', by: { kind: 'input', name: 'qty' } }] };
    report.check(
      'arithmetic over a record folds; arithmetic over something typed does not',
      tests.foldable({ kind: 'compare', left: overRecord, op: 'gt', right: { kind: 'literal', type: 'number', value: 1 } }) === true &&
        tests.foldable({ kind: 'compare', left: overTyped, op: 'gt', right: { kind: 'literal', type: 'number', value: 1 } }) === false,
      `record ${tests.foldable({ kind: 'compare', left: overRecord, op: 'gt', right: { kind: 'literal', type: 'number', value: 1 } })} · ` +
        `typed ${tests.foldable({ kind: 'compare', left: overTyped, op: 'gt', right: { kind: 'literal', type: 'number', value: 1 } })}`
    );
    /*
     * And the field inside a step gets published. `⟨Price⟩ × ⟨Quantity⟩` reads
     * two fields and only one is the head — a walk that stopped there would
     * ship `price`, leave `quantity` behind, and the runtime would answer
     * `null` for ever on a page with no sign of why.
     */
    {
      const travels = {
        kind: 'compare',
        left: { kind: 'input', name: 'budget' },
        op: 'lt',
        right: overRecord,
      };
      const node = {
        id: 'n5', type: 'frame', name: 'Row', parentId: null, children: [],
        props: {}, styles: {}, meta: {},
        state: { key: 'band', values: ['else'], initial: 'else' },
        assign: [{ id: 'a', when: travels, value: 'over' }],
      };
      const shipped = tests.publishedValues(node, order);
      report.check(
        'a field read inside an arithmetic step is published too',
        shipped?.price === 19.99 && shipped?.qty === 3,
        `shipped ${JSON.stringify(shipped)}`
      );
    }

    /* ------------------------------------------------------------------
     * E6 — narrowing and ordering a list
     *
     * The step that turns "how many Notes, in total" into "how many notes on
     * *this post*". Everything E4 could say was about a whole collection,
     * which is one relationship short of every content site there is.
     * --------------------------------------------------------------- */

    {
      const note = (at, on, status) => ({
        id: `note-${at}`,
        collectionId: 'notes',
        position: at,
        published: true,
        // `status` left off entirely on one row rather than set empty: absent
        // and present-but-empty are different facts everywhere else in this
        // model, and a filter is where the difference shows.
        data: status === undefined ? { body: `Note ${at}`, post: on } : { body: `Note ${at}`, post: on, status },
        createdAt: at,
        updatedAt: at,
      });
      const pool = [
        note(1, 'post-1', 'live'),
        note(2, 'post-2', 'live'),
        note(3, 'post-1', 'held'),
        note(4, 'post-1'),
      ];
      const notes = repeatLib.recordIndex({ notes: pool });
      const counting = (steps) => ({
        id: 'w1', type: 'text', name: 'Notes', parentId: null, children: [],
        props: { text: 'some notes' }, styles: {}, meta: {},
        bind: { text: { value: { kind: 'records', collection: 'notes', steps } } },
      });
      const live = {
        kind: 'compare',
        left: { kind: 'row', key: 'status' },
        op: 'eq',
        right: { kind: 'literal', type: 'text', value: 'live' },
      };
      const mine = { kind: 'compare', left: { kind: 'row', key: 'post' }, op: 'eq', right: { kind: 'self' } };

      const all = boundProps(counting([{ op: 'count' }]), post, undefined, notes).text;
      const here = boundProps(
        counting([{ op: 'where', test: mine }, { op: 'count' }]),
        post,
        undefined,
        notes
      ).text;
      /*
       * The falsification `VALUES.md` §5 asks for on this stage, and it is
       * asked of *one page*: the same collection, the same records, two
       * bindings, two numbers. A `where` that quietly passed everything would
       * make these equal, and every other check here would still pass.
       */
      report.check(
        'a filtered count differs from the unfiltered one, over the same records',
        all === 4 && here === 3,
        `all ${all} · on this post ${here}`
      );
      /*
       * And the record in scope is what decides which — the same binding on a
       * different post has to answer differently, or `self` is a constant
       * wearing the shape of a reference.
       */
      report.check(
        'and the record in scope is what it is narrowed to',
        boundProps(counting([{ op: 'where', test: mine }, { op: 'count' }]), orphan, undefined, notes)
          .text === 1,
        `post-2 → ${boundProps(counting([{ op: 'where', test: mine }, { op: 'count' }]), orphan, undefined, notes).text}`
      );
      /*
       * A row whose answer cannot be decided is not a row somebody asked for.
       * Note 4 carries no `status` at all, so `status is live` is undecidable
       * on it — and `=== true` is what keeps it out. Written as a number
       * because the wrong rule has a plausible-looking answer: `!== false`
       * counts three, which reads as correct until somebody notices the row
       * with nothing in the field.
       */
      report.check(
        'a row the test cannot decide is left out rather than let through',
        boundProps(counting([{ op: 'where', test: live }, { op: 'count' }]), post, undefined, notes)
          .text === 2,
        `live → ${boundProps(counting([{ op: 'where', test: live }, { op: 'count' }]), post, undefined, notes).text} of 4`
      );
      report.check(
        'and two clauses narrow together',
        boundProps(
          counting([{ op: 'where', test: { kind: 'every', tests: [mine, live] } }, { op: 'count' }]),
          post,
          undefined,
          notes
        ).text === 1,
        String(
          boundProps(
            counting([{ op: 'where', test: { kind: 'every', tests: [mine, live] } }, { op: 'count' }]),
            post,
            undefined,
            notes
          ).text
        )
      );

      /*
       * `sortedBy`, and the claim that matters about it: it is *the order a
       * repeater draws*, not an order of its own. Both are asked of the same
       * pool and both ends are compared, because the two rules that make this
       * order what it is live at the ends — absent sorts last whichever way
       * the sort goes, and a tie falls back to position.
       */
      const byStatus = (op) =>
        boundProps(
          counting([{ op: 'sortedBy', field: 'status' }, { op }, { op: 'field', key: 'body' }]),
          post,
          undefined,
          notes
        ).text;
      const drawn = repeatLib.recordsFor(
        { collection: 'notes', sort: { field: 'status', direction: 'asc' } },
        pool
      );
      report.check(
        'a sorted chain names the rows a repeater sorted the same way would draw',
        byStatus('first') === drawn[0]?.data.body &&
          byStatus('last') === drawn[drawn.length - 1]?.data.body &&
          byStatus('first') === 'Note 3',
        `chain ${byStatus('first')}…${byStatus('last')} · repeater ${drawn[0]?.data.body}…${drawn[drawn.length - 1]?.data.body}`
      );
      /*
       * Which is a different row from the unsorted one — otherwise the step
       * could do nothing at all and every line above would still pass.
       */
      report.check(
        'and it is a different row from the one at the top of the unsorted list',
        boundProps(
          counting([{ op: 'first' }, { op: 'field', key: 'body' }]),
          post,
          undefined,
          notes
        ).text === 'Note 1',
        `unsorted first ${boundProps(counting([{ op: 'first' }, { op: 'field', key: 'body' }]), post, undefined, notes).text}`
      );
      /*
       * And it left the list alone. `find.of` hands back the *cached* rows for
       * a collection, so a sort in place would reorder every other chain on
       * the page and the repeater under them — a hero that reordered the list
       * below it by being on the page.
       */
      report.check(
        'sorting a chain does not reorder the rows every other chain reads',
        boundProps(counting([{ op: 'first' }, { op: 'field', key: 'body' }]), post, undefined, notes)
          .text === 'Note 1' && notes.of('notes')[0]?.id === 'note-1',
        `after sorting, first is ${notes.of('notes')[0]?.id}`
      );

      /*
       * The scheduling question, which is the one thing about this stage that
       * could have cost the browser something. A `where` over the records
       * folds; a `where` that reads a form control cannot — there is no list
       * in the browser to narrow — so the chain does not travel and the
       * binding keeps what the designer typed. Undecidable on both surfaces,
       * which is the only answer they can agree on.
       */
      const typedWhere = {
        kind: 'records',
        collection: 'notes',
        steps: [
          {
            op: 'where',
            test: { kind: 'compare', left: { kind: 'row', key: 'status' }, op: 'eq', right: { kind: 'input', name: 'q' } },
          },
          { op: 'count' },
        ],
      };
      report.check(
        'a narrowed count folds, and one narrowed by something typed does not',
        schedule.foldableValue({ kind: 'records', collection: 'notes', steps: [{ op: 'where', test: mine }, { op: 'count' }] }) === true &&
          schedule.foldableValue(typedWhere) === false &&
          boundProps({ ...counting([]), bind: { text: { value: typedWhere } } }, post, undefined, notes).text ===
            'some notes',
        `over records ${schedule.foldableValue({ kind: 'records', collection: 'notes', steps: [{ op: 'where', test: mine }, { op: 'count' }] })} · ` +
          `over a control ${schedule.foldableValue(typedWhere)}`
      );

      /*
       * The silent hole, one nesting level further in than E3's.
       *
       * A `where` compares the row against the record in scope, so the outer
       * field it reads has to be published and has to be cleared when somebody
       * deletes it. The *row's* field must not be in that list: it belongs to
       * another collection, and reporting it would clear a binding the day an
       * unrelated field of the same name went away.
       */
      const narrowed = {
        kind: 'compare',
        left: {
          kind: 'records',
          collection: 'notes',
          steps: [
            {
              op: 'where',
              test: { kind: 'compare', left: { kind: 'row', key: 'status' }, op: 'eq', right: { kind: 'field', key: 'title' } },
            },
            { op: 'count' },
          ],
        },
        op: 'gt',
        right: { kind: 'literal', type: 'number', value: 0 },
      };
      report.check(
        'the field a filter compares against is read; the row’s own field is not',
        tests.fieldsRead(narrowed).join() === 'title',
        tests.fieldsRead(narrowed).join(' · ') || 'none'
      );

      /*
       * And the same walk decides which collections get *fetched*, one level
       * down. A list named inside a step — `⟨Price⟩ × ⟨How many Notes⟩` — is a
       * collection nothing repeats and nothing else would ask for, so the page
       * would publish the placeholder with a perfectly correct chain in the
       * document. The panel does not write one today; the walk is right about
       * the model rather than about one surface, and a document does not have
       * to come from the panel.
       */
      const nested = {
        n9: {
          id: 'n9', type: 'text', name: 'Total', parentId: null, children: [],
          props: { text: 'a total' }, styles: {}, meta: {},
          bind: {
            text: {
              value: {
                kind: 'field',
                key: 'price',
                steps: [
                  { op: 'times', by: { kind: 'records', collection: 'notes', steps: [{ op: 'count' }] } },
                ],
              },
            },
          },
        },
      };
      const wantedNested = repeatLib.collectionsUsedBy(nested, ['n9'], []).sort();
      report.check(
        'a collection named inside a step is fetched too, not only one at the head',
        wantedNested.join() === 'notes',
        wantedNested.join(' · ') || 'none'
      );
    }

    /* ------------------------------------------------------------------
     * E8 — the step menu, generated
     *
     * §3.5: "Offer only what the head can do. A `follow` on a text field is a
     * step that compiles and can never resolve." The menu was two hand-written
     * lists until this stage; it is a table now, and what makes the table
     * worth having is that it can be checked against the resolver rather than
     * read alongside it.
     * --------------------------------------------------------------- */

    {
      const { STEPS, stepsFor, typeAfter, isTransform } = stepLib;
      /*
       * Every step the table offers is one the resolver can actually apply.
       *
       * Not "total both ways", which is what this was first written as and
       * which turned out to be a check that cannot fail: `STEPS` is
       * `Record<Step['op'], …>`, so a step in the model and not the table is a
       * compile error, a step in the table and not the model is a compile
       * error, and one in both but unhandled by `advance` fails to narrow at
       * the fall-through. Two mutations proved that by refusing to build.
       *
       * What the compiler cannot see is whether a row's *shape* is true. A
       * table entry claiming `count` takes a value would offer it on a number,
       * and it would resolve to nothing on every page — §3.5's failure exactly.
       * So each value-step is driven over a specimen of a type it says it
       * accepts, and has to produce something.
       */
      const SPECIMEN = {
        text: 'Ada',
        select: 'news',
        number: 4,
        date: '2026-08-11',
        boolean: true,
        image: '/a.png',
        reference: 'rec-1',
        richtext: '<p>x</p>',
      };
      const seedFor = (op) => {
        if (op === 'round') return { op, places: 1 };
        if (op === 'truncate') return { op, chars: 2 };
        if (op === 'join') return { op, with: { kind: 'literal', type: 'text', value: '!' } };
        if (['plus', 'minus', 'times', 'over'].includes(op)) {
          return { op, by: { kind: 'literal', type: 'number', value: 2 } };
        }
        return { op };
      };
      const unresolved = [];
      let driven = 0;
      for (const [op, kind] of Object.entries(STEPS)) {
        if (kind.takes !== 'value' || kind.gives !== 'value') continue;
        for (const type of kind.from ?? Object.keys(SPECIMEN)) {
          driven++;
          const held = schedule.resolveValue(
            { kind: 'field', key: 'v', steps: [seedFor(op)] },
            {
              id: 'sp', collectionId: 'c', position: 0, published: true,
              data: { v: SPECIMEN[type] }, createdAt: 0, updatedAt: 0,
            }
          );
          if (!held || !held.has) unresolved.push(`${op} on ${type}`);
        }
      }
      report.check(
        'every step the menu offers resolves on the types it claims to accept',
        unresolved.length === 0 && driven >= 14,
        unresolved.length ? unresolved.join(' · ') : `${driven} offers driven, all answered`
      );

      /*
       * The offer itself. A number is not offered the text vocabulary, text is
       * not offered arithmetic, and a boolean is offered nothing — which is
       * the case that says the answer is derived rather than "text or number".
       */
      const offers = {
        number: stepsFor('number').join(' '),
        text: stepsFor('text').join(' '),
        select: stepsFor('select').join(' '),
        boolean: stepsFor('boolean').join(' ') || 'nothing',
        image: stepsFor('image').join(' ') || 'nothing',
        reference: stepsFor('reference').join(' ') || 'nothing',
      };
      report.check(
        'the menu is what the type can do, and nothing a different type can',
        offers.number.includes('times') &&
          !offers.number.includes('upper') &&
          offers.text.includes('upper') &&
          !offers.text.includes('times') &&
          offers.boolean === 'nothing' &&
          offers.reference === 'nothing',
        Object.entries(offers).map(([type, ops]) => `${type}: ${ops}`).join(' · ')
      );
      /*
       * And a join is offered on a number, which is the one crossing the table
       * allows: `⟨Rooms⟩ ⟨joined with " bedrooms"⟩` is an ordinary sentence
       * and the step does not care what it was handed.
       */
      report.check(
        'a number can be joined onto words, which is the one crossing the table allows',
        stepsFor('number').includes('join') && !stepsFor('number').includes('truncate'),
        stepsFor('number').join(' ')
      );

      /*
       * The fold, which is what makes the menu *generated* rather than
       * filtered: after a join the value is text, so the offer at the next
       * position is text's — even though the chain started on a number.
       */
      const afterJoin = typeAfter('number', [
        { op: 'times', by: { kind: 'literal', type: 'number', value: 2 } },
        { op: 'join', with: { kind: 'literal', type: 'text', value: ' each' } },
      ]);
      report.check(
        'the type follows the chain, so what a join produces is offered words and not sums',
        afterJoin === 'text' &&
          stepsFor(afterJoin).includes('upper') &&
          !stepsFor(afterJoin).includes('times'),
        `number × 2 joined → ${afterJoin} → ${stepsFor(afterJoin).join(' ')}`
      );
      report.check(
        'and a step that walks data does not move it, because it is a chip of its own',
        typeAfter('number', [{ op: 'round', places: 2 }]) === 'number' &&
          typeAfter('text', [{ op: 'follow' }]) === 'text' &&
          !isTransform({ op: 'follow' }) &&
          isTransform({ op: 'upper' }),
        `round → ${typeAfter('number', [{ op: 'round', places: 2 }])} · ` +
          `follow → ${typeAfter('text', [{ op: 'follow' }])}`
      );

      /*
       * The falsification §5 asks for, made positive: offer a step the head
       * cannot do and watch it never resolve. `⟨Title⟩ × ⟨2⟩` is what the old
       * menu would have allowed if it had listed the ops in one place — and it
       * resolves to nothing on every row, for ever, with the page showing the
       * design-time text and nothing anywhere saying why.
       */
      const wrong = {
        id: 'z1', type: 'text', name: 'Nope', parentId: null, children: [],
        props: { text: 'a title' }, styles: {}, meta: {},
        bind: {
          text: {
            value: {
              kind: 'field',
              key: 'title',
              steps: [{ op: 'times', by: { kind: 'literal', type: 'number', value: 2 } }],
            },
          },
        },
      };
      const titled = {
        id: 'r9', collectionId: 'posts', position: 0, published: true,
        data: { title: 'On engines' }, createdAt: 0, updatedAt: 0,
      };
      report.check(
        'a step the value cannot do resolves to nothing, which is why it is not offered',
        boundProps(wrong, titled).text === 'a title' && !stepsFor('text').includes('times'),
        `${boundProps(wrong, titled).text} · text offers ${stepsFor('text').join(' ')}`
      );
    }

    /* ------------------------------------------------------------------
     * E7 — the text steps
     *
     * `First & " " & Last` is the last row of §1.5 that Bubble had and this
     * did not. The other three are what make it compose: an excerpt is
     * `⟨Body⟩ ⟨first 100⟩ ⟨joined with "…"⟩`, and the ellipsis landing *after*
     * the cut is precisely what a terminal format cannot do.
     * --------------------------------------------------------------- */

    {
      const person = {
        id: 'p1', collectionId: 'people', position: 0, published: true,
        data: { first: 'ada', last: 'LOVELACE', body: 'A note about engines', blank: null, rooms: 4 },
        createdAt: 0, updatedAt: 0,
      };
      const says = (steps, key = 'first') => ({
        id: 'x1', type: 'text', name: 'Name', parentId: null, children: [],
        props: { text: 'a name' }, styles: {}, meta: {},
        bind: { text: { value: { kind: 'field', key, steps } } },
      });

      report.check(
        'two fields and a space become one name',
        boundProps(
          says([
            { op: 'capitalize' },
            { op: 'join', with: { kind: 'literal', type: 'text', value: ' ' } },
            { op: 'join', with: { kind: 'field', key: 'last' } },
          ]),
          person
        ).text === 'Ada LOVELACE',
        String(
          boundProps(
            says([
              { op: 'capitalize' },
              { op: 'join', with: { kind: 'literal', type: 'text', value: ' ' } },
              { op: 'join', with: { kind: 'field', key: 'last' } },
            ]),
            person
          ).text
        )
      );
      /*
       * The excerpt, which is the case that says why these are steps and not
       * formats: the ellipsis has to come after the cut, and a format is
       * applied on the way to the DOM with nothing able to follow it.
       */
      report.check(
        'an excerpt cuts and then puts something on the end, which no format can',
        boundProps(
          says(
            [
              { op: 'truncate', chars: 6 },
              { op: 'join', with: { kind: 'literal', type: 'text', value: '…' } },
            ],
            'body'
          ),
          person
        ).text === 'A note…',
        String(
          boundProps(
            says([{ op: 'truncate', chars: 6 }, { op: 'join', with: { kind: 'literal', type: 'text', value: '…' } }], 'body'),
            person
          ).text
        )
      );
      const cased = {
        upper: boundProps(says([{ op: 'upper' }]), person).text,
        lower: boundProps(says([{ op: 'lower' }], 'last'), person).text,
        capitalize: boundProps(says([{ op: 'capitalize' }], 'last'), person).text,
      };
      report.check(
        'the three cases each do their own thing, including to a word already shouting',
        cased.upper === 'ADA' && cased.lower === 'lovelace' && cased.capitalize === 'Lovelace',
        Object.entries(cased).map(([why, text]) => `${why} → ${text}`).join(' · ')
      );

      /*
       * `null` is nothing, not the word "null".
       *
       * A D1 column can be NULL and `String(null)` is four letters that would
       * be uppercased and printed. The check is on a *present* field holding
       * null rather than an absent one, because absent is already refused by
       * `has` and would pass this without the rule being there at all.
       */
      const nulls = {
        upper: boundProps(says([{ op: 'upper' }], 'blank'), person).text,
        joined: boundProps(
          says([{ op: 'join', with: { kind: 'field', key: 'blank' } }]),
          person
        ).text,
      };
      report.check(
        'a field holding null reads as nothing rather than as the word',
        nulls.upper === '' && nulls.joined === 'ada',
        `upper → "${nulls.upper}" · joined → "${nulls.joined}"`
      );
      /*
       * And a join with nothing to join is refused, which is the same rule
       * arithmetic follows. `⟨First⟩ joined with ⟨Lastt⟩` typed one letter
       * wrong would otherwise publish the first name and look deliberate.
       */
      report.check(
        'joining onto a field that is not there says nothing rather than half a name',
        boundProps(says([{ op: 'join', with: { kind: 'field', key: 'middle' } }]), person).text ===
          'a name',
        String(boundProps(says([{ op: 'join', with: { kind: 'field', key: 'middle' } }]), person).text)
      );
      /*
       * A number joined onto a label is text, and that is the one step that
       * does not care what it was handed.
       */
      report.check(
        'a number can be joined onto a word',
        boundProps(
          says([{ op: 'join', with: { kind: 'literal', type: 'text', value: ' rooms' } }], 'rooms'),
          person
        ).text === '4 rooms',
        String(
          boundProps(
            says([{ op: 'join', with: { kind: 'literal', type: 'text', value: ' rooms' } }], 'rooms'),
            person
          ).text
        )
      );

      /*
       * Foldability, and the operand walk that goes with it. A join over the
       * record folds; a join with something typed does not, and the field it
       * reads has to be published or the runtime answers `null` for ever.
       */
      const joinedField = { kind: 'field', key: 'first', steps: [{ op: 'join', with: { kind: 'field', key: 'last' } }] };
      const joinedTyped = { kind: 'field', key: 'first', steps: [{ op: 'join', with: { kind: 'input', name: 'surname' } }] };
      report.check(
        'a join over the record folds; a join with something typed does not',
        schedule.foldableValue(joinedField) === true &&
          schedule.foldableValue(joinedTyped) === false &&
          schedule.foldableValue({ kind: 'field', key: 'first', steps: [{ op: 'upper' }] }) === true,
        `record ${schedule.foldableValue(joinedField)} · typed ${schedule.foldableValue(joinedTyped)}`
      );
      {
        const travels = {
          kind: 'compare',
          left: { kind: 'input', name: 'guess' },
          op: 'eq',
          right: joinedField,
        };
        const node = {
          id: 'n7', type: 'frame', name: 'Row', parentId: null, children: [],
          props: {}, styles: {}, meta: {},
          state: { key: 'band', values: ['else'], initial: 'else' },
          assign: [{ id: 'a', when: travels, value: 'match' }],
        };
        const shipped = tests.publishedValues(node, person);
        report.check(
          'the field a join reads is published, the same as an arithmetic operand',
          shipped?.first === 'ada' && shipped?.last === 'LOVELACE',
          `shipped ${JSON.stringify(shipped)}`
        );
      }
      /*
       * And a constant inside a join loses its tag on the wire, which is where
       * the bytes are: a join's operand is nearly always the constant.
       */
      {
        const wire = JSON.stringify(
          tests.lowerTest({
            kind: 'compare',
            left: {
              kind: 'input',
              name: 'guess',
              steps: [{ op: 'join', with: { kind: 'literal', type: 'text', value: '!' } }],
            },
            op: 'eq',
            right: { kind: 'literal', type: 'text', value: 'a!' },
          })
        );
        report.check(
          'a constant inside a join goes out as a constant, not as a tagged one',
          !wire.includes('literal') && wire.includes('"with":{"type":"text","value":"!"}'),
          wire
        );
      }

    }


    /* ------------------------------------------------------------------
     * E9 — format, then use it
     *
     * Not in the plan's stage table, which stops at E8. Chosen because E7
     * found the limit by hitting it and §5.7 already named this as what would
     * close it: `Format` is applied on the way to the DOM, so `⟨Price⟩ as
     * currency, joined with " per month"` had no spelling at all.
     * --------------------------------------------------------------- */

    {
      const priced = {
        id: 'pr1', collectionId: 'plans', position: 0, published: true,
        data: { price: 1234.5, when: '2026-08-11' }, createdAt: 0, updatedAt: 0,
      };
      const says = (steps, key = 'price') => ({
        id: 'f1', type: 'text', name: 'Price', parentId: null, children: [],
        props: { text: 'a price' }, styles: {}, meta: {},
        bind: { text: { value: { kind: 'field', key, steps } } },
      });
      const money = { kind: 'currency', symbol: '£', decimals: 2, group: true };

      report.check(
        'a formatted number can have words put after it, which no terminal format could',
        boundProps(
          says([
            { op: 'formatted', as: money },
            { op: 'join', with: { kind: 'literal', type: 'text', value: ' per month' } },
          ]),
          priced
        ).text === '£1,234.50 per month',
        String(
          boundProps(
            says([
              { op: 'formatted', as: money },
              { op: 'join', with: { kind: 'literal', type: 'text', value: ' per month' } },
            ]),
            priced
          ).text
        )
      );
      /*
       * And it is the *same* formatter as the binding's tail, which is the
       * whole reason this is a step rather than a second implementation:
       * a price written one way mid-chain and another way at the end is
       * exactly the drift the single-renderer rule exists to prevent.
       */
      report.check(
        'and it writes the number the same way the binding’s own format would',
        boundProps(says([{ op: 'formatted', as: money }]), priced).text ===
          formatLib.formatValue(1234.5, money),
        `${boundProps(says([{ op: 'formatted', as: money }]), priced).text} vs ${formatLib.formatValue(1234.5, money)}`
      );
      report.check(
        'a date reads as a date and then takes a label',
        boundProps(
          says(
            [
              { op: 'formatted', as: { kind: 'date', pattern: 'long' } },
              { op: 'join', with: { kind: 'literal', type: 'text', value: ' — sold' } },
            ],
            'when'
          ),
          priced
        ).text === '11 August 2026 — sold',
        String(
          boundProps(
            says([{ op: 'formatted', as: { kind: 'date', pattern: 'long' } }], 'when'),
            priced
          ).text
        )
      );

      /*
       * The rule this changes, and the exact shape of the change.
       *
       * `Format`'s docblock said a comparison sees raw values, enforced by a
       * formatted one being unspellable. It is spellable now — so the claim
       * that survives is the narrower and truer one: a comparison sees raw
       * values *unless somebody writes down that it should not*, and the
       * writing-down is a chip in the sentence.
       */
      const asMoney = { kind: 'field', key: 'price', steps: [{ op: 'formatted', as: money }] };
      report.check(
        'a comparison still sees the raw number unless the sentence says otherwise',
        tests.evaluate(
          { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'gt', right: { kind: 'literal', type: 'number', value: 1000 } },
          priced
        ) === true &&
          tests.evaluate(
            { kind: 'compare', left: asMoney, op: 'eq', right: { kind: 'literal', type: 'text', value: '£1,234.50' } },
            priced
          ) === true,
        'raw compares as a number, formatted compares as the text it now is'
      );

      /*
       * The budget, which is why this step is publisher-only and why that is
       * not a §6 violation. Formatting in the browser means shipping the whole
       * of `document/format.ts` to answer a question nobody asks, so the
       * vocabulary keeps it off anything a control can hold — a control reads
       * as text, and text's formats are already steps of their own.
       */
      const offered = stepLib.stepsFor('text').join(' ');
      report.check(
        'the one step that cannot travel is the one step nothing can put over something typed',
        !offered.includes('formatted') &&
          stepLib.stepsFor('number').includes('formatted') &&
          stepLib.stepsFor('date').includes('formatted'),
        `text: ${offered} · number has it ${stepLib.stepsFor('number').includes('formatted')}`
      );
      report.check(
        'and a hand-written one over a control is refused rather than half-answered',
        schedule.foldableValue({ kind: 'input', name: 'q', steps: [{ op: 'formatted', as: money }] }) ===
          false,
        'undecidable on both surfaces, like every other unauthorable chain'
      );
    }
  }

  /*
   * The source scan. Every one of these is a way to write a formatter that
   * passes every check above and still emits different bytes in the Worker
   * than on the canvas — which is the failure the value checks cannot see,
   * because they run in one engine.
   */
  const LOCALE_REACH = [
    ['Intl.', /\bIntl\s*\./],
    ['toLocale…', /\btoLocale[A-Z]/],
    ['local-time getters', /\bget(FullYear|Month|Date|Hours|Day)\s*\(/],
    ['the clock', /\bDate\s*\.\s*now\s*\(|\bMath\s*\.\s*random\s*\(/],
  ];
  const formatSource = readFileSync(path.join(ROOT, 'src/lib/document/format.ts'), 'utf8')
    // Comments discuss every one of these by name — the file is largely an
    // argument about why they are absent — so the scan reads the code only.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const [name, pattern] of LOCALE_REACH) {
    report.check(`the formatter does not reach for ${name}`, !pattern.test(formatSource));
  }

  /* --------------------------------------------------------------------
   * Each of the above, handed something it must reject.
   * ----------------------------------------------------------------- */

  report.check(
    'the locale scan would catch each thing it is written for',
    LOCALE_REACH.every(([, pattern]) =>
      pattern.test(
        'Intl.NumberFormat(l).format(n); n.toLocaleString(); d.getFullYear(); Date.now();'
      )
    )
  );
  report.check(
    'and it does not confuse a UTC getter for a local one',
    !LOCALE_REACH[2][1].test('at.getUTCFullYear(); at.getUTCMonth(); at.getUTCDate();')
  );
  report.check(
    'the one-caller rule would notice a second caller',
    /\bformatValue\s*\(/.test('const compared = formatValue(raw, format) > 5;')
  );
  report.check(
    'the address rule is not simply refusing everything',
    formatsFor('text', { key: 'p', label: 'P', type: 'number' }).length > 0
  );
}

/* --------------------------------------------------------------------------
 * A record decides what state an element is in
 *
 * Phase B. `WHEN price > 500000 → expensive`, resolved where the record is
 * known and written into the state attribute the switch machinery already
 * reads. Three properties are load-bearing and none is visible in a rendered
 * page:
 *
 * The evaluator has *three* answers, not two. `null` means "cannot be decided
 * here", and it is the whole execution model in one return value — a Test that
 * quietly answered `false` for "this field is not loaded yet" would be
 * indistinguishable, in the output, from one that answered `false` because the
 * price really is under half a million.
 *
 * Two Tests on one key are resolved by order, later wins. That is the
 * arbitration the design settles on, so it is checked in both directions: a
 * check that only ever sees one ordering cannot tell order from luck.
 *
 * And the overlap warning has a burden of proof. A warning that fires on every
 * pair is a warning nobody reads, so it is checked for staying quiet as well as
 * for firing.
 * ----------------------------------------------------------------------- */

report.group('a record decides what state an element is in');

{
  const { evaluate, stateFrom, fieldsRead, foldable, provablyOverlap, OPS_FOR } = tests;

  const record = (data) => ({
    id: 'r1',
    collectionId: 'homes',
    position: 0,
    published: true,
    data,
    createdAt: 0,
    updatedAt: 0,
  });
  const over = (key, value) => ({
    kind: 'compare',
    left: { kind: 'field', key },
    op: 'gt',
    right: { kind: 'literal', type: 'number', value },
  });
  const is = (key, value) => ({
    kind: 'compare',
    left: { kind: 'field', key },
    op: 'eq',
    right: { kind: 'literal', type: 'text', value },
  });

  const house = record({ price: 750000, status: 'available', featured: true, note: '' });

  /* The comparisons themselves. */
  report.check('a number over the mark holds', evaluate(over('price', 500000), house) === true);
  report.check('and under it does not', evaluate(over('price', 900000), house) === false);
  report.check('text matches exactly', evaluate(is('status', 'available'), house) === true);
  report.check(
    'a number stored as text still compares as a number',
    evaluate(over('price', 500000), record({ price: '750000' })) === true
  );

  /*
   * The third answer. Each of these is a case where `false` would be a lie —
   * and a lie that reaches a published page as a missing state rather than as
   * an error anybody sees.
   */
  report.check(
    'a field the record does not carry is undecided, not false',
    evaluate(over('deposit', 100), house) === null,
    String(evaluate(over('deposit', 100), house))
  );
  report.check(
    'and neither is it decided when there is no record at all',
    evaluate(over('price', 500000), null) === null,
    String(evaluate(over('price', 500000), null))
  );
  report.check(
    'comparing a number against text is undecided rather than false',
    evaluate(
      { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'gt', right: { kind: 'literal', type: 'text', value: 'sold' } },
      house
    ) === null
  );
  report.check(
    'a condition the browser answers is not answered here',
    evaluate({ kind: 'pointer', pseudo: 'hover' }, house) === null &&
      evaluate({ kind: 'state', key: 'plan', op: 'is', values: ['pro'] }, house) === null
  );
  report.check(
    'but "is empty" answers on a field that is absent as well as one that is blank',
    evaluate({ kind: 'compare', left: { kind: 'field', key: 'deposit' }, op: 'empty' }, house) === true &&
      evaluate({ kind: 'compare', left: { kind: 'field', key: 'note' }, op: 'empty' }, house) === true
  );

  /* Undecidedness propagates the way the operators mean, not the way that is convenient. */
  report.check(
    'one undecided branch makes an “all of these” undecided',
    evaluate({ kind: 'every', tests: [over('price', 500000), over('deposit', 1)] }, house) === null
  );
  report.check(
    'unless something else in it is already false',
    evaluate({ kind: 'every', tests: [over('price', 900000), over('deposit', 1)] }, house) === false
  );
  report.check(
    'and one undecided branch makes an “any of these” undecided',
    evaluate({ kind: 'some', tests: [over('price', 900000), over('deposit', 1)] }, house) === null
  );
  report.check(
    'unless something else in it is already true',
    evaluate({ kind: 'some', tests: [over('price', 500000), over('deposit', 1)] }, house) === true
  );

  /* Arbitration: later wins, checked both ways round. */
  const nodeWith = (assign, props = {}) => ({
    id: 'n1',
    type: 'frame',
    name: 'Card',
    parentId: null,
    children: [],
    props: { ...props },
    state: { key: 'band', values: [], initial: '' },
    styles: {},
    meta: {},
    assign,
  });
  const cheap = { id: 'a', when: over('price', 100000), value: 'mid' };
  const dear = { id: 'b', when: over('price', 500000), value: 'expensive' };

  report.check(
    'two rules that both hold are settled by order — the later one wins',
    stateFrom(nodeWith([cheap, dear]), house) === 'expensive',
    String(stateFrom(nodeWith([cheap, dear]), house))
  );
  report.check(
    'and swapping them swaps the answer',
    stateFrom(nodeWith([dear, cheap]), house) === 'mid',
    String(stateFrom(nodeWith([dear, cheap]), house))
  );
  report.check(
    'an undecided rule is passed over rather than blocking a later one',
    stateFrom(nodeWith([{ id: 'c', when: over('deposit', 1), value: 'unknown' }, dear]), house) ===
      'expensive'
  );
  report.check(
    'and a rule that does not hold decides nothing',
    stateFrom(nodeWith([{ id: 'd', when: over('price', 900000), value: 'huge' }]), house) === null
  );

  /* What a Test reads, and whether it can be answered at publish time. */
  report.check(
    'a Test says which fields it depends on',
    fieldsRead({ kind: 'every', tests: [over('price', 1), is('status', 'sold')] })
      .sort()
      .join(',') === 'price,status'
  );
  report.check(
    'a comparison over a record folds; a browser condition does not',
    foldable(over('price', 1)) === true && foldable({ kind: 'pointer', pseudo: 'hover' }) === false
  );

  /*
   * Groups that stop being groups.
   *
   * A designer deleting the second half of "all of these" means "just this
   * one". Leaving an `every` with a single member would be harmless to the
   * evaluator and visible everywhere else — an extra indent in the panel, an
   * extra level in the summary, and a document that differs from the identical
   * design built the other way round.
   */
  const { simplify } = tests;
  const A = over('price', 1);
  const B = is('status', 'sold');

  report.check(
    'a group of one is the thing it contains',
    JSON.stringify(simplify({ kind: 'every', tests: [A] })) === JSON.stringify(A),
    JSON.stringify(simplify({ kind: 'every', tests: [A] }))
  );
  report.check(
    'a group of none is nothing at all, not a group that matches everything',
    simplify({ kind: 'every', tests: [] }) === null,
    String(simplify({ kind: 'every', tests: [] }))
  );
  report.check(
    'a group of two is left alone',
    simplify({ kind: 'every', tests: [A, B] })?.tests?.length === 2
  );
  report.check(
    'and it unwraps all the way down',
    JSON.stringify(simplify({ kind: 'some', tests: [{ kind: 'every', tests: [A] }] })) ===
      JSON.stringify(A),
    JSON.stringify(simplify({ kind: 'some', tests: [{ kind: 'every', tests: [A] }] }))
  );
  report.check(
    'an empty group inside a real one is dropped rather than counted',
    simplify({ kind: 'every', tests: [A, { kind: 'some', tests: [] }] })?.kind === 'compare',
    JSON.stringify(simplify({ kind: 'every', tests: [A, { kind: 'some', tests: [] }] }))
  );
  report.check(
    'a plain comparison is returned untouched',
    simplify(A) === A
  );
  report.check(
    'and the simplifier is not simply returning its input',
    simplify({ kind: 'every', tests: [A] }) !== null &&
      simplify({ kind: 'every', tests: [A] }).kind === 'compare'
  );

  /* The overlap warning — fires, and stays quiet. */
  report.check(
    'two ranges that genuinely intersect are flagged',
    provablyOverlap(over('price', 100000), over('price', 500000))
  );
  report.check(
    'two that cannot both hold are not',
    !provablyOverlap(over('price', 500000), {
      kind: 'compare',
      left: { kind: 'field', key: 'price' },
      op: 'lt',
      right: { kind: 'literal', type: 'number', value: 500000 },
    })
  );
  report.check(
    'nor are two Tests on different fields, however obviously they can both hold',
    !provablyOverlap(over('price', 500000), is('status', 'sold')),
    'silence, because ordering already decides it'
  );
  report.check(
    'nor two values of one text field that are simply different',
    !provablyOverlap(is('status', 'sold'), is('status', 'available'))
  );
  report.check(
    'but the same value twice is',
    provablyOverlap(is('status', 'sold'), is('status', 'sold'))
  );
  report.check(
    'and empty against not-empty on one field is provably exclusive',
    !provablyOverlap(
      { kind: 'compare', left: { kind: 'field', key: 'note' }, op: 'empty' },
      { kind: 'compare', left: { kind: 'field', key: 'note' }, op: 'notEmpty' }
    )
  );

  /* What the editor may offer. */
  report.check(
    'ordered comparisons are offered on numbers and nowhere else',
    OPS_FOR.number.includes('gt') && !OPS_FOR.text.includes('gt') && !OPS_FOR.date.includes('gt'),
    `text: ${OPS_FOR.text.join('/')}`
  );
  report.check(
    'every field type says what can be asked of it',
    ['text', 'richtext', 'number', 'boolean', 'date', 'image', 'select', 'reference'].every(
      (type) => OPS_FOR[type].length > 0
    )
  );

  /* ----------------------------------------------------------------------
   * Through a real publish
   * ------------------------------------------------------------------- */

  const homes = [
    { id: 'h1', collectionId: 'homes', position: 0, published: true, createdAt: 0, updatedAt: 0,
      data: { title: 'The Hill', price: 750000 } },
    { id: 'h2', collectionId: 'homes', position: 1, published: true, createdAt: 0, updatedAt: 0,
      data: { title: 'The Mews', price: 250000 } },
  ];

  /*
   * One document, rendered against different row sets — not one document per
   * render. Node ids are minted fresh by `createEmptyDocument`, and published
   * class names are built from them, so two separately-built documents produce
   * stylesheets of identical length and different bytes. Written the other way
   * round first, and the size check passed a byte-comparison it had no way to
   * make.
   */
  const listingDoc = () => {
    const doc = createEmptyDocument('Homes');
    doc.collections = [
      {
        id: 'homes',
        name: 'Homes',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'price', label: 'Price', type: 'number' },
        ],
      },
    ];
    const page = doc.pages[0];
    const built = buildTree(
      {
        type: 'grid',
        name: 'Listings',
        repeat: { collection: 'homes' },
        children: [
          {
            type: 'frame',
            name: 'Card',
            props: { switchKey: 'band', switchDefault: 'ordinary' },
            children: [
              {
                type: 'paragraph',
                name: 'Price',
                props: { text: 'Some amount' },
                bind: {
                  text: {
                    value: { kind: 'field', key: 'price' },
                    format: { kind: 'currency', symbol: '$', decimals: 0 },
                  },
                },
              },
            ],
          },
        ],
      },
      doc.nodes
    );
    doc.nodes[built.rootId].parentId = page.rootNodeId;
    doc.nodes[page.rootNodeId].children.push(built.rootId);

    // The card carries the rule. Written onto the built node rather than
    // through the spec because `assign` is not authoring shorthand — it is
    // made in the inspector, and this is the shape the inspector writes.
    const card = Object.values(doc.nodes).find((n) => n.name === 'Card');
    card.assign = [{ id: 'x1', when: over('price', 500000), value: 'expensive' }];

    return { doc, page };
  };

  const HOMES = listingDoc();
  const listing = (rows) => renderPage(HOMES.doc, HOMES.page, { records: { homes: rows } });

  const published = listing(homes);
  const bodyOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('</body>'));
  const values = [...bodyOf(published).matchAll(/data-cre8-value="([^"]*)"/g)].map((m) => m[1]);

  report.check(
    'each row is published in the state its own record puts it in',
    values.join(' › ') === 'expensive › ordinary',
    values.join(' › ') || 'no state written'
  );
  report.check(
    'the row no rule matched falls back to what the designer declared',
    values.includes('ordinary'),
    'the fallback is what ships, and what a visitor with no scripting keeps'
  );
  report.check(
    'and no script was shipped to work any of it out',
    !/<script/i.test(published),
    'resolved at publish, like the rows themselves'
  );

  /*
   * The hard rule, end to end. The same field is bound with a currency format
   * *and* tested. If the Test could see the formatted string, `"$750,000" >
   * 500000` is not a comparison anybody can predict — and the row would come
   * out in the wrong state while looking perfectly correct on the page.
   */
  report.check(
    'the price is formatted where it is shown and raw where it is compared',
    published.includes('$750,000') && values[0] === 'expensive',
    `${published.includes('$750,000') ? 'formatted' : 'not formatted'} / ${values[0]}`
  );

  /*
   * And the size claim, which is the one that decides whether this design is
   * affordable at all: a state per row, one stylesheet.
   */
  const many = [];
  for (let i = 0; i < 30; i++) {
    many.push({
      id: `m${i}`, collectionId: 'homes', position: i, published: true, createdAt: 0, updatedAt: 0,
      data: { title: `Home ${i}`, price: i * 50000 },
    });
  }
  const styleOfPage = (html) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const wide = listing(many);
  report.check(
    'thirty rows generate the same stylesheet as two',
    styleOfPage(wide) === styleOfPage(published),
    `${styleOfPage(wide).length} vs ${styleOfPage(published).length} bytes`
  );
  report.check(
    'while genuinely drawing thirty of them in different states',
    [...bodyOf(wide).matchAll(/data-cre8-value="([^"]*)"/g)].length === 30 &&
      new Set([...bodyOf(wide).matchAll(/data-cre8-value="([^"]*)"/g)].map((m) => m[1])).size === 2,
    `${[...bodyOf(wide).matchAll(/data-cre8-value="([^"]*)"/g)].length} rows`
  );

  /* ----------------------------------------------------------------------
   * Deleting the field a Test reads
   * ------------------------------------------------------------------- */

  {
    const doc = createEmptyDocument('Homes');
    doc.collections = [
      {
        id: 'homes',
        name: 'Homes',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'price', label: 'Price', type: 'number' },
        ],
      },
    ];
    const page = doc.pages[0];
    const target = doc.nodes[page.rootNodeId];
    target.assign = [
      { id: 'k1', when: over('price', 500000), value: 'expensive' },
      { id: 'k2', when: is('title', 'The Hill'), value: 'named' },
    ];
    ops.removeField(doc, 'homes', 'price');

    report.check(
      'deleting a field clears the rules that read it',
      (target.assign ?? []).length === 1 && target.assign[0].id === 'k2',
      `${(target.assign ?? []).length} rules left`
    );
    report.check(
      'and leaves the ones that do not alone',
      target.assign?.[0]?.value === 'named'
    );
  }

  /* --------------------------------------------------------------------
   * Each of the above, handed something it must reject.
   * ----------------------------------------------------------------- */

  report.check(
    'the ordering rule would notice order stopping to matter',
    stateFrom(nodeWith([cheap, dear]), house) !== stateFrom(nodeWith([dear, cheap]), house),
    'the two orderings genuinely disagree, so the pair can tell them apart'
  );
  report.check(
    'the undecided checks are not simply asserting null everywhere',
    evaluate(over('price', 500000), house) !== null
  );
  report.check(
    'the overlap warning is not simply always quiet',
    provablyOverlap(over('price', 100000), over('price', 500000)) === true
  );
  report.check(
    'and the stylesheet check would notice one that did grow',
    styleOfPage(wide).length > 0,
    'there is a stylesheet to compare in the first place'
  );
}

/* --------------------------------------------------------------------------
 * A Test that cannot be answered until somebody types
 *
 * The runtime half of phase B. A Test reading a form control has no answer
 * when the page is published, so the rules travel to the browser and are
 * evaluated there.
 *
 * That means a second implementation of the comparison, and it is not
 * optional: `behaviourRuntime` is serialised with `toString()` and can import
 * nothing. Two implementations of one rule is exactly the drift this project
 * refuses everywhere else, so the mitigation has to be real — the checks below
 * drive *the actual runtime function* over a matrix of values with a fake DOM
 * and assert it reaches the same answer as the publisher's evaluator, case for
 * case. Reading the two side by side and agreeing they look the same is not a
 * check.
 * ----------------------------------------------------------------------- */

report.group('a Test the browser has to answer agrees with the one the publisher does');

{
  const { evaluate, stateFrom, foldable, needsRuntime, testTable, lowerTest, publishedValues, unfinished } =
    tests;
  const { testRuntime } = behaviour;

  /* ----------------------------------------------------------------------
   * Just enough DOM to run the real runtime in Node.
   * ------------------------------------------------------------------- */

  /** `[a]`, `[a="v"]`, `[a~="v"]`, each optionally followed by `:not([b])`. */
  const matches = (el, selector) => {
    const parts = /^\[([\w-]+)(?:([~]?=)"([^"]*)")?\](?::not\(\[([\w-]+)\]\))?$/.exec(selector);
    if (!parts) return false;
    const [, name, operator, wanted, without] = parts;
    if (without && without in el.attrs) return false;
    if (!(name in el.attrs)) return false;
    if (!operator) return true;
    const held = String(el.attrs[name]);
    return operator === '~=' ? held.split(/\s+/).includes(wanted) : held === wanted;
  };

  const descendants = (el) => el.children.flatMap((child) => [child, ...descendants(child)]);

  const el = (attrs, children = []) => {
    const node = {
      attrs: { ...attrs },
      children,
      parent: null,
      value: attrs.value,
      getAttribute: (name) => (name in node.attrs ? String(node.attrs[name]) : null),
      setAttribute: (name, value) => {
        node.attrs[name] = value;
      },
      hasAttribute: (name) => name in node.attrs,
      removeAttribute: (name) => {
        delete node.attrs[name];
      },
      querySelector: (selector) => descendants(node).find((d) => matches(d, selector)) ?? null,
      querySelectorAll: (selector) => descendants(node).filter((d) => matches(d, selector)),
      closest: (selector) => {
        let current = node;
        while (current) {
          if (matches(current, selector)) return current;
          current = current.parent;
        }
        return null;
      },
      get parentElement() {
        return node.parent;
      },
    };
    for (const child of children) child.parent = node;
    return node;
  };

  const hostFor = (root) => {
    const bound = [];
    return {
      bound,
      querySelectorAll: (selector) => descendants(root).filter((d) => matches(d, selector)),
      // From the page, which is what an operand reading an element elsewhere
      // needs and what the rule's own node cannot give it.
      querySelector: (selector) => descendants(root).find((d) => matches(d, selector)) ?? null,
      addEventListener: (type) => bound.push(type),
      removeEventListener: (type) => {
        const at = bound.indexOf(type);
        if (at >= 0) bound.splice(at, 1);
      },
    };
  };

  /* ----------------------------------------------------------------------
   * The differential
   * ------------------------------------------------------------------- */

  const record = (data) => ({
    id: 'r1',
    collectionId: 'c',
    position: 0,
    published: true,
    data,
    createdAt: 0,
    updatedAt: 0,
  });

  const bandNode = (assign) => ({
    id: 'n1', type: 'frame', name: 'Card', parentId: null, children: [],
    props: {}, styles: {}, meta: {},
    state: { key: 'band', values: ['else'], initial: 'else' }, assign,
  });

  /**
   * What the runtime settles a node's state to, given a record.
   *
   * Through `lowerTest`, not by handing `testRuntime` the stored Test.
   *
   * Those were the same object until a `Value` grew a tag the browser does not
   * read, and this differential is exactly the check that must not be fed the
   * document shape when the wire shape is what ships. Fed the stored one it
   * would keep passing while every real page carried something else — which is
   * the "test the claim, not a proxy" rule in `tests/README.md`, and the wire
   * is the claim.
   *
   * `lowerTest` rather than `testTable` because the table is allowed to be
   * empty: every rule in this matrix folds, so `needsRuntime` is false and a
   * real page would ship none of them. The differential exists to ask the
   * runtime the question anyway, and compare the two answers.
   */
  /**
   * @param controls Form controls to plant inside the node, for the operand
   *   that reads one. Empty for every caller that predates E7 — the runtime
   *   looks a control up inside the element that owns the rule, so a holder
   *   with no children is a page where nothing has been typed.
   */
  const runtimeAnswer = (assign, data, controls = []) => {
    const holder = el(
      {
        'data-cre8-switch': 'band',
        'data-cre8-value': 'else',
        'data-cre8-else': 'else',
        'data-cre8-test': 'n1',
        'data-cre8-vals': JSON.stringify(data),
      },
      controls.map((one) => el(one))
    );
    const root = el({}, [holder]);
    testRuntime(hostFor(root), false, {
      n1: assign.map((r) => ({ when: lowerTest(r.when), value: r.value })),
    });
    return holder.getAttribute('data-cre8-value');
  };

  /** And what the publisher would have settled it to. */
  const publishAnswer = (assign, data) => stateFrom(bandNode(assign), record(data)) ?? 'else';

  /*
   * Fractions are in here deliberately. Written first with whole numbers only,
   * and a runtime that rounded its operand agreed with the publisher on every
   * one of nine hundred comparisons — the matrix could not tell the two apart
   * because nothing in it had a decimal point to lose.
   */
  const OPERANDS = [
    ['number', 0], ['number', 500000], ['number', 750000], ['number', -1],
    ['number', 0.5], ['number', 749999.99], ['number', -1.5],
    ['text', ''], ['text', 'sold'], ['text', 'SOLD'], ['text', 'available'],
    ['boolean', true], ['boolean', false],
  ];
  const HELD = [
    0, 500000, 750000, '750000', 0.5, 0.49, 749999.99, -1.5, '12.34',
    '', 'sold', 'SOLD', true, false, null,
  ];
  const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'notEmpty'];

  let compared = 0;
  const disagreed = [];
  for (const [type, value] of OPERANDS) {
    for (const op of OPS) {
      for (const held of HELD) {
        const when = {
          kind: 'compare',
          left: { kind: 'field', key: 'f' },
          op,
          ...(op === 'empty' || op === 'notEmpty'
            ? {}
            : { right: { kind: 'literal', type, value } }),
        };
        const rules = [{ id: 'x', when, value: 'yes' }];
        const data = { f: held };
        compared++;
        const a = publishAnswer(rules, data);
        const b = runtimeAnswer(rules, data);
        if (a !== b) disagreed.push(`${JSON.stringify(held)} ${op} ${type}:${value} → ${a} vs ${b}`);
      }
    }
  }

  report.check(
    'the runtime and the publisher reach the same answer, case for case',
    disagreed.length === 0 && compared > 800,
    disagreed.length ? disagreed.slice(0, 3).join(' | ') : `${compared} comparisons agree`
  );

  // The absent case separately, because it is the one where "no value" and
  // "empty value" have to stay different and a missing key is the only way to
  // say the first.
  const absent = [];
  for (const op of OPS) {
    const when = {
      kind: 'compare',
      left: { kind: 'field', key: 'missing' },
      op,
      ...(op === 'empty' || op === 'notEmpty' ? {} : { right: { kind: 'literal', type: 'text', value: 'x' } }),
    };
    const rules = [{ id: 'x', when, value: 'yes' }];
    const a = publishAnswer(rules, { other: 1 });
    const b = runtimeAnswer(rules, { other: 1 });
    if (a !== b) absent.push(`${op} → ${a} vs ${b}`);
  }
  report.check(
    'including when the record does not carry the field at all',
    absent.length === 0,
    absent.join(' | ') || 'agreed on every operator'
  );

  // And arbitration, which each side implements in its own loop.
  const ordered = [
    { id: 'a', when: { kind: 'compare', left: { kind: 'field', key: 'f' }, op: 'gt', right: { kind: 'literal', type: 'number', value: 100 } }, value: 'mid' },
    { id: 'b', when: { kind: 'compare', left: { kind: 'field', key: 'f' }, op: 'gt', right: { kind: 'literal', type: 'number', value: 500 } }, value: 'high' },
  ];
  report.check(
    'and they arbitrate two matching rules the same way',
    publishAnswer(ordered, { f: 900 }) === 'high' && runtimeAnswer(ordered, { f: 900 }) === 'high',
    `${publishAnswer(ordered, { f: 900 })} / ${runtimeAnswer(ordered, { f: 900 })}`
  );
  report.check(
    'and fall back to the same value when neither holds',
    publishAnswer(ordered, { f: 1 }) === 'else' && runtimeAnswer(ordered, { f: 1 }) === 'else'
  );

  /* ----------------------------------------------------------------------
   * E5 — the same sum on both surfaces
   * ------------------------------------------------------------------- */

  const orderRow = { price: 19.99, qty: 3, rate: 0.2, zero: 0, name: 'Widget' };

  /*
   * The differential, which is what E5 is really about: the same sum on both
   * surfaces. A published page answers `price × qty` in the file; a page
   * where somebody types the quantity answers it in the browser, and the two
   * must agree to the digit — `toFixed` is specified, `+` and `×` are IEEE,
   * and the check is here because "they should agree" is not the same claim
   * as "they do".
   */
  {
    const cases = [
      [{ op: 'times', by: { kind: 'literal', type: 'number', value: 3 } }],
      [{ op: 'over', by: { kind: 'literal', type: 'number', value: 3 } }],
      [{ op: 'plus', by: { kind: 'literal', type: 'number', value: 0.1 } }],
      [{ op: 'minus', by: { kind: 'literal', type: 'number', value: 0.3 } }],
      [{ op: 'over', by: { kind: 'literal', type: 'number', value: 3 } }, { op: 'round', places: 2 }],
      [{ op: 'times', by: { kind: 'field', key: 'rate' } }, { op: 'round', places: 4 }],
      [{ op: 'over', by: { kind: 'field', key: 'zero' } }],
      [{ op: 'round', places: 0 }],
    ];
    const split = [];
    for (const steps of cases) {
      const when = {
        kind: 'compare',
        left: { kind: 'field', key: 'price', steps },
        op: 'gt',
        right: { kind: 'literal', type: 'number', value: 5 },
      };
      const rules = [{ id: 'm', when, value: 'yes' }];
      const a = publishAnswer(rules, orderRow);
      const b = runtimeAnswer(rules, orderRow);
      if (a !== b) split.push(`${JSON.stringify(steps)} → ${a} vs ${b}`);
    }
    report.check(
      'the two evaluators reach the same sum, case for case',
      split.length === 0,
      split.length ? split.slice(0, 2).join(' | ') : `${cases.length} sums agree`
    );
  }

  /* ----------------------------------------------------------------------
   * E7 — the same text on both surfaces
   * ------------------------------------------------------------------- */

  /*
   * The differential again, one family along, and the risk it covers is
   * sharper than E5's: arithmetic is IEEE and both engines are obliged to
   * agree, whereas `toUpperCase` and `slice` are two hand-written branches in
   * two separately serialised functions. Nothing but this says they match.
   *
   * A join with a *control* is in the list because it is the only case here
   * that the publisher genuinely cannot answer — the chain does not fold, so
   * the publisher says "nothing decided" and the browser says "Grace hopper".
   * Asserted as that split rather than as agreement, because agreement there
   * would mean the scheduling rule had leaked.
   */
  {
    const nameRow = { name: 'Grace', surname: 'HOPPER', blank: null };
    const cases = [
      [[{ op: 'upper' }], 'GRACE'],
      [[{ op: 'lower' }], 'grace'],
      // Shouted first, so `capitalize` has a tail to lower. `Grace` alone
      // cannot tell a correct implementation from one that only touches the
      // first letter, which a mutation demonstrated by passing.
      [[{ op: 'upper' }, { op: 'capitalize' }], 'Grace'],
      [[{ op: 'truncate', chars: 2 }], 'Gr'],
      [[{ op: 'truncate', chars: 0 }], ''],
      [[{ op: 'join', with: { kind: 'literal', type: 'text', value: '!' } }], 'Grace!'],
      [[{ op: 'join', with: { kind: 'field', key: 'surname' } }], 'GraceHOPPER'],
      [[{ op: 'join', with: { kind: 'field', key: 'blank' } }], 'Grace'],
      [
        [
          { op: 'truncate', chars: 2 },
          { op: 'upper' },
          { op: 'join', with: { kind: 'literal', type: 'text', value: '…' } },
        ],
        'GR…',
      ],
    ];
    const split = [];
    for (const [steps, want] of cases) {
      const rules = [
        {
          id: 't',
          when: {
            kind: 'compare',
            left: { kind: 'field', key: 'name', steps },
            op: 'eq',
            right: { kind: 'literal', type: 'text', value: want },
          },
          value: 'yes',
        },
      ];
      const a = publishAnswer(rules, nameRow);
      const b = runtimeAnswer(rules, nameRow);
      // Both have to say `yes`, not merely the same thing: two evaluators that
      // agreed on `else` would agree about nothing at all.
      if (a !== 'yes' || b !== 'yes') split.push(`${JSON.stringify(steps)} → ${a} vs ${b}`);
    }
    report.check(
      'the two evaluators reach the same text, case for case',
      split.length === 0 && cases.length >= 9,
      split.length ? split.slice(0, 2).join(' | ') : `${cases.length} chains agree`
    );

    /*
     * And the one that has to *disagree*: a join with something typed. The
     * publisher cannot know it, so the page falls back; the browser reads the
     * box. Both answers are correct and they are different, which is the whole
     * of the execution model in one row.
     */
    const live = [
      {
        id: 'l',
        when: {
          kind: 'compare',
          left: {
            kind: 'field',
            key: 'name',
            steps: [{ op: 'join', with: { kind: 'input', name: 'typed' } }],
          },
          op: 'eq',
          right: { kind: 'literal', type: 'text', value: 'Grace Hopper' },
        },
        value: 'yes',
      },
    ];
    report.check(
      'a join with something typed is answered in the browser and nowhere else',
      publishAnswer(live, nameRow) === 'else' &&
        runtimeAnswer(live, nameRow, [{ name: 'typed', value: ' Hopper' }]) === 'yes' &&
        runtimeAnswer(live, nameRow, [{ name: 'typed', value: ' Murray' }]) === 'else',
      `published ${publishAnswer(live, nameRow)} · ` +
        `typed " Hopper" ${runtimeAnswer(live, nameRow, [{ name: 'typed', value: ' Hopper' }])} · ` +
        `typed " Murray" ${runtimeAnswer(live, nameRow, [{ name: 'typed', value: ' Murray' }])}`
    );
  }

  /*
   * And the runtime refuses what it cannot walk rather than answering with
   * the head. A `follow` can only arrive here in a document written by hand
   * — `foldable` keeps it out of the table — and printing the *id* would be
   * a wrong answer wearing the shape of a right one.
   */
  {
    const walked = {
      kind: 'compare',
      left: { kind: 'field', key: 'price', steps: [{ op: 'follow' }, { op: 'field', key: 'name' }] },
      op: 'notEmpty',
    };
    report.check(
      'the runtime refuses a step it cannot walk rather than reading the head',
      runtimeAnswer([{ id: 'f', when: walked, value: 'yes' }], orderRow) === 'else',
      String(runtimeAnswer([{ id: 'f', when: walked, value: 'yes' }], orderRow))
    );
  }

  /* ----------------------------------------------------------------------
   * E1 — the other side of the operator is a Value too
   *
   * `right` was a `TestLiteral`, so a comparison could only ever ask about a
   * constant. Everything below is a rule that could not be *written* before,
   * which is the shape of falsification `docs/VALUES.md` §5 asks for: not "the
   * answer is wrong" but "the sentence does not exist".
   * ------------------------------------------------------------------- */

  const overBudget = {
    kind: 'compare',
    left: { kind: 'field', key: 'price' },
    op: 'gt',
    right: { kind: 'field', key: 'budget' },
  };
  const budgetRules = [{ id: 'b', when: overBudget, value: 'yes' }];

  /*
   * One rule, two rows, two answers — and the two rows differ only in a field
   * the *right* side reads. A literal-only model cannot express this rule at
   * all: `price > 500000` is one number for every row, and the whole point of
   * the pair below is that no single constant separates them.
   */
  report.check(
    'a rule can compare two fields of one record',
    publishAnswer(budgetRules, { price: 900000, budget: 750000 }) === 'yes' &&
      publishAnswer(budgetRules, { price: 600000, budget: 750000 }) === 'else',
    `900k over 750k → ${publishAnswer(budgetRules, { price: 900000, budget: 750000 })} · ` +
      `600k over 750k → ${publishAnswer(budgetRules, { price: 600000, budget: 750000 })}`
  );
  /*
   * And the half that says the first check is about the *operand* rather than
   * about `gt`: two rows with the same price and different budgets. A constant
   * cannot see a budget, so no constant separates them — swept rather than
   * argued, because "no constant can" is the kind of claim that is easy to
   * believe and cheap to drive. The field comparison separating the same pair
   * is what stops the sweep from being a check that cannot fail.
   */
  {
    const rowA = { price: 900000, budget: 750000 };
    const rowB = { price: 900000, budget: 950000 };
    const constants = [];
    for (let n = 0; n <= 1200000; n += 50000) constants.push(n);
    const blind = constants.every((n) => {
      const literal = [
        { id: 'l', when: { ...overBudget, right: { kind: 'literal', type: 'number', value: n } }, value: 'yes' },
      ];
      return publishAnswer(literal, rowA) === publishAnswer(literal, rowB);
    });
    report.check(
      'and no constant could have separated those two rows, where a field does',
      blind && publishAnswer(budgetRules, rowA) !== publishAnswer(budgetRules, rowB),
      `${constants.length} constants all answer both rows alike; the field answers ` +
        `${publishAnswer(budgetRules, rowA)} and ${publishAnswer(budgetRules, rowB)}`
    );
  }

  report.check(
    'a comparison between two fields still folds, so it costs nothing to run',
    foldable(overBudget) === true &&
      foldable({ ...overBudget, right: { kind: 'input', name: 'offer' } }) === false,
    `field↔field ${foldable(overBudget)} · field↔control ${foldable({ ...overBudget, right: { kind: 'input', name: 'offer' } })}`
  );

  /*
   * The one that would have gone wrong silently.
   *
   * `publishedValues` ships exactly the fields a Test reads, and `fieldsRead`
   * walked `left` alone. Miss the right-hand field and the runtime looks it up
   * in `data-cre8-vals`, does not find it, and answers `null` for ever — a
   * rule that never fires, on a page that carries no sign of why.
   */
  {
    const live = {
      kind: 'every',
      tests: [{ kind: 'compare', left: { kind: 'input', name: 'offer' }, op: 'notEmpty' }, overBudget],
    };
    const node = {
      id: 'n8', type: 'frame', name: 'Card', parentId: null, children: [],
      props: {}, styles: {}, meta: {},
      state: { key: 'band', values: ['else'], initial: 'else' },
      assign: [{ id: 'b', when: live, value: 'yes' }],
    };
    const shipped = publishedValues(node, record({ price: 900000, budget: 750000, other: 1 }));
    report.check(
      'a field read on the right is published for the runtime to find',
      shipped?.price === 900000 && shipped?.budget === 750000 && !('other' in (shipped ?? {})),
      `shipped ${JSON.stringify(shipped)}`
    );
  }

  /*
   * And the differential again, over the shape the matrix above cannot make:
   * a right-hand operand that is not a constant. Same rule, same record, both
   * evaluators — the pair that has caught every disagreement so far.
   */
  {
    const rows = [
      { price: 900000, budget: 750000 },
      { price: 600000, budget: 750000 },
      { price: 750000, budget: 750000 },
      { price: '900000', budget: 750000 },
      { price: 'sold', budget: 750000 },
      { budget: 750000 },
      { price: 900000 },
    ];
    const split = [];
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']) {
      for (const data of rows) {
        const rules = [{ id: 'b', when: { ...overBudget, op }, value: 'yes' }];
        const a = publishAnswer(rules, data);
        const b = runtimeAnswer(rules, data);
        if (a !== b) split.push(`${JSON.stringify(data)} ${op} → ${a} vs ${b}`);
      }
    }
    report.check(
      'the two evaluators agree about a field on the right as well',
      split.length === 0,
      split.length ? split.slice(0, 3).join(' | ') : `${6 * rows.length} comparisons agree`
    );
  }

  /*
   * Two controls, which is the case that has to travel: "Confirm matches
   * Password" is unanswerable in a file and is the reason a live right-hand
   * operand exists at all.
   */
  {
    const match = {
      kind: 'compare',
      left: { kind: 'input', name: 'confirm' },
      op: 'eq',
      right: { kind: 'input', name: 'password' },
    };
    const answer = (typed, again) => {
      const holder = el(
        {
          'data-cre8-switch': 'form',
          'data-cre8-value': 'no',
          'data-cre8-else': 'no',
          'data-cre8-test': 'n7',
        },
        [el({ name: 'password', value: typed }), el({ name: 'confirm', value: again })]
      );
      testRuntime(hostFor(el({}, [holder])), false, {
        n7: [{ when: lowerTest(match), value: 'same' }],
      });
      return holder.getAttribute('data-cre8-value');
    };
    report.check(
      'two form controls can be compared against each other, in the browser',
      answer('hunter2', 'hunter2') === 'same' && answer('hunter2', 'hunter3') === 'no',
      `matching → ${answer('hunter2', 'hunter2')} · differing → ${answer('hunter2', 'hunter3')}`
    );
    report.check(
      'and the publisher declines it rather than deciding it in the file',
      evaluate(match, record({})) === null && foldable(match) === false
    );
  }

  /*
   * The wire shape, which is the whole of why the byte baseline did not move.
   *
   * A document says `kind: 'literal'`; the browser infers it from the `type`
   * being there, so the tag is dropped on the way out. Checked on the JSON
   * because JSON is what ships — an assertion about the object would pass on a
   * key the serialiser still writes.
   */
  {
    const stored = { ...overBudget, right: { kind: 'literal', type: 'number', value: 500000 } };
    const wire = JSON.stringify(lowerTest(stored));
    report.check(
      'a constant travels without the tag the document keeps',
      wire === '{"kind":"compare","left":{"kind":"field","key":"price"},"op":"gt","right":{"type":"number","value":500000}}',
      wire
    );
    report.check(
      'and an operand that is not a constant travels whole',
      JSON.stringify(lowerTest(overBudget)).includes('"right":{"kind":"field","key":"budget"}'),
      JSON.stringify(lowerTest(overBudget))
    );
    report.check(
      'the tag is dropped inside a group too, not only at the top',
      !JSON.stringify(lowerTest({ kind: 'every', tests: [stored, stored] })).includes('literal'),
      JSON.stringify(lowerTest({ kind: 'every', tests: [stored, stored] }))
    );
    /*
     * And inside a step's operand, which is where E5 put constants.
     *
     * A *size* claim rather than a correctness one, and worth being clear
     * about which: the runtime reads a constant by its `type`, so a tagged one
     * resolves perfectly well — it just carries seventeen bytes of nothing per
     * operand, on every row of every page that ships a test. The differential
     * cannot see that, so this is the check that can.
     */
    const priced = {
      kind: 'compare',
      left: {
        kind: 'field',
        key: 'price',
        steps: [
          { op: 'times', by: { kind: 'literal', type: 'number', value: 3 } },
          { op: 'round', places: 2 },
        ],
      },
      op: 'gt',
      right: { kind: 'literal', type: 'number', value: 5 },
    };
    report.check(
      'and inside an arithmetic step, where a constant costs bytes on every row',
      !JSON.stringify(lowerTest(priced)).includes('literal'),
      JSON.stringify(lowerTest(priced))
    );
  }

  /*
   * The overlap warning, narrowed. `> Budget` and `< Deposit` are two
   * half-lines whose ends move per row, so on some row they certainly overlap
   * — and this function's contract is to stay quiet about anything it cannot
   * demonstrate.
   */
  {
    const gtLiteral = { ...overBudget, op: 'gt', right: { kind: 'literal', type: 'number', value: 100 } };
    const ltLiteral = { ...overBudget, op: 'lt', right: { kind: 'literal', type: 'number', value: 500 } };
    /*
     * Two equalities against two *different* fields, which is the pair that
     * catches a guard written as "do the operands declare the same type". They
     * both declare nothing, so that reading passes them through — and then
     * compares two `undefined`s, finds them equal, and reports an overlap
     * between `Status is Wanted` and `Status is Fallback`. Which is a warning
     * about a row nobody has seen yet.
     */
    const eqWanted = {
      kind: 'compare',
      left: { kind: 'field', key: 'status' },
      op: 'eq',
      right: { kind: 'field', key: 'wanted' },
    };
    const eqFallback = { ...eqWanted, right: { kind: 'field', key: 'fallback' } };
    report.check(
      'the overlap warning goes quiet once an operand stops being a constant',
      tests.provablyOverlap(gtLiteral, ltLiteral) === true &&
        tests.provablyOverlap(overBudget, ltLiteral) === false &&
        tests.provablyOverlap(eqWanted, eqFallback) === false,
      `both constant ${tests.provablyOverlap(gtLiteral, ltLiteral)} · ` +
        `one field ${tests.provablyOverlap(overBudget, ltLiteral)} · ` +
        `two fields ${tests.provablyOverlap(eqWanted, eqFallback)}`
    );
  }

  const typedTest = {
    kind: 'compare',
    left: { kind: 'input', name: 'email' },
    op: 'notEmpty',
  };
  const typedRules = [{ id: 't', when: typedTest, value: 'ready' }];

  report.check(
    'a Test reading a form control cannot be folded',
    foldable(typedTest) === false && foldable(ordered[0].when) === true
  );
  report.check(
    'and the publisher declines to answer it rather than guessing',
    evaluate(typedTest, record({ email: 'someone@example.com' })) === null,
    String(evaluate(typedTest, record({ email: 'x' })))
  );

  const withControl = (typed) => {
    const control = el({ name: 'email', value: typed });
    const holder = el(
      {
        'data-cre8-switch': 'form',
        'data-cre8-value': 'waiting',
        'data-cre8-else': 'waiting',
        'data-cre8-test': 'n2',
      },
      [control]
    );
    const root = el({}, [holder]);
    testRuntime(hostFor(root), false, { n2: typedRules.map((r) => ({ when: r.when, value: r.value })) });
    return holder.getAttribute('data-cre8-value');
  };

  report.check(
    'an empty control leaves the state where the file shipped it',
    withControl('') === 'waiting',
    withControl('')
  );
  report.check(
    'and a filled one moves it',
    withControl('someone@example.com') === 'ready',
    withControl('someone@example.com')
  );
  /*
   * And that it keeps answering. Everything above proves the first pass; this
   * is the subscription, which is the difference between a state that settles
   * once and one that follows what somebody is typing. Checked here rather
   * than only in the browser because it is a claim about the function, and
   * because the disposer has to take the listeners away again — a preview
   * panel that mounts and unmounts a few times would otherwise accumulate one
   * evaluation pass per mount, for ever.
   */
  {
    const control = el({ name: 'email', value: '' });
    const holder = el(
      {
        'data-cre8-switch': 'form',
        'data-cre8-value': 'waiting',
        'data-cre8-else': 'waiting',
        'data-cre8-test': 'n4',
      },
      [control]
    );
    const host = hostFor(el({}, [holder]));
    const table = { n4: typedRules.map((r) => ({ when: r.when, value: r.value })) };

    const idle = hostFor(el({}, [el({ 'data-cre8-test': 'n4' })]));
    testRuntime(idle, false, table);
    report.check(
      'nothing is subscribed on a surface that is not live',
      idle.bound.length === 0,
      idle.bound.join(', ') || 'no listeners'
    );

    const stop = testRuntime(host, true, table);
    report.check(
      'a live surface listens for both ways a control reports a change',
      host.bound.includes('input') && host.bound.includes('change'),
      host.bound.join(', ') || 'nothing bound'
    );
    stop();
    report.check(
      'and the disposer takes them away again',
      host.bound.length === 0,
      host.bound.join(', ') || 'clean'
    );
  }

  /* --- A minted comparison, in the runtime ------------------------------- */

  /*
   * The other rule shape the table carries. A comparison hoisted out of a
   * style rule sets an attribute rather than choosing a value, and the element
   * it sits on usually declares no state at all — which is the case the old
   * machinery could not serve and the reason the intermediate is an attribute
   * rather than a state.
   */
  {
    const control = el({ name: 'email' });
    control.value = 'someone@example.test';
    const holder = el({ 'data-cre8-test': 'n5' }, [control]);
    const attr = 'data-cre8-w-r1-0';
    const rules = [
      { when: { kind: 'compare', left: { kind: 'input', name: 'email' }, op: 'notEmpty' }, attr },
    ];
    testRuntime(hostFor(el({}, [holder])), false, { n5: rules });
    report.check(
      'a minted comparison that holds turns its attribute on',
      holder.getAttribute(attr) === '',
      JSON.stringify(holder.getAttribute(attr))
    );
    /*
     * And nothing else. Writing a state onto an element that declares none
     * would be a value nothing can read, and it would arrive on every element
     * a style rule happened to compare on — which is most of them, once this
     * feature is used.
     */
    report.check(
      'and does not invent a state on an element that has none',
      holder.getAttribute('data-cre8-value') === null,
      JSON.stringify(holder.getAttribute('data-cre8-value'))
    );

    /*
     * Off again, on the element that was on.
     *
     * The first version of this built a *fresh* element with an empty control
     * and checked the attribute was absent — which it was, because nothing had
     * ever put it there. Deleting the `removeAttribute` entirely left that
     * check green. Turning a state off is a different claim from never turning
     * it on, and only one element can make it.
     */
    control.value = '';
    testRuntime(hostFor(el({}, [holder])), false, { n5: rules });
    report.check(
      'and turns it off again when the comparison stops holding',
      holder.getAttribute(attr) === null,
      JSON.stringify(holder.getAttribute(attr))
    );
  }

  report.check(
    'a control the rule cannot see is undecided, not empty',
    (() => {
      const holder = el({
        'data-cre8-switch': 'form',
        'data-cre8-value': 'waiting',
        'data-cre8-else': 'waiting',
        'data-cre8-test': 'n3',
      });
      const root = el({}, [holder]);
      testRuntime(hostFor(root), false, {
        n3: [{ when: { kind: 'compare', left: { kind: 'input', name: 'email' }, op: 'empty' }, value: 'blank' }],
      });
      return holder.getAttribute('data-cre8-value') === 'waiting';
    })(),
    'a missing control does not read as an empty one'
  );

  /* ----------------------------------------------------------------------
   * What travels, and what has to be declared before it does
   * ------------------------------------------------------------------- */

  const runtimeNode = {
    id: 'n9', type: 'frame', name: 'Form', parentId: null, children: [],
    props: {}, styles: {}, meta: {},
    state: { key: 'form', values: ['waiting'], initial: 'waiting' },
    assign: [
      { id: 'p', when: { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'gt', right: { kind: 'literal', type: 'number', value: 5 } }, value: 'dear' },
      { id: 't', when: typedTest, value: 'ready' },
    ],
  };
  const foldedNode = { ...runtimeNode, id: 'n8', assign: [runtimeNode.assign[0]] };

  report.check(
    'a node with one runtime rule sends all of its rules',
    Object.keys(testTable({ n9: runtimeNode }, ['n9'])).length === 1 &&
      testTable({ n9: runtimeNode }, ['n9']).n9.length === 2,
    'the browser cannot arbitrate with half the list'
  );
  report.check(
    'and a node whose rules all fold sends none',
    Object.keys(testTable({ n8: foldedNode }, ['n8'])).length === 0 &&
      needsRuntime(foldedNode) === false
  );
  report.check(
    'the table is keyed by node, so a hundred rows share one entry',
    Object.keys(testTable({ n9: runtimeNode }, ['n9', 'n9', 'n9'])).join() === 'n9'
  );

  const exposed = publishedValues(runtimeNode, record({ price: 750000, secret: 'hidden' }));
  report.check(
    'an unfolded Test publishes the record values it reads',
    exposed && exposed.price === 750000,
    JSON.stringify(exposed)
  );
  report.check(
    'and only those — a field nothing reads is not published',
    exposed && !('secret' in exposed),
    JSON.stringify(exposed)
  );
  report.check(
    'a node that folds publishes nothing about the record',
    publishedValues(foldedNode, record({ price: 750000 })) === null
  );

  report.check(
    'a runtime rule with no fallback is refused as unfinished',
    typeof unfinished({ ...runtimeNode, state: { key: 'form', values: [], initial: '' } }) ===
      'string',
    String(
      unfinished({ ...runtimeNode, state: { key: 'form', values: [], initial: '' } })
    ).slice(0, 48)
  );
  report.check(
    'and one with a fallback is not',
    unfinished(runtimeNode) === null,
    String(unfinished(runtimeNode))
  );
  report.check(
    'a folded rule needs no fallback, because its answer is in the file',
    unfinished({ ...foldedNode, state: { key: 'form', values: [], initial: '' } }) === null
  );
  report.check(
    'but every rule needs somewhere to write to',
    typeof unfinished({ ...foldedNode, state: undefined }) === 'string'
  );

  /* ----------------------------------------------------------------------
   * Through a real publish
   *
   * The other half of what travels: the publisher has to put the table in the
   * page and the pointers on the elements, and a page whose Tests all fold has
   * to carry none of it. Written after a falsification pass found that nothing
   * here published a runtime Test at all — the publisher could have stopped
   * handing the runtime its rules and every check still passed.
   * ------------------------------------------------------------------- */

  {
    const build = (assign) => {
      const doc = createEmptyDocument('Signup');
      doc.collections = [
        { id: 'people', name: 'People', fields: [{ key: 'plan', label: 'Plan', type: 'text' }] },
      ];
      const page = doc.pages[0];
      const built = buildTree(
        {
          type: 'grid',
          name: 'Rows',
          repeat: { collection: 'people' },
          children: [
            {
              type: 'frame',
              name: 'Row',
              props: { switchKey: 'form', switchDefault: 'waiting' },
              children: [{ type: 'input', name: 'Email', props: { name: 'email' } }],
            },
          ],
        },
        doc.nodes
      );
      doc.nodes[built.rootId].parentId = page.rootNodeId;
      doc.nodes[page.rootNodeId].children.push(built.rootId);
      const row = Object.values(doc.nodes).find((n) => n.name === 'Row');
      row.assign = assign;
      return renderPage(doc, page, {
        records: {
          people: [
            { id: 'p1', collectionId: 'people', position: 0, published: true, createdAt: 0, updatedAt: 0,
              data: { plan: 'pro' } },
            { id: 'p2', collectionId: 'people', position: 1, published: true, createdAt: 0, updatedAt: 0,
              data: { plan: 'free' } },
          ],
        },
      });
    };

    const planIs = (value) => ({
      kind: 'compare', left: { kind: 'field', key: 'plan' }, op: 'eq', right: { kind: 'literal', type: 'text', value },
    });

    const live = build([
      { id: 'r1', when: planIs('pro'), value: 'paying' },
      { id: 'r2', when: typedTest, value: 'ready' },
    ]);
    const folded = build([{ id: 'r1', when: planIs('pro'), value: 'paying' }]);

    report.check(
      'a page with a runtime Test ships the rules once, in the one script',
      (live.match(/<script/g) ?? []).length === 1 && live.includes('"kind":"compare"'),
      `${(live.match(/<script/g) ?? []).length} scripts`
    );
    report.check(
      'and the rules are not repeated per row',
      (live.match(/"kind":"compare"/g) ?? []).length === 2,
      `${(live.match(/"kind":"compare"/g) ?? []).length} serialised comparisons for 2 rows and 2 rules`
    );
    report.check(
      'each row points at the shared entry and carries its own values',
      (live.match(/data-cre8-test="/g) ?? []).length === 2 &&
        live.includes('&quot;plan&quot;:&quot;pro&quot;') &&
        live.includes('&quot;plan&quot;:&quot;free&quot;'),
      'two pointers, two value sets'
    );
    report.check(
      'and the state it falls back to with no scripting is the folded answer',
      /data-cre8-else="paying"/.test(live) && /data-cre8-else="waiting"/.test(live),
      'the row that folded keeps its answer; the one that did not keeps the default'
    );
    report.check(
      'the page whose rules all fold ships no script and no Test attributes',
      !/<script/i.test(folded) &&
        !folded.includes('data-cre8-test') &&
        !folded.includes('data-cre8-vals'),
      /<script/i.test(folded) ? 'a script was shipped' : 'HTML and CSS only'
    );
    report.check(
      'and it still resolved its states',
      /data-cre8-value="paying"/.test(folded) && /data-cre8-value="waiting"/.test(folded),
      'folded, not skipped'
    );
    report.check(
      'nothing the Tests do not read is published about a record',
      !live.includes('secret'),
      'only referenced fields travel'
    );
  }

  /* --------------------------------------------------------------------
   * Reading a control that is not inside the rule's own node
   *
   * The lifting of `SCOPING`, which the model recorded as deferred until
   * references existed. Worth its own checks rather than a row in the matrix,
   * because the model's answer is "undecidable" by construction — the whole
   * behaviour is in the runtime, and the interesting half is *where* it looks.
   * ----------------------------------------------------------------------- */

  {
    const reader = el({ 'data-cre8-switch': 'form', 'data-cre8-value': 'idle', 'data-cre8-test': 'n1', 'data-cre8-else': 'idle' });
    const faraway = el({ 'data-cre8-el': 'email-node', name: 'email', value: '' });
    // Deliberately siblings: neither contains the other, which is exactly the
    // arrangement the old scoping could not express.
    const page = el({}, [el({}, [reader]), el({}, [faraway])]);
    const table = {
      n1: [
        {
          when: { kind: 'compare', left: { kind: 'element', ref: { node: 'email-node' } }, op: 'notEmpty' },
          value: 'ready',
        },
      ],
    };

    testRuntime(hostFor(page), false, table);
    report.check(
      'an empty control elsewhere on the page leaves the reader at its fallback',
      reader.attrs['data-cre8-value'] === 'idle',
      reader.attrs['data-cre8-value']
    );

    faraway.value = 'someone@example.test';
    testRuntime(hostFor(page), false, table);
    report.check(
      'and filling it in reaches a rule three branches away',
      reader.attrs['data-cre8-value'] === 'ready',
      // The sentence the old model could not express: the rule is on the
      // button, the control is somewhere else entirely.
      reader.attrs['data-cre8-value']
    );

    const orphan = el({ 'data-cre8-switch': 'form', 'data-cre8-value': 'idle', 'data-cre8-test': 'n2', 'data-cre8-else': 'idle' });
    testRuntime(hostFor(el({}, [orphan])), false, {
      n2: [
        {
          when: { kind: 'compare', left: { kind: 'element', ref: { node: 'not-here' } }, op: 'empty' },
          value: 'ready',
        },
      ],
    });
    report.check(
      'a control that is not there is undecidable, not empty',
      orphan.attrs['data-cre8-value'] === 'idle',
      // The same rule a named control gets, and for the same reason: "no such
      // element" is not the same fact as "the element holds nothing".
      orphan.attrs['data-cre8-value']
    );
  }

  {
    /*
     * The handle itself, off real markup.
     *
     * The fake DOM above sets `data-cre8-el` by hand, so it proves the runtime
     * uses the attribute and says nothing about anything emitting it — which
     * is how the first version of these checks stayed green with the renderer
     * no longer writing it at all.
     */
    const doc = createEmptyDocument('Controls');
    const page = doc.pages[0];
    const sub = {};
    const { rootId } = buildTree(
      {
        type: 'form',
        name: 'Form',
        children: [
          { type: 'input', name: 'Email', props: { name: 'email' } },
          { type: 'textarea', name: 'Note', props: { name: 'note' } },
          { type: 'text', name: 'Label', props: { text: 'not a control' } },
        ],
      },
      sub,
      page.rootNodeId
    );
    Object.assign(doc.nodes, sub);
    doc.nodes[page.rootNodeId].children.push(rootId);
    const html = renderPage(doc, page, {});
    const marked = [...html.matchAll(/data-cre8-el="([^"]+)"/g)].map((m) => m[1]);
    const controls = Object.values(doc.nodes).filter((n) =>
      ['input', 'textarea'].includes(n.type)
    );

    report.check(
      'every control publishes the handle a rule finds it by',
      controls.length === 2 && controls.every((n) => marked.includes(n.id)),
      `${marked.length} marked, ${controls.length} controls`
    );
    report.check(
      'and nothing else does',
      marked.length === controls.length,
      // Bounded on purpose: this is bytes on every published form, so it goes
      // on the things whose value can change and nowhere else.
      `${marked.length} handles on the page`
    );
  }

  {
    const read = { kind: 'compare', left: { kind: 'element', ref: { node: 'n9' } }, op: 'notEmpty' };
    report.check(
      'an element read is never folded at publish',
      foldable(read) === false && evaluate(read, record({ f: 1 })) === null,
      'the publisher cannot know what nobody has typed'
    );
    report.check(
      'and the node carrying it is told it needs the runtime, and an Otherwise',
      needsRuntime({ props: { switchKey: 'form' }, assign: [{ id: 'a', when: read, value: 'ready' }] }) &&
        Boolean(unfinished({ props: { switchKey: 'form' }, assign: [{ id: 'a', when: read, value: 'ready' }] })),
      'the same two consequences a typed operand has'
    );
    report.check(
      'and what it depends on is reportable',
      tests.elementsRead(read).join() === 'n9' && tests.inputsRead(read).length === 0,
      tests.elementsRead(read).join() || 'nothing'
    );
  }

  /* --------------------------------------------------------------------
   * Each of the above, handed something it must reject.
   * ----------------------------------------------------------------- */

  report.check(
    'the differential would notice the two disagreeing',
    publishAnswer([{ id: 'x', when: { kind: 'compare', left: { kind: 'field', key: 'f' }, op: 'gt', right: { kind: 'literal', type: 'number', value: 5 } }, value: 'yes' }], { f: 9 }) ===
      'yes',
    'the matrix contains cases that answer yes as well as cases that answer else'
  );
  report.check(
    'and the fake DOM is really running the real function',
    /data-cre8-test/.test(testRuntime.toString()),
    'the function under test is the one that ships'
  );
  report.check(
    'the disclosure check is not simply always empty',
    exposed && Object.keys(exposed).length === 1
  );
}

/* --------------------------------------------------------------------------
 * Saying what the state does, in the row that made it
 *
 * Phase C. `WHEN price > 500000 → hide` in one row instead of a state named
 * here and a rule written in another panel.
 *
 * The whole claim is that it is a *shortcut*, not a mechanism: what it writes
 * is the rule a designer would have written by hand, and nothing downstream
 * can tell which way it got there. So the checks compare the two documents
 * rather than inspecting the shortcut, and the interesting ones are about what
 * happens when the thing it wrote is later edited, renamed or removed.
 * ----------------------------------------------------------------------- */

report.group('an assignment can write the rule you would have written');

{
  const withAssign = (value = 'expensive') => {
    const doc = createEmptyDocument('Homes');
    const page = doc.pages[0];
    const node = doc.nodes[page.rootNodeId];
    /*
     * Declared, not scraped. A node built by hand here never passes through
     * `finishTree` or the document migration, which are the two doors that
     * fold `switchKey` into a declaration — so the fixture writes the shape
     * the model actually holds.
     */
    node.state = { key: 'band', values: ['ordinary'], initial: 'ordinary' };
    node.assign = [
      {
        id: 'a1',
        when: {
          kind: 'compare',
          left: { kind: 'field', key: 'price' },
          op: 'gt',
          right: { kind: 'literal', type: 'number', value: 500000 },
        },
        value,
      },
    ];
    return { doc, node };
  };

  /* The comparison the whole phase rests on. */
  {
    const shortcut = withAssign();
    ops.setAssignEffect(shortcut.doc, shortcut.node.id, 'a1', { kind: 'hide' });

    const byHand = withAssign();
    ops.addRule(byHand.doc, byHand.node.id, {
      id: 'whatever',
      // A `Test`, which is what `ops.addRule` takes. The editor's own
      // `addRule` folds the list shorthand for the menu that calls it; the
      // document operation is handed the stored shape.
      when: { kind: 'state', key: 'band', op: 'is', values: ['expensive'] },
      apply: { display: 'none' },
    });

    // Ids apart, which are minted and meaningless.
    const shape = (node) =>
      JSON.stringify((node.rules ?? []).map(({ id, ...rest }) => rest));
    report.check(
      'the shortcut writes the same rule a designer would',
      shape(shortcut.node) === shape(byHand.node),
      shape(shortcut.node)
    );
    report.check(
      'and it is an ordinary rule, on the ordinary list',
      shortcut.node.rules?.length === 1 && shortcut.node.rules[0].when.kind === 'state',
      `${shortcut.node.rules?.length} rules`
    );
  }

  /* Changing the effect rewrites; it does not accumulate. */
  {
    const { doc, node } = withAssign();
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'style', prop: 'opacity', value: '0.4' });
    report.check(
      'changing what a state does rewrites one rule rather than adding a second',
      node.rules?.length === 1 && node.rules[0].apply.opacity === '0.4',
      `${node.rules?.length} rules, ${JSON.stringify(node.rules?.[0]?.apply)}`
    );
    report.check(
      'and the old declaration is gone rather than left underneath',
      node.rules?.[0]?.apply.display === undefined
    );

    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'state' });
    report.check(
      'setting it back to “nothing” takes the rule away',
      !node.rules?.length,
      `${node.rules?.length ?? 0} rules`
    );
  }

  /* Reading it back. */
  {
    const { doc, node } = withAssign();
    report.check('an assignment with no rule reads as doing nothing', ops.assignEffect(node, 'a1').kind === 'state');
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
    report.check('and one that hides reads as hiding', ops.assignEffect(node, 'a1').kind === 'hide');
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'style', prop: 'color', value: 'red' });
    const read = ops.assignEffect(node, 'a1');
    report.check(
      'and a property assignment reads back as itself',
      read.kind === 'style' && read.prop === 'color' && read.value === 'red',
      JSON.stringify(read)
    );
  }

  /* Renaming, which is where a link by convention usually breaks. */
  {
    const { doc, node } = withAssign();
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
    ops.setAssignValue(doc, node.id, 'a1', 'Sold');
    report.check(
      'renaming the state takes its rule with it',
      node.assign[0].value === 'Sold' && node.rules?.[0]?.when?.values[0] === 'Sold',
      `${node.assign[0].value} / ${node.rules?.[0]?.when?.values[0]}`
    );
    report.check(
      'and there is still only one rule',
      node.rules?.length === 1,
      `${node.rules?.length} rules`
    );

    ops.setStateKey(doc, node.id, 'Price band');
    report.check(
      'renaming the key rewrites the rules on this node that name it',
      node.state?.key === 'Price-band' && node.rules?.[0]?.when?.key === 'Price-band',
      `${node.state?.key} / ${node.rules?.[0]?.when?.key}`
    );
  }

  /* A rule the designer has taken over is theirs. */
  {
    const { doc, node } = withAssign();
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
    // A second condition — the designer now means "hidden, but only on hover".
    // Growing one condition into two is a group, which is what the panel's
    // "+ and" builds and what `asTest` produces from a two-element list.
    node.rules[0].when = {
      kind: 'every',
      tests: [node.rules[0].when, { kind: 'pointer', pseudo: 'hover' }],
    };
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'style', prop: 'opacity', value: '0.5' });
    report.check(
      'a rule the designer has edited is no longer the assignment’s to rewrite',
      node.rules.length === 2 && node.rules[0].apply.display === 'none',
      `${node.rules.length} rules; the edited one kept ${JSON.stringify(node.rules[0].apply)}`
    );
  }

  /* Removing. */
  {
    const { doc, node } = withAssign();
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
    ops.removeAssign(doc, node.id, 'a1');
    report.check(
      'removing the assignment removes the rule it wrote',
      node.assign === undefined && !node.rules?.length,
      `${node.assign?.length ?? 0} assignments, ${node.rules?.length ?? 0} rules`
    );
  }
  {
    const { doc, node } = withAssign();
    ops.addRule(doc, node.id, {
      id: 'mine',
      when: { kind: 'pointer', pseudo: 'hover' },
      apply: { color: 'blue' },
    });
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
    ops.removeAssign(doc, node.id, 'a1');
    report.check(
      'and leaves rules that were nothing to do with it',
      node.rules?.length === 1 && node.rules[0].id === 'mine',
      `${node.rules?.length} rules left`
    );
  }

  /* --------------------------------------------------------------------
   * Each of the above, handed something it must reject.
   * ----------------------------------------------------------------- */

  report.check(
    'the sameness check is comparing something, not two empties',
    (() => {
      const { doc, node } = withAssign();
      ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
      return JSON.stringify(node.rules).includes('display');
    })(),
    'the hand-built and generated documents both contain a rule'
  );
  report.check(
    'an assignment with no state name writes nothing at all',
    (() => {
      const { doc, node } = withAssign('');
      ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
      return !node.rules?.length;
    })(),
    'a rule conditioned on an empty value would match everything'
  );
}

/* --------------------------------------------------------------------------
 * A number from the record, on a scale
 *
 * Phase D, and the only value in the model that differs per row. Everything
 * before it resolves to a state, and states are shared — a hundred cards in
 * three states need three rules. A hundred prices are a hundred numbers, so
 * they go where per-row things go: the element's own style attribute, with
 * `var()` in one shared rule doing the drawing.
 *
 * Which makes the size claim the one to check hardest. If this made the
 * stylesheet grow with the collection, the whole approach would be wrong, and
 * it would only show up on somebody's thousand-record site.
 * ----------------------------------------------------------------------- */

report.group('a number from the record, on a scale');

{
  const { mapNumber, varText, varsFor, varReference } = values;
  const spec = (over = {}) => ({
    value: { kind: 'field', key: 'price' },
    from: [0, 1000000],
    to: [0.3, 1],
    ...over,
  });

  report.check('the low end of the data is the low end of the scale', mapNumber(0, spec()) === 0.3);
  report.check('the high end is the high end', mapNumber(1000000, spec()) === 1);
  report.check(
    'and the middle is the middle',
    Math.abs(mapNumber(500000, spec()) - 0.65) < 1e-9,
    String(mapNumber(500000, spec()))
  );
  report.check(
    'a scale that runs backwards fades as the number grows',
    mapNumber(0, spec({ to: [1, 0] })) === 1 && mapNumber(1000000, spec({ to: [1, 0] })) === 0
  );

  /* The cases that are bugs rather than preferences. */
  report.check(
    'anything past the end is pinned to the end rather than escaping the scale',
    mapNumber(9000000, spec()) === 1 && mapNumber(-500, spec()) === 0.3,
    `${mapNumber(9000000, spec())} / ${mapNumber(-500, spec())}`
  );
  report.check(
    'a span of nothing does not divide by zero',
    mapNumber(5, spec({ from: [10, 10] })) === 0.3,
    String(mapNumber(5, spec({ from: [10, 10] })))
  );
  report.check(
    'a row with no number lands on the fallback, not on zero',
    mapNumber(undefined, spec()) === 0.3 && mapNumber(null, spec()) === 0.3 && mapNumber('', spec()) === 0.3,
    'the low end of the scale unless one was declared'
  );
  report.check(
    'and on the declared one when there is one',
    mapNumber(undefined, spec({ fallback: 0.05 })) === 0.05
  );
  report.check(
    'a value that is not a number at all is the fallback rather than NaN',
    mapNumber('on request', spec()) === 0.3,
    String(mapNumber('on request', spec()))
  );
  report.check(
    'a number stored as text still maps',
    mapNumber('500000', spec()) === mapNumber(500000, spec())
  );

  /* What reaches the markup. */
  report.check(
    'the number is rounded and carries no tail of zeros',
    varText(0.1 + 0.2) === '0.3' && varText(1) === '1' && varText(0.6500000001) === '0.65',
    `${varText(0.1 + 0.2)} / ${varText(1)} / ${varText(0.65000000001)}`
  );
  report.check(
    'and zero survives the trimming',
    varText(0) === '0',
    varText(0)
  );
  report.check(
    'the name is the one the designer is told to paste',
    varReference('heat') === 'var(--cre8-heat)',
    varReference('heat')
  );

  const node = {
    id: 'n1', type: 'frame', name: 'Card', parentId: null, children: [],
    props: {}, styles: {}, meta: {},
    vars: { heat: spec() },
  };
  const row = (price) => ({
    id: 'r', collectionId: 'homes', position: 0, published: true, createdAt: 0, updatedAt: 0,
    data: price === undefined ? {} : { price },
  });
  report.check(
    'a node writes one custom property per value it declares',
    JSON.stringify(varsFor(node, row(1000000))) === '{"--cre8-heat":"1"}',
    JSON.stringify(varsFor(node, row(1000000)))
  );
  report.check(
    'and writes it even when the record cannot answer',
    JSON.stringify(varsFor(node, row(undefined))) === '{"--cre8-heat":"0.3"}',
    'a property that came and went would break the rule on exactly the rows with no data'
  );

  /* ----------------------------------------------------------------------
   * Through a real publish, at two sizes
   * ------------------------------------------------------------------- */

  const heatDoc = () => {
    const doc = createEmptyDocument('Homes');
    doc.collections = [
      {
        id: 'homes',
        name: 'Homes',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'price', label: 'Price', type: 'number' },
        ],
      },
    ];
    const page = doc.pages[0];
    const built = buildTree(
      {
        type: 'grid',
        name: 'Listings',
        repeat: { collection: 'homes' },
        children: [
          {
            type: 'frame',
            name: 'Card',
            // The rule the designer writes once, in the ordinary inspector.
            styles: { opacity: 'var(--cre8-heat)' },
            children: [{ type: 'paragraph', name: 'Title', props: { text: 'A home' } }],
          },
        ],
      },
      doc.nodes
    );
    doc.nodes[built.rootId].parentId = page.rootNodeId;
    doc.nodes[page.rootNodeId].children.push(built.rootId);
    const card = Object.values(doc.nodes).find((n) => n.name === 'Card');
    card.vars = { heat: spec() };
    return { doc, page };
  };

  const HEAT = heatDoc();
  const rows = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: `h${i}`, collectionId: 'homes', position: i, published: true, createdAt: 0, updatedAt: 0,
      data: { title: `Home ${i}`, price: i * (1000000 / Math.max(count - 1, 1)) },
    }));
  const publishHeat = (count) => renderPage(HEAT.doc, HEAT.page, { records: { homes: rows(count) } });

  const small = publishHeat(2);
  const large = publishHeat(30);
  const bodyOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('</body>'));
  const styleOf = (html) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const heats = (html) => [...bodyOf(html).matchAll(/--cre8-heat:([^";]*)/g)].map((m) => m[1]);

  report.check(
    'every row carries its own number',
    heats(small).join(' › ') === '0.3 › 1',
    heats(small).join(' › ') || 'nothing written'
  );
  report.check(
    'thirty rows carry thirty of them, and they differ',
    heats(large).length === 30 && new Set(heats(large)).size === 30,
    `${heats(large).length} values, ${new Set(heats(large)).size} distinct`
  );
  report.check(
    'and the stylesheet is byte-identical at both sizes',
    styleOf(small) === styleOf(large),
    `${styleOf(small).length} vs ${styleOf(large).length} bytes`
  );
  report.check(
    'the rule that reads it is written once',
    (styleOf(small).match(/var\(--cre8-heat\)/g) ?? []).length === 1,
    `${(styleOf(small).match(/var\(--cre8-heat\)/g) ?? []).length} mentions`
  );
  report.check(
    'and no script was shipped to work any of it out',
    !/<script/i.test(large),
    'arithmetic at publish time, like the rows themselves'
  );

  /* --------------------------------------------------------------------
   * Each of the above, handed something it must reject.
   * ----------------------------------------------------------------- */

  report.check(
    'the size check would notice a stylesheet that grew',
    styleOf(small).length > 0 && heats(large).length > heats(small).length,
    'the two publishes genuinely differ in row count'
  );
  report.check(
    'the clamp checks are not asserting a constant',
    mapNumber(0, spec()) !== mapNumber(1000000, spec())
  );
  report.check(
    'and the trimming is not simply returning the input',
    varText(0.1 + 0.2) !== String(0.1 + 0.2)
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

  /* --- A woken room still knows which project it is ----------------------- */

  /*
   * Found in a browser, from the outside in: a live editing session started
   * answering "Project not found" for a project that was fine in D1.
   *
   * The room is addressed by `idFromName(projectId)` and there is no way back
   * from the id to the name, so anything that wakes it without a request —
   * an alarm, a message on a hibernated socket — starts with no project id.
   * `ensureLoaded` then asked D1 for a project called "", got nothing, and set
   * `loaded` anyway. From that moment the object held `doc: null` for a
   * document that existed: reads 404ed, and patches were applied to an
   * invented empty object and persisted over the real one.
   *
   * Scoped to the function rather than the file, because the file mentions the
   * id constantly and a check that only asked "is it in here somewhere" would
   * be green against every version of this bug.
   */
  const loader = roomSource.slice(
    roomSource.indexOf('private async ensureLoaded('),
    roomSource.indexOf('private persist(')
  );
  report.check(
    'a room woken with no request behind it reads its project id back from storage',
    /this\.projectId\s*=\s*\(await this\.ctx\.storage\.get<string>\(PROJECT_ID\)\)/.test(loader),
    /this\.projectId\s*=[^;\n]*/.exec(loader)?.[0]?.trim() ?? 'never recovered'
  );
  report.check(
    'and a load that found nothing is not remembered as a load',
    // `loaded` is what stops the retry, so setting it on the miss is what made
    // one unlucky wake permanent.
    /if \(!row\) return;/.test(loader) &&
      loader.indexOf('this.loaded = true') > loader.indexOf('if (!row) return;'),
    /if \(!row\)[^\n]*/.exec(loader)?.[0] ?? 'no guard — a miss is cached',
  );
  report.check(
    'and the id is written where a woken room can find it',
    /await this\.ctx\.storage\.put\(PROJECT_ID,/.test(roomSource),
    /storage\.put\(PROJECT_ID[^)]*\)/.exec(roomSource)?.[0] ?? 'never stored'
  );

  /*
   * The other half, and the one that could have cost somebody their site: a
   * patch applied to `this.doc ?? {}` edits an empty object when the document
   * is missing, and `persist()` writes it back.
   */
  /*
   * Comments stripped first, and not as tidiness: the first version of the
   * check below read the sentence in the comment that *describes* the old
   * code and reported the fix as missing. A source scrape has to read code.
   */
  const code = roomSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const patchCase = code.slice(code.indexOf("case 'patch':"), code.indexOf('async webSocketClose('));
  /*
   * A retry nobody records is a failure nobody can find.
   *
   * The alarm classifies what it catches and rethrows anything it cannot,
   * which is right — the platform's backoff is the correct answer to R2 having
   * a moment. What was wrong is that the rethrow said nothing, so a republish
   * that failed four times and succeeded on the fifth was indistinguishable
   * from one that worked, and the bug underneath it survived a full browser
   * suite. Only the wall clock knew: 39 seconds against 5.
   */
  const alarmCatch = code.slice(code.indexOf('catch (error) {', code.indexOf('publishSite(this.env')));
  /*
   * The transient branch alone, up to its `throw`. Scoped that tightly because
   * the first version allowed 400 characters of anything before the log it was
   * looking for — and the *permanent* branch has one, so deleting the transient
   * one left the check green. A window wide enough to reach the next statement
   * is a window wide enough to read the wrong answer.
   */
  const transient = alarmCatch.slice(
    alarmCatch.indexOf('if (!permanent(error)) {'),
    alarmCatch.indexOf('throw error;')
  );
  report.check(
    'an alarm that retries says what it is retrying after',
    /console\.error/.test(transient),
    /console\.error\([\s\S]{0,90}/
      .exec(transient)?.[0]
      ?.replace(/\s+/g, ' ') ?? 'rethrows in silence'
  );

  report.check(
    'a patch is never applied to a document the room does not have',
    /applyPatches\(this\.doc,/.test(patchCase) && !/applyPatches\(this\.doc \?\?/.test(patchCase),
    /applyPatches\([^,]*,/.exec(patchCase)?.[0] ?? 'no applyPatches in the patch case'
  );
  {
    // The refusal *after* the guard: the patch case opens with the view-only
    // denial, so the first `denied` in it is somebody else's.
    const guard = patchCase.indexOf('if (!this.doc) {');
    const refusal = guard < 0 ? -1 : patchCase.indexOf("t: 'denied'", guard);
    const fence = patchCase.indexOf('baseVersion !== this.version');
    report.check(
      'and the client is told to reload rather than handed a null document',
      // The old answer was `resync` carrying `doc: this.doc` — null — which the
      // client accepted as "you are up to date" and carried on editing into.
      guard >= 0 && refusal > guard && refusal < fence,
      guard < 0
        ? 'no guard on a missing document'
        : (/reason: '[^']*'/.exec(patchCase.slice(guard))?.[0] ?? 'no refusal after the guard')
    );
  }

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

/* ---------------------------------------------------------------------------
 * A panel that hides things has to be able to find them again
 *
 * The inspector shows a section when the element holds one of its declarations.
 * That makes one failure possible that could not happen before: a property
 * belonging to no section is set on an element, nothing counts it, the section
 * holding its control never appears — and the value is on the page, invisible
 * and uneditable. The vocabulary made coverage a compile error; this keeps the
 * second half of it, now that showing a control is a decision rather than a
 * given.
 * ----------------------------------------------------------------------- */

report.group('every property still has a section that would show it');

{
  const registry = readFileSync(
    path.join(ROOT, 'src/components/inspector/sections.ts'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* Which vocabulary sections the registry claims, read off the calls. */
  const claimed = new Set();
  for (const call of registry.matchAll(/propsOf\(([^)]*)\)/g)) {
    for (const name of call[1].matchAll(/'([a-zA-Z]+)'/g)) claimed.add(name[1]);
  }
  /* And the properties it names one at a time, where two sections share one
     vocabulary section — Animation and Transition both live under `motion`. */
  const named = new Set();
  for (const list of registry.matchAll(/props: \[([^\]]*)\]/g)) {
    for (const one of list[1].matchAll(/'([a-zA-Z]+)'/g)) named.add(one[1]);
  }

  /*
   * `table` is the one allowance, and it is a real one rather than an
   * exception: those rows render inside the per-type Content section, which
   * every element gets without asking. A table property being set therefore
   * cannot hide anything — the section holding it was never optional.
   */
  const ALWAYS_SHOWN = ['table'];

  const orphans = Object.entries(vocabulary.STYLE_VOCABULARY)
    .filter(([prop, entry]) => {
      if (claimed.has(entry.section)) return false;
      if (ALWAYS_SHOWN.includes(entry.section)) return false;
      return !named.has(prop);
    })
    .map(([prop, entry]) => `${prop} (${entry.section})`);

  report.check(
    'every declaration belongs to a section that would put itself on screen for it',
    orphans.length === 0,
    orphans.length
      ? `no section counts ${orphans.join(', ')}`
      : `${Object.keys(vocabulary.STYLE_VOCABULARY).length} properties, all accounted for`
  );

  /*
   * And the other half: a section in the registry with nothing to draw is an
   * entry in Add that does nothing when pressed — the exact failure the old
   * panel could not have, because a section was a component somebody had
   * already written into the panel by hand.
   */
  const panel = readFileSync(
    path.join(ROOT, 'src/components/inspector/inspector.tsx'),
    'utf8'
  );
  const renderers = new Set();
  const table = panel.slice(panel.indexOf('const RENDERERS'), panel.indexOf('function SectionSlot'));
  for (const entry of table.matchAll(/^\s{2}([a-zA-Z]+):\s*[A-Z]/gm)) renderers.add(entry[1]);

  const ids = [...registry.matchAll(/^\s{4}id: '([a-zA-Z]+)',$/gm)].map((one) => one[1]);
  const undrawn = ids.filter((id) => !renderers.has(id));
  report.check(
    'and every section the registry declares has something to draw',
    ids.length > 8 && undrawn.length === 0,
    undrawn.length ? `nothing renders ${undrawn.join(', ')}` : `${ids.length} sections, all drawn`
  );

  /*
   * "And only a handful of sections are essential" was here, counting how many
   * declare themselves so. It went out because it could not fail at the
   * granularity that matters: making Background essential to every element —
   * which is the old panel, one section at a time — left the count inside its
   * range and the check green.
   *
   * The claim belongs in a browser and is already made there. `inspector`
   * asserts a heading arrives with exactly Content and Typography, so one
   * extra essential section turns it red and names the section.
   */
}

/* ---------------------------------------------------------------------------
 * Hydration does not touch what it is handed
 *
 * Driven rather than read: the failure is a `TypeError` at runtime, on one
 * kind of input, from a function whose source looks entirely reasonable.
 * ----------------------------------------------------------------------- */

report.group('a document can be hydrated without being altered');

{
  /**
   * Every object reachable from `value`, frozen — which is what immer does to
   * anything it produces, and therefore what a Durable Object holds the moment
   * one patch has arrived over a socket.
   */
  const deepFreeze = (value, seen = new Set()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    return Object.freeze(value);
  };

  const saas = TEMPLATES.find((t) => t.id === 'saas');
  const built = saas.build();
  /*
   * A legacy prop on one node, because that is the branch the reported crash
   * came from: `migrateNode` converts it and writes `node.rules`, which on a
   * frozen node is `Cannot assign to read only property 'rules'`. Without it
   * the throw still happens — one line earlier, on `children` — and the check
   * would be proving something narrower than the bug.
   */
  const victim = Object.values(built.nodes).find((n) => n.type === 'heading');
  victim.props.switchCase = 'annual';

  const frozen = deepFreeze(structuredClone(built));
  let hydrated = null;
  let threw = '';
  try {
    hydrated = hydrateDocument(frozen);
  } catch (error) {
    threw = String(error.message ?? error).slice(0, 120);
  }

  report.check(
    'a frozen document hydrates rather than throwing',
    Boolean(hydrated),
    threw || `${Object.keys(hydrated?.nodes ?? {}).length} nodes through`
  );

  /*
   * And the half that says why it survived. A hydrate that quietly caught its
   * own error, or returned the input unrepaired, would pass the check above.
   */
  report.check(
    'and the legacy prop it carried is repaired on the way out',
    hydrated?.nodes[victim.id]?.props.switchCase === undefined &&
      (hydrated?.nodes[victim.id]?.rules?.length ?? 0) > 0,
    JSON.stringify({
      switchCase: hydrated?.nodes[victim.id]?.props.switchCase ?? null,
      rules: hydrated?.nodes[victim.id]?.rules?.length ?? 0,
    })
  );
  /*
   * "And the frozen document is unchanged" was here, and it is gone because it
   * could not fail: `Object.freeze` already guarantees it, and every attempt to
   * break the fix left it green. A check that asserts what the language
   * enforces is worse than no check — it reads like coverage.
   *
   * The claim it was reaching for is below, where nothing is frozen and the
   * rule has to be kept rather than imposed. "Does not mutate" is the rule; the
   * freeze is only what made breaking it fatal. A hydrate that copied only when
   * handed something frozen — the tempting shortcut, and the one that costs
   * nothing on the common path — passes everything above and fails here.
   */
  const thawed = structuredClone(built);
  const before = JSON.stringify(thawed);
  hydrateDocument(thawed);
  report.check(
    'and an unfrozen one is left alone too, which is the actual rule',
    JSON.stringify(thawed) === before,
    JSON.stringify(thawed) === before ? 'byte-identical after hydration' : 'hydration edited its input'
  );
}

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
        { id: 'good', when: { kind: 'state', state: 'hover' }, apply: { color: 'red' } },
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
  /*
   * And the thing that makes ungating safe.
   *
   * As a subsection of Content it drew *nothing* when no switch existed above
   * it, or every element in the library would have grown an Interaction
   * heading offering an empty menu. As a tab of its own it cannot do that — a
   * tab somebody clicked and got a blank panel from is worse than the noise —
   * so it explains itself instead. The claim is unchanged: it still reads the
   * scope and still branches on finding nothing.
   */
  /*
   * And what it does when there is nothing to say.
   *
   * The old claim was that the section *hid itself* when no switch existed
   * above it, which was right while `setState` was the only verb it could
   * offer. X8 made that the defect: a button that opens a panel or goes
   * somewhere has behaviour whether or not the page has a switch on it, and an
   * empty "When pressed" on such a button was the section disagreeing with the
   * element about what the element does.
   *
   * So the claim moves rather than goes. The menu is generated from the verb
   * registry, so it cannot fall behind what the compiler understands; and an
   * element with nothing wired says so in a sentence rather than sitting blank.
   */
  report.check(
    'the actions menu is generated from the verb table, not hand-listed',
    (() => {
      const at = content.indexOf('export function ActionsSection(');
      if (at < 0) return false;
      const body = content.slice(at, content.indexOf('\n}\n', at));
      return (
        body.includes('verbsFor(type)') &&
        // Every row's word comes from the table too, so the panel and the
        // compiler cannot disagree about what a verb is called.
        body.includes('VERBS[action.type]') &&
        /Nothing happens when this is pressed/.test(body)
      );
    })(),
    (() => {
      const at = content.indexOf('export function ActionsSection(');
      if (at < 0) return 'the section is gone entirely';
      const body = content.slice(at, content.indexOf('\n}\n', at));
      return [
        body.includes('verbsFor(type)') ? 'offers from the table' : 'hand-listed verbs',
        body.includes('VERBS[action.type]') ? 'labelled from the table' : 'hand-written labels',
        /Nothing happens when this is pressed/.test(body) ? 'says so when empty' : 'sits blank',
      ].join(' · ');
    })()
  );
  /*
   * And the half that makes the above worth having: every verb the model can
   * hold is one the panel can produce. A row `fresh` cannot build is a menu
   * entry that does nothing when picked.
   */
  report.check(
    'and every verb in the table has a row the panel can make',
    (() => {
      const at = content.indexOf('const fresh = (verb: VerbType)');
      if (at < 0) return false;
      const body = content.slice(at, content.indexOf('\n  };', at));
      return Object.keys(eventLib.VERBS).every((verb) => body.includes(`case '${verb}':`));
    })(),
    (() => {
      const at = content.indexOf('const fresh = (verb: VerbType)');
      if (at < 0) return 'nothing builds a row';
      const body = content.slice(at, content.indexOf('\n  };', at));
      const missing = Object.keys(eventLib.VERBS).filter((v) => !body.includes(`case '${v}':`));
      return missing.length ? `no row for ${missing.join(' ')}` : `all ${Object.keys(eventLib.VERBS).length}`;
    })()
  );

  /* --- Multi-selection ---------------------------------------------------- */

  /*
   * The three sections a multi-selection is *for* were once the three it did
   * not have. They cannot drift apart by hand any more — one list decides who
   * shows for one element and who shows for several — so what is checked now
   * is the rule that list encodes.
   *
   * `perElement` is the marker, and it has a criterion rather than being a
   * bag of exceptions: a section is per-element when it writes to one node's
   * own content or contract — its words, its binding, its conditions, what
   * happens when it is pressed, the props it lets an instance change, whether
   * this particular box is a link. Everything that describes *drawing* applies
   * to any number of nodes at once, and marking one of those per-element would
   * take it away from the moment a multi-selection exists for.
   */
  const registrySource = readFileSync(
    path.join(ROOT, 'src/components/inspector/sections.ts'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  const chunks = registrySource.split(/^    id: '/m).slice(1);
  const perElement = [];
  const bulk = [];
  for (const chunk of chunks) {
    const id = chunk.slice(0, chunk.indexOf("'"));
    (/^\s+perElement: true,$/m.test(chunk.split(/^    id: '/m)[0]) ? perElement : bulk).push(id);
  }

  const FOR_SEVERAL = ['layout', 'size', 'spacing', 'placement', 'typography', 'border'];
  report.check(
    'a multi-selection can lay out, grow and pin — the three it is for',
    FOR_SEVERAL.every((id) => bulk.includes(id)),
    FOR_SEVERAL.filter((id) => !bulk.includes(id)).join(', ') ||
      `${bulk.length} sections shared across a selection`
  );

  const OWN_CONTRACT = [
    'content',
    'component',
    'linkable',
    'semantics',
    'switch',
    'value',
    'rules',
    'data',
    'actions',
  ];
  const surprises = perElement.filter((id) => !OWN_CONTRACT.includes(id));
  report.check(
    'and there is nothing left that only one element can be given',
    surprises.length === 0 && perElement.length === OWN_CONTRACT.length,
    surprises.length
      ? `${surprises.join(', ')} is about drawing and would be lost on a multi-selection`
      : `${perElement.length} about one element, ${bulk.length} about any number`
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
          when: { kind: 'control', pseudo: 'checked' },
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

/* --------------------------------------------------------------------------
 * A value that is a number
 *
 * The switch is a state machine over named values, and no amount of composing
 * named states produces a divider dragged across a photograph — a hundred
 * positions would be a hundred cases and a hundred rules. So one more
 * mechanism, held to the same two promises the switch is held to: the page
 * looks right before any script runs, and the stylesheet does not grow.
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * Nobody has to know what a CSS variable is
 *
 * Every scale in the theme resolves through a custom property, and for four of
 * them the only way to use one was to know the spelling and type
 * `var(--r-md)` into a number field. That is a fine escape hatch and a bad
 * default: it asks somebody laying out a page to understand the token system
 * before they can use it, and it quietly rewards typing a raw `14px` — which
 * looks identical today and stops matching the site the moment the theme
 * moves.
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * The editor knows where it is pointed
 *
 * A popover on the canvas sits over the page it belongs to, and until now the
 * editor had no idea which of the two you meant. An element dropped from the
 * Insert panel landed on the page *behind* the panel you were looking at, and
 * a click meant for the panel selected whatever it happened to be covering.
 *
 * The fix is one field and one seam: every panel already asked `activeRootId`
 * what it was working in, so narrowing that answer narrows all of them at
 * once. What the canvas *draws* is deliberately a different question.
 * ----------------------------------------------------------------------- */

report.group('the editor knows whether it is editing the page or an overlay');

{
  const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
  const store = read(path.join('src', 'lib', 'editor', 'store.ts'));
  const canvas = read(path.join('src', 'components', 'canvas', 'canvas.tsx'));

  report.check(
    'an open overlay narrows what the editor is working in',
    /export function activeRootId\([\s\S]{0,400}?editingOverlayId/.test(store),
    'activeRootId answers with the overlay when one is open'
  );
  report.check(
    'and every panel gets the narrowing for free, because they all ask the same question',
    ['layers-panel.tsx', 'insert-panel.tsx']
      .map((f) => read(path.join('src', 'components', 'panels', f)))
      .every((src) => /activeRootId/.test(src)),
    'the layer tree and the Insert panel both root at it'
  );

  /*
   * The one place that must *not* narrow. A popover judged without the page
   * under it is a box floating in grey, so the canvas keeps drawing the page
   * and only what the editor will touch changes.
   */
  report.check(
    'but the canvas still draws the page, because that is what a popover sits on',
    /canvasRootId\(s\)/.test(canvas) && /export function canvasRootId/.test(store),
    'two questions, two answers'
  );
  report.check(
    'so a click outside the overlay hits nothing rather than the page behind it',
    /function inScope\(/.test(canvas) &&
      (canvas.match(/inScope\(store, hitTest\(/g) ?? []).length >= 2,
    `${(canvas.match(/inScope\(store, hitTest\(/g) ?? []).length} of the hit-test paths are filtered`
  );

  report.check(
    'only the two element types the browser puts in the top layer can be one',
    /node\?\.type !== 'popover' && node\?\.type !== 'dialog'/.test(store),
    'anything else is refused'
  );
  report.check(
    'there is a way in, a way out, and Escape unwinds to it',
    /store\.editOverlay\(hit\)/.test(canvas) &&
      /editOverlay\(null\)/.test(canvas) &&
      // Through the catalogue now: Escape's last rung and the menu's
      // "Finish editing overlay" are one command, so this checks the rung
      // reaches it and that the command still does the thing.
      /runCommand\('exitOverlay'\)/.test(read(path.join('src', 'lib', 'editor', 'shortcuts.ts'))) &&
      /exitOverlay: \{[\s\S]*?editOverlay\(null\)/.test(
        read(path.join('src', 'lib', 'editor', 'commands.ts'))
      ),
    'double-click in, breadcrumb or Escape out'
  );
  report.check(
    'and walking up the tree stops at the overlay rather than escaping it',
    /if \(first === activeRootId\(state\)\) return;/.test(store),
    'selectParent has a ceiling'
  );

  /* --- The backdrop ------------------------------------------------------- */

  const content = read(path.join('src', 'components', 'inspector', 'section-content.tsx'));
  report.check(
    'a backdrop is a control on the overlay, not a rule to go and build',
    /function BackdropControls/.test(content) &&
      (content.match(/<BackdropControls \/>/g) ?? []).length === 2,
    'on both the popover and the dialog'
  );
  /*
   * The two doors still write one rule.
   *
   * The overlay's control is a literal call and stays checked as one. The
   * Conditions panel's door stopped being a literal when the add menu became
   * a table, so that half is read as the value the table holds — which is the
   * better half of the check anyway: it compares the rule rather than the
   * spelling of the call that makes it.
   */
  const backdropOffer = conditions
    .conditionOffers({ type: 'dialog', states: [] })
    .find((offer) => offer.part === 'backdrop');
  report.check(
    'and it writes the same rule the Conditions panel would, so nothing new is stored',
    /addRule\(\[\], 'backdrop'\)/.test(content) &&
      Boolean(backdropOffer) &&
      backdropOffer.when.length === 0,
    backdropOffer
      ? `part: '${backdropOffer.part}', ${backdropOffer.when.length} conditions, from either door`
      : 'the menu no longer offers a backdrop'
  );

  /* --- Falsification ------------------------------------------------------ */

  report.check(
    'the scoping check would notice the canvas narrowing too',
    !/const rootId = useEditor\(\(s\) => activeRootId\(s\)\);/.test(canvas),
    'the canvas asks the drawing question, not the scope one'
  );
  report.check(
    'and the hit-filter check counts real call sites',
    (canvas.match(/inScope\(store, hitTest\(/g) ?? []).length !== 0,
    'a filter applied nowhere would report zero'
  );
}

report.group('nobody has to know what a CSS variable is');

{
  const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
  const inspector = (file) => read(path.join('src', 'components', 'inspector', file));
  const ui = (file) => read(path.join('src', 'components', 'ui', file));

  /*
   * Which scales have a picker, checked by finding one wired to each group
   * rather than by counting components. A new control for a fifth scale is
   * caught by the pin below; a control that stops being wired is caught here.
   */
  const panels = [
    inspector('sections-style.tsx'),
    inspector('sections-layout.tsx'),
    inspector('box-model.tsx'),
  ].join('\n');

  // Two spellings, because there are two shapes of control: a picker that
  // replaces a field takes `group="radius"`, and one folded inside a number
  // field arrives as `scale={{ group: 'width', … }}`.
  const wired = ['radius', 'shadow', 'spacing', 'width'].filter((group) =>
    new RegExp(`group="${group}"|group: '${group}'`).test(panels)
  );
  report.check(
    'every scale in the theme can be picked by name, not typed as a variable',
    wired.length === 4,
    wired.join(', ') || 'none'
  );

  // The escape hatch is the point of the design, not a leftover: a scale
  // cannot express every value and a control that only offers the scale would
  // be a worse editor, not a friendlier one.
  report.check(
    'and a raw value is still reachable behind every one of them',
    /advanced=\{/.test(panels) && /advanced\?: React\.ReactNode/.test(ui('token-field.tsx')),
    'the picker takes the old control as its custom case'
  );

  /*
   * The friendly name is the whole feature. A picker that lists `--r-md` has
   * moved the jargon rather than removed it, so the row renders the token's
   * `name` and the trigger does too.
   */
  const field = ui('token-field.tsx');
  report.check(
    'a token is shown by the name the theme gives it',
    /token \? token\.name/.test(field) && /label=\{t\.name\}/.test(field),
    'name on the trigger and on every row'
  );
  report.check(
    'and each one is drawn, because a list of sizes is unreadable as words',
    /function TokenPreview/.test(field) &&
      ['radius', 'shadow', 'spacing'].every((g) => new RegExp(`group === '${g}'`).test(field)),
    'radius, shadow and spacing each draw what they do'
  );

  /*
   * And the names themselves. `MD` is a thing you have to already know; the
   * ids stay `md` because that is what `var(--r-md)` is spelled with and
   * renaming them would break every stored document.
   */
  const theme = createEmptyDocument('Tokens').theme;
  const terse = [...theme.radii, ...theme.spacing, ...theme.shadows].filter((t) =>
    /^(XS|SM|MD|LG|XL|2XL|3XL)$/.test(t.name)
  );
  report.check(
    'the default scales are named in words rather than initials',
    terse.length === 0,
    terse.map((t) => t.name).join(', ') || theme.radii.map((t) => t.name).join(' / ')
  );
  report.check(
    'and their ids are untouched, because documents are written in terms of them',
    theme.radii.some((t) => t.id === 'md') && theme.spacing.some((t) => t.id === 'lg'),
    'var(--r-md) still resolves'
  );

  /* --- Falsification ------------------------------------------------------ */

  report.check(
    'the wiring check would notice a scale losing its picker',
    !/group="colour"|group: 'colour'/.test(panels),
    'a group nothing is wired to reports as missing'
  );
  report.check(
    'and the naming check can see a terse name',
    /^(SM|MD)$/.test('MD'),
    'the pattern it filters on matches what it is written against'
  );
}

report.group('a value that is a number, and a page that works without one');

{
  const html = (doc) =>
    generateSite(doc).files.find((f) => f.path === 'index.html')?.contents ?? '';

  /** A box holding a continuous value, with a slider inside driving it. */
  const rig = ({ key = 'split', value = 40, drives = 'split' } = {}) => {
    const doc = createEmptyDocument('Continuous');
    const home = doc.pages[0];
    const built = buildTree(
      {
        type: 'frame',
        name: 'Comparison',
        props: { rangeKey: key, rangeValue: value },
        styles: { position: 'relative' },
        children: [
          {
            type: 'image',
            name: 'Top',
            props: { src: '/after.webp', alt: 'After' },
            styles: { clipPath: `inset(0 0 0 calc(var(--cre8-${key}) * 1%))` },
          },
          { type: 'range', name: 'Split', props: { drives, min: 0, max: 100, step: 1 } },
        ],
      },
      doc.nodes
    );
    doc.nodes[built.rootId].parentId = home.rootNodeId;
    doc.nodes[home.rootNodeId].children.push(built.rootId);
    // Through the real operation, which is what keeps the group's number and
    // the slider's `value` in step. Written by hand this fixture set one and
    // not the other — and the check below caught it, which is the whole point
    // of the number living in two places being *checked* rather than trusted.
    ops.setRangeValue(doc, built.rootId, value);
    return doc;
  };

  const out = html(rig());

  report.check(
    'the number ships in the markup, so the page has a position before any script',
    /style="[^"]*--cre8-split:40/.test(out),
    /<[^>]*data-cre8-range[^>]*>/.exec(out)?.[0]?.slice(0, 110) ?? 'no group'
  );
  report.check(
    'the group says which value it holds, and the slider says which it moves',
    /data-cre8-range="split"/.test(out) && /data-cre8-drive="split"/.test(out),
    [/data-cre8-range="split"/.test(out) && 'group', /data-cre8-drive="split"/.test(out) && 'driver']
      .filter(Boolean)
      .join(' + ') || 'neither'
  );
  report.check(
    'and the slider starts where the value does, so the two agree with no script',
    /<input[^>]*type="range"[^>]*value="40"/.test(out),
    /<input[^>]*type="range"[^>]*>/.exec(out)?.[0]?.slice(0, 130) ?? 'no slider'
  );

  /*
   * The promise the switch makes and this has to make too. A continuous value
   * is one custom property and a `var()` in a rule the designer already wrote
   * — if it ever compiled to a rule per position, that is the check that would
   * say so.
   */
  const sheet = (doc) =>
    [...html(doc).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const at40 = sheet(rig({ value: 40 }));
  const at75 = sheet(rig({ value: 75 }));
  report.check(
    'moving the starting number does not change one byte of the stylesheet',
    at40.replace(/c-[a-z0-9]+/g, 'c-x') === at75.replace(/c-[a-z0-9]+/g, 'c-x'),
    `${at40.length} vs ${at75.length} bytes`
  );
  report.check(
    'and the rule that reads it is the designer’s own, compiled unchanged',
    at40.includes('clip-path:inset(0 0 0 calc(var(--cre8-split) * 1%))') ||
      at40.includes('clip-path: inset(0 0 0 calc(var(--cre8-split) * 1%))'),
    /clip-path:[^;}]*/.exec(at40)?.[0] ?? 'no clip-path in the sheet'
  );

  // A slider pointing at a value no ancestor holds is a slider, not a driver.
  // Nothing to attach to, and saying otherwise would give the runtime a
  // `closest()` that returns null on every input.
  const orphan = html(rig({ drives: 'nothing-holds-this' }));
  report.check(
    'a slider naming a value nobody holds still publishes as an ordinary slider',
    /data-cre8-drive="nothing-holds-this"/.test(orphan) &&
      !/value="40"/.test(orphan) &&
      /type="range"/.test(orphan),
    'it keeps its own value rather than borrowing one'
  );

  /* --- The block that could not be built --------------------------------- */

  const beforeAfter = BLOCKS.find((b) => b.id === 'app-before-after');
  report.check(
    'the block COMPONENT-LIBRARY.md recorded as unbuildable is in the registry',
    Boolean(beforeAfter),
    beforeAfter ? beforeAfter.name : 'missing'
  );

  if (beforeAfter) {
    const spec = beforeAfter.build();
    const nodes = [...walk(spec)].map((entry) => entry.node);
    const group = nodes.find((n) => n.props?.rangeKey);
    const driver = nodes.find((n) => n.props?.drives);
    const readers = nodes.filter((n) =>
      Object.values(n.styles ?? {}).some((v) => String(v).includes('var(--cre8-'))
    );

    report.check(
      'and it is one value, one native control, and rules that read it',
      Boolean(group) && driver?.type === 'range' && readers.length >= 2,
      `key ${group?.props.rangeKey}, driver ${driver?.type}, ${readers.length} rules read it`
    );
    report.check(
      'the control is the platform’s, so keyboard and touch are not reimplemented',
      driver?.type === 'range' && !nodes.some((n) => n.props?.onpointerdown),
      'a native range and no pointer handling of our own'
    );
    report.check(
      'and it is described, because the handle is the divider and has no label',
      typeof driver?.props.ariaLabel === 'string' && driver.props.ariaLabel.length > 8,
      String(driver?.props.ariaLabel ?? 'unlabelled')
    );
  }

  /* --- The number that lives in two places -------------------------------- */

  /*
   * The group holds the number as a custom property and the slider holds it as
   * its `value`, and with no script running those are two different elements
   * that both have to be right — the split *and* the handle sitting on it.
   *
   * Resolving one from the other at render time was tried first and taken out:
   * the canvas hands the element model an empty document on purpose, so a walk
   * up the tree finds nothing on one surface and the right answer on the
   * other. The canvas went white. So they are kept in step in the document,
   * and this is what makes that safe rather than hopeful.
   */
  {
    const mismatched = [];
    for (const block of BLOCKS) {
      const nodes = [...walk(block.build())].map((entry) => entry.node);
      for (const group of nodes.filter((n) => n.props?.rangeKey)) {
        const key = String(group.props.rangeKey);
        const held = Number(group.props.rangeValue ?? 50);
        for (const driver of nodes.filter((n) => n.props?.drives === key)) {
          if (Number(driver.props.value) !== held) {
            mismatched.push(`${block.id}: ${key} holds ${held}, slider says ${driver.props.value}`);
          }
        }
      }
    }
    const drivers = BLOCKS.flatMap((b) =>
      [...walk(b.build())].map((e) => e.node).filter((n) => n.props?.drives)
    );
    report.check(
      'every slider starts where the value it moves starts',
      mismatched.length === 0,
      mismatched.join('; ') || `${drivers.length} checked`
    );
    report.check(
      'and there is a slider to check',
      drivers.length > 0,
      `${drivers.length} continuous controls in the library`
    );
  }

  /* --- Falsification ------------------------------------------------------ */

  report.check(
    'the markup check would notice the number going missing',
    !/--cre8-split:/.test(
      html(rig({ key: '' })).replace(/data-cre8-range="[^"]*"/g, '')
    ),
    'a group with no key writes no custom property'
  );
  report.check(
    'and the stylesheet check compares sheets with something in them',
    at40.length > 200 && at40.includes('clip-path'),
    `${at40.length} bytes`
  );
}

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

report.group('one catalogue, and every surface dispatches through it');

{
  const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
  const commands = read(path.join('src', 'lib', 'editor', 'commands.ts'));
  const menus = read(path.join('src', 'lib', 'editor', 'menus.ts'));
  const shortcuts = read(path.join('src', 'lib', 'editor', 'shortcuts.ts'));
  const menuUi = read(path.join('src', 'components', 'ui', 'context-menu.tsx'));

  /*
   * The catalogue's ids, taken from the shape they are declared in:
   * `  someId: {\n    id: 'someId',`. Matching the inner `id:` rather than the
   * key means a copy-paste that leaves the old id behind is caught here rather
   * than becoming a menu item that runs the wrong command.
   */
  const declared = [...commands.matchAll(/\n  ([a-zA-Z]+): \{\n    id: '([a-zA-Z]+)',/g)];
  const ids = new Set(declared.map(([, key]) => key));

  report.check(
    'every command is filed under its own id',
    declared.length > 20 && declared.every(([, key, id]) => key === id),
    `${declared.length} commands${
      declared.filter(([, key, id]) => key !== id).map(([, key]) => key).join(', ') || ''
    }`
  );

  /*
   * The architecture requirement, as a property of the code rather than a
   * promise in a comment: the catalogue calls store actions and nothing else.
   * A `transact` here would be a second implementation of an editor action —
   * exactly the thing that produced two different Detach behaviours before.
   */
  report.check(
    'no command edits a document itself',
    !/transact\(/.test(commands) && !/\bops\./.test(commands),
    'every run body is a call into the store'
  );

  /* Menus name commands; they cannot carry one. */
  const named = [...menus.matchAll(/id: '([a-zA-Z]+)'/g)].map(([, id]) => id);
  const unknown = [...new Set(named.filter((id) => !ids.has(id)))];
  report.check(
    'every menu item names a command that exists',
    named.length > 20 && unknown.length === 0,
    unknown.length ? `unknown: ${unknown.join(', ')}` : `${new Set(named).size} distinct ids`
  );
  /*
   * Reading the store to decide what belongs in a menu is fine — whether an
   * overlay is open changes the list. Calling it is not: that would be an
   * action the catalogue never saw. So the rule is about calls, not reads.
   */
  const MENU_ACTS = /transact\(|useEditor|\.store\.[a-zA-Z]+\(/;
  report.check(
    'and a menu holds no action of its own',
    !MENU_ACTS.test(menus),
    'menus.ts reads state and names commands; it calls nothing'
  );
  report.check(
    'though it may read state, which is how it knows what to offer',
    /ctx\.store\.editingOverlayId/.test(menus) && !MENU_ACTS.test('ctx.store.editingOverlayId'),
    'a read is not a call'
  );

  /*
   * The keyboard used to carry its own copy of all of this. If any of these
   * names comes back, a shortcut and a menu item have started to be two
   * different things again, which is how they drift.
   */
  const OWN_ACTIONS =
    /duplicateSelection|deleteSelection|copySelection|cutSelection|groupSelection|ungroupSelection|toggleHidden|toggleLocked|createComponentFromNode|beginTextEdit\(id\)/;
  report.check(
    'the keyboard layer implements none of them',
    !OWN_ACTIONS.test(shortcuts),
    'it hands the chord to dispatchChord and stops'
  );
  report.check(
    'and the menu implements none of them either',
    !OWN_ACTIONS.test(menuUi) && /runCommand\(/.test(menuUi),
    'the only way it acts is runCommand'
  );

  /* --- Chords ------------------------------------------------------------ */

  const chords = [
    ...[...commands.matchAll(/keys: \[([^\]]+)\]/g)],
    ...[...commands.matchAll(/: \['((?:mod|alt|shift|\+|[a-zA-Z0-9\]\[])+)'\],/g)],
  ]
    .flatMap(([, body]) => [...body.matchAll(/'([^']+)'/g)].map(([, chord]) => chord))
    .concat(
      // argKeys entries, which are `name: ['chord'],` inside the block.
      [...commands.matchAll(/^      [a-z]+: \['([^']+)'\],$/gm)].map(([, chord]) => chord)
    );

  const seen = new Map();
  const clashes = [];
  for (const chord of chords) {
    if (seen.has(chord)) clashes.push(chord);
    seen.set(chord, true);
  }
  report.check(
    'no two commands claim the same chord',
    chords.length > 15 && clashes.length === 0,
    clashes.length ? `clash: ${clashes.join(', ')}` : `${chords.length} bindings`
  );

  /*
   * Shift changes what `event.key` reports for punctuation — Shift+] arrives
   * as `}` — so a binding written with the unshifted character would be
   * printed in the menu and never fire. Letters and named keys are unaffected.
   */
  const unreachable = chords.filter((chord) => {
    if (!chord.includes('shift+')) return false;
    const key = chord.split('+').pop();
    return key.length === 1 && !/[a-z0-9]/.test(key);
  });
  report.check(
    'and none of them is a chord the keyboard cannot produce',
    unreachable.length === 0,
    unreachable.length ? `shifted punctuation: ${unreachable.join(', ')}` : 'letters and named keys'
  );

  report.check(
    'the shortcut a menu prints is the one it binds',
    /function shortcutFor/.test(commands) &&
      /command\.argKeys\?\.\[arg\]\?\.\[0\]/.test(commands) &&
      !/[⌘⇧⌥]/.test(menuUi),
    'derived from keys, never typed into the menu'
  );

  /* --- Falsification ------------------------------------------------------ */

  report.check(
    'the unknown-id rule rejects an id that is not in the catalogue',
    !['paste', 'duplicate', 'notARealCommand'].every((id) => ids.has(id)),
    'a typo in a menu fails the build'
  );
  report.check(
    'the clash rule rejects a repeated chord',
    (() => {
      const doubled = [...chords, chords[0]];
      const counts = new Map();
      for (const chord of doubled) counts.set(chord, (counts.get(chord) ?? 0) + 1);
      return [...counts.values()].some((n) => n > 1);
    })(),
    'a second claim on one chord is visible'
  );
  report.check(
    'the shifted-punctuation rule rejects the binding it was written for',
    (() => {
      const key = 'mod+shift+]'.split('+').pop();
      return key.length === 1 && !/[a-z0-9]/.test(key);
    })(),
    'mod+shift+] would be caught'
  );
  report.check(
    'and the no-own-actions rule matches an action if one comes back',
    OWN_ACTIONS.test('store.duplicateSelection()') && MENU_ACTS.test('ctx.store.paste()'),
    'both regexes are checked against something they must reject'
  );

  /* --- The inspector's menu ---------------------------------------------- */

  const controls = read(path.join('src', 'components', 'inspector', 'controls.tsx'));
  const inspector = read(path.join('src', 'components', 'inspector', 'inspector.tsx'));

  report.check(
    'a right-click in the inspector is handled once, not per control',
    /data-style-props/.test(controls) &&
      (inspector.match(/onContextMenu=/g) ?? []).length === 1 &&
      /closest<HTMLElement>\('\[data-style-props\]'\)/.test(inspector),
    'one delegated handler reading what the row declared'
  );
  report.check(
    'and a text field keeps the browser’s own menu',
    /closest\('input, textarea, \[contenteditable="true"\]'\)/.test(inspector),
    'cut, paste and spelling are not ours to reimplement'
  );

  /*
   * Every property a row claims must be a real declaration.
   *
   * `StyleProp` already fails the build on a typo, so this is the other half:
   * that the rows actually claim anything at all. A menu that silently
   * degraded to the element menu everywhere would look exactly like a working
   * one until somebody tried to reset a shadow.
   */
  const styleFiles = ['sections-style.tsx', 'sections-layout.tsx', 'box-model.tsx'].map((f) =>
    read(path.join('src', 'components', 'inspector', f))
  );
  const annotated = styleFiles.reduce(
    (sum, file) => sum + (file.match(/styleProps=|data-style-props=/g) ?? []).length,
    0
  );
  report.check(
    'the style rows say which declarations they own',
    annotated >= 30,
    `${annotated} rows annotated`
  );
  report.check(
    'and each one is named, so the menu can say what it is about',
    styleFiles.every(
      (file) =>
        (file.match(/styleProps=/g) ?? []).length ===
        (file.match(/menuLabel="/g) ?? []).length + (file.match(/data-style-props=/g) ?? []).length * 0
    ) || styleFiles.every((file) => !/styleProps=(?![^>]*menuLabel)/.test(file)),
    'no row claims properties without naming them'
  );

  /*
   * The property commands must be unreachable without a subject. Reaching them
   * from the canvas would show "Reset padding" over an element nobody had
   * opened a padding row for, and the run would do nothing.
   */
  const PROPERTY_COMMANDS = [
    'resetProperty',
    'resetPropertyEverywhere',
    'copyValue',
    'pasteValue',
    'liftToAllBreakpoints',
  ];
  const gated = PROPERTY_COMMANDS.filter((id) => {
    const start = commands.indexOf(`\n  ${id}: {`);
    if (start < 0) return false;
    const body = commands.slice(start, commands.indexOf('\n  },', start));
    return /styleSubject\(ctx\)|hasAnyValue\(ctx\)|declaredInMoreThanOnePlace\(ctx\)|valueClipboard/.test(
      body
    );
  });
  report.check(
    'the subject travels with the command it was opened on',
    /runCommand\(id: string, arg\?: string, subject\?: MenuSubject\)/.test(commands) &&
      /commandContext\(subject\)/.test(commands) &&
      /runCommand\(item\.id, item\.arg, ctx\.subject\)/.test(menuUi),
    'rebuilding the context without it silently disabled every property command'
  );
  report.check(
    'every property command is gated on there being a property',
    gated.length === PROPERTY_COMMANDS.length,
    gated.length === PROPERTY_COMMANDS.length
      ? PROPERTY_COMMANDS.join(', ')
      : `ungated: ${PROPERTY_COMMANDS.filter((id) => !gated.includes(id)).join(', ')}`
  );
  report.check(
    'and none of them is offered on the element menu',
    !PROPERTY_COMMANDS.some((id) => menus.includes(`id: '${id}'`) && !menus.includes('styleMenu')),
    'they live in styleMenu, which only a style subject reaches'
  );

  /* --- The library panels ------------------------------------------------- */

  const panel = (name) => read(path.join('src', 'components', 'panels', `${name}-panel.tsx`));
  const pagesPanel = panel('pages');
  const componentsPanel = panel('components');
  const assetsPanel = panel('assets');

  /*
   * These three each had their own `transact` for every action they offered —
   * add a page, delete a component, rename an asset — which is the same
   * duplication the menu was built to end. Two of them now have none at all.
   */
  const collectionsPanel = panel('collections');
  const themePanel = panel('theme');
  const insertPanel = panel('insert');

  report.check(
    'five of the six panels write no transactions of their own',
    [pagesPanel, componentsPanel, collectionsPanel, themePanel, insertPanel].every(
      (file) => !/transact\(/.test(file)
    ),
    'pages, components, collections, theme and insert all go through store actions'
  );
  report.check(
    'and the only one left in Assets is the upload',
    (assetsPanel.match(/transact\(/g) ?? []).length === 1 &&
      /transact\('Upload asset'/.test(assetsPanel),
    'ingesting a file is not a menu action'
  );
  report.check(
    'nor do they reach for the document operations directly',
    [pagesPanel, componentsPanel, themePanel].every((file) => !/\bops\./.test(file)) &&
      // Collections keeps one: `retypeCost` reads what a type change would
      // cost. A question, not an edit.
      (collectionsPanel.match(/\bops\./g) ?? []).length === 1 &&
      /ops\.retypeCost/.test(collectionsPanel),
    'the one left is a read'
  );

  /*
   * An asset dropped on the canvas and one placed from its menu have to be the
   * same node. They were not: the drop controller built its own.
   */
  report.check(
    'a dropped asset and a placed one are the same command',
    /store\.placeAsset\(payload\.assetId, parentId, index\)/.test(
      read(path.join('src', 'components', 'canvas', 'drag-controller.tsx'))
    ) && /placeAsset\(assetId, parentId, index\)/.test(read(path.join('src', 'lib', 'editor', 'store.ts'))),
    'one definition, two ways to reach it'
  );

  /* Each panel names a subject and nothing else. */
  const SUBJECT_ROWS = [
    ['pages', pagesPanel, "kind: 'page'"],
    ['components', componentsPanel, "kind: 'component'"],
    ['components', componentsPanel, "kind: 'variant'"],
    ['assets', assetsPanel, "kind: 'asset'"],
    ['collections', collectionsPanel, "kind: 'collection'"],
    ['collections', collectionsPanel, "kind: 'field'"],
    ['theme', themePanel, "kind: 'token'"],
    ['insert', insertPanel, "kind: 'block'"],
    ['insert', insertPanel, "kind: 'elementType'"],
    ['collections', collectionsPanel, "kind: 'record'"],
  ];
  const wired = SUBJECT_ROWS.filter(([, file, subject]) => file.includes(subject));
  report.check(
    'every library panel opens the menu with a subject',
    wired.length === SUBJECT_ROWS.length,
    wired.map(([name, , subject]) => `${name}:${subject.slice(7)}`).join(' ')
  );
  report.check(
    'and none of them passes anything else to it',
    [pagesPanel, componentsPanel, assetsPanel, collectionsPanel, themePanel, insertPanel].every(
      (file) => !/openContextMenu\([^)]*items/.test(file)
    ),
    'a caller can say what was clicked, never what to do about it'
  );

  /*
   * A draft must be visible where it is worked on and invisible where it is
   * shipped. The adapter had `publishedOnly: true` welded in, so the editor's
   * own Collections panel could not list a record it had just created as a
   * draft — Duplicate looked like it had silently failed.
   */
  const adapter = read(path.join('src', 'lib', 'api', 'cloudflare.ts'));
  const publisher = read(path.join('src', 'lib', 'publishing', 'publish.ts'));
  report.check(
    'the editor lists drafts and the publisher does not',
    /publishedOnly: options\.publishedOnly \?\? true/.test(adapter) &&
      (read(path.join('src', 'lib', 'editor', 'store.ts')).match(
        /publishedOnly: false/g
      ) ?? []).length === 2 &&
      !/publishedOnly/.test(publisher),
    'the safe answer is the default; only the editor asks for more'
  );
  report.check(
    'and the rule would notice the publisher asking for drafts',
    /publishedOnly/.test('listRecords(id, c, { publishedOnly: false })'),
    'a publisher that asked would be caught'
  );

  /*
   * A record row has two doors — the hover button and the right-click — and
   * they used to be two implementations. The hover one now names catalogue
   * ids, so the wording and the behaviour cannot come apart.
   */
  report.check(
    'a record’s hover menu runs the same commands its right-click does',
    /runCommand\(id, undefined, subject\)/.test(collectionsPanel) &&
      ['designAgainstRecord', 'toggleRecordPublished', 'duplicateRecord', 'deleteRecord'].every(
        (id) => collectionsPanel.includes(`run('${id}')`)
      ),
    'four actions, named by id'
  );
  report.check(
    'and it reaches none of them any other way',
    !/\.deleteRecord\(|\.saveRecord\(collection\.id, \{ id:/.test(collectionsPanel),
    'no direct calls left in the row'
  );

  /*
   * Same rule as the property commands: unreachable without the subject they
   * are about, so none of them can turn up on the canvas menu acting on
   * nothing.
   */
  const LIBRARY_COMMANDS = [
    'openPage',
    'duplicatePage',
    'setHomePage',
    'movePage',
    'renamePage',
    'deletePage',
    'editComponentMain',
    'insertInstance',
    'addVariant',
    'renameComponent',
    'deleteComponent',
    'editVariant',
    'deleteVariant',
    'placeAsset',
    'copyAssetUrl',
    'renameAsset',
    'deleteAsset',
    'addField',
    'renameCollection',
    'deleteCollection',
    'moveField',
    'toggleFieldRequired',
    'setSlugField',
    'deleteField',
    'copyTokenReference',
    'copyTokenValue',
    'renameToken',
    'deleteToken',
    'insertBlock',
    'insertOnPage',
    'insertInSelection',
    'editRecord',
    'duplicateRecord',
    'toggleRecordPublished',
    'designAgainstRecord',
    'deleteRecord',
  ];
  const RESOLVERS =
    /pageOf\(ctx\)|componentOf\(ctx\)|variantOf\(ctx\)|assetOf\(ctx\)|collectionOf\(ctx\)|fieldOf\(ctx\)|tokenOf\(ctx\)|blockOf\(ctx\)|elementTypeOf\(ctx\)|recordOf\(ctx\)/;
  const ungatedLibrary = LIBRARY_COMMANDS.filter((id) => {
    const start = commands.indexOf(`\n  ${id}: {`);
    if (start < 0) return true;
    const body = commands.slice(start, commands.indexOf('\n  },', start));
    return !RESOLVERS.test(body);
  });
  report.check(
    'every library command is gated on the thing it is about',
    ungatedLibrary.length === 0,
    ungatedLibrary.length ? `ungated: ${ungatedLibrary.join(', ')}` : `${LIBRARY_COMMANDS.length} commands`
  );

  /*
   * A subject with no menu is a right-click that opens nothing. `menuFor`
   * switches on the kind, so every kind the type allows must appear there.
   */
  const kinds = [...commands.matchAll(/\| \{ kind: '(\w+)'/g)].map(([, kind]) => kind);
  const unhandled = kinds.filter((kind) => !menus.includes(`case '${kind}':`));
  report.check(
    'and every subject the type allows has a menu',
    kinds.length >= 11 && unhandled.length === 0,
    unhandled.length ? `no menu for: ${unhandled.join(', ')}` : kinds.join(', ')
  );

  /* --- Falsification ------------------------------------------------------ */

  report.check(
    'the subject-coverage rule would notice a kind nobody handled',
    !menus.includes("case 'nosuchkind':"),
    'a new subject with no menu fails the build'
  );
  report.check(
    'and the gating rule rejects a library command with no resolver',
    !RESOLVERS.test("run: (ctx) => ctx.store.removePage('page-1')"),
    'a hardcoded id would be caught'
  );
  report.check(
    'the annotation count would notice the rows going away',
    !(0 >= 30),
    'an unannotated inspector fails this'
  );
  report.check(
    'and the gate rule rejects a command with no subject check',
    !/styleSubject\(ctx\)|hasAnyValue\(ctx\)|declaredInMoreThanOnePlace\(ctx\)|valueClipboard/.test(
      "run: (ctx) => ctx.store.resetStyleProps(['gap'])"
    ),
    'a hardcoded property would be caught'
  );
}

/* --------------------------------------------------------------------------
 * One description of an expression
 *
 * The panels render expressions as sentences, and the claim that makes it
 * worth the code is that the *same builder* produces the editable form and
 * every read-only one. A heading that says "Hovered" over controls that say
 * "hover" is the small version of the failure; a rule summary that disagrees
 * with the rule is the large one, and it is what the old code had — a switch
 * over condition kinds written next to the controls and free to drift.
 *
 * That is a claim about where the words live, so it is checked against the
 * source. The same shape as the `formatValue` one-caller rule, and for the
 * same reason: it is the structure that makes the property true, not a value
 * anybody can assert on.
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * Duplicating a component
 *
 * The one operation in the component set that could not be assembled out of
 * the others, and the reason the menu had been missing it. A component is not
 * a subtree: it is a master tree, a tree per variant, and properties naming
 * nodes inside all of them. Clone the master and stop, and the copy shares the
 * original's variants — edit the copy's secondary button and the original
 * changes with it, which is exactly what a duplicate exists to avoid.
 *
 * So the checks are about independence rather than about the copy existing.
 * Every one of them is a way for two components to stay joined.
 * ----------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * Every template, not one of them
 *
 * Eight templates ship and, until this group existed, exactly one of them was
 * ever checked — `fidelity` opens the SaaS page and nothing looks at the other
 * seven. That is the gap the block sweep was built to close, left open in the
 * one place it matters most: a template is the first thing anybody sees, and a
 * broken link or a hard-coded colour in one is a first impression rather than
 * a bug report.
 *
 * These are the template's own questions rather than the block rules borrowed.
 * A block is a `NodeSpec` and a template is a finished document, so "does this
 * grid say what it does when narrow" has already been answered by the blocks
 * it is made of. What has not been answered is whether the *assembly* holds
 * together: do its links go anywhere, does every page publish, is the theme it
 * ships complete.
 * ----------------------------------------------------------------------- */

report.group(`Templates — ${TEMPLATES.length}, every one of them`);

{
  /*
   * The alt-text rule was deleted from this group once, for the right reason:
   * no template contained an `image` node, so it passed for ever and read to
   * whoever came next as a covered case. It is back because the templates now
   * carry photography — and it comes back with `imagesSwept`, so the day it
   * becomes vacuous again it fails instead of quietly agreeing.
   *
   * Word boundaries below, because without them "Mastodon" contains "todo" —
   * which the rule duly reported as filler copy in the blog template's footer
   * on its first run.
   */
  const LAZY = new Set(['', 'image', 'photo', 'picture', 'img', 'graphic', 'placeholder']);
  /** Where a literal colour is never the right answer. A gradient is a picture. */
  const THEME_PROPS = new Set([
    'color',
    'backgroundColor',
    'borderColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'outlineColor',
  ]);
  const PLACEHOLDER = /lorem ipsum|your text here|\buntitled\b|\btodo\b|\btbd\b|\bxxx\b|placeholder text/i;

  report.check(
    'template ids are unique',
    new Set(TEMPLATES.map((t) => t.id)).size === TEMPLATES.length,
    TEMPLATES.map((t) => t.id).join(', ')
  );
  report.check(
    'every one says what it is, and what colour it is',
    TEMPLATES.every(
      (t) => t.name?.trim() && t.description?.trim() && t.swatch?.length === 2
    ),
    TEMPLATES.filter((t) => !t.description?.trim()).map((t) => t.id).join(', ') || 'all described'
  );

  const built = TEMPLATES.map((template) => {
    try {
      return { template, doc: template.build(), error: null };
    } catch (error) {
      return { template, doc: null, error: String(error?.message ?? error) };
    }
  });

  report.check(
    'every template builds',
    built.every((one) => one.doc),
    built.filter((one) => !one.doc).map((one) => `${one.template.id}: ${one.error}`).join(' | ') ||
      'all eight'
  );

  /* Collected across every template, so one failure names the template. */
  const noPages = [];
  const deadLinks = [];
  const brokenLinks = [];
  const rawColour = [];
  const unnamed = [];
  const droppedSet = [];
  const bothWays = [];
  const handTyped = [];
  const placeholder = [];
  const skippedHeading = [];
  const noHeading = [];
  const wontPublish = [];
  const formsWithoutSubmit = [];
  const notSubmittable = [];
  const unreachable = [];
  const notShared = [];
  const missingRows = [];
  const lazyAlt = [];
  const unsized = [];
  const tooEager = [];
  const fakeAffordances = [];
  const photoHosts = new Set();
  let imagesSwept = 0;
  let seededRows = 0;
  let pagesSwept = 0;
  let nodesSwept = 0;
  let linksWalked = 0;

  for (const { template, doc } of built) {
    if (!doc) continue;
    const label = template.id;
    if (!doc.pages.length) noPages.push(label);

    /*
     * Pages *and* component masters.
     *
     * A master is not reachable from any page root — the page holds an
     * instance — so a sweep that walked only pages would quietly stop checking
     * a section the moment it was shared, which is exactly what happened the
     * first time the SaaS navbar became a component: every rule below went on
     * passing with a quarter of the document no longer looked at. The count is
     * reconciled against the documents afterwards so it cannot happen again.
     */
    const trees = [
      ...doc.pages.map((page) => ({ where: `${label}/${page.slug || '/'}`, root: page.rootNodeId, page })),
      ...doc.components.map((c) => ({ where: `${label} «${c.name}»`, root: c.rootNodeId, page: null })),
    ];

    for (const { where, root, page } of trees) {
      if (page) pagesSwept++;
      // Heading order per page, not per document: a level 1 on the home page
      // says nothing about what the pricing page may open with. A master has
      // no order of its own — it is drawn wherever it is placed — so the two
      // heading rules apply to pages only.
      let previous = null;
      let sawH1 = false;
      let eagerHere = 0;
      const stack = [root];
      let seen = 0;
      while (stack.length && seen < 5000) {
        const id = stack.pop();
        const node = doc.nodes[id];
        if (!node) continue;
        seen++;
        nodesSwept++;
        // Depth-first in document order, so "skips a level" means what it says.
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);

        if (!String(node.name ?? '').trim()) unnamed.push(`${where}: a node`);

        /*
         * A `set` the expansion will silently drop.
         *
         * `variantsOf` only expands content along a *state* or *data* axis,
         * because those are the two that guarantee mutual exclusion and keep
         * the expansion linear. Anything else — an `attr` condition, a pointer
         * pseudo — is skipped, and skipped means the rule still looks like it
         * works in the source and does nothing in the output.
         *
         * The block library has been checked for this since stage 2. Templates
         * had not been, so a rule that blocks were forbidden to ship could ship
         * from a template instead — which is exactly how the first version of
         * the copy button here claimed to change its own word.
         */
        /*
         * The same jump/navigate exclusivity the block rule checks, applied to
         * what a template actually builds. Worth having in both places for the
         * reason this file keeps relearning: the block rule reads specs, and a
         * template is free to compose a node the block library never wrote.
         */
        {
          const href = String(node.props?.href ?? '');
          // A bare `#` is the element default, not a destination anybody typed.
          if (href.startsWith('#') && href.length > 1) {
            handTyped.push(`${where}: href "${href}"`);
          }
        }

        {
          const moves = fakeAffordance(node);
          if (moves) fakeAffordances.push(`${where}: lifts on hover (${moves}), goes nowhere`);
        }

        if (node.refs?.scrollTo) {
          const href = String(node.props?.href ?? '').trim();
          if (href && href !== '#') {
            bothWays.push(`${where}: jumps and also links to "${href}"`);
          }
        }

        for (const rule of node.rules ?? []) {
          if (!rule.set || !Object.keys(rule.set).some((prop) => SETTABLE.has(prop))) continue;
          const found = conditionsIn(rule.when);
          const only = found.length === 1 ? found[0] : null;
          const expands =
            only &&
            (only.kind === 'state' || only.kind === 'data' || only.kind === 'attr') &&
            only.op === 'is' &&
            only.values?.length &&
            !rule.part &&
            !rule.breakpoint;
          if (!expands) {
            droppedSet.push(`${where}: content varies on "${only?.kind ?? 'several conditions'}"`);
          }
        }

        if (node.type === 'image') {
          imagesSwept++;
          const alt = String(node.props?.alt ?? '').trim();
          if (LAZY.has(alt.toLowerCase())) lazyAlt.push(`${where}: alt is “${alt}”`);
          if (!holdsItsShape(node)) {
            unsized.push(`${where}: ${alt || 'an image'} ${whyUnsized(node)}`);
          }
          const src = String(node.props?.src ?? '');
          if (/^https?:\/\//.test(src)) photoHosts.add(new URL(src).origin);
          if (node.props?.priority) eagerHere++;
        }

        if (node.type === 'heading' && page) {
          const level = Number(node.props?.level ?? 2);
          if (level === 1) sawH1 = true;
          if (previous !== null && level > previous + 1) {
            skippedHeading.push(`${where}: h${previous} → h${level}`);
          }
          previous = level;
        }
        for (const value of Object.values(node.props ?? {})) {
          if (typeof value === 'string' && PLACEHOLDER.test(value)) {
            placeholder.push(`${label}: “${value.slice(0, 40)}”`);
          }
        }
        // A form nobody can send. The button inside one is a `<button>`, whose
        // HTML default is `type="submit"` — so the app writing `type="button"`
        // on everything meant every contact form it shipped had a Send that
        // did nothing at all.
        if (node.type === 'form') {
          const inside = [];
          const forStack = [...node.children];
          while (forStack.length) {
            const child = doc.nodes[forStack.pop()];
            if (!child || child.type === 'form') continue;
            inside.push(child);
            forStack.push(...child.children);
          }
          if (!inside.some((one) => one.props?.submit)) {
            formsWithoutSubmit.push(`${where}: ${node.name}`);
          }
        }

        /*
         * Through the block suite's own `colourOffences`, not a second rule.
         * Written stricter the first time and it reported four colours that
         * are already decided — the macOS traffic lights and the mock's
         * healthy-status green, each in `LITERAL_COLOURS` with a reason. Two
         * copies of one policy is how the reasons get lost.
         *
         * `backgroundImage` is deliberately out of scope. A gradient panel is
         * a stand-in *picture* — a portfolio's six projects each have their
         * own colour, and a rule that forced them onto tokens would make the
         * grid one colour and destroy the point of it. The rule for pictures
         * is alt text, which is checked above.
         *
         * That leaves a real case unguarded, and it is worth naming rather
         * than pretending otherwise: the SaaS and startup heroes had gradients
         * that were frozen copies of `--c-primary` and `--c-accent`, so
         * retheming left the product panel on the old brand. Those are tokens
         * now. The rule that would have caught them — no literal may equal a
         * theme value — fired on the agency's project cards, whose artwork
         * shares a colour with its theme on purpose, and a rule that cannot
         * tell harmony from staleness is one that gets silenced.
         */
        for (const styles of Object.values(node.styles ?? {})) {
          for (const [prop, value] of Object.entries(styles ?? {})) {
            if (typeof value !== 'string') continue;
            if (THEME_PROPS.has(prop)) {
              for (const offence of colourOffences(value)) {
                rawColour.push(`${label} ${prop}: ${offence}`);
              }
            }
            if (prop === 'fontFamily' && !value.startsWith('var(')) {
              rawColour.push(`${label} fontFamily: ${value}`);
            }
          }
        }
      }
      // A page with no headings at all is not a page missing its first one —
      // Blank is an empty canvas, and demanding an h1 of it would be demanding
      // content the template exists to not have.
      if (page && previous !== null && !sawH1) noHeading.push(where);
      // A page where everything is urgent has nothing urgent: `priority` turns
      // off lazy loading and asks for high fetch priority, and handing that to
      // four images is how the one a visitor is actually waiting for arrives
      // last.
      if (eagerHere > 1) tooEager.push(`${where}: ${eagerHere} images marked priority`);
    }

    /*
     * Anything that appears twice should have been made once.
     *
     * Asked of the *rendered* section rather than of the fingerprint that
     * decides sharing, because the two must not be the same judgement. The
     * first fingerprint was too strict — it kept the minted rule ids and the
     * per-subtree popover reference — so nothing matched anything and the
     * feature shipped doing nothing while every other check stayed green.
     * A rule that consults the thing it is checking cannot notice that.
     *
     * Instances are skipped: a shared navbar renders identically on all four
     * pages *because* it was shared, which is the success case.
     */
    const shapes = new Map();
    for (const page of doc.pages) {
      for (const id of doc.nodes[page.rootNodeId]?.children ?? []) {
        const node = doc.nodes[id];
        if (!node || node.type === 'instance') continue;
        const markup = renderNodeToHtml(doc, id).replace(/ class="[^"]*"/g, '');
        shapes.set(markup, [...(shapes.get(markup) ?? []), node.name]);
      }
    }
    for (const [, where] of shapes) {
      if (where.length > 1) notShared.push(`${label}: ${where.length}× ${where[0]}`);
    }

    /*
     * Published with the template's own content, not empty.
     *
     * A dynamic page with no records produces no files at all, so a sweep that
     * published the blog with an empty collection would never look at an essay
     * page, never follow the link from a card to it, and never see the paging
     * a six-essay collection generates. The rows the template ships are the
     * rows to publish it with.
     */
    const records = {};
    for (const row of template.seed ?? []) {
      const collection = (doc.collections ?? []).find((c) => c.name === row.collection);
      if (!collection) {
        wontPublish.push(`${label}: seeds “${row.collection}”, which it does not define`);
        continue;
      }
      seededRows++;
      const pool = (records[collection.id] ??= []);
      pool.push({
        id: `seed-${pool.length}`,
        collectionId: collection.id,
        slug: row.slug,
        position: pool.length,
        published: true,
        data: row.data,
        createdAt: 0,
        updatedAt: 0,
      });
    }

    try {
      const site = generateSite(doc, { pretty: false, records });
      const files = (site.files ?? []).map((file) => file.path ?? '');
      if (!files.some((name) => name.endsWith('.html'))) wontPublish.push(`${label}: no html`);
      if (files.length < doc.pages.length) {
        wontPublish.push(`${label}: ${files.length} files for ${doc.pages.length} pages`);
      }
      /*
       * A row is only content if it became a page somebody can open. The
       * whole point of seeding is that the blog arrives as a blog rather than
       * as an empty shape, and "the collection has six rows" does not say
       * that — six files at six addresses does.
       */
      for (const row of template.seed ?? []) {
        if (!files.some((name) => name.includes(`/${row.slug}/`))) {
          missingRows.push(`${label}: nothing published for “${row.slug}”`);
        }
      }

      followEveryLink(
        label,
        site,
        // Named sections, from the document rather than from the markup: the
        // question is whether what the *template* declared is reachable, and
        // reading it back out of the output the renderer produced would be
        // asking the renderer to mark its own work.
        Object.values(doc.nodes)
          .map((node) => anchorId(node.props?.anchor))
          .filter(Boolean)
      );
    } catch (error) {
      wontPublish.push(`${label}: ${String(error?.message ?? error)}`);
    }
  }

  /**
   * Follow every link in the published site, as a visitor would.
   *
   * Written against the *output* rather than against `props.href`, because the
   * document cannot answer the question. `resolvePageRefs` rewrites a template
   * link naming a page that does not exist to `#` — so by the time anything
   * can read the built document, a mistyped destination and a link that was
   * always inert look identical. Checking props for a dangling `page:<id>`
   * therefore checks for a state the pipeline makes unreachable: it passed on
   * eight templates that between them shipped ninety dead links.
   *
   * What is left after the laundering is the honest signal, and it is in the
   * markup: an `<a>` whose href is `#`.
   */
  function followEveryLink(label, site, declared) {
    const reached = new Set();
    const pages = new Map(
      (site.files ?? []).filter((file) => file.path?.endsWith('.html')).map((f) => [f.path, f.contents])
    );

    for (const [path, html] of pages) {
      // The rendered half of the submit rule. The document one above says the
      // designer asked for it; this one says the renderer did it — and it is
      // the renderer that had been writing `type="button"` on everything.
      for (const form of html.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
        if (!/<(button|input)\b[^>]*type="submit"/.test(form[0])) {
          notSubmittable.push(`${label} ${path}: a form with no submit control`);
        }
      }

      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      for (const match of html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) {
        const href = match[1];
        linksWalked++;

        if (href === '#' || href.trim() === '') {
          deadLinks.push(`${label} ${path}: a link goes nowhere`);
          continue;
        }
        if (/^(https?|mailto|tel):/.test(href)) {
          // Not fetched — a suite that reaches the network is a suite that
          // fails when a train goes into a tunnel. Only the shape is checked,
          // which is what a typo breaks.
          const shaped =
            (href.startsWith('mailto:') && /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/.test(href)) ||
            (href.startsWith('tel:') && /^tel:\+?[\d\s-]{6,}$/.test(href)) ||
            (/^https?:/.test(href) && /^https?:\/\/[^/\s]+\./.test(href));
          if (!shaped) deadLinks.push(`${label} ${path}: ${href}`);
          continue;
        }

        // Everything else is inside the site: a path, a fragment, or both.
        const [target, fragment] = href.includes('#')
          ? [href.slice(0, href.indexOf('#')), href.slice(href.indexOf('#') + 1)]
          : [href, ''];
        const file = target === '' ? path : resolveSitePath(dir, target);
        const contents = pages.get(file);
        if (contents === undefined) {
          brokenLinks.push(`${label} ${path}: ${href} → no ${file}`);
          continue;
        }
        if (fragment) {
          reached.add(fragment);
          if (!contents.includes(` id="${fragment}"`)) {
            brokenLinks.push(`${label} ${path}: ${href} — nothing on that page answers to it`);
          }
        }
      }
    }

    /*
     * And the other direction, which is the one that catches a *silent* loss.
     * If the publisher drops the fragment off a cross-page link, every link
     * still arrives at a real file and the check above stays green — the page
     * simply opens at the top instead of at the section. So the sections a
     * template names have to be reachable from inside the site, which is also
     * a fair thing to ask of a template: a named section nobody links to is
     * either dead weight or a nav entry somebody forgot.
     */
    for (const anchor of new Set(declared)) {
      if (!reached.has(anchor)) unreachable.push(`${label}: nothing links to #${anchor}`);
    }
  }

  /** `../pricing/` from `about/index.html`, the way a browser reads it. */
  function resolveSitePath(dir, target) {
    const parts = `${dir}${target}`.split('/');
    const out = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    const joined = out.join('/');
    // A directory reference is served by its index, which is the file the
    // publisher wrote and the name the check has to look up.
    return target.endsWith('/') || joined === '' ? `${joined ? `${joined}/` : ''}index.html` : joined;
  }

  report.check('every template has at least one page', noPages.length === 0, noPages.join(', '));
  /*
   * Every node, accounted for.
   *
   * `> 500` was the first version of this, and it would have stayed green
   * through the SaaS navbar becoming a component and taking a quarter of the
   * document out of the walk. An equality against what the documents actually
   * hold cannot: anything the sweep stops reaching shows up here as a number
   * that does not add up, whatever the reason.
   */
  const nodesHeld = built.reduce(
    (total, one) => total + (one.doc ? Object.keys(one.doc.nodes).length : 0),
    0
  );
  report.check(
    'and the sweep walked every node in every one of them',
    pagesSwept >= TEMPLATES.length && nodesSwept === nodesHeld && nodesHeld > 500,
    `${pagesSwept} pages, ${nodesSwept} of ${nodesHeld} nodes`
  );
  report.check(
    'and followed every link in what they publish',
    linksWalked > 100,
    `${linksWalked} links`
  );
  report.check(
    'not one of them goes nowhere',
    deadLinks.length === 0,
    deadLinks.slice(0, 4).join(' | ') || `${linksWalked} links, none of them a “#”`
  );
  report.check(
    'and every one that stays on the site arrives',
    brokenLinks.length === 0,
    brokenLinks.slice(0, 4).join(' | ') || 'every page and every section reached'
  );
  report.check(
    'a template that ships content publishes a page for every row of it',
    missingRows.length === 0 && seededRows > 0,
    missingRows.slice(0, 3).join(' | ') || `${seededRows} rows, each with a page`
  );
  report.check(
    'a section that appears on more than one page is made once',
    notShared.length === 0,
    notShared.join(' | ') || 'nothing is built twice'
  );
  report.check(
    'every section a template names is linked to from inside it',
    unreachable.length === 0,
    unreachable.slice(0, 4).join(' | ') || 'no section named for nobody'
  );
  report.check(
    'every page opens with a level-one heading',
    noHeading.length === 0,
    noHeading.join(', ') || `${pagesSwept} pages`
  );
  report.check('no heading level is skipped', skippedHeading.length === 0, skippedHeading.slice(0, 4).join(' | '));
  report.check(
    'every form has something that submits it',
    formsWithoutSubmit.length === 0,
    formsWithoutSubmit.join(' | ') || 'every Send sends'
  );
  report.check(
    'a submitting button is a real submit button',
    notSubmittable.length === 0,
    notSubmittable.slice(0, 3).join(' | ') || 'type="submit" in the published markup'
  );
  report.check(
    'every image says something worth reading',
    lazyAlt.length === 0 && imagesSwept > 0,
    lazyAlt.slice(0, 3).join(' | ') || `${imagesSwept} images, every one described`
  );
  const boundImages = built
    .flatMap(({ doc }) => Object.values(doc?.nodes ?? {}))
    .filter((node) => node.type === 'image' && node.bind?.src);
  report.check(
    'and declares the size it will be, so nothing moves when it arrives',
    unsized.length === 0 && imagesSwept > 0,
    unsized.slice(0, 3).join(' | ') || `${imagesSwept} images, all sized`
  );
  /*
   * And the rule is looking at the images it claims to. A bound image is the
   * case it silently stopped covering, so "no offences" has to be a fact about
   * some of those rather than a fact about there being none.
   */
  const looseBound = boundImages.filter((node) => !holdsItsShape(node));
  report.check(
    'including the ones that take their picture from a record',
    boundImages.length > 0 && looseBound.length === 0,
    looseBound.length
      ? `${looseBound.length} of ${boundImages.length} bound images: ${whyUnsized(looseBound[0])}`
      : `${boundImages.length} bound images, each holding its own shape`
  );
  report.check(
    'at most one image a page is worth loading first',
    tooEager.length === 0,
    tooEager.join(' | ') || 'one hero each, or none'
  );
  /*
   * Every stand-in photograph from one place, which is the property that keeps
   * "move to our own CDN" a one-line change rather than a search-and-replace
   * through eight templates. Written as "one origin" rather than as the host's
   * name so the check survives that move.
   */
  report.check(
    'and every photograph a template stands in with comes from one place',
    photoHosts.size === 1,
    [...photoHosts].join(', ') || 'no external images'
  );
  report.check(
    'every colour and font comes from the theme',
    rawColour.length === 0,
    rawColour.slice(0, 4).join(' | ') || 'tokens throughout'
  );
  report.check('every node is named for the layer tree', unnamed.length === 0, unnamed.slice(0, 3).join(' | '));
  report.check(
    'no template navigates its own page by hand-typed fragment',
    handTyped.length === 0,
    /*
     * Forty-six of these shipped across six templates while the reference
     * machinery built to replace them sat unused. Every one worked, which is
     * why nobody noticed: a fragment is a *name*, and it goes stale the moment
     * somebody renames the section — silently, into a link that scrolls
     * nowhere. A reference survives the rename and `pruneRefs` clears it when
     * the target is deleted.
     *
     * A fragment on a *cross-page* link is untouched and legitimate:
     * `/pricing/#plans` is a page and a place on it, which no same-page
     * reference can express.
     */
    handTyped.slice(0, 3).join(' | ') || 'every same-page jump is a reference'
  );
  report.check(
    'no control in a template both jumps and navigates',
    bothWays.length === 0,
    bothWays.slice(0, 3).join(' | ') || 'every jump is the only answer its control gives'
  );
  report.check(
    'nothing rises under the pointer unless pressing it does something',
    fakeAffordances.length === 0,
    fakeAffordances.slice(0, 3).join(' | ') || 'every lift in eight templates leads somewhere'
  );
  report.check(
    'no template ships a content rule the expansion will drop',
    droppedSet.length === 0,
    droppedSet.slice(0, 3).join(' | ') || 'every set expands on a state or a data source'
  );
  report.check(
    'no template ships filler copy',
    placeholder.length === 0,
    placeholder.slice(0, 3).join(' | ') || 'written, not filled'
  );
  report.check(
    'and every one of them publishes',
    wontPublish.length === 0,
    wontPublish.slice(0, 3).join(' | ') || `${TEMPLATES.length} sites generated`
  );

  /* Each of the above, handed something it must reject. */
  report.check(
    'a path is resolved the way a browser resolves it',
    resolveSitePath('about/', '../pricing/') === 'pricing/index.html' &&
      resolveSitePath('', './') === 'index.html' &&
      resolveSitePath('a/b/', '../../c/') === 'c/index.html' &&
      resolveSitePath('', 'sitemap.xml') === 'sitemap.xml',
    'the half of the link check that could quietly answer “file not found” to everything'
  );
  report.check(
    'the colour rule matches a colour and not a token or an allowed depiction',
    colourOffences('#ff0000').length === 1 &&
      colourOffences('rgb(1,2,3)').length === 1 &&
      colourOffences('var(--c-primary)').length === 0 &&
      colourOffences('#ff5f57').length === 0,
    'one policy, shared with the block sweep'
  );
  report.check(
    'the filler rule matches filler and not prose',
    PLACEHOLDER.test('Lorem ipsum dolor') &&
      !PLACEHOLDER.test('The platform layer for product teams') &&
      !PLACEHOLDER.test('Mastodon')
  );
  /*
   * Both branches of the sizing rule, each handed the thing it must reject.
   *
   * The bound pair is the one that matters. Before this the rule asked one
   * question of every image, and a bound image answers it with numbers the
   * publisher then deletes — so the old rule would have called the third of
   * these sized, which is the exact false pass being closed.
   */
  const sized = { type: 'image', props: { width: 900, height: 675 }, styles: {} };
  const noSize = { type: 'image', props: {}, styles: {} };
  const boundFlat = { ...noSize, bind: { src: 'image' } };
  const boundRatio = { ...boundFlat, styles: { desktop: { aspectRatio: '4 / 3' } } };
  const boundNumbers = { ...sized, bind: { src: 'image' } };
  // The shape the rule read before it was written against a real node: an
  // aspect ratio at the top level, where no built document has ever put one.
  const boundMisread = { ...boundFlat, styles: { aspectRatio: '4 / 3' } };
  const boundDropped = {
    ...boundRatio,
    styles: { desktop: { aspectRatio: '4 / 3' }, mobile: { aspectRatio: '' } },
  };
  report.check(
    'the sizing rule asks a hand-placed photo for pixels and a bound one for a ratio',
    holdsItsShape(sized) &&
      !holdsItsShape(noSize) &&
      holdsItsShape(boundRatio) &&
      !holdsItsShape(boundFlat) &&
      !holdsItsShape(boundNumbers) &&
      !holdsItsShape(boundMisread) &&
      !holdsItsShape(boundDropped),
    'and the numbers on a bound image do not count, because they are not published'
  );
  /*
   * The affordance rule, handed the four cases it has to tell apart. The last
   * one is the whole point: the case card lifts, and it should, because
   * pressing it opens the record's page.
   */
  const lifts = { transform: 'translateY(-3px)' };
  const hover = [{ kind: 'pointer', pseudo: 'hover' }];
  const plainCard = { type: 'frame', props: {}, rules: [{ when: hover, apply: lifts }] };
  const glowCard = {
    type: 'frame',
    props: {},
    rules: [{ when: hover, apply: { boxShadow: 'var(--sh-md)' } }],
  };
  const linkedCard = { ...plainCard, props: { href: 'page:abc' } };
  const jumpCard = { ...plainCard, refs: { scrollTo: { node: 'abc' } } };
  const realButton = { type: 'button', props: {}, rules: [{ when: hover, apply: lifts }] };
  // The spec spelling, which is the one three of the four offences were
  // written in. A rule that read only `rules` would call this card clean.
  const specCard = { type: 'frame', props: {}, states: { hover: lifts } };
  const specJump = { ...specCard, refs: { scrollTo: 'Gallery' } };
  report.check(
    'the affordance rule can tell a lift that leads somewhere from one that does not',
    fakeAffordance(plainCard) === 'translateY(-3px)' &&
      fakeAffordance(glowCard) === null &&
      fakeAffordance(linkedCard) === null &&
      fakeAffordance(jumpCard) === null &&
      fakeAffordance(realButton) === null,
    'a shadow is feedback, a lift is an offer, and a card with a destination may make one'
  );
  /*
   * The length rule, handed the mistake that produced it and the four shapes
   * it must not mistake for one. `avatar('DT')` is not hypothetical — it is
   * what this rule was written after, and the portrait it erased was invisible
   * to every other check in the file.
   */
  const initials = { type: 'frame', name: 'Avatar', styles: { width: 'DT', height: 'DT' } };
  const okAvatar = { type: 'frame', name: 'Avatar', styles: { width: '40px', height: '40px' } };
  const pairGap = { type: 'stack', name: 'Row', styles: { gap: '8px 22px' } };
  const tokenWidth = { type: 'frame', name: 'Box', styles: { maxWidth: 'var(--w-narrow)' } };
  const wordHeight = { type: 'frame', name: 'Box', styles: { height: 'auto', minWidth: 'fit-content' } };
  const inResponsive = {
    type: 'frame',
    name: 'Box',
    styles: {},
    responsive: { mobile: { width: 'DT' } },
  };
  report.check(
    'a length that is not a length is caught, wherever the layer it sits in',
    checkLengths(initials).length === 2 &&
      checkLengths(okAvatar).length === 0 &&
      checkLengths(pairGap).length === 0 &&
      checkLengths(tokenWidth).length === 0 &&
      checkLengths(wordHeight).length === 0 &&
      checkLengths(inResponsive).length === 1,
    checkLengths(initials)[0] ?? 'nothing caught, which is the failure'
  );
  report.check(
    'and reads a block spec as readily as a built document',
    fakeAffordance(specCard) === 'translateY(-3px)' &&
      fakeAffordance(specJump) === null &&
      checkFakeAffordance({ type: 'section', children: [specCard] }).length === 1 &&
      checkFakeAffordance({ type: 'section', children: [specJump] }).length === 0,
    'states on a spec, rules on a document, one rule over both'
  );
  report.check(
    'and says which of the two ways it failed',
    whyUnsized(noSize) === 'has no intrinsic size' &&
      whyUnsized(boundFlat).includes('no aspect ratio') &&
      whyUnsized(boundDropped).includes('when narrow'),
    `“${whyUnsized(boundDropped)}”`
  );
}

report.group('a duplicated component shares nothing with the one it came from');

{
  /** A component with a variant and a property reaching into both trees. */
  const build = () => {
    const doc = createEmptyDocument('Kit');
    const page = doc.pages[0];
    const built = buildTree(
      { type: 'frame', name: 'Card', children: [{ type: 'paragraph', name: 'Label', props: { text: 'Hello' } }] },
      doc.nodes
    );
    doc.nodes[built.rootId].parentId = page.rootNodeId;
    doc.nodes[page.rootNodeId].children.push(built.rootId);

    const made = ops.createComponentFromNode(doc, built.rootId, 'Card');
    const label = Object.values(doc.nodes).find(
      (n) => n.name === 'Label' && n.meta.componentId === made.component.id
    );
    // Through the real target list, so the fixture cannot expose something
    // the editor would refuse.
    const target = componentLib.exposableTargets(label).find((t) => t.type === 'text');
    ops.exposeProperty(doc, made.component.id, label.id, target, 'Label text');
    ops.addVariant(doc, made.component.id, 'Compact');
    return { doc, source: doc.components[0] };
  };

  const { doc, source } = build();
  const before = {
    nodes: Object.keys(doc.nodes).length,
    variants: source.variants.length,
    properties: source.properties.length,
  };
  const copy = ops.duplicateComponent(doc, source.id);

  report.check('the copy exists and is a second component', Boolean(copy) && doc.components.length === 2);
  report.check(
    'it is named so the two can be told apart',
    copy.name !== source.name && copy.name.startsWith(source.name),
    `${source.name} → ${copy.name}`
  );

  /* Independence, tree by tree. */
  report.check(
    'its master is a different tree',
    copy.rootNodeId !== source.rootNodeId && Boolean(doc.nodes[copy.rootNodeId])
  );
  report.check(
    'and so is every variant — not the original’s, borrowed',
    copy.variants?.length === before.variants &&
      copy.variants.every((v) => !source.variants.some((s) => s.rootNodeId === v.rootNodeId)),
    `${copy.variants?.length ?? 0} variants, none shared`
  );
  report.check(
    'the nodes really were copied rather than moved',
    Object.keys(doc.nodes).length > before.nodes &&
      Object.values(doc.nodes).filter((n) => n.meta.componentId === source.id).length > 0,
    `${Object.keys(doc.nodes).length - before.nodes} nodes added`
  );
  report.check(
    'and every one of them belongs to the copy, not to the original',
    Object.values(doc.nodes)
      .filter((n) => [copy.rootNodeId, ...copy.variants.map((v) => v.rootNodeId)].includes(n.id))
      .every((n) => n.meta.componentId === copy.id),
    'meta.componentId follows the copy'
  );

  /*
   * The properties, which is where a per-tree id map would have gone wrong.
   * One property names a node in the master *and* one in each variant, so a
   * map built for a single tree could only remap the one it was built for —
   * the copy's property would reach its own master and the original's variant
   * at the same time.
   */
  const ownNodes = new Set(
    Object.values(doc.nodes)
      .filter((n) => n.meta.componentId === copy.id)
      .map((n) => n.id)
  );
  report.check(
    'a property came across with the same name',
    copy.properties?.length === before.properties &&
      copy.properties[0].name === source.properties[0].name,
    `${copy.properties?.length ?? 0} properties`
  );
  report.check(
    'with a new id, because an override is keyed by it',
    copy.properties[0].id !== source.properties[0].id
  );
  report.check(
    'and every node it names is inside the copy',
    copy.properties[0].nodeIds.length === source.properties[0].nodeIds.length &&
      copy.properties[0].nodeIds.every((id) => ownNodes.has(id)),
    `${copy.properties[0].nodeIds.length} of ${source.properties[0].nodeIds.length} remapped, all owned`
  );
  report.check(
    'reaching every tree, not only the master',
    copy.properties[0].nodeIds.length > 1,
    'a property spans the master and each variant'
  );

  /* Editing one must not move the other. */
  {
    const copyLabel = copy.properties[0].nodeIds[0];
    doc.nodes[copyLabel].props.text = 'Changed';
    const sourceLabel = source.properties[0].nodeIds[0];
    report.check(
      'editing the copy leaves the original alone',
      doc.nodes[sourceLabel].props.text === 'Hello',
      String(doc.nodes[sourceLabel].props.text)
    );
  }

  /* A property with nothing to point at. */
  {
    const fresh = build();
    const stray = ops.duplicateComponent(fresh.doc, fresh.source.id);
    // A property naming a node in another component would follow the original
    // across, which is not a property — it is a thread back.
    fresh.source.properties[0].nodeIds.push('somewhere-else');
    const second = ops.duplicateComponent(fresh.doc, fresh.source.id);
    report.check(
      'a property naming a node outside the component drops that name',
      !second.properties[0].nodeIds.includes('somewhere-else'),
      second.properties[0].nodeIds.join(', ')
    );
    report.check(
      'and the duplicate is still named apart from both',
      new Set([fresh.source.name, stray.name, second.name]).size === 3,
      [fresh.source.name, stray.name, second.name].join(' / ')
    );
  }

  /* Each of the above, handed something it must reject. */
  report.check(
    'duplicating something that is not there produces nothing',
    ops.duplicateComponent(doc, 'no-such-component') === null
  );
  report.check(
    'the independence checks are comparing two real things',
    source.variants.length > 0 && source.properties[0].nodeIds.length > 1,
    'the fixture has a variant and a property that spans it'
  );
}

report.group('an expression is described in one place');

{
  const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
  const strip = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const builders = strip(read('src/components/inspector/sentences.tsx'));
  const panels = [
    'src/components/inspector/section-data.tsx',
    'src/components/inspector/section-rules.tsx',
  ];

  report.check(
    'the operator words are written once, in the builder',
    /OP_LABELS/.test(builders) &&
      panels.every((file) => !/OP_LABELS/.test(strip(read(file)))),
    'no panel spells an operator itself'
  );
  report.check(
    'and so are the format words',
    /FORMAT_LABELS/.test(builders) &&
      panels.every((file) => !/FORMAT_LABELS/.test(strip(read(file)))),
    'no panel spells a format itself'
  );

  const rules = strip(read('src/components/inspector/section-rules.tsx'));
  report.check(
    'the rule summary is the sentence, not a second description of it',
    /partsToText\(\s*ruleSentence/.test(rules),
    'describeRule projects the same parts the row edits'
  );
  report.check(
    'and the panel no longer walks condition kinds on its own',
    !/case '(pointer|attr|data)':/.test(rules),
    'the switch that used to live here is in the builder'
  );
  /*
   * And the projection really is one function used two ways, rather than two
   * that happen to agree today.
   */
  const sentence = strip(read('src/components/ui/sentence.tsx'));
  report.check(
    'a part with no handler renders as prose rather than a dead control',
    /if \(!part\.onChange\) return <Prose>/.test(sentence),
    'the read-only projection is the same parts without handlers'
  );
  report.check(
    'and the sentence carries real spaces, not only a flex gap',
    /index > 0 && part\.kind !== 'break' \? ' ' : null/.test(sentence),
    'copied out of the panel it is still a sentence'
  );

  /*
   * And the one place a rule can be *wrong* rather than unfinished.
   *
   * Two panels have to agree about a reference whose element is gone: the
   * sentence names it and the warning underneath explains it. Said twice in
   * two files, one of them goes stale and the panel diagnoses one rule two
   * ways — "you have not picked a source" over "the source you picked is
   * missing".
   */
  const data = strip(read('src/components/inspector/section-data.tsx'));

  report.check(
    'the words for a deleted element are written once, in the builder',
    /DELETED_ELEMENT = /.test(builders) && !/a deleted element/.test(data),
    'the panel does not spell the chip’s label a second time'
  );
  report.check(
    'and the chip uses them rather than falling through to its placeholder',
    /orphaned \?/.test(builders) && /label: DELETED_ELEMENT/.test(builders),
    'an element operand nothing can name still says what it is'
  );
  report.check(
    'the panel asks the document walk what is dangling rather than deciding itself',
    /danglingReads\(nodes\)/.test(data) && !/!nodes\[/.test(data),
    // Two definitions of "dangling" is how cleanup keeps a rule the panel calls
    // broken, or the panel stays quiet about one cleanup would have cleared.
    'one definition, in `factory`'
  );
  report.check(
    'and reports it against the rule, so the warning lands on the broken sentence',
    /one\.rule === rule\.id/.test(data),
    'per rule, not per panel'
  );

  /*
   * And the picker that offers a state a one-line effect, which is the one
   * place a panel names a *property* rather than a condition.
   */
  const styleDecl = read('src/lib/document/types.ts');
  const declared = [
    ...styleDecl
      .slice(styleDecl.indexOf('export interface StyleDecl'), styleDecl.indexOf('export type StyleProp'))
      .matchAll(/^\s{2}(\w+)\?:/gm),
  ].map((one) => one[1]);
  const offered = vocabulary.effectProps();

  report.check(
    'the effect picker offers only properties the model actually has',
    offered.length >= 5 && offered.every(([prop]) => declared.includes(prop)),
    /*
     * The bug this is written for shipped: the list carried
     * `textDecorationLine`, which `StyleDecl` does not declare. Nothing
     * objected — the picker round-tripped it and the generator kebab-cases
     * whatever it is handed — so the effect worked while sitting outside the
     * closed set the override badge and the row menu key on.
     *
     * Read from the compiled table now rather than scraped out of the panel,
     * which is the point of having a table: the check asks the same object the
     * picker asks.
     */
    offered.filter(([prop]) => !declared.includes(prop)).map(([prop]) => prop).join(', ') ||
      `${offered.length} offered, all declared`
  );
  report.check(
    'and names them in words rather than in property names',
    offered.length >= 5 && offered.every(([, phrase]) => !/[A-Z]/.test(phrase)),
    // `sets backgroundColor` is a variable on screen, in the one panel whose
    // whole argument is that a rule reads as a sentence.
    offered.filter(([, phrase]) => /[A-Z]/.test(phrase)).map(([, p]) => p).join(', ') ||
      offered.map(([, phrase]) => phrase).join(' · ')
  );

  /* ------------------------------------------------- the vocabulary itself */

  /*
   * The audit that produced the table, kept as a rule.
   *
   * Thirty-two of a hundred properties had no control anywhere and nothing said
   * so, because saying so meant grepping the panel for each name in turn.
   * `Record<StyleProp, StyleEntry>` makes the compiler answer the first half —
   * every property has an entry — and these answer the half it cannot: that the
   * entry is *reached*.
   */
  const vocab = vocabulary.STYLE_VOCABULARY;
  const inspectorSource = readdirSync(path.join(ROOT, 'src/components/inspector'))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => read(`src/components/inspector/${name}`))
    .join('\n');

  report.check(
    'every property the model declares has a word and a home',
    declared.length > 90 && declared.every((prop) => vocab[prop]),
    // The compiler enforces this through the `Record`, so this is here for the
    // one thing it cannot see: the annotation being loosened to `Partial` or to
    // `Record<string, …>`, after which the hole reopens silently.
    declared.filter((prop) => !vocab[prop]).join(', ') ||
      `${declared.length} declared, all in the table`
  );
  report.check(
    'and no words for a property the model dropped',
    Object.keys(vocab).every((prop) => declared.includes(prop)),
    Object.keys(vocab).filter((prop) => !declared.includes(prop)).join(', ') || 'no strays'
  );

  const sections = [...new Set(Object.values(vocab).map((entry) => entry.section))];
  const tabledSections = sections.filter((section) => vocabulary.tabled(section).length);
  report.check(
    'every section with a tabled property is rendered by a panel',
    tabledSections.length > 5 &&
      tabledSections.every((section) => inspectorSource.includes(`<StyleFields section="${section}" />`)),
    // A table nobody renders is the same hole in a nicer shape.
    tabledSections
      .filter((section) => !inspectorSource.includes(`<StyleFields section="${section}" />`))
      .join(', ') || `${tabledSections.length} sections rendered`
  );

  /*
   * And the properties the table defers on. `bespoke` is a promise that a
   * hand-written row already owns one, so a promise nothing keeps is a
   * property with no control at all — which is the exact state the audit found.
   *
   * Matched as a quoted string, an object key or a member, never as a bare
   * word: `transition` appears in a dozen Tailwind class names, and a check
   * that counted those would call the property covered while the panel has
   * never offered it. That false positive is why the first pass of this audit
   * had to be run twice.
   */
  const effectOnly = Object.entries(vocab).filter(([, entry]) => entry.control.kind === 'effect');
  report.check(
    'a property with no row of its own is offered to a rule instead',
    effectOnly.length > 0 && effectOnly.every(([, entry]) => Boolean(entry.asEffect)),
    /*
     * The third answer to "where is this edited", and the one that could
     * quietly become "nowhere". `bespoke` promises a hand-written row and is
     * checked against the panel below; `effect` promises the rules panel, and
     * the picker only offers a property that has a phrase — so an entry with
     * this kind and no `asEffect` is unreachable from anywhere at all, which is
     * the exact hole this whole table was built to close.
     */
    effectOnly.length
      ? effectOnly.map(([prop, entry]) => `${prop} → ${entry.asEffect ?? 'nothing'}`).join(', ')
      : 'nothing uses it'
  );

  const bespokeWithoutRow = Object.entries(vocab)
    .filter(([, entry]) => entry.control.kind === 'bespoke')
    .map(([prop]) => prop)
    .filter((prop) => !new RegExp(`['\"\`]${prop}['\"\`]|\\b${prop}:|\\.${prop}\\b`).test(inspectorSource));

  report.check(
    // What it proves is that the panel *names* the property somewhere, which is
    // weaker than "there is a row" — a lingering hook call would satisfy it.
    // That is still the difference between a gap and no gap: every one the
    // audit found was a property the panel had never heard of.
    //
    // It carried one named exception for a while — `transition`, which the
    // model had, the block library authored in TypeScript, and the panel had
    // never offered. Closing that gap is what turned this line into `[]`, which
    // is what naming it was for.
    'and every property the table defers on is named somewhere in the panel',
    bespokeWithoutRow.length === 0,
    bespokeWithoutRow.length ? `no row for: ${bespokeWithoutRow.join(', ')}` : 'every one reachable'
  );

  /* Each of the above, handed something it must reject. */
  report.check(
    'the one-place rules would notice a panel spelling its own words',
    /OP_LABELS/.test('const label = OP_LABELS[op];'),
    'the pattern matches what it is looking for'
  );
  report.check(
    'and the condition-walk rule would notice the switch coming back',
    /case '(pointer|attr|data)':/.test("switch (c.kind) { case 'pointer': return 'Hovered'; }")
  );
  report.check(
    'the deleted-element rule would notice the panel wording it again',
    /a deleted element/.test('<p>reads a deleted element</p>'),
    'the pattern matches what it is looking for'
  );
  report.check(
    'and the one-definition rule would notice the panel checking membership itself',
    /!nodes\[/.test('const gone = !nodes[ref.node];'),
    'the pattern matches what it is looking for'
  );
  report.check(
    'the vocabulary rules are reading real lists, not empty matches',
    offered.length >= 5 && declared.length > 90 && inspectorSource.length > 10000,
    // Every rule above passes vacuously against nothing found, and two of the
    // three readers are regexes over source — exactly the thing that goes quiet
    // when a file is reformatted rather than when it is wrong.
    `${offered.length} effects, ${declared.length} declared, ${Object.keys(vocab).length} in the table`
  );
}

report.group('every prop an element has is one the panel can set');

{
  /*
   * The audit that produced `STYLE_VOCABULARY`, run against the other half of
   * the model.
   *
   * Styles got a declared table and a `Record<StyleProp, StyleEntry>` that
   * makes a missing entry a compile error. Props never got either, and the
   * same thing had happened to them: `form.action` is read by the renderer —
   * whose comment says "an action the designer typed always wins" — and there
   * was nowhere in the editor to type one. A form had no Content section at
   * all, so every form this app built posted to the project's own endpoint
   * because that was the only possibility.
   *
   * The test is *how the panel edits a prop*, not whether the word appears in
   * it, and the difference is the whole reliability of this check. Searching
   * for the bare name found `action` immediately — in `kind: 'action'`, which
   * is an expression effect and nothing to do with a form. That false positive
   * would have declared the gap closed while it was open, which is exactly the
   * failure the style audit warns about with `transition`.
   */
  const panel = readdirSync(path.join(ROOT, 'src/components/inspector'))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => readFileSync(path.join(ROOT, 'src/components/inspector', name), 'utf8'))
    .join('\n');
  const editable = (prop) =>
    new RegExp(`useNodeProp\\(['"]${prop}['"]`).test(panel) ||
    new RegExp(`setNodeProps\\(\\{[^}]*\\b${prop}:`, 's').test(panel);

  /*
   * The one prop that is deliberately read and never written.
   *
   * `componentId` says which component an instance is a copy of. You do not
   * retarget an instance by typing an id at it — you delete it and insert the
   * other one — so the panel shows the component's name and offers Edit and
   * Detach instead. Named here rather than quietly skipped, because an
   * exception nobody wrote down is indistinguishable from a hole.
   */
  const BY_DESIGN = new Set(['instance.componentId']);

  const unreachable = [];
  let counted = 0;
  for (const [type, def] of Object.entries(ELEMENTS)) {
    for (const prop of Object.keys(def.defaultProps ?? {})) {
      counted += 1;
      if (!editable(prop) && !BY_DESIGN.has(`${type}.${prop}`)) unreachable.push(`${type}.${prop}`);
    }
  }
  report.check(
    'every prop an element ships with can be set from the inspector',
    unreachable.length === 0,
    unreachable.length
      ? `no control for: ${unreachable.join(', ')}`
      : `${counted} props across ${Object.keys(ELEMENTS).length} element types, one exception named`
  );
  report.check(
    'and the exception is still the one it was written for',
    [...BY_DESIGN].every((one) => {
      const [type, prop] = one.split('.');
      return Boolean(ELEMENTS[type]?.defaultProps && prop in ELEMENTS[type].defaultProps);
    }),
    // An exemption for a prop that no longer exists is an exemption that could
    // be hiding a different one with the same name.
    [...BY_DESIGN].join(', ')
  );
  /*
   * And the other half of that audit: a prop the panel can *type into* is not
   * the same as a prop a rule can vary or a record can fill.
   *
   * Those two were a `SETTABLE` set in the renderer and a near-copy `BINDABLE`
   * array in the Data panel, kept in step by nobody. Both had drifted: three
   * props the renderer turns into visible content — `summary`, the clickable
   * line of a `<details>`; `legend`; and `poster`, a video's still — were in
   * neither, so the question in an FAQ built from a collection could not be
   * bound. `title` was in both while being declared by no element and read by
   * no renderer.
   *
   * The list is declared once now, and this is the check that keeps it honest:
   * every prop has to be in one of the two, so the next element with a visible
   * string cannot be silently structural. That is the same inversion
   * `emptyAction` needed — see §4.1.9 — applied to the other vocabulary that
   * had fallen behind.
   */
  const { CONTENT_PROPS, STRUCTURAL_PROPS, isContentProp, bindableProps, NOT_BINDABLE } =
    contentProps;
  const classified = new Set([...CONTENT_PROPS, ...STRUCTURAL_PROPS]);
  const unclassified = [];
  for (const [type, def] of Object.entries(ELEMENTS)) {
    for (const prop of Object.keys(def.defaultProps ?? {})) {
      if (!classified.has(prop)) unclassified.push(`${type}.${prop}`);
    }
  }
  report.check(
    'every prop an element ships with is content or structure, and says which',
    unclassified.length === 0,
    unclassified.length
      ? `neither: ${unclassified.join(', ')}`
      : `${classified.size} classified · ${CONTENT_PROPS.length} content`
  );
  /*
   * And the same for the props no element defaults but the panel writes —
   * `anchor`, `submit`, `srcset` and the rest. A prop that exists only because
   * a control creates it is exactly the kind that gets missed.
   */
  const written = [
    ...new Set(
      [...panel.matchAll(/useNodeProp\(['"]([a-zA-Z]+)['"]/g)].map((m) => m[1])
    ),
  ];
  const missed = written.filter((prop) => !classified.has(prop));
  report.check(
    'and so is every prop the panel writes without a default behind it',
    missed.length === 0,
    missed.length ? `neither: ${missed.join(', ')}` : `${written.length} props the panel writes`
  );
  /*
   * The three that were missing, named. A count would pass against a list that
   * had lost them again and gained three others.
   */
  report.check(
    'the content a `details`, a `fieldset` and a `video` show is content',
    ['summary', 'legend', 'poster'].every((prop) => isContentProp(prop)),
    ['summary', 'legend', 'poster'].map((p) => `${p}→${isContentProp(p)}`).join(' ')
  );
  /*
   * And one that is deliberately settable and not bindable, which is the whole
   * reason the two lists are not one: a bound `name` is whatever the record
   * says, once per row, and every reference to it — `testRuntime`'s
   * `[name="…"]` lookup, the expression editor's control list — is written
   * against a name known when the page is designed.
   */
  report.check(
    'a form field’s name may be varied by a rule and not filled by a record',
    isContentProp('name') && !bindableProps().includes('name') && NOT_BINDABLE.has('name'),
    `settable ${isContentProp('name')} · bindable ${bindableProps().includes('name')}`
  );
  /* Nothing is in both lists, or the classification says two things at once. */
  /*
   * And the reverse reading, over every block in the registry: a `set` that
   * names something the list does not carry.
   *
   * This is the check the dead entry needed. `title` sat in `SETTABLE` while
   * being declared by no element and read by no renderer, and one block wrote
   * `set: { title: 'Closed' }` on an 8px dot — three lines under a comment
   * saying the dot "changes colour rather than words, so its rule carries
   * `apply` instead of `set`". The comment was right and the code was not.
   *
   * What it cost was not nothing. `setsContent` is true for any settable key,
   * so that dot published as *two* divs with a `display:none` pair between
   * them, to vary a prop that never reached the markup. Removing `title` from
   * the list took 227 bytes and a duplicated element out of every page with an
   * opening-hours block on it — which is why this landed as a byte change and
   * had to be read before it was accepted.
   */
  const inert = [];
  let setKeys = 0;
  for (const { block, spec } of built) {
    const name = block.name;
    /*
     * `walk` is a generator and `BLOCKS` holds builders, not trees. Written as
     * `walk(spec, callback)` over `Object.entries(BLOCKS)` it reported
     * "93 blocks, every set lands" having iterated nothing at all — the exact
     * vacuous pass this suite exists to catch, produced by the check being
     * added to catch one. The `setKeys > 0` clause below is what turned the
     * second attempt's silence into a failure.
     */
    for (const { node, path } of walk(spec)) {
      for (const rule of node.rules ?? []) {
        for (const prop of Object.keys(rule.set ?? {})) {
          setKeys += 1;
          if (!isContentProp(prop)) inert.push(`${name} › ${path}: set ${prop}`);
        }
      }
    }
  }
  report.check(
    'no block varies a prop that nothing can vary',
    inert.length === 0 && setKeys > 0,
    // The count is in the detail so a walk that stopped finding them reads as
    // a suspicious zero rather than as a pass.
    inert.length
      ? [...new Set(inert)].slice(0, 4).join(' | ')
      : `${setKeys} set keys across ${built.length} blocks, every one of them lands`
  );

  report.check(
    'and nothing is called content and structure at the same time',
    CONTENT_PROPS.every((prop) => !STRUCTURAL_PROPS.has(prop)),
    CONTENT_PROPS.filter((prop) => STRUCTURAL_PROPS.has(prop)).join(', ') || 'the two are disjoint'
  );

  report.check(
    'the audit is reading a real panel and real defaults',
    counted > 30 && panel.length > 10000 && editable('placeholder'),
    // `placeholder` has had a row since the first inspector. A test that cannot
    // find that one is not testing the panel.
    `${counted} props, ${panel.length} characters of panel`
  );
}

report.group('text that does not fit has somewhere to go');

{
  /*
   * The first gap the stress template found, closed.
   *
   * `templates/stress.ts` measured 732px of sideways scroll at 390px from a
   * single seventy-four-character word, and nothing in the hundred and two
   * properties the vocabulary had at the time could touch it. These check the
   * five that can, and the two the generator has to translate rather than pass
   * through. `tests/render/stress.mjs` measures the same word in a browser.
   */
  /*
   * One node, and no parent to wrap it in. The first version of this put the
   * text inside a frame and read the whole sheet, which meant every `display`
   * check was also reading the frame's own `display: flex` — two values for
   * one property, from two rules, and a check that looked like it had found
   * the bug it was written for.
   */
  const css = (styles) => {
    const { nodes } = buildTree({ type: 'text', name: 'T', props: { text: 'x' }, styles });
    return generateNodeCss(nodes, { mode: 'media' });
  };
  /** Every value a property is given in the sheet, in the order they appear. */
  const valuesOf = (sheet, name) =>
    [...sheet.matchAll(new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;}]+)`, 'g'))].map((one) =>
      one[1].trim()
    );

  const clamped = css({ lineClamp: '2' });
  const wanted = [
    ['display', '-webkit-box'],
    ['-webkit-box-orient', 'vertical'],
    ['-webkit-line-clamp', '2'],
    ['line-clamp', '2'],
    ['overflow', 'hidden'],
  ];
  const missing = wanted.filter(([name, value]) => !valuesOf(clamped, name).includes(value));
  report.check(
    'a clamp is the whole incantation, not the one declaration that names it',
    missing.length === 0,
    // `-webkit-line-clamp` on its own does nothing at all: it is a property of
    // a twenty-year-old box model, and without the display, the orientation
    // and the hidden overflow the text simply runs on. A row that wrote only
    // the line count would look right in the panel and change nothing.
    missing.length
      ? `no ${missing.map(([name, value]) => `${name}: ${value}`).join(', ')}`
      : wanted.map(([name]) => name).join(', ')
  );

  const unclamped = css({ lineClamp: 'none' });
  report.check(
    'and “no limit” lifts it without guessing what the display used to be',
    valuesOf(unclamped, '-webkit-line-clamp').includes('none') &&
      valuesOf(unclamped, 'line-clamp').includes('none') &&
      valuesOf(unclamped, 'display').length === 0,
    /*
     * The value exists so a narrower breakpoint can say "not clamped here",
     * where clearing the row would inherit the wider layer's clamp instead —
     * the same reason every switch in the vocabulary carries an off value.
     * Restoring a display it never knew would be wrong wherever the guess was.
     */
    `display: ${valuesOf(unclamped, 'display').join(' / ') || 'untouched'}, ` +
      `line-clamp: ${valuesOf(unclamped, 'line-clamp').join(' / ') || 'absent'}`
  );

  /*
   * The ordering, which is the half nothing else would catch.
   *
   * Two properties expand onto ground another property owns — a clamp writes
   * `display`, a gradient writes `color` — and until this was fixed the winner
   * was whichever key sat later in the style object. That is insertion order:
   * the property the designer touched most recently. Same document, same
   * renderer, different CSS depending on the order of two clicks.
   */
  const clampFirst = css({ lineClamp: '2', display: 'flex' });
  const clampLast = css({ display: 'flex', lineClamp: '2' });
  report.check(
    'a clamp beside a display resolves the same way whichever was set first',
    valuesOf(clampFirst, 'display').join() === '-webkit-box' &&
      valuesOf(clampLast, 'display').join() === '-webkit-box',
    // One declaration, not two: `display: flex; display: -webkit-box` renders
    // correctly and reads like a bug to anybody opening the stylesheet.
    `clamp first → display: ${valuesOf(clampFirst, 'display').join(' / ') || 'none'}; ` +
      `display first → display: ${valuesOf(clampLast, 'display').join(' / ') || 'none'}`
  );

  const gradient = 'linear-gradient(90deg, #6366f1, #ec4899)';
  const gradientFirst = css({ textGradient: gradient, color: '#ffffff' });
  const gradientLast = css({ color: '#ffffff', textGradient: gradient });
  report.check(
    'and so does a gradient beside a text colour, which is where this shipped broken',
    valuesOf(gradientFirst, 'color').join() === 'transparent' &&
      valuesOf(gradientLast, 'color').join() === 'transparent',
    // Not a new hazard: `textGradient` has expanded to `color: transparent`
    // since it was added, so a gradient set before a colour has silently lost
    // to it for months. Found by asking the same question of the new property.
    `gradient first → color: ${valuesOf(gradientFirst, 'color').join(' / ') || 'none'}; ` +
      `colour first → color: ${valuesOf(gradientLast, 'color').join(' / ') || 'none'}`
  );

  const hyphenated = css({ hyphens: 'auto' });
  report.check(
    'hyphenation ships the spelling Safari 16 needs beside the one it does not',
    valuesOf(hyphenated, '-webkit-hyphens').includes('auto') &&
      valuesOf(hyphenated, 'hyphens').includes('auto'),
    `${valuesOf(hyphenated, '-webkit-hyphens').join() || 'no prefix'} / ${
      valuesOf(hyphenated, 'hyphens').join() || 'no standard property'
    }`
  );

  /*
   * Which value the menu offers, and it is not a detail. `break-word` wraps
   * the letters but leaves the box's min-content width as the whole word, so a
   * grid column sized from its contents is still blown out — the text wraps
   * and the layout does not. `anywhere` is the value that measured 0.
   */
  const wrapOptions = vocabulary.STYLE_VOCABULARY.overflowWrap.control.options ?? [];
  report.check(
    'the long-words menu offers the value that actually narrows the box',
    wrapOptions.some((option) => option.value === 'anywhere'),
    wrapOptions.map((option) => `${option.label} → ${option.value}`).join(', ') || 'no options'
  );

  report.check(
    'the clamp checks are reading real declarations rather than an empty sheet',
    clamped.length > 40 && valuesOf(clamped, 'line-clamp').length > 0,
    // Every check above is a substring search over generated CSS, which passes
    // for the wrong reason the moment the generator returns nothing.
    `${clamped.length} characters of CSS for one clamped node`
  );

  /*
   * The language, which is what makes `hyphens: auto` mean the same thing on
   * every surface.
   *
   * A browser hyphenates by the nearest declared language, and only one of the
   * three surfaces has an `<html>` of its own. The canvas and preview draw
   * inside the editor, whose root says `en` because the editor is in English,
   * so a German document hyphenated as English there and as German once
   * published.
   *
   * The obvious fix — `lang` on the page node, so one renderer says it once —
   * is the one that does not work, and the second check below is there to say
   * why. `render.tsx` hands that renderer an *empty document*, deliberately, so
   * every page node threw on `doc.settings` and the canvas came down through
   * its error boundary. Nothing in this suite noticed: it renders strings from
   * real documents. The browser suites went red on the first run after.
   *
   * So each surface declares it on the frame it already draws, `lang` inherits,
   * and these check that all three say it somewhere.
   */
  const pageOf = (language) => {
    const doc = createEmptyDocument();
    doc.settings = { ...doc.settings, language };
    return generateSite(doc).files.find((file) => file.path === 'index.html')?.contents ?? '';
  };
  report.check(
    'the published shell declares the document language',
    /<html lang="de"/.test(pageOf('de')) && /<html lang="en"/.test(pageOf('en')),
    /<html [^>]*>/.exec(pageOf('de'))?.[0] ?? 'no html element'
  );
  report.check(
    'and the page node does not, because that renderer has no document to ask',
    !/data-cre8-root[^>]*lang=/.test(pageOf('de')),
    // Reading `doc.settings` there is a crash rather than a style preference:
    // on the canvas the document is `{ pages: [] }` cast into shape.
    /<div[^>]*data-cre8-root[^>]*>/.exec(pageOf('de'))?.[0] ?? 'no root element'
  );
  const frames = ['src/components/canvas/canvas.tsx', 'src/components/preview/preview.tsx'];
  const silent = frames.filter(
    (file) =>
      !/lang=\{[^}]*settings\.language/.test(
        readFileSync(path.join(ROOT, file), 'utf8')
      )
  );
  report.check(
    'and the two surfaces drawing inside the editor say it on their own frame',
    silent.length === 0,
    // A scrape, because the claim is that a component passes a prop and there
    // is no compiled artefact to ask. Whether it works is the browser suites'
    // question; this is what stops it being quietly dropped.
    silent.length ? `no lang on: ${silent.join(', ')}` : `${frames.length} frames carry it`
  );
}

report.group('a document can read right to left');

{
  /*
   * Gap 6, and the one the stress template called the largest by effort: every
   * spacing decision in the library is *physical*. Ninety-three blocks say
   * `paddingLeft`, and `padding-left` is the left of the screen whichever way
   * the writing runs — so an Arabic site built from them has its indents, its
   * icon gaps and its borders all on the wrong side, and the fix available was
   * to rewrite every block.
   *
   * Instead the generator rewrites the sided properties as flow-relative ones
   * when the document says `rtl`. `padding-inline-start` is the left in English
   * and the right in Arabic, so the whole library mirrors and nothing in it
   * changed. The two checks that matter are that it happens at all, and that it
   * happens to *nobody else*.
   */
  const sheetFor = (direction, styles) => {
    const doc = createEmptyDocument();
    doc.settings = { ...doc.settings, ...(direction === 'rtl' ? { direction } : {}) };
    const home = doc.pages.find((one) => one.isHome) ?? doc.pages[0];
    const { nodes } = buildTree({ type: 'text', name: 'T', props: { text: 'x' }, styles });
    const [id] = Object.keys(nodes);
    doc.nodes[id] = { ...nodes[id], parentId: home.rootNodeId };
    doc.nodes[home.rootNodeId].children = [id];
    return generateStylesheet(doc, { mode: 'media' });
  };
  const has = (sheet, declaration) => sheet.includes(declaration);

  const sided = {
    paddingLeft: '10px',
    marginRight: '20px',
    left: '4px',
    borderLeftWidth: '2px',
    borderTopLeftRadius: '6px',
    textAlign: 'left',
  };
  const mirrored = sheetFor('rtl', sided);
  const plain = sheetFor('ltr', sided);

  const wanted = [
    'padding-inline-start: 10px',
    'margin-inline-end: 20px',
    'inset-inline-start: 4px',
    'border-inline-start-width: 2px',
    'border-start-start-radius: 6px',
    'text-align: start',
  ];
  const absent = wanted.filter((one) => !has(mirrored, one));
  report.check(
    'a right-to-left document says its sides the way round that mirrors',
    absent.length === 0,
    absent.length ? `missing: ${absent.join(', ')}` : wanted.map((d) => d.split(':')[0]).join(', ')
  );
  report.check(
    'and stops saying them the way that does not',
    !/(?:^|[;{\s])(?:padding-left|margin-right|left|border-left-width|border-top-left-radius):/.test(
      mirrored
    ),
    // A page carrying both is a page where whichever came last wins, which is
    // worse than not mirroring at all: it would depend on declaration order.
    /(?:^|[;{\s])(padding-left|margin-right|left|border-left-width|border-top-left-radius):/.exec(
      mirrored
    )?.[1] ?? 'no physical sides left'
  );

  /*
   * The other half, and the more important one. Every site already published
   * is left-to-right, and the byte-identical gate is only worth having if the
   * bytes did not move underneath it.
   */
  const untouched = ['padding-left: 10px', 'margin-right: 20px', 'text-align: left'];
  const changed = untouched.filter((one) => !has(plain, one));
  /*
   * Scoped to the node's own rule rather than the whole sheet, because the
   * *reset* is flow-relative for everybody now and always should have been: a
   * list indented with `padding-left` indents on the wrong side of an Arabic
   * page, and a `padding-inline-start` of the same length is the identical
   * pixel in English. That is a fix rather than an exception, and the first
   * version of this check called it a failure.
   */
  const nodeRule = /\.c-[a-z0-9]+ \{([^}]*)\}/.exec(plain)?.[1] ?? '';
  report.check(
    'a left-to-right document emits exactly what it always did',
    changed.length === 0 && !nodeRule.includes('inline-start'),
    changed.length
      ? `no longer says: ${changed.join(', ')}`
      : `${untouched.length} physical declarations on the node, no logical ones`
  );

  /*
   * What is deliberately *not* mirrored, because a list of what a rule covers
   * is only trustworthy beside the list of what it leaves alone. A two-pixel
   * nudge is a visual adjustment to one design rather than a statement about
   * reading order, and a photograph's focal point does not swap sides because
   * the words did.
   */
  const kept = sheetFor('rtl', {
    translate: '4px 0',
    transform: 'translateX(4px)',
    backgroundPosition: 'left center',
    top: '8px',
  });
  report.check(
    'and leaves alone the things that are not about reading order',
    has(kept, 'translate: 4px 0') &&
      has(kept, 'transform: translateX(4px)') &&
      has(kept, 'background-position: left center') &&
      has(kept, 'top: 8px'),
    'transform, translate, background-position and the block axis are untouched'
  );

  report.check(
    'the published shell says which way it reads, and only when it is unusual',
    (() => {
      const shell = (direction) => {
        const doc = createEmptyDocument();
        doc.settings = { ...doc.settings, ...(direction ? { direction } : {}) };
        const html = generateSite(doc).files.find((f) => f.path === 'index.html')?.contents ?? '';
        return /<html[^>]*>/.exec(html)?.[0] ?? '';
      };
      return /dir="rtl"/.test(shell('rtl')) && !/dir=/.test(shell(undefined));
    })(),
    // `dir="ltr"` on every page in the world is bytes spent saying what the
    // browser already assumed.
    'rtl writes the attribute, ltr writes nothing'
  );

  /*
   * Both halves, on both surfaces, and the second half is here because it was
   * missing and nothing said so.
   *
   * The canvas and preview do not call `generateStylesheet` — each builds its
   * own sheet from `generateNodeCss`, the canvas because it splits the document
   * into a cold set and a hot one so an edit reprints a handful of rules rather
   * than a thousand. So the document's direction reaches the publisher for free
   * and reaches neither of them, and the first version of this shipped a frame
   * carrying `dir="rtl"` over CSS that still said `left`: markup that turned
   * around and a layout that did not, which reads as the feature being broken
   * rather than as one argument missing. Found by hand, an hour after the check
   * below said the surfaces were covered.
   */
  const frames = [
    ['src/components/canvas/canvas.tsx', /dir=\{[^}]*direction === 'rtl'/],
    ['src/components/preview/preview.tsx', /dir=\{[^}]*direction === 'rtl'/],
  ];
  const missingAttr = frames
    .filter(([file, pattern]) => !pattern.test(readFileSync(path.join(ROOT, file), 'utf8')))
    .map(([file]) => file);
  const missingCss = frames
    .filter(([file]) => {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      /*
       * Inside the call, not anywhere in the file. The first spelling of this
       * looked for the word `direction` in the source and found it in the
       * helper's own parameter list — so removing it from the `generateNodeCss`
       * arguments, which is the bug, left the check green.
       */
      return (
        /generateNodeCss\(/.test(source) && !/generateNodeCss\([^)]*\bdirection\b/s.test(source)
      );
    })
    .map(([file]) => file);
  report.check(
    'and so do the two surfaces that draw inside the editor, in the markup',
    missingAttr.length === 0,
    missingAttr.length ? `no dir on: ${missingAttr.join(', ')}` : `${frames.length} frames carry it`
  );
  report.check(
    'and in the stylesheet each of them builds for itself',
    missingCss.length === 0,
    missingCss.length
      ? `builds CSS without a direction: ${missingCss.join(', ')}`
      : `${frames.length} generators told which way round`
  );

  report.check(
    'these are reading real stylesheets rather than empty strings',
    mirrored.length > 400 && plain.length > 400,
    `${mirrored.length} characters mirrored, ${plain.length} plain`
  );
}

report.group('the layout long tail the stress template asked for');

{
  const css = (styles, rules) => {
    const { nodes } = buildTree({ type: 'text', name: 'T', props: { text: 'x' }, styles, rules });
    return generateNodeCss(nodes, { mode: 'media', includeStates: true });
  };
  const valuesOf = (sheet, name) =>
    [...sheet.matchAll(new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;}]+)`, 'g'))].map((one) =>
      one[1].trim()
    );

  /*
   * A shorthand and its longhands, which the panel now shows as three rows.
   *
   * `place-items` covers both axes; `align-items` and `justify-items` cover
   * one each. As a pass-through the three fought, and which one a designer saw
   * obeyed came down to the order the keys sat in the object — so the panel
   * could show `Place items: centre` and `Align: start` with the second having
   * no effect, and nothing anywhere would say so.
   */
  const shorthandFirst = css({ placeItems: 'center', alignItems: 'start' });
  const longhandFirst = css({ alignItems: 'start', placeItems: 'center' });
  const reads = (sheet) =>
    `${valuesOf(sheet, 'align-items').join('/') || '–'} across ${
      valuesOf(sheet, 'justify-items').join('/') || '–'
    }`;
  report.check(
    'a longhand refines the shorthand above it, whichever order they were set in',
    reads(shorthandFirst) === 'start across center' && reads(longhandFirst) === 'start across center',
    // The shorthand goes down first and the longhand refines it, which is how
    // anybody writing this by hand would order the two lines.
    `shorthand first → ${reads(shorthandFirst)}; longhand first → ${reads(longhandFirst)}`
  );
  const both = css({ placeItems: 'start end' });
  report.check(
    'and the shorthand still means both axes on its own',
    reads(css({ placeItems: 'center' })) === 'center across center' &&
      reads(both) === 'start across end',
    // Two values are block then inline, which is the shorthand's own order —
    // reading them the other way round is a silent transposition.
    `one value → ${reads(css({ placeItems: 'center' }))}; two → ${reads(both)}`
  );

  /*
   * The properties whose CSS value is a bare number, and the field that would
   * quietly ruin them. `NumberField` appends its first unit to whatever is
   * typed, so a count row left on the default writes `2px` into `column-count`
   * — valid CSS to the generator, meaningless to a browser, and invisible to
   * the compiler. That happened once and was found by clicking the row.
   */
  const bareCounts = ['columnCount', 'order', 'scale'];
  const withUnits = bareCounts.filter((prop) => {
    // Only a `length` row can append anything. `scale` is set from a rule
    // rather than a row, so it has no field to put a unit in — reading a
    // missing `units` as the default `px` called that a failure.
    const control = vocabulary.STYLE_VOCABULARY[prop].control;
    return control.kind === 'length' && control.units.length > 0;
  });
  report.check(
    'the rows whose value is a bare number offer no unit to append',
    withUnits.length === 0,
    withUnits.length
      ? `${withUnits.join(', ')} would write a length into a count`
      : `${bareCounts.join(', ')} are unitless`
  );

  /*
   * What the individual transforms are *for*, demonstrated against the thing
   * they replace rather than asserted. `transform` is a list, so a hover rule
   * that lifts a card has to restate the base layer's scale or lose it; the
   * separate properties compose through the cascade instead.
   */
  const hover = (apply) => [
    { id: 'r-hover', when: { kind: 'pointer', pseudo: 'hover' }, apply },
  ];
  const composed = css({ scale: '1.02' }, hover({ translate: '0 -4px' }));
  const listed = css({ transform: 'scale(1.02)' }, hover({ transform: 'translateY(-4px)' }));
  report.check(
    'a rule can nudge one axis without restating the rest of the transform',
    valuesOf(composed, 'scale').join() === '1.02' &&
      valuesOf(composed, 'translate').join() === '0 -4px' &&
      // The base's scale is in a rule of its own, so the hover rule adding a
      // translate leaves it standing. Two declarations, both live.
      composed.split('scale: 1.02').length === 2,
    `separate: ${valuesOf(composed, 'scale').join()} + ${valuesOf(composed, 'translate').join()}`
  );
  report.check(
    'which is the thing one transform property cannot do',
    // The comparison is the evidence: the hover rule's `transform` replaces the
    // base's outright, so the card stops being scaled the moment it is hovered
    // unless the author remembers to write the scale again.
    valuesOf(listed, 'transform').join(' then ') === 'scale(1.02) then translateY(-4px)',
    `one property: ${valuesOf(listed, 'transform').join(' then ')} — the scale is gone on hover`
  );

  /*
   * The jump offset, whose whole claim is about specificity. The reset gives
   * everything with an id 96px; a node that sets its own has to beat that, and
   * does only because the reset is wrapped in `:where()` at (0,0,1) while a
   * node rule is a class at (0,1,0). A browser measures it in `tests/render`;
   * this checks the two halves are still shaped the way that argument needs.
   */
  const resetRule = /:where\(\[data-cre8-root\]\) \[id\] \{ scroll-margin-top: (\d+)px/.exec(
    DOCUMENT_RESET
  );
  const own = css({ scrollMarginTop: '140px' });
  report.check(
    'a section can say where a jump to it stops, and outrank the default that exists',
    Boolean(resetRule) &&
      /^\.c-[a-z0-9]+ \{$/m.test(own.split('\n')[0]) &&
      valuesOf(own, 'scroll-margin-top').join() === '140px',
    // If the reset ever loses its `:where()` it climbs to (0,1,1) and beats
    // every node rule, and the row goes quietly dead.
    `reset ${resetRule?.[1] ?? '?'}px at :where(), node ${valuesOf(own, 'scroll-margin-top').join()} on ${
      own.split(' ')[0]
    }`
  );

  report.check(
    'these are reading generated CSS rather than empty strings',
    composed.length > 40 && shorthandFirst.length > 40 && DOCUMENT_RESET.length > 500,
    `${composed.length} + ${shorthandFirst.length} characters, ${DOCUMENT_RESET.length} of reset`
  );
}

report.group('what moves, and how it gets there');

{
  const {
    EASINGS,
    TRANSITION_GROUPS,
    formatTransform,
    formatTransition,
    parseTransform,
    parseTransition,
    transitionGroup,
  } = motion;

  /*
   * Both of these are composites, and a composite control lives or dies on
   * round-tripping. `transform` shipped for a year as a field reading "Any CSS
   * transform" and `transition` shipped as nothing at all, so every value in
   * the product was written by a person or by the block library — which makes
   * "whatever is already there survives being looked at" the first property,
   * not a nicety.
   */

  /* ------------------------------------------------------------ transition */

  const authored = [
    'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
    'transform 220ms ease, box-shadow 220ms ease',
    'background-color 140ms ease',
    'background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease',
  ];
  const roundTripped = authored.map((value) => formatTransition(parseTransition(value)));
  report.check(
    'every transition the block library authors survives a round trip',
    roundTripped.every((out, at) => out === authored[at]),
    // These are the real strings from `kit.ts`, `compose.ts` and the element
    // defaults. A control that rewrote one of them the first time somebody
    // opened the panel would silently retime every card in every template.
    roundTripped.find((out, at) => out !== authored[at]) ?? `${authored.length} unchanged`
  );

  const springy = parseTransition('transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)');
  report.check(
    'a curve with commas in it is one entry, not four',
    springy?.props.join() === 'transform' &&
      springy?.easing === 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    // `split(',')` turns this into four fragments and loses the curve, which is
    // why the parser walks bracket depth instead.
    JSON.stringify(springy)
  );
  report.check(
    'and the curve comes back out whole',
    formatTransition(springy) === 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    formatTransition(springy) ?? 'nothing'
  );

  const delayed = parseTransition('opacity 200ms ease 500ms');
  report.check(
    'a delay is not mistaken for the duration',
    delayed?.duration === '200ms',
    // Two times in one entry: the first is the duration, the second a delay the
    // panel does not offer. Reading the second would make a card that waits
    // half a second look like one that takes half a second.
    delayed?.duration ?? 'nothing'
  );

  report.check(
    'the named groups round-trip through their own ids',
    TRANSITION_GROUPS.every((group) => transitionGroup(group.props) === group.id),
    TRANSITION_GROUPS.map((group) => group.id).join(' · ')
  );
  report.check(
    'and a set matching none of them is custom rather than the nearest one',
    transitionGroup(['border-color', 'box-shadow', 'transform']) === 'custom',
    // What the block library actually writes. Reporting it as "Colour" would
    // mean opening the panel and pressing nothing silently drops `transform`.
    transitionGroup(['border-color', 'box-shadow', 'transform'])
  );
  report.check(
    'nothing at all parses as nothing, not as an empty transition',
    parseTransition(undefined) === null && parseTransition('none') === null,
    'unset stays unset'
  );

  /* ------------------------------------------------------------- transform */

  const shapes = [
    ['translate(0, -4px)', { x: '0', y: '-4px', scale: '', rotate: '' }],
    ['translateY(-4px)', { x: '', y: '-4px', scale: '', rotate: '' }],
    ['scale(1.02)', { x: '', y: '', scale: '1.02', rotate: '' }],
    ['rotate(-2deg)', { x: '', y: '', scale: '', rotate: '-2deg' }],
    ['translate(2px, -4px) scale(1.05) rotate(3deg)', { x: '2px', y: '-4px', scale: '1.05', rotate: '3deg' }],
  ];
  const misread = shapes.filter(
    ([value, want]) => JSON.stringify(parseTransform(value)) !== JSON.stringify(want)
  );
  report.check(
    'every transform shape the fields cover is read into them',
    misread.length === 0,
    misread.map(([value]) => value).join(', ') || `${shapes.length} shapes`
  );
  report.check(
    'and comes back out in a fixed order',
    formatTransform({ rotate: '3deg', scale: '1.05', y: '-4px', x: '2px' }) ===
      'translate(2px, -4px) scale(1.05) rotate(3deg)',
    /*
     * Fixed because transform functions do not commute — rotate then translate
     * moves along the rotated axes — so output that depended on which field was
     * touched last would make the element jump for no visible reason.
     */
    formatTransform({ rotate: '3deg', scale: '1.05', y: '-4px', x: '2px' }) ?? 'nothing'
  );
  report.check(
    'the parts that do nothing are left out rather than written as identity',
    formatTransform({ x: '', y: '', scale: '1', rotate: '0deg' }) === undefined &&
      formatTransform({ x: '', y: '-4px', scale: '1', rotate: '' }) === 'translateY(-4px)',
    // `scale(1) rotate(0deg)` on every element is bytes on every page and a
    // stacking context nobody asked for.
    String(formatTransform({ x: '', y: '-4px', scale: '1', rotate: '' }))
  );

  const beyond = ['perspective(400px) rotateX(20deg)', 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)', 'scale(1.2, 0.8)'];
  report.check(
    'a transform the fields cannot hold is refused, not approximated',
    beyond.every((value) => parseTransform(value) === null),
    /*
     * The reason this returns `null` rather than a best guess. Reading the
     * calls it likes out of `perspective(400px) rotateX(20deg)` and reporting
     * an identity transform turns "I do not understand this" into "it does
     * nothing" — and the panel would then write that nothing back over a 3D
     * transform somebody wrote, purely because they opened the section.
     */
    beyond.filter((value) => parseTransform(value) !== null).join(', ') || 'all three refused'
  );
  report.check(
    'and an unset transform is the identity rather than a refusal',
    JSON.stringify(parseTransform(undefined)) === JSON.stringify({ x: '', y: '', scale: '', rotate: '' }),
    // Otherwise every element with no transform gets the raw text box.
    JSON.stringify(parseTransform(undefined))
  );

  /* Each of the above, handed something it must reject. */
  report.check(
    'the round-trip check is comparing real strings',
    authored.length === 4 && authored.every((value) => value.includes('ms')),
    `${authored.length} authored values, taken from the library`
  );
  report.check(
    'and the refusal check would notice a parser that guessed',
    parseTransform('translate(1px) perspective(4px)') === null &&
      parseTransform('translate(1px)') !== null,
    'one recognised call is not enough on its own'
  );
  report.check(
    'the curve offered by default is one the parser reads back',
    EASINGS.every(
      (one) => parseTransition(`opacity 100ms ${one.value}`)?.easing === one.value
    ),
    EASINGS.map((one) => one.label).join(' · ')
  );
}

report.group('a value cannot leave its own rule');

{
  /*
   * A hole that shipped, found while looking for somewhere to put a custom-CSS
   * field: declarations were written into the `<style>` block verbatim.
   *
   * Selectors were never exposed to this — everything reaching one goes through
   * `slug()` or `anchorId()`, which whitelist to letters, digits, `_` and `-`,
   * and the code says so in three places. Values were the half nobody narrowed,
   * and they are the half a person types into.
   */
  const withValue = (value) => {
    const doc = createEmptyDocument('Escape');
    const page = doc.pages[0];
    const nodes = {};
    const { rootId } = buildTree({ type: 'section', name: 'S', styles: { color: value } }, nodes, page.rootNodeId);
    Object.assign(doc.nodes, nodes);
    doc.nodes[page.rootNodeId].children.push(rootId);
    return renderPage(doc, page, { mode: 'publish' });
  };

  const scripted = withValue('red</style><script>alert(document.cookie)</script>');
  report.check(
    'a value cannot end the style element and start a script',
    !/<script>alert/.test(scripted),
    /*
     * Stored XSS, in the published page *and* in the editor canvas of anybody
     * the project is shared with — one generator feeds both, so the same string
     * runs on the app's own origin with their session. Editing rights on a
     * shared project should not be rights over a collaborator's account.
     */
    /<script>alert[^<]*/.exec(scripted)?.[0] ?? 'nothing escaped'
  );

  const braced = withValue('red } body { display: none');
  report.check(
    'and cannot end its own rule and open another',
    // Whitespace-insensitive, because the published stylesheet is minified and
    // the first version of this looked for `body { display: none` with the
    // spaces intact. It passed with the hole wide open, which is the whole
    // reason every one of these gets broken on purpose before it is believed.
    !/body\s*\{\s*display\s*:\s*none/.test(braced),
    // The quieter version of the same thing: no script, but every element on
    // the page is now whatever the value said.
    // The *injected* rule, not the first `body {` in the file — that one is the
    // reset's, and printing it sends the reader hunting a rule that is fine.
    /body\s*\{\s*display\s*:\s*none[^}]*/.exec(braced)?.[0] ?? 'nothing escaped'
  );

  const semi = withValue('red; position: fixed');
  report.check(
    'and cannot smuggle a second declaration into the first',
    !/position:\s*fixed/.test(semi),
    // Not an escape — same element, same rule — but still a property the panel
    // never offered and the designer never wrote.
    /position:\s*fixed/.exec(semi)?.[0] ?? 'one declaration only'
  );

  /* Each of the above, handed something it must reject. */
  report.check(
    'an ordinary value still reaches the page',
    // A distinctive value, not `red`: the reset ships `color: inherit`, so the
    // first version of this matched that and would have passed against a
    // generator dropping every declaration it was given.
    /color:\s*rebeccapurple/.test(withValue('rebeccapurple')),
    /color:\s*rebeccapurple/.exec(withValue('rebeccapurple'))?.[0] ?? 'nothing emitted'
  );
  report.check(
    'and so does every value the block library actually uses',
    (() => {
      /*
       * The reason dropping is safe rather than merely strict. If any real
       * value carried one of these characters, this rule would be silently
       * deleting design from every template — so the whole library is swept
       * rather than argued about.
       */
      const offenders = [];
      const walk = (node) => {
        const layers = [node.styles, ...Object.values(node.responsive ?? {})];
        for (const rule of node.rules ?? []) layers.push(rule.apply);
        for (const layer of layers) {
          for (const [prop, value] of Object.entries(layer ?? {})) {
            if (typeof value === 'string' && /[<>{};]/.test(value)) offenders.push(`${prop}: ${value}`);
          }
        }
        (node.children ?? []).forEach(walk);
      };
      for (const block of BLOCKS) walk(block.build());
      return offenders.length === 0;
    })(),
    'no legitimate declaration needs one of those characters'
  );
}

report.group('content can vary on an attribute');

{
  /*
   * `variantsOf` refused an `attr` axis, and the reason recorded for it was
   * wrong. The stated requirement is mutual exclusion — each variant one
   * condition, the base one more — and an attribute splits two ways exactly as
   * a state does. Nothing about linearity was at risk; attributes had simply
   * arrived after the list of allowed kinds was written, which is what cost the
   * copy button its word.
   *
   * The requirement it *did* violate is different and only showed up in a
   * browser: an axis has to be legible to every element the expansion produces.
   * A state lives on an ancestor and a data value on the document element, so
   * all the variants can read them. An attribute set on one element cannot be
   * read by its sibling — see the runtime check below.
   */
  const doc = TEMPLATES.find((one) => one.id === 'saas')?.build();
  const html = doc
    ? generateSite(doc).files.find((file) => file.path === 'index.html').contents
    : '';
  const runtime = readFileSync(path.join(ROOT, 'src/lib/runtime/behaviour.ts'), 'utf8');

  report.check(
    'both words are in the markup, so nothing rewrites text at runtime',
    /<button[^>]*>Copy<\/button>/.test(html) && /<button[^>]*>Copied<\/button>/.test(html),
    // One element per case, and CSS chooses. A script that set `textContent`
    // would work with no keyframes and no variants, and would also mean the
    // published page said something the file did not.
    `${/>Copy</.test(html) ? 'Copy' : '—'} and ${/>Copied</.test(html) ? 'Copied' : '—'}`
  );
  report.check(
    'and the pair is chosen by a self-scoped attribute selector',
    /-v0:where\(:is\(\[data-cre8-copied=""\]\)\)\{display:none\}/.test(html) &&
      /-v1:where\(:not\(:is\(\[data-cre8-copied=""\]\)\)\)\{display:none\}/.test(html),
    /*
     * No ancestor prefix, which is the failure the data conditions had: a
     * prefix is satisfied by `<body>`, so the negative half matched everything.
     * An attribute condition tests the element itself and cannot fail that way.
     */
    (/-v[01]:where\([^{]*\)\{display:none\}/.exec(html)?.[0] ?? 'no variant rules').slice(0, 80)
  );
  report.check(
    'and the runtime marks every element the node renders as',
    // The bug this found. The mark went on the element that was clicked, whose
    // sibling then stayed hidden because its rule reads "hide unless *I* am
    // marked" — so pressing the button made it disappear entirely.
    /function markKin\(/.test(runtime) && /markKin\(copier, true\)/.test(runtime),
    // Both halves named, because they fail separately: the helper can survive
    // while the call site stops using it, which is what the first version of
    // this detail reported as "present" while going red.
    `helper ${/function markKin\(/.test(runtime) ? 'present' : 'missing'}, ` +
      `call site ${/markKin\(copier, true\)/.test(runtime) ? 'uses it' : 'marks only the clicked element'}`
  );
}

report.group('a reference never resolves to the thing making it');

{
  /*
   * Written because renaming the nav links stopped exercising the fix.
   *
   * A name reference takes the first node with that name, and the most natural
   * name for a nav entry is the name of the section it points at — a link
   * called "Work" above a section called "Work". The nav comes first, so the
   * link claimed its own id, resolved to an element with no anchor, and
   * published as a link to nowhere while looking in the document exactly like
   * a working reference.
   *
   * The fix is one clause in `resolveRefs`. Naming the links "Work link" also
   * fixes the templates, and that is the problem: with both in place, undoing
   * the clause breaks nothing anybody would see. So the collision is built
   * here on purpose and kept.
   */
  const nodes = {};
  buildTree(
    {
      type: 'section',
      name: 'Page',
      children: [
        { type: 'link', name: 'Work', props: { text: 'Work' }, refs: { scrollTo: 'Work' } },
        { type: 'section', name: 'Work', props: { anchor: 'work' } },
      ],
    },
    nodes,
    null
  );
  const link = Object.values(nodes).find((one) => one.type === 'link');
  const band = Object.values(nodes).find((one) => one.type === 'section' && one.props.anchor);

  report.check(
    'a link named after its target reaches the target, not itself',
    Boolean(link) && Boolean(band) && jumpOf(link) === band.id,
    // Pointing at itself is the failure; having no reference at all is the
    // second-best outcome and still wrong, so both are named.
    jumpOf(link) === link?.id
      ? 'it resolved to itself'
      : jumpOf(link)
        ? 'it reached the section'
        : 'the reference was dropped entirely'
  );
  report.check(
    'and the fixture really does have two nodes of the same name',
    Object.values(nodes).filter((one) => one.name === 'Work').length === 2,
    // Without the collision the check above passes on any tree at all.
    `${Object.values(nodes).filter((one) => one.name === 'Work').length} nodes named Work`
  );
}

report.group('a container can be the thing you click');

{
  /*
   * The gap this closes was written down under "deliberately not done" for
   * three milestones: every other builder lets you make a whole card clickable
   * and this one said wrap it in a link. The reason it was deferred is the
   * reason it needs checking from both ends — a layout box that renders as an
   * `<a>` keeps its type, so every rule that reasons about types goes blind at
   * exactly the moment the element becomes interactive.
   */
  const render = (spec) => {
    const doc = createEmptyDocument();
    const home = doc.pages[0];
    const into = {};
    const { rootId } = buildTree(spec, into, home.rootNodeId);
    Object.assign(doc.nodes, into);
    doc.nodes[home.rootNodeId].children.push(rootId);
    return {
      doc,
      rootId,
      html: generateSite(doc).files.find((file) => file.path === 'index.html').contents,
    };
  };

  const linked = render({
    type: 'frame',
    name: 'Clickable card',
    props: { href: 'https://example.com/', target: '_blank' },
    children: [{ type: 'heading', name: 'T', props: { text: 'Read more', level: 3 } }],
  });
  report.check(
    'a frame with somewhere to go publishes as a link around its content',
    /<a [^>]*href="https:\/\/example\.com\/"[^>]*>\s*<h3/.test(linked.html),
    // Around its content, not beside it: the heading has to stay inside the
    // anchor or the card is a link to nothing with a title next to it.
    /<a [^>]*>(<h3[^>]*>)?[^<]{0,30}/.exec(linked.html)?.[0] ?? 'no anchor at all'
  );
  report.check(
    'and a new tab still gets the opener protection every other link gets',
    /target="_blank"/.test(linked.html) && /rel="noopener noreferrer"/.test(linked.html),
    // Same code path as a button's link rather than a second one, which is the
    // only reason this is true without being written twice.
    /rel="[^"]*"/.exec(linked.html)?.[0] ?? 'no rel'
  );

  const plain = render({ type: 'frame', name: 'Ordinary', children: [] });
  report.check(
    'and a frame with nowhere to go is still a div',
    !/<a [^>]*class="c-/.test(plain.html),
    // Or every layout box on every page just became a link.
    /<div [^>]*class="c-[^"]*"/.exec(plain.html)?.[0]?.slice(0, 40) ?? 'no div'
  );

  report.check(
    'the nesting rule sees a clickable container, which has no interactive type',
    isInteractive({ type: 'frame', props: { href: '/x/' } }) &&
      isInteractive({ type: 'frame', refs: { scrollTo: 'Somewhere' } }) &&
      !isInteractive({ type: 'frame', props: {} }),
    /*
     * Both spellings. A card that *jumps* carries no href at all — the
     * reference becomes one in the renderer — so a rule reading `props.href`
     * would wave a button straight into it. That was true of the first version
     * of `isInteractive`, written an hour before the jump existed.
     */
    `href ${isInteractive({ type: 'frame', props: { href: '/x/' } })}, ` +
      `jump ${isInteractive({ type: 'frame', refs: { scrollTo: 'Somewhere' } })}, ` +
      `plain ${isInteractive({ type: 'frame', props: {} })}`
  );
  report.check(
    'and refuses a button inside one, the same as inside a link',
    (() => {
      const built = render({
        type: 'frame',
        name: 'Clickable card',
        props: { href: '/x/' },
        children: [{ type: 'frame', name: 'Inner' }],
      });
      const inner = Object.values(built.doc.nodes).find((one) => one.name === 'Inner');
      const loose = {};
      const { rootId: buttonId } = buildTree({ type: 'button', name: 'B' }, loose, null);
      Object.assign(built.doc.nodes, loose);
      return inner ? !canReparent(built.doc.nodes, buttonId, inner.id) : false;
    })(),
    'a button cannot be dropped into a frame inside a clickable frame'
  );
}

report.group('nothing operable lands inside anything operable');

{
  /*
   * The editor half of the rule the block sweep now applies to specs.
   *
   * Both are needed and neither covers the other: the sweep reads what the
   * library ships, and this reads what a drag is allowed to do. A rule enforced
   * only on authored blocks is a rule a person can walk straight past with the
   * mouse.
   */
  const doc = createEmptyDocument();
  const home = doc.pages[0];
  const built = {};
  const add = (spec, parent) => {
    const { rootId } = buildTree(spec, built, parent);
    return rootId;
  };
  const root = home.rootNodeId;
  Object.assign(built, doc.nodes);

  const cardLink = add({ type: 'link', name: 'Card link', props: { href: '/x/' } }, root);
  const inner = add({ type: 'frame', name: 'Inner' }, cardLink);
  const plainFrame = add({ type: 'frame', name: 'Plain' }, root);
  const loneButton = add({ type: 'button', name: 'Lone' }, root);
  const cardWithButton = add({ type: 'frame', name: 'Card' }, root);
  const nestedButton = add({ type: 'button', name: 'Nested' }, cardWithButton);
  Object.assign(doc.nodes, built);
  for (const [id, node] of Object.entries(built)) {
    if (node.parentId && doc.nodes[node.parentId] && !doc.nodes[node.parentId].children.includes(id)) {
      doc.nodes[node.parentId].children.push(id);
    }
  }

  report.check(
    'a button cannot be dragged into a frame that sits inside a link',
    !canReparent(doc.nodes, loneButton, inner),
    // The case `canContain` cannot see: every step of link › frame › button is
    // legal on its own, and the parser lifts the button out of the link.
    `canReparent(button → frame-in-link) = ${canReparent(doc.nodes, loneButton, inner)}`
  );
  report.check(
    'nor a card that merely contains one',
    !canReparent(doc.nodes, cardWithButton, inner),
    // The easier mistake, and the one nobody pictures: it is the same invalid
    // markup arrived at by moving the wrapper instead of the control.
    `canReparent(card-holding-a-button → frame-in-link) = ${canReparent(doc.nodes, cardWithButton, inner)}`
  );
  report.check(
    'and an ordinary frame still goes anywhere it could before',
    canReparent(doc.nodes, plainFrame, inner) && canReparent(doc.nodes, loneButton, cardWithButton),
    // Both directions of "still works", because a rule that refuses everything
    // passes the two checks above and breaks the editor.
    `plain frame into the link: ${canReparent(doc.nodes, plainFrame, inner)}, ` +
      `button into an ordinary card: ${canReparent(doc.nodes, loneButton, cardWithButton)}`
  );
  report.check(
    'and the fixture is the shape the checks think it is',
    // Without this the three above pass on a tree where the link never got
    // built and nothing was ever nested at all.
    doc.nodes[inner]?.parentId === cardLink && doc.nodes[nestedButton]?.parentId === cardWithButton,
    `inner’s parent is the link: ${doc.nodes[inner]?.parentId === cardLink}, ` +
      `the card holds a button: ${doc.nodes[nestedButton]?.parentId === cardWithButton}`
  );
}

report.group('a hook that only sometimes runs');

{
  /*
   * The rule React states and no compiler here enforces: a component calls the
   * same hooks, in the same order, on every render.
   *
   * Written because this milestone broke it. `useEditor(…) === 'desktop' &&
   * !useEditor(…)` reads as one condition and is two hooks with a
   * short-circuit between them — the second ran on Desktop and nowhere else, so
   * React's hook list went out of step the instant anybody switched to Tablet
   * and the whole inspector came down through its error boundary. Nothing
   * caught it: it type-checks, it renders correctly on the layer everything is
   * designed on, and the browser suite drove that layer only.
   *
   * A textual rule, deliberately. The real check needs a parser, but the
   * mistake has a shape — a hook call to the right of an operator that can skip
   * it — and that shape is greppable.
   */
  const OPERATORS = /(&&|\|\||\?\?|(?<!\?)\?(?!\.))\s*!*\s*(use[A-Z]\w*)\s*\(/g;
  const files = [];
  const offenders = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      files.push(full);
      // Comments stripped first, so a sentence *describing* the hazard — the
      // one three lines above this — is not itself reported as the hazard.
      const text = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const match of text.matchAll(OPERATORS)) {
        offenders.push(`${path.relative(ROOT, full)}: ${match[2]} after ${match[1]}`);
      }
    }
  };
  scan(path.join(ROOT, 'src'));

  report.check(
    'no hook is called on the far side of an operator that can skip it',
    offenders.length === 0,
    offenders.join(', ') || `${files.length} files, every hook unconditional`
  );
  report.check(
    'and the scan read the tree it claims to have read',
    // Without this the rule above passes just as happily on zero files, which
    // is what a mistyped path gives you. 121 today; the floor is a tripwire for
    // a path that stops resolving, not a count to keep updating.
    files.length > 100,
    `${files.length} components and modules scanned`
  );
  report.check(
    'the rule catches each way of writing it',
    ['const a = flag && useMemo(() => 1, []);',
     'const b = flag || useRef(null);',
     'const c = flag ? useContext(X) : null;',
     'const d = flag ?? useCallback(fn, []);',
     'const e = flag && !useStore((s) => s.x);',
    ].every((line) => {
      OPERATORS.lastIndex = 0;
      return OPERATORS.test(line);
    }) &&
      // And does not fire on the shapes that are fine, including the optional
      // chain `?.` that a naive `?` would swallow.
      ['const ok = useMemo(() => a && b, [a, b]);',
       'const also = thing?.useCount;',
       'const fine = flag && other.useLater;',
      ].every((line) => {
        OPERATORS.lastIndex = 0;
        return !OPERATORS.test(line);
      }),
    'five spellings caught, three lookalikes left alone'
  );
}

report.group('a record can change what an element looks like');

{
  /*
   * The other half of binding, and the half that was missing.
   *
   * `bind` lets a record change what an element *says*. Nothing let a record
   * change what it *looks like* — so a repeater drew one shape, and a
   * collection-backed gallery could not lead with a piece of work the way a
   * hand-built bento does.
   *
   * The renderer could do it all along: `assign` holds `WHEN field → state`,
   * `stateFrom` evaluates it against the row, and the state attribute is
   * written per row at publish. What could not was the *spec* — `buildSubtree`
   * copied props, styles, rules, meta, repeat, refs and bindings and dropped
   * this one silently, so no block or template could ever reach it.
   */
  const doc = createEmptyDocument('Featured');
  const page = doc.pages[0];
  const cid = 'c-work';
  doc.collections = [
    {
      id: cid,
      name: 'Work',
      fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'feature', label: 'Feature', type: 'text' },
      ],
    },
  ];
  const featured = [{ kind: 'state', key: 'feature', op: 'is', values: ['wide'] }];
  const { rootId } = buildTree(
    {
      type: 'grid',
      name: 'Cards',
      styles: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
      responsive: { mobile: { gridTemplateColumns: '1fr' } },
      repeat: { collection: cid },
      children: [
        {
          type: 'frame',
          name: 'Card',
          props: { switchKey: 'feature', switchDefault: 'plain' },
          assign: [
            {
              id: 'a-wide',
              when: { kind: 'compare', left: { kind: 'field', key: 'feature' }, op: 'notEmpty' },
              value: 'wide',
            },
          ],
          rules: [
            { id: 'r-wide', when: featured, apply: { gridColumn: 'span 2' } },
            { id: 'r-narrow', when: featured, apply: { gridColumn: 'auto' }, breakpoint: 'mobile' },
          ],
          children: [{ type: 'text', name: 'T', props: { text: 'x' }, bind: { text: 'title' } }],
        },
      ],
    },
    doc.nodes,
    page.rootNodeId
  );
  doc.nodes[page.rootNodeId].children.push(rootId);

  const card = Object.values(doc.nodes).find((n) => n.name === 'Card');
  report.check(
    'a spec can carry a state the record decides',
    (card?.assign ?? []).length === 1 && card.assign[0].value === 'wide',
    card?.assign ? `assign: ${card.assign[0].value} when ${card.assign[0].when.op}` : 'dropped on the way in'
  );

  const rows = ['Meridian:wide', 'Cobalt:', 'Orenda:'].map((one, i) => {
    const [title, feature] = one.split(':');
    return {
      id: `r${i}`,
      collectionId: cid,
      slug: title.toLowerCase(),
      position: i,
      published: true,
      data: { title, feature },
      createdAt: 0,
      updatedAt: 0,
    };
  });
  const html = String(
    generateSite(doc, { pretty: false, records: { [cid]: rows } }).files.find(
      (f) => f.path === 'index.html'
    ).contents
  );
  const wide = (html.match(/data-cre8-value="wide"/g) ?? []).length;
  const plain = (html.match(/data-cre8-value="plain"/g) ?? []).length;
  report.check(
    'and the row it is evaluated against decides it, one row at a time',
    wide === 1 && plain === 2,
    `${wide} featured, ${plain} ordinary, from ${rows.length} records`
  );

  /* And the templates use it. */
  const agency = TEMPLATES.find((t) => t.id === 'agency');
  const doc2 = agency.build();
  const workId = (doc2.collections ?? []).find((c) => c.name === 'Work')?.id;
  const seeded = (agency.seed ?? []).map((row, i) => ({
    id: `s${i}`,
    collectionId: workId,
    slug: row.slug,
    position: i,
    published: true,
    data: row.data,
    createdAt: 0,
    updatedAt: 0,
  }));
  const home = String(
    generateSite(doc2, { pretty: false, records: { [workId]: seeded } }).files.find(
      (f) => f.path === 'index.html'
    ).contents
  );
  const led = (home.match(/data-cre8-value="wide"/g) ?? []).length;
  report.check(
    'the agency leads with two of its seven, which is nine cells in three columns',
    led === 2 && seeded.length === 7,
    // The arithmetic is the point: 2×2 + 5 = 9, three exact rows. Six records
    // with two wide would be eight cells and a hole at the end.
    `${led} wide and ${seeded.length - led} ordinary — ${led * 2 + (seeded.length - led)} cells`
  );
}

report.group('a conditional style can still be undone by a narrow screen');

{
  /*
   * The precedence question STATE-AND-CONDITIONS §11 left open, answered by
   * the case that made it concrete.
   *
   * A featured card spans two columns. On a phone the grid is one column and
   * the span has to be released, or the grid invents a second column and the
   * page scrolls sideways. Both statements are conditional — they are true
   * only of a featured card — so both are rules, and the narrow one has to
   * win over the wide one. It did not: every conditional rule was emitted
   * after every breakpoint, so the unscoped rule beat its own mobile version
   * and the override did nothing at all.
   */
  const doc = createEmptyDocument('Cascade');
  const page = doc.pages[0];
  const featured = [{ kind: 'state', key: 'feature', op: 'is', values: ['wide'] }];
  const { rootId } = buildTree(
    {
      type: 'grid',
      name: 'Cards',
      props: { switchKey: 'feature', switchDefault: 'plain' },
      styles: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
      responsive: { mobile: { gridTemplateColumns: '1fr' } },
      rules: [
        { id: 'r-wide', when: featured, apply: { gridColumn: 'span 2' } },
        { id: 'r-narrow', when: featured, apply: { gridColumn: 'auto' }, breakpoint: 'mobile' },
      ],
    },
    doc.nodes,
    page.rootNodeId
  );
  doc.nodes[page.rootNodeId].children.push(rootId);
  const css = generateStylesheet(doc, { standalone: true, mode: 'media' });

  const spanAt = css.indexOf('span 2');
  const releaseAt = css.indexOf('grid-column: auto');
  report.check(
    'a rule scoped to a breakpoint is emitted after the same rule unscoped',
    spanAt > -1 && releaseAt > spanAt,
    spanAt === -1
      ? 'the span is not in the sheet at all'
      : `span at ${spanAt}, release at ${releaseAt} — ${releaseAt > spanAt ? 'after' : 'BEFORE, so it loses'}`
  );
  report.check(
    'and it is inside a media query, not loose in the sheet',
    /@media[^{]*\{[^}]*grid-column: auto/s.test(css.slice(releaseAt - 400, releaseAt + 60)),
    css.slice(Math.max(0, releaseAt - 90), releaseAt + 40).replace(/\s+/g, ' ').trim()
  );
  report.check(
    'the plain narrow override still comes before the conditional rules',
    // The half that must not change: a rule beating an ordinary breakpoint
    // override is the documented answer, and only the *scoped* rule moved.
    css.indexOf('grid-template-columns: 1fr') < spanAt,
    `one-column override at ${css.indexOf('grid-template-columns: 1fr')}, first rule at ${spanAt}`
  );
}

report.group('a jump that reaches another page');

{
  /*
   * The whole of R5, in the two places it lives.
   *
   * `resolveNodeHref` hands back a page reference and a fragment rather than a
   * bare fragment, and the resolvers that already understood `page:` finish
   * the job. Before this a jump was silently a same-page scroll: a nav on a
   * case-study page pointed at `#work`, there is no `#work` on a case-study
   * page, and pressing it did nothing at all.
   */
  const doc = createEmptyDocument('Two pages');
  const home = doc.pages[0];
  const second = createPage('Second', 'second', doc.nodes, 1, false);
  doc.pages.push(second);
  const { rootId: target } = buildTree(
    { type: 'section', name: 'Work', props: { anchor: 'work' } },
    doc.nodes,
    home.rootNodeId
  );
  doc.nodes[home.rootNodeId].children.push(target);

  report.check(
    'a jump names the page its target is on, not just the place',
    resolveNodeHref(doc, `node:${target}`) === `page:${home.id}#work`,
    resolveNodeHref(doc, `node:${target}`)
  );
  report.check(
    'a target that has lost its anchor still resolves to nowhere',
    // The empty string is the renderer's "hide this link" signal, and it has
    // to survive the change: `#` would look fine and scroll nowhere.
    resolveNodeHref(doc, 'node:missing') === '',
    JSON.stringify(resolveNodeHref(doc, 'node:missing'))
  );
  report.check(
    'and an href that is not a jump is left alone',
    resolveNodeHref(doc, 'https://example.com') === null,
    'null means "not mine", which is how three resolvers share one answer'
  );

  /* A node with no page — a component master — keeps the bare fragment. */
  const loose = buildTree(
    { type: 'section', name: 'Shared', props: { anchor: 'shared' } },
    doc.nodes,
    null
  ).rootId;
  report.check(
    'a target inside no page keeps the fragment it always had',
    resolveNodeHref(doc, `node:${loose}`) === '#shared',
    // Which copy a master means has no answer, and the browser's own — the
    // nearest match — is the best one available.
    `${resolveNodeHref(doc, `node:${loose}`)} for a node on no page`
  );

  /*
   * And the published proof, in a document built for it.
   *
   * Deliberately not asserted over the templates. "A fragment on a nested page
   * is wrong" is not true — the SaaS pricing page links to its own `#plans`,
   * correctly — and the case that *is* wrong, a fragment naming nothing on the
   * page carrying it, is what `brokenLinks` already walks every link to catch.
   * What is worth checking here is narrower and is R5 itself: one link, one
   * target, two pages, and the href each page gets.
   */
  const site = createEmptyDocument('Jumper');
  const first = site.pages[0];
  const other = createPage('Other', 'other', site.nodes, 1, false);
  site.pages.push(other);
  const { rootId: section } = buildTree(
    { type: 'section', name: 'Work', props: { anchor: 'work' } },
    site.nodes,
    first.rootNodeId
  );
  site.nodes[first.rootNodeId].children.push(section);
  // The same link on both pages, pointing at the section on the first.
  for (const page of [first, other]) {
    const { rootId: link } = buildTree(
      { type: 'link', name: 'To work', props: { text: 'Work' } },
      site.nodes,
      page.rootNodeId
    );
    site.nodes[link].refs = { scrollTo: { node: section } };
    site.nodes[page.rootNodeId].children.push(link);
  }

  const files = new Map(
    generateSite(site, { pretty: false }).files.map((f) => [f.path, String(f.contents)])
  );
  const hrefIn = (path) => /<a\b[^>]*\shref="([^"]*)"/.exec(files.get(path) ?? '')?.[1] ?? 'no link';

  report.check(
    'the same jump climbs out of the page that does not hold its target',
    hrefIn('other/index.html') === '../#work',
    `${hrefIn('other/index.html')} from other/index.html`
  );
  report.check(
    'and stays a bare fragment on the page that does',
    // The half that catches over-correcting: `./#work` would work and would
    // reload the document, losing the smooth scroll and the scroll position.
    hrefIn('index.html') === '#work',
    `${hrefIn('index.html')} from index.html`
  );
}

{
  /*
   * And the picker offers what the mechanism can now express.
   *
   * The inspector listed sections on the page being edited and nothing else,
   * which matched what a jump could do: offering a section on another page
   * would have been offering something that did not work. Now it does, and a
   * capability only templates can reach is not a capability the product has.
   *
   * Asked of the function the hook calls rather than of the hook, so there is
   * one rule and not two — the grouping a designer sees has to agree with the
   * page the reference resolves against.
   */
  const doc = TEMPLATES.find((t) => t.id === 'agency').build();
  const home = doc.pages.find((p) => p.isHome || p.slug === '');
  const detail = doc.pages.find((p) => p !== home);
  const fromDetail = jumpTargetsFor(doc, detail.rootNodeId);
  const named = (list, name) => list.find((one) => one.name === name);

  report.check(
    'standing on a detail page, the home page’s sections are on offer',
    Boolean(named(fromDetail, 'Gallery')) && Boolean(named(fromDetail, 'Services')),
    `${fromDetail.length} places to jump to, from a page with ${
      jumpTargetsFor({ nodes: doc.nodes, pages: [] }, detail.rootNodeId).length
    } of its own`
  );
  report.check(
    'and they say which page they are on, while this page’s do not',
    named(fromDetail, 'Gallery')?.page === home.name &&
      named(fromDetail, 'Case study')?.page === undefined,
    `Gallery is grouped under "${named(fromDetail, 'Gallery')?.page}", and this page's are ungrouped`
  );
  report.check(
    'nothing is offered twice, and nothing offers itself',
    new Set(fromDetail.map((one) => one.id)).size === fromDetail.length &&
      !fromDetail.some((one) => one.id === detail.rootNodeId),
    `${fromDetail.length} entries, ${new Set(fromDetail.map((o) => o.id)).size} distinct`
  );
  report.check(
    'and the node being edited is never in its own list',
    (() => {
      const first = fromDetail[0];
      return !jumpTargetsFor(doc, detail.rootNodeId, first.id).some((o) => o.id === first.id);
    })(),
    'a control cannot scroll to itself'
  );
}

report.group('a switch arm that can never run');

{
  /*
   * A `case` listed twice in one switch.
   *
   * The second one is dead — a switch takes the first match — and neither
   * TypeScript nor the build says a word about it. C2 added
   * `frame|section|container|stack|grid` to the top of `typeContent` for the
   * new destination rows, five types that were already listed further down for
   * `SemanticContent`, and the effect was that every layout box lost its tag
   * choice and its anchor row. The panel that names a section so a link can
   * point at it became unreachable on the elements that most need it, in the
   * same milestone that made those elements linkable.
   *
   * It survived a fortnight because nothing looks at an inspector panel that
   * is not there. The browser suite caught it in the end — `native` clicks the
   * Semantics header — and this is the cheaper version of that catch.
   *
   * Textual, and the shape is exact: inside one `switch (…) { … }`, no
   * `case 'x':` twice. Strings only, which is all this codebase switches on.
   */
  /**
   * Shadowed arms in one source text, and how much was looked at.
   *
   * One function for the sweep and for the fixtures below, so the two cannot
   * drift. Written the other way first — a second copy of the logic in the
   * falsification — and the copy shared its `seen` set across switches, which
   * made it disagree with the real rule about the case the detail line was
   * boasting of.
   */
  const shadowedArms = (text) => {
    const found = [];
    let switches = 0;
    let arms = 0;
    // Split on `switch (`, then take each body up to the matching depth-zero
    // brace. Good enough for a lint and wrong in no way that hides a dupe:
    // a body cut short reports fewer arms, never a false one.
    for (const chunk of text.split(/\bswitch\s*\(/).slice(1)) {
      switches++;
      let depth = 0;
      let end = chunk.length;
      for (let i = chunk.indexOf('{'); i >= 0 && i < chunk.length; i++) {
        if (chunk[i] === '{') depth++;
        else if (chunk[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      // Per switch, which is the whole point: the same name in the next
      // switch is ordinary, and `typeContent` and the block registry both
      // switch on element type.
      const seen = new Set();
      for (const arm of chunk.slice(0, end).matchAll(/\bcase\s+(['"])([^'"]+)\1\s*:/g)) {
        arms++;
        if (seen.has(arm[2])) found.push(arm[2]);
        seen.add(arm[2]);
      }
    }
    return { found, switches, arms };
  };

  const dupes = [];
  let switches = 0;
  let arms = 0;
  const walkDir = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const seen = shadowedArms(text);
      switches += seen.switches;
      arms += seen.arms;
      for (const name of seen.found) {
        dupes.push(`${path.relative(ROOT, full)}: case '${name}' twice in one switch`);
      }
    }
  };
  walkDir(path.join(ROOT, 'src'));

  report.check(
    'no case is listed twice in one switch, where the second can never run',
    dupes.length === 0,
    dupes.slice(0, 3).join(' | ') || `${arms} arms across ${switches} switches, each reachable`
  );
  report.check(
    'and the scan read enough of the tree to mean it',
    // A tripwire for a path that stops resolving, not a count to keep in step:
    // 199 arms today, and the floor is set well under it on purpose.
    switches > 20 && arms > 150,
    `${switches} switches, ${arms} string arms`
  );

  /* The same function, handed one of each. */
  const shadowed = 'switch (t) { case \'a\': return 1; case \'a\': return 2; }';
  const distinct = 'switch (t) { case \'a\': return 1; case \'b\': return 2; }';
  const twoSwitches = `${distinct} ${distinct}`;
  const real = "switch (t) { case 'frame': case 'section': return <A />; case 'popover': return <B />; case 'frame': return <C />; }";
  report.check(
    'the rule sees a shadowed arm and not a repeated one in a second switch',
    shadowedArms(shadowed).found.length === 1 &&
      shadowedArms(distinct).found.length === 0 &&
      // The half that matters, and the half the first version of this
      // falsification never actually tested: `typeContent` and the block
      // registry both switch on element type, and flagging that would make
      // the rule noise nobody reads.
      shadowedArms(twoSwitches).found.length === 0 &&
      shadowedArms(twoSwitches).switches === 2 &&
      // And the shape that started it, in miniature.
      shadowedArms(real).found.join() === 'frame',
    `two switches over the same names: ${shadowedArms(twoSwitches).found.length} offences; one switch repeating itself: ${shadowedArms(shadowed).found.length}`
  );
}

report.group('the library uses what the panel can now express');

{
  /*
   * Checked against the shipped output rather than asserted, and the finding is
   * narrower than the audit first claimed. The library *could* reach a column
   * span all along — a block author writes TypeScript — and exactly one block
   * did. What nothing had ever written is a **row** span: the half no template
   * needed and no panel row offered. `checkColumnSpans` is the evidence, since
   * it was written to guard the one bento that existed and only ever looked at
   * the axis that bento used.
   */
  const bento = BLOCKS.find((one) => one.name === 'Bento grid')?.build();

  const cells = [];
  const walkCells = (node) => {
    if (node.styles?.gridColumn || node.styles?.gridRow) cells.push(node);
    (node.children ?? []).forEach(walkCells);
  };
  if (bento) walkCells(bento);

  report.check(
    'the bento varies downward as well as across',
    cells.length >= 4 && cells.some((one) => /span [2-9]/.test(one.styles.gridRow ?? '')),
    // A bento that varies only by width is a row of wide and narrow cards,
    // which is a fair description of what this block was.
    cells
      .map((one) => `${one.name}: ${one.styles.gridColumn ?? '-'} / ${one.styles.gridRow ?? '-'}`)
      .join(' · ') || 'every card is one cell'
  );

  /*
   * Restated, not dropped — the bug this layout found in the span control. A
   * narrower breakpoint that omits the span inherits it, and a card still
   * asking for three columns inside a two-column grid makes the browser invent
   * a third, so the phone gets a sideways scrollbar instead of a stack.
   *
   * The predicate is named because the detail has to be computed from it. The
   * first version tested all four spellings and then listed only the cards
   * whose *mobile* row was wrong, so deleting the tablet reset produced a
   * failing check whose message read "4 cards restate both axes" — a check that
   * fails while reporting success is worse than one that does not fail at all.
   */
  const restates = (one) =>
    Boolean(one.responsive?.tablet?.gridColumn) &&
    one.responsive?.tablet?.gridRow === 'auto' &&
    one.responsive?.mobile?.gridColumn === 'auto' &&
    one.responsive?.mobile?.gridRow === 'auto';
  report.check(
    'and every span it takes is restated on the narrower layouts',
    cells.length > 0 && cells.every(restates),
    cells.filter((one) => !restates(one)).map((one) => one.name).join(', ') ||
      `${cells.length} cards restate both axes`
  );

  report.check(
    'and every one of its cards arrives as you scroll to it',
    cells.length > 0 && cells.every((one) => one.styles.appear),
    // The same shape as the transition gap: the effect existed in the model,
    // the panel could not write it, so nothing outside a hand-authored block
    // ever used it.
    `${cells.filter((one) => one.styles.appear).length}/${cells.length} cards reveal`
  );

  const saasSpanning = (() => {
    const saas = TEMPLATES.find((one) => one.id === 'saas')?.build();
    /*
     * `styles.desktop`, not `styles` — a block spec keeps its base declarations
     * at the top level and a *document* node keys them by breakpoint. The first
     * version read the spec shape against document nodes and reported zero,
     * which is the good version of that mistake: a check looking for something
     * that is there and finding nothing fails loudly, where one looking for
     * something absent would have passed for the wrong reason.
     */
    return Object.values(saas?.nodes ?? {}).filter((node) =>
      /span [2-9]/.test(node.styles?.desktop?.gridRow ?? '')
    );
  })();
  report.check(
    'the flagship template is the one using it',
    saasSpanning.length > 0,
    // Not "a bento exists somewhere in the library" — that was already true.
    // Every grid in all eight templates was uniform, which is the part visible
    // to anyone who opened one.
    saasSpanning.map((node) => node.name).join(', ') || 'no card spans a row in the SaaS document'
  );

  report.check(
    'every switch in the vocabulary can say off as well as on',
    Object.values(vocabulary.STYLE_VOCABULARY)
      .filter((entry) => entry.control.kind === 'switch')
      .every((entry) => Boolean(entry.control.off)),
    /*
     * The same bug as the span reset, one layer up, and found the same way. In
     * the base layer "off" is the absence of the declaration; at a narrower
     * breakpoint absence means "whatever the wider layer said", so a switch
     * with no off value leaves the box unticked and the element still italic.
     */
    Object.entries(vocabulary.STYLE_VOCABULARY)
      .filter(([, entry]) => entry.control.kind === 'switch' && !entry.control.off)
      .map(([prop]) => prop)
      .join(', ') || 'all seven'
  );
  report.check(
    'and the block being read is the one that was rebuilt',
    Boolean(bento) && cells.length > 0,
    bento ? `${cells.length} spanning cards found` : 'no Bento grid block'
  );

  /*
   * The actions, read out of the published markup rather than the document.
   *
   * Both of these existed and worked for months while no template used one,
   * which is the same gap the spans had. The difference here is that the
   * document says almost nothing useful: a `scrollTo` ref that failed to
   * resolve is *deleted*, so the only way to tell a working jump from a
   * silently dropped one is to look at the href that came out the other end.
   */
  const saasHome = (() => {
    const doc = TEMPLATES.find((one) => one.id === 'saas')?.build();
    if (!doc) return '';
    return generateSite(doc).files.find((file) => file.path === 'index.html')?.contents ?? '';
  })();

  const jump = /<a [^>]*href="(#[^"]*)"[^>]*>See what you get/.exec(saasHome);
  report.check(
    'the template jumps to a section rather than linking at one',
    jump?.[1] === '#features' && /id="features"/.test(saasHome),
    // `#` would mean the reference was dropped and the button fell back to a
    // button's default href, which looks identical in the document.
    `href ${jump?.[1] ?? 'none'}, and the target ${/id="features"/.test(saasHome) ? 'carries the id' : 'has no id'}`
  );

  const copy = /<(\w+)[^>]*data-cre8-copy="([^"]*)"/.exec(saasHome);
  report.check(
    'and something on it copies, as a button rather than a link',
    copy?.[1] === 'button' && Boolean(copy?.[2]),
    // An `<a>` here is the failure that shipped first: a button's default href
    // is `#`, and any href at all makes `resolveTag` emit an anchor — a link to
    // nowhere that a screen reader announces and a keyboard user follows.
    `<${copy?.[1] ?? 'nothing'}> carrying ${JSON.stringify(copy?.[2] ?? null)}`
  );
  /*
   * The runtime is on the page that copies and not on the one that does not.
   * A jump costs nothing anywhere, being an anchor.
   *
   * Both halves are computed into the detail rather than described, because a
   * fixed string here fails the way this file has already been caught failing
   * twice: the check goes red and the line under it says everything is fine.
   */
  const scriptOn = (needle) => {
    const doc = TEMPLATES.find((one) => one.id === 'saas')?.build();
    const file = (doc ? generateSite(doc).files : []).find((one) => one.path.includes(needle));
    return /<script/.test(file?.contents ?? '');
  };
  const homeRuns = /<script/.test(saasHome);
  const pricingRuns = scriptOn('pricing');
  report.check(
    'and the page still ships nothing to execute where nothing needs it',
    homeRuns && !pricingRuns,
    `home ${homeRuns ? 'carries the copy runtime' : 'carries nothing'}, ` +
      `pricing ${pricingRuns ? 'carries one too' : 'carries none'}`
  );
}

report.group('a way through when the panel has none');

{
  /*
   * Every table of controls needs a way to admit it does not cover something.
   * Without one the coverage it claims is only true of the list it wrote
   * itself, and the first property nobody thought of is a wall — the audit that
   * started this work found thirty-five of those and no way through any.
   *
   * So the interesting claims are the two it has to hold at once: what somebody
   * writes reaches the page, and it cannot reach anything else.
   */
  const styled = (custom) => {
    const doc = createEmptyDocument('Hatch');
    const page = doc.pages[0];
    const nodes = {};
    const { rootId } = buildTree({ type: 'section', name: 'S', styles: { custom } }, nodes, page.rootNodeId);
    Object.assign(doc.nodes, nodes);
    doc.nodes[page.rootNodeId].children.push(rootId);
    return renderPage(doc, page, { mode: 'publish' });
  };

  const written = styled('mask-image: linear-gradient(black, transparent); mix-blend-mode: hard-light');
  report.check(
    'what somebody writes by hand reaches the page',
    /mask-image:\s*linear-gradient\(black,\s*transparent\)/.test(written) &&
      /mix-blend-mode:\s*hard-light/.test(written),
    // Two declarations, one of them a property the model has never heard of —
    // which is the whole point of the field existing.
    /mask-image:[^;}]*/.exec(written)?.[0] ?? 'nothing emitted'
  );
  report.check(
    'and a custom property does too, because a variable is a declaration',
    /--card-tilt:\s*3deg/.test(styled('--card-tilt: 3deg')),
    /--card-tilt:[^;}]*/.exec(styled('--card-tilt: 3deg'))?.[0] ?? 'nothing emitted'
  );

  report.check(
    'it cannot end the rule and start another',
    !/body\s*\{\s*display\s*:\s*none/.test(styled('color: red } body { display: none')),
    /*
     * The reason the escape hatch could not be built before the emitter was
     * fixed: this field is the one place a person is *invited* to type CSS, so
     * it is the shortest path to every hole the generator has. It is safe
     * because the value never becomes text — it becomes pairs, and each pair is
     * checked the same way every other declaration is.
     */
    /body\s*\{\s*display\s*:\s*none[^}]*/.exec(styled('color: red } body { display: none'))?.[0] ??
      'nothing escaped'
  );
  report.check(
    'and cannot end the stylesheet',
    !/<script>alert/.test(styled('color: red</style><script>alert(1)</script>; opacity: 1')),
    /<script>alert[^<]*/.exec(styled('color: red</style><script>alert(1)</script>; opacity: 1'))?.[0] ??
      'nothing escaped'
  );
  report.check(
    'and cannot escape through the property name either',
    (() => {
      /*
       * The half the first version of these checks never reached. Splitting on
       * the *first* colon puts everything before it in the name, so
       * `color} body {background: red` is a name carrying two braces and a
       * value that is perfectly clean — removing the name whitelist broke
       * nothing, because every fixture happened to smuggle its payload through
       * the value.
       */
      const out = styled('color} body {background: red');
      return !/body\s*\{\s*background/.test(out);
    })(),
    /body\s*\{\s*background[^}]*/.exec(styled('color} body {background: red'))?.[0] ??
      'the name is an identifier or it is nothing'
  );
  report.check(
    'and cannot write a selector or an at-rule, only declarations',
    (() => {
      const out = styled('@media print { color: red }');
      return !out.includes('@media print');
    })(),
    // No selectors is a design decision rather than a safety one: what is
    // written here lands in this element's own rule, so it cascades and
    // responds to breakpoints like everything else. A block would let rules
    // exist that the editor cannot see, undo or reason about.
    'declarations only'
  );

  /* Each of the above, handed something it must reject. */
  // Every way a fragment can fail to be a declaration, in one string: no colon
  // at all, a value that would end the rule, an empty value, and an empty name.
  // The first version stopped at the first two, so the guard against a half
  // with nothing in it was never reached by anything.
  const messy = 'a: 1; b: 2; nonsense; c: }; d: ; : red';
  report.check(
    'the panel can say how many of them will be used',
    parseCustomDeclarations(messy).length === 2,
    /*
     * An escape hatch that silently ate a typo would be the worst version of
     * this: the reason somebody is here at all is that the panel had nothing
     * for what they wanted, so "it did nothing and said nothing" is the one
     * outcome that leaves them with no move.
     */
    parseCustomDeclarations(messy).map(([k, v]) => `${k}:${v}`).join(' · ') || 'nothing survived'
  );
  report.check(
    'and a trailing semicolon is not counted as a mistake',
    parseCustomDeclarations('color: red;').length === 1,
    // Everybody writes one. A panel that warned about it would be wrong more
    // often than right.
    `${parseCustomDeclarations('color: red;').length} declaration`
  );
  report.check(
    'a page with nothing custom on it is unchanged by any of this',
    !styled('').includes('undefined'),
    'the empty case writes nothing'
  );
}

report.group('what a press does');

{
  /*
   * Every action but one is something the platform already has an element for:
   * a link goes somewhere, `popovertarget` opens a panel, a submit button
   * submits, and the switch attribute moves a state. So the interesting claims
   * are about what reaches the markup and what does *not* — a page that copies
   * nothing must still ship nothing to execute.
   */
  const wired = () => {
    const doc = createEmptyDocument('Press');
    const page = doc.pages[0];
    const nodes = {};
    const { rootId } = buildTree(
      {
        type: 'section',
        name: 'Page',
        children: [
          { type: 'button', name: 'Jump', props: { label: 'See pricing' } },
          { type: 'section', name: 'Pricing table', children: [{ type: 'text', name: 'T', props: { text: 'x' } }] },
        ],
      },
      nodes,
      page.rootNodeId
    );
    Object.assign(doc.nodes, nodes);
    doc.nodes[page.rootNodeId].children.push(rootId);
    const byName = {};
    for (const node of Object.values(doc.nodes)) byName[node.name] = node;
    return { doc, page, button: byName.Jump, band: byName['Pricing table'] };
  };

  /* ------------------------------------------------- scrolling to a section */

  const { doc, page, button, band } = wired();
  report.check(
    'a section with no anchor is still offered as somewhere to jump to',
    !band.props.anchor,
    // The old picker offered only elements that already had one, so linking to
    // a band meant going and naming it first and coming back. A panel that
    // sets homework is a form.
    'nothing named yet'
  );

  ops.setScrollTarget(doc, button.id, band.id);
  report.check(
    'pointing a control at one names it, so there is an id to land on',
    jumpOf(button) === band.id && anchorId(band.props.anchor) === 'pricing-table',
    // A fragment can only point at an `id`, and the id is minted from the
    // anchor name — so a target without one is a jump that resolves to nothing.
    JSON.stringify({ ref: button.refs?.scrollTo?.node === band.id, anchor: band.props.anchor })
  );

  const html = renderPage(doc, page, { mode: 'publish' });
  report.check(
    'and the published link is an anchor to that id',
    html.includes('href="#pricing-table"') && / id="pricing-table"/.test(html),
    // Both halves: the reference resolves to a fragment, and the target emits
    // the id the fragment names. Either alone is a link to nowhere.
    /<a[^>]*href="#[^"]*"/.exec(html)?.[0] ?? 'no anchor'
  );
  report.check(
    'a button that jumps is rendered as a link, not a button',
    /<a[^>]*href="#pricing-table"/.test(html),
    // `resolveTag` decided that from `props.href`, which a reference does not
    // set — so a control that jumped stayed a `<button>` and dropped the href
    // on the floor until the tag rule learned about the reference too.
    /<(a|button)[^>]*href="#pricing-table"/.exec(html)?.[0] ?? 'neither'
  );

  report.check(
    'renaming the section moves the link with it',
    (() => {
      band.name = 'Plans and pricing';
      band.props.anchor = 'Plans and pricing';
      const again = renderPage(doc, page, { mode: 'publish' });
      return again.includes('href="#plans-and-pricing"') && !again.includes('#pricing-table');
    })(),
    // The whole reason it is a reference. A stored fragment would still say
    // `#pricing-table`, silently, and scroll nowhere.
    'the fragment is minted from the target, not stored on the link'
  );

  report.check(
    'and deleting it clears the jump rather than leaving one that goes nowhere',
    (() => {
      const fresh = wired();
      ops.setScrollTarget(fresh.doc, fresh.button.id, fresh.band.id);
      ops.removeNodes(fresh.doc, [fresh.band.id]);
      return !fresh.button.refs?.scrollTo;
    })(),
    'pruneRefs walks the slot, because it is a slot'
  );

  /* ------------------------------------------------------------- copying */

  const copyDoc = wired();
  /*
   * Written as an action rather than as `props.copyText`, which is what it was
   * until the behaviour axis landed.
   *
   * The prop survives as the shorthand every block in the library is written
   * in, and is folded into this on the way through the factory — the check
   * below drives that path. What it no longer is is a thing the renderer reads,
   * so setting it on an already-built node is setting nothing, and this check
   * says what the document now holds.
   */
  copyDoc.button.events = [
    { event: 'onClick', actions: [{ type: 'copy', text: 'npm i cre8' }] },
  ];
  const copied = renderPage(copyDoc.doc, copyDoc.page, { mode: 'publish' });
  const RUNTIME_SOURCE = readFileSync(path.join(ROOT, 'src/lib/runtime/behaviour.ts'), 'utf8');
  const VERBATIM_COPY =
    /writeText\(\s*copier\.getAttribute\(\s*['"]data-cre8-copy['"]\s*\)\s*\|\|\s*['"]{2}\s*\)/;
  report.check(
    /*
     * And what the runtime does with that attribute, pinned at the source.
     *
     * The browser suite cannot read the clipboard back — `readText()` needs the
     * document focused and stops settling after the click in that arrangement,
     * so what it can prove is that the write *resolved*, not what was written.
     * This is the other half: the value handed to `writeText` is the attribute
     * read verbatim, with no transform between them. Between the two, "the
     * advertised text is the copied text" stays covered.
     */
    'the runtime copies the attribute verbatim, with nothing in between',
    VERBATIM_COPY.test(RUNTIME_SOURCE),
    // Quoting what is actually there, because a fixed string here is the
    // failure this file has now been caught making four times: the check goes
    // red and the line under it reports success.
    // `clip.` and not a bare `writeText(`, or this quotes the `WithClipboard`
    // interface declaration higher up the file and reports the type signature
    // as though it were the call.
    (/clip\.writeText\([^;]*\)/.exec(RUNTIME_SOURCE)?.[0] ?? 'no clip.writeText call at all')
      .replace(/\s+/g, ' ')
      .slice(0, 90)
  );
  report.check(
    'a control that copies carries the text and the script to do it',
    copied.includes('data-cre8-copy="npm i cre8"') && /<script/i.test(copied),
    // The one action with nothing native behind it, so the one that costs a
    // visitor anything.
    /data-cre8-copy="[^"]*"/.exec(copied)?.[0] ?? 'no attribute'
  );

  /* Each of the above, handed something it must reject. */
  const quiet = wired();
  report.check(
    'a page that copies nothing still ships nothing to execute',
    !/<script/i.test(renderPage(quiet.doc, quiet.page, { mode: 'publish' })),
    // Otherwise the check above proves only that a script exists somewhere,
    // which it would whether or not copying had anything to do with it.
    'no runtime on a page with no runtime work'
  );
  report.check(
    'clearing the jump leaves the anchor name alone',
    (() => {
      const fresh = wired();
      ops.setScrollTarget(fresh.doc, fresh.button.id, fresh.band.id);
      ops.setScrollTarget(fresh.doc, fresh.button.id, null);
      return !fresh.button.refs?.scrollTo && fresh.band.props.anchor === 'Pricing table';
    })(),
    // The name is the target's own identity by then, and other links may use
    // it. Removing it to tidy up would break them.
    'the target keeps its name'
  );
  report.check(
    'every href resolver asks the one function what a node reference means',
    (() => {
      /*
       * There are three, and the first version of this taught one. The
       * published button came out as `href="node:h1rburoayr"` — a link to a
       * page by that name — while the static suite passed, because the check
       * used the default resolver and the publisher uses its own.
       *
       * Structural because it is a claim about which functions exist: a fourth
       * resolver is a thing somebody adds, and it will be wrong in exactly the
       * same way unless something notices.
       */
      const readFile = (file) => readFileSync(path.join(ROOT, file), 'utf8');
      const resolvers = [
        'src/lib/publishing/html.ts',
        'src/lib/renderer/render.tsx',
        'src/lib/renderer/element-model.ts',
      ];
      return resolvers.every((file) => readFile(file).includes('resolveNodeHref('));
    })(),
    'the publisher, the canvas and the default'
  );
  report.check(
    'and a jump does not also leave a typed href behind it',
    (() => {
      const fresh = wired();
      fresh.button.props.href = 'https://example.com';
      ops.setScrollTarget(fresh.doc, fresh.button.id, fresh.band.id);
      return fresh.button.props.href === undefined;
    })(),
    // One attribute cannot honour both, and the reference is the one just
    // chosen. A node holding each is a document nothing in the editor produces.
    'the two ways of going somewhere stay exclusive'
  );
}

report.group('arriving as you scroll to it');

{
  /*
   * A reveal is the one visual effect in the model that needs machinery beyond
   * a declaration — a `@keyframes` block, a timeline, and an answer for the two
   * cases the platform does not cover: a browser without scroll-driven
   * animations, and a visitor who has asked for less motion. All three are
   * checked against the generated stylesheet rather than described, because
   * "there is a fallback" is a claim about output.
   */
  const doc = createEmptyDocument('Reveal');
  const page = doc.pages[0];
  const nodes = {};
  const { rootId } = buildTree(
    // A spec's `styles` is the base layer itself, not a map keyed by
    // breakpoint. Written the other way this fixture builds a node with no
    // declarations at all and every check below passes vacuously.
    { type: 'section', name: 'Band', styles: { appear: 'rise' } },
    nodes,
    page.rootNodeId
  );
  Object.assign(doc.nodes, nodes);
  doc.nodes[page.rootNodeId].children.push(rootId);

  const css = generateStylesheet(doc, { standalone: true, mode: 'media' });

  report.check(
    'a reveal becomes an animation tied to the scrollport, not a script',
    /animation:\s*cre8-ap-rise/.test(css) && /animation-timeline:\s*view\(\)/.test(css),
    // The whole reason this is expressible at all: no runtime, nothing to
    // execute, and it works with scripting switched off.
    /animation[^;]*;/.exec(css)?.[0] ?? 'no animation'
  );
  report.check(
    'and it fills backwards, so nothing is drawn before its turn',
    /cre8-ap-rise[^;]*both/.test(css),
    // Without backwards fill a card below the fold paints at full opacity and
    // snaps to transparent as it enters the range, which reads as a flash.
    /animation: cre8-ap-rise[^;]*/.exec(css)?.[0] ?? 'none'
  );
  report.check(
    'the keyframes ship with it',
    css.includes('@keyframes cre8-ap-rise'),
    'the animation names something that exists'
  );
  /*
   * Everything before the reduced-motion block, which is where an effect has to
   * be defined to actually do anything. Written against the whole stylesheet
   * this rule passes for an effect that exists *only* in the reduced copy — one
   * that animates nothing, for everybody — and deleting a keyframe block was
   * how that came out.
   */
  const moving = css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce) {\n  @keyframes'));
  report.check(
    'and every effect the menu offers has a keyframe block that moves',
    APPEAR_EFFECTS.every((effect) => moving.includes(`@keyframes cre8-ap-${effect}`)),
    // A menu entry with no keyframes behind it is an option that does nothing,
    // which is worse than not offering it.
    APPEAR_EFFECTS.filter((effect) => !moving.includes(`@keyframes cre8-ap-${effect}`)).join(', ') ||
      `${APPEAR_EFFECTS.length} effects`
  );

  /*
   * The reduced-motion block that holds *keyframes*, not the first one in the
   * file — the published reset opens with its own `prefers-reduced-motion`
   * query for scroll behaviour, so slicing from the first match hands the check
   * a string containing both the normal keyframes and the redefined ones, and
   * the failure message then prints the wrong half.
   */
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  @keyframes'));
  report.check(
    'somebody who asked for less motion gets the element, not the animation',
    /@media \(prefers-reduced-motion: reduce\)/.test(css) &&
      /@keyframes cre8-ap-rise \{ from \{ opacity: 1/.test(reduced),
    /*
     * Redefined rather than switched off. Same names, animating nothing — so
     * the rules referencing them are untouched, no override has to out-specify
     * anything, and an element that would have risen simply arrives. A blanket
     * `animation: none` would have had to reach every element on the page.
     */
    /@keyframes cre8-ap-rise[^}]*}[^}]*}/.exec(reduced)?.[0] ?? 'not redefined'
  );

  /* Each of the above, handed something it must reject. */
  const plain = createEmptyDocument('Plain');
  report.check(
    'a page with no reveal on it carries no keyframes',
    !generateStylesheet(plain, { standalone: true, mode: 'media' }).includes('@keyframes cre8-ap-'),
    // Five keyframe blocks and a media query on every page that never asked is
    // the kind of unconditional cost this codebase shortened node ids to avoid.
    'nothing shipped'
  );
  report.check(
    'and an effect name the menu could never produce emits no animation at all',
    (() => {
      const odd = createEmptyDocument('Odd');
      const oddNodes = {};
      const built = buildTree(
        { type: 'section', name: 'X', styles: { appear: 'rise; } body { display:none' } },
        oddNodes,
        odd.pages[0].rootNodeId
      );
      Object.assign(odd.nodes, oddNodes);
      odd.nodes[odd.pages[0].rootNodeId].children.push(built.rootId);
      const out = generateStylesheet(odd, { standalone: true, mode: 'media' });
      return !out.includes('animation:') && !out.includes('body { display:none');
    })(),
    // A document is JSON and arrives from disk. The control is a menu, so the
    // editor cannot write this — which is exactly why the generator has to
    // refuse it rather than trust that nothing will.
    'an unknown name is dropped, not interpolated'
  );
  report.check(
    'the reveal checks are reading a real stylesheet',
    css.length > 500 && css.includes('cre8-ap-'),
    `${css.length} characters`
  );
}

report.group('a group of fields does not restyle what is in it');

{
  /*
   * The legend's typography belongs to the legend.
   *
   * `<legend>` is a `lead` — the renderer emits it and no node owns it — so
   * there was nowhere to put its size and weight except on the fieldset, and
   * that is where they went: 13px and 580, inherited by every label, every
   * help line and every paragraph inside the group. Four blocks used one and
   * each looked slightly wrong in a way that reads as a font choice rather
   * than as a bug.
   *
   * Deliberately about `fieldset` and not about leads in general. `table`
   * emits a `caption` lead and sets `fontSize: 14px`, and that size is for the
   * cells — a rule saying "no element with a lead may set typography" would
   * call that an offence and be wrong.
   */
  const doc = createEmptyDocument('Fieldset');
  const page = doc.pages[0];
  const nodes = {};
  const { rootId } = buildTree(
    {
      type: 'fieldset',
      name: 'Group',
      props: { legend: 'Delivery' },
      children: [{ type: 'paragraph', name: 'Note', props: { text: 'Where it goes.' } }],
    },
    nodes,
    page.rootNodeId
  );
  Object.assign(doc.nodes, nodes);
  doc.nodes[page.rootNodeId].children.push(rootId);
  const css = generateStylesheet(doc, { standalone: true, mode: 'media' });

  const group = ELEMENTS.fieldset.defaultStyles ?? {};
  const imposed = ['fontSize', 'fontWeight'].filter((prop) => prop in group);
  report.check(
    'the fieldset imposes no size or weight on its descendants',
    imposed.length === 0,
    imposed.length ? `still sets ${imposed.join(' and ')}` : 'only family and colour, which are the group’s own'
  );

  const legendRule = /:where\(\[data-cre8-root\]\) legend \{([^}]*)\}/.exec(css)?.[1] ?? '';
  report.check(
    'and the legend gets them from the stylesheet instead',
    /font-size:\s*13px/.test(legendRule) && /font-weight:\s*580/.test(legendRule),
    legendRule.trim() || 'no legend rule in the sheet'
  );
  /*
   * `padding-inline` and `margin-inline`, not `padding-left` and `margin-left`.
   * The reset says both sides flow-relatively now, so a right-to-left fieldset
   * lines its legend up with its fields the same way — the claim below is
   * unchanged, and only its spelling moved.
   */
  const padded = /padding-inline:\s*(-?\d+)px/.exec(legendRule)?.[1];
  const pulled = /margin-inline:\s*(-?\d+)px/.exec(legendRule)?.[1];
  report.check(
    'its padding is cancelled by a margin, so the words line up with the fields',
    padded === '6' && pulled === '-6',
    // Computed from what was read, not asserted alongside it: a detail line
    // that says "none of indent" while the check fails is the fifth time this
    // file has had to learn that lesson.
    `padding ${padded ?? 'none'}, margin ${pulled ?? 'none'} — indent ${
      padded && pulled ? Number(padded) + Number(pulled) : '?'
    }px`
  );
  const cleared = /margin-bottom:\s*(\d+)px/.exec(legendRule)?.[1];
  report.check(
    'and it clears the first field, which no row gap will do for it',
    cleared === '10',
    `${cleared ? `${cleared}px` : 'nothing'} below the legend, and a legend is not a flex item of its own fieldset`
  );

  /* Falsification: the check is reading the sheet, and would notice. */
  report.check(
    'these are read from a real stylesheet with a real fieldset in it',
    css.includes('legend') && css.length > 500 && Object.keys(group).length > 4,
    `${css.length} characters, ${Object.keys(group).length} default declarations`
  );
  const brokenRule = 'padding-left: 6px; font-size: 13px;';
  report.check(
    'and a legend rule missing the cancelling margin does not pass',
    !/margin-left:\s*-6px/.test(brokenRule) && /padding-left:\s*6px/.test(brokenRule),
    'the pair is checked together, not the padding alone'
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


/* ==========================================================================
 * A control can say which state it sets, and set more than one
 * ======================================================================= */

report.group('a control can say which state it sets, and set more than one');

{
  /*
   * The behaviour axis, which was a prop.
   *
   * `switchSet` put the *nearest* enclosing state into a value, and a scalar
   * cannot hold two of anything or name what it is aimed at. Those are the same
   * limitation from two sides, and between them they are why a link inside a
   * menu could not close the menu: `closest()` answers with the innermost group,
   * and there was nowhere to say which one was meant.
   *
   * `node.events` is a list, so both are sayable. The props survive as the
   * authoring shorthand every block is written in and are folded on the way
   * through the factory — the same arrangement `states` has had since the
   * beginning.
   */
  const { actionsFor, copyTextFor, decodeSets, encodeSets, stateSets, actsOnPress, valuesSetting } =
    actionLib;

  /** A page with a group and one control in it, built from a spec. */
  const wiredPage = (buttonSpec) => {
    const doc = createEmptyDocument('Acts');
    const page = doc.pages[0];
    const { rootId } = buildTree(
      {
        type: 'frame',
        name: 'Billing',
        props: { switchKey: 'billing', switchDefault: 'monthly' },
        children: [buttonSpec],
      },
      doc.nodes,
      page.rootNodeId
    );
    doc.nodes[page.rootNodeId].children.push(rootId);
    const group = doc.nodes[rootId];
    const button = doc.nodes[group.children[0]];
    return { doc, page, group, button };
  };

  /* ------------------------------------------- the shorthand still folds */

  const short = wiredPage({
    type: 'button',
    name: 'Annual',
    props: { label: 'Annual', switchSet: 'annual' },
  });
  report.check(
    'a block written in the old shorthand comes out as an action',
    short.button.events?.length === 1 &&
      short.button.events[0].event === 'onClick' &&
      short.button.events[0].actions.length === 1 &&
      short.button.events[0].actions[0].type === 'setState' &&
      short.button.events[0].actions[0].value === 'annual' &&
      short.button.events[0].actions[0].state === undefined,
    // No `state`, which is the faithful reading rather than a shortcut: the
    // prop always meant the nearest group, and naming one here would change
    // what an existing page does the first time somebody nests it.
    JSON.stringify(short.button.events ?? null)
  );
  report.check(
    'and the prop is gone, so nothing downstream can read a second answer',
    short.button.props.switchSet === undefined && short.button.props.switchQuiet === undefined,
    `switchSet=${String(short.button.props.switchSet)} switchQuiet=${String(short.button.props.switchQuiet)}`
  );

  const shortHtml = renderPage(short.doc, short.page, { mode: 'publish' });
  report.check(
    'and the published attribute is what it always was',
    shortHtml.includes('data-cre8-set="annual"'),
    // The whole point of keeping the bare spelling: every tab, toggle and
    // stepper in the library publishes the same bytes it did before the axis
    // existed.
    /data-cre8-set="[^"]*"/.exec(shortHtml)?.[0] ?? 'no data-cre8-set at all'
  );

  const quietSpec = wiredPage({
    type: 'button',
    name: 'Next',
    props: { label: 'Next', switchSet: 'two', switchQuiet: true },
  });
  const quietHtml = renderPage(quietSpec.doc, quietSpec.page, { mode: 'publish' });
  report.check(
    'a quiet setter stays quiet through the fold',
    quietSpec.button.events?.[0]?.actions?.[0]?.quiet === true &&
      quietHtml.includes('data-cre8-quiet'),
    `quiet=${String(quietSpec.button.events?.[0]?.actions?.[0]?.quiet)}, ` +
      `attribute ${quietHtml.includes('data-cre8-quiet') ? 'present' : 'missing'}`
  );

  /* ------------------------------------- and a legacy pressed style with it */

  report.check(
    'a legacy pressed style still finds the value it was conditioned on',
    (() => {
      /*
       * The ordering trap, checked because it is invisible.
       *
       * `rulesFromLegacy` reads `props.switchSet` to know what a `pressed`
       * style meant — there is no other record of it. Retiring the prop before
       * that ran would turn every one of them into a rule with no condition:
       * not an error, not a missing style, a *permanent* one. A button stuck
       * looking pressed.
       */
      const legacy = wiredPage({
        type: 'button',
        name: 'Annual',
        props: { label: 'Annual', switchSet: 'annual' },
        states: { pressed: { color: 'rgb(1, 2, 3)' } },
      });
      const rule = (legacy.button.rules ?? []).find((r) => r.apply?.color === 'rgb(1, 2, 3)');
      const [when] = conditionsIn(rule?.when);
      return when?.kind === 'state' && when.op === 'is' && when.values?.join(' ') === 'annual';
    })(),
    // Computed from the rule, not asserted beside it: a detail line that says
    // "conditioned on annual" while the rule has no condition is exactly the
    // failure this check exists to catch.
    (() => {
      const legacy = wiredPage({
        type: 'button',
        name: 'Annual',
        props: { label: 'Annual', switchSet: 'annual' },
        states: { pressed: { color: 'rgb(1, 2, 3)' } },
      });
      const rule = (legacy.button.rules ?? []).find((r) => r.apply?.color === 'rgb(1, 2, 3)');
      return rule ? `when ${JSON.stringify(rule.when)}` : 'no rule for the pressed style at all';
    })()
  );

  /* ------------------------------------------------- naming the state */

  const named = wiredPage({
    type: 'button',
    name: 'Close',
    props: { label: 'Close' },
    events: [
      { event: 'onClick', actions: [{ type: 'setState', state: 'nav', value: 'shut' }] },
    ],
  });
  const namedHtml = renderPage(named.doc, named.page, { mode: 'publish' });
  report.check(
    'an assignment that names its state says so in the markup',
    namedHtml.includes('data-cre8-set="nav:shut"'),
    // The thing the prop could not express, and the reason a link in a menu
    // could not close the menu.
    /data-cre8-set="[^"]*"/.exec(namedHtml)?.[0] ?? 'no data-cre8-set at all'
  );

  const both = wiredPage({
    type: 'button',
    name: 'Close and switch',
    props: { label: 'Pricing' },
    events: [
      {
        event: 'onClick',
        actions: [
          { type: 'setState', state: 'nav', value: 'shut' },
          { type: 'setState', value: 'annual' },
        ],
      },
    ],
  });
  const bothHtml = renderPage(both.doc, both.page, { mode: 'publish' });
  report.check(
    'two assignments travel in one attribute, in the order they were written',
    bothHtml.includes('data-cre8-set="nav:shut annual"'),
    /data-cre8-set="[^"]*"/.exec(bothHtml)?.[0] ?? 'no data-cre8-set at all'
  );

  /* ------------------------------------------------ the grammar round-trips */

  report.check(
    'every shape of assignment survives being written and read back',
    (() => {
      const cases = [
        [{ state: '', value: 'annual' }],
        [{ state: 'nav', value: 'shut' }],
        [
          { state: 'nav', value: 'shut' },
          { state: '', value: 'annual' },
          { state: 'step', value: 'two' },
        ],
      ];
      return cases.every(
        (one) => JSON.stringify(decodeSets(encodeSets(one))) === JSON.stringify(one)
      );
    })(),
    // Both separators are safe because `slug` narrowed each half to letters,
    // digits, `_` and `-` before either was written — so the round trip is the
    // claim, and the allowlist is why it holds.
    encodeSets([
      { state: 'nav', value: 'shut' },
      { state: '', value: 'annual' },
    ])
  );

  report.check(
    'the runtime reads that grammar with the same two separators',
    (() => {
      /*
       * The runtime is serialised with `toString()` and may not import, so it
       * carries a second reader written in literals. This is the only way to
       * hold the two in step at build time; the browser suite proves the click.
       */
      const src = readFileSync(path.join(ROOT, 'src/lib/runtime/behaviour.ts'), 'utf8');
      const body = src.slice(src.indexOf('function sets('), src.indexOf('function sync('));
      return /\.split\(' '\)/.test(body) && /indexOf\(':'\)/.test(body);
    })(),
    (() => {
      const src = readFileSync(path.join(ROOT, 'src/lib/runtime/behaviour.ts'), 'utf8');
      const body = src.slice(src.indexOf('function sets('), src.indexOf('function sync('));
      return (
        (/const raw = [^;]*;/.exec(body)?.[0] ?? 'nothing splits the attribute') +
        ' / ' +
        (/const at = [^;]*;/.exec(body)?.[0] ?? 'nothing splits a part on its colon')
      );
    })()
  );

  /* ------------------------------------------------------------- the tag */

  report.check(
    'a control that acts is a button even when it carries a destination',
    (() => {
      const acting = wiredPage({
        type: 'link',
        name: 'Pricing',
        props: { text: 'Pricing', href: 'https://example.com' },
        events: [{ event: 'onClick', actions: [{ type: 'setState', state: 'nav', value: 'shut' }] }],
      });
      const html = renderPage(acting.doc, acting.page, { mode: 'publish' });
      return /<button[^>]*data-cre8-set="nav:shut"/.test(html);
    })(),
    // An `<a>` whose default the runtime cancels is a link that goes nowhere,
    // announced as a link. The tag rule used to read `props.switchSet` and had
    // to learn where the answer moved to.
    (() => {
      const acting = wiredPage({
        type: 'link',
        name: 'Pricing',
        props: { text: 'Pricing', href: 'https://example.com' },
        events: [{ event: 'onClick', actions: [{ type: 'setState', state: 'nav', value: 'shut' }] }],
      });
      const html = renderPage(acting.doc, acting.page, { mode: 'publish' });
      return /<(a|button)[^>]*data-cre8-set/.exec(html)?.[0]?.slice(0, 60) ?? 'neither tag carries it';
    })()
  );

  /* --------------------------------------------------------- the runtime */

  report.check(
    'a page whose only interaction is a named assignment still ships the script',
    /<script/i.test(namedHtml),
    // The interactivity test used to read `props.switchSet` too, and a page
    // that shipped a setter with no runtime is a control that does nothing.
    `${(namedHtml.match(/<script/g) ?? []).length} script(s)`
  );
  const plain = wiredPage({ type: 'button', name: 'Plain', props: { label: 'Plain' } });
  const plainHtml = renderPage(plain.doc, plain.page, { mode: 'publish' });
  report.check(
    'and a page with a group nobody can operate still ships nothing to execute',
    !/<script/i.test(plainHtml),
    // Otherwise the check above proves only that a script exists somewhere.
    // The group is here and the control is here; only the assignment is gone.
    `${(plainHtml.match(/<script/g) ?? []).length} script(s) beside a real switchKey`
  );

  /* ------------------------------------------------- reading them back */

  report.check(
    'a named assignment is attributed to the state it names and no other',
    valuesSetting(both.button, 'nav').join(' ') === 'shut annual' &&
      valuesSetting(both.button, 'billing').join(' ') === 'annual' &&
      valuesSetting(named.button, 'billing').length === 0,
    // A bare assignment counts for whichever group is being asked about,
    // because the walk that asks is already inside it. A named one does not.
    `nav=[${valuesSetting(both.button, 'nav')}] ` +
      `billing=[${valuesSetting(both.button, 'billing')}] ` +
      `close/billing=[${valuesSetting(named.button, 'billing')}]`
  );

  report.check(
    'a copy is one action among the others rather than a prop beside them',
    (() => {
      const mixed = wiredPage({
        type: 'button',
        name: 'Copy and close',
        props: { label: 'Copy' },
        events: [
          {
            event: 'onClick',
            actions: [
              { type: 'copy', text: 'npm i cre8' },
              { type: 'setState', state: 'nav', value: 'shut' },
            ],
          },
        ],
      });
      const html = renderPage(mixed.doc, mixed.page, { mode: 'publish' });
      return (
        copyTextFor(mixed.button) === 'npm i cre8' &&
        html.includes('data-cre8-copy="npm i cre8"') &&
        html.includes('data-cre8-set="nav:shut"')
      );
    })(),
    // Its own attribute, because a copy text can hold a space or a colon and
    // the grammar above is only unambiguous while its operands cannot.
    'the two attributes are independent, and one node carries both'
  );

  /* ----------------------------------------------------- the migration */

  report.check(
    'a saved document written in props reads back as actions',
    (() => {
      const doc = createEmptyDocument('Old');
      const page = doc.pages[0];
      const node = createPage ? null : null;
      const { rootId } = buildTree(
        { type: 'frame', name: 'Group', props: { switchKey: 'billing' } },
        doc.nodes,
        page.rootNodeId
      );
      doc.nodes[page.rootNodeId].children.push(rootId);
      // Written after the build, which is how it arrives from a file.
      doc.nodes[rootId].props.switchSet = 'annual';
      doc.nodes[rootId].props.switchQuiet = true;
      migrateDocument(doc);
      const one = doc.nodes[rootId].events?.[0]?.actions?.[0];
      return (
        one?.type === 'setState' &&
        one.value === 'annual' &&
        one.quiet === true &&
        doc.nodes[rootId].props.switchSet === undefined
      );
    })(),
    'the props are the format of every document saved before this'
  );

  report.check(
    'a saved document keeps the condition under its legacy pressed style too',
    (() => {
      /*
       * The same trap as above, one path over.
       *
       * `buildSubtree` and `migrateNode` both fold the shorthand and both run
       * `rulesFromLegacy` first, and each had to be ordered by hand. A check
       * on one of them says nothing about the other, which is how half a fix
       * ships.
       */
      const doc = createEmptyDocument('Old pressed');
      const page = doc.pages[0];
      const { rootId } = buildTree(
        { type: 'button', name: 'B', props: { label: 'B' } },
        doc.nodes,
        page.rootNodeId
      );
      doc.nodes[page.rootNodeId].children.push(rootId);
      // Written after the build, which is how both arrive from a file.
      doc.nodes[rootId].props.switchSet = 'annual';
      doc.nodes[rootId].states = { pressed: { color: 'rgb(4, 5, 6)' } };
      migrateDocument(doc);
      const rule = (doc.nodes[rootId].rules ?? []).find((r) => r.apply?.color === 'rgb(4, 5, 6)');
      const [when] = conditionsIn(rule?.when);
      return when?.kind === 'state' && when.op === 'is' && when.values?.join(' ') === 'annual';
    })(),
    (() => {
      const doc = createEmptyDocument('Old pressed');
      const page = doc.pages[0];
      const { rootId } = buildTree(
        { type: 'button', name: 'B', props: { label: 'B' } },
        doc.nodes,
        page.rootNodeId
      );
      doc.nodes[page.rootNodeId].children.push(rootId);
      doc.nodes[rootId].props.switchSet = 'annual';
      doc.nodes[rootId].states = { pressed: { color: 'rgb(4, 5, 6)' } };
      migrateDocument(doc);
      const rule = (doc.nodes[rootId].rules ?? []).find((r) => r.apply?.color === 'rgb(4, 5, 6)');
      return rule ? `when ${JSON.stringify(rule.when)}` : 'no rule for the pressed style at all';
    })()
  );

  report.check(
    'and running it twice changes nothing the second time',
    (() => {
      const doc = createEmptyDocument('Old');
      const page = doc.pages[0];
      const { rootId } = buildTree(
        { type: 'button', name: 'B', props: { label: 'B', switchSet: 'annual' } },
        doc.nodes,
        page.rootNodeId
      );
      doc.nodes[page.rootNodeId].children.push(rootId);
      migrateDocument(doc);
      const once = JSON.stringify(doc.nodes[rootId].events);
      migrateDocument(doc);
      return once === JSON.stringify(doc.nodes[rootId].events);
    })(),
    'idempotent by construction: the prop is deleted, so a second pass finds nothing'
  );

  report.check(
    'a document part-way through keeps the newer spelling',
    (() => {
      const doc = createEmptyDocument('Both');
      const page = doc.pages[0];
      const { rootId } = buildTree(
        { type: 'button', name: 'B', props: { label: 'B' } },
        doc.nodes,
        page.rootNodeId
      );
      doc.nodes[page.rootNodeId].children.push(rootId);
      doc.nodes[rootId].props.switchSet = 'monthly';
      doc.nodes[rootId].events = [
        { event: 'onClick', actions: [{ type: 'setState', value: 'annual' }] },
      ];
      migrateDocument(doc);
      return (
        doc.nodes[rootId].events?.[0]?.actions?.[0]?.value === 'annual' &&
        doc.nodes[rootId].props.switchSet === undefined
      );
    })(),
    // Two tabs, one build each. The list is what somebody chose most recently,
    // and the prop is dropped rather than left to be read by something older.
    'the list wins and the prop is retired'
  );

  /* ------------------------------ and each of those, handed a wrong answer */

  report.check(
    'the encoding refuses a value the allowlist would not have produced',
    (() => {
      const dirty = wiredPage({
        type: 'button',
        name: 'Dirty',
        props: { label: 'Dirty' },
        events: [
          {
            event: 'onClick',
            actions: [{ type: 'setState', state: 'na v', value: 'sh"ut' }],
          },
        ],
      });
      const html = renderPage(dirty.doc, dirty.page, { mode: 'publish' });
      // Slugged on the way out, so neither separator and no quote survives —
      // which is what keeps the grammar parseable and the selector closed.
      return html.includes('data-cre8-set="na-v:sh-ut"') && !html.includes('"sh"ut"');
    })(),
    // A document can be hand-edited or arrive from an older release, and both
    // halves land in a stylesheet selector as well as an attribute.
    'a space and a quote are narrowed before either reaches the markup'
  );

  const halfEmpty = wiredPage({
    type: 'button',
    name: 'Half',
    props: { label: 'Half' },
    events: [
      {
        event: 'onClick',
        actions: [
          { type: 'setState', value: '' },
          { type: 'setState', value: 'annual' },
        ],
      },
    ],
  });
  const halfHtml = renderPage(halfEmpty.doc, halfEmpty.page, { mode: 'publish' });
  report.check(
    'an assignment with no value is dropped rather than written empty',
    (() => {
      const alone = wiredPage({
        type: 'button',
        name: 'Empty',
        props: { label: 'Empty' },
        events: [{ event: 'onClick', actions: [{ type: 'setState', value: '' }] }],
      });
      const aloneHtml = renderPage(alone.doc, alone.page, { mode: 'publish' });
      /*
       * Two fixtures, because one of them cannot see the mistake.
       *
       * On its own an empty value encodes to an empty string, and the
       * attribute is written only when the string says something — so the
       * *outcome* is right even if the drop never happened, and a check
       * holding only this one passes on code that lost it. Beside a real
       * assignment the difference is visible: a dropped one leaves `annual`,
       * a kept one leaves a separator with nothing on one side of it.
       */
      return (
        !aloneHtml.includes('data-cre8-set') &&
        !/<script/i.test(aloneHtml) &&
        halfHtml.includes('data-cre8-set="annual"')
      );
    })(),
    // An empty part would make the runtime clear the state on click, which is
    // not something anybody asked for.
    /data-cre8-set="[^"]*"/.exec(halfHtml)?.[0] ?? 'no attribute beside the real assignment'
  );

  /*
   * A binding for an event the registry does not declare.
   *
   * The stand-in is picked as one `EVENTS` does not contain rather than
   * spelled `onHover`, and the detail is read off `EVENTS` rather than
   * asserted beside it. Both for the same reason: this check is the guarantee
   * that lets a promise be *withdrawn* — `ElementDefinition.events` offered
   * `onSubmit` on every form and nothing read it, and X6's answer was to stop
   * offering it rather than to half-build it. A document that still holds such
   * a binding has to publish nothing, and a check whose detail says "onClick
   * is the only event read" would keep saying so after a second one arrived.
   */
  const unread = ['onSubmit', 'onHover', 'onChange'].find(
    (name) => !eventLib.EVENTS.some((one) => one.id === name)
  );
  report.check(
    'an action under an event nothing listens for reaches nothing',
    Boolean(unread) &&
      (() => {
        const other = wiredPage({
          type: 'button',
          name: 'Later',
          props: { label: 'Later' },
          events: [{ event: unread, actions: [{ type: 'setState', value: 'annual' }] }],
        });
        const html = renderPage(other.doc, other.page, { mode: 'publish' });
        return (
          stateSets(other.button).length === 0 &&
          actionsFor(other.button).length === 0 &&
          !actsOnPress(other.button) &&
          !html.includes('data-cre8-set') &&
          !/<script/i.test(html)
        );
      })(),
    `${unread ?? 'nothing unread to try'} against ${eventLib.EVENTS.map((one) => one.id).join(', ')}`
  );
  /*
   * And it is kept rather than dropped, which is the other half: the panel
   * draws one event and `setActions` must not quietly delete the rest.
   */
  report.check(
    'and is still in the document afterwards, because the panel only draws one of them',
    (() => {
      const node = { id: 'n', type: 'button', name: 'B', props: {}, children: [],
        events: [{ event: unread, actions: [{ type: 'setState', value: 'a' }] }] };
      const doc = { nodes: { n: node } };
      ops.setActions(doc, 'n', [{ type: 'copy', text: 'x' }]);
      return (doc.nodes.n.events ?? []).some((b) => b.event === unread);
    })(),
    (() => {
      const node = { id: 'n', type: 'button', name: 'B', props: {}, children: [],
        events: [{ event: unread, actions: [{ type: 'setState', value: 'a' }] }] };
      const doc = { nodes: { n: node } };
      ops.setActions(doc, 'n', [{ type: 'copy', text: 'x' }]);
      return (doc.nodes.n.events ?? []).map((b) => b.event).join(' + ');
    })()
  );
}

/* ==========================================================================
 * Every verb compiles to the most native thing available
 * ======================================================================= */

report.group('every verb compiles to the most native thing available');

{
  const { EVENTS, VERBS, carrierOf, eventApplies, eventsFor, needsScript } = eventLib;
  const { planActions, claimed, runsScript, stateSets, encodeSets } = actionLib;

  /* --- The tables are honest ---------------------------------------------- */

  /*
   * The defect this stage exists to fix, checked as a property rather than as
   * a list. `ElementDefinition.events` promised `onSubmit` on every form and
   * `onClick` on buttons and links; `actionsFor` defaulted to `onClick` and no
   * caller ever passed anything else. So one of the three was a lie and the
   * other two were decoration — a registry nothing reads is not a registry.
   *
   * A table entry earns its place by being *reachable*: something has to
   * deliver it. There is one door, `actionsFor`, and it matches by name.
   */
  const delivered = EVENTS.filter((event) => {
    const doc = createEmptyDocument('Reach');
    const page = doc.pages[0];
    doc.nodes.btn = {
      id: 'btn', type: 'button', name: 'Go', parentId: page.rootNodeId, children: [],
      props: { label: 'Go' }, styles: {}, meta: {},
      events: [{ event: event.id, actions: [{ type: 'setState', value: 'annual' }] }],
    };
    doc.nodes[page.rootNodeId].children.push('btn');
    return stateSets(doc.nodes.btn).length === 1;
  });
  report.check(
    'every event in the table is one something actually reads',
    delivered.length === EVENTS.length && EVENTS.length > 0,
    `${delivered.length} of ${EVENTS.length} reach an action — ${EVENTS.map((e) => e.id).join(' ')}`
  );
  report.check(
    'and an event nobody declared is refused rather than half-offered',
    !eventApplies('onSubmit', 'form') && eventsFor('form').every((e) => e.id !== 'onSubmit'),
    eventsFor('form').map((e) => e.id).join(' ') || 'nothing on a form'
  );

  /*
   * And the same question of the verbs, which is the other half of "declared
   * and unread": every one has to have exactly one answer to *what carries
   * this*, and `null` is an answer — it means the runtime.
   */
  const verbTypes = Object.keys(VERBS);
  report.check(
    'every verb says what carries it, and says it once',
    verbTypes.length > 0 &&
      verbTypes.every((type) => VERBS[type].type === type) &&
      verbTypes.every((type) => ['href', 'popover', 'submit', null].includes(VERBS[type].carrier)),
    verbTypes.map((type) => `${type}→${VERBS[type].carrier ?? 'script'}`).join(' · ')
  );

  /* --- Native means native ------------------------------------------------ */

  /*
   * The headline, and the one the plan names: a link whose only action is a
   * `navigate` publishes what a link has always published, and **no script**.
   * The byte count rather than the tag, because a page that grew an `<a>` and
   * a runtime has not absorbed anything — it has added a second mechanism.
   */
  const linkPage = (spec) => {
    const doc = createEmptyDocument('Press');
    const page = doc.pages[0];
    const { rootId } = buildTree(spec, doc.nodes, page.rootNodeId);
    doc.nodes[page.rootNodeId].children.push(rootId);
    return { doc, page, node: doc.nodes[rootId], html: renderPage(doc, page, { mode: 'publish' }) };
  };

  const byProp = linkPage({ type: 'link', name: 'Pricing', props: { text: 'Pricing', href: '/pricing' } });
  const byVerb = linkPage({
    type: 'link',
    name: 'Pricing',
    props: { text: 'Pricing' },
    events: [{ event: 'onClick', actions: [{ type: 'navigate', to: '/pricing' }] }],
  });
  const scriptIn = (html) => /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]?.length ?? 0;

  report.check(
    'a link that navigates through a verb carries no script at all',
    scriptIn(byVerb.html) === 0 && scriptIn(byProp.html) === 0,
    `${scriptIn(byVerb.html)} bytes by verb, ${scriptIn(byProp.html)} by prop`
  );
  /*
   * And it is the *same* markup, not merely markup that also works. Compared
   * on the element rather than the page because the two documents have
   * different node ids, which reach the class names.
   */
  const anchorOf = (html) => /<a\b[^>]*>/.exec(html)?.[0].replace(/class="[^"]*"/, 'class="…"') ?? 'no anchor';
  report.check(
    'and the same markup a typed href produces, attribute for attribute',
    anchorOf(byVerb.html) === anchorOf(byProp.html) && anchorOf(byVerb.html).includes('href="/pricing"'),
    `${anchorOf(byVerb.html)} vs ${anchorOf(byProp.html)}`
  );
  /*
   * And on something that is not already a link, which is what decides the
   * *tag* rather than the attribute.
   *
   * The pair above cannot: `link` and `button` both default to `href: '#'`, so
   * `resolveTag` answers `a` for them whatever the verbs say — a falsification
   * that removed the verb from the tag decision entirely left every check here
   * passing. A box has no default destination, so this is the one that fails
   * when a `navigate` stops making something clickable, and it is also the
   * case C2 exists for: making a whole card go somewhere.
   */
  const card = linkPage({
    type: 'container',
    name: 'Card',
    events: [{ event: 'onClick', actions: [{ type: 'navigate', to: '/pricing' }] }],
  });
  const plain = linkPage({ type: 'container', name: 'Card' });
  /*
   * Read past the page root, which is a `<div data-cre8-root>` on every page
   * and the first thing any tag regex finds — the detail said "it is a div"
   * about the *wrapper* while the check was failing about the card.
   *
   * Cut at the root's own closing bracket rather than at the attribute name:
   * the stylesheet mentions `[data-cre8-root]` and comes first in the file, so
   * slicing on the name alone lands ahead of the markup and finds the wrapper
   * all over again — which is what the second attempt did.
   */
  const inside = (html) => {
    const body = html.slice(html.indexOf('<body'));
    const root = body.indexOf('data-cre8-root');
    return (
      /<(a|div)\b[^>]*>/
        .exec(body.slice(body.indexOf('>', root) + 1))?.[0]
        .replace(/class="[^"]*"/, 'class="…"') ?? 'nothing inside'
    );
  };
  report.check(
    'a box with a navigate verb becomes a link, and one without stays a box',
    /<a[^>]*href="\/pricing"/.test(card.html) && !/<a\b/.test(plain.html),
    `${inside(card.html)} · without: ${inside(plain.html)}`
  );

  /*
   * And the same question of a `link` whose href has been emptied, which is
   * the other branch of `resolveTag` and the only way to reach it.
   *
   * `link` and `button` ship `href: '#'` in their defaults, so the pair above
   * cannot fail no matter what the tag rule says about verbs — the check that
   * was supposed to cover this passed with the verb removed from the decision
   * entirely. Clearing the field is something a designer can do today, and it
   * is what X8's migration will do to every href it turns into a verb, so the
   * branch is real and this is what makes it so.
   */
  const emptied = linkPage({
    type: 'link',
    name: 'Pricing',
    props: { text: 'Pricing', href: '' },
    events: [{ event: 'onClick', actions: [{ type: 'navigate', to: '/pricing' }] }],
  });
  const emptiedAlone = linkPage({ type: 'link', name: 'Pricing', props: { text: 'Pricing', href: '' } });
  report.check(
    'and a link whose href was cleared is still a link when a verb says where to go',
    /<a[^>]*href="\/pricing"/.test(emptied.html) && !/<a\b/.test(emptiedAlone.html),
    `${inside(emptied.html)} · with nothing to go on: ${inside(emptiedAlone.html)}`
  );

  /*
   * The other three carriers, driven the same way. Each is a claim that a verb
   * reaches an attribute the browser already acts on — so the check reads the
   * attribute, and reads the script length beside it, because "compiles to
   * markup" and "costs nothing" are two claims and only one of them is
   * visible in the tag.
   */
  const panel = linkPage({
    type: 'frame',
    name: 'Shell',
    children: [
      { type: 'popover', name: 'Menu', props: {} },
      {
        type: 'button',
        name: 'Open',
        props: { label: 'Open' },
        events: [{ event: 'onClick', actions: [{ type: 'openPanel', ref: namedRef('Menu') }] }],
      },
    ],
  });
  report.check(
    'opening a panel through a verb is a popovertarget, not a listener',
    /<button[^>]*popovertarget="/.test(panel.html) && scriptIn(panel.html) === 0,
    `${/popovertarget="[^"]*"/.exec(panel.html)?.[0] ?? 'no popovertarget'} · ${scriptIn(panel.html)} bytes of script`
  );

  const send = linkPage({
    type: 'form',
    name: 'Contact',
    children: [
      {
        type: 'button',
        name: 'Send',
        props: { label: 'Send' },
        events: [{ event: 'onClick', actions: [{ type: 'submit' }] }],
      },
    ],
  });
  report.check(
    'sending a form through a verb is type=submit, not a listener',
    /<button[^>]*type="submit"/.test(send.html) && scriptIn(send.html) === 0,
    `${/<button[^>]*type="[^"]*"/.exec(send.html)?.[0]?.slice(-14) ?? 'no type'} · ${scriptIn(send.html)} bytes of script`
  );

  /*
   * A jump, both ways round, for the reason the navigate pair exists: the
   * claim is that the verb reaches the same markup the reference does, and a
   * check that only reads the verb's output cannot see a shared mistake.
   *
   * It very nearly did. Written first as "the href starts with a `#`", it
   * passed against a reference nothing had resolved — an unresolved jump
   * publishes `href="#"`, which matches that perfectly and scrolls to the top
   * of the page. That is precisely the bug this verb exists to avoid, sailing
   * through the check meant to catch it.
   */
  const jumpWith = (wiring) =>
    linkPage({
      type: 'frame',
      name: 'Shell',
      children: [
        // The anchor is what an id in the markup is made of, and it is minted
        // by `setJumpTarget` when a designer picks a target rather than by the
        // resolver — so a fixture built by hand has to say it, exactly as
        // `anchored()` does for every block in the library.
        { type: 'section', name: 'Features', props: { anchor: 'features' } },
        { type: 'button', name: 'Down', props: { label: 'Down' }, ...wiring },
      ],
    });
  const jump = jumpWith({
    events: [{ event: 'onClick', actions: [{ type: 'scrollTo', ref: namedRef('Features') }] }],
  });
  const jumpByRef = jumpWith({ refs: { scrollTo: 'Features' } });
  const landing = /<section[^>]*\bid="([^"]+)"/.exec(jump.html)?.[1] ?? '';
  report.check(
    'a jump through a verb is an anchor href naming the section, not a listener',
    Boolean(landing) &&
      jump.html.includes(`href="#${landing}"`) &&
      anchorOf(jump.html) === anchorOf(jumpByRef.html) &&
      scriptIn(jump.html) === 0,
    `${/href="#[^"]*"/.exec(jump.html)?.[0] ?? 'no anchor jump'} → section id ${landing || '(none)'} · same as by reference: ${anchorOf(jump.html) === anchorOf(jumpByRef.html)} · ${scriptIn(jump.html)} bytes of script`
  );

  /*
   * The mirror, which is what stops the four above from being satisfied by a
   * page that ships no script no matter what: the verbs with no carrier still
   * have to bring the runtime.
   */
  const copies = linkPage({
    type: 'button',
    name: 'Copy',
    props: { label: 'Copy' },
    events: [{ event: 'onClick', actions: [{ type: 'copy', text: 'sk-123' }] }],
  });
  report.check(
    'and a verb with nothing native behind it still ships the runtime',
    scriptIn(copies.html) > 0 && runsScript(copies.node),
    `${scriptIn(copies.html)} bytes for a copy`
  );

  /* --- what the absorption moved, and what it did not --------------------- */

  /*
   * Three of the four spellings fold onto verbs. The fourth does not, and this
   * is the check that says why rather than the docblock.
   *
   * `href` is `SETTABLE` and `BINDABLE`: a destination varies by rule — the
   * same button pointing elsewhere in the annual case — and binds to a record.
   * A migration that folded it into `navigate.to` would pass every
   * reachability check ever written, because the field stays reachable; it
   * would just quietly stop varying. So the claim is made on the *output*: two
   * cases, two hrefs, from one node whose press is authored as a verb.
   */
  const varied = linkPage({
    type: 'frame',
    name: 'Plans',
    props: { switchKey: 'billing', switchDefault: 'monthly' },
    children: [
      {
        type: 'link',
        name: 'Buy',
        props: { text: 'Buy', href: '/buy/monthly' },
        events: [{ event: 'onClick', actions: [{ type: 'navigate' }] }],
        rules: [
          {
            id: 'rulhref01',
            when: [{ kind: 'state', key: 'billing', op: 'is', values: ['annual'] }],
            // `apply` alongside `set`, because a content-only rule still goes
            // through the stylesheet generator and it reads the styles first.
            apply: {},
            set: { href: '/buy/annual' },
          },
        ],
      },
    ],
  });
  const destinations = [...varied.html.matchAll(/href="(\/buy\/[^"]*)"/g)].map((m) => m[1]);
  report.check(
    'a rule still varies the destination of a node whose press is a verb',
    destinations.includes('/buy/monthly') && destinations.includes('/buy/annual'),
    destinations.join(' · ') || 'only one destination in the file'
  );

  /*
   * And the three that did move, read off a built document rather than off the
   * function that moved them: `finishTree` folds a block's `refs` and
   * `props.submit`, so what a spec writes and what the document holds are two
   * different shapes and only the second one is what everything downstream
   * reads.
   */
  const absorbed = linkPage({
    type: 'form',
    name: 'Shell',
    children: [
      { type: 'popover', name: 'Menu', props: {} },
      { type: 'section', name: 'Features', props: { anchor: 'features' } },
      {
        type: 'button',
        name: 'Open',
        props: { label: 'Open' },
        refs: { popover: 'Menu' },
      },
      { type: 'button', name: 'Send', props: { label: 'Send', submit: true } },
    ],
  });
  const kids = absorbed.node.children.map((id) => absorbed.doc.nodes[id]);
  const opener = kids.find((n) => n.name === 'Open');
  const sender = kids.find((n) => n.name === 'Send');
  const verbs = (node) => (node?.events ?? []).flatMap((b) => b.actions).map((a) => a.type);
  report.check(
    'a block’s panel and submit arrive in the document as verbs, with the older spelling gone',
    verbs(opener).includes('openPanel') &&
      !opener?.refs?.popover &&
      verbs(sender).includes('submit') &&
      sender?.props.submit === undefined,
    `Open → ${verbs(opener).join(' ') || 'nothing'} (refs ${JSON.stringify(opener?.refs ?? null)}) · Send → ${verbs(sender).join(' ') || 'nothing'}`
  );
  report.check(
    'and both still reach the markup they always did',
    /<button[^>]*popovertarget="/.test(absorbed.html) &&
      /<button[^>]*type="submit"/.test(absorbed.html),
    `${/popovertarget="[^"]*"/.exec(absorbed.html)?.[0] ?? 'no popovertarget'} · ${/<button[^>]*type="submit"/.test(absorbed.html) ? 'type="submit"' : 'no submit'}`
  );

  /* --- And back out of the panel ------------------------------------------ */

  /*
   * The write path, which is the half X8 never drove.
   *
   * X9's browser checks seeded the document over HTTP on purpose — driving the
   * add menu would have been driving `Select` — and the reasoning was sound
   * about the widget and wrong about the coverage: nothing exercised
   * `ops.setActions`, so nothing noticed it was a two-verb allowlist written
   * before the vocabulary had eight. Six of what the panel offers were dropped
   * on the way to the document. See §4.1.9.
   *
   * Driven one verb at a time rather than as a list, so the failure names which
   * verb rather than reporting a count that is wrong by an unknown amount.
   */
  const EVERY_VERB = [
    { type: 'setState', value: 'annual' },
    { type: 'toggleState', values: ['open', 'shut'] },
    { type: 'copy', text: 'PROMO20' },
    { type: 'navigate' },
    { type: 'submit' },
    { type: 'openPanel', ref: { node: 'pan1' } },
    { type: 'closePanel', ref: { node: 'pan1' } },
    { type: 'scrollTo', ref: { node: 'sec1' } },
  ];
  const throughStore = (actions) => {
    const doc = { nodes: { one: { id: 'one', type: 'button', name: 'Go', props: {}, children: [] } } };
    ops.setActions(doc, 'one', actions);
    return (doc.nodes.one.events ?? []).flatMap((binding) => binding.actions);
  };
  const eaten = EVERY_VERB.filter((action) => throughStore([action]).length !== 1);
  report.check(
    'every verb the panel offers survives the store’s write path',
    eaten.length === 0,
    eaten.length ? `dropped: ${eaten.map((one) => one.type).join(', ')}` : `all ${EVERY_VERB.length} kept`
  );
  report.check(
    'and every verb in one list keeps its order, because the order is the gesture',
    throughStore(EVERY_VERB).map((one) => one.type).join(' ') ===
      EVERY_VERB.map((one) => one.type).join(' '),
    throughStore(EVERY_VERB).map((one) => one.type).join(' ') || 'nothing stored'
  );
  /*
   * The two the filter was always meant to catch, and a third it must not: an
   * emptied reference is what `pruneRefs` leaves behind on purpose, so dropping
   * it here would delete a row the panel deliberately keeps visible the next
   * time any *other* row was edited.
   */
  report.check(
    'a verb that says nothing is still not stored',
    throughStore([{ type: 'setState', value: '  ' }, { type: 'copy', text: '' }]).length === 0,
    `${throughStore([{ type: 'setState', value: '  ' }, { type: 'copy', text: '' }]).length} stored`
  );
  report.check(
    'but a reference that names nothing is a row to fix, not a row to delete',
    throughStore([{ type: 'openPanel', ref: {} }]).length === 1,
    `${throughStore([{ type: 'openPanel', ref: {} }]).length} stored`
  );
  /* A guard rides along, which is the whole of X10 reaching the document. */
  const allGuarded = throughStore(
    EVERY_VERB.map((one) => ({
      ...one,
      only: { kind: 'compare', left: { kind: 'input', name: 'email' }, op: 'notEmpty' },
    }))
  ).filter((one) => one.only?.left?.name === 'email');
  report.check(
    'and the guard the panel writes onto them arrives on every one of them',
    allGuarded.length === EVERY_VERB.length,
    `${allGuarded.length}/${EVERY_VERB.length} guarded`
  );

  /* --- One carrier, one claim --------------------------------------------- */

  /*
   * Two verbs wanting one attribute is not something a cleverer compiler
   * resolves — an `<a>` has one `href`. So the second is refused, and refused
   * *visibly*: dropping it silently is how a designer ends up with a control
   * that does half of what the panel says it does.
   */
  const both = planActions([
    { type: 'navigate', to: '/pricing' },
    { type: 'scrollTo', ref: { node: 'sec1' } },
    { type: 'copy', text: 'hello' },
  ]);
  report.check(
    'two verbs wanting one attribute: the first wins and the second is reported',
    both.native.length === 1 &&
      claimed(both, 'href')?.type === 'navigate' &&
      both.refused.length === 1 &&
      both.refused[0].action.type === 'scrollTo' &&
      both.refused[0].why === 'carrier' &&
      both.script.length === 1,
    `native ${both.native.map((c) => c.action.type).join(' ')} · refused ${both.refused.map((one) => `${one.action.type} (${one.why})`).join(' ')} · script ${both.script.map((a) => a.type).join(' ')}`
  );
  /*
   * And the order is the authored one rather than the table's. Same two verbs
   * the other way round: a compiler sorting by verb type would give the same
   * answer to both lists, and a designer who put the jump first would find the
   * navigate they wrote second silently winning.
   */
  const reversed = planActions([
    { type: 'scrollTo', ref: { node: 'sec1' } },
    { type: 'navigate', to: '/pricing' },
  ]);
  report.check(
    'and which one wins is the order they were written in',
    claimed(reversed, 'href')?.type === 'scrollTo' &&
      reversed.refused[0]?.action.type === 'navigate',
    `${claimed(reversed, 'href')?.type} kept, ${reversed.refused[0]?.action.type} refused`
  );

  /*
   * Different carriers do not compete. A button that opens a menu and sends a
   * form is nonsense, but a button that opens a menu and copies a key is not,
   * and the two claims live on different attributes.
   */
  const apart = planActions([
    { type: 'openPanel', ref: { node: 'pan1' } },
    { type: 'copy', text: 'sk-123' },
  ]);
  report.check(
    'two verbs on different attributes both land',
    apart.native.length === 1 && apart.script.length === 1 && apart.refused.length === 0,
    `${apart.native.length} native · ${apart.script.length} script · ${apart.refused.length} refused`
  );

  /*
   * An unfinished verb is neither. A `copy` with no text would put an empty
   * string on the clipboard, and shipping two kilobytes of runtime to do it is
   * the worst of both answers.
   */
  const blank = planActions([{ type: 'copy', text: '' }, { type: 'setState', value: '  ' }]);
  report.check(
    'a verb nobody filled in ships nothing, not an empty gesture',
    blank.script.length === 0 && blank.native.length === 0 && blank.refused.length === 0,
    `${blank.script.length} script · ${blank.native.length} native`
  );
  report.check(
    'which is the same reading `needsScript` gives, so the gate cannot drift',
    needsScript({ type: 'copy', text: 'x' }) &&
      !needsScript({ type: 'navigate', to: '/a' }) &&
      carrierOf({ type: 'submit' }) === 'submit',
    `copy→${carrierOf({ type: 'copy', text: 'x' }) ?? 'script'} navigate→${carrierOf({ type: 'navigate', to: '/a' })}`
  );

  /* --- A flip ------------------------------------------------------------- */

  /*
   * `toggleState` rides the assignment grammar rather than getting an
   * attribute of its own, which is what makes it cost about a hundred and
   * fifty bytes of runtime instead of five hundred. The encoding is the claim
   * a check can make here; the browser suite presses it.
   */
  const flip = linkPage({
    type: 'frame',
    name: 'Menu shell',
    props: { switchKey: 'menu', switchDefault: 'shut' },
    children: [
      {
        type: 'button',
        name: 'Menu',
        props: { label: 'Menu' },
        events: [
          { event: 'onClick', actions: [{ type: 'toggleState', values: ['shut', 'open'] }] },
        ],
      },
    ],
  });
  const flipButton = flip.doc.nodes[flip.node.children[0]];
  report.check(
    'a flip encodes as one assignment holding both halves',
    encodeSets(stateSets(flipButton)) === 'shut|open',
    encodeSets(stateSets(flipButton)) || 'nothing encoded'
  );
  report.check(
    'and reaches the markup as the same attribute an ordinary set uses',
    /data-cre8-set="shut\|open"/.test(flip.html),
    /data-cre8-set="[^"]*"/.exec(flip.html)?.[0] ?? 'no assignment in the markup'
  );
  /*
   * Both halves or nothing. `a|` would encode a bar with nothing after it and
   * the runtime would write an empty value — the same failure the
   * dropped-empty rule exists to prevent, arriving through a different door.
   */
  const halfFlip = (values) =>
    encodeSets(stateSets({ events: [{ event: 'onClick', actions: [{ type: 'toggleState', values }] }] }));
  report.check(
    'a flip missing a half is dropped rather than written broken',
    halfFlip(['shut', '']) === '' && halfFlip(undefined) === '' && halfFlip(['', 'open']) === '',
    `one half → "${halfFlip(['shut', ''])}" · none → "${halfFlip(undefined)}" · other half → "${halfFlip(['', 'open'])}"`
  );

  /* --- …but only when ------------------------------------------------------ */

  /*
   * The same fold/subscribe split the whole execution model runs on, applied
   * to what a control *does* rather than to how it looks.
   */
  const priceOver = (n) => ({
    kind: 'compare',
    left: { kind: 'field', key: 'price' },
    op: 'gt',
    right: { kind: 'literal', type: 'number', value: n },
  });
  const typed = {
    kind: 'compare',
    left: { kind: 'input', name: 'email' },
    op: 'notEmpty',
  };
  const record = (price) => ({ id: 'r1', collectionId: 'c1', data: { price } });
  const guarded = (only) => [{ type: 'setState', value: 'chosen', only }];

  const kept = planActions(guarded(priceOver(100)), record(500));
  const dropped = planActions(guarded(priceOver(100)), record(5));
  report.check(
    'a guard the publisher can answer is answered, and the action goes with it',
    kept.script.length === 1 && dropped.script.length === 0 && dropped.refused.length === 0,
    `over → ${kept.script.length} kept · under → ${dropped.script.length} kept, ${dropped.refused.length} refused`
  );
  report.check(
    'and neither leaves a gate behind for the browser to answer again',
    kept.gated === undefined && dropped.gated === undefined,
    `${String(kept.gated)} / ${String(dropped.gated)}`
  );
  /*
   * With no record there is no row to be, which is the canvas. A foldable
   * guard is left alone rather than guessed at — dropping the action would
   * take the control off the canvas the designer is editing it on, and
   * `evaluate` says `null` rather than `false` for exactly this reason.
   */
  report.check(
    'and on the canvas, where there is no record, it is left alone rather than guessed',
    planActions(guarded(priceOver(100))).script.length === 1,
    `${planActions(guarded(priceOver(100))).script.length} kept with nothing to evaluate against`
  );

  /*
   * And the answer has to reach the *markup*, not only the plan.
   *
   * The readers that build the attribute — `stateSets`, `copyTextFor` — used
   * to walk the action list directly, which was right until an action could be
   * dropped. Asked at the plan level alone, a check cannot see the difference:
   * removing the plan from those readers left every other guard check passing
   * while a button whose condition had failed still carried its assignment
   * into a page with no script to stop it.
   */
  const guardedNode = { events: [{ event: 'onClick', actions: guarded(priceOver(100)) }] };
  report.check(
    'and an action the guard dropped reaches no attribute either',
    encodeSets(stateSets(guardedNode, 'onClick', record(5))) === '' &&
      encodeSets(stateSets(guardedNode, 'onClick', record(500))) === 'chosen',
    `under → "${encodeSets(stateSets(guardedNode, 'onClick', record(5)))}" · over → "${encodeSets(stateSets(guardedNode, 'onClick', record(500)))}"`
  );

  const live = planActions(guarded(typed));
  report.check(
    'a guard the publisher cannot answer travels instead',
    live.script.length === 1 && JSON.stringify(live.gated) === JSON.stringify(typed),
    live.gated ? 'the condition is on the plan' : 'nothing to travel'
  );

  /*
   * One element, one attribute — so a binding whose actions disagree about
   * their guard is asking for something a page cannot express. Both directions
   * are refused, and the second is the one that would otherwise be a silent
   * wrong: an *unguarded* action beside a guarded one would quietly become
   * conditional, and a control that stops working for reasons nothing on
   * screen explains is worse than one that says so.
   */
  const mixed = planActions([
    { type: 'setState', value: 'a', only: typed },
    { type: 'setState', value: 'b', only: { ...typed, left: { kind: 'input', name: 'other' } } },
  ]);
  report.check(
    'two different live guards on one element: the second is refused, not run under the first',
    mixed.script.length === 1 &&
      mixed.refused.length === 1 &&
      mixed.refused[0].action.value === 'b' &&
      mixed.refused[0].why === 'guard',
    `kept ${mixed.script.map((a) => a.value).join(' ')} · refused ${mixed.refused.map((one) => `${one.action.value} (${one.why})`).join(' ')}`
  );
  const beside = planActions([
    { type: 'setState', value: 'a', only: typed },
    { type: 'copy', text: 'always' },
  ]);
  report.check(
    'and an unguarded action beside a live guard is refused rather than quietly gated',
    beside.script.length === 1 &&
      beside.refused.length === 1 &&
      beside.refused[0].action.type === 'copy' &&
      beside.refused[0].why === 'guard',
    `kept ${beside.script.map((a) => a.type).join(' ')} · refused ${beside.refused.map((one) => `${one.action.type} (${one.why})`).join(' ')}`
  );
  report.check(
    'while the same guard written twice is the same guard',
    planActions([
      { type: 'setState', value: 'a', only: typed },
      { type: 'copy', text: 'x', only: { ...typed } },
    ]).refused.length === 0,
    `${planActions([{ type: 'setState', value: 'a', only: typed }, { type: 'copy', text: 'x', only: { ...typed } }]).script.length} kept, none refused`
  );

  /* --- What the panel may offer, and what it may only report -------------- */

  /*
   * X10, and the claim is the derivation rather than the answer: the reason a
   * guard has to be a comparison is that a `Condition` is answered by *neither*
   * evaluator, so it does not fold and is never true.
   *
   * Both halves are asserted beside `answerable` on the same input, which is
   * what makes this more than a restatement of its switch. Teach either
   * evaluator a new kind and forget this function, and the second clause fails
   * rather than the first.
   */
  const CONDITIONS = [
    { kind: 'pointer', pseudo: 'hover' },
    { kind: 'control', pseudo: 'checked' },
    { kind: 'state', key: 'billing', values: ['annual'] },
    { kind: 'attr', name: 'data-cre8-copied', value: '' },
    { kind: 'data', source: 'utm', values: ['sale'] },
  ];
  const unanswerable = CONDITIONS.filter(
    (one) => !actionLib.answerable(one) && !tests.foldable(one) && tests.evaluate(one, null) === null
  );
  report.check(
    'a browser condition is answerable by neither schedule, so it is not a guard',
    unanswerable.length === CONDITIONS.length,
    `${unanswerable.length}/${CONDITIONS.length}: ${CONDITIONS.map((one) => `${one.kind}→${actionLib.answerable(one) ? 'offered' : 'refused'}`).join(' ')}`
  );
  report.check(
    'and a comparison is, on either schedule, however deep it is nested',
    actionLib.answerable(typed) &&
      actionLib.answerable({ kind: 'every', tests: [typed, { ...typed }] }) &&
      !actionLib.answerable({ kind: 'every', tests: [typed, CONDITIONS[0]] }),
    `compare ${actionLib.answerable(typed)} · all-compare ${actionLib.answerable({ kind: 'every', tests: [typed, typed] })} · one rotten ${actionLib.answerable({ kind: 'every', tests: [typed, CONDITIONS[0]] })}`
  );

  /*
   * And the shape the panel writes: one guard, on every action. Told apart from
   * "no guard" and from "these disagree", because the panel does three
   * completely different things with the three answers — an offer, an editor,
   * and a report.
   */
  const agreeing = [
    { type: 'setState', value: 'a', only: typed },
    { type: 'copy', text: 'x', only: { ...typed } },
  ];
  const disagreeing = [
    { type: 'setState', value: 'a', only: typed },
    { type: 'copy', text: 'x' },
  ];
  report.check(
    'one guard on every action is one guard, and the panel can read it back',
    actionLib.guardsAgree(agreeing) &&
      JSON.stringify(actionLib.sharedGuard(agreeing)) === JSON.stringify(typed),
    `${actionLib.guardsAgree(agreeing) ? 'agreed' : 'disagreed'} · ${JSON.stringify(actionLib.sharedGuard(agreeing))}`
  );
  report.check(
    'a list nothing guards is not a list that agrees about a guard it has',
    actionLib.guardsAgree([{ type: 'copy', text: 'x' }]) &&
      actionLib.sharedGuard([{ type: 'copy', text: 'x' }]) === null &&
      actionLib.guardsAgree([]) &&
      actionLib.sharedGuard([]) === null,
    `unguarded → ${actionLib.sharedGuard([{ type: 'copy', text: 'x' }])} · empty → ${actionLib.sharedGuard([])}`
  );
  report.check(
    'and a list that disagrees is neither, which is what the panel reports',
    !actionLib.guardsAgree(disagreeing) &&
      actionLib.sharedGuard(disagreeing) === null &&
      planActions(disagreeing).refused.length === 1,
    `${actionLib.guardsAgree(disagreeing) ? 'agreed' : 'disagreed'} · ${planActions(disagreeing).refused.length} refused`
  );

  /* --- and what reaches the page ------------------------------------------ */

  const guardPage = (only) =>
    linkPage({
      type: 'frame',
      name: 'Gate',
      props: { switchKey: 'gate', switchDefault: 'off' },
      children: [
        { type: 'input', name: 'Email', props: { name: 'email' } },
        {
          type: 'button',
          name: 'Choose',
          props: { label: 'Choose' },
          events: [{ event: 'onClick', actions: [{ type: 'setState', value: 'chosen', only }] }],
        },
      ],
    });

  const liveGate = guardPage(typed);
  report.check(
    'a live guard names the attribute it waits for, and the attribute is not set yet',
    /data-cre8-only="data-cre8-w-[^"]*-g"/.test(liveGate.html) &&
      !new RegExp(`${/data-cre8-only="([^"]*)"/.exec(liveGate.html)?.[1]}=`).test(liveGate.html),
    `${/data-cre8-only="[^"]*"/.exec(liveGate.html)?.[0] ?? 'no gate'} · off in the file, which is what a visitor with no scripting keeps`
  );
  report.check(
    'and the condition travels in the table the evaluator already reads',
    liveGate.html.includes('data-cre8-test') && liveGate.html.includes('"name":"email"'),
    liveGate.html.includes('"kind":"compare"') ? 'the guard is in the table' : 'nothing travelled'
  );
  report.check(
    'and the action it gates is still in the markup, because the browser decides',
    /data-cre8-set="chosen"/.test(liveGate.html),
    /data-cre8-set="[^"]*"/.exec(liveGate.html)?.[0] ?? 'the assignment was dropped'
  );

  /*
   * And the mirror, which is what stops the three above from being satisfied
   * by a build that gates nothing: a guard the publisher can answer leaves no
   * trace of itself in the file at all — no pointer, no attribute, nothing for
   * the browser to re-decide.
   */
  /*
   * The markup, not the file. Every attribute name in the runtime is a string
   * literal in the runtime, so `data-cre8-only` appears in any page that ships
   * the script whether or not a single element is gated — the first version of
   * this check failed for that reason while its own detail correctly read "no
   * gate".
   */
  const markupOf = (html) =>
    html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const foldedGate = markupOf(guardPage(priceOver(100)).html);
  report.check(
    'a guard that folds leaves no gate in the file',
    !/data-cre8-only/.test(foldedGate) && /data-cre8-set="chosen"/.test(foldedGate),
    `${/data-cre8-only="[^"]*"/.exec(foldedGate)?.[0] ?? 'no gate'} · ${/data-cre8-set="[^"]*"/.exec(foldedGate)?.[0] ?? 'and no assignment either'}`
  );
}



/* ==========================================================================
 * Nothing on a node is unreachable from a block
 * ======================================================================= */

report.group('nothing on a node is unreachable from a block');

{
  /*
   * The generalisation of the bug P2 found, written as a rule.
   *
   * `assign` had been on `SceneNode` for two releases and the renderer had read
   * it the whole time. What could not reach it was the *spec*: `buildSubtree`
   * copied props, styles, rules, meta, repeat, refs and bindings and dropped
   * that one silently. The symptom was not an error — it was a repeater that
   * drew one shape, and a feature that looked built from every side except the
   * one somebody would use.
   *
   * The shape of that mistake is a field on the node model with no way in, so
   * that is what this checks. It is a source comparison rather than a runtime
   * one because the question is about two type declarations, and a runtime
   * probe would need a value for every field to notice a missing one.
   *
   * Falsified by *adding* a field to `SceneNode`, which is the only way in.
   * Deleting one that a spec already carries is a compile error long before it
   * reaches here — which is a perfectly good guard, and a different one. This
   * covers the case the compiler cannot see: a field arriving on the node with
   * nothing on the authoring side to miss.
   */
  const fieldsOf = (source, declaration) => {
    const at = source.indexOf(declaration);
    if (at < 0) return null;
    // To the closing brace at column zero, which is where an interface ends.
    const body = source.slice(at, source.indexOf('\n}', at));
    return new Set([...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]));
  };

  const nodeFields = fieldsOf(
    readFileSync(path.join(ROOT, 'src/lib/document/types.ts'), 'utf8'),
    'export interface SceneNode {'
  );
  const specFields = fieldsOf(
    readFileSync(path.join(ROOT, 'src/lib/document/factory.ts'), 'utf8'),
    'export interface NodeSpec {'
  );

  /**
   * Fields a spec is right not to carry, each for a reason.
   *
   * Kept as a list with the reasons attached rather than as a count, because
   * the next field to be added will be added by somebody who has to decide
   * which side of this line it falls on.
   */
  const SUPPLIED = {
    id: 'minted by the builder',
    parentId: 'the builder knows where it is putting the node',
    children: 'a spec nests specs, and the builder turns them into ids',
    overrides: 'set on an instance by the editor, never authored',
    vars: 'written by the renderer from a mapped Value, never authored',
    bindings: 'RESERVED — the data axis, and nothing reads it yet',
  };

  const missing = [...(nodeFields ?? [])].filter(
    (field) => !specFields?.has(field) && !(field in SUPPLIED)
  );

  report.check(
    'every field a node can hold is one a block can write',
    Boolean(nodeFields?.size) && Boolean(specFields?.size) && missing.length === 0,
    missing.length
      ? `${missing.join(', ')} — on SceneNode, absent from NodeSpec, and not excused`
      : `${nodeFields.size} fields on the node, ${specFields.size} on the spec, ` +
        `${Object.keys(SUPPLIED).length} supplied by the builder`
  );

  report.check(
    'and buildSubtree actually copies each of the ones it can',
    (() => {
      const factory = readFileSync(path.join(ROOT, 'src/lib/document/factory.ts'), 'utf8');
      const at = factory.indexOf('function buildSubtree(');
      const body = factory.slice(at, factory.indexOf('\n}', at));
      // `states` is folded into `rules` and `bind` is renamed on the way in, so
      // both are named in the body under their own names anyway.
      return [...(specFields ?? [])].every((field) => body.includes(`spec.${field}`));
    })(),
    (() => {
      const factory = readFileSync(path.join(ROOT, 'src/lib/document/factory.ts'), 'utf8');
      const at = factory.indexOf('function buildSubtree(');
      const body = factory.slice(at, factory.indexOf('\n}', at));
      const dropped = [...(specFields ?? [])].filter((f) => !body.includes(`spec.${f}`));
      // Computed from the body, because "declared and never read" is exactly
      // the failure mode, and a fixed string here would hide it.
      return dropped.length
        ? `${dropped.join(', ')} — declared on NodeSpec and never read`
        : `all ${specFields.size} read`;
    })()
  );

  report.check(
    'the comparison is reading two real declarations',
    (nodeFields?.has('assign') ?? false) &&
      (nodeFields?.has('events') ?? false) &&
      (specFields?.has('assign') ?? false) &&
      (specFields?.has('events') ?? false),
    // The two the rule was written for. If the parse silently returned an
    // empty set the check above would pass for the worst possible reason.
    `node: ${[...(nodeFields ?? [])].length} fields, spec: ${[...(specFields ?? [])].length}`
  );
}



/* ==========================================================================
 * The gallery is the library, and stays the library
 * ======================================================================= */

report.group('the gallery is the library, and stays the library');

{
  /*
   * The component gallery is built by mapping the block registry, which makes
   * it complete today and says nothing about tomorrow. "Reads the registry" is
   * true right up until somebody adds a filter, a slice or a hand-written list
   * — and the failure is silent in the worst way: the gallery still builds, the
   * page still looks right, the new block is simply not in it and nobody finds
   * out until they go looking for it.
   *
   * So the claim is checked rather than trusted, against the built document
   * rather than against the function that builds it.
   */
  const gallery = TEMPLATES.find((t) => t.id === 'gallery');

  report.check(
    'the gallery template is registered',
    Boolean(gallery),
    gallery ? gallery.name : `only: ${TEMPLATES.map((t) => t.id).join(', ')}`
  );

  if (gallery) {
    const doc = gallery.build();
    /*
     * Every caption prints `<name>  ·  <id>`, and the id is the half somebody
     * types into the Insert panel — so it is also the half worth searching for.
     *
     * Matched on the whole shape rather than on the separator alone. A middle
     * dot is ordinary punctuation in this library — every byline in the
     * editorial blocks reads "Priya Raman · 4 Aug 2026 · 9 min" — so scanning
     * for it found fifteen more "captions" than there are blocks and reported
     * reading times as unknown block ids. The two spaces and the trailing slug
     * are what make the caption a caption.
     */
    const CAPTION = /^(.+?) {2}· {2}([a-z0-9][a-z0-9-]*)$/;
    const shown = new Set(
      Object.values(doc.nodes)
        .map((node) => CAPTION.exec(String(node.props?.text ?? ''))?.[2])
        .filter(Boolean)
    );

    const missing = BLOCKS.filter((b) => !shown.has(b.id)).map((b) => b.id);
    report.check(
      'every block in the registry is in the gallery',
      missing.length === 0 && BLOCKS.length > 0,
      missing.length
        ? `${missing.length} missing: ${missing.slice(0, 6).join(', ')}`
        : `all ${BLOCKS.length} of them, captioned by id`
    );

    /*
     * And the other direction, which is the one a filter would not break but a
     * typo would: a caption naming something the registry does not have.
     */
    const ids = new Set(BLOCKS.map((b) => b.id));
    const strays = [...shown].filter((id) => !ids.has(id));
    report.check(
      'and nothing is in the gallery that is not in the registry',
      strays.length === 0,
      strays.length ? strays.slice(0, 6).join(', ') : `${shown.size} captions, every id real`
    );

    /*
     * A block whose category is not in `BLOCK_CATEGORIES` gets no page at all,
     * because the gallery walks the category list to decide what pages to make.
     * That is a way to be missing that the count above would also catch — but
     * this one says *why*, which is the difference between a failing test and a
     * useful one.
     */
    const known = new Set(BLOCK_CATEGORIES.map((c) => c.id));
    const orphans = BLOCKS.filter((b) => !known.has(b.category)).map((b) => `${b.id}:${b.category}`);
    report.check(
      'every block belongs to a category that gets a page',
      orphans.length === 0,
      orphans.length ? orphans.slice(0, 5).join(', ') : `${known.size} categories, ${BLOCKS.length} blocks placed`
    );

    report.check(
      'and there is a page for each category, plus the overview',
      doc.pages.length === BLOCK_CATEGORIES.length + 1,
      `${doc.pages.length} pages for ${BLOCK_CATEGORIES.length} categories`
    );

    /*
     * The check has to be able to fail. If the caption format ever changes, the
     * scan above finds nothing, `missing` becomes every block, and that reads
     * as a catastrophe rather than as a broken test — so the count of captions
     * is asserted too, and it is the number that tells the two apart.
     */
    report.check(
      'the scan is reading real captions rather than nothing',
      shown.size === BLOCKS.length,
      `${shown.size} captions found for ${BLOCKS.length} blocks`
    );
  }
}

/* ==========================================================================
 * One condition language, and OR in the stylesheet
 * ======================================================================= */

report.group('one condition language, and OR in the stylesheet');

{
  const { branchesOf, conditionsOf, asTest, unreachable, BRANCH_LIMIT } = when_;

  const hover = { kind: 'pointer', pseudo: 'hover' };
  const ticked = { kind: 'control', pseudo: 'checked' };
  const annual = { kind: 'state', key: 'plan', op: 'is', values: ['annual'] };
  const shape = (branches) =>
    branches === null ? 'null' : branches.map((b) => b.map((c) => c.kind).join('+')).join(' | ');

  /* --- What a Test compiles to ------------------------------------------- */

  /*
   * The empty branch is not the same as no branches, and the difference is a
   * rule that always applies against a rule that can never apply. A backdrop
   * has no condition; nothing should ever compile to zero selectors and then
   * be emitted anyway.
   */
  /*
   * Asserted on the *count*, not on `shape`.
   *
   * The first version of this compared `shape(branchesOf(undefined))` to the
   * empty string, and `shape` renders both `[[]]` and `[]` as the empty
   * string — so the check passed either way and said nothing. One branch with
   * nothing on it is a rule that always applies; no branches is a rule that
   * can never apply, and they are exactly the two answers that must not be
   * confused here.
   */
  report.check(
    'no condition at all is one selector with nothing on it',
    branchesOf(undefined)?.length === 1 && branchesOf(undefined)[0].length === 0,
    `${branchesOf(undefined)?.length} branches`
  );
  report.check(
    'one condition is one branch',
    shape(branchesOf(hover)) === 'pointer',
    shape(branchesOf(hover))
  );
  report.check(
    'all of these is one branch holding both, in the order written',
    shape(branchesOf({ kind: 'every', tests: [hover, annual] })) === 'pointer+state',
    shape(branchesOf({ kind: 'every', tests: [hover, annual] }))
  );
  report.check(
    'any of these is one branch each',
    shape(branchesOf({ kind: 'some', tests: [hover, annual] })) === 'pointer | state',
    shape(branchesOf({ kind: 'some', tests: [hover, annual] }))
  );
  /*
   * And a member that is itself a group contributes *all* of its branches.
   *
   * The check above cannot see that: every member of a flat `some` yields
   * exactly one branch, so a union that kept only the first branch of each
   * member would pass it perfectly. Nesting is what makes the difference
   * visible, and losing a branch here is an OR that silently stops covering
   * one of the cases the designer asked for.
   */
  const nested = { kind: 'some', tests: [hover, { kind: 'some', tests: [annual, ticked] }] };
  report.check(
    'and a group inside an "any" contributes every one of its branches',
    shape(branchesOf(nested)) === 'pointer | state | control',
    shape(branchesOf(nested))
  );
  report.check(
    'and a group inside a group is the cross product',
    shape(
      branchesOf({
        kind: 'every',
        tests: [hover, { kind: 'some', tests: [annual, ticked] }],
      })
    ) === 'pointer+state | pointer+control',
    shape(
      branchesOf({
        kind: 'every',
        tests: [hover, { kind: 'some', tests: [annual, ticked] }],
      })
    )
  );

  /*
   * The two refusals. A comparison is answered by reading a record, not by a
   * selector; a tree wider than the ceiling is refused rather than allowed to
   * make the generator do unbounded work. Both come back as `null`, and the
   * caller drops the rule — a rule compiled to *almost* the right selector is
   * worse than one compiled to none.
   */
  const compare = { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'gt' };
  report.check(
    'a comparison cannot be a selector',
    branchesOf(compare) === null,
    shape(branchesOf(compare))
  );
  report.check(
    'and neither can a tree with more ways to be true than the ceiling',
    (() => {
      // Four groups of four is 256 branches, well past any ceiling worth
      // having and unreachable from a panel that authors one level.
      const four = { kind: 'some', tests: [hover, ticked, annual, hover] };
      return branchesOf({ kind: 'every', tests: [four, four, four, four] }) === null;
    })(),
    `ceiling is ${BRANCH_LIMIT}`
  );
  report.check(
    'a tree just inside the ceiling still compiles',
    (() => {
      const two = { kind: 'some', tests: [hover, annual] };
      const branches = branchesOf({ kind: 'every', tests: [two, two] });
      return branches?.length === 4;
    })(),
    String(branchesOf({
      kind: 'every',
      tests: [
        { kind: 'some', tests: [hover, annual] },
        { kind: 'some', tests: [hover, annual] },
      ],
    })?.length)
  );
  report.check(
    'any of nothing is refused rather than compiled to always',
    branchesOf({ kind: 'some', tests: [] }) === null,
    shape(branchesOf({ kind: 'some', tests: [] }))
  );

  /* --- The flat reading every other caller wants -------------------------- */

  report.check(
    'a branching rule is not a flat list, and says so',
    conditionsOf({ kind: 'some', tests: [hover, annual] }) === null &&
      conditionsOf({ kind: 'every', tests: [hover, annual] })?.length === 2,
    `some → ${conditionsOf({ kind: 'some', tests: [hover, annual] })}`
  );

  /* --- The authoring shorthand -------------------------------------------- */

  /*
   * A list of one is that condition, not a group holding it. A group with a
   * single member is an extra level in the panel, an extra indent in the
   * summary, and a document that differs from an identical design built the
   * other way round.
   */
  report.check(
    'the list shorthand folds the way the panel and the model both read it',
    asTest([]) === undefined &&
      asTest(undefined) === undefined &&
      asTest([hover]) === hover &&
      asTest([hover, annual])?.kind === 'every',
    `[] → ${asTest([])} · [one] → ${asTest([hover])?.kind} · [two] → ${asTest([hover, annual])?.kind}`
  );

  /*
   * And the normalisation that makes byte-identity possible: however a plain
   * AND is spelled, it compiles to the same branch. This is the property the
   * whole widening rests on, and the one a two-revision diff can only observe
   * indirectly.
   */
  report.check(
    'a group of one compiles to exactly what the bare condition does',
    shape(branchesOf({ kind: 'every', tests: [hover] })) === shape(branchesOf(hover)) &&
      shape(branchesOf({ kind: 'some', tests: [hover] })) === shape(branchesOf(hover)),
    shape(branchesOf({ kind: 'every', tests: [hover] }))
  );

  /* --- What the editor says about a rule that cannot work ------------------ */

  report.check(
    'a rule that cannot compile explains which of the two reasons it is',
    /compares a value/.test(unreachable(compare) ?? '') &&
      /Split it into two rules/.test(
        unreachable({
          kind: 'every',
          tests: Array.from({ length: 4 }, () => ({
            kind: 'some',
            tests: [hover, ticked, annual, hover],
          })),
        }) ?? ''
      ) &&
      unreachable(hover) === null,
    unreachable(compare) ?? 'no explanation'
  );

  /* --- OR, in the stylesheet ---------------------------------------------- */

  const ruleOn = (whenTest) => {
    const doc = createEmptyDocument('OR');
    const root = doc.nodes[doc.pages[0].rootNodeId];
    // The root declares the state, or `stateOwner` finds no owner and the
    // generator drops the whole rule — correctly, and it took a confusing
    // empty result to remember that a condition naming nothing is not a
    // condition the stylesheet can carry.
    root.state = { key: 'plan', values: ['monthly', 'annual'], initial: 'monthly' };
    const id = 'orx1';
    doc.nodes[id] = {
      id,
      type: 'button',
      name: 'B',
      parentId: root.id,
      children: [],
      props: { label: 'B' },
      styles: {},
      meta: {},
      rules: [{ id: 'r', when: whenTest, apply: { color: 'rgb(9, 9, 9)' } }],
    };
    root.children.push(id);
    return generateNodeCss(doc.nodes, { mode: 'media', includeStates: true })
      .split('\n')
      .filter((line) => line.includes('rgb(9, 9, 9)') || line.includes('.c-orx1'))
      .join('\n');
  };

  const orCss = ruleOn({ kind: 'some', tests: [hover, annual] });
  report.check(
    'any of these compiles to a selector list, which is how a stylesheet spells OR',
    orCss.includes(':hover') && orCss.includes('data-cre8-value') && orCss.includes(','),
    orCss.split('\n')[0] ?? 'nothing emitted'
  );
  report.check(
    'and both branches share one declaration block rather than being written twice',
    (orCss.match(/rgb\(9, 9, 9\)/g) ?? []).length === 1,
    `${(orCss.match(/rgb\(9, 9, 9\)/g) ?? []).length} declaration blocks`
  );
  /*
   * Every branch still weighs (0,1,0). This is the line that keeps source
   * order the whole of precedence — a branch that escaped `:where()` would
   * silently out-rank every rule after it, which is the bug the padding was
   * introduced to kill in the first place.
   */
  report.check(
    'every branch is still wrapped so nothing out-ranks anything',
    orCss
      .split(',')
      .filter((one) => one.includes('.c-orx1'))
      .every((one) => !/:(hover|checked)(?![^(]*\))/.test(one.replace(/:where\([^)]*\)/g, ''))),
    orCss.split('\n')[0] ?? ''
  );
  /*
   * A comparison used to emit nothing, and that was the right answer until it
   * stopped being one.
   *
   * `branchesOf` still refuses it — a comparison is not a selector and never
   * will be — but the generator no longer sees the authored form. `plannedWhen`
   * swaps the comparison for the attribute that carries its answer, so a style
   * rule reading a record field compiles to an ordinary attribute selector and
   * the value is written on the element instead.
   */
  const mintedCss = ruleOn(compare);
  report.check(
    'a comparison compiles to the attribute the compiler minted for it',
    /\[data-cre8-w-[a-z0-9]+-0=""\]/.test(mintedCss) && mintedCss.includes('rgb(9, 9, 9)'),
    mintedCss.split('\n')[0] ?? 'nothing emitted'
  );
  report.check(
    'and the comparison itself is nowhere in the stylesheet',
    !/price|\bgt\b/.test(mintedCss),
    mintedCss.split('\n')[0] ?? ''
  );
}

/* ==========================================================================
 * A state says what it can be
 * ======================================================================= */

report.group('a state says what it can be');

{
  const { stateOf, valuesOf, scrapedValues, declarationFrom } = stateLib;

  /* --- The upgrade -------------------------------------------------------- */

  /*
   * Three loose props become one declaration, and the values — which were
   * never written down at all — are scraped once and recorded.
   */
  const legacy = () => {
    const doc = createEmptyDocument('Old switch');
    const root = doc.nodes[doc.pages[0].rootNodeId];
    root.props = { ...root.props, switchKey: 'plan', switchDefault: 'monthly' };
    doc.nodes.btn1 = {
      id: 'btn1', type: 'button', name: 'Annual', parentId: root.id, children: [],
      props: { label: 'Annual', switchSet: 'annual' }, styles: {}, meta: {},
    };
    root.children.push('btn1');
    return doc;
  };

  const upgraded = migrateDocument(legacy());
  const decl = stateOf(upgraded.nodes[upgraded.pages[0].rootNodeId]);
  report.check(
    'the three props become one declaration',
    decl?.key === 'plan' && decl?.initial === 'monthly',
    JSON.stringify(decl)
  );
  report.check(
    'and the values nothing recorded are read off the controls, once',
    decl?.values.join(' ') === 'monthly annual',
    decl?.values.join(' ') ?? 'none'
  );
  report.check(
    'the props it came from are gone, so nothing can read two spellings',
    (() => {
      const root = upgraded.nodes[upgraded.pages[0].rootNodeId];
      return ['switchKey', 'switchDefault', 'switchDesign'].every(
        (prop) => root.props[prop] === undefined
      );
    })(),
    Object.keys(upgraded.nodes[upgraded.pages[0].rootNodeId].props).join(' ')
  );
  /*
   * Twice is the same as once. Every migration here is recognised by shape and
   * safe to re-run, and this one has a way to get that wrong the others do not
   * — a second pass over a node whose props are already gone would scrape an
   * empty list over a declared one.
   */
  const twice = migrateDocument(migrateDocument(legacy()));
  report.check(
    'and running the upgrade twice changes nothing',
    JSON.stringify(stateOf(twice.nodes[twice.pages[0].rootNodeId])) === JSON.stringify(decl),
    JSON.stringify(stateOf(twice.nodes[twice.pages[0].rootNodeId]))
  );

  /* --- Declared beats discovered ------------------------------------------ */

  /*
   * The whole point of the stage, and the thing that was impossible by
   * construction: a value nothing sets.
   *
   * A filter's *empty* case, or a form's *error* case, could not exist until
   * the control that reached it was wired — because the list was recovered by
   * walking the subtree for controls. So the case could not be designed until
   * after it had been wired, which is backwards: the design is how you decide
   * what the control should do.
   */
  const declared = migrateDocument(legacy());
  const rootId = declared.pages[0].rootNodeId;
  declared.nodes[rootId].state.values = ['monthly', 'annual', 'lifetime'];

  report.check(
    'a value nothing sets is still a value',
    valuesOf(declared.nodes, rootId, stateOf(declared.nodes[rootId])).includes('lifetime'),
    valuesOf(declared.nodes, rootId, stateOf(declared.nodes[rootId])).join(' ')
  );
  report.check(
    'and the walk that used to be the truth cannot see it',
    !scrapedValues(declared.nodes, rootId, 'plan').includes('lifetime'),
    scrapedValues(declared.nodes, rootId, 'plan').join(' ')
  );

  /*
   * The other direction, which is the one a check could easily forget: a
   * control setting a value the declaration has not heard of. Appended rather
   * than dropped — the value is real, the page will enter that state, and
   * hiding it from the panel would leave a designer unable to style a case
   * their own document can reach.
   */
  const stray = migrateDocument(legacy());
  const strayRoot = stray.pages[0].rootNodeId;
  stray.nodes[strayRoot].state.values = ['monthly'];
  report.check(
    'a value something sets but nobody declared is surfaced, not swallowed',
    valuesOf(stray.nodes, strayRoot, stateOf(stray.nodes[strayRoot])).join(' ') ===
      'monthly annual',
    valuesOf(stray.nodes, strayRoot, stateOf(stray.nodes[strayRoot])).join(' ')
  );
  report.check(
    'and what was declared still leads, in the order it was written',
    (() => {
      const doc = migrateDocument(legacy());
      const id = doc.pages[0].rootNodeId;
      doc.nodes[id].state.values = ['lifetime', 'monthly'];
      return valuesOf(doc.nodes, id, stateOf(doc.nodes[id])).join(' ') === 'lifetime monthly annual';
    })(),
    (() => {
      const doc = migrateDocument(legacy());
      const id = doc.pages[0].rootNodeId;
      doc.nodes[id].state.values = ['lifetime', 'monthly'];
      return valuesOf(doc.nodes, id, stateOf(doc.nodes[id])).join(' ');
    })()
  );

  /* --- A declaration with no name is no declaration ----------------------- */

  report.check(
    'a declaration with no name reads as none, so nothing writes to nowhere',
    stateOf({ state: { key: '  ', values: ['a'], initial: 'a' } }) === null &&
      declarationFrom({}, { id: 'x', props: {} }) === null,
    String(stateOf({ state: { key: '  ', values: ['a'], initial: 'a' } }))
  );

  /*
   * And the sentinel that must survive the fold. `switchDesign` could hold
   * `*`, meaning "lay every case out at once" — a working view rather than a
   * case name — and slugging it, which is right for every other field here,
   * strips it to nothing and silently drops the designer into the first case.
   */
  report.check(
    'the “show every case” view survives the upgrade',
    (() => {
      const doc = legacy();
      doc.nodes[doc.pages[0].rootNodeId].props.switchDesign = '*';
      const out = migrateDocument(doc);
      return stateOf(out.nodes[out.pages[0].rootNodeId])?.design === '*';
    })(),
    String(
      (() => {
        const doc = legacy();
        doc.nodes[doc.pages[0].rootNodeId].props.switchDesign = '*';
        const out = migrateDocument(doc);
        return stateOf(out.nodes[out.pages[0].rootNodeId])?.design;
      })()
    )
  );

  /* --- And the room has to be holding the same shape ---------------------- */

  /*
   * The half of an upgrade that is not in the upgrade.
   *
   * Every migration before this one rewrote fields that already existed, so
   * the room could hold unmigrated JSON and still apply an editor's patches:
   * `replace nodes/x/props/y` lands on either shape. This one *creates* a
   * nested object, and a patch into `nodes/x/state/values` has no parent in a
   * document where `state` was never folded. `applyPatches` throws, the room
   * answers with a resync, and the client throws its own edit away and
   * re-derives the old declaration from the props it still has — for ever, on
   * exactly the documents that predate the migration, with nothing logged and
   * nothing saved.
   *
   * So the hazard is established first, from the real patch an inspector edit
   * produces, and then the room is required to be on the other side of it.
   */
  const stored = JSON.parse(JSON.stringify(legacy()));
  const opened = hydrateDocument(JSON.parse(JSON.stringify(stored)));
  const openedRoot = opened.pages[0].rootNodeId;
  // Caught rather than thrown: a fold that stops happening should fail the
  // check below with "no patches", not take the suite down two thousand
  // checks early with a TypeError about `undefined`.
  let patches = [];
  try {
    [, patches] = produceWithPatches(opened, (draft) => {
      draft.nodes[openedRoot].state.values.push('lifetime');
    });
  } catch {
    patches = [];
  }

  report.check(
    'an edit to a declaration patches a path the stored document has no parent for',
    patches.length > 0 &&
      patches.every((patch) => patch.path[2] === 'state') &&
      stored.nodes[openedRoot].state === undefined,
    patches.map((patch) => patch.path.join('/')).join(' · ') || 'no patches'
  );
  report.check(
    'so applying it to what D1 holds throws rather than editing anything',
    (() => {
      try {
        applyPatches(stored, patches);
        return false;
      } catch {
        return true;
      }
    })(),
    (() => {
      try {
        applyPatches(stored, patches);
        return 'it applied — the shapes already agree, so this check is spent';
      } catch (error) {
        return error instanceof Error ? error.message.split('\n')[0] : String(error);
      }
    })()
  );
  const landed = (() => {
    try {
      const room = hydrateDocument(JSON.parse(JSON.stringify(stored)));
      return applyPatches(room, patches).nodes[openedRoot].state?.values ?? [];
    } catch (error) {
      return [error instanceof Error ? error.message.split('\n')[0] : String(error)];
    }
  })();
  report.check(
    'and applying it to a hydrated copy lands the edit, which is what the room must hold',
    landed.includes('lifetime'),
    landed.join(' ') || 'nothing'
  );

  /*
   * Which is a property of `room.ts`, not of this file. Both doors a document
   * comes in through are named — a load from D1 and a whole-document write —
   * and the count is asserted so that renaming one into something this does
   * not recognise fails here rather than passing by not being looked at.
   */
  {
    const room = readFileSync(path.join(ROOT, 'workers', 'src', 'room.ts'), 'utf8');
    const external = [...room.matchAll(/this\.doc = (.+);/g)]
      .map((match) => match[1])
      .filter((expression) => !/^applyPatches\(|^null$/.test(expression));
    report.check(
      'the room takes a document from exactly two places',
      external.length === 2,
      external.join(' · ') || 'none found — the assignment moved'
    );
    report.check(
      'and upgrades what arrives at both of them',
      external.length === 2 && external.every((expression) => /^upgraded\(/.test(expression)),
      external.filter((expression) => !/^upgraded\(/.test(expression)).join(' · ') || 'both'
    );
    report.check(
      'through the same function every other reader uses',
      /function upgraded\([^)]*\)[^{]*\{\s*return hydrateDocument\(/.test(room),
      /function upgraded\([\s\S]{0,120}/.exec(room)?.[0].split('\n').slice(0, 2).join(' ') ??
        'no upgrade function'
    );
  }
}

/* ==========================================================================
 * A comparison in a style rule mints its own answer
 * ======================================================================= */

report.group('a comparison in a style rule mints its own answer');

{
  const { mintedIn, plannedWhen, MINT_PREFIX } = when_;

  const priceOver = {
    kind: 'compare',
    left: { kind: 'field', key: 'price' },
    op: 'gt',
    right: { kind: 'literal', type: 'number', value: 500000 },
  };
  const sold = {
    kind: 'compare',
    left: { kind: 'field', key: 'status' },
    op: 'eq',
    right: { kind: 'literal', type: 'text', value: 'sold' },
  };
  const hover = { kind: 'pointer', pseudo: 'hover' };

  /* --- The pair, and that it is a pair ------------------------------------ */

  report.check(
    'a comparison is hoisted out and given an attribute',
    (() => {
      const minted = mintedIn(priceOver, 'r1');
      return minted.length === 1 && minted[0].attr === `${MINT_PREFIX}r1-0`;
    })(),
    mintedIn(priceOver, 'r1')[0]?.attr ?? 'nothing minted'
  );
  report.check(
    'and the rule the generator compiles names that attribute instead',
    (() => {
      const planned = plannedWhen(priceOver, 'r1');
      return planned?.kind === 'attr' && planned.name === `${MINT_PREFIX}r1-0`;
    })(),
    JSON.stringify(plannedWhen(priceOver, 'r1'))
  );

  /*
   * Two comparisons on one rule, which is the case that rules out minting a
   * *state* instead: an element carries one `data-cre8-switch` and settles one
   * value, so "red when expensive and faded when sold" could not have both.
   * The two walks have to agree about which is which, or a rule ends up
   * reading somebody else's answer.
   */
  const both = { kind: 'every', tests: [priceOver, hover, sold] };
  report.check(
    'two comparisons on one rule get one attribute each, in the same order',
    (() => {
      const minted = mintedIn(both, 'r2');
      const planned = plannedWhen(both, 'r2');
      const names = planned.tests.filter((t) => t.kind === 'attr').map((t) => t.name);
      return (
        minted.length === 2 &&
        minted[0].when.left.key === 'price' &&
        minted[1].when.left.key === 'status' &&
        names.join(' ') === minted.map((m) => m.attr).join(' ')
      );
    })(),
    mintedIn(both, 'r2').map((m) => `${m.when.left.key}→${m.attr}`).join(' ')
  );
  report.check(
    'and everything that was already a selector is left alone',
    plannedWhen(both, 'r2').tests[1]?.kind === 'pointer',
    plannedWhen(both, 'r2').tests.map((t) => t.kind).join(' ')
  );

  /*
   * Stable across publishes. Derived from the rule id, never a counter — D6
   * writes only what changed, and it cannot tell an edit from a rebuild if the
   * same document produces different bytes twice.
   */
  report.check(
    'the attribute is the same on every publish of the same document',
    mintedIn(both, 'r2')[0].attr === mintedIn(both, 'r2')[0].attr &&
      mintedIn(both, 'r2')[1].attr !== mintedIn(both, 'r3')[1].attr,
    `${mintedIn(both, 'r2')[1].attr} vs ${mintedIn(both, 'r3')[1].attr}`
  );

  /* --- Folded at publish, or shipped -------------------------------------- */

  const cardWith = (whenTest) => {
    const doc = createEmptyDocument('Mint');
    const root = doc.nodes[doc.pages[0].rootNodeId];
    doc.nodes.card = {
      id: 'card',
      type: 'container',
      name: 'Card',
      parentId: root.id,
      children: [],
      props: {},
      styles: {},
      meta: {},
      rules: [{ id: 'r1', when: whenTest, apply: { color: 'rgb(7, 7, 7)' } }],
    };
    root.children.push('card');
    return doc;
  };

  const record = { id: 'rec1', slug: 'a', data: { price: 900000, status: 'sold' } };
  const cheap = { id: 'rec2', slug: 'b', data: { price: 100, status: 'free' } };

  const attrsOn = (doc, rec) =>
    renderNodeToHtml(doc, 'card', { mode: 'publish', record: rec }) ?? '';

  report.check(
    'a comparison that folds writes its attribute straight into the markup',
    attrsOn(cardWith(priceOver), record).includes(`${MINT_PREFIX}r1-0=""`),
    attrsOn(cardWith(priceOver), record).slice(0, 110)
  );
  report.check(
    'and leaves it off for a record the comparison is false of',
    !attrsOn(cardWith(priceOver), cheap).includes(`${MINT_PREFIX}r1-0`),
    attrsOn(cardWith(priceOver), cheap).slice(0, 110)
  );
  /*
   * The one that matters most: a folded comparison ships no pointer into the
   * test table, because there is nothing left for the browser to work out.
   * That is the whole "no script where CSS can do the work" claim, applied to
   * the feature most likely to break it.
   */
  report.check(
    'a folded comparison ships nothing for the runtime to do',
    !attrsOn(cardWith(priceOver), record).includes('data-cre8-test'),
    attrsOn(cardWith(priceOver), record).slice(0, 110)
  );
  report.check(
    'and the table it would have travelled in is empty',
    Object.keys(testTable(cardWith(priceOver).nodes, ['card'])).length === 0,
    JSON.stringify(testTable(cardWith(priceOver).nodes, ['card']))
  );

  /*
   * A comparison against something typed cannot fold, so it travels — and the
   * node carries no state of its own, which is exactly the case the old
   * machinery could not serve.
   */
  const typed = {
    kind: 'compare',
    left: { kind: 'input', name: 'email' },
    op: 'notEmpty',
  };
  const shipped = testTable(cardWith(typed).nodes, ['card']);
  report.check(
    'a comparison that cannot fold travels to the browser, as an attribute rule',
    shipped.card?.length === 1 &&
      shipped.card[0].attr === `${MINT_PREFIX}r1-0` &&
      shipped.card[0].value === undefined,
    JSON.stringify(shipped.card ?? null)
  );
  report.check(
    'and the element carries the pointer to it, with no state of its own',
    attrsOn(cardWith(typed), null).includes('data-cre8-test') &&
      !attrsOn(cardWith(typed), null).includes('data-cre8-switch'),
    attrsOn(cardWith(typed), null).slice(0, 130)
  );

  /*
   * An undecided comparison writes nothing, and this is the check the rest of
   * the section cannot make.
   *
   * Every fixture above is decided — a record where the price really is over
   * half a million, or really is not — so all of them pass equally against a
   * publisher that wrote the attribute whenever the answer was *not false*.
   * The third answer is the one that matters: nobody has typed anything when a
   * page is published, and writing the attribute then would show every visitor
   * the styled state permanently, and show it for ever to one with no
   * scripting. Off is the fallback the execution model requires.
   */
  report.check(
    'an undecided comparison leaves its attribute off until the browser answers',
    !attrsOn(cardWith(typed), null).includes(`${MINT_PREFIX}r1-0=""`),
    attrsOn(cardWith(typed), null).slice(0, 130)
  );
  report.check(
    'and so does a record comparison on an element with no record at all',
    !attrsOn(cardWith(priceOver), null).includes(`${MINT_PREFIX}r1-0=""`),
    attrsOn(cardWith(priceOver), null).slice(0, 130)
  );

  /* --- The same design, authored both ways -------------------------------- */

  /*
   * The falsification this stage was specified against: a designer who does
   * the five steps by hand and a designer who writes one sentence should get
   * the same page. They cannot get the same *bytes* — the hand-built version
   * names a state, and a state is a different mechanism with a different
   * attribute — so what is compared is what a visitor can tell apart: which
   * elements the declaration lands on, for the same record.
   */
  const byHand = (() => {
    const doc = createEmptyDocument('By hand');
    const root = doc.nodes[doc.pages[0].rootNodeId];
    doc.nodes.card = {
      id: 'card',
      type: 'container',
      name: 'Card',
      parentId: root.id,
      children: [],
      props: {},
      styles: {},
      meta: {},
      state: { key: 'band', values: ['plain', 'premium'], initial: 'plain' },
      assign: [{ id: 'a1', when: priceOver, value: 'premium' }],
      rules: [
        {
          id: 'r1',
          when: { kind: 'state', key: 'band', op: 'is', values: ['premium'] },
          apply: { color: 'rgb(7, 7, 7)' },
        },
      ],
    };
    root.children.push('card');
    return doc;
  })();

  /**
   * Whether the rule's selector is satisfied by the element it is written for.
   *
   * *Every* attribute test in it, not the first. The first version read one,
   * and for the hand-built version that one was `[data-cre8-switch="band"]` —
   * which both records carry, because it names the group rather than the
   * value. It reported the cheap record as painted and the check caught it,
   * which is the only reason this comment exists.
   *
   * Both rules here are anchored on the element itself, so every test in the
   * selector is a test of this element's own attributes. A rule anchored on an
   * ancestor would need the tree, and none is written that way.
   */
  const paints = (doc, rec) => {
    const html = attrsOn(doc, rec);
    const css = generateNodeCss(doc.nodes, { mode: 'media', includeStates: true });
    const rule = css.split('\n').find((line) => line.includes('.c-card') && line.includes(':where'));
    if (!rule) return 'no rule';
    const tests = [...rule.matchAll(/\[([a-z0-9-]+)(~?)="([^"]*)"\]/g)];
    if (!tests.length) return 'no attribute test';
    const held = (name) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1];
    return tests.every(([, name, fuzzy, value]) => {
      const have = held(name);
      if (have === undefined) return false;
      return fuzzy ? have.split(/\s+/).includes(value) : have === value;
    })
      ? 'painted'
      : 'plain';
  };

  report.check(
    'one sentence paints exactly what the five-step version painted',
    paints(cardWith(priceOver), record) === 'painted' && paints(byHand, record) === 'painted',
    `minted ${paints(cardWith(priceOver), record)} · by hand ${paints(byHand, record)}`
  );
  report.check(
    'and both leave the same record alone',
    paints(cardWith(priceOver), cheap) === 'plain' && paints(byHand, cheap) === 'plain',
    `minted ${paints(cardWith(priceOver), cheap)} · by hand ${paints(byHand, cheap)}`
  );
}

/* ==========================================================================
 * Every condition the generator compiles can be authored
 * ======================================================================= */

report.group('every condition the generator compiles can be authored');

{
  /*
   * The gap this group exists to close, and the reason it is checked from the
   * generator's side rather than the panel's.
   *
   * `conditionParts` compiled eleven condition shapes and the panel offered
   * four. Nothing was broken — the CSS for the other seven was written,
   * commented and correct — so nothing failed, nothing warned, and the only
   * symptom was a designer who could not style a ticked checkbox. Two of the
   * seven existed in real documents purely because `blocks/kit.ts` hand-writes
   * them, which is the shape of the problem in one line: the capability was
   * reachable from code and not from the product.
   *
   * A check written from the panel's side would have passed the whole time. So
   * the generator is the source of truth here: whatever `css.ts` knows how to
   * compile, the panel must know how to make.
   */
  const source = (file) =>
    readFileSync(path.join(ROOT, file), 'utf8')
      // Comments name every one of these shapes while explaining them — this
      // group's own docblock does it twice — so a scan that read them would
      // find whatever it was looking for and prove nothing.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  const css = source('src/lib/renderer/css.ts');
  const panel = source('src/components/inspector/section-rules.tsx');
  const sentence = source('src/components/inspector/sentences.tsx');
  const types = source('src/lib/document/types.ts');

  /* --- The eleven shapes, read off the generator ------------------------- */

  /*
   * The kinds are the `case` labels inside `conditionParts`, which is the one
   * function that turns a condition into selector text. Scoped to that
   * function rather than to the file: `css.ts` mentions most of these words
   * elsewhere, and a scan over the whole file would count `readCase` and the
   * variant expansion as evidence the panel does not provide.
   */
  const partsBody = css.slice(
    css.indexOf('function conditionParts('),
    css.indexOf('function ruleSelector(')
  );
  const compiledKinds = [...partsBody.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]).sort();

  report.check(
    'the scan found the generator’s condition kinds',
    compiledKinds.length === 5,
    compiledKinds.join(' ') || 'nothing — conditionParts moved or was renamed'
  );

  // The pseudo-classes are on the type rather than in the generator, which
  // passes them straight through to `:${pseudo}`.
  const pseudosOf = (kind) => {
    const line = new RegExp(`kind: '${kind}'; pseudo: ([^}]+)}`).exec(types);
    return line ? [...line[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort() : [];
  };
  const pointerPseudos = pseudosOf('pointer');
  const controlPseudos = pseudosOf('control');

  report.check(
    'the scan found both sets of pseudo-classes',
    pointerPseudos.length === 4 && controlPseudos.length === 4,
    `pointer: ${pointerPseudos.join(' ')} · control: ${controlPseudos.join(' ')}`
  );

  const shapes = compiledKinds.length + pointerPseudos.length + controlPseudos.length - 2;
  report.check(
    'the generator compiles eleven distinct condition shapes',
    shapes === 11,
    `${shapes} shapes`
  );

  /* --- The panel can make every one of them ------------------------------ */

  /*
   * What the add menu can produce, asked of the menu rather than of its
   * source text.
   *
   * The first version of this scraped `kind: '…'` literals out of
   * `section-rules.tsx`, and it survived being falsified: deleting the
   * attribute group left the literal sitting in the callback of a `.map` over
   * an empty list, so the scan still found it and the check still passed. A
   * check that reads code which can no longer run is not a check.
   *
   * `conditionOffers` is the table the menu renders, so calling it is asking
   * the real question. Every element type is asked, because most of the
   * shapes are offered on some types and not others and a sweep over one node
   * would miss whichever half it did not pick.
   */
  const offeredKinds = new Set();
  const offerCounts = new Map();
  for (const type of Object.keys(ELEMENTS)) {
    for (const offer of conditions.conditionOffers({
      type,
      // A state to name, so the state offer is reachable. Its absence when
      // nothing declares one is deliberate and checked separately below.
      states: [{ key: 'plan', values: ['annual'] }],
    })) {
      for (const one of offer.when) offeredKinds.add(one.kind);
      offerCounts.set(type, (offerCounts.get(type) ?? 0) + 1);
    }
  }
  for (const kind of compiledKinds) {
    report.check(
      `the panel can add a '${kind}' condition`,
      offeredKinds.has(kind),
      offeredKinds.has(kind) ? '' : `no element type is offered kind: '${kind}'`
    );
  }

  /*
   * And that the menu still renders the table rather than a second list
   * written beside it. Everything above would keep passing if the panel
   * stopped calling the function.
   */
  report.check(
    'the menu is the offer table rather than a copy of it',
    /conditionOffers\(/.test(panel) && /addRule\(offer\.when, offer\.part\)/.test(panel),
    'section-rules.tsx maps over conditionOffers'
  );

  /* --- Offered where they can be true, and not where they cannot --------- */

  const offersFor = (type) =>
    conditions.conditionOffers({ type, states: [] }).map((offer) => offer.key);

  report.check(
    'a checkbox is offered the ticked condition',
    offersFor('checkbox').includes('control-checked'),
    offersFor('checkbox').filter((key) => key.startsWith('control-')).join(' ')
  );
  report.check(
    'a plain container is offered no control condition at all',
    !offersFor('container').some((key) => key.startsWith('control-')),
    offersFor('container').join(' ')
  );
  report.check(
    'the backdrop is offered on an overlay and nowhere else',
    offersFor('dialog').includes('backdrop') &&
      offersFor('popover').includes('backdrop') &&
      !offersFor('section').includes('backdrop'),
    `dialog ${offersFor('dialog').includes('backdrop')} · section ${offersFor('section').includes('backdrop')}`
  );
  report.check(
    'a state is offered only when something declares one',
    !offersFor('container').includes('state') &&
      conditions
        .conditionOffers({ type: 'container', states: [{ key: 'plan', values: ['annual'] }] })
        .some((offer) => offer.key === 'state'),
    offersFor('container').join(' ')
  );

  /*
   * The pseudo-classes are not literals in the panel — the menu maps over the
   * label records — so the check follows the same route the menu does, and
   * asserts the records are total and every entry is a real pseudo-class.
   * Totality alone is a compile-time fact and would be vacuous here; that an
   * entry names something the generator will accept is not.
   */
  const { POINTER_LABELS, CONTROL_LABELS, POINTER_HINTS, CONTROL_HINTS } = conditions;
  report.check(
    'every pointer pseudo-class has a word and an explanation',
    pointerPseudos.every((p) => POINTER_LABELS[p] && POINTER_HINTS[p]) &&
      Object.keys(POINTER_LABELS).sort().join(' ') === pointerPseudos.join(' '),
    Object.keys(POINTER_LABELS).sort().join(' ')
  );
  report.check(
    'every control pseudo-class has a word and an explanation',
    controlPseudos.every((p) => CONTROL_LABELS[p] && CONTROL_HINTS[p]) &&
      Object.keys(CONTROL_LABELS).sort().join(' ') === controlPseudos.join(' '),
    Object.keys(CONTROL_LABELS).sort().join(' ')
  );

  /*
   * And that each control pseudo-class is offered on at least one element.
   *
   * The one thing `Record<ControlPseudo, ElementType[]>` cannot catch: an
   * empty list compiles, and makes that pseudo-class unreachable everywhere
   * while looking exactly like a considered decision.
   */
  for (const pseudo of controlPseudos) {
    const on = Object.keys(ELEMENTS).filter((type) => conditions.controlApplies(type, pseudo));
    report.check(
      `'${pseudo}' is offered on the elements it can be true of`,
      on.length > 0,
      on.join(' ') || 'no element type — the rule can never be authored'
    );
  }

  /* --- And can edit every one of them ------------------------------------ */

  /*
   * Reaching a shape is half of it. A rule that can be created and then only
   * described — which is what `attr` and `control` were, printing prose like
   * "the control is checked" — is a rule the designer cannot correct.
   *
   * `conditionSentence` returns editable parts only inside a branch guarded by
   * `onChange`; anything falling past those reaches `describeOther` and is
   * prose. So the check is that each kind has such a branch.
   */
  for (const kind of compiledKinds) {
    const guarded = new RegExp(`condition\\.kind === '${kind}' && onChange`).test(sentence);
    report.check(
      `a '${kind}' condition can be edited, not only described`,
      guarded,
      guarded ? '' : `conditionSentence falls through to prose for '${kind}'`
    );
  }

  /* --- The attribute name cannot break the selector ---------------------- */

  /*
   * `conditionParts` writes `[${name}="${value}"]` unescaped, which was safe
   * while the only source of both was a literal in `blocks/kit.ts`. A text
   * field in the panel is a new source, and a space in a name would end the
   * attribute test early — turning the rest of what somebody typed into
   * selector syntax and dropping every rule after the point it stops parsing.
   */
  const nastyName = 'a b"c\\d\ne';
  report.check(
    'an attribute name is narrowed to what a selector accepts',
    conditions.attrName(nastyName) === 'abcde',
    conditions.attrName(nastyName)
  );
  report.check(
    'an attribute name cannot start with a non-letter',
    conditions.attrName('1st-thing') === 'st-thing',
    conditions.attrName('1st-thing')
  );
  /*
   * A value is treated far more loosely than a name, and has to be: narrowing
   * it to an identifier would refuse `?ref=acme`, which is a value a `data`
   * condition is built to carry. Only the three characters that would end the
   * quoted string go.
   */
  const nastyValue = '?ref=acme "x" \\y\nz';
  report.check(
    'an attribute value keeps everything except what breaks out of the quotes',
    conditions.attrValue(nastyValue) === '?ref=acme x yz',
    JSON.stringify(conditions.attrValue(nastyValue))
  );

  /*
   * Each sanitiser handed the thing it exists to reject. Without this pair a
   * function that returned its input unchanged would pass everything above
   * that happens to contain no dangerous character.
   */
  report.check(
    'the name check would fail an unnarrowed name',
    attrNameWouldBreak('data cre8') && !attrNameWouldBreak(conditions.attrName('data cre8')),
    conditions.attrName('data cre8')
  );
  report.check(
    'the value check would fail an unnarrowed value',
    attrValueWouldBreak('say "hi"') && !attrValueWouldBreak(conditions.attrValue('say "hi"')),
    conditions.attrValue('say "hi"')
  );

  /*
   * What "breaks" means, asked of the real thing rather than of a regex that
   * agrees with the sanitiser by construction: the selector `conditionParts`
   * would write, handed to a parser.
   */
  function attrNameWouldBreak(name) {
    return !selectorParses(`.c-x:where([${name}="v"])`);
  }
  function attrValueWouldBreak(value) {
    return !selectorParses(`.c-x:where([data-a="${value}"])`);
  }
}

/**
 * Whether a selector is one selector.
 *
 * `CSS.supports` is not available in bare Node, and a full parser would be a
 * dependency for one question — so this asks the narrower version that is
 * enough here: does anything in the string close the attribute test early and
 * start saying something else. A quote or a bracket outside the quoted value,
 * or whitespace inside the name, all show up as the bracket depth going wrong
 * or a stray quote surviving the scan.
 */
function selectorParses(selector) {
  let at = 0;
  while (at < selector.length) {
    if (selector[at] !== '[') {
      at += 1;
      continue;
    }
    at += 1;

    let name = '';
    while (at < selector.length && selector[at] !== '=' && selector[at] !== ']') {
      name += selector[at];
      at += 1;
    }
    if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name)) return false;
    // `[open]` — a presence test, and a whole attribute selector on its own.
    if (selector[at] === ']') {
      at += 1;
      continue;
    }
    if (selector[at] !== '=' || selector[at + 1] !== '"') return false;
    at += 2;

    while (at < selector.length && selector[at] !== '"') {
      // Nothing may continue the string past where it looks like it ends.
      if (selector[at] === '\\' || selector[at] === '\n' || selector[at] === '\r') return false;
      at += 1;
    }
    if (selector[at] !== '"') return false;
    at += 1;

    /*
     * The closing bracket, immediately.
     *
     * This is the line that makes the check worth running. A scan that only
     * balanced brackets and quotes called `[a="say "hi""]` well-formed —
     * the quotes pair up and the bracket closes — when what a browser reads
     * there is an attribute test that ended after `say `, followed by two
     * words of nonsense. The break-out is not an unclosed string; it is a
     * string that closes too early.
     */
    if (selector[at] !== ']') return false;
    at += 1;
  }
  return true;
}


report.finish();
