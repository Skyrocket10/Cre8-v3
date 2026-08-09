/**
 * Constructors for every document entity.
 *
 * Nothing else in the app builds a node literal by hand — going through here
 * guarantees schema defaults, ids and required fields are always present, which
 * is what lets templates, the insert panel, paste, duplication and (later) AI
 * all produce identical, valid documents.
 */

import { uid } from './id';
import { getElement } from './schema';
import { createDefaultTheme } from './theme';
import {
  DOCUMENT_VERSION,
  type Asset,
  type Cre8Document,
  type ElementType,
  type NodeId,
  type NodeProps,
  type Page,
  type ResponsiveStyles,
  type SceneNode,
  type StyleDecl,
} from './types';
import type { NodeMap } from './tree';

export interface CreateNodeOptions {
  id?: NodeId;
  name?: string;
  props?: NodeProps;
  styles?: StyleDecl;
  responsive?: ResponsiveStyles;
  children?: NodeId[];
  parentId?: NodeId | null;
}

export function createNode(type: ElementType, options: CreateNodeOptions = {}): SceneNode {
  const def = getElement(type);
  return {
    id: options.id ?? uid(),
    type,
    name: options.name ?? def.defaultName,
    parentId: options.parentId ?? null,
    children: options.children ?? [],
    props: { ...def.defaultProps, ...options.props },
    styles: {
      ...options.responsive,
      desktop: { ...def.defaultStyles, ...options.styles, ...options.responsive?.desktop },
    },
    meta: {},
  };
}

/**
 * Declarative tree builder. Templates read far better as nested literals than
 * as a sequence of imperative inserts, and this keeps them a single expression
 * that can be serialised straight back out.
 */
export interface NodeSpec {
  type: ElementType;
  name?: string;
  props?: NodeProps;
  styles?: StyleDecl;
  responsive?: ResponsiveStyles;
  states?: SceneNode['states'];
  meta?: SceneNode['meta'];
  children?: NodeSpec[];
}

export function buildTree(
  spec: NodeSpec,
  into: NodeMap = {},
  parentId: NodeId | null = null
): { rootId: NodeId; nodes: NodeMap } {
  const rootId = buildSubtree(spec, into, parentId);
  // Only once the whole tree exists do the popovers have ids to point at.
  resolvePopoverRefs(into);
  return { rootId, nodes: into };
}

function buildSubtree(spec: NodeSpec, into: NodeMap, parentId: NodeId | null): NodeId {
  const node = createNode(spec.type, {
    name: spec.name,
    props: spec.props,
    styles: spec.styles,
    responsive: spec.responsive,
    parentId,
  });
  if (spec.states) node.states = spec.states;
  if (spec.meta) node.meta = { ...node.meta, ...spec.meta };

  into[node.id] = node;
  for (const childSpec of spec.children ?? []) {
    node.children.push(buildSubtree(childSpec, into, node.id));
  }
  return node.id;
}

/**
 * Point every deferred popover reference at the popover it names.
 *
 * A block describes its own wiring — "this button opens the Menu popover" —
 * but a spec has no ids, so the reference travels as a name until the nodes
 * exist. A name that matches nothing has the prop removed rather than left
 * dangling: a `popovertarget` pointing at no element makes the button do
 * nothing at all, which is worse than the button simply not being an invoker.
 */
const POPOVER_REF = 'popover@';

function resolvePopoverRefs(nodes: NodeMap): void {
  const byName = new Map<string, NodeId>();
  for (const node of Object.values(nodes)) {
    if (node.type === 'popover') byName.set(node.name, node.id);
  }

  for (const node of Object.values(nodes)) {
    const target = node.props.popoverTarget;
    if (typeof target !== 'string' || !target.startsWith(POPOVER_REF)) continue;
    const id = byName.get(target.slice(POPOVER_REF.length));
    if (id) node.props.popoverTarget = id;
    else delete node.props.popoverTarget;
  }
}

/** Deep-copy a subtree with fresh ids. Returns the new root id. */
export function cloneSubtree(
  source: NodeMap,
  rootId: NodeId,
  into: NodeMap,
  parentId: NodeId | null
): NodeId | null {
  const remap = new Map<NodeId, NodeId>();
  const newRoot = copySubtree(source, rootId, into, parentId, remap);
  if (newRoot) rewireInternalRefs(into, remap);
  return newRoot;
}

function copySubtree(
  source: NodeMap,
  rootId: NodeId,
  into: NodeMap,
  parentId: NodeId | null,
  remap: Map<NodeId, NodeId>
): NodeId | null {
  const original = source[rootId];
  if (!original) return null;

  const copy: SceneNode = {
    ...structuredCloneCompat(original),
    id: uid(),
    parentId,
    children: [],
  };
  into[copy.id] = copy;
  remap.set(rootId, copy.id);

  for (const childId of original.children) {
    const childCopy = copySubtree(source, childId, into, copy.id, remap);
    if (childCopy) copy.children.push(childCopy);
  }
  return copy.id;
}

/**
 * Re-point props that name another node in the same copied subtree.
 *
 * Duplicate a header whose button opens its menu and, without this, both
 * copies open the *first* menu — the second one is unreachable and the bug
 * only shows up when someone clicks. A reference that leaves the subtree is
 * left pointing where it did, which is the right answer for copying a button
 * out of a nav that stays where it is.
 */
function rewireInternalRefs(nodes: NodeMap, remap: Map<NodeId, NodeId>): void {
  for (const id of remap.values()) {
    const node = nodes[id];
    const target = node?.props.popoverTarget;
    if (!node || typeof target !== 'string') continue;
    const moved = remap.get(target);
    if (moved) node.props.popoverTarget = moved;
  }
}

/** `structuredClone` isn't available on every runtime we target. */
function structuredCloneCompat<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* immer drafts and proxies can throw — fall through */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export { structuredCloneCompat };

/* --------------------------------------------------------------------------
 * Pages, assets, components
 * ----------------------------------------------------------------------- */

/**
 * A link target that names a page by slug instead of by id.
 *
 * The inspector writes `page:<id>`, which templates cannot: they describe a
 * whole site in one expression, so the pages they link to do not have ids yet.
 * This is the deferred form — `resolvePageRefs` turns it into a real reference
 * once the document is assembled.
 */
const PAGE_REF = 'page@';

export const pageRef = (slug: string): string => `${PAGE_REF}${slug}`;

/**
 * Turn every deferred page reference into a real one.
 *
 * A slug that matches no page becomes `#` rather than shipping a href nothing
 * can resolve — a template that names a page it does not have should produce an
 * inert link, not a broken one.
 */
export function resolvePageRefs(doc: Cre8Document): void {
  const bySlug = new Map(doc.pages.map((page) => [page.slug, page.id]));
  for (const node of Object.values(doc.nodes)) {
    const href = node.props.href;
    if (typeof href !== 'string' || !href.startsWith(PAGE_REF)) continue;
    const id = bySlug.get(href.slice(PAGE_REF.length));
    node.props.href = id ? `page:${id}` : '#';
  }
}

export function createPage(
  name: string,
  slug: string,
  nodes: NodeMap,
  order: number,
  isHome = false
): Page {
  const root = createNode('page', { name: name || 'Page' });
  nodes[root.id] = root;
  return {
    id: uid(),
    name,
    slug,
    rootNodeId: root.id,
    order,
    isHome,
    // Left empty on purpose so the published <title> falls back to the
    // page name and site name rather than freezing a copy of it here.
    meta: {},
  };
}

export function createAsset(input: Omit<Asset, 'id' | 'createdAt'>): Asset {
  return { ...input, id: uid(), createdAt: Date.now() };
}

/* --------------------------------------------------------------------------
 * Documents
 * ----------------------------------------------------------------------- */

export function createEmptyDocument(name = 'Untitled project'): Cre8Document {
  const nodes: NodeMap = {};
  const home = createPage('Home', '', nodes, 0, true);
  const now = Date.now();

  return {
    version: DOCUMENT_VERSION,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    pages: [home],
    nodes,
    assets: [],
    components: [],
    theme: createDefaultTheme(),
    settings: { siteName: name, language: 'en' },
  };
}

/**
 * Normalise anything loaded from storage or a template so the rest of the app
 * can rely on required fields existing. Cheap insurance against hand-edited
 * JSON and older documents.
 */
export function hydrateDocument(input: Partial<Cre8Document> & { nodes?: NodeMap }): Cre8Document {
  const base = createEmptyDocument(input.name ?? 'Untitled project');
  const doc: Cre8Document = {
    ...base,
    ...input,
    version: DOCUMENT_VERSION,
    theme: { ...base.theme, ...(input.theme ?? {}) },
    settings: { ...base.settings, ...(input.settings ?? {}) },
    nodes: input.nodes ?? base.nodes,
    pages: input.pages?.length ? input.pages : base.pages,
    assets: input.assets ?? [],
    components: input.components ?? [],
  };

  for (const node of Object.values(doc.nodes)) {
    node.children ??= [];
    node.props ??= {};
    node.styles ??= {};
    node.meta ??= {};
    if (node.parentId === undefined) node.parentId = null;
  }

  // Re-derive parent links from children arrays; children are the source of
  // truth because that is what ordering depends on.
  for (const node of Object.values(doc.nodes)) {
    for (const childId of node.children) {
      const child = doc.nodes[childId];
      if (child) child.parentId = node.id;
    }
  }

  // Drop children that point at nodes which no longer exist.
  for (const node of Object.values(doc.nodes)) {
    node.children = node.children.filter((id) => Boolean(doc.nodes[id]));
  }

  if (!doc.pages.some((p) => p.isHome) && doc.pages[0]) doc.pages[0].isHome = true;
  doc.pages.forEach((page, index) => {
    page.order ??= index;
    page.meta ??= {};
  });

  return doc;
}
