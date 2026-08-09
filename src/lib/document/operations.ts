/**
 * Document operations.
 *
 * Every editor mutation lands here as a plain function over a mutable document.
 * The store runs them inside an immer transaction and records the resulting
 * patches, which is what makes undo/redo, batching and (later) AI-authored
 * edits all use one code path instead of three.
 *
 * These functions never touch selection, viewport or any other UI concern.
 */

import { cloneSubtree, createNode, structuredCloneCompat, type NodeSpec, buildTree } from './factory';
import { uid, slugify } from './id';
import { canContain, getElement } from './schema';
import {
  canReparent,
  collectSubtree,
  getNode,
  isAncestorOf,
  topMostNodes,
  type NodeMap,
} from './tree';
import type {
  Breakpoint,
  ComponentDefinition,
  Cre8Document,
  ElementType,
  NodeId,
  NodeProps,
  Page,
  SceneNode,
  StyleDecl,
  StyleProp,
  StyleState,
} from './types';

/* --------------------------------------------------------------------------
 * Structure
 * ----------------------------------------------------------------------- */

export function attachChild(
  nodes: NodeMap,
  parentId: NodeId,
  childId: NodeId,
  index?: number
): void {
  const parent = nodes[parentId];
  const child = nodes[childId];
  if (!parent || !child) return;

  detachChild(nodes, childId);
  const at = index === undefined ? parent.children.length : clamp(index, 0, parent.children.length);
  parent.children.splice(at, 0, childId);
  child.parentId = parentId;
}

export function detachChild(nodes: NodeMap, childId: NodeId): void {
  const child = nodes[childId];
  if (!child?.parentId) return;
  const parent = nodes[child.parentId];
  if (!parent) return;
  const index = parent.children.indexOf(childId);
  if (index >= 0) parent.children.splice(index, 1);
}

/** Insert an already-built subtree (root plus descendants) into the document. */
export function insertSubtree(
  doc: Cre8Document,
  subtree: NodeMap,
  rootId: NodeId,
  parentId: NodeId,
  index?: number
): NodeId | null {
  if (!doc.nodes[parentId]) return null;
  for (const [id, node] of Object.entries(subtree)) doc.nodes[id] = node;
  attachChild(doc.nodes, parentId, rootId, index);
  return rootId;
}

export function insertElement(
  doc: Cre8Document,
  type: ElementType,
  parentId: NodeId,
  index?: number,
  overrides?: { name?: string; props?: NodeProps; styles?: StyleDecl }
): NodeId | null {
  const parent = doc.nodes[parentId];
  if (!parent) return null;

  const node = createNode(type, overrides);
  node.name = overrides?.name ?? uniqueName(doc.nodes, getElement(type).defaultName);
  doc.nodes[node.id] = node;
  attachChild(doc.nodes, parentId, node.id, index);
  return node.id;
}

export function insertSpec(
  doc: Cre8Document,
  spec: NodeSpec,
  parentId: NodeId,
  index?: number
): NodeId | null {
  const subtree: NodeMap = {};
  const { rootId } = buildTree(spec, subtree, parentId);
  return insertSubtree(doc, subtree, rootId, parentId, index);
}

export function removeNodes(doc: Cre8Document, ids: NodeId[]): void {
  const roots = topMostNodes(doc.nodes, ids);
  for (const id of roots) {
    const node = doc.nodes[id];
    if (!node) continue;
    // Never delete a page root or a component master through this path.
    if (doc.pages.some((p) => p.rootNodeId === id)) continue;
    if (doc.components.some((c) => c.rootNodeId === id)) continue;

    detachChild(doc.nodes, id);
    for (const descendant of collectSubtree(doc.nodes, id)) delete doc.nodes[descendant];
  }
}

export function moveNodes(
  doc: Cre8Document,
  ids: NodeId[],
  parentId: NodeId,
  index: number
): void {
  const roots = topMostNodes(doc.nodes, ids).filter(
    (id) => canReparent(doc.nodes, id, parentId) && !isAncestorOf(doc.nodes, id, parentId)
  );
  if (!roots.length) return;

  const parent = doc.nodes[parentId];
  if (!parent) return;

  // Removing earlier siblings shifts the target index left; account for that
  // before any detach happens so the drop lands where the indicator was drawn.
  let target = clamp(index, 0, parent.children.length);
  for (const id of roots) {
    const current = parent.children.indexOf(id);
    if (current >= 0 && current < target) target--;
  }

  for (const id of roots) {
    attachChild(doc.nodes, parentId, id, target);
    target++;
  }
}

export function duplicateNodes(doc: Cre8Document, ids: NodeId[]): NodeId[] {
  const roots = topMostNodes(doc.nodes, ids);
  const created: NodeId[] = [];

  for (const id of roots) {
    const node = doc.nodes[id];
    if (!node?.parentId) continue;
    const parent = doc.nodes[node.parentId];
    if (!parent) continue;

    const subtree: NodeMap = {};
    const cloneId = cloneSubtree(doc.nodes, id, subtree, node.parentId);
    if (!cloneId) continue;
    const clone = subtree[cloneId]!;
    clone.name = uniqueName(doc.nodes, node.name);

    const index = parent.children.indexOf(id);
    insertSubtree(doc, subtree, cloneId, node.parentId, index + 1);
    created.push(cloneId);
  }
  return created;
}

/** Wrap a contiguous selection in a new frame, preserving order and position. */
export function groupNodes(doc: Cre8Document, ids: NodeId[], type: ElementType = 'frame'): NodeId | null {
  const roots = topMostNodes(doc.nodes, ids);
  if (!roots.length) return null;

  const first = doc.nodes[roots[0]!];
  const parentId = first?.parentId;
  if (!parentId) return null;
  const parent = doc.nodes[parentId];
  if (!parent) return null;
  if (!roots.every((id) => doc.nodes[id]?.parentId === parentId)) return null;

  const ordered = [...roots].sort(
    (a, b) => parent.children.indexOf(a) - parent.children.indexOf(b)
  );
  const insertAt = parent.children.indexOf(ordered[0]!);

  const group = createNode(type, {
    name: uniqueName(doc.nodes, 'Group'),
    styles: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      paddingTop: '0px',
      paddingRight: '0px',
      paddingBottom: '0px',
      paddingLeft: '0px',
      width: 'auto',
    },
  });
  doc.nodes[group.id] = group;
  attachChild(doc.nodes, parentId, group.id, insertAt);
  for (const id of ordered) attachChild(doc.nodes, group.id, id);
  return group.id;
}

export function ungroupNodes(doc: Cre8Document, ids: NodeId[]): NodeId[] {
  const released: NodeId[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node?.parentId || !node.children.length) continue;
    const parentId = node.parentId;
    const parent = doc.nodes[parentId];
    if (!parent) continue;

    let at = parent.children.indexOf(id) + 1;
    for (const childId of [...node.children]) {
      attachChild(doc.nodes, parentId, childId, at++);
      released.push(childId);
    }
    detachChild(doc.nodes, id);
    delete doc.nodes[id];
  }
  return released;
}

export function renameNode(doc: Cre8Document, id: NodeId, name: string): void {
  const node = doc.nodes[id];
  if (node) node.name = name.trim() || getElement(node.type).defaultName;
}

export function setNodeMeta(doc: Cre8Document, ids: NodeId[], patch: Partial<SceneNode['meta']>): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (node) Object.assign(node.meta, patch);
  }
}

/* --------------------------------------------------------------------------
 * Props & styles
 * ----------------------------------------------------------------------- */

export function setProps(doc: Cre8Document, ids: NodeId[], patch: NodeProps): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete node.props[key];
      else node.props[key] = value;
    }
  }
}

/**
 * Write style values at a breakpoint. `undefined` removes the declaration,
 * which is how "reset to inherited" works on tablet/mobile.
 */
export function setStyles(
  doc: Cre8Document,
  ids: NodeId[],
  breakpoint: Breakpoint,
  patch: StyleDecl
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    const layer = (node.styles[breakpoint] ??= {});
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') delete layer[key as StyleProp];
      else layer[key as StyleProp] = value as never;
    }
    if (breakpoint !== 'desktop' && Object.keys(layer).length === 0) delete node.styles[breakpoint];
  }
}

export function clearStyles(
  doc: Cre8Document,
  ids: NodeId[],
  breakpoint: Breakpoint,
  props: StyleProp[]
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    const layer = node?.styles[breakpoint];
    if (!layer) continue;
    for (const prop of props) delete layer[prop];
    if (breakpoint !== 'desktop' && Object.keys(layer).length === 0) delete node!.styles[breakpoint];
  }
}

export function setStateStyles(
  doc: Cre8Document,
  ids: NodeId[],
  state: StyleState,
  patch: StyleDecl
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    node.states ??= {};
    const layer = (node.states[state] ??= {});
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') delete layer[key as StyleProp];
      else layer[key as StyleProp] = value as never;
    }
    if (Object.keys(layer).length === 0) delete node.states[state];
  }
}

/** Copy the full style stack from one node onto others. */
export function pasteStyles(doc: Cre8Document, sourceId: NodeId, targetIds: NodeId[]): void {
  const source = doc.nodes[sourceId];
  if (!source) return;
  for (const id of targetIds) {
    const node = doc.nodes[id];
    if (!node || node.id === sourceId) continue;
    node.styles = structuredCloneCompat(source.styles);
    if (source.states) node.states = structuredCloneCompat(source.states);
  }
}

/* --------------------------------------------------------------------------
 * Pages
 * ----------------------------------------------------------------------- */

export function addPage(doc: Cre8Document, name: string): Page {
  const root = createNode('page', { name });
  doc.nodes[root.id] = root;

  const page: Page = {
    id: uid(),
    name,
    slug: uniqueSlug(doc, slugify(name) || 'page'),
    rootNodeId: root.id,
    order: doc.pages.length,
    meta: {},
  };
  doc.pages.push(page);
  return page;
}

export function duplicatePage(doc: Cre8Document, pageId: string): Page | null {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return null;

  const subtree: NodeMap = {};
  const rootId = cloneSubtree(doc.nodes, page.rootNodeId, subtree, null);
  if (!rootId) return null;
  for (const [id, node] of Object.entries(subtree)) doc.nodes[id] = node;

  const name = `${page.name} copy`;
  const copy: Page = {
    ...structuredCloneCompat(page),
    id: uid(),
    name,
    slug: uniqueSlug(doc, slugify(name)),
    rootNodeId: rootId,
    order: doc.pages.length,
    isHome: false,
  };
  doc.pages.push(copy);
  return copy;
}

export function removePage(doc: Cre8Document, pageId: string): void {
  if (doc.pages.length <= 1) return;
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index < 0) return;
  const [page] = doc.pages.splice(index, 1);
  if (!page) return;

  for (const id of collectSubtree(doc.nodes, page.rootNodeId)) delete doc.nodes[id];
  doc.pages.forEach((p, i) => (p.order = i));
  if (page.isHome && doc.pages[0]) doc.pages[0].isHome = true;
}

export function updatePage(doc: Cre8Document, pageId: string, patch: Partial<Page>): void {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return;
  if (patch.slug !== undefined) {
    const next = page.isHome ? '' : slugify(patch.slug);
    patch = { ...patch, slug: next === page.slug ? next : uniqueSlug(doc, next || 'page', pageId) };
  }
  Object.assign(page, patch);
  if (patch.name) {
    const root = doc.nodes[page.rootNodeId];
    if (root) root.name = patch.name;
  }
}

export function reorderPages(doc: Cre8Document, fromIndex: number, toIndex: number): void {
  const ordered = [...doc.pages].sort((a, b) => a.order - b.order);
  const [moved] = ordered.splice(fromIndex, 1);
  if (!moved) return;
  ordered.splice(clamp(toIndex, 0, ordered.length), 0, moved);
  ordered.forEach((p, i) => (p.order = i));
}

export function setHomePage(doc: Cre8Document, pageId: string): void {
  for (const page of doc.pages) {
    const isHome = page.id === pageId;
    page.isHome = isHome;
    if (isHome) page.slug = '';
    else if (page.slug === '') page.slug = uniqueSlug(doc, slugify(page.name) || 'page', page.id);
  }
}

function uniqueSlug(doc: Cre8Document, base: string, ignoreId?: string): string {
  const taken = new Set(doc.pages.filter((p) => p.id !== ignoreId).map((p) => p.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* --------------------------------------------------------------------------
 * Components
 * ----------------------------------------------------------------------- */

/**
 * Promote a subtree to a component and replace it in place with an instance.
 *
 * The master lives in `doc.nodes` (unparented), so editing it updates every
 * instance — which is the whole point of having components rather than copies.
 */
export function createComponentFromNode(
  doc: Cre8Document,
  nodeId: NodeId,
  name?: string
): { component: ComponentDefinition; instanceId: NodeId } | null {
  const node = doc.nodes[nodeId];
  if (!node?.parentId) return null;
  const parent = doc.nodes[node.parentId];
  if (!parent) return null;
  if (doc.components.some((c) => c.rootNodeId === nodeId)) return null;

  const master: NodeMap = {};
  const masterRootId = cloneSubtree(doc.nodes, nodeId, master, null);
  if (!masterRootId) return null;

  const component: ComponentDefinition = {
    id: uid(),
    name: name?.trim() || node.name,
    rootNodeId: masterRootId,
    createdAt: Date.now(),
  };

  for (const [id, n] of Object.entries(master)) {
    n.meta.componentId = component.id;
    doc.nodes[id] = n;
  }
  doc.components.push(component);

  const index = parent.children.indexOf(nodeId);
  removeNodes(doc, [nodeId]);
  const instanceId = insertInstance(doc, component.id, parent.id, index);
  if (!instanceId) return null;
  return { component, instanceId };
}

export function insertInstance(
  doc: Cre8Document,
  componentId: string,
  parentId: NodeId,
  index?: number
): NodeId | null {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component) return null;

  const node = createNode('instance', {
    name: component.name,
    props: { componentId },
  });
  doc.nodes[node.id] = node;
  attachChild(doc.nodes, parentId, node.id, index);
  return node.id;
}

/** Turn an instance back into ordinary, directly editable nodes. */
export function detachInstance(doc: Cre8Document, instanceId: NodeId): NodeId | null {
  const instance = doc.nodes[instanceId];
  if (!instance || instance.type !== 'instance' || !instance.parentId) return null;
  const component = doc.components.find((c) => c.id === instance.props.componentId);
  if (!component) return null;
  const parent = doc.nodes[instance.parentId];
  if (!parent) return null;

  const subtree: NodeMap = {};
  const rootId = cloneSubtree(doc.nodes, component.rootNodeId, subtree, instance.parentId);
  if (!rootId) return null;
  for (const n of Object.values(subtree)) delete n.meta.componentId;

  const index = parent.children.indexOf(instanceId);
  detachChild(doc.nodes, instanceId);
  delete doc.nodes[instanceId];
  insertSubtree(doc, subtree, rootId, parent.id, index);
  return rootId;
}

export function renameComponent(doc: Cre8Document, componentId: string, name: string): void {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component) return;
  component.name = name.trim() || component.name;
  const root = doc.nodes[component.rootNodeId];
  if (root) root.name = component.name;
}

/** Delete a component, detaching every instance so nothing silently vanishes. */
export function deleteComponent(doc: Cre8Document, componentId: string): void {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component) return;

  const instances = Object.values(doc.nodes).filter(
    (n) => n.type === 'instance' && n.props.componentId === componentId
  );
  for (const instance of instances) detachInstance(doc, instance.id);

  for (const id of collectSubtree(doc.nodes, component.rootNodeId)) delete doc.nodes[id];
  doc.components = doc.components.filter((c) => c.id !== componentId);
}

/* --------------------------------------------------------------------------
 * Assets & theme
 * ----------------------------------------------------------------------- */

export function removeAsset(doc: Cre8Document, assetId: string): void {
  doc.assets = doc.assets.filter((a) => a.id !== assetId);
}

export function renameAsset(doc: Cre8Document, assetId: string, name: string): void {
  const asset = doc.assets.find((a) => a.id === assetId);
  if (asset) asset.name = name.trim() || asset.name;
}

type ThemeScaleGroup = 'colors' | 'spacing' | 'radii' | 'shadows' | 'widths';

export function setToken(
  doc: Cre8Document,
  group: ThemeScaleGroup,
  id: string,
  patch: { name?: string; value?: string }
): void {
  const token = doc.theme[group].find((t) => t.id === id);
  if (!token) return;
  if (patch.name !== undefined) token.name = patch.name;
  if (patch.value !== undefined) token.value = patch.value;
}

export function addToken(
  doc: Cre8Document,
  group: ThemeScaleGroup,
  name: string,
  value: string
): string {
  const base = slugify(name) || 'token';
  let id = base;
  let n = 2;
  while (doc.theme[group].some((t) => t.id === id)) id = `${base}-${n++}`;
  doc.theme[group].push({ id, name, value });
  return id;
}

export function removeToken(doc: Cre8Document, group: ThemeScaleGroup, id: string): void {
  doc.theme[group] = doc.theme[group].filter((t) => t.id !== id);
}

export function setThemeFont(doc: Cre8Document, id: string, stack: string): void {
  const font = doc.theme.fonts.find((f) => f.id === id);
  if (font) font.stack = stack;
}

/* --------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "Section" → "Section 2" when the name is already taken. */
export function uniqueName(nodes: NodeMap, base: string): string {
  const stripped = base.replace(/\s\d+$/, '');
  const taken = new Set(Object.values(nodes).map((n) => n.name));
  if (!taken.has(stripped)) return stripped;
  let n = 2;
  while (taken.has(`${stripped} ${n}`)) n++;
  return `${stripped} ${n}`;
}

/**
 * Where a newly inserted element should go, given the current selection.
 *
 * `type` is optional so the caller can ask "where would anything go"; passed,
 * the walk skips ancestors that could not legally hold it. Without that, a
 * heading added while a table row is selected lands inside the row, renders
 * fine on the canvas, and is moved out of the table by the parser on the
 * published page.
 *
 * `null` means there is nowhere legal — a table row with no table anywhere
 * above the selection. Refusing beats parking it at the page root, where it
 * would look placed on the canvas and be discarded when the file is written.
 */
export function resolveInsertTarget(
  doc: Cre8Document,
  selectedId: NodeId | null,
  pageRootId: NodeId,
  type?: ElementType
): { parentId: NodeId; index: number } | null {
  const accepts = (parentType: ElementType): boolean =>
    type ? canContain(parentType, type) : getElement(parentType).container;

  const root = doc.nodes[pageRootId];
  const atRoot =
    root && accepts(root.type) ? { parentId: pageRootId, index: root.children.length } : null;

  let selected: SceneNode | undefined = getNode(doc.nodes, selectedId);
  if (!selected) return atRoot;

  // Dropping into a container puts the element inside it; otherwise it lands
  // directly after the selection, which is what people expect.
  if (accepts(selected.type)) {
    return { parentId: selected.id, index: selected.children.length };
  }

  // Climb until something can hold it, so inserting from the panel always
  // produces a legal tree rather than the nearest-looking one.
  let guard = 0;
  while (selected && guard++ < 200) {
    const parentId: NodeId | null = selected.parentId;
    const parent: SceneNode | undefined = parentId ? doc.nodes[parentId] : undefined;
    if (!parent || !parentId) break;
    if (accepts(parent.type)) {
      return { parentId, index: parent.children.indexOf(selected.id) + 1 };
    }
    selected = parent;
  }
  return atRoot;
}
