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

/**
 * Variants of a node's own rule.
 *
 * Three are interaction states, published as `:hover` / `:active` / `:focus`.
 * `backdrop` is the odd one: it is a pseudo-*element*, the sheet the browser
 * paints behind anything in the top layer, and it lives here because it is
 * the same thing mechanically — one more selector hung off the node's class.
 * A separate field would have meant a second path through the generator, the
 * inspector and the patch stream to say the same sentence.
 */
export type StyleState = 'hover' | 'active' | 'focus' | 'backdrop';

/** Which of those are `::` rather than `:`. */
export const PSEUDO_ELEMENT_STATES: readonly StyleState[] = ['backdrop'] as const;
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
  /** Hover/active/focus styles, base breakpoint only for now. */
  states?: StateStyles;
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
}

export interface PublishRecord {
  publishedAt: number;
  pageCount: number;
  nodeCount: number;
  bytes: number;
}

export const DOCUMENT_VERSION = 1;

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
