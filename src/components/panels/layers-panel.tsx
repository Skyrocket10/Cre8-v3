'use client';

/**
 * Layer tree.
 *
 * Windowed: only the rows in view are mounted, so a thousand-node document
 * scrolls as smoothly as a ten-node one. Reordering is pointer-driven with
 * before / after / inside zones, and drops go through the same document
 * operation as a canvas drag — the two can't disagree.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { SWITCH_SHOW_ALL, canContain, readCase, slug } from '@/lib/document/schema';
import * as ops from '@/lib/document/operations';
import { canReparent } from '@/lib/document/tree';
import { hasAnyOverride } from '@/lib/renderer/styles';
import type { NodeId, SceneNode } from '@/lib/document/types';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { treeDropZone, type TreeDropZone } from '@/lib/canvas/dnd';
import { cn } from '@/lib/utils/cn';
import { ElementIcon } from '../ui/element-icon';
import { EmptyState, Tooltip } from '../ui/primitives';

const ROW_HEIGHT = 24;
const OVERSCAN = 8;
const INDENT = 12;

interface Row {
  node: SceneNode;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  /**
   * The case this row belongs to, and whether the switch is showing it.
   *
   * Without this the tree lies by omission: a row for a node the canvas is
   * not drawing looks exactly like one it is, so the eye appears broken and
   * the selection outline appears to land on nothing. Saying which case it is
   * turns "why can I not see this" into "ah, it is on the other tab".
   */
  kase?: { value: string; negated: boolean; current: boolean };
}

export function LayersPanel() {
  const rootId = useEditor((s) => activeRootId(s));
  const nodes = useEditor((s) => s.doc.nodes);
  const selection = useEditor((s) => s.selection);
  const breakpoint = useEditor((s) => s.breakpoint);

  const [collapsed, setCollapsed] = useState<Set<NodeId>>(() => new Set());
  const [renaming, setRenaming] = useState<NodeId | null>(null);
  const [drop, setDrop] = useState<{ id: NodeId; zone: TreeDropZone } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  /* --- Flatten -------------------------------------------------------- */

  const rows = useMemo(() => {
    if (!rootId) return [];
    const out: Row[] = [];
    const walk = (id: NodeId, depth: number, showing: string | null) => {
      const node = nodes[id];
      if (!node) return;
      const expandable = node.children.length > 0;
      const expanded = expandable && !collapsed.has(id);

      const when = readCase(node.rules);
      const matches = when ? when.values.includes(showing ?? '') : false;
      const kase =
        when && showing !== null
          ? {
              value: when.values[0]!,
              negated: when.negated,
              // An "isn't" row is on screen for everything *except* its
              // values, so what counts as current is the other way round.
              current: showing === SWITCH_SHOW_ALL || (when.negated ? !matches : matches),
            }
          : undefined;

      // The root itself is the page; its children are what people think of
      // as the top level.
      if (depth >= 0) out.push({ node, depth, expandable, expanded, kase });

      // A group below resets what "current" means for everything inside it.
      const key = slug(node.props.switchKey);
      const inner = key
        ? node.props.switchDesign === SWITCH_SHOW_ALL
          ? SWITCH_SHOW_ALL
          : slug(node.props.switchDesign) || slug(node.props.switchDefault)
        : showing;

      if (expanded) for (const childId of node.children) walk(childId, depth + 1, inner);
    };
    const root = nodes[rootId];
    if (root) for (const childId of root.children) walk(childId, 0, null);
    return out;
  }, [nodes, rootId, collapsed]);

  /* --- Keep the selection visible -------------------------------------- */

  useEffect(() => {
    const id = selection[0];
    if (!id || !scrollRef.current) return;
    const index = rows.findIndex((r) => r.node.id === id);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    const el = scrollRef.current;
    if (top < el.scrollTop) el.scrollTop = top - ROW_HEIGHT;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - el.clientHeight + ROW_HEIGHT * 2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection[0]]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    setViewportHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(start, end);

  const toggle = useCallback((id: NodeId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* --- Drag ------------------------------------------------------------ */

  const dragState = useRef<{ ids: NodeId[]; started: boolean; x: number; y: number } | null>(null);

  const onRowPointerDown = (e: React.PointerEvent, id: NodeId) => {
    if (e.button !== 0) return;
    const store = useEditor.getState();
    const ids = store.selection.includes(id) ? store.selection : [id];
    dragState.current = { ids, started: false, x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const state = dragState.current;
      if (!state) return;
      if (!state.started) {
        if (Math.abs(e.clientY - state.y) + Math.abs(e.clientX - state.x) < 4) return;
        state.started = true;
      }

      const row = (e.target as HTMLElement)?.closest?.('[data-layer-row]');
      if (!row) {
        setDrop(null);
        return;
      }
      const id = row.getAttribute('data-layer-row');
      if (!id || state.ids.includes(id)) {
        setDrop(null);
        return;
      }
      const rect = row.getBoundingClientRect();
      const store = useEditor.getState();
      // Asked of the payload, not just the target: an "inside" indicator over a
      // table that would then refuse the drop is a promise the drop breaks.
      const targetType = store.doc.nodes[id]?.type ?? 'frame';
      const canNest = state.ids.every((dragged) => {
        const type = store.doc.nodes[dragged]?.type;
        return type ? canContain(targetType, type) : false;
      });
      setDrop({ id, zone: treeDropZone(e.clientY, rect.top, rect.height, canNest) });
    };

    const onUp = () => {
      const state = dragState.current;
      dragState.current = null;
      const target = drop;
      setDrop(null);
      if (!state?.started || !target) return;

      const store = useEditor.getState();
      const targetNode = store.doc.nodes[target.id];
      if (!targetNode) return;

      let parentId: NodeId | null;
      let index: number;
      if (target.zone === 'inside') {
        parentId = target.id;
        index = targetNode.children.length;
      } else {
        parentId = targetNode.parentId;
        const siblings = parentId ? (store.doc.nodes[parentId]?.children ?? []) : [];
        index = siblings.indexOf(target.id) + (target.zone === 'after' ? 1 : 0);
      }
      if (!parentId) return;
      if (!state.ids.every((id) => canReparent(store.doc.nodes, id, parentId!))) return;

      store.transact('Reorder layers', (draft) => {
        ops.moveNodes(draft, state.ids, parentId!, index);
        return state.ids;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drop]);

  if (!rootId) return null;

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        title="No layers yet"
        description="Elements you add to the page will appear here."
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      data-layers-scroll
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="scroll-thin h-full overflow-y-auto overscroll-contain py-1"
    >
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
        {visible.map((row, i) => {
          const index = start + i;
          return (
            <LayerRow
              key={row.node.id}
              row={row}
              top={index * ROW_HEIGHT}
              selected={selection.includes(row.node.id)}
              renaming={renaming === row.node.id}
              dropZone={drop?.id === row.node.id ? drop.zone : null}
              hasOverride={hasAnyOverride(row.node, breakpoint)}
              onToggle={toggle}
              onStartRename={setRenaming}
              onEndRename={() => setRenaming(null)}
              onPointerDown={onRowPointerDown}
            />
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Row
 * ----------------------------------------------------------------------- */

const LayerRow = React.memo(function LayerRow({
  row,
  top,
  selected,
  renaming,
  dropZone,
  hasOverride,
  onToggle,
  onStartRename,
  onEndRename,
  onPointerDown,
}: {
  row: Row;
  top: number;
  selected: boolean;
  renaming: boolean;
  dropZone: TreeDropZone | null;
  hasOverride: boolean;
  onToggle: (id: NodeId) => void;
  onStartRename: (id: NodeId) => void;
  onEndRename: () => void;
  onPointerDown: (e: React.PointerEvent, id: NodeId) => void;
}) {
  const { node, depth, expandable, expanded, kase } = row;
  const hidden = Boolean(node.meta.hidden);
  // Dimmed for the same reason a hidden node is: the canvas is not drawing it.
  const offstage = Boolean(kase && !kase.current);
  const locked = Boolean(node.meta.locked);
  const isInstance = node.type === 'instance';

  return (
    <div
      data-layer-row={node.id}
      className={cn(
        'group absolute right-1 left-1 flex items-center rounded-[5px] pr-1 select-none',
        'transition-colors duration-100',
        selected
          ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--field)]',
        dropZone === 'inside' && 'ring-1 ring-[var(--accent)] ring-inset',
        (hidden || offstage) && 'opacity-45'
      )}
      style={{ top, height: ROW_HEIGHT - 2, paddingLeft: 4 + depth * INDENT }}
      onPointerDown={(e) => onPointerDown(e, node.id)}
      onClick={(e) => {
        const store = useEditor.getState();
        store.select(node.id, e.shiftKey ? 'toggle' : 'replace');
      }}
      onDoubleClick={() => onStartRename(node.id)}
      onPointerEnter={() => useEditor.getState().setHover(node.id)}
      onPointerLeave={() => useEditor.getState().setHover(null)}
    >
      {dropZone === 'before' && (
        <span className="absolute -top-px right-0 left-0 h-0.5 rounded-full bg-[var(--accent)]" />
      )}
      {dropZone === 'after' && (
        <span className="absolute right-0 -bottom-px left-0 h-0.5 rounded-full bg-[var(--accent)]" />
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (expandable) onToggle(node.id);
        }}
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-[3px]',
          expandable ? 'text-[var(--text-faint)] hover:text-[var(--text)]' : 'opacity-0'
        )}
        tabIndex={-1}
      >
        <ChevronRight
          size={10}
          strokeWidth={2}
          className={cn('transition-transform duration-140', expanded && 'rotate-90')}
        />
      </button>

      <span
        className={cn(
          'mr-1.5 flex size-3.5 shrink-0 items-center justify-center',
          isInstance ? 'text-[var(--accent)]' : selected ? '' : 'text-[var(--text-muted)]'
        )}
      >
        <ElementIcon type={node.type} size={12} />
      </span>

      {renaming ? (
        <input
          autoFocus
          defaultValue={node.name}
          onBlur={(e) => {
            useEditor.getState().renameNode(node.id, e.target.value);
            onEndRename();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') onEndRename();
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded-[3px] bg-[var(--panel-raised)] px-1 text-[11.5px] text-[var(--text)] ring-1 ring-[var(--accent)] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11.5px]">{node.name}</span>
      )}

      {kase && !renaming && (
        <Tooltip
          content={
            kase.negated
              ? kase.current
                ? `Shown while the switch is not on “${kase.value}”`
                : `Hidden on “${kase.value}” — select it to bring it forward`
              : kase.current
                ? `Shown when the switch is on “${kase.value}”`
                : `On “${kase.value}” — select it to bring it forward`
          }
          side="left"
        >
          <span
            className={cn(
              'mr-1 max-w-[70px] shrink-0 truncate rounded-[3px] px-1 text-[9.5px] leading-[14px]',
              kase.current
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'bg-[var(--field)] text-[var(--text-faint)]'
            )}
          >
            {kase.negated ? `not ${kase.value}` : kase.value}
          </span>
        </Tooltip>
      )}

      {hasOverride && !renaming && (
        <Tooltip content="Has responsive overrides at this breakpoint" side="left">
          <span className="mr-1 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
        </Tooltip>
      )}

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          locked || hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <RowAction
          label={locked ? 'Unlock' : 'Lock'}
          onClick={() => useEditor.getState().toggleLocked([node.id])}
        >
          {locked ? <Lock size={10.5} /> : <LockOpen size={10.5} />}
        </RowAction>
        <RowAction
          label={hidden ? 'Show' : 'Hide'}
          onClick={() => useEditor.getState().toggleHidden([node.id])}
        >
          {hidden ? <EyeOff size={10.5} /> : <Eye size={10.5} />}
        </RowAction>
      </div>
    </div>
  );
});

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} side="left">
      <button
        type="button"
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="flex size-4 items-center justify-center rounded-[3px] text-[var(--text-faint)] transition-colors hover:bg-[var(--field-hover)] hover:text-[var(--text)]"
      >
        {children}
      </button>
    </Tooltip>
  );
}

