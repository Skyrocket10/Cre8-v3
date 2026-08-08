/**
 * Cre8 API Worker.
 *
 * Three jobs, and deliberately no more:
 *
 *   1. store and retrieve project documents (D1),
 *   2. take asset uploads and hand back a URL (R2),
 *   3. accept a generated static site and serve it (R2 + cache).
 *
 * Rendering never happens here. Publishing uploads finished HTML, so a visitor
 * request is a cache hit or an R2 read — no Worker CPU on the hot path, which
 * is what keeps a site on Cre8 cost roughly nothing to run.
 *
 * Deploy:
 *   wrangler d1 execute cre8 --file=./schema.sql
 *   wrangler deploy
 */

export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  SITES: R2Bucket;
  ALLOWED_ORIGINS: string;
  /**
   * Set to "true" to run single-tenant: every request is treated as the same
   * owner. Fine for a personal instance, never for a shared one — see
   * `ownerFrom` below.
   */
  ALLOW_ANONYMOUS?: string;
}

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  document: string;
  page_count: number;
  created_at: number;
  updated_at: number;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      // Published sites are matched first: they are the highest-volume path and
      // should never fall through the API router.
      if (url.pathname.startsWith('/s/')) return serveSite(url, env, ctx);

      if (url.pathname.startsWith('/api/')) {
        const response = await handleApi(request, env, url);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      console.error('[cre8-api]', error);
      return json({ error: 'Internal error' }, 500, cors);
    }
  },
};

/* --------------------------------------------------------------------------
 * API
 * ----------------------------------------------------------------------- */

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const owner = ownerFrom(request, env);
  if (!owner) {
    return json(
      {
        error: 'Unauthorised',
        detail:
          'No owner identity on the request. Send an x-cre8-owner header, or set ALLOW_ANONYMOUS="true" to run this instance single-tenant.',
      },
      401
    );
  }

  /* /api/projects */
  if (parts[0] === 'projects' && parts.length === 1) {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT id, name, page_count, created_at, updated_at
           FROM projects WHERE owner_id = ?1 ORDER BY updated_at DESC LIMIT 200`
      )
        .bind(owner)
        .all<Omit<ProjectRow, 'document' | 'owner_id'>>();

      return json({
        projects: results.map((row) => ({
          id: row.id,
          name: row.name,
          pageCount: row.page_count,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      });
    }

    if (request.method === 'POST') {
      const doc = (await request.json()) as { id: string; name: string; pages?: unknown[] };
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO projects (id, owner_id, name, document, page_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           document = excluded.document,
           page_count = excluded.page_count,
           updated_at = excluded.updated_at`
      )
        .bind(doc.id, owner, doc.name, JSON.stringify(doc), doc.pages?.length ?? 1, now)
        .run();
      return json({ ok: true, updatedAt: now });
    }
  }

  /* /api/projects/:id */
  if (parts[0] === 'projects' && parts.length === 2) {
    const id = parts[1]!;

    if (request.method === 'GET') {
      const row = await env.DB.prepare(
        `SELECT document FROM projects WHERE id = ?1 AND owner_id = ?2`
      )
        .bind(id, owner)
        .first<{ document: string }>();
      if (!row) return json({ error: 'Not found' }, 404);
      return new Response(row.document, { headers: JSON_HEADERS });
    }

    if (request.method === 'DELETE') {
      await env.DB.prepare(`DELETE FROM projects WHERE id = ?1 AND owner_id = ?2`)
        .bind(id, owner)
        .run();
      return json({ ok: true });
    }
  }

  /* /api/projects/:id/publish */
  if (parts[0] === 'projects' && parts[2] === 'publish' && request.method === 'POST') {
    const projectId = parts[1]!;
    const body = (await request.json()) as {
      files: { path: string; contents: string }[];
    };

    const owns = await env.DB.prepare(
      `SELECT 1 FROM projects WHERE id = ?1 AND owner_id = ?2`
    )
      .bind(projectId, owner)
      .first();
    if (!owns) return json({ error: 'Not found' }, 404);

    const prefix = `${projectId}/`;
    let bytes = 0;

    await Promise.all(
      body.files.map((file) => {
        bytes += file.contents.length;
        return env.SITES.put(prefix + file.path, file.contents, {
          httpMetadata: {
            contentType: contentTypeFor(file.path),
            // Long max-age is safe: publishing writes new content under the
            // same keys and the purge below drops the edge copy.
            cacheControl: 'public, max-age=0, s-maxage=31536000, must-revalidate',
          },
        });
      })
    );

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO deployments (id, project_id, published_at, page_count, bytes, r2_prefix)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
      .bind(crypto.randomUUID(), projectId, now, body.files.length, bytes, prefix)
      .run();

    return json({ ok: true, publishedAt: now, bytes, url: `/s/${projectId}/` });
  }

  /* /api/assets */
  if (parts[0] === 'assets' && request.method === 'POST') {
    const form = await request.formData();
    const file = form.get('file');
    const projectId = String(form.get('projectId') ?? '');
    if (!(file instanceof File) || !projectId) return json({ error: 'Bad request' }, 400);

    const id = crypto.randomUUID();
    const key = `${projectId}/${id}-${sanitise(file.name)}`;
    await env.ASSETS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
    });

    await env.DB.prepare(
      `INSERT INTO assets (id, project_id, name, type, r2_key, bytes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
      .bind(id, projectId, file.name, file.type, key, file.size, Date.now())
      .run();

    return json({ id, url: `/api/assets/${encodeURIComponent(key)}`, name: file.name });
  }

  if (parts[0] === 'assets' && parts.length > 1 && request.method === 'GET') {
    const key = decodeURIComponent(parts.slice(1).join('/'));
    const object = await env.ASSETS.get(key);
    if (!object) return json({ error: 'Not found' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  return json({ error: 'Not found' }, 404);
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
  const key = `${projectId}/${path === '' ? 'index.html' : path.endsWith('.html') || path.includes('.') ? path : `${path}/index.html`}`;

  const object = await env.SITES.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const response = new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=31536000',
      'x-content-type-options': 'nosniff',
    },
  });

  ctx.waitUntil(cache.put(url.toString(), response.clone()));
  return response;
}

/* --------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

/**
 * Turn a request into a stable owner id.
 *
 * This is the single seam a real auth provider plugs into — Cloudflare Access,
 * Supabase, Auth.js — and replacing this function is the whole integration.
 *
 * Until then it fails closed. There is no identity here, so anyone who can
 * reach the API is the same "owner": they would see, edit and delete each
 * other's projects. That is acceptable for a personal instance and a data leak
 * for a shared one, so it has to be switched on deliberately with
 * `ALLOW_ANONYMOUS = "true"` rather than being the accidental default.
 */
function ownerFrom(request: Request, env: Env): string | null {
  const header = request.headers.get('x-cre8-owner')?.trim();
  if (header) return header.slice(0, 128);
  return env.ALLOW_ANONYMOUS === 'true' ? 'local' : null;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-cre8-owner',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
}
