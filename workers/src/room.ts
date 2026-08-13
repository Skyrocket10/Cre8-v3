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
 *
 * ## Republishing
 *
 * D6 gave the room a second job, and it is here rather than anywhere else for
 * one reason: it is the only thing in the system that is already exactly one
 * per project and can hold a timer. A record write pings it; it sets an alarm;
 * the alarm publishes. Everything about coalescing a burst of edits into a
 * single publish lives in those three lines of state.
 */

import { applyPatches, enablePatches, type Patch } from 'immer';
import { hasBeenPublished, publishSite } from './lib/publish';
import { hydrateDocument, RouteError } from './lib/render';
import type { Cre8Document } from './lib/render';
import type { Env } from './types';

enablePatches();

/** Guards against a client trying to blow up the room with one message. */
const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_PATCHES = 2_000;

/**
 * How long the room waits for the edits to stop before republishing…
 *
 * Short enough that saving a record and switching to the live site feels like
 * it followed you, long enough that reordering a list is one publish. Every
 * further edit inside the window pushes the alarm out again.
 */
const REPUBLISH_QUIET_MS = 5_000;

/**
 * …and how far that pushing is allowed to go.
 *
 * Without a ceiling, a steady drip of edits — someone working through a
 * collection a row at a time — would defer the publish for as long as they
 * kept going, and the site would never update while it was being used most.
 */
const REPUBLISH_MAX_WAIT_MS = 30_000;

/**
 * Is this a failure that retrying cannot fix?
 *
 * The platform retries a failing alarm with backoff, which is exactly right
 * for R2 or D1 having a moment and exactly wrong for a document that asks for
 * something impossible. The two are told apart the same way the HTTP layer
 * tells them apart: a 4xx is the caller's, a 5xx is ours. `RouteError` is the
 * planner's own refusal and carries no status, so it is named directly.
 */
function permanent(error: unknown): boolean {
  if (error instanceof RouteError) return true;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** What the alarm needs, since it fires with no request behind it. */
interface PendingRepublish {
  projectId: string;
  /** Where published forms post. The alarm has no URL of its own to derive it from. */
  apiOrigin: string;
  /** When the burst started, for the ceiling above. */
  since: number;
}

const PENDING = 'republish';

/**
 * Which project this room is for, kept where hibernation cannot lose it.
 *
 * The object is addressed by `idFromName(projectId)` and there is no way back
 * from the id to the name, so anything that wakes a hibernated room without a
 * request behind it — an alarm, a message on a hibernated socket — starts with
 * no idea which project it is. The alarm has always carried its own copy; the
 * socket path had none, and woke up believing the project had no document.
 */
const PROJECT_ID = 'project';

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
    const named = url.searchParams.get('project');
    if (named && named !== this.projectId) {
      this.projectId = named;
      // Written once per instance, and the only place it can be learnt from:
      // every other way into this object arrives without a URL.
      await this.ctx.storage.put(PROJECT_ID, named);
    }

    if (url.pathname.endsWith('/socket')) return this.handleUpgrade(request);
    if (url.pathname.endsWith('/document')) return this.handleDocument(request);
    if (url.pathname.endsWith('/content-changed')) return this.handleContentChanged(request);
    return new Response('Not found', { status: 404 });
  }

  /* ------------------------------------------------------------ loading -- */

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    // A hibernated room wakes on a socket message with no URL to read, so the
    // id comes back from storage. Without this the query below asked for a
    // project called "", found nothing, and cached "this project has no
    // document" — after which every read of a perfectly good project 404ed and
    // every patch was applied to an empty object.
    if (!this.projectId) this.projectId = (await this.ctx.storage.get<string>(PROJECT_ID)) ?? '';
    if (!this.projectId) return;

    const row = await this.env.DB.prepare(
      `SELECT document, version FROM projects WHERE id = ?1`
    )
      .bind(this.projectId)
      .first<{ document: string; version: number }>();

    // Nothing to remember. Asking again on the next message costs one query;
    // caching a load that did not happen costs the document.
    if (!row) return;

    try {
      this.doc = JSON.parse(row.document);
    } catch {
      this.doc = null;
    }
    this.version = row.version;
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
    // A whole-document write *is* a load, and saying so stops the next read
    // from going back to D1 and overwriting it with the older copy there.
    this.loaded = true;
    this.version += 1;
    this.persist();

    // Anyone with the room open is now behind by a whole-document replacement.
    this.broadcast({ t: 'resync', version: this.version, doc: this.doc }, null);
    return Response.json({ version: this.version });
  }

  /* --------------------------------------------------------- republish -- */

  /**
   * A record was written. Arm the timer.
   *
   * Trailing edge with a ceiling: each change moves the alarm to
   * `now + QUIET`, but never past `since + MAX_WAIT`. So a burst settles into
   * one publish five seconds after the last edit, and a steady stream still
   * publishes every thirty seconds rather than never.
   *
   * The project id goes into storage with everything else. It has to: this
   * object is addressed by `idFromName(projectId)` and there is no way back
   * from the id to the name, so an alarm that woke a hibernated room would
   * otherwise not know which project it was for.
   */
  private async handleContentChanged(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { apiOrigin?: unknown };
    const apiOrigin = typeof body.apiOrigin === 'string' ? body.apiOrigin : '';
    if (!apiOrigin || !this.projectId) return new Response('Missing origin', { status: 400 });

    const now = Date.now();
    const pending = await this.ctx.storage.get<PendingRepublish>(PENDING);
    const since = pending?.since ?? now;

    await this.ctx.storage.put<PendingRepublish>(PENDING, {
      projectId: this.projectId,
      apiOrigin,
      since,
    });
    await this.ctx.storage.setAlarm(
      Math.min(now + REPUBLISH_QUIET_MS, since + REPUBLISH_MAX_WAIT_MS)
    );

    return Response.json({ ok: true });
  }

  /**
   * The republish itself.
   *
   * Runs the same `publishSite` the Publish button runs — the only differences
   * are that nobody is credited for it and that the document is handed over
   * rather than fetched. That second one is not a shortcut: reading it back the
   * usual way goes through the room, and a Durable Object calling itself
   * deadlocks.
   */
  async alarm(): Promise<void> {
    const pending = await this.ctx.storage.get<PendingRepublish>(PENDING);
    if (!pending) return;

    this.projectId = pending.projectId;

    // A project nobody has ever published has no site to update, and a record
    // edit is not consent to put one on the internet.
    if (!(await hasBeenPublished(this.env, pending.projectId))) {
      await this.ctx.storage.delete(PENDING);
      return;
    }

    await this.ensureLoaded();
    if (!this.doc) {
      await this.ctx.storage.delete(PENDING);
      return;
    }

    try {
      await publishSite(this.env, pending.projectId, {
        apiOrigin: pending.apiOrigin,
        // Nobody pressed anything. `deployments.published_by` is nullable, and
        // this is what the null means — crediting the person whose record edit
        // happened to trip the timer would put their name on a deploy they
        // never asked for.
        publishedBy: null,
        document: hydrateDocument(this.doc as Partial<Cre8Document>),
      });
    } catch (error) {
      if (!permanent(error)) {
        // Transient — R2 or D1 having a moment. Leave the pending state where
        // it is and let the platform retry the alarm with backoff.
        throw error;
      }
      // Not transient. The document asks for something that will be refused
      // again in six seconds and in six hours — a route past its ceiling, two
      // pages wanting one URL, an image belonging to somebody else. Retrying
      // would burn the backoff schedule to arrive at the same sentence, so
      // this stops and says so; the designer sees it when they next publish.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[room] ${pending.projectId} cannot republish: ${message}`);
    }

    await this.ctx.storage.delete(PENDING);
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

        /*
         * No document, no patching.
         *
         * This used to read `applyPatches(this.doc ?? {}, …)`, which invents an
         * empty document and edits that. A patch into `{}` usually throws — and
         * the room then answered `resync` with a null document, which is how a
         * live editing session ended up being told its project did not exist.
         * The patches that *don't* throw are worse: `persist()` would write the
         * invented object straight over the real one.
         */
        if (!this.doc) {
          console.error('[room] patch with no document loaded', this.projectId || '(no id)');
          ws.send(
            JSON.stringify({
              t: 'denied',
              reason: 'Lost track of this project — reload the page to keep editing.',
            })
          );
          return;
        }

        // The fence. A stale base means someone else's change landed first, so
        // this one is refused and the client is brought up to date instead.
        if (message.baseVersion !== this.version) {
          ws.send(JSON.stringify({ t: 'resync', version: this.version, doc: this.doc }));
          return;
        }

        try {
          this.doc = applyPatches(this.doc, message.patches) as Record<string, unknown>;
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
