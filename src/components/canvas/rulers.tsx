'use client';

/**
 * Rulers.
 *
 * Ticks are drawn in document units, so the numbers mean the same thing at any
 * zoom. The selected element's extent is highlighted on both axes, which turns
 * the ruler into a readout as well as a reference.
 */

import React, { useMemo } from 'react';
import { useEditor } from '@/lib/editor/store';
import { useViewportRect } from './use-rects';

const SIZE = 20;

export function Rulers({
  viewport,
  frameWidth,
}: {
  viewport: HTMLElement | null;
  frameWidth: number;
}) {
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const selection = useEditor((s) => s.selection);
  const rect = useViewportRect(selection[0] ?? null, viewport);

  const bounds = viewport?.getBoundingClientRect();
  const width = bounds?.width ?? 0;
  const height = bounds?.height ?? 0;

  const step = useMemo(() => niceStep(zoom), [zoom]);

  const horizontal = useMemo(
    () => ticks(-pan.x / zoom, (width - pan.x) / zoom, step),
    [pan.x, width, zoom, step]
  );
  const vertical = useMemo(
    () => ticks(-pan.y / zoom, (height - pan.y) / zoom, step),
    [pan.y, height, zoom, step]
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none">
      {/* Top */}
      <div
        className="absolute top-0 left-0 border-b border-[var(--border)] bg-[var(--panel)]/92 backdrop-blur-[2px]"
        style={{ width, height: SIZE }}
      >
        {rect && (
          <div
            className="absolute top-0 h-full bg-[var(--accent-subtle)]"
            style={{ left: rect.x, width: Math.max(1, rect.width) }}
          />
        )}
        <div
          className="absolute top-0 h-full border-r border-l border-[var(--border-strong)]"
          style={{ left: pan.x, width: frameWidth * zoom }}
        />
        {horizontal.map((value) => (
          <React.Fragment key={value}>
            <span
              className="absolute bottom-[3px] h-[5px] w-px bg-[var(--text-faint)]/60"
              style={{ left: value * zoom + pan.x }}
            />
            <span
              className="absolute top-[2px] text-[9px] text-[var(--text-faint)] tabular"
              style={{ left: value * zoom + pan.x + 3 }}
            >
              {value}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Left */}
      <div
        className="absolute top-0 left-0 border-r border-[var(--border)] bg-[var(--panel)]/92 backdrop-blur-[2px]"
        style={{ width: SIZE, height }}
      >
        {rect && (
          <div
            className="absolute left-0 w-full bg-[var(--accent-subtle)]"
            style={{ top: rect.y, height: Math.max(1, rect.height) }}
          />
        )}
        {vertical.map((value) => (
          <React.Fragment key={value}>
            <span
              className="absolute right-0 h-px w-[5px] bg-[var(--text-faint)]/60"
              style={{ top: value * zoom + pan.y }}
            />
            {/* Rotated so long values stay legible in a 20px gutter. */}
            <span
              className="absolute left-[1px] w-[18px] text-center text-[8.5px] leading-none text-[var(--text-faint)] tabular"
              style={{
                top: value * zoom + pan.y + 4,
                writingMode: 'vertical-rl',
                textOrientation: 'sideways',
              }}
            >
              {value}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div
        className="absolute top-0 left-0 border-r border-b border-[var(--border)] bg-[var(--panel)]"
        style={{ width: SIZE, height: SIZE }}
      />
    </div>
  );
}

/** Tick spacing that stays readable across the whole zoom range. */
function niceStep(zoom: number): number {
  const target = 90 / zoom;
  const candidates = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return candidates.find((c) => c >= target) ?? 5000;
}

function ticks(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  const start = Math.floor(from / step) * step;
  for (let v = start; v <= to; v += step) out.push(v);
  return out;
}
