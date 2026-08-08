/**
 * Project routes.
 *
 * Documents are read and written through the project's room rather than
 * straight from D1. The room is the only writer, so an HTTP save and a live
 * collaborator can never race each other into two different versions.
 */

import { newId } from '../lib/crypto';
import { requireProjectAccess, requireTeamRole } from '../lib/db';
import { badRequest, conflict, forbidden, json, notFound, readJson } from '../lib/http';
import type { Env, SessionUser } from '../types';

/** Anything the client sends is untrusted; only the shape we rely on is checked. */
interface DocumentBody {
  id?: unknown;
  name?: unknown;
  pages?: unknown;
  teamId?: unknown;
}

function room(env: Env, projectId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(projectId));
}

function roomUrl(projectId: string, path: string): string {
  return `https://room/${path}?project=${encodeURIComponent(projectId)}`;
}

export async function handleListProjects(
  request: Request,
  env: Env,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const teamId = new URL(request.url).searchParams.get('team');

  // Scoped to one team when asked, otherwise every team the caller belongs to.
  const query = teamId
    ? env.DB.prepare(
        `SELECT p.id, p.name, p.page_count, p.created_at, p.updated_at, p.team_id
           FROM projects p
           JOIN team_members m ON m.team_id = p.team_id AND m.user_id = ?2
          WHERE p.team_id = ?1
          ORDER BY p.updated_at DESC LIMIT 200`
      ).bind(teamId, user.id)
    : env.DB.prepare(
        `SELECT p.id, p.name, p.page_count, p.created_at, p.updated_at, p.team_id
           FROM projects p
           JOIN team_members m ON m.team_id = p.team_id AND m.user_id = ?1
          ORDER BY p.updated_at DESC LIMIT 200`
      ).bind(user.id);

  const { results } = await query.all<{
    id: string;
    name: string;
    page_count: number;
    created_at: number;
    updated_at: number;
    team_id: string;
  }>();

  return json(
    {
      projects: results.map((r) => ({
        id: r.id,
        name: r.name,
        pageCount: r.page_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        teamId: r.team_id,
      })),
    },
    200,
    cors
  );
}

export async function handleSaveProject(
  request: Request,
  env: Env,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const doc = await readJson<DocumentBody>(request);
  if (typeof doc.id !== 'string' || typeof doc.name !== 'string') {
    throw badRequest('Malformed project document');
  }

  const pageCount = Array.isArray(doc.pages) ? doc.pages.length : 1;
  const existing = await env.DB.prepare(`SELECT team_id FROM projects WHERE id = ?1`)
    .bind(doc.id)
    .first<{ team_id: string }>();

  if (!existing) {
    // Creating. The caller picks the team and must be able to edit in it.
    const teamId = typeof doc.teamId === 'string' ? doc.teamId : null;
    if (!teamId) throw badRequest('A new project needs a team');
    await requireTeamRole(env, teamId, user, 'editor');

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO projects (id, team_id, created_by, name, document, page_count, version, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)`
    )
      .bind(doc.id, teamId, user.id, doc.name, JSON.stringify(doc), pageCount, now)
      .run();

    return json({ ok: true, version: 0, updatedAt: now }, 200, cors);
  }

  await requireProjectAccess(env, doc.id, user, 'editor');

  // Through the room, so a live session sees the replacement immediately and
  // the version stays authoritative.
  const response = await room(env, doc.id).fetch(roomUrl(doc.id, 'document'), {
    method: 'POST',
    body: JSON.stringify({ document: doc }),
    headers: { 'content-type': 'application/json' },
  });
  const { version } = (await response.json()) as { version: number };

  await env.DB.prepare(`UPDATE projects SET name = ?1 WHERE id = ?2`).bind(doc.name, doc.id).run();
  return json({ ok: true, version, updatedAt: Date.now() }, 200, cors);
}

export async function handleGetProject(
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const { role } = await requireProjectAccess(env, projectId, user, 'viewer');

  const response = await room(env, projectId).fetch(roomUrl(projectId, 'document'));
  const { document, version } = (await response.json()) as {
    document: unknown;
    version: number;
  };
  if (!document) throw notFound('Project not found');

  const row = await env.DB.prepare(`SELECT subdomain FROM projects WHERE id = ?1`)
    .bind(projectId)
    .first<{ subdomain: string | null }>();

  return json(
    {
      document,
      version,
      role,
      subdomain: row?.subdomain ?? null,
      siteDomain: env.PUBLIC_SITE_DOMAIN ?? '',
    },
    200,
    cors
  );
}

export async function handleDeleteProject(
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'admin');

  // Stop the hostname resolving before the project goes, so a deleted site
  // cannot keep answering from someone else's address.
  const row = await env.DB.prepare(`SELECT subdomain FROM projects WHERE id = ?1`)
    .bind(projectId)
    .first<{ subdomain: string | null }>();
  if (row?.subdomain && env.PUBLIC_SITE_DOMAIN) {
    await env.SITE_ROUTES.delete(
      `${row.subdomain}.${env.PUBLIC_SITE_DOMAIN}`.toLowerCase()
    ).catch(() => undefined);
  }

  await env.DB.prepare(`DELETE FROM projects WHERE id = ?1`).bind(projectId).run();
  return json({ ok: true }, 200, cors);
}

/* --------------------------------------------------------------------------
 * Site addresses
 * ----------------------------------------------------------------------- */

const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'cdn', 'assets', 'static', 'mail', 'ftp',
  'dashboard', 'status', 'docs', 'blog', 'help', 'support', 'cre8',
]);

/**
 * Turn a project name into a hostname label.
 *
 * Deliberately narrow: lowercase, digits and single hyphens. Anything else and
 * the label either fails DNS or renders differently to how it reads, which for
 * something people will type is worse than being strict.
 */
export function slugifySubdomain(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function subdomainProblem(value: string): string | null {
  if (value.length < 3) return 'At least 3 characters';
  if (value.length > 40) return 'At most 40 characters';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return 'Lowercase letters, numbers and hyphens only';
  }
  if (RESERVED.has(value)) return 'That name is reserved';
  return null;
}

/**
 * Claim a hostname label for a project, retrying past collisions.
 *
 * The unique index is the real arbiter — two people publishing similarly named
 * projects at the same moment both pass a `SELECT` check, and only the write
 * can settle it. So the insert is what we retry on, not the lookup.
 */
async function claimSubdomain(env: Env, projectId: string, preferred: string): Promise<string> {
  const base = slugifySubdomain(preferred) || 'site';
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    if (subdomainProblem(candidate)) continue;
    try {
      const { meta } = await env.DB.prepare(
        `UPDATE projects SET subdomain = ?1 WHERE id = ?2 AND subdomain IS NULL`
      )
        .bind(candidate, projectId)
        .run();
      if (meta.changes > 0) return candidate;
      // Already had one; whatever it is, that is the answer.
      const row = await env.DB.prepare(`SELECT subdomain FROM projects WHERE id = ?1`)
        .bind(projectId)
        .first<{ subdomain: string | null }>();
      if (row?.subdomain) return row.subdomain;
    } catch {
      // Unique-index collision. Try again with a suffix.
    }
  }
  // Fall back to something that cannot collide.
  await env.DB.prepare(`UPDATE projects SET subdomain = ?1 WHERE id = ?2`)
    .bind(projectId, projectId)
    .run();
  return projectId;
}

function randomSuffix(): string {
  return Math.abs(
    [...crypto.getRandomValues(new Uint8Array(3))].reduce((a, b) => a * 256 + b, 0)
  )
    .toString(36)
    .slice(0, 4);
}

/** Point a hostname at a project, so the sites Worker needs no database. */
async function mapHostname(env: Env, subdomain: string, projectId: string): Promise<void> {
  if (!env.PUBLIC_SITE_DOMAIN) return;
  await env.SITE_ROUTES.put(`${subdomain}.${env.PUBLIC_SITE_DOMAIN}`.toLowerCase(), projectId);
}

export async function handleSetSubdomain(
  request: Request,
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'editor');

  const body = await readJson<{ subdomain?: unknown }>(request);
  const wanted = typeof body.subdomain === 'string' ? body.subdomain.trim().toLowerCase() : '';
  const problem = subdomainProblem(wanted);
  if (problem) throw badRequest(problem);

  const current = await env.DB.prepare(`SELECT subdomain FROM projects WHERE id = ?1`)
    .bind(projectId)
    .first<{ subdomain: string | null }>();

  if (current?.subdomain === wanted) return json({ subdomain: wanted }, 200, cors);

  try {
    await env.DB.prepare(`UPDATE projects SET subdomain = ?1 WHERE id = ?2`)
      .bind(wanted, projectId)
      .run();
  } catch {
    throw conflict('That address is taken');
  }

  await mapHostname(env, wanted, projectId);
  // The old hostname must stop resolving, or the site stays reachable at an
  // address its owner believes they have given up.
  if (current?.subdomain && env.PUBLIC_SITE_DOMAIN) {
    await env.SITE_ROUTES.delete(
      `${current.subdomain}.${env.PUBLIC_SITE_DOMAIN}`.toLowerCase()
    ).catch(() => undefined);
  }

  return json({ subdomain: wanted }, 200, cors);
}

export async function handlePublish(
  request: Request,
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'editor');

  const body = await readJson<{
    files?: { path: string; contents: string }[];
    assets?: { key: string; path: string }[];
  }>(request);
  if (!Array.isArray(body.files) || body.files.length === 0) throw badRequest('Nothing to publish');

  const prefix = `${projectId}/`;
  let bytes = 0;

  await Promise.all(
    body.files.map((file) => {
      // A path is a key here, so anything that could climb out of the prefix
      // has to be refused rather than sanitised into something surprising.
      if (file.path.includes('..') || file.path.startsWith('/')) {
        throw badRequest(`Unsafe file path: ${file.path}`);
      }
      bytes += file.contents.length;
      return env.SITES.put(prefix + file.path, file.contents, {
        httpMetadata: {
          contentType: contentTypeFor(file.path),
          cacheControl: SITE_CACHE_CONTROL,
        },
      });
    })
  );

  /* --- Uploaded assets ---------------------------------------------------
     Copied bucket-to-bucket rather than re-uploaded: the browser only ever
     held a URL for these. The copy is what makes a published site readable
     without a session — `/api/assets/*` is authenticated by design, and a
     visitor has no account. */
  for (const asset of body.assets ?? []) {
    if (asset.path.includes('..') || asset.path.startsWith('/')) {
      throw badRequest(`Unsafe asset path: ${asset.path}`);
    }
    // The key names an object in someone's uploads bucket, and it arrives from
    // the client. Without this, publishing a project would be a way to read any
    // other project's files.
    if (!asset.key.startsWith(prefix)) {
      throw forbidden('That asset belongs to another project');
    }

    const object = await env.UPLOADS.get(asset.key);
    if (!object) continue; // Referenced but deleted; the page degrades, publish does not fail.

    bytes += object.size;
    await env.SITES.put(prefix + asset.path, object.body, {
      httpMetadata: {
        contentType: object.httpMetadata?.contentType ?? contentTypeFor(asset.path),
        // Asset filenames carry an upload id, so the bytes at a given path
        // never change and a long cache is safe.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  // Publishing is a mutation of something already cached at the edge. Without
  // this, hitting Publish and reloading shows the previous version.
  await purgePublished(request, projectId, body.files.map((f) => f.path));

  const project = await env.DB.prepare(`SELECT name, subdomain FROM projects WHERE id = ?1`)
    .bind(projectId)
    .first<{ name: string; subdomain: string | null }>();

  // First publish is when a project earns an address — not creation, since most
  // projects are never published and would just be squatting on names.
  const subdomain = project?.subdomain ?? (await claimSubdomain(env, projectId, project?.name ?? ''));
  await mapHostname(env, subdomain, projectId);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO deployments (id, project_id, published_by, published_at, page_count, bytes, r2_prefix)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(newId(), projectId, user.id, now, body.files.length, bytes, prefix)
    .run();

  return json(
    {
      ok: true,
      publishedAt: now,
      bytes,
      subdomain,
      siteDomain: env.PUBLIC_SITE_DOMAIN ?? '',
      // Absolute once a site domain is configured; the same-origin fallback
      // otherwise, so a one-Worker deploy still has somewhere to point.
      url: env.PUBLIC_SITE_DOMAIN
        ? `https://${subdomain}.${env.PUBLIC_SITE_DOMAIN}/`
        : `/s/${projectId}/`,
    },
    200,
    cors
  );
}

/**
 * How long a published page may sit in the edge cache.
 *
 * Short on purpose. `caches.default` is per-colo, so a publish can only purge
 * the colo that served it — every other one has to expire on its own. A long
 * TTL would mean a republished site staying stale in most of the world, which
 * is a far worse failure than an occasional R2 read. `max-age=0` keeps browsers
 * revalidating so a reload is always current.
 */
export const SITE_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, must-revalidate';

/**
 * Every URL that resolves to a published file, so all of them can be purged.
 *
 * Mirrors the path handling in `serveSite`: `about/index.html` is reachable as
 * `/about`, `/about/` and `/about/index.html`, and any of those could be the
 * one sitting in the cache.
 */
function publishedUrls(origin: string, projectId: string, filePath: string): string[] {
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

async function purgePublished(request: Request, projectId: string, paths: string[]): Promise<void> {
  const origin = new URL(request.url).origin;
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

/**
 * Authorise, then hand the upgrade to the room.
 *
 * The role travels with the connection: the room refuses patches from a peer
 * that wasn't granted edit rights here, so view-only access is enforced on the
 * server rather than by hiding buttons.
 */
export async function handleSocket(
  env: Env,
  projectId: string,
  user: SessionUser
): Promise<Response> {
  const { role } = await requireProjectAccess(env, projectId, user, 'viewer');

  const params = new URLSearchParams({
    project: projectId,
    uid: user.id,
    name: user.name,
    hue: String(user.avatarHue),
    edit: role === 'viewer' ? '0' : '1',
  });

  return room(env, projectId).fetch(`https://room/socket?${params}`, {
    headers: { upgrade: 'websocket' },
  });
}
