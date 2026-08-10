'use client';

/**
 * Picking a scale token by name, with the raw value still reachable.
 *
 * Radius, spacing, shadow and width all resolve through theme variables, and
 * until now the only way to use one was to know it and type `var(--r-md)` into
 * a number field. That is a fine escape hatch and a bad default: it asks
 * somebody laying out a page to know what a CSS custom property is, and it
 * quietly rewards typing a raw `14px` instead — which looks identical today
 * and stops matching the rest of the site the moment the theme changes.
 *
 * So the same shape `ColorField` already has, for the other four scales:
 * tokens first, by the name the theme gives them, with a preview of what each
 * one does; the raw control underneath for the cases a scale cannot express.
 * What is stored is unchanged either way — `var(--r-md)` or `14px` — so this
 * is entirely a question of how the value is *chosen*.
 *
 * The preview is not decoration. "MD" means nothing next to "LG" until you can
 * see that one corner is rounder than the other, and a shadow scale is
 * unreadable as a list of names.
 */

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { parseTokenRef, TOKEN_PREFIX, type TokenGroup } from '@/lib/document/theme';
import type { ScaleToken } from '@/lib/document/types';
import { Popover } from './primitives';

export interface TokenFieldProps {
  /** Which scale. Colours have their own control. */
  group: Exclude<TokenGroup, 'color' | 'font'>;
  tokens: ScaleToken[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /**
   * The raw control, shown under the token list.
   *
   * Passed in rather than built here because each property wants its own: a
   * radius wants a number with units, a shadow wants free text. The picker
   * only knows about tokens.
   */
  advanced?: React.ReactNode;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
}

/** `var(--r-md)` for a radius token called `md`. */
export function tokenRef(group: TokenGroup, id: string): string {
  return `var(${TOKEN_PREFIX[group]}${id})`;
}

/** The token a value refers to, if it refers to one in this group. */
export function tokenFor(
  group: TokenGroup,
  tokens: ScaleToken[],
  value: string | undefined
): ScaleToken | undefined {
  const ref = parseTokenRef(value);
  return ref?.group === group ? tokens.find((t) => t.id === ref.id) : undefined;
}

export function TokenField({
  group,
  tokens,
  value,
  onChange,
  advanced,
  placeholder = 'Default',
  allowClear = true,
  className,
}: TokenFieldProps) {
  const token = tokenFor(group, tokens, value);
  // A raw value says so rather than pretending to be a token. "Custom" with
  // the value beside it is the honest label, and it is also the thing that
  // tells somebody they have stepped outside the system.
  const display = token ? token.name : value ? value : placeholder;

  return (
    <Popover
      width={228}
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
            className
          )}
        >
          <TokenPreview group={group} value={token?.value ?? value} />
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
        <div className="flex flex-col">
          <div className="scroll-thin max-h-[280px] overflow-y-auto p-1">
            {allowClear && (
              <Row
                label={placeholder}
                active={!value}
                onClick={() => {
                  onChange(undefined);
                  close();
                }}
              />
            )}
            {tokens.map((t) => (
              <Row
                key={t.id}
                label={t.name}
                hint={t.value}
                active={token?.id === t.id}
                preview={<TokenPreview group={group} value={t.value} />}
                onClick={() => {
                  onChange(tokenRef(group, t.id));
                  close();
                }}
              />
            ))}
          </div>

          {advanced && (
            <div className="border-t border-[var(--border-soft)] p-2">
              <p className="mb-1.5 text-[10px] text-[var(--text-faint)]">
                Custom — any CSS value, or a variable of your own
              </p>
              {advanced}
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

/**
 * The same list, as a swatch that lives *inside* another control.
 *
 * `TokenField` replaces a control; this sits beside one. Padding, gap and
 * max-width are paired fields where the number is still the thing you reach
 * for most — so the scale becomes a 13px square on the left rather than taking
 * the row over, and the field keeps its scrubbing and its units.
 */
export function TokenPicker({
  group,
  tokens,
  value,
  onChange,
}: {
  group: Exclude<TokenGroup, 'color' | 'font'>;
  tokens: ScaleToken[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const token = tokenFor(group, tokens, value);
  return (
    <Popover
      width={228}
      align="start"
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          aria-label={token ? `Scale: ${token.name}` : 'Pick from the scale'}
          title={token ? token.name : 'Pick from the scale'}
          className={cn(
            'flex size-[15px] shrink-0 items-center justify-center rounded-[3px] transition-colors',
            open || token
              ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'text-[var(--text-faint)] hover:bg-[var(--field-hover)] hover:text-[var(--text-secondary)]'
          )}
        >
          <TokenPreview group={group} value={token?.value} />
        </button>
      )}
    >
      {(close) => (
        <div className="scroll-thin max-h-[280px] overflow-y-auto p-1">
          <Row
            label="Custom"
            hint={token ? undefined : (value ?? 'unset')}
            active={!token}
            onClick={() => close()}
          />
          {tokens.map((t) => (
            <Row
              key={t.id}
              label={t.name}
              hint={t.value}
              active={token?.id === t.id}
              preview={<TokenPreview group={group} value={t.value} />}
              onClick={() => {
                onChange(tokenRef(group, t.id));
                close();
              }}
            />
          ))}
        </div>
      )}
    </Popover>
  );
}

function Row({
  label,
  hint,
  preview,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  preview?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[28px] w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors',
        active
          ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]'
      )}
    >
      <span className="flex size-[18px] shrink-0 items-center justify-center">{preview}</span>
      <span className="min-w-0 flex-1 truncate text-[11.5px]">{label}</span>
      {hint && (
        <span className="shrink-0 text-[10px] text-[var(--text-faint)] tabular">{hint}</span>
      )}
    </button>
  );
}

/**
 * What the token does, at 18px.
 *
 * Each scale gets the smallest drawing that distinguishes its steps: a corner
 * for a radius, a cast shadow for a shadow, a bar for a spacing step. Width is
 * the one with nothing useful to draw — the values are page widths and none of
 * them fits — so it shows nothing and relies on the number beside it.
 */
function TokenPreview({ group, value }: { group: TokenGroup; value: string | undefined }) {
  if (!value) return <span className="size-[13px] rounded-[3px] border border-dashed border-[var(--border-strong)]" />;

  if (group === 'radius') {
    return (
      <span
        className="size-[15px] border-2 border-[var(--text-muted)]"
        style={{ borderTopLeftRadius: value, borderBottomRightRadius: '0px' }}
      />
    );
  }
  if (group === 'shadow') {
    return (
      <span
        className="size-[13px] rounded-[3px] bg-[var(--panel-raised)] ring-1 ring-[var(--border)]"
        style={{ boxShadow: value === 'none' ? undefined : value }}
      />
    );
  }
  if (group === 'spacing') {
    return (
      <span className="flex h-[15px] w-[15px] items-center">
        <span
          className="block h-[3px] rounded-full bg-[var(--text-muted)]"
          // Clamped rather than drawn to scale: the top of a spacing scale is
          // far wider than a row, and a preview that is always full width
          // distinguishes nothing.
          style={{ width: `min(15px, max(2px, ${value}))` }}
        />
      </span>
    );
  }
  return <span className="size-[13px] rounded-[3px] bg-[var(--field-hover)]" />;
}
