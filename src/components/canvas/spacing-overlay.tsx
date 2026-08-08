'use client';

/**
 * On-canvas box model.
 *
 * Padding and gap are the two values designers change most and the two that
 * are most annoying to type, so both are draggable directly on the element:
 * grab the tinted band, pull, read the number. Alt applies to all sides,
 * Shift to the opposite pair — the same modifiers as the inspector widget.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getElement } from '@/lib/document/schema';
import type { NodeId, StyleDecl } from '@/lib/document/types';
import { getElementFor, measureBox, type BoxMetrics } from '@/lib/editor/registry';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import type { ViewRect } from './use-rects';
import { useViewportRect } from './use-rects';

type Side = 'top' | 'right' | 'bottom' | 'left';

const SIDE_PROP: Record<Side, keyof StyleDecl> = {
  top: 'paddingTop',
  right: 'paddingRight',
  bottom: 'paddingBottom',
  left: 'paddingLeft',
};

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export function SpacingOverlay({ viewport }: { viewport: HTMLElement | null }) {
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editingTextId);
  const dragging = useEditor((s) => Boolean(s.drag?.active));
  const id = selection.length === 1 ? selection[0]! : null;
  const node = useEditor((s) => (id ? s.doc.nodes[id] : undefined));
  const rect = useViewportRect(id, viewport);
  const zoom = useEditor((s) => s.zoom);
  const measureToken = useEditor((s) => s.measureToken);

  const [box, setBox] = useState<BoxMetrics | null>(null);

  useEffect(() => {
    setBox(id ? measureBox(id) : null);
  }, [id, measureToken, rect?.width, rect?.height]);

  if (!id || !node || !rect || !box || editing || dragging) return null;
  if (!getElement(node.type).container) return null;
  if (rect.width < 40 || rect.height < 24) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[21]">
      <PaddingBands id={id} rect={rect} box={box} zoom={zoom} />
      <GapHandles id={id} rect={rect} box={box} zoom={zoom} viewport={viewport} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Padding
 * ----------------------------------------------------------------------- */

function PaddingBands({
  id,
  rect,
  box,
  zoom,
}: {
  id: NodeId;
  rect: ViewRect;
  box: BoxMetrics;
  zoom: number;
}) {
  const [hovered, setHovered] = useState<Side | null>(null);
  const drag = useRef<{
    side: Side;
    start: number;
    startValue: number;
    all: boolean;
    pair: boolean;
  } | null>(null);

  const [top, right, bottom, left] = box.padding;
  const sizes: Record<Side, number> = { top, right, bottom, left };

  const begin = useCallback(
    (side: Side) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = {
        side,
        start: side === 'top' || side === 'bottom' ? e.clientY : e.clientX,
        startValue: sizes[side],
        all: e.altKey,
        pair: e.shiftKey,
      };
    },
    [sizes]
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const store = useEditor.getState();
      const current = state.side === 'top' || state.side === 'bottom' ? e.clientY : e.clientX;
      // Dragging away from the content grows the padding on every edge.
      const direction = state.side === 'top' || state.side === 'left' ? 1 : -1;
      const delta = ((current - state.start) * direction) / zoom;
      const next = Math.max(0, Math.round(state.startValue + delta));

      const patch: StyleDecl = {};
      if (state.all) {
        for (const side of ['top', 'right', 'bottom', 'left'] as Side[]) {
          patch[SIDE_PROP[side] as 'paddingTop'] = `${next}px`;
        }
      } else if (state.pair) {
        patch[SIDE_PROP[state.side] as 'paddingTop'] = `${next}px`;
        patch[SIDE_PROP[OPPOSITE[state.side]] as 'paddingTop'] = `${next}px`;
      } else {
        patch[SIDE_PROP[state.side] as 'paddingTop'] = `${next}px`;
      }

      store.setStyle(patch, { mergeKey: `padding:${id}`, quiet: true });
      store.invalidate();
    },
    [id, zoom]
  );

  const end = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const bands: { side: Side; style: React.CSSProperties; cursor: string }[] = [
    {
      side: 'top',
      cursor: 'ns-resize',
      style: { left: rect.x, top: rect.y, width: rect.width, height: Math.max(top * zoom, 0) },
    },
    {
      side: 'bottom',
      cursor: 'ns-resize',
      style: {
        left: rect.x,
        top: rect.y + rect.height - bottom * zoom,
        width: rect.width,
        height: Math.max(bottom * zoom, 0),
      },
    },
    {
      side: 'left',
      cursor: 'ew-resize',
      style: {
        left: rect.x,
        top: rect.y + top * zoom,
        width: Math.max(left * zoom, 0),
        height: rect.height - (top + bottom) * zoom,
      },
    },
    {
      side: 'right',
      cursor: 'ew-resize',
      style: {
        left: rect.x + rect.width - right * zoom,
        top: rect.y + top * zoom,
        width: Math.max(right * zoom, 0),
        height: rect.height - (top + bottom) * zoom,
      },
    },
  ];

  return (
    <>
      {bands.map(({ side, style, cursor }) => {
        const size = sizes[side];
        const thickness = size * zoom;
        // Zero padding still gets a grab strip so it can be pulled outward.
        const hitStyle =
          thickness < 10
            ? side === 'top'
              ? { ...style, height: 10 }
              : side === 'bottom'
                ? { ...style, top: rect.y + rect.height - 10, height: 10 }
                : side === 'left'
                  ? { ...style, width: 10 }
                  : { ...style, left: rect.x + rect.width - 10, width: 10 }
            : style;

        return (
          <div
            key={side}
            onPointerEnter={() => setHovered(side)}
            onPointerLeave={() => setHovered((h) => (h === side ? null : h))}
            onPointerDown={begin(side)}
            onPointerMove={move}
            onPointerUp={end}
            className={cn(
              'pointer-events-auto absolute transition-colors duration-120',
              hovered === side ? 'bg-[var(--padding-fill)]' : 'bg-transparent'
            )}
            style={{ ...hitStyle, cursor }}
          >
            {(hovered === side || (size > 0 && thickness > 16)) && size > 0 && (
              <span
                className={cn(
                  'pointer-events-none absolute rounded-[3px] px-1 text-[9.5px] font-medium tabular',
                  hovered === side
                    ? 'bg-[var(--success)] text-[#062217]'
                    : 'bg-black/45 text-white/85'
                )}
                style={centreLabel(side)}
              >
                {Math.round(size)}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

function centreLabel(side: Side): React.CSSProperties {
  const base: React.CSSProperties = { position: 'absolute' };
  if (side === 'top' || side === 'bottom') {
    return { ...base, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  return { ...base, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
}

/* --------------------------------------------------------------------------
 * Gap
 * ----------------------------------------------------------------------- */

function GapHandles({
  id,
  rect,
  box,
  zoom,
  viewport,
}: {
  id: NodeId;
  rect: ViewRect;
  box: BoxMetrics;
  zoom: number;
  viewport: HTMLElement | null;
}) {
  const children = useEditor((s) => s.doc.nodes[id]?.children ?? EMPTY);
  const measureToken = useEditor((s) => s.measureToken);
  const [gaps, setGaps] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const drag = useRef<{ start: number; startValue: number; horizontal: boolean } | null>(null);

  const horizontal = box.display.includes('flex') && box.flexDirection.startsWith('row');
  const isFlexOrGrid = box.display.includes('flex') || box.display.includes('grid');

  useEffect(() => {
    if (!viewport || children.length < 2 || !isFlexOrGrid || box.gap <= 0) {
      setGaps([]);
      return;
    }
    const origin = viewport.getBoundingClientRect();
    const boxes = children
      .map((childId) => getElementFor(childId)?.getBoundingClientRect())
      .filter((b): b is DOMRect => Boolean(b));

    const next: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i]!;
      const b = boxes[i + 1]!;
      if (horizontal) {
        const start = a.right;
        const width = b.left - a.right;
        if (width <= 0.5) continue;
        next.push({
          x: start - origin.left,
          y: Math.min(a.top, b.top) - origin.top,
          w: width,
          h: Math.max(a.height, b.height),
        });
      } else {
        const start = a.bottom;
        const height = b.top - a.bottom;
        if (height <= 0.5) continue;
        next.push({
          x: Math.min(a.left, b.left) - origin.left,
          y: start - origin.top,
          w: Math.max(a.width, b.width),
          h: height,
        });
      }
    }
    setGaps(next);
  }, [children, viewport, measureToken, horizontal, isFlexOrGrid, box.gap, rect.width, rect.height]);

  const begin = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      start: horizontal ? e.clientX : e.clientY,
      startValue: box.gap,
      horizontal,
    };
  };

  const move = (e: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const current = state.horizontal ? e.clientX : e.clientY;
    const next = Math.max(0, Math.round(state.startValue + (current - state.start) / zoom));
    const store = useEditor.getState();
    store.setStyle({ gap: `${next}px` }, { mergeKey: `gap:${id}`, quiet: true });
    store.invalidate();
  };

  const end = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <>
      {gaps.map((gap, i) => (
        <div
          key={i}
          onPointerEnter={() => setHovered(i)}
          onPointerLeave={() => setHovered((h) => (h === i ? null : h))}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          className={cn(
            'pointer-events-auto absolute transition-colors duration-120',
            hovered === i ? 'bg-[var(--accent-subtle)]' : 'bg-transparent'
          )}
          style={{
            left: gap.x,
            top: gap.y,
            width: gap.w,
            height: gap.h,
            cursor: horizontal ? 'ew-resize' : 'ns-resize',
          }}
        >
          {hovered === i && (
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-[var(--accent)] px-1 text-[9.5px] font-medium text-white tabular"
            >
              {Math.round(box.gap)}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

const EMPTY: NodeId[] = [];
