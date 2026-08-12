/**
 * Read-only traversal over the normalised node map.
 *
 * These take the node map rather than the whole document so they work equally
 * against an immer draft, a published snapshot or a detached component tree.
 */

import { canContain, getElement, isInteractive } from './schema';
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
  if (wouldNestInteractive(nodes, nodeId, targetParentId)) return false;
  return true;
}

/**
 * The nearest thing a person can operate, this node or above it.
 *
 * Inclusive of `id` itself, because the question a drop asks is "would this
 * land inside something operable", and the drop target is the first candidate.
 */
export function interactiveAncestor(nodes: NodeMap, id: NodeId): SceneNode | null {
  let current: SceneNode | undefined = nodes[id];
  let guard = 0;
  while (current && guard++ < 1000) {
    if (isInteractive(current)) return current;
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return null;
}

/**
 * Would this move put something operable inside something else operable?
 *
 * `canContain` already refuses the pair — a button directly inside a link —
 * and cannot do more, because it compares two *types* and has no tree. So
 * `link > frame > button` was allowed: every individual step is legal and
 * nothing looked at the chain. The parser does not reject that markup, it
 * re-parents the button out of the link, so the canvas shows one thing and the
 * published page shows another with nothing reporting a problem.
 *
 * Both directions matter and only one is obvious. Dropping a button into a
 * link is the one people picture; dragging a *card that contains* a button
 * into a link is the same invalid markup and the easier mistake to make.
 */
export function wouldNestInteractive(
  nodes: NodeMap,
  nodeId: NodeId,
  targetParentId: NodeId
): boolean {
  if (!interactiveAncestor(nodes, targetParentId)) return false;
  return collectSubtree(nodes, nodeId).some((id) => {
    const node = nodes[id];
    return node ? isInteractive(node) : false;
  });
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

/**
 * Everywhere a jump could go, across the whole site.
 *
 * A pure function rather than logic inside the inspector hook, and the reason
 * is that "which page is this target on" is now part of the answer: the
 * grouping a designer sees has to agree with the page the reference resolves
 * against, and two copies of that rule would be two chances to disagree.
 *
 * The root being edited comes first and ungrouped — that is where most jumps
 * go, and a heading over the only list anybody wanted is noise. Every other
 * page follows under its own name. A component master is a root and is not a
 * page, so it is passed as `rootId` and its own nodes lead the list.
 */
export function jumpTargetsFor(
  doc: Pick<Cre8Document, 'nodes' | 'pages'>,
  rootId: NodeId,
  exclude?: NodeId
): { id: NodeId; name: string; page?: string }[] {
  const roots: { root: NodeId; page: string }[] = [{ root: rootId, page: '' }];
  for (const page of doc.pages) {
    if (page.rootNodeId !== rootId) roots.push({ root: page.rootNodeId, page: page.name });
  }

  const seen = new Set<NodeId>();
  const out: { id: NodeId; name: string; page?: string }[] = [];
  for (const { root, page } of roots) {
    for (const id of collectSubtree(doc.nodes, root)) {
      if (id === exclude || id === root || seen.has(id)) continue;
      const node = doc.nodes[id];
      if (!node) continue;
      // Something with a box or a heading. A jump needs an id in the markup,
      // which is minted when the reference is made — what it needs *here* is
      // to be a place somebody would recognise in a list.
      if (!getElement(node.type).container && node.type !== 'heading') continue;
      seen.add(id);
      out.push(page ? { id, name: node.name, page } : { id, name: node.name });
    }
  }
  return out;
}
