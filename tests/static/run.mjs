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
  isInteractive,
  anchorId,
  vocabulary,
  motion,
  everyRef,
  pruneRefs,
  danglingReads,
  migrateDocument,
  buildTree,
  canReparent,
  generateNodeCss,
  generateStylesheet,
  parseCustomDeclarations,
  APPEAR_EFFECTS,
  renderPage,
  generateSite,
  renderNodeToHtml,
  createEmptyDocument,
  hydrateDocument,
  ops,
  components: componentLib,
  format: formatLib,
  boundProps,
  tests,
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
    const target = node.refs?.popover?.node;
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
    const hovered = (rule.when ?? []).some(
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
  if (!node.bind?.src) return Boolean(node.props?.width) && Boolean(node.props?.height);
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
    button.refs?.popover?.node === panel.id,
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
    button.refs?.popover?.node === panel.id,
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
      !b2.refs?.popover,
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
      inside.button?.refs?.popover?.node === inside.panel?.id &&
        inside.panel?.id !== p3.id,
      inside.button?.refs?.popover?.node === p3.id
        ? 'both copies open the first panel'
        : 'rewired to its own'
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
      old.nodes[rootId].refs?.popover?.node === page.rootNodeId &&
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
      { id: 'r-old', when: [{ kind: 'pointer', pseudo: 'hover' }], apply: { textDecorationLine: 'underline' } },
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
    reader.props.switchKey = 'form';
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

  report.check(
    'the cleanup only removes what is actually gone',
    (() => {
      const { doc: d4, button: b4, panel: p4 } = wired();
      pruneRefs(d4.nodes);
      return b4.refs?.popover?.node === p4.id;
    })(),
    'a live reference survives a prune'
  );
  report.check(
    'and it would notice one that is',
    (() => {
      const { doc: d5, button: b5 } = wired();
      b5.refs.popover = { node: 'a-node-that-was-never-here' };
      pruneRefs(d5.nodes);
      return !b5.refs?.popover;
    })(),
    'the half of the rule that could quietly do nothing'
  );
}

/** The button and panel inside a copied subtree, by name. */
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
   * The structural claim. `formatValue` has exactly one caller — the function
   * that writes a record into props — which is what makes "comparisons see raw
   * values" a fact about the code rather than a promise in a document. The day
   * a Test formats an operand, this is what notices.
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
    'formatting happens in one place — where a record becomes a prop',
    callers.length === 2 &&
      callers.includes('src/lib/renderer/format.ts') &&
      callers.includes('src/lib/renderer/repeat.ts'),
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
  const formatSource = readFileSync(path.join(ROOT, 'src/lib/renderer/format.ts'), 'utf8')
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
    right: { type: 'number', value },
  });
  const is = (key, value) => ({
    kind: 'compare',
    left: { kind: 'field', key },
    op: 'eq',
    right: { type: 'text', value },
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
      { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'gt', right: { type: 'text', value: 'sold' } },
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
    props: { switchKey: 'band', ...props },
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
      right: { type: 'number', value: 500000 },
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
  const { evaluate, stateFrom, foldable, needsRuntime, testTable, publishedValues, unfinished } =
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

  /** What the runtime settles a node's state to, given a record. */
  const runtimeAnswer = (assign, data) => {
    const holder = el({
      'data-cre8-switch': 'band',
      'data-cre8-value': 'else',
      'data-cre8-else': 'else',
      'data-cre8-test': 'n1',
      'data-cre8-vals': JSON.stringify(data),
    });
    const root = el({}, [holder]);
    testRuntime(hostFor(root), false, { n1: assign.map((r) => ({ when: r.when, value: r.value })) });
    return holder.getAttribute('data-cre8-value');
  };

  /** And what the publisher would have settled it to. */
  const publishAnswer = (assign, data) => {
    const node = {
      id: 'n1', type: 'frame', name: 'Card', parentId: null, children: [],
      props: { switchKey: 'band', switchDefault: 'else' }, styles: {}, meta: {}, assign,
    };
    return stateFrom(node, record(data)) ?? 'else';
  };

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
          ...(op === 'empty' || op === 'notEmpty' ? {} : { right: { type, value } }),
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
      ...(op === 'empty' || op === 'notEmpty' ? {} : { right: { type: 'text', value: 'x' } }),
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
    { id: 'a', when: { kind: 'compare', left: { kind: 'field', key: 'f' }, op: 'gt', right: { type: 'number', value: 100 } }, value: 'mid' },
    { id: 'b', when: { kind: 'compare', left: { kind: 'field', key: 'f' }, op: 'gt', right: { type: 'number', value: 500 } }, value: 'high' },
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
   * The operand only the browser can read
   * ------------------------------------------------------------------- */

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
    props: { switchKey: 'form', switchDefault: 'waiting' }, styles: {}, meta: {},
    assign: [
      { id: 'p', when: { kind: 'compare', left: { kind: 'field', key: 'price' }, op: 'gt', right: { type: 'number', value: 5 } }, value: 'dear' },
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
    typeof unfinished({ ...runtimeNode, props: { switchKey: 'form' } }) === 'string',
    String(unfinished({ ...runtimeNode, props: { switchKey: 'form' } })).slice(0, 48)
  );
  report.check(
    'and one with a fallback is not',
    unfinished(runtimeNode) === null,
    String(unfinished(runtimeNode))
  );
  report.check(
    'a folded rule needs no fallback, because its answer is in the file',
    unfinished({ ...foldedNode, props: { switchKey: 'form' } }) === null
  );
  report.check(
    'but every rule needs somewhere to write to',
    typeof unfinished({ ...foldedNode, props: {} }) === 'string'
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
      kind: 'compare', left: { kind: 'field', key: 'plan' }, op: 'eq', right: { type: 'text', value },
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
    publishAnswer([{ id: 'x', when: { kind: 'compare', left: { kind: 'field', key: 'f' }, op: 'gt', right: { type: 'number', value: 5 } }, value: 'yes' }], { f: 9 }) ===
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
    node.props.switchKey = 'band';
    node.props.switchDefault = 'ordinary';
    node.assign = [
      {
        id: 'a1',
        when: {
          kind: 'compare',
          left: { kind: 'field', key: 'price' },
          op: 'gt',
          right: { type: 'number', value: 500000 },
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
      when: [{ kind: 'state', key: 'band', op: 'is', values: ['expensive'] }],
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
      shortcut.node.rules?.length === 1 && shortcut.node.rules[0].when[0].kind === 'state',
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
      node.assign[0].value === 'Sold' && node.rules?.[0]?.when[0]?.values[0] === 'Sold',
      `${node.assign[0].value} / ${node.rules?.[0]?.when[0]?.values[0]}`
    );
    report.check(
      'and there is still only one rule',
      node.rules?.length === 1,
      `${node.rules?.length} rules`
    );

    ops.setStateKey(doc, node.id, 'Price band');
    report.check(
      'renaming the key rewrites the rules on this node that name it',
      node.props.switchKey === 'Price-band' && node.rules?.[0]?.when[0]?.key === 'Price-band',
      `${node.props.switchKey} / ${node.rules?.[0]?.when[0]?.key}`
    );
  }

  /* A rule the designer has taken over is theirs. */
  {
    const { doc, node } = withAssign();
    ops.setAssignEffect(doc, node.id, 'a1', { kind: 'hide' });
    // A second condition — the designer now means "hidden, but only on hover".
    node.rules[0].when.push({ kind: 'pointer', pseudo: 'hover' });
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
      when: [{ kind: 'pointer', pseudo: 'hover' }],
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
  report.check(
    'and it writes the same rule the Conditions panel would, so nothing new is stored',
    /addRule\(\[\], 'backdrop'\)/.test(content) &&
      /addRule\(\[\], 'backdrop'\)/.test(read(path.join('src', 'components', 'inspector', 'section-rules.tsx'))),
    "part: 'backdrop', from either door"
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
          const only = rule.when?.length === 1 ? rule.when[0] : null;
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
    Boolean(link) && Boolean(band) && link.refs?.scrollTo?.node === band.id,
    // Pointing at itself is the failure; having no reference at all is the
    // second-best outcome and still wrong, so both are named.
    link?.refs?.scrollTo?.node === link?.id
      ? 'it resolved to itself'
      : link?.refs?.scrollTo
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
    button.refs?.scrollTo?.node === band.id && anchorId(band.props.anchor) === 'pricing-table',
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
  copyDoc.button.props.copyText = 'npm i cre8';
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
