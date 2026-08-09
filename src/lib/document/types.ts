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
  placeItems?: string;

  /* Position */
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  inset?: string;
  zIndex?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
  /** `hidden` empties the box without taking its space. */
  visibility?: string;

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
  transformOrigin?: string;
  mixBlendMode?: string;
  transition?: string;

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
  /** All must hold. Empty is legal: a part with no condition, like a backdrop. */
  when: Condition[];
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
 * RESERVED — not written by this release.
 *
 * Behaviour ("what it does") is deliberately modelled as a separate axis from
 * presentation and structure so it can be added without touching the renderer
 * or the document format. See docs/ARCHITECTURE.md.
 */
export interface NodeEventBinding {
  event: string;
  actions: Array<{ type: string; params?: Record<string, unknown> }>;
}

/** RESERVED — data bindings for a future CMS / database layer. */
export interface NodeDataBinding {
  /** Which prop or style the bound value feeds. */
  target: string;
  /** Opaque expression, resolved by a future data layer. */
  source: string;
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
   * Conditional overrides, in the order they apply.
   *
   * Replaces the old `states` record. Authoring still accepts the shorthand —
   * `NodeSpec.states` and `ElementDefinition.defaultStates` are folded into
   * this by the factory — but nothing downstream reads anything else.
   */
  rules?: StyleRule[];
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
  /** RESERVED — dynamic/CMS routes will set this. */
  dynamic?: { collection: string; param: string };
}

/* --------------------------------------------------------------------------
 * Assets
 * ----------------------------------------------------------------------- */

export type AssetType = 'image' | 'svg' | 'video' | 'font' | 'icon';

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
  createdAt: number;
}

/* --------------------------------------------------------------------------
 * Components
 * ----------------------------------------------------------------------- */

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
  /** RESERVED — variants and exposed properties. */
  variants?: Array<{ id: string; name: string; rootNodeId: NodeId }>;
  properties?: Array<{ id: string; name: string; type: string; defaultValue?: unknown }>;
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

  /* RESERVED — the CMS / database / logic layers land here. Present in the
     type so adding them is an additive change, never a migration. */
  collections?: unknown[];
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
