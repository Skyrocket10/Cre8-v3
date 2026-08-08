/**
 * ProjectRoom — one Durable Object per project.
 *
 * ## What it guarantees
 *
 * The room is the single writer for a project's document, and it holds a
 * monotonic `version`. A client sends the patches it produced together with
 * the version it produced them against:
 *
 *   • base version matches   → apply, bump, broadcast to everyone
 *   • base version is stale  → reject and send that client a full resync
 *
 * So the document can never silently diverge. Two people editing different
 * elements interleave cleanly, because each change lands against a version
 * that already includes the other's. Two people editing the *same* property
 * within one round trip resolve last-writer-wins, and the loser is told
 * immediately rather than drifting.
 *
 * This is deliberately not a CRDT. A CRDT would let both edits survive without
 * a round trip, at the cost of a much larger document model and merge
 * semantics that are hard to reason about for structural operations like "move
 * this section into that container". Version fencing is small, obviously
 * correct, and its failure mode is a visible resync rather than corruption.
 *
 * ## Hibernation
 *
 * Sockets use the hibernation API, so an idle room costs nothing and its
 * in-memory state can vanish between messages. Nothing may live only in
 * memory: the document reloads from D1 on demand, and per-connection identity
 * rides on the socket via `serializeAttachment`.
 */

import { applyPatches, enablePatches, type Patch } from 'immer';
import type { Env } from './types';

enablePatches();

/** Guards against a client trying to blow up the room with one message. */
const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_PATCHES = 2_000;

interface Peer {
  connectionId: string;
  userId: string;
  name: string;
  hue: number;
  canEdit: boolean;
  /** Canvas position in document space, plus which page they're on. */
  cursor?: { x: number; y: number; pageId: string } | null;
  selection?: string[];
}

type ClientMessage =
  | { t: 'presence'; cursor?: Peer['cursor']; selection?: string[] }
  | { t: 'patch'; baseVersion: number; patches: Patch[] }
  | { t: 'ping' };

export class ProjectRoom implements DurableObject {
  private doc: Record<string, unknown> | null = null;
  private version = 0;
  private projectId = '';
  private loaded = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.projectId = url.searchParams.get('project') ?? this.projectId;

    if (url.pathname.endsWith('/socket')) return this.handleUpgrade(request);
    if (url.pathname.endsWith('/document')) return this.handleDocument(request);
    return new Response('Not found', { status: 404 });
  }

  /* ------------------------------------------------------------ loading -- */

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const row = await this.env.DB.prepare(
      `SELECT document, version FROM projects WHERE id = ?1`
    )
      .bind(this.projectId)
      .first<{ document: string; version: number }>();

    if (row) {
      try {
        this.doc = JSON.parse(row.document);
      } catch {
        this.doc = null;
      }
      this.version = row.version;
    }
    this.loaded = true;
  }

  /**
   * Persist after broadcasting rather than before: subscribers should not wait
   * on a D1 round trip to see each other's edits.
   */
  private persist(): void {
    if (!this.doc) return;
    const document = JSON.stringify(this.doc);
    const pages = Array.isArray((this.doc as { pages?: unknown[] }).pages)
      ? (this.doc as { pages: unknown[] }).pages.length
      : 1;

    this.ctx.waitUntil(
      this.env.DB.prepare(
        `UPDATE projects SET document = ?1, version = ?2, page_count = ?3, updated_at = ?4
          WHERE id = ?5`
      )
        .bind(document, this.version, pages, Date.now(), this.projectId)
        .run()
        .catch((error) => console.error('[room] persist failed', error))
    );
  }

  /* ----------------------------------------------------------- HTTP API -- */

  /** Read-through and write-through for clients that aren't holding a socket. */
  private async handleDocument(request: Request): Promise<Response> {
    await this.ensureLoaded();

    if (request.method === 'GET') {
      return Response.json({ document: this.doc, version: this.version });
    }

    const body = (await request.json()) as { document?: Record<string, unknown> };
    if (!body.document) return new Response('Missing document', { status: 400 });

    this.doc = body.document;
    this.version += 1;
    this.persist();

    // Anyone with the room open is now behind by a whole-document replacement.
    this.broadcast({ t: 'resync', version: this.version, doc: this.doc }, null);
    return Response.json({ version: this.version });
  }

  /* ---------------------------------------------------------- WebSocket -- */

  private async handleUpgrade(request: Request): Promise<Response> {
    await this.ensureLoaded();

    const url = new URL(request.url);
    const peer: Peer = {
      connectionId: crypto.randomUUID(),
      userId: url.searchParams.get('uid') ?? 'anon',
      name: url.searchParams.get('name') ?? 'Someone',
      hue: Number(url.searchParams.get('hue') ?? 220),
      canEdit: url.searchParams.get('edit') === '1',
    };

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernation: the runtime may evict this object between messages, so the
    // peer's identity is stored on the socket rather than in a field.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(peer);

    server.send(
      JSON.stringify({
        t: 'welcome',
        version: this.version,
        doc: this.doc,
        self: peer,
        peers: this.peers().filter((p) => p.connectionId !== peer.connectionId),
      })
    );
    this.broadcast({ t: 'joined', peer }, peer.connectionId);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;

    const peer = ws.deserializeAttachment() as Peer | null;
    if (!peer) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.t) {
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong' }));
        return;

      case 'presence': {
        const next: Peer = {
          ...peer,
          cursor: message.cursor ?? null,
          selection: Array.isArray(message.selection) ? message.selection.slice(0, 64) : [],
        };
        ws.serializeAttachment(next);
        // Presence is lossy by nature — never persisted, never acknowledged.
        this.broadcast(
          { t: 'presence', from: peer.connectionId, cursor: next.cursor, selection: next.selection },
          peer.connectionId
        );
        return;
      }

      case 'patch': {
        if (!peer.canEdit) {
          ws.send(JSON.stringify({ t: 'denied', reason: 'You have view-only access' }));
          return;
        }
        await this.ensureLoaded();

        if (!Array.isArray(message.patches) || message.patches.length > MAX_PATCHES) return;

        // The fence. A stale base means someone else's change landed first, so
        // this one is refused and the client is brought up to date instead.
        if (message.baseVersion !== this.version) {
          ws.send(JSON.stringify({ t: 'resync', version: this.version, doc: this.doc }));
          return;
        }

        try {
          this.doc = applyPatches(this.doc ?? {}, message.patches) as Record<string, unknown>;
        } catch (error) {
          console.error('[room] bad patch', error);
          ws.send(JSON.stringify({ t: 'resync', version: this.version, doc: this.doc }));
          return;
        }

        this.version += 1;
        // Echoed to the sender too, so everyone learns the new version from
        // the same message and no one has to guess it.
        this.broadcast(
          { t: 'patch', version: this.version, patches: message.patches, from: peer.connectionId },
          null
        );
        this.persist();
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const peer = ws.deserializeAttachment() as Peer | null;
    if (peer) this.broadcast({ t: 'left', connectionId: peer.connectionId }, peer.connectionId);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /* ------------------------------------------------------------ helpers -- */

  private peers(): Peer[] {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment() as Peer | null)
      .filter((p): p is Peer => Boolean(p));
  }

  private broadcast(message: unknown, exceptConnectionId: string | null): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      const peer = ws.deserializeAttachment() as Peer | null;
      if (exceptConnectionId && peer?.connectionId === exceptConnectionId) continue;
      try {
        ws.send(payload);
      } catch {
        // A socket that has gone away will surface through webSocketClose.
      }
    }
  }
}
