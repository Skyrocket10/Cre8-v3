'use client';

/**
 * DOM element registry for the canvas.
 *
 * Overlays (selection box, hover outline, spacing visualisation, snap guides)
 * are measured from the real rendered elements rather than from a parallel
 * geometry model — that is the only way a flow-layout editor can draw handles
 * that actually match what the browser laid out.
 *
 * Deliberately outside React state: registration happens during ref callbacks,
 * dozens of times per render, and must never schedule an update.
 */

import type { NodeId } from '../document/types';

const elements = new Map<NodeId, HTMLElement>();
const listeners = new Set<() => void>();

let frame = 0;

function notify(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const listener of listeners) listener();
  });
}

export function registerElement(id: NodeId, el: HTMLElement | null): void {
  if (el) elements.set(id, el);
  else elements.delete(id);
  notify();
}

export function getElementFor(id: NodeId): HTMLElement | undefined {
  return elements.get(id);
}

export function hasElement(id: NodeId): boolean {
  return elements.has(id);
}

export function clearRegistry(): void {
  elements.clear();
}

/** Called whenever the set of registered elements changes. */
export function subscribeToRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Force overlays to re-measure — used after layout-affecting changes. */
export function invalidateMeasurements(): void {
  notify();
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Rect of a node in *document space* — the untransformed coordinate system of
 * the page frame — so overlays can be positioned inside the same zoom/pan
 * transform as the canvas instead of fighting it.
 */
export function measureInFrame(id: NodeId, frameEl: HTMLElement, zoom: number): Rect | null {
  const el = elements.get(id);
  if (!el || !frameEl.contains(el)) return null;
  const a = el.getBoundingClientRect();
  const b = frameEl.getBoundingClientRect();
  return {
    x: (a.left - b.left) / zoom,
    y: (a.top - b.top) / zoom,
    width: a.width / zoom,
    height: a.height / zoom,
  };
}

/** Computed box metrics used by the spacing overlay and the box-model widget. */
export interface BoxMetrics {
  padding: [number, number, number, number];
  margin: [number, number, number, number];
  border: [number, number, number, number];
  gap: number;
  flexDirection: string;
  display: string;
}

export function measureBox(id: NodeId): BoxMetrics | null {
  const el = elements.get(id);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const px = (v: string) => Number.parseFloat(v) || 0;
  return {
    padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
    margin: [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)],
    border: [
      px(cs.borderTopWidth),
      px(cs.borderRightWidth),
      px(cs.borderBottomWidth),
      px(cs.borderLeftWidth),
    ],
    gap: px(cs.rowGap || cs.gap),
    flexDirection: cs.flexDirection,
    display: cs.display,
  };
}

/** Innermost registered node under a viewport point, ignoring inert subtrees. */
export function hitTest(clientX: number, clientY: number): NodeId | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;
    const owner = (el as HTMLElement).closest?.('[data-cre8-id]');
    if (!owner) continue;
    const id = owner.getAttribute('data-cre8-id');
    if (id) return id;
  }
  return null;
}

/** Every registered node under a point, innermost first. */
export function hitTestAll(clientX: number, clientY: number): NodeId[] {
  const out: NodeId[] = [];
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const owner = (el as HTMLElement).closest?.('[data-cre8-id]');
    const id = owner?.getAttribute('data-cre8-id');
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
