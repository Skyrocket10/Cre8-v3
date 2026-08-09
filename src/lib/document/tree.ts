/**
 * Read-only traversal over the normalised node map.
 *
 * These take the node map rather than the whole document so they work equally
 * against an immer draft, a published snapshot or a detached component tree.
 */

import { canContain } from './schema';
import type { Cre8Document, NodeId, Page, SceneNode } from './types';

export type NodeMap = Record<NodeId, SceneNode>;

export function getNode(nodes: NodeMap, id: NodeId | null | undefined): SceneNode | undefined {
  return id ? nodes[id] : undefined;
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

/** True when the node, or any ancestor, is locked. */
export function isEffectivelyLocked(nodes: NodeMap, id: NodeId): boolean {
  let node: SceneNode | undefined = nodes[id];
  let guard = 0;
  while (node && guard++ < 1000) {
    if (node.meta.locked) return true;
    node = node.parentId ? nodes[node.parentId] : undefined;
  }
  return false;
}

export function getHomePage(doc: Cre8Document): Page | undefined {
  return doc.pages.find((p) => p.isHome) ?? doc.pages[0];
}

/**
 * Reject drops that would make a node its own descendant, target something
 * that can't hold children, land inside a locked subtree, or nest a pair the
 * HTML parser would quietly rearrange.
 */
export function canReparent(nodes: NodeMap, nodeId: NodeId, targetParentId: NodeId): boolean {
  if (nodeId === targetParentId) return false;
  const parent = nodes[targetParentId];
  const node = nodes[nodeId];
  if (!parent || !node) return false;
  if (!canContain(parent.type, node.type)) return false;
  if (isAncestorOf(nodes, nodeId, targetParentId)) return false;
  if (isEffectivelyLocked(nodes, targetParentId)) return false;
  return true;
}

/** Drops nodes whose ancestor is also in the set — they move with it anyway. */
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
