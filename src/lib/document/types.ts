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
   * Render `children` once per record.
   *
   * The second time the node tree stops being one-to-one with the DOM, and
   * deliberately the same shape as the first: `set` already makes one node
   * into several elements. This is that a level up — the subtree, not the
   * element — and the thing it adds is a record in scope for everything below.
   */
  repeat?: RepeatSpec;

  /**
   * Read fields of the record in scope into props: `{ text: 'title' }`.
   *
   * Applied *under* `set`, so a condition can still override what a record
   * says — "when out of stock, say Sold out" has to beat the bound price.
   */
  bind?: Record<string, string>;

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
