'use client';

/**
 * Preview mode.
 *
 * Editor chrome disappears entirely and the page is rendered by the same
 * renderer, from the same stylesheet generator, inside the same container-query
 * frame the canvas uses. Links work, hover styles apply, and the device
 * switcher genuinely re-evaluates the responsive rules.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Smartphone, Tablet, X } from 'lucide-react';
import { BREAKPOINT_DEFS, type Breakpoint, type Cre8Document } from '@/lib/document/types';
import { themeToStyleObject } from '@/lib/document/theme';
import { collectSubtree } from '@/lib/document/tree';
import { generateNodeCss, DOCUMENT_RESET, PLACEHOLDER_CSS } from '@/lib/renderer/css';
import { createSnapshotEngine, NodeView, RenderProvider } from '@/lib/renderer/render';
import { behaviourRuntime } from '@/lib/runtime/behaviour';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { Tooltip } from '../ui/primitives';

const DEVICE_ICONS: Record<Breakpoint, React.ReactNode> = {
  desktop: <Monitor size={13} />,
  tablet: <Tablet size={13} />,
  mobile: <Smartphone size={13} />,
};

export function PreviewOverlay() {
  const previewing = useEditor((s) => s.previewing);
  const doc = useEditor((s) => s.doc);
  const initialPageId = useEditor((s) => s.activePageId);
  const device = useEditor((s) => s.previewDevice);
  const [pageId, setPageId] = useState(initialPageId);

  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages.find((p) => p.id === initialPageId);

  if (!previewing || !page) return null;

  return (
    <div className="fixed inset-0 z-[700] flex flex-col bg-[var(--workspace)]">
      <PreviewChrome
        doc={doc}
        pageId={page.id}
        onPageChange={setPageId}
        device={device}
        onDeviceChange={(next) => useEditor.getState().setPreviewDevice(next)}
      />
      <PreviewSurface doc={doc} pageId={page.id} device={device} onNavigate={setPageId} />
    </div>
  );
}

function PreviewChrome({
  doc,
  pageId,
  onPageChange,
  device,
  onDeviceChange,
}: {
  doc: Cre8Document;
  pageId: string;
  onPageChange: (id: string) => void;
  device: Breakpoint;
  onDeviceChange: (device: Breakpoint) => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--app)] px-3">
      <span className="text-[11px] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
        Preview
      </span>

      <div className="mx-1 h-4 w-px bg-[var(--border)]" />

      <select
        value={pageId}
        onChange={(e) => onPageChange(e.target.value)}
        className="h-[26px] cursor-pointer rounded-md bg-[var(--field)] px-2 text-[11.5px] text-[var(--text)] outline-none"
      >
        {[...doc.pages]
          .sort((a, b) => a.order - b.order)
          .map((page) => (
            <option key={page.id} value={page.id}>
              {page.name}
            </option>
          ))}
      </select>

      <div className="flex flex-1 justify-center">
        <div className="flex items-center gap-0.5 rounded-md bg-[var(--field)] p-0.5">
          {(Object.keys(BREAKPOINT_DEFS) as Breakpoint[]).map((id) => (
            <Tooltip key={id} content={`${BREAKPOINT_DEFS[id].label} · ${BREAKPOINT_DEFS[id].width}px`}>
              <button
                type="button"
                onClick={() => onDeviceChange(id)}
                className={cn(
                  'flex h-[26px] items-center gap-1.5 rounded-[5px] px-2.5 transition-colors',
                  device === id
                    ? 'bg-[var(--panel-raised)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,0.25)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                )}
              >
                {DEVICE_ICONS[id]}
                {device === id && (
                  <span className="text-[11px] font-medium">{BREAKPOINT_DEFS[id].label}</span>
                )}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <Tooltip content="Close preview" shortcut="Esc">
        <button
          type="button"
          onClick={() => useEditor.getState().setPreviewing(false)}
          className="flex h-[26px] items-center gap-1.5 rounded-md bg-[var(--field)] px-2.5 text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
        >
          <X size={12} />
          Close
        </button>
      </Tooltip>
    </header>
  );
}

function PreviewSurface({
  doc,
  pageId,
  device,
  onNavigate,
}: {
  doc: Cre8Document;
  pageId: string;
  device: Breakpoint;
  onNavigate: (pageId: string) => void;
}) {
  const page = doc.pages.find((p) => p.id === pageId);

  const css = useMemo(() => {
    if (!page) return '';
    const ids = collectSubtree(doc.nodes, page.rootNodeId);
    for (const component of doc.components) ids.push(...collectSubtree(doc.nodes, component.rootNodeId));
    return [
      DOCUMENT_RESET,
      PLACEHOLDER_CSS,
      generateNodeCss(doc.nodes, { mode: 'container', nodeIds: ids, includeStates: true }),
    ].join('\n');
  }, [doc, page]);

  const engine = useMemo(
    () =>
      createSnapshotEngine(doc, 'preview', (href) => {
        // Internal links stay inside the preview rather than reloading the app.
        if (href.startsWith('page:')) return `#${href.slice(5)}`;
        return href;
      }),
    [doc]
  );

  const themeVars = useMemo(() => themeToStyleObject(doc.theme), [doc.theme]);

  /* Preview is the surface that answers "what will a visitor get", so the
     runtime runs live here — the same call the published page makes, with the
     listener bound and cleaned up on the way out. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!frameRef.current) return;
    return behaviourRuntime(frameRef.current, true);
  }, [doc, pageId]);

  if (!page) return null;
  const isDesktop = device === 'desktop';

  return (
    <div
      className={cn(
        'scroll-thin min-h-0 flex-1 overflow-auto',
        isDesktop ? 'bg-white' : 'bg-[var(--workspace)] px-4 py-6'
      )}
      onClickCapture={(e) => {
        const anchor = (e.target as HTMLElement).closest?.('a');
        const href = anchor?.getAttribute('href');
        if (!href) return;
        if (href.startsWith('#')) {
          const target = doc.pages.find((p) => p.id === href.slice(1));
          if (target) {
            e.preventDefault();
            onNavigate(target.id);
          }
        }
      }}
    >
      <div
        ref={frameRef}
        className={cn(
          'cre8-frame mx-auto bg-white',
          !isDesktop && 'overflow-hidden rounded-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)]'
        )}
        style={{
          width: isDesktop ? '100%' : BREAKPOINT_DEFS[device].width,
          minHeight: isDesktop ? '100%' : undefined,
          ...(themeVars as React.CSSProperties),
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <RenderProvider engine={engine}>
          <NodeView id={page.rootNodeId} />
        </RenderProvider>
      </div>
    </div>
  );
}
