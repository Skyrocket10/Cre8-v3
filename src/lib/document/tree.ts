/**
 * Read-only traversal helpers over the normalised node map.
 *
 * All of these take the node map (not the whole document) so they can be used
 * against an immer draft, a published snapshot, or a detached component tree
 * without caring which.
 */

import { getElement } from './schema';
import type { Cre8Document, ElementType, NodeId, Page, SceneNode } from './types';

export type NodeMap = Record<NodeId, SceneNode>;

export function getNode(nodes: NodeMap, id: NodeId | null | undefined): SceneNode | undefined {
  return id ? nodes[id] : undefined;
}

export function getChildren(nodes: NodeMap, id: NodeId): SceneNode[] {
  const node = nodes[id];
  if (!node) return [];
  const out: SceneNode[] = [];
  for (const childId of node.children) {
    const child = nodes[childId];
    if (child) out.push(child);
  }
  return out;
}

/** Root-first list of ancestors, excluding the node itself. */
export function getAncestors(nodes: NodeMap, id: NodeId): SceneNode[] {
  const out: SceneNode[] = [];
  let current = nodes[id]?.parentId;
  let guard = 0;
  while (current && guard++ < 1000) {
    const node = nodes[current];
    if (!node) break;
    out.unshift(node);
    current = node.parentId;
  }
  return out;
}

export function getRootOf(nodes: NodeMap, id: NodeId): SceneNode | undefined {
  let node = nodes[id];
  let guard = 0;
  while (node?.parentId && guard++ < 1000) {
    const parent = nodes[node.parentId];
    if (!parent) break;
    node = parent;
  }
  return node;
}

export function isAncestorOf(nodes: NodeMap, ancestorId: NodeId, id: NodeId): boolean {
  let current = nodes[id]?.parentId;
  let guard = 0;
  while (current && guard++ < 1000) {
    if (current === ancestorId) return true;
    current = nodes[current]?.parentId;
  }
  return false;
}

/** Depth-first, self included. */
export function collectSubtree(nodes: NodeMap, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [id];
  const seen = new Set<NodeId>();
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = nodes[current];
    if (!node) continue;
    out.push(current);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return out;
}

/** Depth-first walk in document order. Return `false` from `visit` to prune. */
export function walk(
  nodes: NodeMap,
  rootId: NodeId,
  visit: (node: SceneNode, depth: number) => boolean | void,
  depth = 0
): void {
  const node = nodes[rootId];
  if (!node) return;
  if (visit(node, depth) === false) return;
  for (const childId of node.children) walk(nodes, childId, visit, depth + 1);
}

export function indexInParent(nodes: NodeMap, id: NodeId): number {
  const parent = getNode(nodes, nodes[id]?.parentId);
  if (!parent) return -1;
  return parent.children.indexOf(id);
}

export function getDepth(nodes: NodeMap, id: NodeId): number {
  let depth = 0;
  let current = nodes[id]?.parentId;
  let guard = 0;
  while (current && guard++ < 1000) {
    depth++;
    current = nodes[current]?.parentId;
  }
  return depth;
}

/** Nearest ancestor (or self) that can accept children. */
export function nearestContainer(nodes: NodeMap, id: NodeId): SceneNode | undefined {
  let node: SceneNode | undefined = nodes[id];
  let guard = 0;
  while (node && guard++ < 1000) {
    if (getElement(node.type).container) return node;
    node = node.parentId ? nodes[node.parentId] : undefined;
  }
  return undefined;
}

/** True when the node, or any ancestor, is hidden or locked. */
export function isEffectivelyHidden(nodes: NodeMap, id: NodeId): boolean {
  let node: SceneNode | undefined = nodes[id];
  let guard = 0;
  while (node && guard++ < 1000) {
    if (node.meta.hidden) return true;
    node = node.parentId ? nodes[node.parentId] : undefined;
  }
  return false;
}

export function isEffectivelyLocked(nodes: NodeMap, id: NodeId): boolean {
  let node: SceneNode | undefined = nodes[id];
  let guard = 0;
  while (node && guard++ < 1000) {
    if (node.meta.locked) return true;
    node = node.parentId ? nodes[node.parentId] : undefined;
  }
  return false;
}

/* --------------------------------------------------------------------------
 * Document-level lookups
 * ----------------------------------------------------------------------- */

export function getPage(doc: Cre8Document, pageId: string): Page | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export function getHomePage(doc: Cre8Document): Page | undefined {
  return doc.pages.find((p) => p.isHome) ?? doc.pages[0];
}

export function sortedPages(doc: Cre8Document): Page[] {
  return [...doc.pages].sort((a, b) => a.order - b.order);
}

/** Which page (if any) a node belongs to. Component masters return undefined. */
export function pageOfNode(doc: Cre8Document, nodeId: NodeId): Page | undefined {
  const root = getRootOf(doc.nodes, nodeId);
  if (!root) return undefined;
  return doc.pages.find((p) => p.rootNodeId === root.id);
}

export function componentOfNode(doc: Cre8Document, nodeId: NodeId) {
  const root = getRootOf(doc.nodes, nodeId);
  if (!root) return undefined;
  return doc.components.find((c) => c.rootNodeId === root.id);
}

/**
 * Reject drops that would make a node its own descendant, or that target a
 * component master from a page (and vice versa).
 */
export function canReparent(nodes: NodeMap, nodeId: NodeId, targetParentId: NodeId): boolean {
  if (nodeId === targetParentId) return false;
  const parent = nodes[targetParentId];
  if (!parent) return false;
  if (!getElement(parent.type).container) return false;
  if (isAncestorOf(nodes, nodeId, targetParentId)) return false;
  if (isEffectivelyLocked(nodes, targetParentId)) return false;
  return true;
}

/** Nodes that would be redundant to move because an ancestor is also moving. */
export function topMostNodes(nodes: NodeMap, ids: NodeId[]): NodeId[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let parent = nodes[id]?.parentId;
    let guard = 0;
    while (parent && guard++ < 1000) {
      if (set.has(parent)) return false;
      parent = nodes[parent]?.parentId;
    }
    return true;
  });
}

/** Document-order comparison, used to keep multi-selection stable. */
export function compareDocumentOrder(nodes: NodeMap, a: NodeId, b: NodeId): number {
  const pathA = [...getAncestors(nodes, a).map((n) => n.id), a];
  const pathB = [...getAncestors(nodes, b).map((n) => n.id), b];
  const len = Math.min(pathA.length, pathB.length);
  for (let i = 0; i < len; i++) {
    if (pathA[i] === pathB[i]) continue;
    const parent = nodes[pathA[i]!]?.parentId;
    const siblings = parent ? (nodes[parent]?.children ?? []) : [];
    return siblings.indexOf(pathA[i]!) - siblings.indexOf(pathB[i]!);
  }
  return pathA.length - pathB.length;
}

export function countNodes(doc: Cre8Document): number {
  return Object.keys(doc.nodes).length;
}

export function describeType(type: ElementType): string {
  return getElement(type).label;
}
