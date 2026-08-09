/**
 * Project routes.
 *
 * Documents are read and written through the project's room rather than
 * straight from D1. The room is the only writer, so an HTTP save and a live
 * collaborator can never race each other into two different versions.
 */

import { requireProjectAccess, requireTeamRole, room, roomUrl } from '../lib/db';
import {
  mapHostname,
  subdomainProblem,
  unmapHostname,
} from '../lib/hostnames';
import { badRequest, conflict, json, notFound, readJson } from '../lib/http';
import { publishSite } from '../lib/publish';
import { RouteError } from '../lib/render';
import type { Env, SessionUser } from '../types';

/** Anything the client sends is untrusted; only the shape we rely on is checked. */
interface DocumentBody {
  id?: unknown;
  name?: unknown;
  pages?: unknown;
  teamId?: unknown;
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
  await unmapHostname(env, row?.subdomain ?? null);

  await env.DB.prepare(`DELETE FROM projects WHERE id = ?1`).bind(projectId).run();
  return json({ ok: true }, 200, cors);
}

/* --------------------------------------------------------------------------
 * Site addresses
 * ----------------------------------------------------------------------- */

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
  await unmapHostname(env, current?.subdomain ?? null);

  return json({ subdomain: wanted }, 200, cors);
}

/**
 * Publish: render here, store here, and only store what moved.
 *
 * The Worker used to be a filing cabinet — the browser generated every byte
 * and POSTed them. That worked, and it is what stood between this project and
 * a collection worth having: expanding a repeater meant the *browser* needed
 * the records, so every publish downloaded whole collections, and nothing on
 * the server could republish when one changed.
 *
 * Now the same renderer the canvas uses runs here, over the live document from
 * the room and the rows from D1. One implementation, bundled twice; the render
 * suite holds the two to byte-identical output.
 *
 * The request body is no longer read. That is the point of D3 and not an
 * oversight: nothing a client sends can decide what a published page contains.
 *
 * What is left in this function is the part that is genuinely about the
 * request: who is allowed, which origin the site should post its forms to, and
 * what to say back. The publish itself is `publishSite`, because a Durable
 * Object alarm runs it too and a second copy would drift.
 */
export async function handlePublish(
  request: Request,
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'editor');

  // Where published forms post. The publish request came from the editor, so
  // its origin *is* the API's — the two share one, which is the whole reason
  // there is no build-time API URL to configure.
  const result = await publishSite(env, projectId, {
    apiOrigin: new URL(request.url).origin,
    publishedBy: user.id,
  }).catch((error) => {
    // A routing problem is the designer's, and the message names what to fix —
    // which page, how many files it wanted, which two collided. Letting it out
    // as a 500 would turn that into "Publishing failed" and a log nobody reads.
    if (error instanceof RouteError) throw badRequest(error.message);
    throw error;
  });
  if (!result) throw badRequest('Nothing to publish');

  return json(
    {
      ok: true,
      publishedAt: result.publishedAt,
      bytes: result.bytes,
      // The editor no longer knows what it published, because it no longer
      // built it — so the counts and the page list come back from here.
      pageCount: result.pageCount,
      // What this publish actually did to the bucket, which since D6 is
      // usually much less than the whole site. Reported rather than inferred:
      // `written` is the very list of paths handed to `put`.
      written: result.written.length,
      removed: result.removed.length,
      unchanged: result.unchanged,
      // Every file, not every page in the document — a dynamic route is one
      // page and thirty of these, and the dialog that lists them should say
      // what is actually on the site.
      pages: result.outputs.map((output) => ({
        slug: output.path === '/' ? '' : output.path.replace(/^\/|\/$/g, ''),
        title: output.page.meta.title || output.page.name,
        path: output.path,
      })),
      subdomain: result.subdomain,
      siteDomain: env.PUBLIC_SITE_DOMAIN ?? '',
      // Absolute once a site domain is configured; the same-origin fallback
      // otherwise, so a one-Worker deploy still has somewhere to point.
      url: env.PUBLIC_SITE_DOMAIN
        ? `https://${result.subdomain}.${env.PUBLIC_SITE_DOMAIN}/`
        : `/s/${projectId}/`,
    },
    200,
    cors
  );
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
