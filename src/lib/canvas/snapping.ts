'use client';

/**
 * Snapping for canvas resize and absolute drags.
 *
 * Candidates come from the boxes that are actually on screen — the parent's
 * content box, siblings, and their centre lines — so the guides always
 * correspond to something the designer can see.
 */

import type { NodeId, SceneNode } from '../document/types';
import { getElementFor } from '../editor/registry';
import type { SnapGuide } from '../editor/store';

export const SNAP_THRESHOLD = 6;

export interface SnapTarget {
  position: number;
  kind: 'edge' | 'center';
  /** Extent of the element that produced this line, for drawing the guide. */
  from: number;
  to: number;
}

export interface SnapResult {
  value: number;
  guide: SnapGuide | null;
  /** Distance moved by the snap; used to keep the opposite edge fixed. */
  delta: number;
}

export function collectTargets(
  node: SceneNode,
  nodes: Record<NodeId, SceneNode>,
  axis: 'x' | 'y'
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const parentId = node.parentId;
  const parentEl = parentId ? getElementFor(parentId) : null;

  if (parentEl) {
    const box = parentEl.getBoundingClientRect();
    const cs = getComputedStyle(parentEl);
    const px = (v: string) => Number.parseFloat(v) || 0;
    const left = box.left + px(cs.paddingLeft) + px(cs.borderLeftWidth);
    const right = box.right - px(cs.paddingRight) - px(cs.borderRightWidth);
    const top = box.top + px(cs.paddingTop) + px(cs.borderTopWidth);
    const bottom = box.bottom - px(cs.paddingBottom) - px(cs.borderBottomWidth);

    if (axis === 'x') {
      targets.push({ position: left, kind: 'edge', from: box.top, to: box.bottom });
      targets.push({ position: right, kind: 'edge', from: box.top, to: box.bottom });
      targets.push({ position: (left + right) / 2, kind: 'center', from: box.top, to: box.bottom });
    } else {
      targets.push({ position: top, kind: 'edge', from: box.left, to: box.right });
      targets.push({ position: bottom, kind: 'edge', from: box.left, to: box.right });
      targets.push({ position: (top + bottom) / 2, kind: 'center', from: box.left, to: box.right });
    }

    const parent = nodes[parentId!];
    for (const siblingId of parent?.children ?? []) {
      if (siblingId === node.id) continue;
      const el = getElementFor(siblingId);
      if (!el) continue;
      const sib = el.getBoundingClientRect();
      if (axis === 'x') {
        targets.push({ position: sib.left, kind: 'edge', from: sib.top, to: sib.bottom });
        targets.push({ position: sib.right, kind: 'edge', from: sib.top, to: sib.bottom });
        targets.push({
          position: sib.left + sib.width / 2,
          kind: 'center',
          from: sib.top,
          to: sib.bottom,
        });
      } else {
        targets.push({ position: sib.top, kind: 'edge', from: sib.left, to: sib.right });
        targets.push({ position: sib.bottom, kind: 'edge', from: sib.left, to: sib.right });
        targets.push({
          position: sib.top + sib.height / 2,
          kind: 'center',
          from: sib.left,
          to: sib.right,
        });
      }
    }
  }
  return targets;
}

export function snap(
  value: number,
  targets: SnapTarget[],
  axis: 'x' | 'y',
  threshold = SNAP_THRESHOLD
): SnapResult {
  let best: { target: SnapTarget; distance: number } | null = null;
  for (const target of targets) {
    const distance = Math.abs(target.position - value);
    if (distance > threshold) continue;
    // Centre lines are less common intentions than edges; break ties toward edges.
    const weighted = target.kind === 'center' ? distance + 0.5 : distance;
    if (!best || weighted < best.distance) best = { target, distance: weighted };
  }
  if (!best) return { value, guide: null, delta: 0 };

  return {
    value: best.target.position,
    delta: best.target.position - value,
    guide: {
      axis,
      position: best.target.position,
      start: best.target.from,
      end: best.target.to,
      kind: best.target.kind,
    },
  };
}

/** Round to the nearest multiple, used when snapping is switched off. */
export function quantise(value: number, grid = 1): number {
  return grid <= 1 ? Math.round(value) : Math.round(value / grid) * grid;
}
