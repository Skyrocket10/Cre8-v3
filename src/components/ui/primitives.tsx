'use client';

/**
 * Editor UI primitives.
 *
 * Everything in the chrome is built from these so hover states, focus rings,
 * control heights and corner radii stay identical across twelve panels without
 * anyone having to remember the numbers.
 */

import React, { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';

/* --------------------------------------------------------------------------
 * Button
 * ----------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent-soft';
type ButtonSize = 'xs' | 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--text)] text-[var(--app)] hover:opacity-90 active:opacity-80 disabled:opacity-40',
  secondary:
    'bg-[var(--field)] text-[var(--text)] hover:bg-[var(--field-hover)] border border-[var(--border)] disabled:opacity-40',
  ghost:
    'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)] disabled:opacity-40',
  danger: 'bg-[var(--danger)] text-white hover:brightness-110 disabled:opacity-40',
  'accent-soft':
    'bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-115 disabled:opacity-40',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-[5px]',
  sm: 'h-[26px] px-2.5 text-[11.5px] gap-1.5 rounded-md',
  md: 'h-8 px-3.5 text-[12.5px] gap-2 rounded-md',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', loading, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,color,opacity,box-shadow] duration-120 ease-out',
        'disabled:pointer-events-none',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {loading && (
        <span className="anim-spin size-3 rounded-full border-[1.5px] border-current border-t-transparent opacity-70" />
      )}
      {children}
    </button>
  );
});

/* --------------------------------------------------------------------------
 * Icon button
 * ----------------------------------------------------------------------- */

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: 'xs' | 'sm' | 'md';
  tone?: 'default' | 'danger';
  shortcut?: string;
  side?: TooltipSide;
}

const ICON_SIZES = { xs: 'size-5 rounded', sm: 'size-[26px] rounded-md', md: 'size-8 rounded-md' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = 'sm', tone = 'default', shortcut, side = 'bottom', className, children, ...rest },
  ref
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={side}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex shrink-0 items-center justify-center transition-colors duration-120',
          'disabled:pointer-events-none disabled:opacity-35',
          ICON_SIZES[size],
          active
            ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
            : tone === 'danger'
              ? 'text-[var(--text-secondary)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]',
          className
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

/* --------------------------------------------------------------------------
 * Tooltip
 * ----------------------------------------------------------------------- */

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  delay = 380,
  children,
}: {
  content?: React.ReactNode;
  shortcut?: string;
  side?: TooltipSide;
  delay?: number;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!content) return children;

  const show = (e: React.PointerEvent) => {
    anchor.current = e.currentTarget as HTMLElement;
    timer.current = setTimeout(() => {
      const el = anchor.current;
      if (!el?.isConnected) return;
      const r = el.getBoundingClientRect();
      const positions: Record<TooltipSide, { x: number; y: number }> = {
        top: { x: r.left + r.width / 2, y: r.top - 8 },
        bottom: { x: r.left + r.width / 2, y: r.bottom + 8 },
        left: { x: r.left - 8, y: r.top + r.height / 2 },
        right: { x: r.right + 8, y: r.top + r.height / 2 },
      };
      setCoords(positions[side]);
      setOpen(true);
    }, delay);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  const transforms: Record<TooltipSide, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  return (
    <>
      {React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        onPointerEnter: show,
        onPointerLeave: hide,
        onPointerDown: hide,
      })}
      {open && coords && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="tooltip"
              className="anim-fade pointer-events-none fixed z-[999] flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--overlay)] px-2 py-1 text-[11px] text-[var(--text)] shadow-[var(--shadow-pop)]"
              style={{ left: coords.x, top: coords.y, transform: transforms[side] }}
            >
              <span className="whitespace-nowrap">{content}</span>
              {shortcut && (
                <span className="rounded border border-[var(--border)] bg-[var(--field)] px-1 font-mono text-[9.5px] text-[var(--text-muted)]">
                  {shortcut}
                </span>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/* --------------------------------------------------------------------------
 * Segmented control
 * ----------------------------------------------------------------------- */

export interface SegmentOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className,
  full,
  /** Show as unset — used when a style property has no value at all. */
  indeterminate,
}: {
  options: SegmentOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  size?: 'xs' | 'sm';
  className?: string;
  full?: boolean;
  indeterminate?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md bg-[var(--field)] p-0.5',
        full && 'w-full',
        className
      )}
    >
      {options.map((option) => {
        const active = !indeterminate && option.value === value;
        return (
          <Tooltip key={option.value} content={option.title} side="top">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              disabled={option.disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex flex-1 items-center justify-center rounded-[5px] font-medium',
                'transition-[background-color,color,box-shadow] duration-120',
                'disabled:pointer-events-none disabled:opacity-35',
                size === 'xs' ? 'h-[21px] px-1.5 text-[10.5px]' : 'h-[23px] px-2 text-[11px]',
                active
                  ? 'bg-[var(--panel-raised)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,0.25)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              )}
            >
              {option.icon}
              {option.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Text input
 * ----------------------------------------------------------------------- */

export interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size' | 'prefix'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Fire on every keystroke instead of on blur/Enter. */
  live?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  invalid?: boolean;
  size?: 'sm' | 'md';
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { value, onValueChange, live, prefix, suffix, invalid, className, size = 'sm', ...rest },
  ref
) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md border border-transparent bg-[var(--field)] px-2',
        'transition-[background-color,border-color,box-shadow] duration-120',
        'hover:bg-[var(--field-hover)] focus-within:border-[var(--accent)] focus-within:bg-[var(--field)]',
        invalid && 'border-[var(--danger)]',
        size === 'sm' ? 'h-[26px]' : 'h-8',
        className
      )}
    >
      {prefix && <span className="shrink-0 text-[var(--text-faint)]">{prefix}</span>}
      <input
        ref={ref}
        value={draft}
        spellCheck={false}
        onFocus={(e) => {
          focused.current = true;
          rest.onFocus?.(e);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (live) onValueChange(e.target.value);
        }}
        onBlur={(e) => {
          focused.current = false;
          if (!live) onValueChange(draft);
          rest.onBlur?.(e);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            if (!live) onValueChange(draft);
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            (e.currentTarget as HTMLInputElement).blur();
          }
          rest.onKeyDown?.(e);
        }}
        {...rest}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--text)] outline-none',
          'placeholder:text-[var(--text-faint)]',
          rest.readOnly && 'cursor-default'
        )}
      />
      {suffix && <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{suffix}</span>}
    </div>
  );
});

/* --------------------------------------------------------------------------
 * Layout helpers
 * ----------------------------------------------------------------------- */

export function Row({
  label,
  children,
  className,
  align = 'center',
  labelWidth = 62,
  hint,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: 'center' | 'start';
  labelWidth?: number;
  hint?: string;
}) {
  return (
    <div
      className={cn('flex gap-2', align === 'center' ? 'items-center' : 'items-start', className)}
    >
      {label !== undefined && (
        <Tooltip content={hint} side="left">
          <label
            className="field-label shrink-0 truncate pt-[5px] leading-none"
            style={{ width: labelWidth, paddingTop: align === 'center' ? 0 : 6 }}
          >
            {label}
          </label>
        </Tooltip>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-[var(--border-soft)]', className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--border)] bg-[var(--field)] px-1 py-px font-mono text-[9.5px] text-[var(--text-muted)]">
      {children}
    </kbd>
  );
}

/* --------------------------------------------------------------------------
 * Panel section — collapsible, remembers its state
 * ----------------------------------------------------------------------- */

export function Section({
  title,
  children,
  defaultOpen = true,
  actions,
  dense,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  dense?: boolean;
  badge?: React.ReactNode;
}) {
  const storageKey = `cre8:section:${title}`;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) setOpen(stored === '1');
    } catch {
      /* no persisted preference available */
    }
  }, [storageKey]);

  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(storageKey, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  return (
    <section className="border-b border-[var(--border-soft)] last:border-b-0">
      <div className="flex h-8 items-center gap-1 pr-2 pl-3">
        <button
          type="button"
          onClick={toggle}
          className="group flex flex-1 items-center gap-1.5 text-left"
        >
          <svg
            viewBox="0 0 12 12"
            className={cn(
              'size-2.5 shrink-0 text-[var(--text-faint)] transition-transform duration-150',
              open ? 'rotate-90' : 'rotate-0'
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4.5 2.5 8 6l-3.5 3.5" />
          </svg>
          <span className="panel-title transition-colors group-hover:text-[var(--text-secondary)]">
            {title}
          </span>
          {badge}
        </button>
        {actions}
      </div>
      {open && <div className={cn('anim-fade px-3', dense ? 'pb-2.5' : 'pb-3')}>{children}</div>}
    </section>
  );
}

/* --------------------------------------------------------------------------
 * Popover
 * ----------------------------------------------------------------------- */

export function Popover({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  width = 232,
  className,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  width?: number;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (next: boolean) => {
    setUncontrolled(next);
    onOpenChange?.(next);
  };

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const height = panelRef.current?.offsetHeight ?? 0;
      let left =
        align === 'end' ? r.right - width : align === 'center' ? r.left + r.width / 2 - width / 2 : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = side === 'bottom' ? r.bottom + 6 : r.top - height - 6;
      if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
      setPosition({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, side, width]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {trigger({ open, toggle: () => setOpen(!open), ref: triggerRef })}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className={cn(
                'anim-pop fixed z-[900] overflow-hidden rounded-[10px] border border-[var(--border-strong)]',
                'bg-[var(--overlay)] shadow-[var(--shadow-float)]',
                className
              )}
              style={{ left: position?.left ?? -9999, top: position?.top ?? -9999, width }}
            >
              {typeof children === 'function' ? children(() => setOpen(false)) : children}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/* --------------------------------------------------------------------------
 * Select
 * ----------------------------------------------------------------------- */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  group?: string;
  preview?: React.CSSProperties;
}

export function Select<T extends string>({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  className,
  width,
  size = 'sm',
}: {
  options: SelectOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  width?: number;
  size?: 'sm' | 'md';
}) {
  const selected = options.find((o) => o.value === value);
  const groups = new Map<string, SelectOption<T>[]>();
  for (const option of options) {
    const key = option.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(option);
    groups.set(key, list);
  }

  return (
    <Popover
      width={width ?? 200}
      align="start"
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          className={cn(
            'flex min-w-0 items-center gap-1 rounded-md bg-[var(--field)] px-2 text-left',
            'transition-colors duration-120 hover:bg-[var(--field-hover)]',
            open && 'ring-1 ring-[var(--accent)] ring-inset',
            size === 'sm' ? 'h-[26px]' : 'h-8',
            className
          )}
        >
          <span
            className={cn(
              'flex-1 truncate text-[11.5px]',
              selected ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'
            )}
            style={selected?.preview}
          >
            {selected?.label ?? placeholder}
          </span>
          <svg
            viewBox="0 0 12 12"
            className="size-2.5 shrink-0 text-[var(--text-faint)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </button>
      )}
    >
      {(close) => (
        <div className="scroll-thin max-h-[320px] overflow-y-auto p-1">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group}>
              {group && (
                <div className="panel-title px-2 pt-2 pb-1 first:pt-1">{group}</div>
              )}
              {items.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[5px] px-2 py-[5px] text-left text-[11.5px]',
                    'transition-colors duration-100',
                    option.value === value
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]'
                  )}
                >
                  <span className="flex-1 truncate" style={option.preview}>
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{option.hint}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

/* --------------------------------------------------------------------------
 * Switch
 * ----------------------------------------------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors duration-160',
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
        )}
      >
        <span
          className="absolute top-[2px] size-[11px] rounded-full bg-white shadow-sm transition-[left] duration-160 ease-out"
          style={{ left: checked ? 13 : 2 }}
        />
      </button>
      {label && (
        <label htmlFor={id} className="cursor-pointer text-[11.5px] text-[var(--text-secondary)]">
          {label}
        </label>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Empty state
 * ----------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-4 py-8' : 'gap-2 px-6 py-14'
      )}
    >
      {icon && (
        <div className="mb-1 flex size-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--field)] text-[var(--text-faint)]">
          {icon}
        </div>
      )}
      <p className="text-[12px] font-medium text-[var(--text-secondary)]">{title}</p>
      {description && (
        <p className="max-w-[220px] text-[11px] leading-relaxed text-[var(--text-faint)]">
          {description}
        </p>
      )}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Skeleton
 * ----------------------------------------------------------------------- */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cn(
        'relative overflow-hidden rounded bg-[var(--field)]',
        'after:absolute after:inset-0 after:-translate-x-full',
        'after:bg-gradient-to-r after:from-transparent after:via-white/[0.045] after:to-transparent',
        'after:content-[""] after:[animation:cre8-shimmer_1.4s_infinite]',
        className
      )}
    />
  );
}
