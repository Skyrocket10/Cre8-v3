/**
 * Building a project's static site, server-side.
 *
 * Everything a publish needs and nothing about where the result goes: read the
 * live document, read the rows its repeaters point at, hand both to the shared
 * generator. Storage, cache purging and bookkeeping live next door in
 * `publish.ts`, which is what let the background republish reuse all of it.
 */

import { collectionsUsedBy, generateSite, hydrateDocument } from './render';
import type { CollectionRecord, Cre8Document, GeneratedSite, RecordSet } from './render';
import { room, roomUrl } from './db';
import type { Env } from '../types';

/**
 * How many rows a publish reads per collection.
 *
 * The *route* ceiling rather than the repeater's, and one past it. A repeater
 * shows at most five hundred; a dynamic page publishes one file per record up
 * to a thousand, so reading five hundred would cap a blog at five hundred
 * posts and say nothing. The extra row is what lets `routes.ts` tell "at the
 * limit" from "over it" and refuse with a sentence.
 *
 * Kept in step with `LIMITS.pagesPerRoute` in the document model.
 */
const MAX_RECORDS_PER_PUBLISH = 1001;

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

/**
 * The document as it is right now, not as it was last written to D1.
 *
 * Read through the room for the same reason a whole-document save goes through
 * it: the room is authoritative while anyone has the project open, and D1 is
 * behind by however long the last debounce was. Publishing the stale copy
 * would mean hitting Publish and getting the page you had a few seconds ago,
 * which is the single most confusing thing a builder can do.
 */
export async function liveDocument(env: Env, projectId: string): Promise<Cre8Document | null> {
  const response = await room(env, projectId).fetch(roomUrl(projectId, 'document'));
  if (!response.ok) return null;
  const { document } = (await response.json()) as { document?: Record<string, unknown> | null };
  if (!document) return null;
  // The same normalisation the editor applies on load, so the Worker renders
  // the document the editor would have rendered rather than whatever shape
  // happened to be stored.
  return hydrateDocument(document as Partial<Cre8Document>);
}

/**
 * Every collection the document repeats over, straight out of D1.
 *
 * The same query the API route serves the editor — published only, ordered by
 * position then age, clamped the same way. It has to be the same: if the
 * server took a different thousand rows than the browser would have, the two
 * would publish different pages and the byte-identical claim would be false in
 * exactly the case nobody tests.
 */
export async function recordsFor(env: Env, projectId: string, doc: Cre8Document): Promise<RecordSet> {
  const collections = collectionsUsedBy(doc.nodes, Object.keys(doc.nodes));
  if (!collections.length) return {};

  const out: RecordSet = {};
  for (const collectionId of collections) {
    const rows = await env.DB.prepare(
      `SELECT * FROM records
        WHERE project_id = ?1 AND collection_id = ?2 AND published = 1
        ORDER BY position, created_at
        LIMIT ?3`
    )
      .bind(projectId, collectionId, MAX_RECORDS_PER_PUBLISH)
      .all<RecordRow>();
    out[collectionId] = (rows.results ?? []).map(shape);
  }
  return out;
}

function shape(row: RecordRow): CollectionRecord {
  return {
    id: row.id,
    collectionId: row.collection_id,
    ...(row.slug ? { slug: row.slug } : {}),
    position: row.position,
    published: row.published === 1,
    data: safeParse(row.data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeParse(value: string): CollectionRecord['data'] {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CollectionRecord['data'])
      : {};
  } catch {
    // One unparseable row must not cost a whole publish. It renders as a row
    // with no fields, which shows the design-time copy — visibly wrong in a
    // way somebody will report, rather than a failed deploy.
    return {};
  }
}

/**
 * The finished site: every page, the sitemap, robots, and the assets to copy.
 *
 * `apiOrigin` is where published forms post. Absolute rather than relative
 * because a site may be served from its own domain, where a relative action
 * would hit the sites Worker — which has no database and would answer 404.
 *
 * Takes the document rather than fetching it, because both callers have a
 * reason to hold it: the room must not read its own document back through
 * itself, and the publisher stores what it published so a version can be put
 * back later.
 */
export async function renderSite(
  env: Env,
  projectId: string,
  apiOrigin: string,
  doc: Cre8Document
): Promise<GeneratedSite> {
  return generateSite(doc, {
    apiOrigin,
    projectId,
    records: await recordsFor(env, projectId, doc),
  });
}
