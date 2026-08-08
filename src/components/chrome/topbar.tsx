'use client';

import React from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronDown,
  CloudOff,
  Home,
  Monitor,
  Moon,
  Play,
  Redo2,
  Rocket,
  Smartphone,
  Sun,
  Tablet,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { BREAKPOINT_DEFS, type Breakpoint } from '@/lib/document/types';
import { describeNext } from '@/lib/history/history';
import { useEditor } from '@/lib/editor/store';
import { cn, relativeTime } from '@/lib/utils/cn';
import { Button, IconButton, Popover, Tooltip } from '../ui/primitives';
import { MenuItem } from '../panels/pages-panel';

export function TopBar({ onPublish, publishing }: { onPublish: () => void; publishing: boolean }) {
  const projectName = useEditor((s) => s.doc.name);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => describeNext(s.history, 'undo'));
  const redoLabel = useEditor((s) => describeNext(s.history, 'redo'));
  const theme = useEditor((s) => s.theme);

  return (
    <header className="relative z-50 flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--app)] px-2.5">
      <Link
        href="/"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--text)] text-[var(--app)] transition-transform duration-150 hover:scale-[1.05]"
        aria-label="All projects"
      >
        <svg viewBox="0 0 20 20" className="size-3.5" fill="currentColor" aria-hidden="true">
          <path d="M4 3h5.6a5 5 0 0 1 0 10H7.2v4H4V3Zm3.2 2.8v4.4h2.4a2.2 2.2 0 0 0 0-4.4H7.2Z" />
        </svg>
      </Link>

      <ProjectMenu name={projectName} />

      <div className="mx-1 h-4 w-px bg-[var(--border)]" />

      <IconButton
        label="Undo"
        shortcut="⌘Z"
        disabled={!canUndo}
        onClick={() => useEditor.getState().undo()}
      >
        <Undo2 size={14} />
      </IconButton>
      <IconButton
        label="Redo"
        shortcut="⇧⌘Z"
        disabled={!canRedo}
        onClick={() => useEditor.getState().redo()}
      >
        <Redo2 size={14} />
      </IconButton>
      <span className="hidden max-w-[140px] truncate text-[10.5px] text-[var(--text-faint)] lg:inline">
        {undoLabel ?? redoLabel ?? ''}
      </span>

      <div className="flex flex-1 justify-center">
        <BreakpointSwitcher />
      </div>

      <SaveIndicator />

      <IconButton
        label={theme === 'dark' ? 'Light interface' : 'Dark interface'}
        onClick={() => useEditor.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </IconButton>

      <Button size="sm" onClick={() => useEditor.getState().setPreviewing(true)}>
        <Play size={11} />
        Preview
      </Button>

      <Button size="sm" variant="primary" loading={publishing} onClick={onPublish}>
        <Rocket size={11} />
        Publish
      </Button>
    </header>
  );
}

/* --------------------------------------------------------------------------
 * Project menu
 * ----------------------------------------------------------------------- */

function ProjectMenu({ name }: { name: string }) {
  const pages = useEditor((s) => s.doc.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const componentName = useEditor(
    (s) => s.doc.components.find((c) => c.id === s.editingComponentId)?.name
  );
  const activePage = pages.find((p) => p.id === activePageId);

  return (
    <Popover
      width={220}
      align="start"
      trigger={({ toggle, ref, open }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          className={cn(
            'flex h-7 max-w-[290px] items-center gap-1.5 rounded-md px-2 transition-colors',
            open ? 'bg-[var(--field)]' : 'hover:bg-[var(--field)]'
          )}
        >
          <span className="truncate text-[12px] font-medium text-[var(--text)]">{name}</span>
          <span className="text-[var(--text-faint)]">/</span>
          <span className="truncate text-[12px] text-[var(--text-secondary)]">
            {editingComponentId ? `◈ ${componentName}` : (activePage?.name ?? 'Page')}
          </span>
          <ChevronDown size={11} className="shrink-0 text-[var(--text-faint)]" />
        </button>
      )}
    >
      {(close) => (
        <div className="p-1">
          <div className="panel-title px-2 pt-1.5 pb-1">Pages</div>
          {[...pages]
            .sort((a, b) => a.order - b.order)
            .map((page) => (
              <MenuItem
                key={page.id}
                icon={page.isHome ? <Home size={11} /> : undefined}
                label={page.name}
                onClick={() => {
                  useEditor.getState().setActivePage(page.id);
                  close();
                }}
              />
            ))}
          <div className="my-1 h-px bg-[var(--border-soft)]" />
          <MenuItem
            label="All projects"
            onClick={() => {
              window.location.href = '/';
            }}
          />
        </div>
      )}
    </Popover>
  );
}

/* --------------------------------------------------------------------------
 * Breakpoints
 * ----------------------------------------------------------------------- */

const ICONS: Record<Breakpoint, React.ReactNode> = {
  desktop: <Monitor size={13} />,
  tablet: <Tablet size={13} />,
  mobile: <Smartphone size={13} />,
};

export function BreakpointSwitcher({ compact }: { compact?: boolean }) {
  const breakpoint = useEditor((s) => s.breakpoint);

  return (
    <div className="flex items-center gap-0.5 rounded-md bg-[var(--field)] p-0.5">
      {(Object.keys(BREAKPOINT_DEFS) as Breakpoint[]).map((id) => {
        const def = BREAKPOINT_DEFS[id];
        const active = breakpoint === id;
        return (
          <Tooltip key={id} content={`${def.label} · ${def.width}px`} shortcut={def.shortcut}>
            <button
              type="button"
              onClick={() => useEditor.getState().setBreakpoint(id)}
              className={cn(
                'flex h-[26px] items-center gap-1.5 rounded-[5px] px-2 transition-colors duration-120',
                active
                  ? 'bg-[var(--panel-raised)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,0.25)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              )}
            >
              {ICONS[id]}
              {!compact && active && (
                <span className="text-[11px] font-medium">{def.label}</span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Save status
 * ----------------------------------------------------------------------- */

function SaveIndicator() {
  const status = useEditor((s) => s.saveStatus);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);

  const content: Record<string, { icon: React.ReactNode; label: string; tone: string }> = {
    idle: { icon: null, label: '', tone: 'text-[var(--text-faint)]' },
    dirty: {
      icon: <span className="size-1.5 rounded-full bg-[var(--text-faint)]" />,
      label: 'Unsaved',
      tone: 'text-[var(--text-faint)]',
    },
    saving: {
      icon: (
        <span className="anim-spin size-2.5 rounded-full border-[1.5px] border-current border-t-transparent" />
      ),
      label: 'Saving…',
      tone: 'text-[var(--text-muted)]',
    },
    saved: {
      icon: <Check size={11} />,
      label: lastSavedAt ? `Saved ${relativeTime(lastSavedAt)}` : 'Saved',
      tone: 'text-[var(--text-faint)]',
    },
    offline: {
      icon: <CloudOff size={11} />,
      label: 'Offline',
      tone: 'text-[var(--warning)]',
    },
    error: {
      icon: <TriangleAlert size={11} />,
      label: 'Save failed',
      tone: 'text-[var(--danger)]',
    },
  };

  const state = content[status] ?? content.idle!;
  if (!state.label) return <div className="w-4" />;

  return (
    <div
      className={cn(
        'hidden items-center gap-1.5 px-1.5 text-[10.5px] whitespace-nowrap md:flex',
        state.tone
      )}
    >
      {state.icon}
      {state.label}
    </div>
  );
}
