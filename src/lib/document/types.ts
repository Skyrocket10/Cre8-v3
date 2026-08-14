/**
 * Cre8 document model.
 *
 * Everything a project is — pages, nodes, styles, assets, components, tokens —
 * lives in one plain, JSON-serialisable object. Three consequences that matter
 * for where this product is going:
 *
 *  1. The same document renders in the editor, in preview, and in the published
 *     static output. There is one renderer, never a "design-time approximation".
 *  2. Every mutation is expressible as a patch against this object, which is
 *     what makes undo/redo transactional and what will later let an AI author
 *     changes through exactly the same API a human uses.
 *  3. Presentation and structure are modelled now; behaviour, data and logic
 *     have reserved, typed slots that the current release never writes to.
 */

export type NodeId = string;

/* --------------------------------------------------------------------------
 * Breakpoints
 * ----------------------------------------------------------------------- */

/**
 * Desktop-first cascade: `desktop` holds the base style, narrower breakpoints
 * hold overrides. This matches how designers actually think ("on mobile, make
 * it smaller") and maps cleanly onto max-width rules.
 */
export type Breakpoint = 'desktop' | 'tablet' | 'mobile';

export const BREAKPOINTS: readonly Breakpoint[] = ['desktop', 'tablet', 'mobile'] as const;

export interface BreakpointDefinition {
  id: Breakpoint;
  label: string;
  /** Frame width used by the canvas and by preview. */
  width: number;
  /** Upper bound for the generated media/container query. `null` for the base. */
  maxWidth: number | null;
  shortcut: string;
}

export const BREAKPOINT_DEFS: Record<Breakpoint, BreakpointDefinition> = {
  desktop: { id: 'desktop', label: 'Desktop', width: 1440, maxWidth: null, shortcut: '1' },
  tablet: { id: 'tablet', label: 'Tablet', width: 834, maxWidth: 1024, shortcut: '2' },
  mobile: { id: 'mobile', label: 'Mobile', width: 390, maxWidth: 640, shortcut: '3' },
};

/** Broad → narrow. Resolution walks this order and later entries win. */
export const BREAKPOINT_ORDER: readonly Breakpoint[] = ['desktop', 'tablet', 'mobile'] as const;

/* --------------------------------------------------------------------------
 * Styles
 * ----------------------------------------------------------------------- */

/**
 * A curated subset of CSS, in camelCase. Values are raw CSS strings, which
 * means a design token is simply `var(--c-primary)` — tokens need no special
 * resolution step and survive serialisation, publishing and hand-editing.
 */
export interface StyleDecl {
  /* Layout */
  display?: string;
  flexDirection?: string;
  alignItems?: string;
  justifyContent?: string;
  flexWrap?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  /**
   * Multi-column flow, for masonry.
   *
   * CSS grid still has no masonry anywhere near universal support, and the
   * usual substitutes — row spans guessed from image ratios, or a script that
   * measures and repositions — are either wrong or a runtime. Multi-column is
   * neither: it is one property, it reflows on its own, and it works
   * everywhere. `breakInside: avoid` is what stops a card being split across
   * the column boundary.
   */
  columnCount?: string;
  breakInside?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: string;
  gridAutoRows?: string;
  gridColumn?: string;
  gridRow?: string;
  /**
   * Both axes of a grid's cell alignment at once.
   *
   * A shorthand over `alignItems` and `justifyItems`, and the generator writes
   * it out as those two rather than passing it through — otherwise which of
   * the three rows won depended on the order their keys sat in the object.
   */
  placeItems?: string;
  /** Where every cell's contents sit *across* the cell. */
  justifyItems?: string;
  /** Where this one sits across its own cell, overriding the grid's answer. */
  justifySelf?: string;
  /**
   * Moves this earlier or later than its place in the layer list.
   *
   * The reason it is worth having: an arrangement that differs by width —
   * picture above the copy at 390, beside it at 1440 — otherwise has to be
   * built twice and hidden once, which doubles the layer tree for what is
   * purely a layout decision. A number here at one breakpoint does it.
   */
  order?: string;

  /* Position */
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  inset?: string;
  zIndex?: string;
  /**
   * Where a panel sits relative to the thing that opens it.
   *
   * The placement half of anchor positioning, and it is design rather than
   * machinery, which is why it lives in styles: "below, aligned left" is a
   * decision somebody makes and changes. The *names* that tie the two elements
   * together are minted from the panel's node id by the renderer, the same way
   * a popover's DOM id is.
   *
   * Written logically — `block-end span-inline-end` rather than
   * `bottom span-right` — so a right-to-left site puts its menus on the side
   * they belong on without anybody editing a template.
   */
  positionArea?: string;
  /**
   * What to try when the panel would leave the viewport.
   *
   * `flip-block, flip-inline` is the whole of it for a menu: one turns a
   * dropdown near the bottom into a drop-up, the other turns a right-hand
   * menu leftwards. Without it an account menu in the top-right corner simply
   * hangs off the edge of the page.
   */
  positionTryFallbacks?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
  /** `hidden` empties the box without taking its space. */
  visibility?: string;
  /**
   * How much room a link into this section leaves above it.
   *
   * The document reset already sets 96px on everything with an id, which is
   * what makes a jump land below the navbars this app produces rather than
   * behind them. That is a default, not an answer: a site with a taller header
   * needs a bigger number and had no way to say one. Set here it beats the
   * reset, which is written at (0,0,1) precisely so a node can.
   */
  scrollMarginTop?: string;

  /* Size */
  width?: string;
  height?: string;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  aspectRatio?: string;
  flexGrow?: string;
  flexShrink?: string;
  flexBasis?: string;
  alignSelf?: string;

  /* Spacing */
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;

  /* Typography */
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  textTransform?: string;
  textDecoration?: string;
  textWrap?: string;
  whiteSpace?: string;

  /**
   * What a word too long for its line is allowed to do.
   *
   * Two values wrap it and they are not interchangeable, which is the whole
   * reason this needs a menu rather than a tickbox. `break-word` wraps the
   * text but leaves the element's *min-content* width as the whole word, so a
   * grid column or a flex item sized from its contents is still blown out —
   * the letters wrap and the layout does not. `anywhere` shrinks the
   * min-content contribution to a single character, which is the value that
   * actually puts a column back.
   */
  overflowWrap?: string;
  /**
   * Whether a line may break *inside* a word that would have fitted.
   *
   * The opposite question to `overflowWrap`, which is about last resorts.
   * `break-all` fills every line to the edge and splits words wherever they
   * land; `keep-all` is for Chinese, Japanese and Korean, where the breaks a
   * browser would take by default fall inside words.
   */
  wordBreak?: string;
  /**
   * `auto` breaks words at syllables and prints the hyphen.
   *
   * Hyphenation is per-language, and the language the browser uses is the one
   * on the nearest ancestor that declares one — which is why the page root
   * carries `lang` on both surfaces rather than only in the published shell.
   * Without that the canvas would hyphenate a German site by English rules.
   */
  hyphens?: string;
  /**
   * Cut the text off after this many lines, with an ellipsis.
   *
   * A count, or `none`. The generator expands it, because what a browser wants
   * for this is four declarations in an old flexbox mode — and `none` exists
   * so a narrower breakpoint can say "not here", which clearing the row cannot:
   * absence means "whatever the wider layer said".
   */
  lineClamp?: string;
  /**
   * The ellipsis on a single line that is cut off horizontally.
   *
   * Overlaps `lineClamp: 1` and is here for the case that cannot use it: a
   * table cell, or anything else whose `display` is load-bearing, where
   * switching to `-webkit-box` would take the element out of its layout role.
   */
  textOverflow?: string;
  /** `tabular-nums` is what stops a column of figures jittering as it changes. */
  fontVariantNumeric?: string;
  color?: string;
  /** Renders text with a gradient fill; the generator expands this. */
  textGradient?: string;

  /* Fill */
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  backgroundAttachment?: string;

  /* Border */
  borderStyle?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderColor?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomRightRadius?: string;
  borderBottomLeftRadius?: string;

  /* Effects */
  boxShadow?: string;
  textShadow?: string;
  opacity?: string;
  filter?: string;
  backdropFilter?: string;
  transform?: string;
  /**
   * One axis each, and the reason they exist beside `transform`.
   *
   * `transform` is a list, so anything that wants to nudge a card two pixels
   * on hover has to restate whatever scale and rotation the base layer already
   * set — and a rule that forgets one silently undoes it. These are separate
   * properties: a hover rule can write `translate` alone and the `scale` from
   * the base layer survives, which is what makes them composable at all. The
   * browser applies all three before `transform`.
   */
  rotate?: string;
  scale?: string;
  translate?: string;
  transformOrigin?: string;
  mixBlendMode?: string;
  transition?: string;

  /**
   * Clips the box to a shape.
   *
   * Here for the one thing the platform offers no other way to do: reveal part
   * of an element from a number. A before/after comparison is two stacked
   * images and `inset(0 0 0 calc(var(--cre8-split) * 1%))` on the upper one:
   * no second wrapper, no measured widths, and it moves smoothly because it is
   * one property rather than a layout change.
   */
  clipPath?: string;

  /**
   * How the element arrives as it scrolls into view.
   *
   * A named effect rather than a stack of animation longhands, because the
   * question a designer has is "does this fade up?" and the answer in CSS is
   * four declarations and a `@keyframes` block. The generator expands it; the
   * keyframes ship only on pages that use one.
   *
   * Scroll-driven, so there is nothing to execute: `animation-timeline: view()`
   * ties progress to the element's position in the scrollport. Where that is
   * unsupported the declaration is dropped and the same animation runs once on
   * load, which is a weaker effect rather than a broken page — and under
   * `prefers-reduced-motion` the keyframes are redefined to animate nothing.
   */
  appear?: string;

  /**
   * Declarations the panel has no control for, written out by hand.
   *
   * The escape hatch, and deliberately a list of *declarations* rather than a
   * block of CSS. No selectors: what somebody writes here lands in this node's
   * own rule, so it cascades, responds to breakpoints and works inside a
   * `StyleRule` exactly like every other declaration. A raw block would let
   * rules exist that the editor cannot see, undo, or reason about — and the
   * whole design rests on there being one description of what an element looks
   * like.
   *
   * Each declaration is validated on its way out; the ones that are not
   * declarations are dropped, and the panel says how many.
   */
  custom?: string;

  /* Media */
  objectFit?: string;
  objectPosition?: string;

  /* Tables */
  borderCollapse?: string;
  borderSpacing?: string;
  tableLayout?: string;
  captionSide?: string;
  verticalAlign?: string;

  /* Misc */
  /**
   * Tints the parts of a native control the page cannot otherwise reach —
   * a slider's track and thumb, a checkbox's tick. One property instead of
   * four vendor pseudo-elements, and the only way to theme them at all
   * without `appearance: none` and rebuilding the control by hand.
   */
  accentColor?: string;
  cursor?: string;
  pointerEvents?: string;
  listStyleType?: string;
}

export type StyleProp = keyof StyleDecl;

/** Style overrides keyed by breakpoint. `desktop` is the base layer. */
export type ResponsiveStyles = Partial<Record<Breakpoint, StyleDecl>>;

/* --------------------------------------------------------------------------
 * Rules: when this is true, apply that
 * ----------------------------------------------------------------------- */

/**
 * Something that has to hold for a rule to apply.
 *
 * One union covering what used to be four mechanisms. The split between
 * members is not cosmetic — it is where in the selector each one lands. A
 * pointer condition joins the element's own compound; a state condition is a
 * match on an ancestor and therefore prefixes it.
 */
export type Condition =
  /** Evaluated by the browser and free: `:hover`, `:active`, `:focus-visible`. */
  | { kind: 'pointer'; pseudo: 'hover' | 'active' | 'focus' | 'focus-visible' }
  /** Also pseudo-classes, but about a control's own state. */
  | { kind: 'control'; pseudo: 'checked' | 'disabled' | 'invalid' | 'placeholder-shown' }
  /** A named state on this node or an ancestor. Empty `key` means the nearest. */
  | { kind: 'state'; key: string; op: 'is' | 'isNot'; values: string[] }
  /** An attribute on the element itself — `aria-selected`, `aria-expanded`. */
  | { kind: 'attr'; name: string; op: 'is' | 'isNot'; values: string[] }
  /**
   * Something about the visit rather than about the page.
   *
   * Deliberately the same shape as `state`, because that is what it becomes:
   * the source resolves to a value on the document element and everything
   * downstream — the selector, the ordering, the expansion into elements —
   * is the switch machinery unchanged. See `runtime/data.ts`.
   */
  | { kind: 'data'; source: string; op: 'is' | 'isNot'; values: string[] };

/* --------------------------------------------------------------------------
 * Tests
 * ----------------------------------------------------------------------- */

/** What a `Value` may be compared against. Typed, never inferred from spelling. */
export type TestLiteral =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean };

/**
 * The comparisons a Test may make.
 *
 * `contains` is substring, for text. `empty` and `notEmpty` take no operand,
 * which is why `right` is optional rather than there being two Test kinds.
 */
export type CompareOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'empty'
  | 'notEmpty';

/**
 * Something that is true or false about the values in scope.
 *
 * `Condition` is a member rather than a parallel idea: the five kinds that
 * compile to CSS selectors *are* the CSS-compilable subset of a Test, which is
 * what `docs/EXPRESSIONS.md` says, made true by construction rather than by
 * two languages agreeing to stay in step. `StyleRule.when` still takes
 * `Condition[]`; widening it to a `Test` costs nothing at the model and is not
 * worth churning the generator for until something needs it.
 *
 * A comparison reads raw values. There is no `format` here and no way to reach
 * one: `Format` hangs off `Binding`, and a Test only ever sees a `Value`.
 */
export type Test =
  | Condition
  | { kind: 'compare'; left: Value; op: CompareOp; right?: TestLiteral }
  | { kind: 'every'; tests: Test[] }
  | { kind: 'some'; tests: Test[] };

/**
 * WHEN a Test holds, this node's state takes a value.
 *
 * The assignment half of `WHEN [Test] DO [Assignment]`, in the form that needs
 * nothing new underneath it: the value lands in the state attribute the switch
 * machinery already reads, so the designer styles the result with the ordinary
 * inspector and descendants react to it the way they react to a tab being
 * selected. No CSS is generated for the Test itself, and none of it scales
 * with the number of rows in a repeater.
 *
 * The key is the node's own `switchKey` — an element carries one state, which
 * is the constraint the attribute already imposes — so two assignments on one
 * node are two writes to one key, resolved in list order with the later one
 * winning. Same arbitration as `rules`, for the same reason.
 */
/**
 * A state an element declares: its name, what it can be, and where it starts.
 *
 * The values are the addition, and the reason the other three moved to join
 * them. They used to be *discovered* — `valuesSetting` scraped every control
 * in the subtree for what it set — which had three costs. A value could not
 * exist before something set it, so the empty case of a filter or the error
 * case of a form could not be designed until the button that reached it was
 * wired. Renaming one meant finding every control that mentioned it. And the
 * scrape's own docblock admitted it attributed a control in a *nested* group
 * to the outer one as well.
 *
 * The scrape survives as a suggestion in the panel and as the one-time source
 * for the migration. It is no longer the truth.
 *
 * There was nowhere to put a list before this: `NodeProps` holds primitives,
 * which is exactly why the values were scraped rather than declared. Not an
 * oversight — a missing shape.
 */
export interface StateDecl {
  /** Slugged: it reaches an attribute and a stylesheet selector. */
  key: string;
  /** Every value it can take, in the order the panel shows them. */
  values: string[];
  /**
   * What ships in the file.
   *
   * What a visitor sees before touching anything, and for ever if they have no
   * scripting. Was `switchDefault`.
   */
  initial: string;
  /**
   * Which one the canvas is showing. Never published.
   *
   * `SWITCH_SHOW_ALL` lays every case out at once, which is a working view
   * rather than a case. Was `switchDesign`.
   */
  design?: string;
}

export interface StateRule {
  id: string;
  when: Test;
  /** What the state becomes. Slugged, because it ends up in a selector. */
  value: string;
}

/**
 * Which box the declarations land on. Absent means the element itself.
 *
 * Deliberately separate from `Condition`: a part does not say *when* a rule
 * applies, it says *where*, and the two compose — `:hover` on the backdrop of
 * an open dialog is both at once. Folding pseudo-elements into the condition
 * list, which is what the old `states.backdrop` did, made that combination
 * impossible to express.
 */
export type Part = 'backdrop' | 'placeholder' | 'marker' | 'selection';

/**
 * When this is true, apply that.
 *
 * A list rather than a record because two rules can both match and both set
 * `background`, and the only precedence a designer can predict is the order
 * they are in. Every rule is padded to the same specificity for exactly that
 * reason — see `css.ts`.
 */
/**
 * A rule as somebody writes one, before the document holds it.
 *
 * The only difference is `when`: a list of conditions is the natural way to
 * compose one by hand, and `Test` is the way to store one. `asTest` folds the
 * first into the second in `buildSubtree`, so a block, a template and the
 * editor's add menu all keep the short spelling while nothing downstream sees
 * two shapes.
 */
export type AuthoredRule = Omit<StyleRule, 'when'> & { when?: Condition[] | Test };

export interface StyleRule {
  /**
   * Unique within the node, not across the document.
   *
   * Duplicating or pasting onto a node copies the rules as they are, ids and
   * all, which is deliberate: nothing keys a document-wide map by rule id, and
   * a copy keeping the same id is what lets "editing the hover rule" survive
   * selecting the copy.
   */
  id: string;
  /**
   * When this rule applies.
   *
   * A `Test`, not a `Condition[]`, and the widening is the point: there was
   * one language for *when a style applies* and another for *when a state is
   * assigned*, and the second was a superset of the first — `Test` has been
   * `Condition | compare | every | some` all along. Styling on a comparison
   * therefore cost a designer two objects in two panels and an invented
   * intermediate name, for a sentence they could say in one breath.
   *
   * Absent means always, which is what a part-only rule is: a backdrop has no
   * condition. That is spelled as absence rather than as an empty `every`,
   * because an `every` of nothing is a group with no members and the panel
   * would have to know not to draw it.
   *
   * Not everything a `Test` can say compiles to a selector. `conditions.ts`
   * owns that question — `branchesOf` answers with the selector branches or
   * with `null`, and `null` means the generator drops the rule rather than
   * approximating it.
   */
  when?: Test;
  part?: Part;
  apply: StyleDecl;
  /**
   * Prop overrides — text, alt, src, href.
   *
   * Styles compile to CSS; content cannot, so a rule that changes content
   * makes the node render as more than one element, each carrying the
   * matching condition. See `renderer/variants.ts` — the constraint that keeps
   * that linear lives there, not here, because it is about how many elements
   * the expansion produces rather than about what a rule may say.
   */
  set?: NodeProps;
  /** Scope to one breakpoint. Absent means every breakpoint. */
  breakpoint?: Breakpoint;
}

/* --------------------------------------------------------------------------
 * Legacy — read by the version-2 migration and by nothing else
 * ----------------------------------------------------------------------- */

/** @deprecated Folded into `StyleRule` at document version 2. */
export type StyleState = 'hover' | 'active' | 'focus' | 'backdrop' | 'pressed';

/** @deprecated Folded into `StyleRule` at document version 2. */
export type StateStyles = Partial<Record<StyleState, StyleDecl>>;

/* --------------------------------------------------------------------------
 * Nodes
 * ----------------------------------------------------------------------- */

export type ElementType =
  // Root
  | 'page'
  // Layout
  | 'frame'
  | 'section'
  | 'container'
  | 'stack'
  | 'grid'
  // Typography
  | 'heading'
  | 'paragraph'
  | 'text'
  | 'richtext'
  // Media
  | 'image'
  | 'video'
  | 'icon'
  // Interactive
  | 'button'
  | 'link'
  | 'navigation'
  // Structure
  | 'divider'
  | 'spacer'
  | 'details'
  | 'popover'
  | 'dialog'
  // Tabular data
  | 'table'
  | 'tableRow'
  | 'tableCell'
  // Forms
  | 'form'
  | 'input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'range'
  | 'file'
  | 'progress'
  | 'fieldset'
  // Composition
  | 'instance';

/** Free-form but typed-at-the-edges element props (text content, src, href…). */
export type NodeProps = Record<string, string | number | boolean | null | undefined>;

/**
 * One element naming another.
 *
 * An object rather than a bare id, and the reason is greppability more than
 * structure: `refs.popover` typed as `NodeId` reads like every other string in
 * the model, and the point of making references first-class is that they can
 * be found — by a person, by a check, and by the cleanup that walks them. It
 * also leaves the obvious room, since the thing being referred to is not
 * always going to be a whole node.
 */
export interface Ref {
  node: NodeId;
}

/**
 * Which relationship a reference expresses.
 *
 * Closed, so adding one is a deliberate edit rather than a new string appearing
 * in a map. Two today, and they point in opposite directions on purpose:
 *
 * - `popover` — a button naming the panel it opens.
 * - `anchorFor` — an element naming the panel positioned against it.
 * - `scrollTo` — a control naming the part of the page it jumps to.
 *
 * The third is a reference for the reason the first was: the alternative is a
 * fragment string, and a fragment string is a name that goes stale the moment
 * somebody renames the section — silently, into a link that scrolls nowhere.
 * A reference survives the rename and is cleared by `pruneRefs` when the target
 * is deleted, so the two ways a jump can rot are both closed. What reaches the
 * markup is still an ordinary `href`, resolved against the document by the same
 * hook that turns `page:<id>` into a path.
 *
 * The second is stored the way the *renderer* needs it rather than the way a
 * person says it. Somebody means "this menu opens next to that button", but the
 * element that has to carry `anchor-name` is the button, and the canvas
 * renderer is handed an empty document and memoised per node — so it can only
 * emit what the node it is drawing already holds. Storing the back-reference
 * keeps every read local; the inspector does the one scan needed to show it the
 * right way round, because the inspector has the document and the time.
 */
export type RefSlot = 'popover' | 'anchorFor' | 'scrollTo';

/**
 * One thing a control does when its event fires.
 *
 * A tagged union rather than `{ type: string; params: Record<string, unknown> }`,
 * which is what stood here while the axis was reserved. The loose shape was the
 * right way to hold a place and the wrong way to hold a feature: nothing could
 * be checked, so every reader would have had to re-validate, and the two
 * renderers would each have had their own opinion about a malformed action.
 *
 * Every member compiles to markup. That is the constraint the whole behaviour
 * layer is built on — see `lib/runtime/behaviour.ts` — and it is what decides
 * which members exist: an action that could not be expressed as "write an
 * attribute, let the browser or CSS act on it" would need a second mechanism
 * on three surfaces, which is the failure ARCHITECTURE §1 exists to prevent.
 *
 * The markup is not always an attribute the runtime reads. Four of the nine
 * are carried by things the browser already does — `href`, `popovertarget`,
 * `type="submit"` — and cost no script at all. `document/events.ts` holds that
 * table, `actions.ts:planActions` applies it, and the split is the whole point
 * of the vocabulary being this long: the authored shape is uniform and the
 * compiled shape is whatever is most native.
 *
 * `only` rides on top of all of it — see `Guarded` below.
 */
export type NodeAction = ActionBody & Guarded;

/**
 * "…but only when."
 *
 * The condition Bubble puts on a workflow step, and the last thing in the
 * audit's table of what a designer would try and could not. It is a `Test`
 * rather than a new little language because it is the same question a style
 * rule asks — *is this true right now* — and the codebase already has one
 * evaluator, one fold/subscribe rule and one set of words for it.
 *
 * ## Two schedules, as everywhere else
 *
 * **Folds** — every operand is publish-time data, so the answer is known when
 * the file is written. A true guard vanishes and the action is as if it were
 * never conditional; a false one takes the action with it. The published page
 * carries no guard, no attribute and no script, and a repeater's hundred rows
 * each get the answer for their own record.
 *
 * **Does not fold** — the guard reads something a visitor can change, so it
 * travels. It mints an attribute exactly as a comparison in a style rule does
 * (X4), `testRuntime` turns that attribute on and off, and the behaviour
 * runtime checks for it before doing anything. That is why this costs so
 * little: the evaluator, the table, the published values and the folding were
 * all built for style rules and are reused whole.
 *
 * ## What a visitor with no scripting gets
 *
 * Different by verb, and it has to be — a static file cannot conditionally
 * have an `href`:
 *
 * - A verb the runtime performs (`setState`, `copy`, `toggleState`) does
 *   nothing, which is what it does without a guard too.
 * - A verb the markup carries (`navigate`, `submit`, `openPanel`, `scrollTo`)
 *   *runs*. The link is in the file; nothing is there to stop it.
 *
 * Stated rather than chosen, because there is no second option to offer, and
 * `unfinished()` says so on the node where it matters.
 */
export interface Guarded {
  only?: Test;
}

type ActionBody =
  /**
   * Put a state into a value.
   *
   * `state` names which one. Empty means the nearest enclosing group, which is
   * what a tab button means and what every control meant before this field
   * existed — so an omitted `state` is not a default, it is a different and
   * usually more robust statement: a card copied out of one tab set into
   * another still drives the set it is in.
   */
  | { type: 'setState'; state?: string; value: string; quiet?: boolean }
  /**
   * Move a state to whichever of two cases it is not in.
   *
   * The verb a disclosure wants, and the one thing `setState` cannot say: a
   * menu button that opens *and* closes had to be two controls, or a
   * `<details>`, or a pair of rules. `values` is the pair to alternate
   * between; empty means "the state's own two", which is the robust form for
   * the same reason a bare `setState` is.
   */
  | { type: 'toggleState'; state?: string; values?: [string, string] }
  /** Put text on the clipboard. */
  | { type: 'copy'; text: string }
  /**
   * Go to a page, or off the site.
   *
   * **Optional**, and that is the design rather than a convenience. `href` is
   * `SETTABLE` and `BINDABLE`: a destination varies by rule and binds to a
   * record, and an action can be neither. So the ordinary spelling is a
   * `navigate` with no `to` at all, meaning *go where this element's `href`
   * says* — the behaviour joins the list, in order, with its own `only`, and
   * the value stays where a rule and a binding can reach it. See
   * docs/INTERACTIONS.md §4.0.7.
   *
   * `to` is there for the case that has no element prop behind it, and holds
   * what `props.href` holds: a path, an absolute URL, or a `node:` reference.
   */
  | { type: 'navigate'; to?: string; target?: string }
  /** Somewhere further down this page. Compiles to `href="#…"`. */
  | { type: 'scrollTo'; ref: Ref }
  /**
   * Show a panel. Compiles to `popovertarget`.
   *
   * `mode` defaults to `toggle`, which is both what the markup has always
   * defaulted to and what a designer means: a menu button that opens a menu
   * and cannot close it again is one control short. `show` is for the case
   * where a second control does the closing.
   */
  | { type: 'openPanel'; ref: Ref; mode?: 'toggle' | 'show' }
  /** Dismiss one — usually the panel the control is inside. */
  | { type: 'closePanel'; ref: Ref }
  /** Send the surrounding form. Compiles to `type="submit"`. */
  | { type: 'submit' };

/**
 * What a node does when something happens to it.
 *
 * A *list* of actions, which is the whole reason this exists rather than one
 * more prop: a link in a mobile nav has to close the nav and move a tab set,
 * and two props cannot be ordered against each other or reasoned about as one
 * gesture. `document/events.ts` says which events exist and which elements
 * offer them.
 */
export interface NodeEventBinding {
  /**
   * Named in `EVENTS`, which holds one entry — `onClick`.
   *
   * A binding for anything else is **inert and kept**: `everyAction` filters
   * against the registry, so it reaches no attribute and ships no script, and
   * `setActions` leaves other events alone rather than deleting what it does
   * not draw. That is the arrangement X6 chose over the one it replaced, where
   * `ElementDefinition.events` promised `onSubmit` on every form and nothing
   * anywhere read it — a table entry earns its place by being delivered.
   */
  event: string;
  actions: NodeAction[];
}

/** RESERVED — data bindings for a future CMS / database layer. */
export interface NodeDataBinding {
  /** Which prop or style the bound value feeds. */
  target: string;
  /** Opaque expression, resolved by a future data layer. */
  source: string;
}

/* --------------------------------------------------------------------------
 * Values, and what a value looks like once it is on the page
 * ----------------------------------------------------------------------- */

/**
 * Something an expression can read.
 *
 * One kind today, written as a discriminated union because the next ones —
 * an input's value, a declared constant, a page parameter — arrive without a
 * migration if the tag is already there. See docs/EXPRESSIONS.md.
 */
export type Value =
  /** A field of whatever record is in scope. `key`, never `label`: renaming a field must not break a page. */
  | { kind: 'field'; key: string }
  /**
   * What a form control inside the owning node currently holds.
   *
   * Named rather than pointed at a node id, because the name is what the
   * control already has and what a form submission uses. Scoped to the node
   * that owns the rule: a rule evaluates against its own node and descendants
   * react to the resulting state.
   *
   * This is the operand that cannot be known when the site is published, which
   * is the whole reason the execution model has two schedules.
   */
  | { kind: 'input'; name: string }
  /**
   * What a control *anywhere on the page* currently holds.
   *
   * The lifting of `SCOPING`, which this file used to record as deferred: a
   * rule could only read a control inside the node that owned it, so "enable
   * Submit when the email box has something in it" meant the rule had to live
   * on an ancestor of the email box. Now it can live on the button.
   *
   * A `Ref` rather than a name, and the difference is identity: a control's
   * `name` is a submission concern, two forms on a page may share one, and
   * renaming a field should not silently break a rule that reads it. The
   * reference survives the rename and dies with the element, because
   * `pruneRefs` walks it.
   *
   * Only a *control*, and only live. Reading the text of an ordinary element
   * would have to be resolved where the document is known, and the canvas
   * renderer is deliberately handed an empty one and memoised per node — so
   * the two surfaces would answer differently, which is the one thing this
   * codebase does not trade away. That case needs dependency tracking in the
   * canvas memo and is honestly a different piece of work.
   */
  | { kind: 'element'; ref: Ref };

/**
 * A presentation transform. Never part of a `Value`, and that is the point.
 *
 * Formatting is strictly presentation: `1234.5` and `$1,234.50` are the same
 * number, and only one of them can be compared, sorted or added. The rule
 * throughout the expression system is that comparisons see raw values — so
 * rather than write that down and check for it, the format lives one level up,
 * on the binding, where a `Value` cannot reach it. A formatted operand is not
 * refused; it cannot be spelled.
 *
 * Every one of these is a pure function of its input with no locale database
 * behind it, for the reason `repeat.ts` gives for avoiding `localeCompare`: the
 * browser and the Worker must produce the same bytes, and ICU is the classic
 * way for them not to.
 */
export type Format =
  | { kind: 'number'; decimals?: number; group?: boolean }
  | { kind: 'currency'; symbol?: string; decimals?: number; after?: boolean; group?: boolean }
  /** Appends `%`. Does not multiply — scaling is arithmetic, and arithmetic is phase D. */
  | { kind: 'percent'; decimals?: number; group?: boolean }
  | { kind: 'date'; pattern: DatePattern }
  | { kind: 'case'; to: 'upper' | 'lower' | 'capitalize' }
  | { kind: 'truncate'; chars: number };

/** How a date reads. Named rather than a token language, which would be a parser. */
export type DatePattern = 'iso' | 'long' | 'us' | 'short' | 'monthYear';

/**
 * One prop, fed by one value, shown one way.
 *
 * A record is `{ text: { value: { kind: 'field', key: 'title' } } }` — verbose
 * next to the bare field name it replaces, and worth it: the format has
 * somewhere to live that is not inside the value.
 */
export interface Binding {
  value: Value;
  /** Absent means the raw value, stringified by the DOM as it always was. */
  format?: Format;
}

/**
 * A record's number, mapped onto a range and written as a custom property.
 *
 * Phase D, and the one thing in the expression model that cannot be a shared
 * rule: a value that differs per row has to live on the row. So it goes in the
 * element's `style` attribute as `--cre8-<key>`, the designer writes
 * `opacity: var(--cre8-<key>)` once, and the stylesheet does not grow by a
 * single byte as the collection does. Exactly the mechanism the comparison
 * slider already uses — see `RANGE_ATTR` in `runtime/behaviour.ts` — with a
 * record on the input side instead of a control.
 *
 * Always clamped. An un-clamped mapping produces an opacity of 1.4, which CSS
 * quietly fixes, and a width of -20px, which it does not; there is no reading
 * of "outside the range I declared" that a designer wants.
 */
export interface ValueVar {
  value: Value;
  /** The span of the data. Two equal numbers mean "always the low end of `to`". */
  from: [number, number];
  /** The span to map onto. May run backwards — `[1, 0]` is a perfectly good fade. */
  to: [number, number];
  /** Where a row with no usable number lands. Defaults to the start of `to`. */
  fallback?: number;
  /** Digits kept. Three by default: enough for opacity, small in the markup. */
  decimals?: number;
}

export interface NodeMeta {
  locked?: boolean;
  hidden?: boolean;
  /** Set on nodes that make up a component master tree. */
  componentId?: string;
  /** Author note, surfaced in the layer tree tooltip. */
  note?: string;
  /** Marks nodes produced by a template so they can be replaced wholesale. */
  templateKey?: string;
}

export interface SceneNode {
  id: NodeId;
  type: ElementType;
  name: string;
  parentId: NodeId | null;
  children: NodeId[];
  props: NodeProps;
  /** Base + per-breakpoint overrides. */
  styles: ResponsiveStyles;
  /**
   * Render `children` once per record.
   *
   * The second time the node tree stops being one-to-one with the DOM, and
   * deliberately the same shape as the first: `set` already makes one node
   * into several elements. This is that a level up — the subtree, not the
   * element — and the thing it adds is a record in scope for everything below.
   */
  repeat?: RepeatSpec;

  /**
   * Read fields of the record in scope into props.
   *
   * Applied *under* `set`, so a condition can still override what a record
   * says — "when out of stock, say Sold out" has to beat the bound price.
   *
   * Was `Record<string, string>` — a prop to a field name. Now a prop to a
   * `Binding`, so a price can arrive as a number and print as `$1,234.50`
   * without the number ever becoming a string anybody could compare.
   * `migrateDocument` converts the old shape, and the authoring kit still
   * accepts it: `bind: { text: 'title' }` in a `NodeSpec` means what it always
   * did.
   */
  bind?: Record<string, Binding>;

  /**
   * State assignments, in the order they apply.
   *
   * `WHEN price > 500000 → expensive`. Evaluated where the record is known —
   * at publish, and on the canvas against the record being designed against —
   * and the winner is written into the node's state attribute. Later rules win.
   *
   * Deliberately separate from `rules`: a rule says what a node *looks like*
   * when something holds, and this says what a node *is*. Merging them would
   * mean a list where some entries compile to CSS and some cannot, which is
   * the one distinction the renderer must never have to make at draw time.
   */
  assign?: StateRule[];

  /**
   * Numbers from the record, as custom properties on this element.
   *
   * Keyed by the name after `--cre8-`. Per instance, because that is the whole
   * point: a hundred rows carry a hundred numbers and share one rule.
   */
  vars?: Record<string, ValueVar>;

  /**
   * What this element points at, by slot.
   *
   * Elements have referred to each other since the first popover, and every
   * time it was spelled differently: a node id in `props.popoverTarget`, a
   * `popover@Name` awaiting a resolution pass, a `componentId`, a list of node
   * ids inside a component property. Two of those had their own resolver in
   * `factory.ts` and only one had cleanup, which is why deleting a panel left
   * every button that opened it pointing at an id that no longer existed —
   * silently, because a `popovertarget` naming nothing simply does nothing.
   *
   * A map fixes that where a prop could not: references can be *enumerated*,
   * so one function can walk them all when a node is deleted, when a subtree
   * is copied, or when a document is checked. `NodeProps` is primitives only,
   * so this could never have lived there anyway.
   *
   * A stored reference always holds a node id. The authoring form — a *name*,
   * written before ids exist — is a `NodeSpec` concern and is resolved by
   * `buildTree`, so nothing downstream has to know two shapes.
   */
  refs?: Partial<Record<RefSlot, Ref>>;

  /**
   * Conditional overrides, in the order they apply.
   *
   * Replaces the old `states` record. Authoring still accepts the shorthand —
   * `NodeSpec.states` and `ElementDefinition.defaultStates` are folded into
   * this by the factory — but nothing downstream reads anything else.
   */
  rules?: StyleRule[];

  /**
   * The state this element declares, if it declares one.
   *
   * Replaces three loose props — `switchKey`, `switchDefault`, `switchDesign` —
   * that described one thing and had no relationship to each other. Folded by
   * `hydrateDocument`, so a document saved before this reads identically and
   * nothing downstream sees two spellings.
   *
   * One, not a list: an element carries exactly one `data-cre8-switch` and
   * `stateFrom` settles exactly one value, so a second declaration would be a
   * field nothing could ever write.
   */
  state?: StateDecl;

  /**
   * What this instance says, where its component let it differ.
   *
   * Keyed by `ComponentProperty.id`, and only ever set on a node of type
   * `instance`. A key with no matching property is stale rather than wrong —
   * it is ignored, which is what lets a property be removed and re-added
   * without every instance losing what it said in between.
   */
  overrides?: Record<string, string | number | boolean | null>;

  meta: NodeMeta;

  /* Reserved extension points — declared so the format never has to change. */
  events?: NodeEventBinding[];
  bindings?: NodeDataBinding[];
}

/* --------------------------------------------------------------------------
 * Pages
 * ----------------------------------------------------------------------- */

export interface PageMeta {
  title?: string;
  description?: string;
  ogImage?: string;
  noIndex?: boolean;
}

export interface Page {
  id: string;
  name: string;
  /** URL path without leading slash. The home page uses `''`. */
  slug: string;
  rootNodeId: NodeId;
  order: number;
  isHome?: boolean;
  meta: PageMeta;
  /**
   * One published file per record, rather than one for the page.
   *
   * The page becomes a template: its `slug` is the directory, and each
   * record's own slug names a file inside it, so a page slugged `blog` over a
   * collection of thirty posts publishes `/blog/hello/`, `/blog/next-one/`
   * and twenty-eight more — and nothing at `/blog/` itself. The index that
   * usually sits there is a second, ordinary page with the same slug, the way
   * a folder holds both an index and its contents.
   *
   * The record is in scope for the whole tree, so `bind` works on any node of
   * it exactly as it does inside a repeater.
   */
  dynamic?: { collection: string };
}

/* --------------------------------------------------------------------------
 * Assets
 * ----------------------------------------------------------------------- */

export type AssetType = 'image' | 'svg' | 'video' | 'font' | 'icon';

/* --------------------------------------------------------------------------
 * Collections
 * ----------------------------------------------------------------------- */

/**
 * What a field can hold.
 *
 * Eight, and the list is short on purpose — every type is a branch in the
 * record form, the binding picker and eventually the renderer. `reference` and
 * `image` are the two that earn their complexity: without them a post has no
 * author and no cover, and every collection is a flat spreadsheet.
 */
export type FieldType =
  | 'text'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'image'
  | 'select'
  | 'reference';

export interface Field {
  /** Stable across renames — bindings point at this. */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Which collection a `reference` points at. */
  of?: string;
  /** What a `select` may be. */
  options?: string[];
}

/**
 * The shape of a collection. Its *records* are not here.
 *
 * A field list is a design decision: it is versioned with the document, undone
 * with the document, and exported with it. The content is not — it changes
 * without the design changing, runs to thousands of rows, and would bloat a
 * document that has to fit in IndexedDB and travel through a Durable Object on
 * every keystroke. So the schema lives here and the records live in D1.
 */
export interface Collection {
  id: string;
  name: string;
  /** Which field names the URL, once a page is routed at this collection. */
  slugField?: string;
  fields: Field[];
}

/**
 * One row of content.
 *
 * Mirrors the `records` table rather than being derived from it, because this
 * is what crosses the wire — `data` is the fields, and the four beside it are
 * the ones every query touches.
 */
export interface CollectionRecord {
  id: string;
  collectionId: string;
  slug?: string;
  position: number;
  published: boolean;
  data: Record<string, string | number | boolean | null>;
  createdAt: number;
  updatedAt: number;
}

/** A test a record must pass to appear in a repeater. */
export interface RecordFilter {
  field: string;
  /** `has` is substring-contains, for text. The other two are equality. */
  op: 'is' | 'isNot' | 'has';
  value: string;
}

/**
 * What a repeating node repeats over.
 *
 * Filter, sort and limit live on the node rather than in a saved query because
 * the same collection is nearly always shown two or three ways on one site —
 * three featured on the home page, all of them paginated on the index, the
 * rest in a sidebar. Making that a property of the *place* rather than of the
 * collection is what stops every variation from needing its own collection.
 */
export interface RepeatSpec {
  /** Collection id. A repeater whose collection has gone renders nothing. */
  collection: string;
  /** All of them must pass. "Either/or" is two repeaters, not a syntax. */
  filter?: RecordFilter[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  /** Rows to show, after filtering and sorting. Clamped to the limit below. */
  limit?: number;
  /**
   * Rows per published file, which splits the *page* rather than the list.
   *
   * Two hundred posts should not be one page with two hundred entries, so
   * `/blog/`, `/blog/2/`, `/blog/3/` are generated at publish — each a real
   * file, each indexable. That is the reason not to reach for client-side
   * paging, which hands a crawler page one and nothing else.
   *
   * A page paginates on the first repeater that asks; a second one on the same
   * page keeps its own rows and is ignored here, because a file cannot be page
   * two of two different things.
   */
  paginate?: number;
}

/**
 * Ceilings, stated so they can be refused rather than discovered.
 *
 * Every one of these is a number somebody will reach. A builder that degrades
 * quietly at the limit is worse than one that says no — so the editor checks
 * before offering the button, and the Worker checks the two it can afford to
 * count on every write.
 */
export const LIMITS = {
  collections: 25,
  fieldsPerCollection: 40,
  recordsPerCollection: 5000,
  recordsPerRepeat: 500,
  /**
   * Files one dynamic route may generate.
   *
   * Refused rather than written: a route that quietly produced four thousand
   * files would turn a typo in a collection id into a publish nobody can
   * undo, and the number is more useful in an error message than in a log.
   */
  pagesPerRoute: 1000,
  /** Bytes of serialised `data`. */
  recordBytes: 64 * 1024,
} as const;

/** One rung of a responsive image's ladder. */
export interface AssetSource {
  /** Intrinsic width in pixels — the number a `srcset` entry is keyed on. */
  width: number;
  url: string;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  /** Object URL, data URL, or CDN URL once uploaded to R2. */
  url: string;
  width?: number;
  height?: number;
  /** Bytes. */
  size?: number;
  mimeType?: string;
  /**
   * Narrower copies, for `srcset`. Absent with no backend, where each one
   * would be another data URL in a document that has to fit in IndexedDB.
   */
  sources?: AssetSource[];
  createdAt: number;
}

/* --------------------------------------------------------------------------
 * Components
 * ----------------------------------------------------------------------- */

/**
 * What kind of value a property carries, which is also what control it gets.
 *
 * Four, and the list is short on purpose: these are the things that differ
 * between two cards on the same page. Anything else — a colour, a size, a
 * different layout — is a change to the design, and a design that differs is
 * a second component or a detached copy.
 */
export type ComponentPropertyType = 'text' | 'image' | 'link' | 'visible';

/**
 * A named hole in a component master, which each instance fills for itself.
 *
 * The one property worth stating outright: **an override changes props, never
 * styles.** Two instances of a component render from the same master nodes and
 * therefore carry the same classes, so a per-instance style would need a
 * per-instance class and the whole cascade would have to learn about
 * instances. Text, image, link and visibility need none of that — they change
 * what an element says, not how it looks — which is why the stylesheet is
 * untouched by this and the published bytes still come out of one generator.
 */
export interface ComponentProperty {
  id: string;
  name: string;
  type: ComponentPropertyType;
  /**
   * The nodes it fills — one per variant that has a counterpart.
   *
   * A list rather than a single id because a variant is a *separate tree*: the
   * secondary button is its own nodes with its own classes, which is the whole
   * reason a variant can look different where an override cannot. One property
   * has to reach the label in whichever tree is on screen, so it names all of
   * them, and the scope simply carries an entry for each. Only the tree being
   * drawn is ever visited, so the ones that do not apply cost nothing.
   *
   * Kept in step by `addVariant`, which clones a tree and appends the copy of
   * whatever each property was pointing at.
   */
  nodeIds: NodeId[];
  /** Which prop on it. Absent for `visible`, which is not a prop. */
  prop?: string;
  /** What the master says, kept so an instance can be put back to it. */
  defaultValue?: string | number | boolean | null;
}

/**
 * An alternate master tree, chosen per instance.
 *
 * The answer to the thing a property deliberately cannot do. An override
 * changes what an element says because two instances share one set of nodes; a
 * variant changes how it *looks* because it is a different set of nodes, with
 * classes of its own. Primary and secondary, card with and without an image.
 *
 * The definition's own `rootNodeId` is the default and is not listed here — an
 * instance naming no variant draws it, which is every instance that existed
 * before variants did.
 */
export interface ComponentVariant {
  id: string;
  name: string;
  rootNodeId: NodeId;
}

/**
 * A component master is a real subtree in `document.nodes`, parented to the
 * document's component library rather than to a page. Instances reference it
 * by id, so editing the master updates every instance — the behaviour that
 * makes components worth having.
 */
export interface ComponentDefinition {
  id: string;
  name: string;
  rootNodeId: NodeId;
  category?: string;
  createdAt: number;
  /** Alternate master trees. The default is `rootNodeId` above. */
  variants?: ComponentVariant[];
  /** What an instance may change about itself. Order is the order shown. */
  properties?: ComponentProperty[];
}

/* --------------------------------------------------------------------------
 * Theme / design tokens
 * ----------------------------------------------------------------------- */

export interface ColorToken {
  id: string;
  name: string;
  value: string;
}

export interface FontToken {
  id: string;
  name: string;
  /** Full CSS font-family stack. */
  stack: string;
  /** Google Fonts family name, if the published site should load it. */
  webFont?: string;
  weights?: number[];
}

export interface TextStyleToken {
  id: string;
  name: string;
  styles: StyleDecl;
  responsive?: ResponsiveStyles;
}

export interface ScaleToken {
  id: string;
  name: string;
  value: string;
}

export interface Theme {
  colors: ColorToken[];
  fonts: FontToken[];
  textStyles: TextStyleToken[];
  spacing: ScaleToken[];
  radii: ScaleToken[];
  shadows: ScaleToken[];
  widths: ScaleToken[];
}

/* --------------------------------------------------------------------------
 * Project settings + document
 * ----------------------------------------------------------------------- */

export interface ProjectSettings {
  /** Applied to every page unless the page overrides it. */
  siteName: string;
  description?: string;
  favicon?: string;
  /** Injected into the published <head>. */
  customHead?: string;
  language: string;
  /**
   * Which way the writing runs. `ltr` unless it says otherwise.
   *
   * A property of the document rather than of an element, because it is not a
   * design decision made per box — it is what language the site is in, and
   * Arabic does not become English halfway down a page.
   *
   * What it costs is more than a `dir` attribute, and the reason is that this
   * library is written in *physical* properties: ninety-three blocks say
   * `paddingLeft`, and a left padding stays on the left when the page turns
   * around. So the generator rewrites the sided properties as their logical
   * equivalents when this is `rtl` — `padding-left` becomes
   * `padding-inline-start`, which is the left in English and the right in
   * Arabic. One setting mirrors the whole library, and nothing had to be
   * rewritten to get it.
   *
   * Only when it is `rtl`. An `ltr` document emits exactly the bytes it
   * emitted before this existed, so every site already published is untouched
   * and the byte-identical gate still has something to be identical about.
   */
  direction?: 'ltr' | 'rtl';
  /**
   * Per data source: what the file ships with, and what the canvas shows.
   *
   * The same pair a switch has — `switchDefault` and `switchDesign` — for the
   * same two reasons. `ships` is what a visitor sees for the instant before the
   * resolver runs and for ever if they have no scripting, so it is a real
   * design decision rather than a placeholder. `designing` never leaves the
   * editor, so looking at the evening version cannot change what a site says
   * in the morning.
   */
  data?: Record<string, { ships?: string; designing?: string }>;
  /**
   * Per collection: which record the canvas draws a dynamic page against.
   *
   * The third thing on this pattern, after `switchDesign` and `data.designing`,
   * and for the third time the same reason: a template with nothing in scope
   * is a page a designer cannot lay out, and the fix must be visible only in
   * the editor. Looking at one post can never be a way to publish that post.
   *
   * Record *ids*, not content, so this stays a design decision the size of a
   * string — and a stale id simply falls back to the first record.
   */
  designRecord?: Record<string, string>;
}

export interface PublishRecord {
  publishedAt: number;
  pageCount: number;
  nodeCount: number;
  bytes: number;
}

/**
 * 2 — `states` and the `when*` visibility props folded into `rules`.
 *
 * Read on load by `migrateDocument`. Version 1 was written by every document
 * built before that and never checked by anything, which is why the migration
 * had to be able to recognise the old shape rather than trust the number.
 */
export const DOCUMENT_VERSION = 2;

export interface Cre8Document {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  pages: Page[];
  /** Normalised across pages *and* component masters. */
  nodes: Record<NodeId, SceneNode>;
  assets: Asset[];
  components: ComponentDefinition[];
  theme: Theme;
  settings: ProjectSettings;

  lastPublished?: PublishRecord;

  /**
   * Collection *shapes* — the reserved slot, now filled.
   *
   * The rows they describe live in D1, not here. See `Collection`.
   */
  collections?: Collection[];

  /* RESERVED — the logic and integration layers land here. Present in the
     type so adding them is an additive change, never a migration. */
  actions?: unknown[];
  integrations?: Record<string, unknown>;
}

/** Lightweight record used by the project list, without loading the document. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  pageCount: number;
  thumbnail?: string;
  published?: boolean;
}
