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
import { allRoots } from '@/lib/document/components';
import { collectSubtree, isEffectivelyLocked } from '@/lib/document/tree';
import type { NodeMap } from '@/lib/document/tree';
import { themeToStyleObject } from '@/lib/document/theme';
import { DOCUMENT_RESET, PLACEHOLDER_CSS, generateNodeCss } from '@/lib/renderer/css';
import { NodeView, RecordScope, RenderProvider } from '@/lib/renderer/render';
import { designRecord as pickDesignRecord } from '@/lib/renderer/repeat';
import { behaviourRuntime } from '@/lib/runtime/behaviour';
import { DATA_ATTR, collectDataSources, designTokens } from '@/lib/runtime/data';
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

/** The static prelude the canvas shares with preview and published output. */
const RESET = `${DOCUMENT_RESET}\n${PLACEHOLDER_CSS}`;

/**
 * CSS for a set of nodes, regenerated only when one of them actually moved.
 *
 * `useMemo` on the node map cannot do this: immer hands back a new map for
 * every edit, so the memo misses every time and the generator runs over the
 * whole document on each keystroke — which is most of what was left after the
 * sheet was split in two.
 *
 * What is true instead is that immer keeps the *identity* of nodes it did not
 * touch. So the cache key is the identity of each node in the set, and
 * checking it is a pointer comparison per node rather than a rule compiled per
 * node — the difference between a scan measured in microseconds and a
 * generation measured in milliseconds.
 *
 * Safe against the one thing that looks like it might break it: a rule whose
 * selector reaches for an ancestor uses that ancestor's *class*, which comes
 * from its id, and an id does not change when a style does.
 */
function useNodeSetCss(nodes: NodeMap, ids: readonly string[], prelude = ''): string {
  const cache = useRef<{ ids: readonly string[]; seen: unknown[]; css: string } | null>(null);
  const previous = cache.current;

  let unchanged = previous !== null && previous.ids.length === ids.length;
  if (unchanged && previous) {
    for (let i = 0; i < ids.length; i++) {
      if (previous.ids[i] !== ids[i] || previous.seen[i] !== nodes[ids[i]!]) {
        unchanged = false;
        break;
      }
    }
  }
  if (unchanged && previous) return previous.css;

  const generated = ids.length
    ? generateNodeCss(nodes, { mode: 'container', nodeIds: ids as string[], includeStates: false })
    : '';
  const css = prelude ? `${prelude}\n${generated}` : generated;
  cache.current = { ids, seen: ids.map((id) => nodes[id]), css };
  return css;
}

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

  /*
   * A page that is a template for a collection is drawn against a real record
   * rather than the placeholder text it was laid out with. Editor-only, and
   * the same shape as `switchDesign`: which record is a design-time choice
   * that never reaches a published file.
   */
  const routeCollection = useEditor(
    (s) => s.doc.pages.find((p) => p.id === s.activePageId)?.dynamic?.collection
  );
  const routeRows = useEditor((s) => (routeCollection ? s.records[routeCollection] : undefined));
  const projectSettings = useEditor((s) => s.doc.settings);
  const designRecord = useMemo(
    () => pickDesignRecord(projectSettings, routeCollection, routeRows),
    [projectSettings, routeCollection, routeRows]
  );
  useEffect(() => {
    if (routeCollection) useEditor.getState().loadRecords(routeCollection);
  }, [routeCollection]);
  const fitRequest = useEditor((s) => s.fitRequest);

  const frameWidth = BREAKPOINT_DEFS[breakpoint].width;

  useEffect(() => setViewportEl(viewportRef.current), []);

  /* --- Behaviour, in design mode ------------------------------------------
     The same runtime the published page gets, with `live` false: it brings
     `aria-pressed` in line with whichever case the designer is looking at and
     binds nothing, because a click on the canvas is someone reaching for the
     element, not reaching for the control. Which case is *shown* is not its
     job on either surface — a generated CSS rule does that, from the same
     attribute, which is why the two cannot disagree. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const nodesForSweep = useEditor((s) => s.doc.nodes);
  useEffect(() => {
    if (frameRef.current) behaviourRuntime(frameRef.current, false);
    // Keyed on the document rather than run bare. It used to have no
    // dependency array at all, so a full `querySelectorAll` pass over every
    // element on the canvas ran after *every* render — including the ones that
    // change nothing it reads: panning, zooming, hovering, selecting. Roles and
    // pairing are, in the runtime's own words, fixed for the life of the page.
  }, [nodesForSweep]);

  /* --- Stylesheet ---------------------------------------------------------
     Regenerated only when the node map changes; per-node rules are memoised
     on node identity, so an edit costs the nodes it touched, not the page. */
  const nodes = useEditor((s) => s.doc.nodes);
  const components = useEditor((s) => s.doc.components);
  const theme = useEditor((s) => s.doc.theme);

  const scopedIds = useMemo(() => {
    if (!rootId) return [];
    const ids = collectSubtree(nodes, rootId);
    // Every tree a component owns, not only its default. A variant's nodes
    // are nodes of their own with classes of their own, and leaving them out
    // gave the canvas an instance drawn with no rules at all while the
    // published file had them — which is precisely the divergence the whole
    // one-renderer arrangement exists to prevent.
    for (const component of components) {
      for (const root of allRoots(component)) ids.push(...collectSubtree(nodes, root));
    }
    return ids;
  }, [nodes, components, rootId]);

  /* --- Two sheets, because one of them is being typed into ----------------
   *
   * The stylesheet used to be one string memoised on the node map, so every
   * keystroke produced a new one, React rewrote the `<style>` element, and the
   * browser reparsed the whole sheet and recalculated style for every element
   * on the canvas. Measured on a 761-node document that was thirty long tasks
   * and two seconds of blocked main thread for forty arrow-key nudges — the
   * cost of an edit scaled with the size of the document rather than the size
   * of the edit, which is the opposite of what this was supposed to do.
   *
   * So the selection is generated separately. Scrubbing a value rewrites a
   * sheet holding one node's rules; the sheet holding the other seven hundred
   * is a stable string, React leaves the element alone, and nothing is
   * reparsed. Inserting or deleting *does* rewrite the big one, but that is a
   * discrete action rather than something that happens sixty times a second.
   *
   * Splitting is safe because of a property the generator already relies on:
   * within a phase every node contributes at most one rule and every selector
   * is a different node's class, so nothing here can be reordered relative to
   * anything it overlaps. A node's own rules — the order-sensitive ones — stay
   * contiguous, in the same order, in whichever sheet holds them.
   */
  const selection = useEditor((s) => s.selection);
  const hotIds = useMemo(
    () => selection.filter((id) => Boolean(nodes[id])),
    // Deliberately not on `nodes`: this is the *set* being edited, and
    // recomputing it per keystroke is the walk this split exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection]
  );
  const hot = useMemo(() => new Set(hotIds), [hotIds]);
  const coldIds = useMemo(() => scopedIds.filter((id) => !hot.has(id)), [scopedIds, hot]);

  // The same reset the preview and the published file get. Without it the
  // canvas would be styled by whatever the editor app's own stylesheet happens
  // to reset, and the three surfaces would only agree by coincidence.
  const coldCss = useNodeSetCss(nodes, coldIds, RESET);
  const hotCss = useNodeSetCss(nodes, hotIds);

  const themeVars = useMemo(() => themeToStyleObject(theme), [theme]);

  /* --- Data conditions -----------------------------------------------------
     The published page hangs these off `<html>`; the frame is the equivalent
     ancestor here. Same attribute, same selectors, so a rule that reads "in
     the evening" is answered by the same mechanism on both surfaces — the only
     difference is that here the value is one the designer chose. */
  const settings = useEditor((s) => s.doc.settings);
  const dataTokens = useMemo(
    () => designTokens(settings, collectDataSources(nodes, scopedIds)),
    [settings, nodes, scopedIds]
  );

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
      // Editor chrome drawn inside the viewport (the empty state, floating
      // panels) owns its own pointer handling. Without this the canvas would
      // capture the pointer here and those elements would never see a click.
      if (target.closest('[data-cre8-chrome]')) return;

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
      // Into the tree this instance is actually wearing. Opening the default
      // from a secondary button would show a design that has nothing to do
      // with what was double-clicked.
      if (componentId) store.editComponent(componentId, String(node.props.variantId ?? '') || null);
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
            ref={frameRef}
            {...(dataTokens ? { [DATA_ATTR]: dataTokens } : {})}
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
            <style dangerouslySetInnerHTML={{ __html: coldCss }} />
            <style dangerouslySetInnerHTML={{ __html: hotCss }} />
            {rootId && (
              <RenderProvider engine={editorEngine} editingId={editingTextId}>
                <RecordScope record={designRecord}>
                  <NodeView id={rootId} />
                </RecordScope>
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
