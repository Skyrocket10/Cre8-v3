'use client';

/**
 * Bottom bar: where you are (breadcrumbs) and how you're looking at it
 * (zoom, snapping, outlines).
 */

import React from 'react';
import { ChevronRight, Frame, Keyboard, Magnet, Minus, Plus, Ruler, SquareDashed } from 'lucide-react';
import { getAncestors } from '@/lib/document/tree';
import { SHORTCUT_REFERENCE } from '@/lib/editor/shortcuts';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ElementIcon } from '../ui/element-icon';
import { IconButton, Popover, Tooltip } from '../ui/primitives';

export function StatusBar() {
  const zoom = useEditor((s) => s.zoom);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const showRulers = useEditor((s) => s.showRulers);
  const showOutlines = useEditor((s) => s.showOutlines);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-[var(--border)] bg-[var(--app)] px-2">
      <Breadcrumbs />
      <div className="flex-1" />

      <IconButton
        label="Snap to guides"
        size="xs"
        side="top"
        active={snapEnabled}
        onClick={() => useEditor.getState().toggleSnap()}
      >
        <Magnet size={12} />
      </IconButton>
      <IconButton
        label="Rulers"
        size="xs"
        side="top"
        active={showRulers}
        onClick={() => useEditor.getState().toggleRulers()}
      >
        <Ruler size={12} />
      </IconButton>
      <IconButton
        label="Outline all elements"
        size="xs"
        side="top"
        active={showOutlines}
        onClick={() => useEditor.getState().toggleOutlines()}
      >
        <SquareDashed size={12} />
      </IconButton>

      <span className="mx-1 h-3.5 w-px bg-[var(--border)]" />

      <IconButton
        label="Zoom out"
        shortcut="⌘−"
        size="xs"
        side="top"
        onClick={() => useEditor.getState().setZoom(zoom / 1.2)}
      >
        <Minus size={12} />
      </IconButton>
      <Tooltip content="Reset to 100%" side="top">
        <button
          type="button"
          onClick={() => useEditor.getState().setZoom(1)}
          className="h-5 min-w-[42px] rounded px-1 text-[10.5px] text-[var(--text-secondary)] tabular transition-colors hover:bg-[var(--field)] hover:text-[var(--text)]"
        >
          {Math.round(zoom * 100)}%
        </button>
      </Tooltip>
      <IconButton
        label="Zoom in"
        shortcut="⌘+"
        size="xs"
        side="top"
        onClick={() => useEditor.getState().setZoom(zoom * 1.2)}
      >
        <Plus size={12} />
      </IconButton>
      <IconButton
        label="Fit to screen"
        shortcut="⇧1"
        size="xs"
        side="top"
        onClick={() => useEditor.getState().requestFit()}
      >
        <Frame size={12} />
      </IconButton>

      <span className="mx-1 h-3.5 w-px bg-[var(--border)]" />
      <ShortcutsButton />
    </footer>
  );
}

function ShortcutsButton() {
  return (
    <Popover
      width={300}
      align="end"
      side="top"
      trigger={({ toggle, ref, open }) => (
        <Tooltip content="Keyboard shortcuts" side="top">
          <button
            ref={ref}
            type="button"
            aria-label="Keyboard shortcuts"
            onClick={toggle}
            className={cn(
              'flex size-5 items-center justify-center rounded transition-colors',
              open
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]'
            )}
          >
            <Keyboard size={12} />
          </button>
        </Tooltip>
      )}
    >
      <div className="scroll-thin max-h-[440px] overflow-y-auto p-1">
        {SHORTCUT_REFERENCE.map((group) => (
          <section key={group.group} className="pb-1">
            <h3 className="panel-title px-2 pt-2 pb-1">{group.group}</h3>
            {group.items.map(([keys, description]) => (
              <div
                key={keys}
                className="flex items-center gap-3 rounded-[5px] px-2 py-[3px] text-[11px]"
              >
                <span className="flex-1 text-[var(--text-secondary)]">{description}</span>
                <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--field)] px-1.5 py-px font-mono text-[9.5px] whitespace-nowrap text-[var(--text-muted)]">
                  {keys}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Popover>
  );
}

function Breadcrumbs() {
  // Selectors must return stable references — the trail is derived in a memo,
  // never inside the selector itself.
  const selectedId = useEditor((s) => s.selection[0]);
  const nodes = useEditor((s) => s.doc.nodes);
  const rootId = useEditor((s) => activeRootId(s));

  const trail = React.useMemo(() => {
    if (!selectedId || !rootId) return [];
    const chain = [...getAncestors(nodes, selectedId), nodes[selectedId]].filter(Boolean) as NonNullable<
      (typeof nodes)[string]
    >[];
    // Drop everything above the surface being edited.
    const rootIndex = chain.findIndex((n) => n.id === rootId);
    return rootIndex >= 0 ? chain.slice(rootIndex) : chain;
  }, [nodes, selectedId, rootId]);

  if (!trail.length) {
    return (
      <span className="px-1 text-[10.5px] text-[var(--text-faint)]">
        Click an element to select it · double-click to edit text
      </span>
    );
  }

  const visible = trail.length > 5 ? trail.slice(trail.length - 5) : trail;

  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      {trail.length > 5 && <span className="text-[10.5px] text-[var(--text-faint)]">…</span>}
      {visible.map((node, i) => (
        <React.Fragment key={node.id}>
          {i > 0 && <ChevronRight size={10} className="shrink-0 text-[var(--text-faint)]" />}
          <button
            type="button"
            onClick={() => useEditor.getState().select(node.id)}
            onPointerEnter={() => useEditor.getState().setHover(node.id)}
            onPointerLeave={() => useEditor.getState().setHover(null)}
            className={cn(
              'flex h-5 max-w-[130px] shrink-0 items-center gap-1 rounded px-1 text-[10.5px] transition-colors',
              i === visible.length - 1
                ? 'text-[var(--text)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]'
            )}
          >
            <ElementIcon type={node.type} size={10} />
            <span className="truncate">{node.name}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}
