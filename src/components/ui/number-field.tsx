'use client';

/**
 * Numeric field with drag-to-scrub.
 *
 * The scrub is the interaction designers reach for constantly, so it gets the
 * details: pointer capture so the cursor can leave the control, Shift for ×10,
 * Alt for ÷10, and every scrub coalescing into a single undo step via the
 * caller's merge key.
 *
 * Values keep their unit, and anything the field doesn't recognise (`auto`,
 * `fit-content`, `var(--s-lg)`) round-trips untouched rather than being
 * clobbered into a number.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { formatLength, parseLength } from '@/lib/renderer/styles';
import type { ScaleToken } from '@/lib/document/types';
import { Tooltip } from './primitives';
import { TokenPicker } from './token-field';

export interface NumberFieldProps {
  value: string | undefined;
  onChange: (value: string | undefined, meta: { scrubbing: boolean }) => void;
  /** Label rendered inside the field; drag it to scrub. */
  icon?: React.ReactNode;
  label?: string;
  title?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Default unit applied when the user types a bare number. */
  unit?: string;
  /** Units offered in the unit menu. Empty disables it. */
  units?: string[];
  /** Highlights the control as overridden at the active breakpoint. */
  overridden?: boolean;
  /** Multiple selected values differ. */
  mixed?: boolean;
  /**
   * A theme scale this property can take, offered as named steps.
   *
   * When present the field grows a small swatch on the left that opens the
   * scale by name. Padding and gap are the properties that most want it —
   * they are used constantly and are the ones a raw `24px` silently
   * de-systematises — but the mechanism is the same for any scale.
   */
  scale?: { group: 'spacing' | 'radius' | 'shadow' | 'width'; tokens: ScaleToken[] };
  disabled?: boolean;
  className?: string;
  allowKeywords?: string[];
}

export function NumberField({
  value,
  onChange,
  icon,
  label,
  title,
  placeholder = '–',
  min,
  max,
  step = 1,
  unit = 'px',
  units = ['px', '%', 'rem', 'vw', 'vh'],
  overridden,
  mixed,
  disabled,
  className,
  allowKeywords,
  scale,
}: NumberFieldProps) {
  const parsed = parseLength(value, unit);
  const [draft, setDraft] = useState<string>(value ?? '');
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrub = useRef<{ startX: number; startValue: number; unit: string; moved: boolean } | null>(
    null
  );

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const commitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') {
        onChange(undefined, { scrubbing: false });
        return;
      }
      if (allowKeywords?.includes(trimmed) || /^(var|calc|clamp|min|max)\(/.test(trimmed)) {
        onChange(trimmed, { scrubbing: false });
        return;
      }
      const next = parseLength(trimmed, unit);
      if (next.number === null) {
        onChange(trimmed, { scrubbing: false });
        return;
      }
      const clamped = clamp(next.number, min, max);
      onChange(formatLength(clamped, next.unit || parsed.unit || unit), { scrubbing: false });
    },
    [allowKeywords, max, min, onChange, parsed.unit, unit]
  );

  const nudge = (delta: number) => {
    const base = parsed.number ?? 0;
    const next = clamp(base + delta, min, max);
    onChange(formatLength(next, parsed.unit || unit), { scrubbing: true });
  };

  /* --- Scrubbing --------------------------------------------------------- */

  const onScrubDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = {
      startX: e.clientX,
      startValue: parsed.number ?? 0,
      unit: parsed.unit || unit,
      moved: false,
    };
  };

  const onScrubMove = (e: React.PointerEvent) => {
    const state = scrub.current;
    if (!state) return;
    const dx = e.clientX - state.startX;
    if (!state.moved && Math.abs(dx) < 2) return;
    state.moved = true;

    const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const raw = state.startValue + dx * step * multiplier;
    const rounded = multiplier === 0.1 ? Math.round(raw * 10) / 10 : Math.round(raw);
    onChange(formatLength(clamp(rounded, min, max), state.unit), { scrubbing: true });
  };

  const onScrubUp = (e: React.PointerEvent) => {
    const state = scrub.current;
    scrub.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (state && !state.moved) inputRef.current?.select();
  };

  const showValue = mixed ? 'Mixed' : editing ? draft : (value ?? '');

  return (
    <div
      className={cn(
        'group relative flex h-[26px] min-w-0 flex-1 items-center gap-1 rounded-md px-1.5',
        'border border-transparent bg-[var(--field)] transition-colors duration-120',
        'hover:bg-[var(--field-hover)] focus-within:border-[var(--accent)]',
        overridden && 'ring-1 ring-[var(--accent-line)] ring-inset',
        disabled && 'pointer-events-none opacity-40',
        className
      )}
    >
      {scale && (
        <TokenPicker
          group={scale.group}
          tokens={scale.tokens}
          value={value}
          onChange={(next) => onChange(next, { scrubbing: false })}
        />
      )}
      {(icon || label) && (
        <Tooltip content={title} side="top">
          <span
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubUp}
            className={cn(
              'scrubbable flex shrink-0 select-none items-center justify-center',
              'text-[10px] leading-none text-[var(--text-faint)] transition-colors',
              'hover:text-[var(--text-secondary)]',
              label ? 'w-[13px]' : ''
            )}
          >
            {icon ?? label}
          </span>
        </Tooltip>
      )}
      <input
        ref={inputRef}
        value={showValue}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        // The tooltip hangs off the scrub handle, so without this the input
        // itself is nameless: assistive tech reads a row of blank number boxes
        // and there is nothing to address the field by.
        aria-label={title ?? label}
        onFocus={() => {
          setEditing(true);
          setDraft(value ?? '');
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== (value ?? '')) commitText(draft);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            nudge(step * multiplier);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(-step * multiplier);
          } else if (e.key === 'Enter') {
            commitText(draft);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(value ?? '');
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          'num-input min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--text)] outline-none',
          'placeholder:text-[var(--text-faint)]',
          mixed && 'text-[var(--text-muted)] italic'
        )}
      />
      {units.length > 0 && parsed.number !== null && !parsed.keyword && (
        <UnitMenu
          value={parsed.unit || unit}
          units={units}
          onChange={(next) => onChange(formatLength(parsed.number ?? 0, next), { scrubbing: false })}
        />
      )}
    </div>
  );
}

function UnitMenu({
  value,
  units,
  onChange,
}: {
  value: string;
  units: string[];
  onChange: (unit: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        'shrink-0 cursor-pointer appearance-none bg-transparent text-[9.5px] uppercase',
        'text-[var(--text-faint)] opacity-0 outline-none transition-opacity duration-120',
        'group-hover:opacity-100 focus:opacity-100'
      )}
      style={{ width: 22 }}
      aria-label="Unit"
    >
      {units.map((u) => (
        <option key={u} value={u} className="bg-[var(--overlay)] text-[var(--text)]">
          {u}
        </option>
      ))}
    </select>
  );
}

function clamp(value: number, min?: number, max?: number): number {
  let out = value;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}
