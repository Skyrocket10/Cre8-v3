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
    const { rootId } = buildTree(childSpec, into, node.id);
    node.children.push(rootId);
  }
  return { rootId: node.id, nodes: into };
}

/** Deep-copy a subtree with fresh ids. Returns the new root id. */
export function cloneSubtree(
  source: NodeMap,
  rootId: NodeId,
  into: NodeMap,
  parentId: NodeId | null
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

  for (const childId of original.children) {
    const childCopy = cloneSubtree(source, childId, into, copy.id);
    if (childCopy) copy.children.push(childCopy);
  }
  return copy.id;
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
