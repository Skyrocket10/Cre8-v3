'use client';

/**
 * Canvas overlays: hover outline, selection boxes, resize handles, drop
 * indicator and snap guides.
 *
 * All of it is drawn on a layer *above* the transformed canvas, in viewport
 * pixels, so strokes and handles keep a constant size no matter the zoom —
 * the thing that separates a design tool from a scaled screenshot.
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { getElement } from '@/lib/document/schema';
import type { NodeId } from '@/lib/document/types';
import { collectTargets, snap, type SnapTarget } from '@/lib/canvas/snapping';
import { getElementFor } from '@/lib/editor/registry';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { useViewportRects } from './use-rects';
import type { ViewRect } from './use-rects';

export function CanvasOverlays({ viewport }: { viewport: HTMLElement | null }) {
  const selection = useEditor((s) => s.selection);
  const hoverId = useEditor((s) => s.hoverId);
  const editingTextId = useEditor((s) => s.editingTextId);
  const drag = useEditor((s) => s.drag);

  const ids = useMemo(() => {
    const set = new Set<NodeId>(selection);
    if (hoverId) set.add(hoverId);
    return [...set];
  }, [selection, hoverId]);

  const rects = useViewportRects(ids, viewport);
  const dragging = Boolean(drag?.active);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {hoverId && !selection.includes(hoverId) && !dragging && (
        <HoverOutline id={hoverId} rect={rects.get(hoverId)} />
      )}

      {!dragging &&
        selection.map((id, index) => (
          <SelectionBox
            key={id}
            id={id}
            rect={rects.get(id)}
            primary={index === 0}
            multiple={selection.length > 1}
            editing={editingTextId === id}
          />
        ))}

      <DropIndicator viewport={viewport} />
      <SnapGuides viewport={viewport} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Hover
 * ----------------------------------------------------------------------- */

function HoverOutline({ id, rect }: { id: NodeId; rect?: ViewRect }) {
  const name = useEditor((s) => s.doc.nodes[id]?.name);
  if (!rect || rect.width === 0) return null;
  return (
    <>
      <div
        className="absolute rounded-[1px] outline-1 outline-offset-0 outline-[var(--hover-outline)]"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      />
      <Label x={rect.x} y={rect.y} tone="hover">
        {name}
      </Label>
    </>
  );
}

/* --------------------------------------------------------------------------
 * Selection
 * ----------------------------------------------------------------------- */

function SelectionBox({
  id,
  rect,
  primary,
  multiple,
  editing,
}: {
  id: NodeId;
  rect?: ViewRect;
  primary: boolean;
  multiple: boolean;
  editing: boolean;
}) {
  const node = useEditor((s) => s.doc.nodes[id]);
  const zoom = useEditor((s) => s.zoom);
  if (!rect || !node) return null;

  const def = getElement(node.type);
  const canResize = primary && !multiple && !editing && (def.resize.x || def.resize.y);

  return (
    <>
      <div
        data-cre8-selection
        className={cn(
          'absolute outline-[1.5px] outline-offset-0',
          editing ? 'outline-[var(--success)]' : 'outline-[var(--selection)]'
        )}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      />
      {primary && (
        <Label x={rect.x} y={rect.y} tone={editing ? 'editing' : 'selected'}>
          {node.name}
          {node.type === 'instance' && <span className="ml-1 opacity-70">◈</span>}
        </Label>
      )}
      {primary && !editing && (
        <SizeBadge rect={rect} width={rect.width / zoom} height={rect.height / zoom} />
      )}
      {canResize && <ResizeHandles id={id} rect={rect} def={def} />}
    </>
  );
}

function Label({
  x,
  y,
  tone,
  children,
}: {
  x: number;
  y: number;
  tone: 'hover' | 'selected' | 'editing';
  children: React.ReactNode;
}) {
  const tones = {
    hover: 'bg-[var(--hover-outline)] text-white',
    selected: 'bg-[var(--selection)] text-white',
    editing: 'bg-[var(--success)] text-[#062217]',
  };
  return (
    <div
      className={cn(
        'absolute max-w-[220px] truncate rounded-[3px] px-1.5 py-px text-[10px] font-medium tracking-tight',
        tones[tone]
      )}
      style={{ left: x, top: y - 17 }}
    >
      {children}
    </div>
  );
}

function SizeBadge({ rect, width, height }: { rect: ViewRect; width: number; height: number }) {
  if (rect.width < 44 || rect.height < 22) return null;
  return (
    <div
      className="absolute rounded-[3px] bg-[var(--selection)] px-1.5 py-px text-[10px] font-medium text-white tabular"
      style={{
        left: rect.x + rect.width / 2,
        top: rect.y + rect.height + 6,
        transform: 'translateX(-50%)',
      }}
    >
      {Math.round(width)} × {Math.round(height)}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Resize
 * ----------------------------------------------------------------------- */

type HandleId = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: { id: HandleId; cursor: string; x: number; y: number; axis: 'x' | 'y' | 'xy' }[] = [
  { id: 'nw', cursor: 'nwse-resize', x: 0, y: 0, axis: 'xy' },
  { id: 'n', cursor: 'ns-resize', x: 0.5, y: 0, axis: 'y' },
  { id: 'ne', cursor: 'nesw-resize', x: 1, y: 0, axis: 'xy' },
  { id: 'e', cursor: 'ew-resize', x: 1, y: 0.5, axis: 'x' },
  { id: 'se', cursor: 'nwse-resize', x: 1, y: 1, axis: 'xy' },
  { id: 's', cursor: 'ns-resize', x: 0.5, y: 1, axis: 'y' },
  { id: 'sw', cursor: 'nesw-resize', x: 0, y: 1, axis: 'xy' },
  { id: 'w', cursor: 'ew-resize', x: 0, y: 0.5, axis: 'x' },
];

function ResizeHandles({
  id,
  rect,
  def,
}: {
  id: NodeId;
  rect: ViewRect;
  def: ReturnType<typeof getElement>;
}) {
  const drag = useRef<{
    handle: HandleId;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    targetsX: SnapTarget[];
    targetsY: SnapTarget[];
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  const begin = useCallback(
    (handle: HandleId) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const state = useEditor.getState();
      const node = state.doc.nodes[id];
      const el = getElementFor(id);
      if (!node || !el) return;
      const box = el.getBoundingClientRect();

      drag.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: box.width,
        startHeight: box.height,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        targetsX: state.snapEnabled ? collectTargets(node, state.doc.nodes, 'x') : [],
        targetsY: state.snapEnabled ? collectTargets(node, state.doc.nodes, 'y') : [],
      };
    },
    [id]
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const store = useEditor.getState();
      const zoom = store.zoom;
      const guides = [];

      const patch: Record<string, string> = {};
      const growsRight = state.handle.includes('e');
      const growsLeft = state.handle.includes('w');
      const growsDown = state.handle.includes('s');
      const growsUp = state.handle.includes('n');

      if (def.resize.x && (growsRight || growsLeft)) {
        const edge = growsRight ? state.right + (e.clientX - state.startX) : state.left + (e.clientX - state.startX);
        const snapped = snap(edge, state.targetsX, 'x');
        if (snapped.guide) guides.push(snapped.guide);
        const width = growsRight
          ? (snapped.value - state.left) / zoom
          : (state.right - snapped.value) / zoom;
        patch.width = `${Math.max(8, Math.round(width))}px`;
      }

      if (def.resize.y && (growsDown || growsUp)) {
        const edge = growsDown
          ? state.bottom + (e.clientY - state.startY)
          : state.top + (e.clientY - state.startY);
        const snapped = snap(edge, state.targetsY, 'y');
        if (snapped.guide) guides.push(snapped.guide);
        const height = growsDown
          ? (snapped.value - state.top) / zoom
          : (state.bottom - snapped.value) / zoom;
        patch.height = `${Math.max(8, Math.round(height))}px`;
      }

      if (Object.keys(patch).length) {
        store.setStyle(patch, { mergeKey: `resize:${id}`, quiet: true });
        store.invalidate();
      }
      store.setGuides(guides);
    },
    [def.resize.x, def.resize.y, id]
  );

  const end = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    useEditor.getState().setGuides([]);
  }, []);

  if (rect.width < 12 && rect.height < 12) return null;

  return (
    <>
      {HANDLES.map((handle) => {
        if (handle.axis === 'x' && !def.resize.x) return null;
        if (handle.axis === 'y' && !def.resize.y) return null;
        if (handle.axis === 'xy' && !(def.resize.x && def.resize.y)) return null;
        const isCorner = handle.axis === 'xy';
        // Edge handles become bars on large elements; that is a much easier
        // target than a 7px dot when you are dragging a section edge.
        const long = !isCorner;
        const horizontal = handle.id === 'n' || handle.id === 's';

        return (
          <div
            key={handle.id}
            onPointerDown={begin(handle.id)}
            onPointerMove={move}
            onPointerUp={end}
            className={cn(
              'pointer-events-auto absolute',
              isCorner &&
                'size-[7px] rounded-[2px] border border-white bg-[var(--selection)] shadow-[0_0_0_0.5px_rgba(0,0,0,0.35)]'
            )}
            style={{
              cursor: handle.cursor,
              left: rect.x + rect.width * handle.x,
              top: rect.y + rect.height * handle.y,
              transform: 'translate(-50%, -50%)',
              ...(long
                ? horizontal
                  ? { width: Math.max(16, rect.width - 16), height: 7 }
                  : { width: 7, height: Math.max(16, rect.height - 16) }
                : null),
            }}
          />
        );
      })}
    </>
  );
}

/* --------------------------------------------------------------------------
 * Drop indicator & guides
 * ----------------------------------------------------------------------- */

function DropIndicator({ viewport }: { viewport: HTMLElement | null }) {
  const indicator = useEditor((s) => s.dropIndicator);
  if (!indicator || !viewport) return null;
  const origin = viewport.getBoundingClientRect();

  return (
    <>
      {indicator.containerRect && (
        <div
          className="absolute rounded-[2px] outline-1 outline-dashed outline-[var(--accent-line)]"
          style={{
            left: indicator.containerRect.x - origin.left,
            top: indicator.containerRect.y - origin.top,
            width: indicator.containerRect.width,
            height: indicator.containerRect.height,
          }}
        />
      )}
      <div
        className="absolute rounded-full bg-[var(--accent)] shadow-[0_0_0_2px_var(--accent-subtle)]"
        style={{
          left: indicator.rect.x - origin.left,
          top: indicator.rect.y - origin.top,
          width: Math.max(2, indicator.rect.width),
          height: Math.max(2, indicator.rect.height),
        }}
      />
    </>
  );
}

function SnapGuides({ viewport }: { viewport: HTMLElement | null }) {
  const guides = useEditor((s) => s.guides);
  if (!guides.length || !viewport) return null;
  const origin = viewport.getBoundingClientRect();

  return (
    <>
      {guides.map((guide, i) => (
        <div
          key={i}
          className={cn(
            'absolute',
            guide.kind === 'center' ? 'bg-[#ff4dd8]' : 'bg-[var(--measure)]'
          )}
          style={
            guide.axis === 'x'
              ? {
                  left: guide.position - origin.left,
                  top: guide.start - origin.top,
                  width: 1,
                  height: guide.end - guide.start,
                }
              : {
                  left: guide.start - origin.left,
                  top: guide.position - origin.top,
                  width: guide.end - guide.start,
                  height: 1,
                }
          }
        />
      ))}
    </>
  );
}

