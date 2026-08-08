'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { hasBackend } from '../api/client';
import { useEditor } from '../editor/store';
import { CollabClient, type CollabSnapshot, type RemotePeer } from './client';

const IDLE: CollabSnapshot = { status: 'idle', peers: [], version: 0, canEdit: true };

/**
 * Connects the open project to its collaboration room.
 *
 * A no-op with no backend configured, so the editor keeps working exactly as
 * it does offline rather than degrading into a broken networked mode.
 */
export function useCollaboration(projectId: string | null, enabled: boolean): CollabSnapshot {
  const client = useMemo(
    () => (enabled && hasBackend() && projectId ? new CollabClient(projectId) : null),
    [projectId, enabled]
  );

  useEffect(() => {
    if (!client) return;
    client.connect();
    return () => client.disconnect();
  }, [client]);

  const snapshot = useSyncExternalStore(
    (onChange) => client?.subscribe(() => onChange()) ?? (() => undefined),
    () => client?.current ?? IDLE,
    () => IDLE
  );

  // Broadcast what this person has selected, so others see it highlighted.
  const selection = useEditor((s) => s.selection);
  const lastSent = useRef<string>('');

  useEffect(() => {
    if (!client) return;
    const key = selection.join(',');
    if (key === lastSent.current) return;
    lastSent.current = key;
    client.sendSelection(selection);
  }, [client, selection]);

  const live = snapshot.status === 'live';

  /**
   * Reflect the connection into the store.
   *
   * Two things follow from being in a room: the room persists for us, so the
   * debounced HTTP save stands down; and a viewer's edits would be refused by
   * the server, so the editor stops pretending otherwise.
   */
  useEffect(() => {
    if (!client) return;
    const store = useEditor.getState();
    store.setReadOnly(live && !snapshot.canEdit);

    if (live) store.setSaveStatus('live');
    // Losing the room hands persistence back to autosave, which needs a reason
    // to run: whatever arrived over the socket was never saved over HTTP.
    else if (store.saveStatus === 'live') store.setSaveStatus('dirty');
  }, [client, live, snapshot.canEdit]);

  useEffect(() => {
    if (!client) return;
    return () => {
      useEditor.getState().setReadOnly(false);
    };
  }, [client]);

  useCursorBroadcast(client);

  return snapshot;
}

/**
 * Sends the pointer position in *document* space, not screen space.
 *
 * Peers are at different zoom levels and scroll positions, so a screen
 * coordinate would land somewhere meaningless on their canvas.
 */
function useCursorBroadcast(client: CollabClient | null): void {
  useEffect(() => {
    if (!client) return;

    const onMove = (event: PointerEvent) => {
      const { zoom, activePageId, previewing } = useEditor.getState();
      // Preview renders a second `.cre8-frame`; pointing at it says nothing
      // about where you are on the canvas.
      if (previewing) return;

      const frame = document.querySelector('.cre8-frame.cre8-editing');
      if (!frame) return;
      const box = frame.getBoundingClientRect();
      if (box.width === 0) return;

      const x = (event.clientX - box.left) / zoom;
      const y = (event.clientY - box.top) / zoom;

      // Outside the page frame there is nothing meaningful to point at.
      const inside = x >= 0 && y >= 0 && x <= box.width / zoom && y <= box.height / zoom;
      client.sendPresence(
        inside ? { x, y, pageId: activePageId } : null,
        useEditor.getState().selection
      );
    };

    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [client]);
}

export type { RemotePeer, CollabSnapshot };
