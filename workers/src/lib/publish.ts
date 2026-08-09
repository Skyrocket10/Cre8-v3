/**
 * Putting a generated site in the bucket — and, from D6, putting only the part
 * of it that is not already there.
 *
 * ## Why a manifest
 *
 * Publishing used to be "write every file". That is fine when a person presses
 * a button; it stops being fine the moment a record edit triggers a publish by
 * itself, because a thousand-page blog would rewrite a thousand objects every
 * time somebody fixed a typo.
 *
 * So each project stores what is currently on its site: a JSON object of
 * published path → short content hash, in `projects.site_manifest`. A publish
 * hashes what it generated, compares, and does three things instead of one:
 *
 *   • **writes** the paths whose bytes differ
 *   • **deletes** the paths that were there and are no longer in the plan
 *   • **leaves alone** everything else
 *
 * The deletion half is not an optimisation. Without it, deleting a record
 * leaves the page it used to have sitting on the internet, reachable and
 * indexed, with no way to ever remove it. That was a real gap before D6 and it
 * is the half that would be missed if only the writes were counted.
 *
 * ## The one ordering that matters
 *
 * Objects first, manifest second. If a put fails the whole publish throws and
 * the manifest is never written, so the next one retries; if the manifest write
 * fails, the next publish sees stale state and rewrites more than it needed to.
 * Both failures cost work. Neither can leave the manifest claiming a file that
 * was never stored, which is the only failure that would be silent.
 *
 * Two publishes overlapping — somebody presses the button while the alarm is
 * running — costs the same kind of work and no more. Both write the same bytes
 * to the same keys, and whichever manifest lands second is the one that stays;
 * if it is the staler of the two, the next publish rewrites a few files that
 * did not need it. The manifest is advisory about what is *already* there, so
 * being behind is only ever expensive.
 */

import { room, roomUrl } from './db';
import { recordDeployment } from './history';
import { claimSubdomain, mapHostname } from './hostnames';
import { forbidden } from './http';
import { liveDocument, renderSite } from './site';
import type { Cre8Document, GeneratedSite, Output } from './render';
import type { Env } from '../types';

/**
 * How long a published page may sit in the edge cache.
 *
 * Short on purpose. `caches.default` is per-colo, so a publish can only purge
 * the colo that served it — every other one has to expire on its own. A long
 * TTL would mean a republished site staying stale in most of the world, which
 * is a far worse failure than an occasional R2 read. `max-age=0` keeps browsers
 * revalidating so a reload is always current.
 *
 * D6 leans on this harder than a manual publish did: a background republish
 * runs wherever the Durable Object lives, which is usually *not* where the
 * reader is, so for most of the world the sixty seconds is the whole story.
 */
export const SITE_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, must-revalidate';

/** Published path → what is at it. Stored as JSON in `projects.site_manifest`. */
export type Manifest = Record<string, string>;

export interface PublishOutcome {
  /** Files of HTML, which is not the number of pages in the document. */
  pageCount: number;
  outputs: Output[];
  /** The whole site, not this publish — what a person means by "how big is it". */
  bytes: number;
  /** Exactly the paths handed to `put`, so a count of zero is a fact. */
  written: string[];
  /** Paths that were on the site and are not any more. */
  removed: string[];
  unchanged: number;
  subdomain: string;
  publishedAt: number;
}

const encoder = new TextEncoder();

/**
 * 64 bits of SHA-256, hex.
 *
 * Short because a thousand-page site stores a thousand of these in one D1 row,
 * and long because the cost of a collision is a stale page that never updates
 * again. At a thousand files the odds of any two colliding are about one in
 * thirty trillion, which is far below the rate at which R2 itself will lose.
 */
async function hashOf(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  let out = '';
  for (let i = 0; i < 8; i++) out += digest[i]!.toString(16).padStart(2, '0');
  return out;
}

/**
 * What an asset contributes to the manifest.
 *
 * The source key, not a hash of the bytes. An uploaded file's name carries the
 * id it was uploaded under, so the bytes at a given published path never
 * change — that is already why they are served `immutable`. Hashing them would
 * mean reading every image out of R2 on every publish to learn something the
 * key already says.
 */
const assetStamp = (key: string) => `key:${key}`;

/* --------------------------------------------------------------------------
 * The manifest
 * ----------------------------------------------------------------------- */

/**
 * What is on the site right now, as best we can know it.
 *
 * A project published before the manifest existed has files and no record of
 * them, and the difference matters: without a starting point, the first
 * republish could never delete an orphan, and pages for records deleted in the
 * meantime would stay up for ever. So the first publish after the upgrade
 * *adopts* what is in the bucket, under a sentinel that matches no hash — every
 * file gets rewritten once, and every orphan gets removed.
 *
 * The listing is capped, and the cap fails safe. Truncating it would hand back
 * a manifest missing real files, and the next step deletes anything in the
 * manifest that is not in the plan — the wrong half to be wrong about. So past
 * the cap this adopts *nothing*, which costs a rewrite and deletes no orphans.
 */
async function currentManifest(env: Env, projectId: string, prefix: string): Promise<Manifest> {
  const row = await env.DB.prepare(`SELECT site_manifest FROM projects WHERE id = ?1`)
    .bind(projectId)
    .first<{ site_manifest: string | null }>();

  if (row?.site_manifest) {
    try {
      const parsed: unknown = JSON.parse(row.site_manifest);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Manifest;
      }
    } catch {
      // Unreadable. Fall through and adopt from the bucket instead — the whole
      // point of this value is to be reconstructible.
    }
  }

  return adoptFromBucket(env, prefix);
}

/** Ceiling on an adoption listing. Above this, adopt nothing; see above. */
const MAX_ADOPTED_KEYS = 5000;

async function adoptFromBucket(env: Env, prefix: string): Promise<Manifest> {
  const adopted: Manifest = {};
  let cursor: string | undefined;

  for (let page = 0; page * 1000 < MAX_ADOPTED_KEYS; page++) {
    const listing = await env.SITES.list({ prefix, cursor, limit: 1000 });
    for (const object of listing.objects) adopted[object.key.slice(prefix.length)] = UNKNOWN;
    if (!listing.truncated) return adopted;
    cursor = listing.cursor;
  }
  return {};
}

/**
 * The value adopted files carry: not a hash, and deliberately impossible to be
 * one, so every adopted path compares as changed exactly once.
 */
const UNKNOWN = '?';

/* --------------------------------------------------------------------------
 * Publishing
 * ----------------------------------------------------------------------- */

export interface PublishOptions {
  /** Where published forms post, and the origin whose edge cache gets purged. */
  apiOrigin: string;
  /** The person who asked. Null when nobody did — see `deployments` below. */
  publishedBy: string | null;
  /**
   * The live document, when the caller already holds it.
   *
   * The room does, and it must pass it: reading it back would mean the room
   * fetching itself, which is a deadlock rather than a round trip.
   */
  document?: Cre8Document | null;
}

/**
 * Publish a project. One implementation, two callers.
 *
 * The route brings a session and a request; the alarm brings neither. Anything
 * that differs between them is a parameter, so there is no second publish path
 * that can drift from this one — which is the same argument the renderer makes
 * about the canvas and the file.
 *
 * Returns null when there is nothing to publish. Throws `RouteError` from the
 * planner when the document asks for something impossible; the callers differ
 * on what to do about that, so it is left to them.
 */
export async function publishSite(
  env: Env,
  projectId: string,
  options: PublishOptions
): Promise<PublishOutcome | null> {
  const document = options.document ?? (await liveDocument(env, projectId));
  if (!document) return null;
  const site = await renderSite(env, projectId, options.apiOrigin, document);

  const prefix = `${projectId}/`;
  const previous = await currentManifest(env, projectId, prefix);
  const next: Manifest = {};

  /* --- What the site should contain -------------------------------------- */

  const changedFiles: { path: string; contents: string }[] = [];
  for (const file of site.files) {
    guard(file.path, 'file');
    const hash = await hashOf(file.contents);
    next[file.path] = hash;
    if (previous[file.path] !== hash) changedFiles.push(file);
  }

  const changedAssets: typeof site.assets = [];
  for (const asset of site.assets) {
    guard(asset.path, 'asset');
    // A designer can paste another project's asset URL into a style, and
    // publishing must not be a way to lift someone else's uploads into a
    // public bucket. The keys are scraped from the project's own document now
    // rather than sent by a client, which removes most of the reason for this
    // check — but not that one.
    if (!asset.key.startsWith(prefix)) {
      throw forbidden('That asset belongs to another project');
    }
    const stamp = assetStamp(asset.key);
    next[asset.path] = stamp;
    if (previous[asset.path] !== stamp) changedAssets.push(asset);
  }

  /* --- Write it ----------------------------------------------------------- */

  const written: string[] = [];

  await Promise.all(
    changedFiles.map((file) =>
      env.SITES.put(prefix + file.path, file.contents, {
        httpMetadata: {
          contentType: contentTypeFor(file.path),
          cacheControl: SITE_CACHE_CONTROL,
        },
      })
    )
  );
  written.push(...changedFiles.map((file) => file.path));

  /* Uploaded assets are copied bucket-to-bucket rather than re-uploaded:
     nobody ever held these bytes outside R2. The copy is what makes a published
     site readable without a session — `/api/assets/*` is authenticated by
     design, and a visitor has no account.

     Unchanged ones are not read at all, which is the saving that matters here:
     a republish of a photo-heavy site otherwise streams every image through the
     Worker to store bytes that are already stored. */
  for (const asset of changedAssets) {
    const object = await env.UPLOADS.get(asset.key);
    if (!object) {
      // Referenced but deleted. The page degrades and the publish does not
      // fail — but the manifest must not claim a file it did not store, or the
      // asset would never be retried if the upload came back.
      //
      // Unless something is already published at that path, which happens
      // after an adoption: dropping the entry would put the path in `removed`
      // and delete a perfectly good image because its original went missing.
      if (asset.path in previous) next[asset.path] = previous[asset.path]!;
      else delete next[asset.path];
      continue;
    }
    await env.SITES.put(prefix + asset.path, object.body, {
      httpMetadata: {
        contentType: object.httpMetadata?.contentType ?? contentTypeFor(asset.path),
        // Asset filenames carry an upload id, so the bytes at a given path
        // never change and a long cache is safe.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    written.push(asset.path);
  }

  /* --- Take away what is no longer part of the site ----------------------- */

  const removed = Object.keys(previous).filter((path) => !(path in next));
  for (const path of removed) guard(path, 'stored');
  // R2 takes at most a thousand keys per call, and a site that dropped a whole
  // paginated route can exceed that in one go.
  for (let i = 0; i < removed.length; i += 1000) {
    await env.SITES.delete(removed.slice(i, i + 1000).map((path) => prefix + path));
  }

  /* --- Record it ---------------------------------------------------------- */

  await env.DB.prepare(`UPDATE projects SET site_manifest = ?1 WHERE id = ?2`)
    .bind(JSON.stringify(next), projectId)
    .run();

  const project = await env.DB.prepare(`SELECT name, subdomain FROM projects WHERE id = ?1`)
    .bind(projectId)
    .first<{ name: string; subdomain: string | null }>();

  // First publish is when a project earns an address — not creation, since most
  // projects are never published and would just be squatting on names.
  const subdomain = project?.subdomain ?? (await claimSubdomain(env, projectId, project?.name ?? ''));
  await mapHostname(env, subdomain, projectId);

  const bytes = await siteBytes(env, projectId, site);
  const publishedAt = Date.now();

  // A deployment row is written when something changed, or when a person asked
  // for one. An automatic republish that found nothing to do is not a
  // deployment, and filling the history with them would make the history
  // useless for the thing it is for.
  if (written.length || removed.length || options.publishedBy) {
    await recordDeployment(env, projectId, {
      publishedBy: options.publishedBy,
      publishedAt,
      pageCount: site.pageCount,
      bytes,
      prefix,
      written: written.length,
      removed: removed.length,
      unchanged: Object.keys(next).length - written.length,
      // What makes a version: a design somebody published. An automatic
      // republish is the same design carrying newer rows, and storing a copy
      // of it per record edit would fill the history with duplicates of the
      // thing you already have. Because a design change never republishes on
      // its own, this still captures every design the site has ever served.
      document: options.publishedBy ? document : null,
    });
  }

  // Publishing mutates something already cached at the edge. Without this,
  // republishing and reloading shows the previous version — and only the paths
  // that moved need it, which on a typo fix is one file rather than a thousand.
  await purgeSitePaths(options.apiOrigin, projectId, [...written, ...removed]);

  return {
    pageCount: site.pageCount,
    outputs: site.outputs,
    bytes,
    written,
    removed,
    unchanged: Object.keys(next).length - written.length,
    subdomain,
    publishedAt,
  };
}

/**
 * A path is a key here, so anything that could climb out of the project's
 * prefix is refused rather than sanitised into something surprising. The
 * generator does not produce such a path — a page slug is slugged — but the
 * cost of checking is a string scan and the cost of not is the whole bucket.
 *
 * Applied to stored paths as well as generated ones. Those come from our own
 * manifest, but they are the ones handed to `delete`, and that is the direction
 * where being wrong is unrecoverable.
 */
function guard(path: string, kind: string): void {
  if (path.includes('..') || path.startsWith('/') || !path) {
    throw new Error(`Unsafe ${kind} path: ${path}`);
  }
}

/**
 * How big the published site is — every file plus every image it serves.
 *
 * Asset sizes come from the `assets` table rather than from R2, because the
 * whole point of the diff is that most publishes never open those objects.
 * The row is written at upload time from the file's own size, so it is exact
 * rather than an estimate.
 */
async function siteBytes(env: Env, projectId: string, site: GeneratedSite): Promise<number> {
  let bytes = site.files.reduce((sum, file) => sum + file.bytes, 0);
  if (!site.assets.length) return bytes;

  const { results } = await env.DB.prepare(
    `SELECT r2_key, bytes FROM assets WHERE project_id = ?1`
  )
    .bind(projectId)
    .all<{ r2_key: string; bytes: number | null }>();

  const sizes = new Map(results.map((row) => [row.r2_key, row.bytes ?? 0]));
  for (const asset of site.assets) bytes += sizes.get(asset.key) ?? 0;
  return bytes;
}

/* --------------------------------------------------------------------------
 * Republishing on change
 * ----------------------------------------------------------------------- */

/**
 * Has this project ever been published?
 *
 * The question a background republish has to ask before doing anything. A
 * project nobody has published has no site, and writing one on the strength of
 * a record edit would put a design on the internet that its author never chose
 * to put there — including the address it would claim.
 *
 * Read from `deployments` rather than from the manifest, so that a project
 * published before the manifest existed is still recognised as published.
 */
export async function hasBeenPublished(env: Env, projectId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM deployments WHERE project_id = ?1 LIMIT 1`)
    .bind(projectId)
    .first<{ ok: number }>();
  return Boolean(row);
}

/**
 * Tell a project's room that its content moved.
 *
 * Every record write calls this, and it is deliberately the cheapest thing in
 * the request: it arms a timer and returns. The publish happens later, off the
 * back of a Durable Object alarm, so a burst of edits — reordering ten rows,
 * deleting a handful — costs one republish rather than ten.
 *
 * Awaited rather than fired and forgotten. It is one round trip to an object
 * that is already awake (you cannot edit a record without the editor open), and
 * the alternative is a promise the runtime is free to cancel the moment the
 * response goes out — which would make the site update most of the time.
 */
export async function contentChanged(
  env: Env,
  projectId: string,
  apiOrigin: string
): Promise<void> {
  try {
    await room(env, projectId).fetch(roomUrl(projectId, 'content-changed'), {
      method: 'POST',
      body: JSON.stringify({ apiOrigin }),
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    // The record itself is saved either way. Losing the ping costs an update
    // to the live site, which is worth a log line and is not worth failing a
    // write somebody already completed.
    console.error('[publish] could not schedule a republish', error);
  }
}

/* --------------------------------------------------------------------------
 * The edge cache
 * ----------------------------------------------------------------------- */

/**
 * Every URL that resolves to a published file, so all of them can be purged.
 *
 * Mirrors the path handling in `serveSite`: `about/index.html` is reachable as
 * `/about`, `/about/` and `/about/index.html`, and any of those could be the
 * one sitting in the cache.
 */
export function publishedUrls(origin: string, projectId: string, filePath: string): string[] {
  const base = `${origin}/s/${projectId}/`;
  const urls = [base + filePath];
  if (filePath === 'index.html') {
    urls.push(base);
  } else if (filePath.endsWith('/index.html')) {
    const dir = filePath.slice(0, -'/index.html'.length);
    urls.push(`${base}${dir}`, `${base}${dir}/`);
  }
  return urls;
}

async function purgeSitePaths(origin: string, projectId: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const cache = caches.default;
  await Promise.all(
    paths
      .flatMap((path) => publishedUrls(origin, projectId, path))
      .map((url) => cache.delete(url).catch(() => false))
  );
}

export function contentTypeFor(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
