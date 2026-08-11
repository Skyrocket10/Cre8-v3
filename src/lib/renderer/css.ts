/**
 * CSS generation.
 *
 * One generator serves all three surfaces:
 *
 *   editor canvas  → `@container` queries, evaluated against the page frame
 *   preview        → `@container` queries, same frame mechanism
 *   published site → `@media` queries, evaluated against the real viewport
 *
 * Using container queries in the canvas is what makes responsive editing
 * truthful: a 390px frame really is 390px as far as the CSS is concerned, so
 * what a designer sees at "Mobile" is what ships. Everything else — the rules,
 * the cascade, the reset — is byte-for-byte identical between the two modes.
 */

import { nodeClass, stateOwner, variantClass, variantsOf } from './variants';
import {
  BREAKPOINT_DEFS,
  BREAKPOINT_ORDER,
  type Breakpoint,
  type Condition,
  type SceneNode,
  type StyleDecl,
  type StyleRule,
  type Cre8Document,
} from '../document/types';

export type QueryMode = 'media' | 'container';

export const FRAME_CONTAINER = 'cre8';

const CAMEL_RE = /[A-Z]/g;

function cssProp(prop: string): string {
  return prop.replace(CAMEL_RE, (m) => `-${m.toLowerCase()}`);
}

/**
 * Declarations that aren't 1:1 with CSS. Kept tiny on purpose — the further
 * the document format drifts from real CSS, the more the published output can
 * diverge from the canvas.
 */
function expand(prop: string, value: string): [string, string][] {
  if (prop === 'textGradient') {
    return [
      ['background-image', value],
      ['-webkit-background-clip', 'text'],
      ['background-clip', 'text'],
      ['color', 'transparent'],
    ];
  }
  return [[cssProp(prop), value]];
}

/**
 * Four-sided properties, and the order a shorthand writes them in.
 *
 * The document stores longhands because that is what the inspector edits —
 * four fields, four patches, four undo steps. CSS has a shorthand for the same
 * thing that is a third of the bytes, and on a real page these are the single
 * largest group of declarations: a card with padding and a radius spends eight
 * declarations and about 200 characters saying two things.
 *
 * Collapsed here rather than at publish so every surface emits the same
 * stylesheet. A transform that only ran for the published file would be one
 * more way the canvas and the site could quietly disagree.
 */
const FOUR_SIDED: [shorthand: string, longhands: [string, string, string, string]][] = [
  ['padding', ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']],
  ['margin', ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']],
  [
    'border-radius',
    [
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius',
    ],
  ],
];

/**
 * Rewrite complete four-sided sets as their shorthand.
 *
 * Only when **all four** are present, because a shorthand sets all four
 * whatever the author wrote — collapsing three would invent a fourth. And only
 * when no value contains a space: `10px 20px` is a legal elliptical corner
 * radius, and folding four of those into one declaration produces a different
 * shape rather than a shorter way of saying the same one.
 *
 * Order is preserved by putting the shorthand where the first of its longhands
 * was. Anything after it that touches the same box still wins, which is what
 * the caller wrote and what the longhands did.
 */
function collapseFourSided(pairs: [string, string][]): [string, string][] {
  const byProp = new Map(pairs);
  const replaced = new Map<string, string>();
  const dropped = new Set<string>();

  for (const [shorthand, longhands] of FOUR_SIDED) {
    const values = longhands.map((prop) => byProp.get(prop));
    if (values.some((value) => value === undefined || /\s/.test(value))) continue;
    const [top, right, bottom, left] = values as [string, string, string, string];
    const value =
      top === right && right === bottom && bottom === left
        ? top
        : top === bottom && right === left
          ? `${top} ${right}`
          : `${top} ${right} ${bottom} ${left}`;
    replaced.set(longhands[0], `${shorthand}:${value}`);
    for (const prop of longhands.slice(1)) dropped.add(prop);
  }

  if (!replaced.size) return pairs;
  const out: [string, string][] = [];
  for (const [prop, value] of pairs) {
    const swap = replaced.get(prop);
    if (swap) out.push([swap.slice(0, swap.indexOf(':')), swap.slice(swap.indexOf(':') + 1)]);
    else if (!dropped.has(prop)) out.push([prop, value]);
  }
  return out;
}

export function declarationsToCss(styles: StyleDecl, indent = '  '): string {
  const pairs: [string, string][] = [];
  for (const [prop, value] of Object.entries(styles)) {
    if (value === undefined || value === null || value === '') continue;
    for (const [name, resolved] of expand(prop, String(value))) pairs.push([name, resolved]);
  }
  return collapseFourSided(pairs)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}

/** Inline-style object, used for the page frame's token variables. */
export function declarationsToStyleObject(styles: StyleDecl): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, value] of Object.entries(styles)) {
    if (value === undefined || value === null || value === '') continue;
    for (const [name, resolved] of expand(prop, String(value))) out[name] = resolved;
  }
  return out;
}

function atRule(mode: QueryMode, breakpoint: Breakpoint): string | null {
  const def = BREAKPOINT_DEFS[breakpoint];
  if (def.maxWidth === null) return null;
  return mode === 'media'
    ? `@media (max-width: ${def.maxWidth}px)`
    : `@container ${FRAME_CONTAINER} (max-width: ${def.maxWidth}px)`;
}

/* --------------------------------------------------------------------------
 * Per-node rules, memoised
 * ----------------------------------------------------------------------- */

/** A rule the generator has not yet decided how to print. */
interface Emitted {
  selector: string;
  body: string;
}

interface NodeRules {
  base: Emitted | null;
  /** Keyed by breakpoint, base excluded. */
  responsive: Partial<Record<Breakpoint, Emitted>>;
}

/**
 * Immer gives us a new object only for nodes that actually changed, so keying
 * the cache on node identity makes regeneration proportional to the size of
 * the edit rather than the size of the document.
 */
const ruleCache = new WeakMap<SceneNode, NodeRules>();

function rulesFor(node: SceneNode, selectorPrefix: string): NodeRules {
  const cached = ruleCache.get(node);
  if (cached) return cached;

  const selector = `${selectorPrefix}.${nodeClass(node.id)}`;
  const baseBody = declarationsToCss(node.styles.desktop ?? {});

  const responsive: Partial<Record<Breakpoint, Emitted>> = {};
  for (const bp of BREAKPOINT_ORDER) {
    if (bp === 'desktop') continue;
    const layer = node.styles[bp];
    if (!layer || Object.keys(layer).length === 0) continue;
    const body = declarationsToCss(layer, '    ');
    if (body) responsive[bp] = { selector, body };
  }

  const rules: NodeRules = {
    base: baseBody ? { selector, body: baseBody } : null,
    responsive,
  };
  ruleCache.set(node, rules);
  return rules;
}

/**
 * Print a phase, merging rules that say exactly the same thing.
 *
 * A library page is mostly repetition — twelve links styled identically, six
 * cards with the same padding — and each one currently gets its own copy of
 * the declarations. Sharing a selector cuts about a third off the stylesheet.
 *
 * **Only safe within a phase, and that is the whole subtlety.** Merging moves
 * the later rule up to where the first one sits, and since stage 1 made source
 * order the entire cascade, moving a rule is changing what wins. Inside the
 * base layer, and inside each breakpoint layer, every node contributes at most
 * one rule and every selector is a different node's class — disjoint sets, so
 * nothing can be reordered relative to anything that matches the same element.
 * The conditional phase has neither property: a node can carry several rules,
 * and a variant's class matches an element that its node's class matches too.
 * So that phase is printed as it stands. See `generateNodeCss`.
 */
function printInOrder(rules: Emitted[], indent: string): string {
  return rules
    .map(({ selector, body }) => `${indent}${selector} {\n${body}\n${indent}}`)
    .join('\n');
}

function printPhase(rules: Emitted[], indent: string): string {
  const order: { selectors: string[]; body: string }[] = [];
  const byBody = new Map<string, { selectors: string[]; body: string }>();

  for (const { selector, body } of rules) {
    const found = byBody.get(body);
    if (found) {
      found.selectors.push(selector);
      continue;
    }
    const entry = { selectors: [selector], body };
    byBody.set(body, entry);
    order.push(entry);
  }

  return order
    .map(({ selectors, body }) => `${indent}${selectors.join(',')} {\n${body}\n${indent}}`)
    .join('\n');
}

/* --------------------------------------------------------------------------
 * Conditional rules
 * ----------------------------------------------------------------------- */

/**
 * A condition, as the fragment of selector it contributes.
 *
 * Two fragments, because they land in different places. State conditions
 * match an *ancestor*, so they prefix the element; everything else joins the
 * element's own compound. Both are wrapped in `:where()` — see
 * `ruleSelector` for why that matters more than it looks.
 */
function conditionParts(
  nodes: Record<string, SceneNode>,
  node: SceneNode,
  condition: Condition
): { prefix: string; compound: string } | null {
  switch (condition.kind) {
    case 'pointer':
      return { prefix: '', compound: `:where(:${condition.pseudo})` };

    case 'control': {
      /*
       * `:checked` is on the input; the class is on what wraps it.
       *
       * A checkbox and a radio render as a `<label>` holding the real control
       * and its words, because that is what makes the words a hit target. So
       * the node's class lands on the label, and `.c-abc:where(:checked)` —
       * which is what this used to emit — is a selector that compiles, ships,
       * and can never match anything. A styled "on" state simply did nothing,
       * with no error anywhere to say why.
       *
       * `:has()` asks the question the right way round: not "is this label
       * checked" but "does it contain something that is".
       */
      const wraps = node.type === 'checkbox' || node.type === 'radio';
      return {
        prefix: '',
        compound: wraps
          ? `:where(:has(:${condition.pseudo}))`
          : `:where(:${condition.pseudo})`,
      };
    }

    case 'attr': {
      // Several values mean *any of them*, the same as a state — so `:is()`
      // both ways. Joining them into one compound would read as "all of
      // them", which for a plain attribute can never be true.
      const match = condition.values.map((value) => `[${condition.name}="${value}"]`).join(',');
      const test = condition.op === 'is' ? `:is(${match})` : `:not(:is(${match}))`;
      return { prefix: '', compound: `:where(${test})` };
    }

    case 'data': {
      // The whole of stage 3 in the generator. A data source resolves to a
      // value on the document element, so the test is the one a state already
      // uses — `:is()` either way so `is` and `isn't` weigh the same — hung
      // off an ancestor that is always there rather than one found by walking.
      const match = condition.values
        .map((value) => `[data-cre8-data~="${condition.source}:${value}"]`)
        .join(',');
      const test = condition.op === 'is' ? `:is(${match})` : `:not(:is(${match}))`;
      return { prefix: `:where(${test}) `, compound: '' };
    }

    case 'state': {
      const owner = stateOwner(nodes, node, condition.key);
      // Naming a state nothing declares is not an error to shout about — it
      // happens mid-edit, while the designer is still typing the name — but
      // it must not silently become "always". Dropping the whole rule is the
      // honest reading of a condition that cannot be evaluated.
      if (!owner) return null;
      const match = condition.values.map((value) => `[data-cre8-value~="${value}"]`).join(',');
      // `:is()` takes the highest specificity of its arguments, so a case
      // answering to three values weighs what a one-value case weighs — where
      // chained `:not(a):not(b)` would have quietly out-ranked it.
      const test = condition.op === 'is' ? `:is(${match})` : `:not(:is(${match}))`;
      const anchor = `:where([data-cre8-switch="${owner.key}"]):where(${test})`;
      // A node can depend on the state it declares itself — that is what a
      // dismissible banner is — and then the anchor joins its compound
      // instead of prefixing it, because an element is not inside itself.
      return owner.self ? { prefix: '', compound: anchor } : { prefix: `${anchor} `, compound: '' };
    }
  }
}

/**
 * The selector for one rule, padded so that order is the whole of precedence.
 *
 * Every condition goes through `:where()`, which contributes nothing to
 * specificity, so every rule on a node weighs exactly what the node's base
 * rule weighs — (0,1,0), the class alone. That is deliberate. Before this,
 * a visibility rule scored (0,3,0) and a hover rule (0,2,0), so a state
 * silently beat a hover however they were written; the two rarely collided,
 * and would have collided constantly now that they sit in one list looking
 * like peers.
 *
 * With everything level, the cascade falls back to source order, and source
 * order is the order the panel shows. `null` when a condition cannot be
 * resolved.
 */
function ruleSelector(
  nodes: Record<string, SceneNode>,
  node: SceneNode,
  rule: StyleRule,
  prefix: string,
  /** Which element the rule lands on: the node, or one of its variants. */
  className: string
): string | null {
  let before = '';
  let after = '';
  for (const condition of rule.when) {
    const parts = conditionParts(nodes, node, condition);
    if (!parts) return null;
    before += parts.prefix;
    after += parts.compound;
  }
  const part = rule.part ? `::${rule.part}` : '';
  return `${prefix}${before}.${className}${after}${part}`;
}

/** True when nothing about the rule depends on where the pointer is. */
function isInteraction(rule: StyleRule): boolean {
  return rule.when.some((c) => c.kind === 'pointer');
}

/* --------------------------------------------------------------------------
 * Document stylesheet
 * ----------------------------------------------------------------------- */

export interface GenerateCssOptions {
  mode: QueryMode;
  /** Restrict output to these nodes (a single page + the components it uses). */
  nodeIds?: Iterable<string>;
  /** Prefix every selector, e.g. `.cre8-doc` to scope preview output. */
  scope?: string;
  /** Emit hover/active/focus rules. Off inside the editor canvas. */
  includeStates?: boolean;
}

export function generateNodeCss(
  nodes: Record<string, SceneNode>,
  options: GenerateCssOptions
): string {
  const prefix = options.scope ? `${options.scope} ` : '';
  const ids = options.nodeIds ? [...options.nodeIds] : Object.keys(nodes);

  const baseRules: Emitted[] = [];
  const ruleChunks: string[] = [];
  const responsiveRules: Partial<Record<Breakpoint, Emitted[]>> = {};
  /**
   * Breakpoints that received a *conditional* rule as well as base overrides.
   *
   * That phase then has the same two problems the conditional phase has — more
   * than one rule per node, and selectors that overlap — so it loses the
   * property that makes merging safe and is printed in order instead. Rare
   * enough in practice that the saving is unaffected, and cheap enough to
   * track that guessing would be the wrong trade.
   */
  const mixed = new Set<Breakpoint>();

  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    const cached = rulesFor(node, prefix);
    if (cached.base) baseRules.push(cached.base);
    for (const bp of BREAKPOINT_ORDER) {
      const chunk = cached.responsive[bp];
      if (!chunk) continue;
      (responsiveRules[bp] ??= []).push(chunk);
    }

    /*
     * A node that changes content by condition renders as several elements,
     * and each needs the rule that hides it when its condition fails. Those
     * rules are synthesised rather than stored, but they are ordinary rules
     * and go through the same compiler — the generator learns nothing about
     * variants beyond which class to put them on.
     */
    const variants = variantsOf(node);
    const owners = new Map<string, string>();
    if (variants.length > 1) {
      for (const variant of variants) {
        if (variant.ruleId) owners.set(variant.ruleId, variantClass(node.id, variant.key));
        if (!variant.hide) continue;
        const selector = ruleSelector(
          nodes,
          node,
          variant.hide,
          prefix,
          variantClass(node.id, variant.key)
        );
        const body = selector && declarationsToCss(variant.hide.apply);
        if (selector && body) ruleChunks.push(`${selector} {\n${body}\n}`);
      }
    }

    for (const rule of node.rules ?? []) {
      // The canvas suppresses interaction rules: hovering over the page while
      // designing it is aiming, not using, and watching every button light up
      // under the cursor makes the layout harder to read rather than easier.
      // State rules stay — a selected tab has to look selected.
      if (options.includeStates === false && isInteraction(rule)) continue;
      if (Object.keys(rule.apply).length === 0) continue;

      // A rule that produced a variant styles *that* element. Its condition is
      // already what puts the variant on screen, so restating it would be
      // redundant — but harmless, and leaving it in keeps one code path.
      const className = owners.get(rule.id) ?? nodeClass(node.id);
      const selector = ruleSelector(nodes, node, rule, prefix, className);
      if (!selector) continue;

      if (rule.breakpoint && rule.breakpoint !== 'desktop') {
        const body = declarationsToCss(rule.apply, '    ');
        if (body) {
          (responsiveRules[rule.breakpoint] ??= []).push({ selector, body });
          mixed.add(rule.breakpoint);
        }
        continue;
      }
      const body = declarationsToCss(rule.apply);
      if (body) ruleChunks.push(`${selector} {\n${body}\n}`);
    }
  }

  const out: string[] = [];
  if (baseRules.length) out.push(printPhase(baseRules, ''));

  // Narrow breakpoints emitted before the rules and after the base, so that
  // at equal specificity the cascade reads: what it is, then what it is when
  // narrow, then what it is when something is true.
  for (const bp of BREAKPOINT_ORDER) {
    const rules = responsiveRules[bp];
    if (!rules?.length) continue;
    const body = mixed.has(bp) ? printInOrder(rules, '  ') : printPhase(rules, '  ');
    const rule = atRule(options.mode, bp);
    out.push(rule ? `${rule} {\n${body}\n}` : body);
  }

  // Printed as it stands, not merged: a node can carry several of these and a
  // variant class matches an element its node class matches too, so moving one
  // up to join another would change which of them wins.
  if (ruleChunks.length) out.push(ruleChunks.join('\n'));
  return out.join('\n\n');
}

/* --------------------------------------------------------------------------
 * Document reset
 * ----------------------------------------------------------------------- */

/**
 * The baseline every Cre8 page sits on, in the canvas and in production. Kept
 * deliberately small: it normalises the handful of defaults that make visual
 * editing unpredictable and nothing else.
 */
/**
 * The reset, written so it can never outrank a node's own styles.
 *
 * Every scope goes through `:where()`, which contributes nothing to
 * specificity. That matters more than it looks: a bare `[data-cre8-root] a`
 * scores (0,1,1) and beats the per-node class at (0,1,0), so a reset line as
 * innocent as `a { color: inherit }` silently wins over the colour the designer
 * set — a primary button renders with the page's text colour instead of its
 * own.
 *
 * With `:where()` these are type selectors at (0,0,1): they still establish the
 * baseline, and any node rule beats them.
 *
 * It also has to be *complete*. The canvas renders inside the editor app, whose
 * Tailwind preflight already zeroes margin, padding and border on everything;
 * a published page has no Tailwind at all. Anything the reset leaves to the
 * user-agent therefore renders one way in the editor and another way once
 * shipped — a border side with no explicit width computed to `0` on the canvas
 * and to `medium` (3px) in production. So the universal baseline is stated
 * here rather than inherited from whatever stylesheet happens to be nearby,
 * and every surface loads this file.
 *
 * That makes the form-control block below a *parity list*, not a taste
 * decision: it is Tailwind's preflight, restated for the elements a document
 * can contain. Preflight sets `background-color: transparent` on every
 * control, so on the canvas a slider had none and in production it had the
 * user agent's white — a white bar behind the track, invisible on a white page
 * and obvious on a dark one. The placeholder colour, the search decoration,
 * the number spinners and `summary { display: list-item }` are the same story.
 * Anything preflight does that this does not is a difference between the two
 * surfaces waiting to be found. Left out on purpose: the `::-webkit-datetime-*`
 * padding rules, which only bite in Safari and cannot be verified by a suite
 * running Chromium — worth revisiting with a browser that can prove it.
 *
 * The root's own `font-size` and `line-height` are part of that. The canvas
 * renders inside the editor's chrome, which runs at 12px because that is a
 * sensible size for a tool; a published page inherits the browser's 16px. Left
 * to inherit, every unstyled run of text and every `em` in the document — the
 * `1.25em` list indent below included — resolved to a different number on each
 * surface. Production is the truth, so both are pinned to it.
 *
 * `[id]` is every scroll target: the only ids a document emits are a named
 * section's and a popover's, and a popover is fixed rather than scrolled to.
 * The offset is what a link into the middle of a page needs so the heading it
 * landed on is not sitting under a sticky navbar — the failure is that the
 * page moves and the visitor still cannot see what they clicked. 96px clears
 * the navbars this app produces; with no sticky header it reads as breathing
 * room above the section rather than as a mistake. At (0,0,1) a node that sets
 * its own `scroll-margin-top` beats it.
 *
 * The `@supports not` block at the end is the other rule that has to outrank a
 * node class, and for a sharper reason than the popover below. A panel that
 * asked to be anchored carries `position-area` in its own styles and `inset:
 * auto` with it; a browser that cannot parse `position-area` drops it and
 * leaves a fixed box with no insets, which lands at whatever its static
 * position happens to be — usually the top-left corner, over the logo. So the
 * fallback has to *win*, not merely exist, and it turns the panel into the
 * same full-width sheet under the top edge that the mobile menu already uses:
 * a menu rather than an accident. Where anchoring works the block is not
 * there at all, so it costs nothing to reason about.
 *
 * The one line that is deliberately *not* wrapped in `:where()` is the closed
 * popover. A user-agent rule loses to any author rule regardless of
 * specificity, so the browser's own `[popover]:not(:popover-open) { display:
 * none }` is beaten by the `display: flex` on the popover's node class — and
 * the panel that should stay hidden until a button opens it is simply always
 * on the page. Restating it at (0,2,0) puts it back above the node rule at
 * (0,1,0). It cannot match on the canvas, where the element is rendered
 * without the attribute precisely so its contents can be edited.
 */
export const DOCUMENT_RESET = `
*, *::before, *::after { box-sizing: border-box; }
:where([data-cre8-root]), :where([data-cre8-root]) *, :where([data-cre8-root]) *::before, :where([data-cre8-root]) *::after { margin: 0; padding: 0; border: 0 solid; }
:where([data-cre8-root]) { font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
:where([data-cre8-root]) :is(ul, ol) { padding-left: 1.25em; }
:where([data-cre8-root]) :is(img, video, svg) { max-width: 100%; }
:where([data-cre8-root]) :is(img, video) { display: block; }
:where([data-cre8-root]) a { color: inherit; text-decoration: none; }
:where([data-cre8-root]) :focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; }
:where([data-cre8-root]) [id] { scroll-margin-top: 96px; }

/* Form controls — parity with the preflight the canvas gets and production does not. */
:where([data-cre8-root]) button { font: inherit; color: inherit; background: none; cursor: pointer; }
:where([data-cre8-root]) :is(input, textarea, select) { font: inherit; letter-spacing: inherit; color: inherit; background-color: transparent; border-radius: 0; }
:where([data-cre8-root]) ::placeholder { opacity: 1; color: color-mix(in srgb, currentColor 45%, transparent); }
:where([data-cre8-root]) ::-webkit-search-decoration { -webkit-appearance: none; }
:where([data-cre8-root]) :is(::-webkit-inner-spin-button, ::-webkit-outer-spin-button) { height: auto; }
:where([data-cre8-root]) textarea { resize: vertical; }
:where([data-cre8-root]) summary { display: list-item; }

/* Controls whose parts the page cannot otherwise reach. */
:where([data-cre8-root]) input[type="file"]::file-selector-button { font: inherit; font-size: 0.92em; font-weight: 550; margin-right: 12px; padding: 6px 12px; border: 0; border-radius: var(--r-sm); background: var(--c-primary); color: var(--c-on-primary); cursor: pointer; }
:where([data-cre8-root]) progress { appearance: none; -webkit-appearance: none; display: block; }
:where([data-cre8-root]) progress::-webkit-progress-bar { background: transparent; }
:where([data-cre8-root]) progress::-webkit-progress-value { background: currentColor; }
:where([data-cre8-root]) progress::-moz-progress-bar { background: currentColor; }

/* Elements that own a child the document does not: legend, caption, summary. */
:where([data-cre8-root]) fieldset { min-width: 0; }
:where([data-cre8-root]) legend { padding-left: 6px; padding-right: 6px; }
:where([data-cre8-root]) caption { text-align: inherit; padding-bottom: 10px; }

/* Not :where() — see above. This one has to outrank the node's own display. */
[data-cre8-root] [popover]:not(:popover-open) { display: none; }

/* Anchored panels, where the browser cannot anchor them. Also not :where(). */
@supports not (position-area: block-end) {
  [data-cre8-root] [data-cre8-anchor] {
    inset: 0;
    margin: 0 0 auto 0;
    width: 100%;
    max-width: none;
    border-radius: 0;
  }
}
`.trim();

/**
 * The reset a *published* document needs on top of `DOCUMENT_RESET`.
 *
 * In the editor the page root lives inside a frame element, which carries no
 * user-agent margin. Published, that same root sits directly in `<body>` —
 * which every browser gives `margin: 8px`. Without this a full-bleed section is
 * inset by 8px on every side and the page overflows its own viewport
 * horizontally, so the canvas and the published page disagree about where the
 * page begins.
 *
 * Deliberately separate from `DOCUMENT_RESET`, because that one is also
 * injected into the editor page, where `body` is the *editor's* body and must
 * not be touched.
 *
 * Smooth scrolling belongs here for the same reason. It is a property of the
 * scrolling element, which published is `html` and in the editor is a pane of
 * the app — and an editor whose whole canvas eases when a panel jumps is an
 * editor that feels slow. Turned off outright under `prefers-reduced-motion`:
 * a full-page slide is one of the movements that actually makes people ill,
 * and unlike a decorative animation it cannot be looked away from.
 */
export const PUBLISHED_DOCUMENT_RESET = `
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; padding: 0; }
`.trim();

/**
 * The floor an empty image slot is given so it stays visible and clickable.
 *
 * Exported because it is a trap as well as a feature: it beats an explicit
 * `height` on the node, so an image deliberately sized smaller than this comes
 * out the wrong shape until a real source is set. The static checks know the
 * number so a block cannot fall into it silently.
 */
export const PLACEHOLDER_MIN_HEIGHT = 120;

/** Styles for the placeholder shown where an image has no source yet. */
export const PLACEHOLDER_CSS = `
[data-cre8-placeholder] {
  display: flex; align-items: center; justify-content: center;
  background:
    repeating-linear-gradient(45deg, rgba(120,130,150,0.07) 0 8px, rgba(120,130,150,0.02) 8px 16px);
  color: rgba(90,100,120,0.75);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px; letter-spacing: 0.02em;
  min-height: ${PLACEHOLDER_MIN_HEIGHT}px;
}
`.trim();

/* --------------------------------------------------------------------------
 * Whole-document stylesheet
 * ----------------------------------------------------------------------- */

export interface DocumentStylesheetOptions extends GenerateCssOptions {
  /** Emit `:root { --c-…: … }` from the theme. */
  themeVars?: string;
  rootSelector?: string;
  /**
   * The page root is the document body, not a frame inside one — so the
   * document's own margins have to go. True for published files; false for the
   * editor and preview, which render into a page that is not theirs.
   */
  standalone?: boolean;
}

export function generateStylesheet(
  doc: Cre8Document,
  options: DocumentStylesheetOptions
): string {
  const parts = options.standalone
    ? [PUBLISHED_DOCUMENT_RESET, DOCUMENT_RESET, PLACEHOLDER_CSS]
    : [DOCUMENT_RESET, PLACEHOLDER_CSS];
  if (options.themeVars) {
    parts.unshift(`${options.rootSelector ?? ':root'} {\n${options.themeVars}\n}`);
  }
  parts.push(generateNodeCss(doc.nodes, options));
  return parts.filter(Boolean).join('\n\n');
}

/** Minify enough to matter for published output without needing a dependency. */
export function minifyCss(css: string): string {
  return (
    css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{};>])\s*/g, '$1')
      .replace(/\s*,\s*/g, ',')
      // Colons are collapsed only *inside* a declaration block. In a selector a
      // space before one is a descendant combinator, so squeezing it turns
      // `.card :focus-visible` into `.card:focus-visible` — a different rule
      // that matches the wrong element and fails silently.
      .replace(/\{([^{}]*)\}/g, (_, body: string) => `{${body.replace(/\s*:\s*/g, ':')}}`)
      .replace(/;}/g, '}')
      .trim()
  );
}
