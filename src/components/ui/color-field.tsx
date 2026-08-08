'use client';

/**
 * Colour control.
 *
 * Two ways to pick, in the order that keeps a site consistent: theme tokens
 * first (which write `var(--c-primary)` and therefore restyle globally later),
 * a full HSV picker second for one-off values.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import {
  CHECKERBOARD,
  hsvaToRgba,
  parseColor,
  rgbaToHsva,
  toCss,
  toHex,
  type Hsva,
} from '@/lib/utils/color';
import { parseTokenRef } from '@/lib/document/theme';
import type { ColorToken } from '@/lib/document/types';
import { Popover, TextInput, Tooltip } from './primitives';

export interface ColorFieldProps {
  value: string | undefined;
  onChange: (value: string | undefined, meta: { dragging: boolean }) => void;
  tokens: ColorToken[];
  placeholder?: string;
  overridden?: boolean;
  allowClear?: boolean;
  label?: string;
  className?: string;
}

export function ColorField({
  value,
  onChange,
  tokens,
  placeholder = 'None',
  overridden,
  allowClear = true,
  label,
  className,
}: ColorFieldProps) {
  const tokenRef = parseTokenRef(value);
  const token = tokenRef?.group === 'color' ? tokens.find((t) => t.id === tokenRef.id) : undefined;
  const swatch = token?.value ?? value ?? 'transparent';
  const display = token ? token.name : value ? value.toUpperCase() : placeholder;

  return (
    <Popover
      width={244}
      align="end"
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          className={cn(
            'flex h-[26px] min-w-0 flex-1 items-center gap-2 rounded-md bg-[var(--field)] px-1.5',
            'transition-colors duration-120 hover:bg-[var(--field-hover)]',
            open && 'ring-1 ring-[var(--accent)] ring-inset',
            overridden && 'ring-1 ring-[var(--accent-line)] ring-inset',
            className
          )}
        >
          <Swatch color={swatch} />
          <span
            className={cn(
              'flex-1 truncate text-left text-[11px]',
              value ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'
            )}
          >
            {display}
          </span>
          {token && (
            <span className="shrink-0 rounded-sm bg-[var(--accent-subtle)] px-1 text-[9px] font-medium text-[var(--accent)]">
              T
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <ColorPopover
          value={value}
          tokens={tokens}
          label={label}
          allowClear={allowClear}
          onChange={onChange}
          onClose={close}
        />
      )}
    </Popover>
  );
}

export function Swatch({ color, size = 15 }: { color: string; size?: number }) {
  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-[4px] ring-1 ring-inset ring-black/25"
      style={{ width: size, height: size, background: CHECKERBOARD }}
    >
      <span className="absolute inset-0" style={{ background: color }} />
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Picker
 * ----------------------------------------------------------------------- */

function ColorPopover({
  value,
  tokens,
  label,
  allowClear,
  onChange,
  onClose,
}: {
  value: string | undefined;
  tokens: ColorToken[];
  label?: string;
  allowClear: boolean;
  onChange: ColorFieldProps['onChange'];
  onClose: () => void;
}) {
  const tokenRef = parseTokenRef(value);
  const literal = tokenRef ? (tokens.find((t) => t.id === tokenRef.id)?.value ?? '#000000') : value;
  const rgba = parseColor(literal) ?? { r: 79, g: 70, b: 229, a: 1 };
  const [hsva, setHsva] = useState<Hsva>(() => rgbaToHsva(rgba));

  const emit = useCallback(
    (next: Hsva, dragging: boolean) => {
      setHsva(next);
      onChange(toCss(hsvaToRgba(next)), { dragging });
    },
    [onChange]
  );

  const currentHex = useMemo(() => toHex(hsvaToRgba(hsva)), [hsva]);

  return (
    <div className="flex flex-col">
      {label && (
        <div className="panel-title border-b border-[var(--border-soft)] px-3 py-2">{label}</div>
      )}

      <SaturationArea hsva={hsva} onChange={emit} />

      <div className="flex items-center gap-2.5 p-3 pb-2">
        <Swatch color={toCss(hsvaToRgba(hsva))} size={26} />
        <div className="flex flex-1 flex-col gap-2">
          <Slider
            value={hsva.h / 360}
            onChange={(v, dragging) => emit({ ...hsva, h: v * 360 }, dragging)}
            background="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
          />
          <Slider
            value={hsva.a}
            onChange={(v, dragging) => emit({ ...hsva, a: Math.round(v * 100) / 100 }, dragging)}
            background={`linear-gradient(to right, transparent, ${toHex({ ...hsvaToRgba(hsva), a: 1 })}), ${CHECKERBOARD}`}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-3">
        <TextInput
          value={currentHex}
          onValueChange={(next) => {
            const parsed = parseColor(next);
            if (parsed) emit(rgbaToHsva(parsed), false);
          }}
          className="flex-1"
          prefix={<span className="text-[10px]">#</span>}
        />
        <div className="w-[52px]">
          <TextInput
            value={String(Math.round(hsva.a * 100))}
            onValueChange={(next) => {
              const n = Number(next.replace('%', ''));
              if (Number.isFinite(n)) emit({ ...hsva, a: Math.min(1, Math.max(0, n / 100)) }, false);
            }}
            suffix="%"
          />
        </div>
      </div>

      {tokens.length > 0 && (
        <div className="border-t border-[var(--border-soft)] p-2.5">
          <div className="panel-title mb-2 px-0.5">Theme colours</div>
          <div className="grid grid-cols-6 gap-1.5">
            {tokens.map((t) => {
              const active = tokenRef?.id === t.id;
              return (
                <Tooltip key={t.id} content={t.name} side="top">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(`var(--c-${t.id})`, { dragging: false });
                      onClose();
                    }}
                    className={cn(
                      'relative h-6 w-full overflow-hidden rounded-[5px] ring-1 ring-inset transition-transform duration-120',
                      'hover:scale-[1.06]',
                      active ? 'ring-2 ring-[var(--accent)]' : 'ring-black/20'
                    )}
                    style={{ background: t.value }}
                  />
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}

      {allowClear && (
        <button
          type="button"
          onClick={() => {
            onChange(undefined, { dragging: false });
            onClose();
          }}
          className="border-t border-[var(--border-soft)] px-3 py-2 text-left text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--field)] hover:text-[var(--text)]"
        >
          Remove colour
        </button>
      )}
    </div>
  );
}

function SaturationArea({
  hsva,
  onChange,
}: {
  hsva: Hsva;
  onChange: (next: Hsva, dragging: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (clientX: number, clientY: number, isDragging: boolean) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const s = clamp01((clientX - rect.left) / rect.width);
    const v = 1 - clamp01((clientY - rect.top) / rect.height);
    onChange({ ...hsva, s, v }, isDragging);
  };

  return (
    <div
      ref={ref}
      className="relative h-[132px] w-full cursor-crosshair touch-none"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsva.h} 100% 50%))`,
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY, true);
      }}
      onPointerMove={(e) => dragging.current && update(e.clientX, e.clientY, true)}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        update(e.clientX, e.clientY, false);
      }}
    >
      <span
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
        style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }}
      />
    </div>
  );
}

function Slider({
  value,
  onChange,
  background,
}: {
  value: number;
  onChange: (value: number, dragging: boolean) => void;
  background: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (clientX: number, isDragging: boolean) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(clamp01((clientX - rect.left) / rect.width), isDragging);
  };

  return (
    <div
      ref={ref}
      className="relative h-2.5 w-full cursor-pointer touch-none rounded-full ring-1 ring-inset ring-black/20"
      style={{ background }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, true);
      }}
      onPointerMove={(e) => dragging.current && update(e.clientX, true)}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        update(e.clientX, false);
      }}
    >
      <span
        className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{ left: `${value * 100}%` }}
      />
    </div>
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
