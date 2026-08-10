'use client';

import React from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Tooltip } from '../ui/primitives';
import { useEditor } from '@/lib/editor/store';
import { BREAKPOINT_DEFS, type StyleProp } from '@/lib/document/types';

/**
 * A labelled inspector row that also reports *where a value comes from*.
 *
 * On a narrow breakpoint the dot next to the label distinguishes "this is set
 * for mobile" from "this is what desktop says", and clicking it drops back to
 * inherited. Without that, responsive editing degenerates into guesswork.
 */
export function StyleRow({
  label,
  children,
  overridden,
  onReset,
  hint,
  align = 'center',
  labelWidth = 62,
  styleProps,
  menuLabel,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  overridden?: boolean;
  onReset?: () => void;
  hint?: string;
  align?: 'center' | 'start';
  labelWidth?: number;
  /**
   * The declarations this row owns.
   *
   * Stamped into the DOM so the inspector's one right-click handler can tell
   * which property was clicked without every control having to know about
   * menus. A row that does not say is not a row with a broken menu — it falls
   * back to the menu for the element, which is the honest answer when nothing
   * here knows what property you meant.
   */
  styleProps?: readonly StyleProp[];
  /** What to call them in the menu. Defaults to the row's own label. */
  menuLabel?: string;
}) {
  const breakpoint = useEditor((s) => s.breakpoint);
  const showOverride = overridden && breakpoint !== 'desktop';
  const named = menuLabel ?? (typeof label === 'string' ? label : undefined);

  return (
    <div
      className={cn('flex gap-2', align === 'center' ? 'items-center' : 'items-start')}
      {...(styleProps?.length && named
        ? { 'data-style-props': styleProps.join(','), 'data-style-label': named }
        : {})}
    >
      {label !== undefined && (
        <div
          className="flex shrink-0 items-center gap-1"
          style={{ width: labelWidth, paddingTop: align === 'start' ? 6 : 0 }}
        >
          <Tooltip content={hint} side="left">
            <label className="field-label truncate">{label}</label>
          </Tooltip>
          {showOverride && (
            <Tooltip
              content={`Overridden on ${BREAKPOINT_DEFS[breakpoint].label} — click to reset`}
              side="left"
            >
              <button
                type="button"
                onClick={onReset}
                className="group relative flex size-3 shrink-0 items-center justify-center"
                aria-label="Reset override"
              >
                <span className="size-1.5 rounded-full bg-[var(--accent)] transition-opacity group-hover:opacity-0" />
                <RotateCcw
                  size={9}
                  strokeWidth={2.2}
                  className="absolute text-[var(--accent)] opacity-0 transition-opacity group-hover:opacity-100"
                />
              </button>
            </Tooltip>
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** Compact grid used for paired fields (W/H, X/Y). */
export function FieldPair({ children }: { children: React.ReactNode }) {
  return <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">{children}</div>;
}

export function InspectorGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

/** Small icon-only toggle row, e.g. text alignment. */
export function IconToggles<T extends string>({
  options,
  value,
  onChange,
  mixed,
}: {
  options: { value: T; icon: React.ReactNode; title: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  mixed?: boolean;
}) {
  return (
    <div className="flex h-[26px] min-w-0 flex-1 items-center gap-0.5 rounded-md bg-[var(--field)] p-0.5">
      {options.map((option) => {
        const active = !mixed && option.value === value;
        return (
          <Tooltip key={option.value} content={option.title} side="top">
            <button
              type="button"
              aria-label={option.title}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex h-[22px] flex-1 items-center justify-center rounded-[5px] transition-colors duration-120',
                active
                  ? 'bg-[var(--panel-raised)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,0.25)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              )}
            >
              {option.icon}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
