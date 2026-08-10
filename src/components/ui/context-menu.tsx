'use client';

/**
 * The context menu.
 *
 * One host, mounted once, driven by a module-level opener rather than by props
 * threaded through the canvas and the layer tree. Anything that can be
 * right-clicked calls `openContextMenu(x, y)` and is done — it does not decide
 * what the menu says, and it has no way to put an action in it that is not in
 * the catalogue.
 *
 * What it renders is `menuFor(commandContext())`, resolved at open time. Every
 * activation still goes back through `runCommand`, which rebuilds the context
 * and re-checks availability before doing anything: a menu that has been open
 * for a while was built against a selection a collaborator may since have
 * changed under it.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import {
  COMMANDS,
  commandContext,
  commandEnabled,
  commandLabel,
  runCommand,
  shortcutFor,
  type CommandContext,
} from '@/lib/editor/commands';
import { menuFor, type MenuItem } from '@/lib/editor/menus';
import { cn } from '@/lib/utils/cn';

const WIDTH = 216;
const EDGE = 8;
const ROW = 26;

/* --------------------------------------------------------------------------
 * The opener
 * ----------------------------------------------------------------------- */

interface MenuRequest {
  x: number;
  y: number;
  /** Bumped per opening so a second right-click rebuilds against the new selection. */
  seq: number;
}

let listener: ((request: MenuRequest | null) => void) | null = null;
let sequence = 0;

/**
 * Open the menu at a point in viewport coordinates.
 *
 * Deliberately takes no items: a caller that could pass its own list could
 * pass an action of its own, and that is the thing this design exists to
 * prevent. Where you clicked is the only thing the menu needs from you.
 */
export function openContextMenu(x: number, y: number): void {
  listener?.({ x, y, seq: ++sequence });
}

export function closeContextMenu(): void {
  listener?.(null);
}

/* --------------------------------------------------------------------------
 * Host
 * ----------------------------------------------------------------------- */

export function ContextMenuHost() {
  const [request, setRequest] = useState<MenuRequest | null>(null);

  useEffect(() => {
    listener = setRequest;
    return () => {
      listener = null;
    };
  }, []);

  if (!request || typeof document === 'undefined') return null;
  return createPortal(
    // Keyed on the sequence so reopening remounts: the built menu is a snapshot
    // of the selection, and reusing the old one would show the previous
    // element's actions over the new one.
    <MenuRoot key={request.seq} request={request} onClose={() => setRequest(null)} />,
    document.body
  );
}

function MenuRoot({ request, onClose }: { request: MenuRequest; onClose: () => void }) {
  const ctx = useMemo(() => commandContext(), []);
  const items = useMemo(() => menuFor(ctx), [ctx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Ahead of the editor's own Escape ladder: closing the menu is the most
      // local thing Escape can mean while one is open.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!items.length) return null;

  return (
    <div
      className="fixed inset-0 z-[950]"
      /*
       * A transparent sheet rather than a document listener. It swallows the
       * press that dismisses the menu, so dismissing never also selects
       * whatever was underneath — which is the difference between closing a
       * menu and losing your selection to close a menu.
       */
      onPointerDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      onWheel={onClose}
    >
      <MenuPanel
        items={items}
        ctx={ctx}
        x={request.x}
        y={request.y}
        onDismiss={onClose}
        depth={0}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Panel
 * ----------------------------------------------------------------------- */

interface Renderable {
  index: number;
  item: MenuItem;
  label: string;
  shortcut?: string;
  danger?: boolean;
  enabled: boolean;
}

function MenuPanel({
  items,
  ctx,
  x,
  y,
  onDismiss,
  onBack,
  depth,
}: {
  items: MenuItem[];
  ctx: CommandContext;
  x: number;
  y: number;
  /** Close the whole menu. What choosing anything does. */
  onDismiss: () => void;
  /** Close this panel only, returning the keys to its parent. Submenus only. */
  onBack?: () => void;
  depth: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState<number | null>(null);

  /* --- Resolve every row once ------------------------------------------- */
  const rendered = useMemo<Renderable[]>(
    () =>
      items.map((item, index) => {
        if (item.kind === 'submenu') {
          return { index, item, label: item.label, enabled: true };
        }
        if (item.kind === 'separator') {
          return { index, item, label: '', enabled: false };
        }
        const command = COMMANDS[item.id]!;
        return {
          index,
          item,
          label: commandLabel(command, ctx, item.arg),
          shortcut: shortcutFor(command, item.arg),
          danger: command.danger,
          enabled: commandEnabled(command, ctx, item.arg),
        };
      }),
    [items, ctx]
  );

  // Only rows the keyboard should stop on. A disabled row is still drawn — it
  // says the action exists — but landing on it and pressing Enter would look
  // like the menu ignored you.
  const stops = useMemo(
    () => rendered.filter((row) => row.item.kind !== 'separator' && row.enabled),
    [rendered]
  );

  /* --- Stay inside the window ------------------------------------------- */
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? items.length * ROW;
    /*
     * A submenu that will not fit to the right goes to the left of its parent
     * rather than being clamped: clamping would slide it back over the row it
     * came from, covering the thing being pointed at.
     */
    let left = x;
    if (left + WIDTH > window.innerWidth - EDGE) {
      left = depth > 0 ? x - WIDTH * 2 + 8 : window.innerWidth - WIDTH - EDGE;
    }
    let top = y;
    if (top + height > window.innerHeight - EDGE) {
      top = Math.max(EDGE, window.innerHeight - height - EDGE);
    }
    setPlace({ left: Math.max(EDGE, left), top });
  }, [x, y, depth, items.length]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Coming back out of a submenu has to return the keys to this panel, or the
  // arrow keys go nowhere and the menu looks frozen.
  const closeSubmenu = useCallback(() => {
    setOpen(null);
    ref.current?.focus();
  }, []);

  /* --- Keyboard ----------------------------------------------------------- */
  const step = useCallback(
    (delta: number) => {
      if (!stops.length) return;
      const at = stops.findIndex((row) => row.index === active);
      const next =
        at === -1
          ? (delta > 0 ? stops[0] : stops[stops.length - 1])!
          : stops[(at + delta + stops.length) % stops.length]!;
      setActive(next.index);
      setOpen(null);
    },
    [stops, active]
  );

  const fire = useCallback(
    (item: Extract<MenuItem, { kind: 'command' }>) => {
      runCommand(item.id, item.arg);
      // The whole menu, not just this panel: choosing from a submenu ends the
      // interaction, it does not step back into the one that opened it.
      onDismiss();
    },
    [onDismiss]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rendered[active];
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        step(e.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Home':
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        setActive((e.key === 'Home' ? stops[0] : stops[stops.length - 1])?.index ?? -1);
        return;
      case 'ArrowRight':
        if (row?.item.kind === 'submenu') {
          e.preventDefault();
          e.stopPropagation();
          setOpen(active);
        }
        return;
      case 'ArrowLeft':
        if (onBack) {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
        return;
      case 'Enter':
      case ' ':
        if (!row) return;
        e.preventDefault();
        e.stopPropagation();
        if (row.item.kind === 'submenu') setOpen(active);
        else if (row.item.kind === 'command' && row.enabled) fire(row.item);
        return;
      default:
        return;
    }
  };

  const activeId = active >= 0 ? `cre8-menu-${depth}-${active}` : undefined;

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-orientation="vertical"
      aria-activedescendant={activeId}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        'anim-pop fixed z-[951] rounded-[10px] border border-[var(--border-strong)] py-1',
        'bg-[var(--overlay)] shadow-[var(--shadow-float)] outline-none backdrop-blur-md'
      )}
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999, width: WIDTH }}
    >
      {rendered.map((row) => {
        if (row.item.kind === 'separator') {
          return (
            <div
              key={`sep-${row.index}`}
              role="separator"
              className="my-1 h-px bg-[var(--border)]"
            />
          );
        }

        const id = `cre8-menu-${depth}-${row.index}`;

        if (row.item.kind === 'submenu') {
          const submenu = row.item;
          return (
            <SubmenuRow
              key={id}
              id={id}
              label={row.label}
              items={submenu.items}
              ctx={ctx}
              active={active === row.index}
              open={open === row.index}
              onHover={() => {
                setActive(row.index);
                setOpen(row.index);
              }}
              onDismiss={onDismiss}
              onCloseSubmenu={closeSubmenu}
              depth={depth}
            />
          );
        }

        const command = row.item;
        return (
          <MenuRow
            key={id}
            id={id}
            label={row.label}
            shortcut={row.shortcut}
            danger={row.danger}
            enabled={row.enabled}
            active={active === row.index}
            onHover={() => {
              setActive(row.index);
              setOpen(null);
            }}
            onSelect={() => fire(command)}
          />
        );
      })}
    </div>
  );
}

function MenuRow({
  id,
  label,
  shortcut,
  danger,
  enabled,
  active,
  onHover,
  onSelect,
  chevron,
}: {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  enabled: boolean;
  active: boolean;
  onHover: () => void;
  onSelect?: () => void;
  chevron?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="menuitem"
      data-menu-item={label}
      disabled={!enabled}
      tabIndex={-1}
      onPointerEnter={onHover}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 text-left text-[12px] leading-none',
        'disabled:pointer-events-none disabled:opacity-35',
        active && enabled && (danger ? 'bg-[var(--danger)]/15' : 'bg-[var(--field)]'),
        danger ? 'text-[var(--danger)]' : 'text-[var(--text)]'
      )}
      style={{ height: ROW }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="shrink-0 text-[11px] text-[var(--text-tertiary)] tabular-nums">
          {shortcut}
        </span>
      )}
      {chevron && <ChevronRight size={12} className="shrink-0 text-[var(--text-tertiary)]" />}
    </button>
  );
}

function SubmenuRow({
  id,
  label,
  items,
  ctx,
  active,
  open,
  onHover,
  onDismiss,
  onCloseSubmenu,
  depth,
}: {
  id: string;
  label: string;
  items: MenuItem[];
  ctx: CommandContext;
  active: boolean;
  open: boolean;
  onHover: () => void;
  onDismiss: () => void;
  onCloseSubmenu: () => void;
  depth: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  // Measured after the row exists, not during its render — a rect read on the
  // first pass is all zeroes, and the submenu opened in the top-left corner.
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const box = ref.current?.getBoundingClientRect();
    if (box) setAnchor({ x: box.right - 4, y: box.top - 5 });
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <MenuRow
        id={id}
        label={label}
        enabled
        active={active}
        chevron
        onHover={onHover}
        onSelect={onHover}
      />
      {open && anchor && (
        <MenuPanel
          items={items}
          ctx={ctx}
          x={anchor.x}
          y={anchor.y}
          onDismiss={onDismiss}
          onBack={onCloseSubmenu}
          depth={depth + 1}
        />
      )}
    </div>
  );
}
