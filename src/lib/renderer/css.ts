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
import { branchesOf } from '../document/when';
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
/**
 * The named reveals, and the one place their identifiers are written.
 *
 * A closed set because the value ends up inside a CSS identifier. The control
 * that writes it is a menu, so nothing in the editor can produce anything else
 * — but a document is JSON and arrives from disk, so an unknown name emits no
 * animation at all rather than a rule built around whatever the file said.
 */
export const APPEAR_EFFECTS = ['fade', 'rise', 'zoom', 'left', 'right'] as const;

function expand(prop: string, value: string): [string, string][] {
  if (prop === 'appear') {
    if (!(APPEAR_EFFECTS as readonly string[]).includes(value)) return [];
    return [
      /*
       * `both` matters more than it looks. Backwards fill is what holds the
       * element at its `from` state before the animation's range begins —
       * without it a card below the fold is drawn at full opacity, then snaps
       * to transparent the moment it enters the range, which reads as a flash
       * rather than a reveal.
       */
      ['animation', `cre8-ap-${value} 600ms ease-out both`],
      ['animation-timeline', 'view()'],
      // Finished a third of the way up, not at the top of the screen: an
      // element that only completes as it leaves is one nobody sees arrive.
      ['animation-range', 'entry 0% cover 30%'],
    ];
  }
  if (prop === 'textGradient') {
    return [
      ['background-image', value],
      ['-webkit-background-clip', 'text'],
      ['background-clip', 'text'],
      ['color', 'transparent'],
    ];
  }
  if (prop === 'placeItems') {
    /*
     * Written as its longhands rather than passed through.
     *
     * `place-items` is a shorthand over `align-items` and `justify-items`, and
     * all three are rows in the panel. As a shorthand it wipes whichever
     * longhand was set before it and loses to whichever was set after, so
     * which of the three rows a designer sees obeyed depended on the order the
     * keys happened to sit in — the same hazard as a clamp beside a display,
     * and invisible for the same reason.
     *
     * Expanded here it is just two declarations, `lastWins` picks the later,
     * and the panel's three rows describe one state. One value covers both
     * axes; two are `align` then `justify`, which is the shorthand's order.
     */
    const [block = value, inline = block] = value.trim().split(/\s+/);
    return [
      ['align-items', block],
      ['justify-items', inline],
    ];
  }
  if (prop === 'hyphens') {
    // Both spellings, for the same reason `background-clip` above has both:
    // Safari only dropped the prefix in 17, and a hyphen that appears on one
    // browser and not another is a line-break difference, not a nicety.
    return [
      ['-webkit-hyphens', value],
      ['hyphens', value],
    ];
  }
  if (prop === 'lineClamp') {
    /*
     * Truncation, which no browser will do from one declaration.
     *
     * `-webkit-line-clamp` is a twenty-year-old property that only works
     * inside `display: -webkit-box` with a vertical box orientation and a
     * hidden overflow, and the standard `line-clamp` that finally replaces it
     * is too new to rely on alone. So the document holds the number a designer
     * thinks in and the generator writes the incantation, which is the same
     * bargain `appear` and `textGradient` make.
     *
     * `none` is the way to say "not clamped *here*" at a narrower breakpoint,
     * where clearing the row inherits the wider layer instead. It deliberately
     * does not restore `display`: guessing what the element was before would
     * be wrong wherever the guess is wrong, and an unclamped `-webkit-box`
     * lays a run of text out exactly like a block anyway.
     */
    if (value === 'none') {
      return [
        ['-webkit-line-clamp', 'none'],
        ['line-clamp', 'none'],
        ['overflow', 'visible'],
      ];
    }
    const lines = Math.round(Number(value));
    if (!Number.isFinite(lines) || lines < 1) return [];
    return [
      ['display', '-webkit-box'],
      ['-webkit-box-orient', 'vertical'],
      ['-webkit-line-clamp', String(lines)],
      ['line-clamp', String(lines)],
      ['overflow', 'hidden'],
    ];
  }
  return [[cssProp(prop), value]];
}

/**
 * The three properties that expand onto ground another property owns, and
 * where each has to sit so the collision resolves the same way every time.
 *
 * `textGradient` writes `background-image` and `color`; `lineClamp` writes
 * `display` and `overflow`; `placeItems` writes `align-items` and
 * `justify-items`. Every other expansion invents its own declarations —
 * `appear` is the only user of `animation`, `hyphens` of `hyphens` — so this is
 * the whole list, and it wants to stay that way.
 *
 * Left alone the winner is whichever key happens to sit later in the style
 * object, which is insertion order: the property the designer touched most
 * recently, or in a hand-authored template the order somebody typed the keys
 * in. Both surfaces would agree with each other and neither would agree with
 * the panel, which is the worst shape a bug can take here. This shipped
 * unnoticed in `textGradient`, where a gradient set beside a text colour
 * worked or did not depending on which was set second.
 *
 * The two directions are not a wrinkle, they are the two kinds of expansion:
 *
 * - **Last** for the ones that are inert if they lose. A clamp without its
 *   `display` does nothing at all and a gradient under a real `color` cannot
 *   be seen, so a designer who sets both has asked for two things that cannot
 *   both happen and the invisible one should not be the survivor. A `display`
 *   that lost is at least a layout you can look at.
 * - **First** for a shorthand, because a longhand beside it is a refinement.
 *   `placeItems: center` then `alignItems: start` reads in the panel as "both
 *   centred, except vertically", and that only works if the shorthand goes
 *   down first — which is exactly how a stylesheet would be written by hand.
 */
const EXPANSION_ORDER: Record<string, -1 | 1> = {
  placeItems: -1,
  textGradient: 1,
  lineClamp: 1,
};

/* --------------------------------------------------------------------------
 * Right to left
 * ----------------------------------------------------------------------- */

/**
 * The physical properties, and the flow-relative property that means the same
 * thing on a page that reads the other way.
 *
 * This library is written in physical sides. Ninety-three blocks say
 * `paddingLeft`, and `padding-left` is the left of the screen whichever
 * direction the writing runs — so an Arabic site built from them has its
 * indents, its icon gaps and its borders all on the wrong side, and the only
 * fix available was to rewrite every block. That is the shape of gap the
 * stress template called the largest by effort.
 *
 * `padding-inline-start` is the left in English and the right in Arabic. So
 * the rewrite happens once, here, at the moment a declaration is printed, and
 * every block mirrors without being touched. What a designer typed still says
 * "left" in the panel and in the file, because on an English page it *is* the
 * left; only the emitted CSS knows the difference.
 *
 * Applied **only** to a document that says it is `rtl`. Emitting logical
 * properties for everybody would be tidier and would change the bytes of every
 * site already published, break the four-sided shorthand collapsing — `padding`
 * has no single logical spelling — and put a modern-CSS dependency in the path
 * of pages that have no use for it.
 *
 * Not in the list, deliberately:
 *
 * - **`transform` and `translate`.** A nudge of two pixels is a visual
 *   adjustment to a specific design, not a statement about reading order, and
 *   a browser offers nothing flow-relative to map them onto anyway.
 * - **`background-position`.** Mostly a photograph's focal point, which does
 *   not swap sides because the words do.
 * - **`float` and `clear`.** No node emits either.
 *
 * The escape hatch is mirrored along with everything else, because it runs
 * over the finished pairs and a hand-written `padding-left` is a padding like
 * any other. Surprising if somebody meant it physically, and the alternative —
 * one part of a document that does not turn round with the rest — is worse.
 */
const MIRRORED: Record<string, string> = {
  'padding-left': 'padding-inline-start',
  'padding-right': 'padding-inline-end',
  'margin-left': 'margin-inline-start',
  'margin-right': 'margin-inline-end',
  left: 'inset-inline-start',
  right: 'inset-inline-end',
  'border-left-width': 'border-inline-start-width',
  'border-right-width': 'border-inline-end-width',
  'border-top-left-radius': 'border-start-start-radius',
  'border-top-right-radius': 'border-start-end-radius',
  'border-bottom-right-radius': 'border-end-end-radius',
  'border-bottom-left-radius': 'border-end-start-radius',
};

/**
 * The values that name a side, on the properties where they do.
 *
 * `text-align: left` is as physical as `padding-left` and mirrors the same way.
 * The others are left alone: `float` nothing emits, and `background-position`
 * is a focal point rather than a reading direction.
 */
const MIRRORED_VALUES: Record<string, Record<string, string>> = {
  'text-align': { left: 'start', right: 'end' },
  clear: { left: 'inline-start', right: 'inline-end' },
};

function mirror(pairs: [string, string][]): [string, string][] {
  return pairs.map(([name, value]) => [
    MIRRORED[name] ?? name,
    MIRRORED_VALUES[name]?.[value] ?? value,
  ]);
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

/**
 * Characters no CSS value the editor can produce contains, and that a hostile
 * one needs.
 *
 * This closes a hole that shipped. Declarations were emitted verbatim into the
 * `<style>` block, so a value of
 * `red</style><script>alert(document.cookie)</script>` left the stylesheet, left
 * the style *element*, and ran — in the published page and, because there is one
 * generator, in the editor canvas of anybody the project is shared with, on the
 * app's own origin with their session. `red } body { display: none` was the
 * quieter version of the same thing.
 *
 * Selectors were never exposed to this: everything that reaches one goes
 * through `slug()` or `anchorId()`, which whitelist to letters, digits, `_` and
 * `-`, and the runtime's comments say so. Values were the half nobody narrowed.
 *
 * `<` and `>` end the style element. `{` and `}` end the rule. `;` ends the
 * declaration, which is not an escape but is still a way to set properties the
 * panel never wrote. None of the four appears in any value in the entire block
 * library, and none can be produced by a control — a value carrying one is a
 * document that has been hand-edited or tampered with.
 */
const UNSAFE_IN_VALUE = /[<>{};]/;

/**
 * Declarations, with anything that could leave its own rule left out.
 *
 * Dropped rather than stripped, which is the same choice made for an unknown
 * reveal effect and for a condition naming a state nothing declares: emitting a
 * mangled version of a value nobody wrote is worse than emitting nothing, and
 * an element missing one declaration is a great deal better than a page running
 * somebody else's script.
 */
/**
 * What can be a property name: an ordinary one, a vendor prefix, or a variable.
 *
 * Whitelisted rather than filtered, for the reason selectors always have been.
 * A name is an identifier and identifiers are a small, closed shape — there is
 * no legitimate property containing a bracket, a quote or a space, so saying
 * what one *is* is both shorter and safer than listing what it must not be.
 */
const CSS_PROPERTY = /^(--[a-zA-Z0-9-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/;

/**
 * `mask-image: url(a.svg); mix-blend-mode: hard-light` → pairs.
 *
 * Split on top-level semicolons and then on the first colon, which is all the
 * grammar a declaration list has. Exported because the panel parses the same
 * text to say how many of the declarations it will actually use: a typo that
 * silently disappears is the worst thing an escape hatch can do, since the
 * whole reason somebody is here is that the panel had no control for what they
 * wanted.
 */
export function parseCustomDeclarations(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const part of text.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!name || !value) continue;
    if (!CSS_PROPERTY.test(name) || UNSAFE_IN_VALUE.test(value)) continue;
    out.push([name, value]);
  }
  return out;
}

function safePairs(styles: StyleDecl): [string, string][] {
  const pairs: [string, string][] = [];
  // A stable sort, so everything not in the table keeps the order it arrived
  // in and the only declarations that move are the ones that had to.
  const ordered = Object.entries(styles).sort(
    ([a], [b]) => (EXPANSION_ORDER[a] ?? 0) - (EXPANSION_ORDER[b] ?? 0)
  );
  for (const [prop, value] of ordered) {
    if (value === undefined || value === null || value === '') continue;
    const text = String(value);

    /*
     * The escape hatch is a *list*, so the guard applies to each declaration in
     * it rather than to the whole string — the semicolons between them are the
     * one legitimate use of a character it otherwise forbids. Its pairs skip
     * `expand()` because they are already CSS: nobody typing `mask-image` means
     * the two-word properties this document format invented.
     */
    if (prop === 'custom') {
      for (const pair of parseCustomDeclarations(text)) pairs.push(pair);
      continue;
    }

    // The property too. It is a key of `StyleDecl` in anything the editor
    // writes, but a document is JSON and arrives from disk.
    if (UNSAFE_IN_VALUE.test(prop)) continue;
    if (UNSAFE_IN_VALUE.test(text)) continue;
    for (const [name, resolved] of expand(prop, text)) pairs.push([name, resolved]);
  }
  return pairs;
}

/**
 * One declaration per property, keeping the last.
 *
 * An expansion that lands on ground another property owns produces two
 * declarations for one property — `display: flex; display: -webkit-box`. Both
 * are correct CSS and the second wins, so the page is right either way; what
 * is wrong is the stylesheet, which now says a thing and then unsays it, and
 * anybody reading it has to work out which line is live.
 *
 * Last wins because that is what the cascade already does, so this changes
 * nothing about what renders. It would matter if the generator ever emitted a
 * *deliberate* pair — `color: #fff` followed by a `color-mix()` for browsers
 * that understand it — and it never does: every fallback here is a pair of
 * differently-named properties (`-webkit-hyphens` and `hyphens`), which this
 * leaves alone. Anyone adding a same-property fallback has to come here first.
 */
function lastWins(pairs: [string, string][]): [string, string][] {
  const seen = new Map<string, number>();
  for (const [name] of pairs) seen.set(name, (seen.get(name) ?? 0) + 1);
  if (pairs.length === seen.size) return pairs;
  const remaining = new Map(seen);
  return pairs.filter(([name]) => {
    const left = (remaining.get(name) ?? 1) - 1;
    remaining.set(name, left);
    return left === 0;
  });
}

export function declarationsToCss(
  styles: StyleDecl,
  indent = '  ',
  direction: 'ltr' | 'rtl' = 'ltr'
): string {
  const pairs = lastWins(safePairs(styles));
  /*
   * Mirrored before collapsing, which costs an RTL page a few bytes and is the
   * only order that is correct. `padding: 10px 20px 10px 30px` is physical —
   * top right bottom left — so a page that turns around cannot use it, and
   * once the sides are renamed `collapseFourSided` no longer recognises them
   * and leaves the four longhands alone. Doing it the other way round would
   * produce a shorthand that quietly does not mirror.
   */
  return collapseFourSided(direction === 'rtl' ? mirror(pairs) : pairs)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}

/** Inline-style object, used for the page frame's token variables. */
export function declarationsToStyleObject(styles: StyleDecl): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, resolved] of safePairs(styles)) {
    out[name] = resolved;
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
/*
 * A second cache, because the same node can be printed two ways.
 *
 * Direction changes what a declaration is *called*, so a node cached while the
 * document read left to right is the wrong answer the moment somebody turns it
 * around — and a single cache would hand it back, with the editor showing
 * mirrored markup and unmirrored CSS until every node happened to change.
 * Two maps rather than a composite key so the common direction pays nothing.
 */
const mirroredRuleCache = new WeakMap<SceneNode, NodeRules>();

function rulesFor(
  node: SceneNode,
  selectorPrefix: string,
  direction: 'ltr' | 'rtl' = 'ltr'
): NodeRules {
  const cache = direction === 'rtl' ? mirroredRuleCache : ruleCache;
  const cached = cache.get(node);
  if (cached) return cached;

  const selector = `${selectorPrefix}.${nodeClass(node.id)}`;
  const baseBody = declarationsToCss(node.styles.desktop ?? {}, '  ', direction);

  const responsive: Partial<Record<Breakpoint, Emitted>> = {};
  for (const bp of BREAKPOINT_ORDER) {
    if (bp === 'desktop') continue;
    const layer = node.styles[bp];
    if (!layer || Object.keys(layer).length === 0) continue;
    const body = declarationsToCss(layer, '    ', direction);
    if (body) responsive[bp] = { selector, body };
  }

  const rules: NodeRules = {
    base: baseBody ? { selector, body: baseBody } : null,
    responsive,
  };
  cache.set(node, rules);
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
      /*
       * The whole of stage 3 in the generator. A data source resolves to a
       * value on the document element, so the test is the one a state already
       * uses — `:is()` either way so `is` and `isn't` weigh the same — hung off
       * an ancestor that is always there rather than one found by walking.
       *
       * `[data-cre8-data]` on the negative side is load-bearing, and its
       * absence was a bug that shipped. A prefix selector matches if *any*
       * ancestor satisfies it, and `:not(:is([data-cre8-data~="time:night"]))`
       * is satisfied by `<body>`, by every wrapper `<div>`, by anything at all
       * that is not the one element carrying the attribute. So the negative
       * rule matched always, and an element that should have appeared at night
       * was hidden at night *and* at every other hour — the block showed
       * nothing between nine and midnight and nobody saw it, because the check
       * that would have caught it only ran in the afternoon.
       *
       * Requiring the attribute narrows the ancestor to the one element that
       * can carry a value, which is what the positive side gets for free by
       * naming it. Specificity is unchanged: `:where()` weighs nothing either
       * way.
       */
      const match = condition.values
        .map((value) => `[data-cre8-data~="${condition.source}:${value}"]`)
        .join(',');
      const test =
        condition.op === 'is' ? `:is(${match})` : `[data-cre8-data]:not(:is(${match}))`;
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
  /*
   * One selector per way the rule can be true, joined with a comma — which is
   * how a stylesheet has spelled OR since the beginning, and why "any of
   * these" costs nothing new to emit.
   *
   * A plain AND of conditions is one branch and comes out byte-identical to
   * what this produced when `when` was a list, which is the property the
   * whole widening is verified against.
   */
  const branches = branchesOf(rule.when);
  if (!branches) return null;

  const part = rule.part ? `::${rule.part}` : '';
  const selectors: string[] = [];

  for (const conditions of branches) {
    let before = '';
    let after = '';
    let usable = true;
    for (const condition of conditions) {
      const parts = conditionParts(nodes, node, condition);
      // A branch naming a state nothing declares cannot be resolved, and the
      // whole rule goes — not just that branch. Dropping one arm of an "any
      // of these" would silently narrow what the designer asked for into
      // something that still works, which is the harder failure to notice.
      if (!parts) {
        usable = false;
        break;
      }
      before += parts.prefix;
      after += parts.compound;
    }
    if (!usable) return null;
    selectors.push(`${prefix}${before}.${className}${after}${part}`);
  }

  return selectors.length ? selectors.join(',\n') : null;
}

/**
 * True when anything about the rule depends on where the pointer is.
 *
 * Any branch counts. A rule that applies when hovered *or* when a tab is
 * selected is still one the canvas should suppress: half of it would light up
 * under the cursor, which is exactly what the suppression exists to stop.
 */
function isInteraction(rule: StyleRule): boolean {
  return (branchesOf(rule.when) ?? []).some((branch) =>
    branch.some((c) => c.kind === 'pointer')
  );
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
  /**
   * Rewrite the sided properties as logical ones, for a document that reads
   * right to left. Absent or `ltr` emits exactly what it always did.
   */
  direction?: 'ltr' | 'rtl';
}

export function generateNodeCss(
  nodes: Record<string, SceneNode>,
  options: GenerateCssOptions
): string {
  const prefix = options.scope ? `${options.scope} ` : '';
  const ids = options.nodeIds ? [...options.nodeIds] : Object.keys(nodes);

  const baseRules: Emitted[] = [];
  const ruleChunks: string[] = [];
  /** Narrow-width overrides from a node's own styles. One per node, merged. */
  const responsiveRules: Partial<Record<Breakpoint, Emitted[]>> = {};
  /**
   * Narrow-width overrides from a *rule* — a conditional style scoped to one
   * breakpoint — kept apart from the ones above and emitted after everything.
   *
   * They used to share the bucket, which put them before the unscoped rules
   * and made them unreachable: a rule saying "span two columns when featured"
   * beat the rule saying "and span one on a phone", because source order is
   * the whole of the cascade here and the mobile one came first. There was no
   * way to write a conditional style that a narrow screen could undo, and the
   * only sign of it was a designer's override doing nothing.
   *
   * Printed in order rather than merged, for the reason the conditional phase
   * is: a node can carry several, and a variant's class matches an element its
   * node's class matches too.
   */
  const conditionalResponsive: Partial<Record<Breakpoint, Emitted[]>> = {};

  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    const cached = rulesFor(node, prefix, options.direction);
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
        const body = selector && declarationsToCss(variant.hide.apply, '  ', options.direction);
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
        const body = declarationsToCss(rule.apply, '    ', options.direction);
        if (body) (conditionalResponsive[rule.breakpoint] ??= []).push({ selector, body });
        continue;
      }
      const body = declarationsToCss(rule.apply, '  ', options.direction);
      if (body) ruleChunks.push(`${selector} {\n${body}\n}`);
    }
  }

  const out: string[] = [];
  if (baseRules.length) out.push(printPhase(baseRules, ''));

  /*
   * Four phases, and at equal specificity source order is the whole cascade,
   * so this list *is* the precedence rule:
   *
   *   what it is → what it is when narrow → what it is when something is
   *   true → what it is when something is true and it is narrow.
   *
   * The last one is the addition. Before it there were three phases and the
   * third was final, which made "except on a phone" unsayable about anything
   * conditional — the narrow override was emitted first and lost.
   */
  const emit = (bucket: Partial<Record<Breakpoint, Emitted[]>>, merge: boolean): void => {
    for (const bp of BREAKPOINT_ORDER) {
      const rules = bucket[bp];
      if (!rules?.length) continue;
      const body = merge ? printPhase(rules, '  ') : printInOrder(rules, '  ');
      const rule = atRule(options.mode, bp);
      out.push(rule ? `${rule} {\n${body}\n}` : body);
    }
  };

  emit(responsiveRules, true);

  // Printed as it stands, not merged: a node can carry several of these and a
  // variant class matches an element its node class matches too, so moving one
  // up to join another would change which of them wins.
  if (ruleChunks.length) out.push(ruleChunks.join('\n'));

  emit(conditionalResponsive, false);
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
:where([data-cre8-root]) :is(ul, ol) { padding-inline-start: 1.25em; }
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
:where([data-cre8-root]) input[type="file"]::file-selector-button { font: inherit; font-size: 0.92em; font-weight: 550; margin-inline-end: 12px; padding: 6px 12px; border: 0; border-radius: var(--r-sm); background: var(--c-primary); color: var(--c-on-primary); cursor: pointer; }
:where([data-cre8-root]) progress { appearance: none; -webkit-appearance: none; display: block; }
:where([data-cre8-root]) progress::-webkit-progress-bar { background: transparent; }
:where([data-cre8-root]) progress::-webkit-progress-value { background: currentColor; }
:where([data-cre8-root]) progress::-moz-progress-bar { background: currentColor; }

/* Elements that own a child the document does not: legend, caption, summary. */
:where([data-cre8-root]) fieldset { min-width: 0; }
/*
 * The legend, which no node owns and which therefore has to be styled here.
 * No backticks in this block: it is inside a template literal, and one closes
 * the string.
 *
 * The horizontal padding is what keeps a bordered fieldset's rule from
 * touching the words. The matching negative margin is what stops that padding
 * indenting them: without it the legend's text starts six pixels right of
 * every label beneath it, in a group whose whole job is to look like one
 * thing. Cancelling the two leaves the gap in the border and puts the text
 * back on the content edge.
 *
 * The bottom margin is for the other kind. A fieldset laid out as a flex
 * column does not treat its legend as a flex item, so the row gap that spaces
 * every other child does nothing above the first one, and the group's title
 * sits directly on top of its first field.
 */
:where([data-cre8-root]) legend { padding-inline: 6px; margin-inline: -6px; margin-bottom: 10px; font-size: 13px; font-weight: 580; }
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

/**
 * The reveal keyframes, and their answer to somebody who asked for less motion.
 *
 * Redefined inside the media query rather than switched off with `!important`.
 * Same names, animating nothing — so the rules that reference them stay exactly
 * as they are, no override has to out-specify anything, and an element that
 * would have risen simply arrives. A blanket `animation: none` would have had
 * to reach every element on the page to catch these five.
 *
 * Shipped only on pages that use one, which is why this is a function of the
 * document rather than part of the reset.
 */
const APPEAR_KEYFRAMES = `
@keyframes cre8-ap-fade { from { opacity: 0; } }
@keyframes cre8-ap-rise { from { opacity: 0; translate: 0 14px; } }
@keyframes cre8-ap-zoom { from { opacity: 0; scale: 0.94; } }
@keyframes cre8-ap-left { from { opacity: 0; translate: -18px 0; } }
@keyframes cre8-ap-right { from { opacity: 0; translate: 18px 0; } }
@media (prefers-reduced-motion: reduce) {
  @keyframes cre8-ap-fade { from { opacity: 1; } }
  @keyframes cre8-ap-rise { from { opacity: 1; translate: 0 0; } }
  @keyframes cre8-ap-zoom { from { opacity: 1; scale: 1; } }
  @keyframes cre8-ap-left { from { opacity: 1; translate: 0 0; } }
  @keyframes cre8-ap-right { from { opacity: 1; translate: 0 0; } }
}`;

/** Whether any layer of any node asks to appear. */
function anythingAppears(doc: Cre8Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    for (const layer of Object.values(node.styles ?? {})) {
      if (layer?.appear) return true;
    }
    for (const rule of node.rules ?? []) {
      if (rule.apply?.appear) return true;
    }
  }
  return false;
}

export function generateStylesheet(
  doc: Cre8Document,
  options: DocumentStylesheetOptions
): string {
  const parts = options.standalone
    ? [PUBLISHED_DOCUMENT_RESET, DOCUMENT_RESET, PLACEHOLDER_CSS]
    : [DOCUMENT_RESET, PLACEHOLDER_CSS];
  if (anythingAppears(doc)) parts.push(APPEAR_KEYFRAMES);
  if (options.themeVars) {
    parts.unshift(`${options.rootSelector ?? ':root'} {\n${options.themeVars}\n}`);
  }
  /*
   * The direction comes from the document, and every caller therefore gets it
   * right by doing nothing. Three surfaces build a stylesheet — canvas,
   * preview, publisher — and asking each to remember one more option is asking
   * for exactly one of them to forget, which is the divergence this file
   * exists to prevent. An explicit option still wins, for the checks that need
   * to print a node both ways.
   */
  parts.push(
    generateNodeCss(doc.nodes, { ...options, direction: options.direction ?? doc.settings.direction })
  );
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
