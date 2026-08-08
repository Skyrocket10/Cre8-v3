'use client';

/**
 * The canvas.
 *
 * A real page, rendered by the real renderer, inside a frame whose width is the
 * active breakpoint. The frame is a CSS container, so responsive rules resolve
 * against *it* rather than the browser window — resize to Mobile and the page
 * genuinely behaves as it will at 390px.
 *
 * Zoom and pan are a single transform on the scene; every piece of editor
 * chrome is drawn outside that transform so it never scales.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BREAKPOINT_DEFS } from '@/lib/document/types';
import { getElement } from '@/lib/document/schema';
import { collectSubtree, isEffectivelyLocked } from '@/lib/document/tree';
import { themeToStyleObject } from '@/lib/document/theme';
import { generateNodeCss } from '@/lib/renderer/css';
import { NodeView, RenderProvider } from '@/lib/renderer/render';
import { hitTest } from '@/lib/editor/registry';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { editorEngine } from './engine';
import { CanvasOverlays } from './overlays';
import { SpacingOverlay } from './spacing-overlay';
import { Rulers } from './rulers';
import { CanvasEmptyState } from './empty-state';

const FIT_PADDING = 72;
const DRAG_THRESHOLD = 4;

export function Canvas() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);

  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const breakpoint = useEditor((s) => s.breakpoint);
  const showRulers = useEditor((s) => s.showRulers);
  const showOutlines = useEditor((s) => s.showOutlines);
  const spacePanning = useEditor((s) => s.spacePanning);
  const editingTextId = useEditor((s) => s.editingTextId);
  const rootId = useEditor((s) => activeRootId(s));
  const fitRequest = useEditor((s) => s.fitRequest);

  const frameWidth = BREAKPOINT_DEFS[breakpoint].width;

  useEffect(() => setViewportEl(viewportRef.current), []);

  /* --- Stylesheet ---------------------------------------------------------
     Regenerated only when the node map changes; per-node rules are memoised
     on node identity, so an edit costs the nodes it touched, not the page. */
  const nodes = useEditor((s) => s.doc.nodes);
  const components = useEditor((s) => s.doc.components);
  const theme = useEditor((s) => s.doc.theme);

  const scopedIds = useMemo(() => {
    if (!rootId) return [];
    const ids = collectSubtree(nodes, rootId);
    for (const component of components) ids.push(...collectSubtree(nodes, component.rootNodeId));
    return ids;
  }, [nodes, components, rootId]);

  const css = useMemo(
    () => generateNodeCss(nodes, { mode: 'container', nodeIds: scopedIds, includeStates: false }),
    [nodes, scopedIds]
  );

  const themeVars = useMemo(() => themeToStyleObject(theme), [theme]);

  /* --- Fit to view -------------------------------------------------------- */

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { width } = viewport.getBoundingClientRect();
    const available = width - FIT_PADDING * 2;
    const nextZoom = Math.min(1, Math.max(0.15, available / frameWidth));
    const store = useEditor.getState();
    store.setZoom(nextZoom);
    store.setPan({ x: (width - frameWidth * nextZoom) / 2, y: 40 });
  }, [fitRequest, frameWidth]);

  /* --- Wheel: pan by default, zoom with the modifier ---------------------- */

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const store = useEditor.getState();

      if (e.ctrlKey || e.metaKey) {
        const rect = viewport.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0035);
        const next = Math.min(4, Math.max(0.1, store.zoom * factor));
        const ratio = next / store.zoom;
        // Keep the point under the cursor pinned while the scale changes.
        store.setPan({
          x: px - (px - store.pan.x) * ratio,
          y: py - (py - store.pan.y) * ratio,
        });
        store.setZoom(next);
      } else {
        store.setPan({ x: store.pan.x - e.deltaX, y: store.pan.y - e.deltaY });
      }
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  /* --- Pointer ------------------------------------------------------------ */

  const gesture = useRef<
    | { kind: 'pan'; lastX: number; lastY: number }
    | { kind: 'maybe-drag'; startX: number; startY: number; ids: string[] }
    | null
  >(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const store = useEditor.getState();
      const target = e.target as HTMLElement;
      // Overlay handles manage their own gestures.
      if (target.closest('[data-cre8-overlay-handle]')) return;

      if (store.spacePanning || e.button === 1) {
        e.preventDefault();
        gesture.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        viewportRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      const hit = hitTest(e.clientX, e.clientY);

      if (!hit) {
        store.select(null);
        gesture.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
        viewportRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      if (store.editingTextId && store.editingTextId !== hit) store.beginTextEdit(null);

      const node = store.doc.nodes[hit];
      // Alt reaches past the element you clicked to its parent — the fastest
      // way to grab a section without hunting in the layer tree.
      const targetId = e.altKey ? (node?.parentId ?? hit) : hit;

      if (e.shiftKey) {
        store.select(targetId, 'toggle');
      } else if (!store.selection.includes(targetId)) {
        store.select(targetId);
      }

      const draggable = !isEffectivelyLocked(store.doc.nodes, targetId) && targetId !== rootId;
      if (draggable && !store.editingTextId) {
        const ids = useEditor.getState().selection;
        gesture.current = {
          kind: 'maybe-drag',
          startX: e.clientX,
          startY: e.clientY,
          ids: ids.includes(targetId) ? ids : [targetId],
        };
      }
      viewportRef.current?.setPointerCapture(e.pointerId);
    },
    [rootId]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const store = useEditor.getState();
    const current = gesture.current;

    if (current?.kind === 'pan') {
      store.setPan({
        x: store.pan.x + (e.clientX - current.lastX),
        y: store.pan.y + (e.clientY - current.lastY),
      });
      current.lastX = e.clientX;
      current.lastY = e.clientY;
      return;
    }

    if (current?.kind === 'maybe-drag') {
      const distance = Math.abs(e.clientX - current.startX) + Math.abs(e.clientY - current.startY);
      if (distance > DRAG_THRESHOLD) {
        const names = current.ids
          .map((id) => store.doc.nodes[id]?.name)
          .filter(Boolean)
          .slice(0, 2);
        store.setDrag({
          payload: { kind: 'move', nodeIds: current.ids },
          x: e.clientX,
          y: e.clientY,
          active: true,
          label:
            current.ids.length > 1 ? `${current.ids.length} elements` : (names[0] ?? 'Element'),
        });
        gesture.current = null;
      }
      return;
    }

    if (store.drag) return;
    store.setHover(hitTest(e.clientX, e.clientY));
  }, []);

  const endGesture = useCallback((e: React.PointerEvent) => {
    gesture.current = null;
    viewportRef.current?.releasePointerCapture?.(e.pointerId);
  }, []);

  const onDoubleClick = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    const store = useEditor.getState();
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    const node = store.doc.nodes[hit];
    if (!node) return;

    if (getElement(node.type).textual) {
      store.beginTextEdit(hit);
    } else if (node.type === 'instance') {
      const componentId = String(node.props.componentId ?? '');
      if (componentId) store.editComponent(componentId);
    } else if (node.children.length) {
      store.select(node.children[0]!);
    }
  }, []);

  const cursor = spacePanning ? 'grab' : 'default';

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--workspace)]">
      <div
        ref={viewportRef}
        className="canvas-surface relative min-h-0 flex-1 touch-none overflow-hidden"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={() => useEditor.getState().setHover(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="absolute top-0 left-0 origin-top-left will-change-transform"
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
        >
          <FrameHeader width={frameWidth} zoom={zoom} />

          <div
            className={cn(
              'cre8-frame cre8-doc cre8-editing relative overflow-hidden bg-white',
              showOutlines && 'cre8-outlines'
            )}
            style={{
              width: frameWidth,
              minHeight: 600,
              ...(themeVars as React.CSSProperties),
              boxShadow: '0 4px 32px -4px rgba(0,0,0,0.34), 0 0 0 1px rgba(0,0,0,0.22)',
            }}
          >
            <style dangerouslySetInnerHTML={{ __html: css }} />
            {rootId && (
              <RenderProvider engine={editorEngine} editingId={editingTextId}>
                <NodeView id={rootId} />
              </RenderProvider>
            )}
          </div>
        </div>

        <CanvasOverlays viewport={viewportEl} />
        <SpacingOverlay viewport={viewportEl} />
        {showRulers && <Rulers viewport={viewportEl} frameWidth={frameWidth} />}
        <CanvasEmptyState />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Frame header
 * ----------------------------------------------------------------------- */

function FrameHeader({ width, zoom }: { width: number; zoom: number }) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const pageName = useEditor((s) => {
    if (s.editingComponentId) {
      const component = s.doc.components.find((c) => c.id === s.editingComponentId);
      return component ? `◈ ${component.name}` : 'Component';
    }
    return s.doc.pages.find((p) => p.id === s.activePageId)?.name ?? 'Page';
  });

  return (
    <div
      className="absolute left-0 flex select-none items-baseline gap-2 whitespace-nowrap"
      style={{
        bottom: '100%',
        marginBottom: 8 / zoom,
        // Counter-scale so the label stays legible at any zoom.
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'bottom left',
        width: width * zoom,
      }}
    >
      <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">{pageName}</span>
      <span className="text-[10.5px] text-[var(--text-faint)] tabular">
        {BREAKPOINT_DEFS[breakpoint].label} · {width}
      </span>
    </div>
  );
}
