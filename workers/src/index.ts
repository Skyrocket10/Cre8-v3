/**
 * Cre8 API Worker.
 *
 * Accounts and teams in D1, assets and published sites in R2, and one Durable
 * Object per project for live collaboration.
 *
 * Published pages are the highest-volume path and are matched before anything
 * else: they are finished HTML written at publish time, so serving one is a
 * cache hit or an R2 read with no rendering and no database work.
 *
 * Deploy:
 *   npm run db:init
 *   npx wrangler secret put AUTH_PEPPER --config workers/wrangler.toml
 *   npm run deploy:api
 */

import { newId } from './lib/crypto';
import { requireProjectAccess, userForToken } from './lib/db';
import {
  badRequest,
  corsHeaders,
  errorResponse,
  json,
  notFound,
  readCookie,
  requireCsrfHeader,
  SESSION_COOKIE,
  unauthorised,
} from './lib/http';
import { handleMe, handleSignIn, handleSignOut, handleSignUp } from './routes/auth';
import {
  contentTypeFor,
  handleDeleteProject,
  handleGetProject,
  handleListProjects,
  handlePublish,
  handleSaveProject,
  handleSocket,
} from './routes/projects';
import {
  handleAcceptInvite,
  handleCreateInvite,
  handleCreateTeam,
  handleListMembers,
  handleListTeams,
  handlePeekInvite,
  handleRemoveMember,
  handleRevokeInvite,
  handleUpdateMember,
} from './routes/teams';
import type { Env, SessionUser } from './types';

export { ProjectRoom } from './room';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname.startsWith('/s/')) return serveSite(url, env, ctx);

    if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404, cors);

    try {
      if (!env.AUTH_PEPPER) {
        throw badRequest(
          'Server not configured',
          'AUTH_PEPPER is unset. Run: wrangler secret put AUTH_PEPPER --config workers/wrangler.toml'
        );
      }

      // The CORS allowlist is what makes this check a real CSRF defence —
      // see the note in lib/http.ts.
      requireCsrfHeader(request);

      const response = await route(request, env, url);

      // A 101 upgrade is returned with immutable headers, and CORS does not
      // apply to WebSockets anyway — writing to it throws and takes the
      // handshake down with it.
      if (response.status !== 101 && !response.webSocket) {
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      }
      return response;
    } catch (error) {
      return errorResponse(error, cors);
    }
  },
};

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const cors: Record<string, string> = {};
  const method = request.method;
  const head = parts[0];

  /* --- Unauthenticated -------------------------------------------------- */

  if (head === 'auth') {
    const action = parts[1];
    if (action === 'signup' && method === 'POST') return handleSignUp(request, env, cors);
    if (action === 'signin' && method === 'POST') return handleSignIn(request, env, cors);
    if (action === 'signout' && method === 'POST') return handleSignOut(request, env, cors);
  }

  // Peeking at an invite is deliberately open: the recipient has to see who
  // invited them before deciding whether to create an account.
  if (head === 'invites' && parts[1] && method === 'GET') {
    return handlePeekInvite(env, parts[1], cors);
  }

  const user = await userForToken(env, readCookie(request, SESSION_COOKIE));

  if (head === 'auth' && parts[1] === 'me' && method === 'GET') {
    return handleMe(env, user, cors);
  }

  /* --- Everything below needs an account -------------------------------- */

  if (!user) throw unauthorised();

  if (head === 'teams') return teamRoutes(request, env, parts, user, cors, method);
  if (head === 'invites' && parts[1] === 'accept' && method === 'POST') {
    return handleAcceptInvite(request, env, user, cors);
  }
  if (head === 'projects') return projectRoutes(request, env, parts, user, cors, method);
  if (head === 'assets') return assetRoutes(request, env, parts, user, cors, method);

  throw notFound();
}

function teamRoutes(
  request: Request,
  env: Env,
  parts: string[],
  user: SessionUser,
  cors: Record<string, string>,
  method: string
): Promise<Response> {
  const [, teamId, section, memberId] = parts;

  if (!teamId) {
    if (method === 'GET') return handleListTeams(env, user, cors);
    if (method === 'POST') return handleCreateTeam(request, env, user, cors);
  } else if (section === 'members') {
    if (!memberId && method === 'GET') return handleListMembers(env, teamId, user, cors);
    if (memberId && method === 'PATCH') {
      return handleUpdateMember(request, env, teamId, memberId, user, cors);
    }
    if (memberId && method === 'DELETE') {
      return handleRemoveMember(env, teamId, memberId, user, cors);
    }
  } else if (section === 'invites') {
    if (!memberId && method === 'POST') return handleCreateInvite(request, env, teamId, user, cors);
    if (memberId && method === 'DELETE') {
      return handleRevokeInvite(env, teamId, memberId, user, cors);
    }
  }

  throw notFound();
}

function projectRoutes(
  request: Request,
  env: Env,
  parts: string[],
  user: SessionUser,
  cors: Record<string, string>,
  method: string
): Promise<Response> {
  const [, projectId, section] = parts;

  if (!projectId) {
    if (method === 'GET') return handleListProjects(request, env, user, cors);
    if (method === 'POST') return handleSaveProject(request, env, user, cors);
  } else if (!section) {
    if (method === 'GET') return handleGetProject(env, projectId, user, cors);
    if (method === 'DELETE') return handleDeleteProject(env, projectId, user, cors);
  } else if (section === 'publish' && method === 'POST') {
    return handlePublish(request, env, projectId, user, cors);
  } else if (section === 'socket') {
    // A 101 upgrade carries no CORS headers, so this one skips them.
    return handleSocket(env, projectId, user);
  }

  throw notFound();
}

async function assetRoutes(
  request: Request,
  env: Env,
  parts: string[],
  user: SessionUser,
  cors: Record<string, string>,
  method: string
): Promise<Response> {
  if (method === 'POST' && parts.length === 1) {
    const form = await request.formData();
    const file = form.get('file');
    const projectId = String(form.get('projectId') ?? '');
    if (!(file instanceof File) || !projectId) throw badRequest('Missing file or project');

    await requireProjectAccess(env, projectId, user, 'editor');

    const id = newId();
    const key = `${projectId}/${id}-${sanitise(file.name)}`;
    await env.ASSETS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    await env.DB.prepare(
      `INSERT INTO assets (id, project_id, name, type, r2_key, bytes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
      .bind(id, projectId, file.name, file.type, key, file.size, Date.now())
      .run();

    return json({ id, url: `/api/assets/${encodeURIComponent(key)}` }, 200, cors);
  }

  if (method === 'GET' && parts.length > 1) {
    const key = decodeURIComponent(parts.slice(1).join('/'));
    const projectId = key.split('/')[0] ?? '';
    await requireProjectAccess(env, projectId, user, 'viewer');

    const object = await env.ASSETS.get(key);
    if (!object) throw notFound();
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        // Private: an asset key is guessable from a published page, and this
        // endpoint is the authenticated one.
        'cache-control': 'private, max-age=31536000, immutable',
        ...cors,
      },
    });
  }

  throw notFound();
}

/* --------------------------------------------------------------------------
 * Published sites
 * ----------------------------------------------------------------------- */

async function serveSite(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cached = await cache.match(url.toString());
  if (cached) return cached;

  const [, , projectId, ...rest] = url.pathname.split('/');
  if (!projectId) return new Response('Not found', { status: 404 });

  const path = rest.filter(Boolean).join('/');
  const file = path === '' ? 'index.html' : path.includes('.') ? path : `${path}/index.html`;

  const object = await env.SITES.get(`${projectId}/${file}`);
  if (!object) return new Response('Not found', { status: 404 });

  const response = new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? contentTypeFor(file),
      'cache-control': 'public, max-age=60, s-maxage=31536000',
      'x-content-type-options': 'nosniff',
    },
  });

  ctx.waitUntil(cache.put(url.toString(), response.clone()));
  return response;
}

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
}
