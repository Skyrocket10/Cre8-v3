/**
 * Publish history, and putting one back.
 *
 * ## What a version is
 *
 * A version is **a design somebody published**. Not a save, not an undo step,
 * and not a snapshot of the content.
 *
 * That is a narrower thing than it might sound, and it lines up exactly with a
 * rule that already exists: a design change never republishes on its own, so
 * every design that has ever been live got there because a person pressed
 * Publish. Storing the document on manual publishes therefore captures every
 * distinct design the site has ever served, and storing it on the automatic
 * ones would capture nothing but duplicates — a record edit republishes the
 * same design with newer rows in it.
 *
 * ## What restoring does, and what it deliberately does not
 *
 * Restoring re-publishes the stored document against **the records that exist
 * now**. It does not roll content back, and that is the only defensible
 * reading for a builder with a CMS in it: putting last month's layout back
 * must not un-publish last week's posts. Design is versioned, content is live
 * — the same seam the collections panel is split along.
 *
 * So a restore lands on a state that never existed before: an old design
 * carrying today's content. The dialog says so, because a person expecting
 * "undo the last month" and getting that would be right to be surprised.
 *
 * It also moves the *editor*, not just the site. A restore that changed the
 * published files and left the canvas alone would break the one property this
 * whole project is built on — the canvas is what the site is.
 *
 * ## Why the restore is not one function here
 *
 * Reading the design back, pushing it through the room and publishing it are
 * three steps, and the middle one is what makes the first two safe. They are
 * sequenced in the route rather than in this module for a boring reason:
 * publishing lives in `publish.ts`, `publish.ts` writes the log that lives
 * here, and a module that both wrote and called the publisher would close a
 * cycle. The route is where the three read in order anyway.
 */

import { newId } from './crypto';
import type { Env } from '../types';

/**
 * How many publishes back you can go.
 *
 * A safety net rather than an archive. Twenty manual publishes is far more
 * than the "I have just broken the home page" case this exists for, and a
 * document runs to tens of kilobytes, so the arithmetic stays boring.
 */
const RESTORABLE = 20;

/**
 * How much of the log survives at all.
 *
 * Larger than `RESTORABLE`, and separately bounded, because the log answers a
 * different question — *when did the site last change, and was it a person?* —
 * and a busy collection republishes often enough to fill a table with rows
 * nobody can restore anyway. Falling out of the restorable window empties the
 * `document`; falling out of this one removes the row.
 */
const LOGGED = 200;

export interface DeploymentSummary {
  id: string;
  publishedAt: number;
  /** Null when nobody pressed anything — the site followed a record edit. */
  publishedBy: { id: string; name: string } | null;
  pageCount: number;
  bytes: number;
  changed: { written: number; removed: number; unchanged: number } | null;
  /** Whether the design it shipped is still on file. */
  restorable: boolean;
}

interface DeploymentRow {
  id: string;
  published_at: number;
  user_id: string | null;
  user_name: string | null;
  page_count: number;
  bytes: number;
  changed: string | null;
  has_document: number;
}

/**
 * The log, newest first.
 *
 * `document` is never selected — it is the largest column in the database and
 * a listing has no use for it. `has_document` is the one bit that matters.
 */
export async function listDeployments(
  env: Env,
  projectId: string,
  limit = 50
): Promise<DeploymentSummary[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.published_at, d.page_count, d.bytes, d.changed,
            d.published_by AS user_id, u.name AS user_name,
            d.document IS NOT NULL AS has_document
       FROM deployments d
       LEFT JOIN users u ON u.id = d.published_by
      WHERE d.project_id = ?1
      ORDER BY d.published_at DESC
      LIMIT ?2`
  )
    .bind(projectId, Math.min(200, Math.max(1, limit)))
    .all<DeploymentRow>();

  return results.map((row) => ({
    id: row.id,
    publishedAt: row.published_at,
    publishedBy:
      row.user_id && row.user_name ? { id: row.user_id, name: row.user_name } : null,
    pageCount: row.page_count,
    bytes: row.bytes,
    changed: parseChanged(row.changed),
    restorable: row.has_document === 1,
  }));
}

function parseChanged(value: string | null): DeploymentSummary['changed'] {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const { written, removed, unchanged } = parsed as Record<string, unknown>;
    if (typeof written !== 'number' || typeof removed !== 'number') return null;
    return { written, removed, unchanged: typeof unchanged === 'number' ? unchanged : 0 };
  } catch {
    // A count nobody can read is not worth failing a listing over.
    return null;
  }
}

/**
 * Keep both windows.
 *
 * Two statements rather than one because they are two different bounds on two
 * different things, and collapsing them would tie how far back you can restore
 * to how much history you can read.
 */
export async function prune(env: Env, projectId: string): Promise<void> {
  await env.DB.batch([
    // Older designs stop being restorable, and the rows stay.
    env.DB.prepare(
      `UPDATE deployments SET document = NULL
        WHERE project_id = ?1 AND document IS NOT NULL AND id NOT IN (
          SELECT id FROM deployments
           WHERE project_id = ?1 AND document IS NOT NULL
           ORDER BY published_at DESC LIMIT ?2
        )`
    ).bind(projectId, RESTORABLE),
    env.DB.prepare(
      `DELETE FROM deployments
        WHERE project_id = ?1 AND id NOT IN (
          SELECT id FROM deployments
           WHERE project_id = ?1 ORDER BY published_at DESC LIMIT ?2
        )`
    ).bind(projectId, LOGGED),
  ]);
}

export class RestoreError extends Error {}

/**
 * The design a given publish shipped, ready to put back.
 *
 * Scoped to the project for the same reason every record read is: without it,
 * a caller with any project of their own could pull a design out of somebody
 * else's history by id.
 */
export async function documentToRestore(
  env: Env,
  projectId: string,
  deploymentId: string
): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    `SELECT document FROM deployments WHERE id = ?1 AND project_id = ?2`
  )
    .bind(deploymentId, projectId)
    .first<{ document: string | null }>();

  if (!row) throw new RestoreError('That version is not part of this project');
  if (!row.document) {
    throw new RestoreError(
      'That publish did not change the design, so there is nothing to put back'
    );
  }

  try {
    const parsed: unknown = JSON.parse(row.document);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed as Record<string, unknown>;
  } catch {
    throw new RestoreError('That version cannot be read back');
  }
}

/* --------------------------------------------------------------------------
 * Writing the log
 * ----------------------------------------------------------------------- */

export interface DeploymentFacts {
  publishedBy: string | null;
  publishedAt: number;
  pageCount: number;
  bytes: number;
  prefix: string;
  written: number;
  removed: number;
  unchanged: number;
  /**
   * The design that was published, if it should be restorable.
   *
   * Passed by the publisher rather than decided here, because the publisher is
   * the thing that knows whether a person asked — and passing it explicitly
   * keeps "what makes a version" one readable line at the call site.
   */
  document: unknown | null;
}

/** One row, then both ceilings. */
export async function recordDeployment(
  env: Env,
  projectId: string,
  facts: DeploymentFacts
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO deployments
       (id, project_id, published_by, published_at, page_count, bytes, r2_prefix, document, changed)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  )
    .bind(
      newId(),
      projectId,
      facts.publishedBy,
      facts.publishedAt,
      facts.pageCount,
      facts.bytes,
      facts.prefix,
      facts.document === null ? null : JSON.stringify(facts.document),
      JSON.stringify({
        written: facts.written,
        removed: facts.removed,
        unchanged: facts.unchanged,
      })
    )
    .run();

  await prune(env, projectId);
}
