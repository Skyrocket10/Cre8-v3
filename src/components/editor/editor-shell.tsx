'use client';

/**
 * The editor shell.
 *
 * Composes the chrome, wires the global behaviours (keyboard, drag, autosave)
 * and owns nothing else. Every panel talks to the store directly, so adding a
 * surface never means threading props through here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStorage } from '@/lib/api/storage';
import { useCollaboration } from '@/lib/collab/use-collab';
import { hydrateDocument } from '@/lib/document/factory';
import type { Cre8Document } from '@/lib/document/types';
import { useAutosave } from '@/lib/editor/autosave';
import { useKeyboardShortcuts } from '@/lib/editor/shortcuts';
import { clearRegistry } from '@/lib/editor/registry';
import { useEditor } from '@/lib/editor/store';
import { publishProject, type PublishResult } from '@/lib/publishing/publish';
import type { RemotePeer } from '@/lib/collab/client';
import { Canvas } from '../canvas/canvas';
import { ContextToolbar } from '../canvas/context-toolbar';
import { DragController, DragGhost } from '../canvas/drag-controller';
import { PresenceOverlay } from '../canvas/presence-overlay';
import { PublishDialog } from '../chrome/publish-dialog';
import { StatusBar } from '../chrome/status-bar';
import { Toasts } from '../chrome/toasts';
import { TopBar } from '../chrome/topbar';
import { Inspector } from '../inspector/inspector';
import { ResizeHandle, Sidebar } from '../panels/sidebar';
import { PreviewOverlay } from '../preview/preview';
import { EditorSkeleton } from './editor-skeleton';

export function EditorShell({ projectId }: { projectId: string }) {
  const router = useRouter();
  const loaded = useEditor((s) => s.loaded);
  const rightOpen = useEditor((s) => s.rightOpen);
  const rightWidth = useEditor((s) => s.rightWidth);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // Only join a room once the document is in memory: the welcome message can
  // replace it, and replacing something that isn't there yet loses the race.
  const collab = useCollaboration(projectId, loaded);
  const live = collab.status === 'live';

  const { saveNow } = useAutosave({ suspended: live });

  /* --- Load ------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    clearRegistry();

    (async () => {
      try {
        const doc = await getStorage().loadProject(projectId);
        if (cancelled) return;
        if (!doc) {
          setError('This project could not be found.');
          return;
        }
        useEditor.getState().loadDocument(hydrateDocument(doc as Partial<Cre8Document>));
      } catch (loadError) {
        console.error('[cre8] load failed', loadError);
        if (!cancelled) setError('Something went wrong opening this project.');
      }
    })();

    return () => {
      cancelled = true;
      useEditor.getState().resetDocument();
      clearRegistry();
    };
  }, [projectId]);

  /* --- Theme ------------------------------------------------------------ */

  useEffect(() => {
    document.body.classList.add('cre8-editor');
    try {
      const stored = localStorage.getItem('cre8:theme');
      if (stored === 'light' || stored === 'dark') useEditor.getState().setTheme(stored);
    } catch {
      /* no stored preference */
    }
    return () => document.body.classList.remove('cre8-editor');
  }, []);

  /* --- Publish ---------------------------------------------------------- */

  const onPublish = useCallback(async () => {
    const store = useEditor.getState();
    setPublishing(true);
    try {
      await saveNow();
      const result = await publishProject(store.doc);
      // Not an edit the user made, so not something undo should walk back:
      // recorded, the first Ctrl+Z after publishing reverts this stamp and
      // looks like it did nothing at all.
      store.transact(
        'Publish',
        (draft) => {
          draft.lastPublished = {
            publishedAt: result.publishedAt,
            pageCount: result.pageCount,
            nodeCount: Object.keys(draft.nodes).length,
            bytes: result.bytes,
          };
        },
        { record: false, quiet: true }
      );
      setPublishResult(result);
    } catch (publishError) {
      console.error('[cre8] publish failed', publishError);
      store.toast('Publishing failed. Your work is still saved.', 'error');
    } finally {
      setPublishing(false);
    }
  }, [saveNow]);

  useKeyboardShortcuts({ onSave: () => void saveNow(), onPublish: () => void onPublish() });

  /* --- Render ----------------------------------------------------------- */

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-[var(--app)]">
        <p className="text-[13px] text-[var(--text)]">{error}</p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="rounded-md bg-[var(--field)] px-3 py-1.5 text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
        >
          Back to projects
        </button>
      </div>
    );
  }

  if (!loaded) return <EditorSkeleton />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--app)]">
      <TopBar
        onPublish={() => void onPublish()}
        publishing={publishing}
        peers={collab.peers}
        canEdit={collab.canEdit || !live}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <CanvasArea peers={collab.peers} />
        {rightOpen && (
          <div
            className="relative min-h-0 shrink-0 border-l border-[var(--border)]"
            style={{ width: rightWidth }}
          >
            <Inspector />
            <ResizeHandle side="left" onResize={(w) => useEditor.getState().setRightWidth(w)} />
          </div>
        )}
      </div>

      <StatusBar />

      <DragController />
      <DragGhost />
      <Toasts />
      <PreviewOverlay />
      <PublishDialog result={publishResult} onClose={() => setPublishResult(null)} />
    </div>
  );
}

/**
 * The canvas plus the overlays that need its coordinate space. Kept separate so
 * the toolbar can measure against the same element the canvas transforms in.
 */
function CanvasArea({ peers }: { peers: RemotePeer[] }) {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);

  return (
    <div ref={setViewport} className="relative flex min-w-0 flex-1">
      <Canvas />
      <PresenceOverlay peers={peers} viewport={viewport} />
      <ContextToolbar viewport={viewport} />
    </div>
  );
}
