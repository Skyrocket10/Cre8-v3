'use client';

/**
 * Collaboration client.
 *
 * Holds one WebSocket to the project's room and keeps the local store in step
 * with it. Three responsibilities, kept separate on purpose:
 *
 *   • **Patches out** — local edits are sent with the version they were made
 *     against. If the room has moved on, it replies with a resync instead of
 *     applying them.
 *   • **Patches in** — remote edits are applied without touching local undo.
 *   • **Presence** — cursor and selection, throttled, never persisted.
 *
 * The failure mode is deliberately visible. Rather than trying to merge
 * conflicting edits silently, a losing write triggers a full resync and the
 * user is told. That is a worse merge story than a CRDT and a far better one
 * than quiet divergence.
 */

import type { Patch } from 'immer';
import { hydrateDocument } from '../document/factory';
import type { Cre8Document, NodeId } from '../document/types';
import { onLocalPatches, useEditor } from '../editor/store';
import { socketUrl } from '../api/client';

export interface RemotePeer {
  connectionId: string;
  userId: string;
  name: string;
  hue: number;
  canEdit: boolean;
  cursor?: { x: number; y: number; pageId: string } | null;
  selection?: string[];
}

export type CollabStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'denied';

export interface CollabSnapshot {
  status: CollabStatus;
  peers: RemotePeer[];
  /** Room version the local document is known to match. */
  version: number;
  canEdit: boolean;
}

type Listener = (snapshot: CollabSnapshot) => void;

const PRESENCE_INTERVAL_MS = 60;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15_000;

export class CollabClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private unsubscribePatches: (() => void) | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPresence: { cursor: RemotePeer['cursor']; selection: string[] } | null = null;
  private closedByUs = false;

  private snapshot: CollabSnapshot = { status: 'idle', peers: [], version: 0, canEdit: true };
  /** Our own connection id, learned from the welcome message. */
  private connectionId: string | null = null;
  /** Last position sent, so a selection change doesn't blank the cursor. */
  private lastCursor: RemotePeer['cursor'] = null;

  constructor(private readonly projectId: string) {}

  /* ------------------------------------------------------------- lifecycle */

  connect(): void {
    this.closedByUs = false;
    this.open();

    this.unsubscribePatches = onLocalPatches((patches) => this.sendPatches(patches));
  }

  disconnect(): void {
    this.closedByUs = true;
    this.unsubscribePatches?.();
    this.unsubscribePatches = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.socket?.close();
    this.socket = null;
    this.update({ status: 'idle', peers: [] });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  get current(): CollabSnapshot {
    return this.snapshot;
  }

  /* ---------------------------------------------------------------- socket */

  private open(): void {
    this.update({ status: this.reconnectAttempt ? 'reconnecting' : 'connecting' });

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl(this.projectId));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        this.receive(JSON.parse(event.data));
      } catch (error) {
        console.error('[collab] bad message', error);
      }
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.closedByUs) return;
      this.update({ status: 'offline', peers: [] });
      this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.closedByUs) return;
    // Exponential backoff with jitter, so a room full of clients doesn't
    // stampede the Worker the moment it comes back.
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay + Math.random() * 400);
  }

  /* -------------------------------------------------------------- messages */

  private receive(message: Record<string, unknown>): void {
    const store = useEditor.getState();

    switch (message.t) {
      case 'welcome': {
        const self = message.self as RemotePeer | undefined;
        this.connectionId = self?.connectionId ?? null;
        const doc = message.doc as Cre8Document | null;
        // The room is authoritative on join: whatever was loaded over HTTP may
        // already be a version behind.
        if (doc) store.replaceDocument(hydrateDocument(doc));
        this.update({
          status: 'live',
          version: Number(message.version ?? 0),
          peers: (message.peers as RemotePeer[]) ?? [],
          canEdit: Boolean(self?.canEdit),
        });
        return;
      }

      case 'joined': {
        const peer = message.peer as RemotePeer;
        this.update({ peers: [...this.snapshot.peers.filter((p) => p.connectionId !== peer.connectionId), peer] });
        return;
      }

      case 'left': {
        const id = message.connectionId as string;
        this.update({ peers: this.snapshot.peers.filter((p) => p.connectionId !== id) });
        return;
      }

      case 'presence': {
        const from = message.from as string;
        this.update({
          peers: this.snapshot.peers.map((p) =>
            p.connectionId === from
              ? { ...p, cursor: message.cursor as RemotePeer['cursor'], selection: message.selection as string[] }
              : p
          ),
        });
        return;
      }

      case 'patch': {
        const version = Number(message.version ?? 0);
        // Our own change coming back: adopt the version, don't re-apply it.
        if (message.from !== this.connectionId) {
          store.applyRemotePatches(message.patches as Patch[]);
        }
        this.update({ version });
        return;
      }

      case 'resync': {
        const doc = message.doc as Cre8Document | null;
        if (doc) store.replaceDocument(hydrateDocument(doc));
        this.update({ version: Number(message.version ?? 0) });
        store.toast('Synced with the latest changes from your team', 'info');
        return;
      }

      case 'denied': {
        this.update({ canEdit: false, status: 'denied' });
        store.toast(String(message.reason ?? 'You have view-only access'), 'error');
        return;
      }
    }
  }

  private sendPatches(patches: Patch[]): void {
    if (!patches.length) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!this.snapshot.canEdit) return;

    socket.send(
      JSON.stringify({ t: 'patch', baseVersion: this.snapshot.version, patches })
    );
  }

  /**
   * Presence is throttled and lossy by design — only the newest position
   * matters, so a queued update is replaced rather than queued behind.
   */
  sendPresence(cursor: RemotePeer['cursor'], selection: NodeId[]): void {
    this.lastCursor = cursor;
    this.pendingPresence = { cursor, selection };
    if (this.presenceTimer) return;

    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const pending = this.pendingPresence;
      this.pendingPresence = null;
      const socket = this.socket;
      if (!pending || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ t: 'presence', ...pending }));
    }, PRESENCE_INTERVAL_MS);
  }

  /** Selection changed but the pointer didn't. Keeps the cursor where it was. */
  sendSelection(selection: NodeId[]): void {
    this.sendPresence(this.lastCursor, selection);
  }

  private update(partial: Partial<CollabSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
