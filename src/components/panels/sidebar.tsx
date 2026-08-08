'use client';

/**
 * Left sidebar: an icon rail plus one panel at a time.
 *
 * A rail keeps every surface one click away without stacking six accordions,
 * and the whole sidebar collapses to just the rail when the canvas needs room.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Component, Image, Inbox, Layers, PanelLeftClose, Plus, Files, Palette } from 'lucide-react';
import { useEditor, type LeftTab } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { IconButton } from '../ui/primitives';
import { AssetsPanel } from './assets-panel';
import { ComponentsPanel } from './components-panel';
import { InsertPanel } from './insert-panel';
import { LayersPanel } from './layers-panel';
import { PagesPanel } from './pages-panel';
import { SubmissionsPanel } from './submissions-panel';
import { ThemePanel } from './theme-panel';

const TABS: { id: LeftTab; label: string; icon: React.ReactNode; shortcut?: string }[] = [
  { id: 'insert', label: 'Insert', icon: <Plus size={15} />, shortcut: 'I' },
  { id: 'layers', label: 'Layers', icon: <Layers size={15} />, shortcut: 'L' },
  { id: 'pages', label: 'Pages', icon: <Files size={15} />, shortcut: 'P' },
  { id: 'components', label: 'Components', icon: <Component size={15} /> },
  { id: 'assets', label: 'Assets', icon: <Image size={15} /> },
  { id: 'theme', label: 'Theme', icon: <Palette size={15} /> },
  { id: 'submissions', label: 'Submissions', icon: <Inbox size={15} /> },
];

export function Sidebar() {
  const tab = useEditor((s) => s.leftTab);
  const open = useEditor((s) => s.leftOpen);
  const width = useEditor((s) => s.leftWidth);

  return (
    <div className="flex h-full min-h-0 shrink-0">
      <nav className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-[var(--border)] bg-[var(--app)] py-2">
        {TABS.map((item) => (
          <IconButton
            key={item.id}
            label={item.label}
            shortcut={item.shortcut}
            side="right"
            size="md"
            active={open && tab === item.id}
            onClick={() => {
              const store = useEditor.getState();
              if (store.leftOpen && store.leftTab === item.id) store.toggleLeft(false);
              else store.setLeftTab(item.id);
            }}
          >
            {item.icon}
          </IconButton>
        ))}
        <div className="flex-1" />
        <IconButton
          label={open ? 'Collapse panel' : 'Expand panel'}
          side="right"
          size="md"
          onClick={() => useEditor.getState().toggleLeft()}
        >
          <PanelLeftClose
            size={15}
            className={cn('transition-transform duration-200', !open && 'rotate-180')}
          />
        </IconButton>
      </nav>

      {open && (
        <div
          className="relative flex min-h-0 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]"
          style={{ width }}
        >
          <div className="min-h-0 flex-1">
            {tab === 'layers' && <LayersPanel />}
            {tab === 'insert' && <InsertPanel />}
            {tab === 'pages' && <PagesPanel />}
            {tab === 'components' && <ComponentsPanel />}
            {tab === 'assets' && <AssetsPanel />}
            {tab === 'theme' && <ThemePanel />}
            {tab === 'submissions' && <SubmissionsPanel />}
          </div>
          <ResizeHandle side="right" onResize={(w) => useEditor.getState().setLeftWidth(w)} />
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Panel resizing
 * ----------------------------------------------------------------------- */

export function ResizeHandle({
  side,
  onResize,
}: {
  side: 'left' | 'right';
  onResize: (width: number) => void;
}) {
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const panel = (e.currentTarget as HTMLElement).parentElement;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      onResize(side === 'right' ? e.clientX - rect.left : rect.right - e.clientX);
    },
    [onResize, side]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    document.body.style.cursor = '';
  }, []);

  useEffect(() => () => void (document.body.style.cursor = ''), []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        'absolute top-0 z-20 h-full w-[5px] cursor-col-resize',
        'after:absolute after:top-0 after:h-full after:w-px after:bg-transparent',
        'after:transition-colors after:duration-150 hover:after:bg-[var(--accent)]',
        side === 'right' ? 'right-[-2px] after:right-[2px]' : 'left-[-2px] after:left-[2px]'
      )}
    />
  );
}

