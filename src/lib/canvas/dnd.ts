'use client';

/**
 * Drop targeting.
 *
 * The rule this implements: a designer points at a *place on the page*, not at
 * a place in the DOM. So we find the deepest container under the pointer that
 * can legally accept the payload, then work out which gap between its children
 * the pointer is closest to — measuring against the real laid-out boxes, and
 * using the container's own axis so a row inserts left/right and a column
 * inserts above/below.
 */

import { canContain } from '../document/schema';
import { isAncestorOf, type NodeMap } from '../document/tree';
import type { Cre8Document, ElementType, NodeId, SceneNode } from '../document/types';
import { getElementFor } from '../editor/registry';

export interface DropResult {
  parentId: NodeId;
  index: number;
  /** Insertion line, in viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number };
  orientation: 'horizontal' | 'vertical';
  containerRect: { x: number; y: number; width: number; height: number };
}

export interface DropQuery {
  clientX: number;
  clientY: number;
  doc: Cre8Document;
  /** Nodes being moved — never drop inside themselves. */
  excludeIds?: NodeId[];
  /**
   * What is being dropped.
   *
   * Supplied so a container can refuse a payload it cannot legally hold: a
   * frame dragged into a `<table>` is not a layout mistake the designer can
   * see and undo, it is markup the parser silently moves out of the table on
   * the published page. Omitted, any container will do.
   */
  payloadTypes?: ElementType[];
  /** Root of the surface being edited; drops never escape it. */
  rootId: NodeId;
}

const LINE_THICKNESS = 2;

export function computeDrop(query: DropQuery): DropResult | null {
  const { clientX, clientY, doc, rootId } = query;
  const exclude = new Set(query.excludeIds ?? []);

  const container = findContainer(clientX, clientY, doc.nodes, exclude, rootId, query.payloadTypes);
  if (!container) return null;

  const containerEl = getElementFor(container);
  if (!containerEl) return null;
  const containerBox = containerEl.getBoundingClientRect();

  const node = doc.nodes[container];
  if (!node) return null;

  const children = node.children
    .filter((id) => !exclude.has(id))
    .map((id) => ({ id, el: getElementFor(id) }))
    .filter((c): c is { id: NodeId; el: HTMLElement } => Boolean(c.el))
    .map((c) => ({ ...c, box: c.el.getBoundingClientRect() }))
    // Nodes taken out of flow would give nonsense insertion points.
    .filter((c) => c.box.width > 0 || c.box.height > 0);

  const style = getComputedStyle(containerEl);
  const horizontal =
    (style.display.includes('flex') && style.flexDirection.startsWith('row')) ||
    (style.display.includes('grid') && children.length > 1 && isRowish(children)) ||
    // A table row lays its cells out across, and says so with a display value
    // that is neither flex nor grid.
    style.display === 'table-row';

  const orientation: DropResult['orientation'] = horizontal ? 'vertical' : 'horizontal';

  const containerRect = boxToRect(containerBox);

  if (children.length === 0) {
    const inset = 6;
    return {
      parentId: container,
      index: 0,
      rect: horizontal
        ? {
            x: containerBox.left + inset,
            y: containerBox.top + inset,
            width: LINE_THICKNESS,
            height: Math.max(16, containerBox.height - inset * 2),
          }
        : {
            x: containerBox.left + inset,
            y: containerBox.top + Math.min(containerBox.height / 2, 24),
            width: Math.max(24, containerBox.width - inset * 2),
            height: LINE_THICKNESS,
          },
      orientation,
      containerRect,
    };
  }

  // Nearest gap: compare the pointer against each child's midpoint on the
  // layout axis, then draw the line in the gap rather than on top of a child.
  let index = children.length;
  for (let i = 0; i < children.length; i++) {
    const box = children[i]!.box;
    const mid = horizontal ? box.left + box.width / 2 : box.top + box.height / 2;
    const pointer = horizontal ? clientX : clientY;
    if (pointer < mid) {
      index = i;
      break;
    }
  }

  const before = children[index - 1];
  const after = children[index];

  let position: number;
  if (before && after) {
    position = horizontal
      ? (before.box.right + after.box.left) / 2
      : (before.box.bottom + after.box.top) / 2;
  } else if (after) {
    position = horizontal ? after.box.left - 1 : after.box.top - 1;
  } else if (before) {
    position = horizontal ? before.box.right + 1 : before.box.bottom + 1;
  } else {
    position = horizontal ? containerBox.left : containerBox.top;
  }

  const span = children.reduce(
    (acc, c) => ({
      min: Math.min(acc.min, horizontal ? c.box.top : c.box.left),
      max: Math.max(acc.max, horizontal ? c.box.bottom : c.box.right),
    }),
    { min: Infinity, max: -Infinity }
  );

  // The real index in the parent's child list, which may include excluded nodes.
  const anchorId = after?.id ?? null;
  const realIndex = anchorId ? node.children.indexOf(anchorId) : node.children.length;

  return {
    parentId: container,
    index: realIndex < 0 ? node.children.length : realIndex,
    rect: horizontal
      ? {
          x: position - LINE_THICKNESS / 2,
          y: span.min,
          width: LINE_THICKNESS,
          height: Math.max(12, span.max - span.min),
        }
      : {
          x: span.min,
          y: position - LINE_THICKNESS / 2,
          width: Math.max(12, span.max - span.min),
          height: LINE_THICKNESS,
        },
    orientation,
    containerRect,
  };
}

function isRowish(children: { box: DOMRect }[]): boolean {
  const first = children[0]!.box;
  const second = children[1]!.box;
  return Math.abs(first.top - second.top) < Math.abs(first.left - second.left);
}

function boxToRect(box: DOMRect) {
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/**
 * Deepest legal container under the pointer.
 *
 * Walking up from the hit element means a designer can aim at the visible
 * inside of a card and get the card, not the page, without knowing anything
 * about nesting.
 */
function findContainer(
  clientX: number,
  clientY: number,
  nodes: NodeMap,
  exclude: Set<NodeId>,
  rootId: NodeId,
  payloadTypes?: ElementType[]
): NodeId | null {
  const accepts = (type: ElementType): boolean =>
    payloadTypes?.length
      ? payloadTypes.every((payload) => canContain(type, payload))
      : canContain(type, 'frame');

  const stack = document.elementsFromPoint(clientX, clientY);

  for (const el of stack) {
    const owner = (el as HTMLElement).closest?.('[data-cre8-id]');
    const hitId = owner?.getAttribute('data-cre8-id');
    if (!hitId) continue;

    let current: NodeId | undefined = hitId;
    let guard = 0;
    while (current && guard++ < 200) {
      const node: SceneNode | undefined = nodes[current];
      if (!node) break;

      const usable =
        accepts(node.type) &&
        !exclude.has(current) &&
        !node.meta.locked &&
        ![...exclude].some((id) => isAncestorOf(nodes, id, current!)) &&
        (current === rootId || isAncestorOf(nodes, rootId, current));

      if (usable) return current;
      current = node.parentId ?? undefined;
    }
  }

  // Nothing usable under the pointer — fall back to the page itself so a drop
  // anywhere on the canvas still lands somewhere sensible. Unless the page
  // cannot hold it either, in which case no drop is the right answer: a `<tr>`
  // parked in the page root disappears when the file is written.
  const root = nodes[rootId];
  return root && accepts(root.type) ? rootId : null;
}

/**
 * Layer-tree drop targeting: above / below / inside, from the pointer's
 * position within a row.
 */
export type TreeDropZone = 'before' | 'after' | 'inside';

export function treeDropZone(
  clientY: number,
  rowTop: number,
  rowHeight: number,
  canNest: boolean
): TreeDropZone {
  const ratio = (clientY - rowTop) / rowHeight;
  if (!canNest) return ratio < 0.5 ? 'before' : 'after';
  if (ratio < 0.28) return 'before';
  if (ratio > 0.72) return 'after';
  return 'inside';
}
