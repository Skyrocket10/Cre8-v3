'use client';

/**
 * Measures rendered nodes in viewport coordinates for the overlay layer.
 *
 * Overlays live outside the canvas transform so their strokes stay 1px at any
 * zoom. `getBoundingClientRect` already accounts for the transform, so no
 * manual zoom maths is needed here — just re-measure whenever anything that
 * could move a box changes.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { NodeId } from '@/lib/document/types';
import { getElementFor, subscribeToRegistry } from '@/lib/editor/registry';
import { useEditor } from '@/lib/editor/store';

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useViewportRects(
  ids: readonly NodeId[],
  viewport: HTMLElement | null
): Map<NodeId, ViewRect> {
  const measureToken = useEditor((s) => s.measureToken);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const [rects, setRects] = useState<Map<NodeId, ViewRect>>(() => new Map());

  const key = ids.join('|');

  const measure = useCallback(() => {
    if (!viewport || ids.length === 0) {
      setRects((prev) => (prev.size ? new Map() : prev));
      return;
    }
    const origin = viewport.getBoundingClientRect();
    const next = new Map<NodeId, ViewRect>();
    for (const id of ids) {
      const el = getElementFor(id);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      next.set(id, {
        x: box.left - origin.left,
        y: box.top - origin.top,
        width: box.width,
        height: box.height,
      });
    }
    setRects((prev) => (sameRects(prev, next) ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewport]);

  useLayoutEffect(measure, [measure, measureToken, zoom, pan]);

  useEffect(() => subscribeToRegistry(measure), [measure]);

  // Content can reflow without any store change at all — a web font finishing
  // loading, an image decoding, a container query flipping.
  useEffect(() => {
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    for (const id of ids) {
      const el = getElementFor(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewport, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return rects;
}

export function useViewportRect(id: NodeId | null, viewport: HTMLElement | null): ViewRect | null {
  const ids = id ? [id] : EMPTY;
  const rects = useViewportRects(ids, viewport);
  return id ? (rects.get(id) ?? null) : null;
}

const EMPTY: NodeId[] = [];

function sameRects(a: Map<NodeId, ViewRect>, b: Map<NodeId, ViewRect>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, rect] of b) {
    const other = a.get(id);
    if (
      !other ||
      Math.abs(other.x - rect.x) > 0.05 ||
      Math.abs(other.y - rect.y) > 0.05 ||
      Math.abs(other.width - rect.width) > 0.05 ||
      Math.abs(other.height - rect.height) > 0.05
    ) {
      return false;
    }
  }
  return true;
}
