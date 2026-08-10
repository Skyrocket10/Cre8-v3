'use client';

/**
 * The box-model widget.
 *
 * Padding and margin as concentric boxes with a live number on every edge.
 * Each number scrubs; Alt applies to all four sides, Shift to the opposite
 * pair. It mirrors the on-canvas drag exactly, so whichever one a designer
 * reaches for, the modifiers and the feedback are the same.
 */

import React, { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { parseLength } from '@/lib/renderer/styles';
import type { StyleDecl, StyleProp } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { Tooltip } from '../ui/primitives';
import { TokenPicker, tokenFor } from '../ui/token-field';
import { useStyleBindings, useStyleWriter } from './use-style';

type Side = 'Top' | 'Right' | 'Bottom' | 'Left';
const SIDES: Side[] = ['Top', 'Right', 'Bottom', 'Left'];
const OPPOSITE: Record<Side, Side> = { Top: 'Bottom', Bottom: 'Top', Left: 'Right', Right: 'Left' };

const PADDING_PROPS = SIDES.map((s) => `padding${s}`) as StyleProp[];
const MARGIN_PROPS = SIDES.map((s) => `margin${s}`) as StyleProp[];

export function BoxModel() {
  const bindings = useStyleBindings([...PADDING_PROPS, ...MARGIN_PROPS]);
  const write = useStyleWriter();
  const spacing = useEditor((s) => s.doc.theme.spacing);

  /**
   * The scale, applied to all four sides at once.
   *
   * One control per box rather than one per cell: the cells are thirty pixels
   * wide and there are eight of them, and "the same padding all round" is what
   * somebody reaching for a spacing scale almost always means. A single side
   * is still a scrub or a typed value away.
   */
  const applyAll = (group: 'padding' | 'margin') => (value: string | undefined) => {
    const patch: StyleDecl = {};
    for (const side of SIDES) patch[`${group}${side}` as 'paddingTop'] = value as never;
    write(patch);
  };

  const apply = useCallback(
    (group: 'padding' | 'margin', side: Side, value: string | undefined, modifiers: { all: boolean; pair: boolean }, mergeKey?: string) => {
      const patch: StyleDecl = {};
      const targets: Side[] = modifiers.all ? SIDES : modifiers.pair ? [side, OPPOSITE[side]] : [side];
      for (const target of targets) patch[`${group}${target}` as 'paddingTop'] = value as never;
      write(patch, { mergeKey });
    },
    [write]
  );

  return (
    <div className="relative select-none">
      {/* Margin box */}
      <div className="relative rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--margin-fill)] px-6 py-[22px]">
        <span className="absolute top-1 left-2 flex items-center gap-1 text-[8.5px] font-semibold tracking-[0.08em] text-[var(--text-faint)] uppercase">
          Margin
          <TokenPicker
            group="spacing"
            tokens={spacing}
            value={bindings.marginTop?.value}
            onChange={applyAll('margin')}
          />
        </span>

        <Edge side="Top" className="top-[3px] left-1/2 -translate-x-1/2">
          <BoxValue binding={bindings.marginTop} onCommit={(v, m, k) => apply('margin', 'Top', v, m, k)} />
        </Edge>
        <Edge side="Bottom" className="bottom-[3px] left-1/2 -translate-x-1/2">
          <BoxValue binding={bindings.marginBottom} onCommit={(v, m, k) => apply('margin', 'Bottom', v, m, k)} />
        </Edge>
        <Edge side="Left" className="top-1/2 left-[3px] -translate-y-1/2">
          <BoxValue binding={bindings.marginLeft} onCommit={(v, m, k) => apply('margin', 'Left', v, m, k)} axis="x" />
        </Edge>
        <Edge side="Right" className="top-1/2 right-[3px] -translate-y-1/2">
          <BoxValue binding={bindings.marginRight} onCommit={(v, m, k) => apply('margin', 'Right', v, m, k)} axis="x" />
        </Edge>

        {/* Padding box */}
        <div className="relative rounded-[5px] border border-[var(--border)] bg-[var(--padding-fill)] px-6 py-[22px]">
          <span className="absolute top-1 left-2 text-[8.5px] font-semibold tracking-[0.08em] text-[var(--text-faint)] uppercase">
            Padding
          </span>

          <Edge side="Top" className="top-[3px] left-1/2 -translate-x-1/2">
            <BoxValue binding={bindings.paddingTop} onCommit={(v, m, k) => apply('padding', 'Top', v, m, k)} />
          </Edge>
          <Edge side="Bottom" className="bottom-[3px] left-1/2 -translate-x-1/2">
            <BoxValue binding={bindings.paddingBottom} onCommit={(v, m, k) => apply('padding', 'Bottom', v, m, k)} />
          </Edge>
          <Edge side="Left" className="top-1/2 left-[3px] -translate-y-1/2">
            <BoxValue binding={bindings.paddingLeft} onCommit={(v, m, k) => apply('padding', 'Left', v, m, k)} axis="x" />
          </Edge>
          <Edge side="Right" className="top-1/2 right-[3px] -translate-y-1/2">
            <BoxValue binding={bindings.paddingRight} onCommit={(v, m, k) => apply('padding', 'Right', v, m, k)} axis="x" />
          </Edge>

          <div className="flex h-[26px] items-center justify-center rounded-[4px] bg-[var(--field)] text-[9px] tracking-[0.06em] text-[var(--text-faint)] uppercase">
            Content
          </div>
        </div>
      </div>

      <p className="mt-1.5 text-center text-[9.5px] text-[var(--text-faint)]">
        Drag a value · <span className="text-[var(--text-muted)]">⌥</span> all sides ·{' '}
        <span className="text-[var(--text-muted)]">⇧</span> opposite pair
      </p>
    </div>
  );
}

function Edge({
  className,
  children,
}: {
  side: Side;
  className: string;
  children: React.ReactNode;
}) {
  return <div className={cn('absolute z-10', className)}>{children}</div>;
}

/* --------------------------------------------------------------------------
 * Scrubbable value
 * ----------------------------------------------------------------------- */

function BoxValue({
  binding,
  onCommit,
  axis = 'y',
}: {
  binding?: { value: string | undefined; overridden: boolean; mixed: boolean };
  onCommit: (
    value: string | undefined,
    modifiers: { all: boolean; pair: boolean },
    mergeKey?: string
  ) => void;
  axis?: 'x' | 'y';
}) {
  const raw = binding?.value;
  const parsed = parseLength(raw, 'px');
  const spacing = useEditor((s) => s.doc.theme.spacing);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const drag = useRef<{
    start: number;
    startValue: number;
    unit: string;
    all: boolean;
    pair: boolean;
    moved: boolean;
  } | null>(null);

  /*
   * A cell is thirty pixels wide, and `var(--s-md)` does not fit in it — it
   * used to be shown anyway, truncated, which is the worst of both: unreadable
   * *and* jargon. A token now shows the number it resolves to, marked as a
   * token, with its name in the tooltip. Somebody scanning the box model sees
   * spacing; somebody who needs to know where 16px came from hovers.
   */
  const token = tokenFor('spacing', spacing, raw);
  const tokenPx = token ? parseLength(token.value, 'px') : null;

  const display = binding?.mixed
    ? '–'
    : token
      ? (tokenPx?.number === null || tokenPx === null
          ? token.name
          : String(Math.round(tokenPx.number * 10) / 10))
      : parsed.keyword
        ? raw
        : parsed.number === null
          ? '0'
          : String(Math.round(parsed.number * 10) / 10);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      start: axis === 'x' ? e.clientX : e.clientY,
      startValue: parsed.number ?? 0,
      unit: parsed.unit || 'px',
      all: e.altKey,
      pair: e.shiftKey,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const current = axis === 'x' ? e.clientX : e.clientY;
    const delta = current - state.start;
    if (!state.moved && Math.abs(delta) < 2) return;
    state.moved = true;
    const next = Math.max(0, Math.round(state.startValue + delta));
    onCommit(`${next}${state.unit}`, { all: state.all, pair: state.pair }, 'box-model');
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const state = drag.current;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (state && !state.moved) {
      setDraft(parsed.number === null ? '' : String(parsed.number));
      setEditing(true);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const trimmed = draft.trim();
          if (trimmed === '') onCommit(undefined, { all: false, pair: false });
          else {
            const next = parseLength(trimmed, parsed.unit || 'px');
            onCommit(
              next.number === null ? trimmed : `${next.number}${next.unit || parsed.unit || 'px'}`,
              { all: false, pair: false }
            );
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
        className="num-input h-[15px] w-[34px] rounded-[3px] border border-[var(--accent)] bg-[var(--panel)] text-center text-[10px] text-[var(--text)] outline-none"
      />
    );
  }

  return (
    <Tooltip
      content={token ? `${token.name} — ${token.value}` : (raw ?? 'Not set')}
      side="top"
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          'scrubbable min-w-[26px] rounded-[3px] px-1 text-center text-[10px] tabular',
          'transition-colors duration-120 hover:bg-[var(--field-hover)]',
          // A token reads as a token without saying so in words there is no
          // room for: the underline is the marker, the tooltip is the name.
          token && 'underline decoration-dotted underline-offset-[3px]',
          binding?.overridden
            ? 'text-[var(--accent)]'
            : raw
              ? 'text-[var(--text-secondary)]'
              : 'text-[var(--text-faint)]'
        )}
      >
        {display}
      </button>
    </Tooltip>
  );
}
