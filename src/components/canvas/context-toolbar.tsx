'use client';

/**
 * Floating contextual toolbar.
 *
 * The three or four things you actually do to the thing you just clicked,
 * within a few pixels of it. Everything else stays in the inspector — a
 * floating panel that tries to be a second inspector helps nobody.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  Bold,
  Combine,
  Copy,
  Group,
  Link2,
  Maximize2,
  Trash2,
  Type,
} from 'lucide-react';
import { getElement } from '@/lib/document/schema';
import { runCommand } from '@/lib/editor/commands';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ColorField } from '../ui/color-field';
import { NumberField } from '../ui/number-field';
import { IconButton, Segmented, Tooltip } from '../ui/primitives';
import { useViewportRects } from './use-rects';

const TOOLBAR_HEIGHT = 34;
const GAP = 12;

export function ContextToolbar({ viewport }: { viewport: HTMLElement | null }) {
  const selection = useEditor((s) => s.selection);
  const editingText = useEditor((s) => s.editingTextId);
  const dragging = useEditor((s) => Boolean(s.drag?.active));
  const previewing = useEditor((s) => s.previewing);
  const rects = useViewportRects(selection, viewport);

  /*
   * Its own width, because the clamp needs it.
   *
   * The toolbar is centred with `translateX(-50%)`, so clamping the *centre*
   * to the viewport leaves half of it outside — and the canvas area does not
   * clip, so that half lands on top of the layer tree and swallows clicks
   * meant for it. Found by a check that could not select a row while an
   * element near the left edge was selected.
   */
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  useLayoutEffect(() => {
    const width = barRef.current?.offsetWidth ?? 0;
    setBarWidth((previous) => (Math.abs(previous - width) > 1 ? width : previous));
  });

  if (!selection.length || dragging || previewing) return null;

  // Union of every selected box, so a multi-selection gets one toolbar.
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  for (const id of selection) {
    const rect = rects.get(id);
    if (!rect) continue;
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
  }
  if (!Number.isFinite(left)) return null;

  const bounds = viewport?.getBoundingClientRect();
  const above = top - TOOLBAR_HEIGHT - GAP > 0;
  const y = above ? top - TOOLBAR_HEIGHT - GAP : top + (rects.get(selection[0]!)?.height ?? 0) + GAP;
  const centre = (left + right) / 2;
  const available = bounds?.width ?? 1200;
  const half = barWidth / 2;
  // A toolbar wider than the space it has cannot satisfy both edges, so it
  // takes the middle rather than jamming itself against one of them.
  const x =
    barWidth + GAP * 2 >= available
      ? available / 2
      : Math.max(GAP + half, Math.min(centre, available - GAP - half));

  return (
    <div
      ref={barRef}
      className={cn(
        'anim-pop pointer-events-auto absolute z-40 flex h-[34px] items-center gap-1 rounded-lg px-1.5',
        'border border-[var(--border-strong)] bg-[var(--overlay)]/95 shadow-[var(--shadow-float)] backdrop-blur-md'
      )}
      style={{ left: x, top: Math.max(GAP, y), transform: 'translateX(-50%)' }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {selection.length > 1 ? (
        <MultiTools />
      ) : (
        <SingleTools id={selection[0]!} editing={editingText === selection[0]} />
      )}
    </div>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px bg-[var(--border)]" />;
}

/* --------------------------------------------------------------------------
 * Single selection
 * ----------------------------------------------------------------------- */

function SingleTools({ id, editing }: { id: string; editing: boolean }) {
  const node = useEditor((s) => s.doc.nodes[id]);
  const theme = useEditor((s) => s.doc.theme);
  const breakpoint = useEditor((s) => s.breakpoint);

  if (!node) return null;
  const def = getElement(node.type);

  const style = (prop: string) => {
    const order = breakpoint === 'desktop' ? ['desktop'] : breakpoint === 'tablet' ? ['desktop', 'tablet'] : ['desktop', 'tablet', 'mobile'];
    let value: string | undefined;
    for (const bp of order) {
      const candidate = (node.styles as Record<string, Record<string, string> | undefined>)[bp]?.[prop];
      if (candidate !== undefined) value = candidate;
    }
    return value;
  };

  const set = (patch: Record<string, string | undefined>, mergeKey?: string) =>
    useEditor.getState().setStyle(patch, { mergeKey });

  return (
    <>
      {def.textual && (
        <>
          <Tooltip content="Edit text" side="top">
            <button
              type="button"
              onClick={() => useEditor.getState().beginTextEdit(id)}
              className={cn(
                'flex h-[26px] items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors',
                editing
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]'
              )}
            >
              <Type size={12} />
              Edit
            </button>
          </Tooltip>
          <div className="w-[74px]">
            <NumberField
              value={style('fontSize')}
              min={1}
              label="A"
              title="Font size"
              onChange={(value, meta) =>
                set({ fontSize: value }, meta.scrubbing ? 'toolbar-fontSize' : undefined)
              }
            />
          </div>
          <IconButton
            label="Bold"
            side="top"
            active={Number(style('fontWeight') ?? 400) >= 600}
            onClick={() =>
              set({ fontWeight: Number(style('fontWeight') ?? 400) >= 600 ? '400' : '700' })
            }
          >
            <Bold size={12} />
          </IconButton>
          <Sep />
          <IconButton
            label="Align left"
            side="top"
            active={(style('textAlign') ?? 'left') === 'left'}
            onClick={() => set({ textAlign: undefined })}
          >
            <AlignLeft size={12} />
          </IconButton>
          <IconButton
            label="Align centre"
            side="top"
            active={style('textAlign') === 'center'}
            onClick={() => set({ textAlign: 'center' })}
          >
            <AlignCenter size={12} />
          </IconButton>
          <IconButton
            label="Align right"
            side="top"
            active={style('textAlign') === 'right'}
            onClick={() => set({ textAlign: 'right' })}
          >
            <AlignRight size={12} />
          </IconButton>
          <Sep />
          <div className="w-[100px]">
            <ColorField
              tokens={theme.colors}
              value={style('color')}
              onChange={(value, meta) =>
                set({ color: value }, meta.dragging ? 'toolbar-color' : undefined)
              }
            />
          </div>
        </>
      )}

      {def.container && (
        <>
          <Segmented
            size="xs"
            value={(style('flexDirection') ?? 'row').startsWith('column') ? 'column' : 'row'}
            onChange={(value) => set({ display: 'flex', flexDirection: value })}
            options={[
              { value: 'row', icon: <ArrowRight size={11} />, title: 'Horizontal' },
              { value: 'column', icon: <ArrowDown size={11} />, title: 'Vertical' },
            ]}
          />
          <div className="w-[70px]">
            <NumberField
              value={style('gap')}
              min={0}
              label="⇹"
              title="Gap"
              onChange={(value, meta) => set({ gap: value }, meta.scrubbing ? 'toolbar-gap' : undefined)}
            />
          </div>
          <div className="w-[70px]">
            <NumberField
              value={style('paddingTop')}
              min={0}
              label="⊞"
              title="Padding — applies to all sides"
              onChange={(value, meta) =>
                set(
                  {
                    paddingTop: value,
                    paddingRight: value,
                    paddingBottom: value,
                    paddingLeft: value,
                  },
                  meta.scrubbing ? 'toolbar-padding' : undefined
                )
              }
            />
          </div>
          <Sep />
        </>
      )}

      {node.type === 'image' && (
        <>
          <Segmented
            size="xs"
            value={style('objectFit') ?? 'cover'}
            onChange={(value) => set({ objectFit: value })}
            options={[
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
            ]}
          />
          <div className="w-[74px]">
            <NumberField
              value={style('borderTopLeftRadius')}
              min={0}
              label="⌜"
              title="Corner radius"
              onChange={(value, meta) =>
                set(
                  {
                    borderTopLeftRadius: value,
                    borderTopRightRadius: value,
                    borderBottomRightRadius: value,
                    borderBottomLeftRadius: value,
                  },
                  meta.scrubbing ? 'toolbar-radius' : undefined
                )
              }
            />
          </div>
          <Sep />
        </>
      )}

      {(node.type === 'button' || node.type === 'link') && (
        <>
          <Tooltip content={String(node.props.href ?? 'No link')} side="top">
            <button
              type="button"
              onClick={() => {
                const store = useEditor.getState();
                // A link's destination is content, not style — this button
                // is the shortcut to the row that holds it.
                store.setInspectorTab('content');
                store.toggleRight(true);
              }}
              className="flex h-[26px] max-w-[130px] items-center gap-1.5 rounded-md px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--field)] hover:text-[var(--text)]"
            >
              <Link2 size={12} className="shrink-0" />
              <span className="truncate">{String(node.props.href ?? 'Set link')}</span>
            </button>
          </Tooltip>
          <Sep />
        </>
      )}

      {/* Wrapping is how anything becomes clickable, and it is offered here
          rather than as a "make this a link" toggle because the result is
          different markup: an anchor around the content, which the browser
          gives focus and keyboard behaviour for free. Not offered on a link or
          a button, which may not hold another one. */}
      {!getElement(node.type).interactive && (
        <IconButton
          label="Wrap in link"
          side="top"
          onClick={() => useEditor.getState().wrapInLink()}
        >
          <Link2 size={12} />
        </IconButton>
      )}
      <IconButton
        label="Select parent"
        shortcut="Esc"
        side="top"
        onClick={() => useEditor.getState().selectParent()}
      >
        <Maximize2 size={12} />
      </IconButton>
      <IconButton
        label="Create component"
        side="top"
        onClick={() => runCommand('createComponent')}
      >
        <Combine size={12} />
      </IconButton>
      <IconButton
        label="Duplicate"
        shortcut="⌘D"
        side="top"
        onClick={() => useEditor.getState().duplicateSelection()}
      >
        <Copy size={12} />
      </IconButton>
      <IconButton
        label="Delete"
        shortcut="⌫"
        side="top"
        tone="danger"
        onClick={() => useEditor.getState().deleteSelection()}
      >
        <Trash2 size={12} />
      </IconButton>
    </>
  );
}

/* --------------------------------------------------------------------------
 * Multi-selection
 * ----------------------------------------------------------------------- */

function MultiTools() {
  const count = useEditor((s) => s.selection.length);
  const set = (patch: Record<string, string | undefined>) =>
    useEditor.getState().setStyle(patch);

  return (
    <>
      <span className="px-1.5 text-[11px] text-[var(--text-muted)]">{count} selected</span>
      <Sep />
      <IconButton label="Align start" side="top" onClick={() => set({ alignSelf: 'flex-start' })}>
        <AlignLeft size={12} />
      </IconButton>
      <IconButton label="Align centre" side="top" onClick={() => set({ alignSelf: 'center' })}>
        <AlignCenter size={12} />
      </IconButton>
      <IconButton label="Align end" side="top" onClick={() => set({ alignSelf: 'flex-end' })}>
        <AlignRight size={12} />
      </IconButton>
      <Sep />
      <IconButton
        label="Group"
        shortcut="⌘G"
        side="top"
        onClick={() => useEditor.getState().groupSelection()}
      >
        <Group size={12} />
      </IconButton>
      <IconButton
        label="Duplicate"
        shortcut="⌘D"
        side="top"
        onClick={() => useEditor.getState().duplicateSelection()}
      >
        <Copy size={12} />
      </IconButton>
      <IconButton
        label="Delete"
        shortcut="⌫"
        side="top"
        tone="danger"
        onClick={() => useEditor.getState().deleteSelection()}
      >
        <Trash2 size={12} />
      </IconButton>
    </>
  );
}
