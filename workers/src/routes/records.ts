/**
 * Collection records — the content half of the data layer.
 *
 * The *shape* of a collection lives in the project document, because a field
 * list is a design decision. What lives here is content: rows that change
 * without the design changing and that run to thousands.
 *
 * The Worker deliberately knows nothing about that shape. A `collectionId` is
 * an opaque string scoped to the project, exactly as an asset key is — the
 * server does not parse a document to find out whether a collection exists,
 * because that would put a JSON parse of somebody's whole design on the path
 * of every record write to buy a check the editor can make for free.
 *
 * What it does enforce is everything that is cheap and that the editor cannot
 * be trusted with: who may read and write, that a record id belongs to the
 * project the caller named, the two limits countable in one query, and that a
 * slug is unique inside its collection.
 *
 * Since D6, every write here also tells the project's room that its content
 * moved, which is what makes a published site follow its records without
 * anybody pressing Publish. That is one line per handler and it is the whole
 * trigger; the coalescing, the "has this ever been published" question and the
 * publish itself are all somewhere else, because none of them belong in the
 * path of a save.
 */

import { newId } from '../lib/crypto';
import { requireProjectAccess } from '../lib/db';
import { badRequest, conflict, json, notFound, readJson } from '../lib/http';
import { contentChanged } from '../lib/publish';
import type { Env, SessionUser } from '../types';

/** Kept in step with `LIMITS` in the document model, which the editor reads. */
const MAX_RECORDS_PER_COLLECTION = 5000;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_PAGE = 200;

interface RecordRow {
  id: string;
  collection_id: string;
  slug: string | null;
  position: number;
  published: number;
  data: string;
  created_at: number;
  updated_at: number;
}

interface RecordBody {
  collectionId?: string;
  slug?: string | null;
  position?: number;
  published?: boolean;
  data?: unknown;
}

const shape = (row: RecordRow) => ({
  id: row.id,
  collectionId: row.collection_id,
  slug: row.slug ?? undefined,
  position: row.position,
  published: row.published === 1,
  // Stored as text, handed back as an object: a caller should never have to
  // know it was ever a string.
  data: safeParse(row.data),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A row that cannot be parsed is a bug somewhere upstream, and returning
    // an empty record keeps one bad row from breaking a whole listing.
    return {};
  }
}

/**
 * Validate the parts a caller controls.
 *
 * `data` has to be a plain object rather than an array or a bare string,
 * because everything downstream — the binding picker, the record form, the
 * renderer — addresses it by field name.
 */
function serialise(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badRequest('Record data must be an object of fields');
  }
  const text = JSON.stringify(data);
  if (new TextEncoder().encode(text).length > MAX_RECORD_BYTES) {
    throw badRequest(`A record cannot exceed ${MAX_RECORD_BYTES / 1024} KB`);
  }
  return text;
}

/** Slugs end up in a URL and in a filename, so they are narrowed to both. */
function cleanSlug(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const slug = String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return slug || null;
}

export function recordRoutes(
  request: Request,
  env: Env,
  projectId: string,
  recordId: string | undefined,
  user: SessionUser,
  cors: Record<string, string>,
  method: string
): Promise<Response> {
  // Where a republish should point published forms. The record write came from
  // the editor, which shares an origin with the API.
  const origin = new URL(request.url).origin;

  if (!recordId) {
    if (method === 'GET') return listRecords(request, env, projectId, user, cors);
    if (method === 'POST') return createRecord(request, env, projectId, user, cors, origin);
  } else {
    if (method === 'GET') return getRecord(env, projectId, recordId, user, cors);
    if (method === 'PUT') return updateRecord(request, env, projectId, recordId, user, cors, origin);
    if (method === 'DELETE') return deleteRecord(env, projectId, recordId, user, cors, origin);
  }
  throw notFound();
}

async function listRecords(
  request: Request,
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'viewer');

  const url = new URL(request.url);
  const collectionId = url.searchParams.get('collection') ?? '';
  if (!collectionId) throw badRequest('Name a collection');

  const limit = Math.min(MAX_PAGE, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  // Absent means both, which is what an editor listing wants; the publisher
  // asks for published only.
  const onlyPublished = url.searchParams.get('published') === 'true';

  const where = `project_id = ?1 AND collection_id = ?2${onlyPublished ? ' AND published = 1' : ''}`;
  const rows = await env.DB.prepare(
    `SELECT * FROM records WHERE ${where} ORDER BY position, created_at LIMIT ?3 OFFSET ?4`
  )
    .bind(projectId, collectionId, limit, offset)
    .all<RecordRow>();

  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where}`)
    .bind(projectId, collectionId)
    .first<{ n: number }>();

  return json({ records: (rows.results ?? []).map(shape), total: total?.n ?? 0 }, 200, cors);
}

/**
 * One record, by id, *within this project*.
 *
 * The `project_id` in the WHERE clause is the whole of the authorisation
 * story for a single record and is not decoration: without it, a caller with
 * access to any project could read every record in the database by id. It is
 * the same rule the publish route applies to asset keys.
 */
async function getRecord(
  env: Env,
  projectId: string,
  recordId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'viewer');
  const row = await env.DB.prepare(`SELECT * FROM records WHERE id = ?1 AND project_id = ?2`)
    .bind(recordId, projectId)
    .first<RecordRow>();
  if (!row) throw notFound('Record not found');
  return json({ record: shape(row) }, 200, cors);
}

async function createRecord(
  request: Request,
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>,
  origin: string
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'editor');
  const body = await readJson<RecordBody>(request);

  const collectionId = String(body.collectionId ?? '').trim();
  if (!collectionId) throw badRequest('Name a collection');

  const used = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM records WHERE project_id = ?1 AND collection_id = ?2`
  )
    .bind(projectId, collectionId)
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= MAX_RECORDS_PER_COLLECTION) {
    throw badRequest(`A collection holds at most ${MAX_RECORDS_PER_COLLECTION} records`);
  }

  const now = Date.now();
  const id = newId();
  const row: RecordRow = {
    id,
    collection_id: collectionId,
    slug: cleanSlug(body.slug),
    // Appended by default, which is what "add a record" means. Reordering is
    // a separate edit rather than a decision taken at creation.
    position: Number.isFinite(body.position) ? Number(body.position) : (used?.n ?? 0),
    published: body.published === false ? 0 : 1,
    data: serialise(body.data ?? {}),
    created_at: now,
    updated_at: now,
  };

  await insert(env, projectId, row);
  await contentChanged(env, projectId, origin);
  return json({ record: shape(row) }, 200, cors);
}

async function updateRecord(
  request: Request,
  env: Env,
  projectId: string,
  recordId: string,
  user: SessionUser,
  cors: Record<string, string>,
  origin: string
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'editor');
  const existing = await env.DB.prepare(`SELECT * FROM records WHERE id = ?1 AND project_id = ?2`)
    .bind(recordId, projectId)
    .first<RecordRow>();
  if (!existing) throw notFound('Record not found');

  const body = await readJson<RecordBody>(request);
  // A partial update: anything absent from the body keeps what it had. The
  // collection is not among them — a record does not move between shapes.
  const next: RecordRow = {
    ...existing,
    slug: body.slug === undefined ? existing.slug : cleanSlug(body.slug),
    position: Number.isFinite(body.position) ? Number(body.position) : existing.position,
    published: body.published === undefined ? existing.published : body.published ? 1 : 0,
    data: body.data === undefined ? existing.data : serialise(body.data),
    updated_at: Date.now(),
  };

  await run(
    env,
    `UPDATE records SET slug = ?1, position = ?2, published = ?3, data = ?4, updated_at = ?5
      WHERE id = ?6 AND project_id = ?7`,
    [next.slug, next.position, next.published, next.data, next.updated_at, recordId, projectId]
  );
  await contentChanged(env, projectId, origin);
  return json({ record: shape(next) }, 200, cors);
}

async function deleteRecord(
  env: Env,
  projectId: string,
  recordId: string,
  user: SessionUser,
  cors: Record<string, string>,
  origin: string
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'editor');
  const result = await env.DB.prepare(`DELETE FROM records WHERE id = ?1 AND project_id = ?2`)
    .bind(recordId, projectId)
    .run();
  // Reported rather than swallowed: a delete that matched nothing is either a
  // stale client or an id from somewhere else, and both are worth knowing.
  if (!result.meta.changes) throw notFound('Record not found');

  // The one that would be easiest to forget and worst to miss. A deleted
  // record has a page, and until this runs that page is still on the internet.
  await contentChanged(env, projectId, origin);
  return json({ ok: true }, 200, cors);
}

/* --------------------------------------------------------------------------
 * The two writes, with the slug collision turned into an answer
 * ----------------------------------------------------------------------- */

async function insert(env: Env, projectId: string, row: RecordRow): Promise<void> {
  await run(
    env,
    `INSERT INTO records
       (id, project_id, collection_id, slug, position, published, data, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    [
      row.id,
      projectId,
      row.collection_id,
      row.slug,
      row.position,
      row.published,
      row.data,
      row.created_at,
      row.updated_at,
    ]
  );
}

/**
 * Run a write, translating the one constraint a caller can trip.
 *
 * Two records sharing a slug is a 409 with a sentence, not a 500 with a
 * SQLite message — it is the single most likely thing to go wrong here, and
 * the person it happens to is a designer naming a second post "About".
 */
async function run(env: Env, sql: string, values: unknown[]): Promise<void> {
  try {
    await env.DB.prepare(sql)
      .bind(...values)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: records\.(project_id|collection_id|slug)/.test(message)) {
      throw conflict('Another record in this collection already uses that slug');
    }
    throw error;
  }
}
