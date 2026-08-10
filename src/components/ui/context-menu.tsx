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
import {
  AlignLeft,
  ArrowRightFromLine,
  BoxSelect,
  Check,
  ChevronRight,
  Clipboard,
  ClipboardPlus,
  Combine,
  Copy,
  CopyPlus,
  CornerLeftUp,
  Eye,
  FileText,
  Frame,
  Group,
  Home,
  Image,
  Layers,
  Link2,
  Lock,
  Magnet,
  Maximize2,
  Monitor,
  PaintRoller,
  Paintbrush,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Scissors,
  Search,
  Settings2,
  SquarePen,
  Trash2,
  Type,
  Ungroup,
  Unlink,
  X,
} from 'lucide-react';
import {
  COMMANDS,
  commandContext,
  commandEnabled,
  commandLabel,
  runCommand,
  shortcutFor,
  type CommandContext,
  type MenuSubject,
} from '@/lib/editor/commands';
import { menuFor, type MenuItem } from '@/lib/editor/menus';
import { cn } from '@/lib/utils/cn';

const WIDTH = 224;
const EDGE = 8;
const ROW = 26;

/**
 * Icons, by the name a command gives.
 *
 * Here rather than in the catalogue because that module is data — the keyboard
 * layer reads it and a static check parses it, and neither has any use for an
 * SVG component.
 */
const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  alignLeft: AlignLeft,
  boxSelect: BoxSelect,
  check: Check,
  clipboard: Clipboard,
  clipboardPlus: ClipboardPlus,
  component: Combine,
  copy: Copy,
  copyPlus: CopyPlus,
  cornerUp: CornerLeftUp,
  enter: ArrowRightFromLine,
  exit: X,
  eye: Eye,
  file: FileText,
  frame: Frame,
  group: Group,
  home: Home,
  image: Image,
  layers: Layers,
  link: Link2,
  lock: Lock,
  magnet: Magnet,
  maximize: Maximize2,
  monitor: Monitor,
  paintRoller: PaintRoller,
  paintbrush: Paintbrush,
  pencil: Pencil,
  plus: Plus,
  rotate: RotateCcw,
  ruler: Ruler,
  scissors: Scissors,
  search: Search,
  settings: Settings2,
  squarePen: SquarePen,
  trash: Trash2,
  type: Type,
  ungroup: Ungroup,
  unlink: Unlink,
};

function MenuIcon({ name }: { name?: string }) {
  const Icon = name ? ICONS[name] : undefined;
  // A fixed slot either way, so labels line up whether or not a row has one.
  if (!Icon) return <span className="size-3 shrink-0" aria-hidden />;
  return <Icon size={12} strokeWidth={1.9} className="size-3 shrink-0 opacity-80" />;
}

/* --------------------------------------------------------------------------
 * The opener
 * ----------------------------------------------------------------------- */

interface MenuRequest {
  x: number;
  y: number;
  subject?: MenuSubject;
  /** Bumped per opening so a second right-click rebuilds against the new selection. */
  seq: number;
}

let listener: ((request: MenuRequest | null) => void) | null = null;
let sequence = 0;

/**
 * Open the menu at a point in viewport coordinates.
 *
 * `subject` says *what* was clicked — a padding row, a page, a component —
 * never what should be done about it. That distinction is the whole design:
 * a caller that could pass a list of items could pass an action of its own,
 * and then there would be two implementations of Reset again. Passing nothing
 * means "an element", which is what the canvas and the layer tree mean.
 */
export function openContextMenu(x: number, y: number, subject?: MenuSubject): void {
  listener?.({ x, y, subject, seq: ++sequence });
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
  const ctx = useMemo(() => commandContext(request.subject), [request.subject]);
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
  icon?: string;
  checked?: boolean;
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
      items.map((item, index): Renderable => {
        if (item.kind === 'submenu') {
          return { index, item, label: item.label, icon: item.icon, enabled: true };
        }
        if (item.kind === 'heading') {
          return { index, item, label: item.label, enabled: false };
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
          icon: command.icon,
          checked: command.checked?.(ctx),
          enabled: commandEnabled(command, ctx, item.arg),
        };
      }),
    [items, ctx]
  );

  // Only rows the keyboard should stop on. A disabled row is still drawn — it
  // says the action exists — but landing on it and pressing Enter would look
  // like the menu ignored you.
  const stops = useMemo(
    () =>
      rendered.filter(
        (row) => row.item.kind !== 'separator' && row.item.kind !== 'heading' && row.enabled
      ),
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
    /*
     * `preventScroll`, and it is not a nicety.
     *
     * A panel renders at -9999 for the frame before its layout effect places
     * it, and a plain `focus()` scrolls its ancestor to reach it — which for a
     * fixed element means scrolling the whole editor away and leaving the menu
     * somewhere off the viewport that no later placement corrects.
     */
    ref.current?.focus({ preventScroll: true });
  }, []);

  // Coming back out of a submenu has to return the keys to this panel, or the
  // arrow keys go nowhere and the menu looks frozen.
  const closeSubmenu = useCallback(() => {
    setOpen(null);
    ref.current?.focus({ preventScroll: true });
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
      runCommand(item.id, item.arg, ctx.subject);
      // The whole menu, not just this panel: choosing from a submenu ends the
      // interaction, it does not step back into the one that opened it.
      onDismiss();
    },
    [onDismiss, ctx.subject]
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

  /*
   * Every panel is its own portal, and a submenu is emphatically not rendered
   * inside the panel that opened it.
   *
   * `position: fixed` is relative to the viewport only while no ancestor is
   * transformed — and the panel's entrance animation transforms it. A submenu
   * nested inside its parent therefore resolved its coordinates against the
   * parent's box instead of the window, which put it hundreds of pixels below
   * the fold: measured at 868,1578 in a 1500x950 window. It happened every
   * time, in the real editor, and three checks that only counted panels and
   * read their labels all passed straight through it.
   */
  return createPortal(
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
        if (row.item.kind === 'heading') {
          return (
            <div
              key={`head-${row.index}`}
              role="presentation"
              data-menu-heading={row.label}
              className="truncate px-2.5 pt-1.5 pb-1 text-[10px] font-medium tracking-[0.06em] text-[var(--text-faint)] uppercase"
            >
              {row.label}
            </div>
          );
        }
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
              icon={row.icon}
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
            icon={row.icon}
            checked={row.checked}
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
    </div>,
    document.body
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
  icon,
  checked,
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
  icon?: string;
  checked?: boolean;
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
        'transition-colors duration-75',
        'disabled:pointer-events-none disabled:opacity-35',
        active && enabled && (danger ? 'bg-[var(--danger)]/15' : 'bg-[var(--field)]'),
        danger ? 'text-[var(--danger)]' : 'text-[var(--text)]'
      )}
      style={{ height: ROW }}
      {...(checked === undefined ? {} : { 'aria-checked': checked, role: 'menuitemcheckbox' })}
    >
      {checked === undefined ? (
        <MenuIcon name={icon} />
      ) : (
        // The tick replaces the icon rather than joining it: two glyphs on a
        // 26px row for one piece of information is noise.
        <span className="flex size-3 shrink-0 items-center justify-center">
          {checked && <Check size={11} strokeWidth={2.4} className="text-[var(--accent)]" />}
        </span>
      )}
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
  icon,
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
  icon?: string;
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
        icon={icon}
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
