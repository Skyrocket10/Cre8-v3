/**
 * Cre8 — one Worker, one origin.
 *
 * Serves three things:
 *
 *   /api/*   accounts and teams in D1, uploads in R2, one Durable Object per
 *            project for live collaboration
 *   /s/*     published sites, as finished HTML read straight from R2
 *   /*       the editor itself, a static Next export
 *
 * The editor is not served by this code. Cloudflare's asset router answers any
 * request that matches a file in `out/` before the Worker is invoked at all, so
 * loading the app costs nothing; the handler below only runs for the two API
 * prefixes and for paths that match no asset.
 *
 * Sharing an origin is what lets the editor call the API with no CORS
 * allowlist, no build-time URL and a `SameSite=Lax` cookie. It also means
 * published pages — which can contain author-supplied `<script>` — would
 * otherwise run on the editor's origin with the reader's session attached.
 * `serveSite` sandboxes them into an opaque origin so they cannot.
 *
 * Deploy:
 *   npm run db:init
 *   npx wrangler secret put AUTH_PEPPER
 *   npm run deploy
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
import { handleFormSubmission, listSubmissions } from './routes/forms';
import {
  contentTypeFor,
  handleDeleteProject,
  handleGetProject,
  handleListProjects,
  handlePublish,
  handleSaveProject,
  handleSetSubdomain,
  handleSocket,
  SITE_CACHE_CONTROL,
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

    // Ahead of the CSRF check and the AUTH_PEPPER guard on purpose. A
    // published page runs no script, so its form posts natively — no custom
    // header, no session, no account. See routes/forms.ts for why that is
    // safe here and what is defended instead.
    if (url.pathname.startsWith('/api/f/')) {
      try {
        return await handleFormSubmission(request, env, url);
      } catch (error) {
        return errorResponse(error, {});
      }
    }

    // Not ours. The asset router already declined it, so this is a real 404 —
    // hand back the editor's own 404 page rather than a bare string.
    if (!url.pathname.startsWith('/api/')) return notFoundPage(request, env);

    try {
      if (!env.AUTH_PEPPER) {
        throw badRequest(
          'Server not configured',
          'AUTH_PEPPER is unset. Run: npx wrangler secret put AUTH_PEPPER'
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
  } else if (section === 'subdomain' && method === 'PUT') {
    return handleSetSubdomain(request, env, projectId, user, cors);
  } else if (section === 'submissions' && method === 'GET') {
    return handleListSubmissions(env, projectId, user, cors);
  } else if (section === 'socket') {
    // A 101 upgrade carries no CORS headers, so this one skips them.
    return handleSocket(env, projectId, user);
  }

  throw notFound();
}

/** Reading a project's submissions needs the same access as editing it. */
async function handleListSubmissions(
  env: Env,
  projectId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireProjectAccess(env, projectId, user, 'viewer');
  return json({ submissions: await listSubmissions(env, projectId) }, 200, cors);
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
    await env.UPLOADS.put(key, file.stream(), {
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

    const object = await env.UPLOADS.get(key);
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

/**
 * Sandbox for published pages.
 *
 * A published page is author-supplied HTML — `settings.customHead` and the
 * rich-text block both pass through verbatim — and it is served from the same
 * origin as the editor. Without this header, a script on someone's published
 * page would run *as the editor origin* in the browser of any signed-in Cre8
 * user who visited it, and could call /api/* with their session cookie
 * attached. Publishing a site would be equivalent to account takeover.
 *
 * `sandbox` without `allow-same-origin` forces the document into an opaque
 * origin: no access to the editor's cookies, localStorage or IndexedDB, and
 * requests it makes are cross-site, so the `SameSite=Lax` session cookie is not
 * attached either. The three `allow-` tokens are what an ordinary marketing
 * page still needs — analytics snippets, form posts, and links that navigate.
 *
 * Serving published sites from their own hostname is stronger still, and the
 * commented-out route in wrangler.jsonc is how. This is the defence that holds
 * when they share one.
 */
const SITE_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-top-navigation';

async function serveSite(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Internal links in a published page are relative, so that the same bytes
  // work here, on a site's own domain, and unzipped on a desktop. Relative
  // resolution depends on the trailing slash — from `/s/x/plans` a link to
  // `pricing/` lands on `/s/x/pricing/`'s parent — so the directory form is
  // canonical and everything else redirects to it.
  const canonical = canonicalSitePath(url.pathname);
  if (canonical) return Response.redirect(new URL(canonical + url.search, url).toString(), 301);

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
      'cache-control': SITE_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
      'content-security-policy': SITE_SANDBOX,
    },
  });

  ctx.waitUntil(cache.put(url.toString(), response.clone()));
  return response;
}

/**
 * The directory form of a site path, or null if it is already canonical.
 *
 * A request for a file (anything with an extension) is left alone; a request
 * for a page gets a trailing slash.
 */
export function canonicalSitePath(pathname: string): string | null {
  if (pathname.endsWith('/')) return null;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (last.includes('.')) return null;
  return `${pathname}/`;
}

/* --------------------------------------------------------------------------
 * Editor
 * ----------------------------------------------------------------------- */

/**
 * The editor's 404 page.
 *
 * Assets are configured with `not_found_handling: "none"` so that unmatched
 * paths reach this Worker instead of being answered by the asset router — which
 * would otherwise intercept /api/* too. The cost is that the 404 page is ours
 * to serve, which is this.
 */
async function notFoundPage(request: Request, env: Env): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL('/404.html', request.url));
  if (!page.ok) return new Response('Not found', { status: 404 });
  return new Response(page.body, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
}
