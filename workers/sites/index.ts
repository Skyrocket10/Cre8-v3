/**
 * Published sites.
 *
 * A second Worker, on a second domain, serving nothing but finished HTML from
 * R2. It has no database, no session, no secrets and no write path — the only
 * two things it can reach are a KV map of hostname → project id and the bucket
 * the API wrote those files into.
 *
 * ## Why this is not part of the main Worker
 *
 * Published pages are author-supplied HTML: `settings.customHead` and the
 * rich-text block both pass through verbatim, so a page can carry arbitrary
 * `<script>`. Served from the editor's origin, that script would run *as the
 * editor* in the browser of any signed-in Cre8 user who visited it and could
 * call the API with their cookie attached — publishing a site would amount to
 * account takeover.
 *
 * The main Worker mitigates that with a sandbox CSP. A separate registrable
 * domain is the real fix, and it costs the sites nothing: on their own origin
 * they get storage, service workers and their own future auth back, none of
 * which survives a sandbox.
 *
 * ## Custom domains
 *
 * The KV map is keyed on hostname, not on subdomain, so pointing
 * `www.acme.com` at a project is one more entry with no code change here.
 */

export interface Env {
  /** hostname → project id. Written by the API at publish time. */
  SITE_ROUTES: KVNamespace;
  /** Generated HTML, `<projectId>/<path>`. */
  SITES: R2Bucket;
}

/**
 * Short on purpose, and the same value the API uses.
 *
 * `caches.default` is per-colo, so a publish can only purge the colo it landed
 * in — every other one has to expire on its own. A long TTL would leave a
 * republished site stale across most of the world.
 */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=60, must-revalidate';

/** Hostname → project id, cached in the isolate so a hot site skips KV too. */
const routeCache = new Map<string, string | null>();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);

    // Internal links in a published page are relative, so the same bytes work
    // here, at /s/<id>/ on the editor's origin, and unzipped on a desktop.
    // Relative resolution depends on the trailing slash, so the directory form
    // is canonical and everything else redirects to it.
    if (!url.pathname.endsWith('/')) {
      const last = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
      if (!last.includes('.')) {
        url.pathname = `${url.pathname}/`;
        return Response.redirect(url.toString(), 301);
      }
    }

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const projectId = await resolveProject(url.hostname, env);
    // Naming the hostname matters: when a custom domain is misconfigured, the
    // whole question is which name actually arrived here.
    if (!projectId) return notFound(`No site is published at ${escapeHtml(url.hostname)}.`);

    const object = await env.SITES.get(`${projectId}/${fileFor(url.pathname)}`);
    if (!object) {
      // A published site's own 404 page if it has one, else ours.
      const fallback = await env.SITES.get(`${projectId}/404.html`);
      if (!fallback) return notFound('Page not found.');
      return new Response(fallback.body, {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': CACHE_CONTROL },
      });
    }

    const response = new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? contentTypeFor(url.pathname),
        'cache-control': CACHE_CONTROL,
        'x-content-type-options': 'nosniff',
        // No sandbox here, unlike the same-origin fallback on the main Worker:
        // this origin holds nothing worth stealing, so published pages get to
        // be ordinary websites.
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    });

    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};

async function resolveProject(hostname: string, env: Env): Promise<string | null> {
  const key = hostname.toLowerCase();
  const memo = routeCache.get(key);
  if (memo !== undefined) return memo;

  const projectId = await env.SITE_ROUTES.get(key);
  // Negative results are cached too, so a flood at an unclaimed hostname does
  // not turn into a flood at KV.
  routeCache.set(key, projectId);
  if (routeCache.size > 500) routeCache.clear();
  return projectId;
}

/** Mirrors the API's publish layout: `about` and `about/` both mean `about/index.html`. */
function fileFor(pathname: string): string {
  const path = pathname.split('/').filter(Boolean).join('/');
  if (path === '') return 'index.html';
  return path.includes('.') ? path : `${path}/index.html`;
}

function notFound(message: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Not found</title><style>` +
      `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#e7e7ea;` +
      `font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif}p{color:#8a8a93;margin:.4em 0 0}` +
      `</style></head><body><div><strong>Nothing here</strong><p>${message}</p></div></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.html') || !path.includes('.')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.avif')) return 'image/avif';
  if (path.endsWith('.ico')) return 'image/x-icon';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
