/**
 * HTTP plumbing: responses, CORS, cookies, and the CSRF stance.
 */

import type { Env } from '../types';

const JSON_TYPE = 'application/json; charset=utf-8';

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': JSON_TYPE, ...headers },
  });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: string) => new HttpError(400, m, d);
export const unauthorised = (m = 'Not signed in', d?: string) => new HttpError(401, m, d);
export const forbidden = (m = 'Not allowed', d?: string) => new HttpError(403, m, d);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string, d?: string) => new HttpError(409, m, d);

export function errorResponse(error: unknown, cors: Record<string, string>): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, detail: error.detail }, error.status, cors);
  }
  console.error('[cre8-api]', error);
  return json({ error: 'Internal error' }, 500, cors);
}

/* --------------------------------------------------------------------------
 * CORS
 * ----------------------------------------------------------------------- */

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Credentialed CORS, for split deployments only.
 *
 * The normal shape is one Worker serving the editor and the API together, so
 * calls are same-origin and none of this applies — the allowlist is empty and
 * this returns nothing. It stays because serving the editor from elsewhere is
 * still supported, and then the allowlist has to be exact: `*` is not permitted
 * alongside `allow-credentials`.
 */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-cre8-csrf',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/**
 * CSRF defence, second layer.
 *
 * `SameSite=Lax` is the first: on one origin the browser simply will not attach
 * the session to a cross-site POST, which is the whole attack. This header is
 * kept anyway because it costs nothing and it is what protects a split
 * deployment, where `SameSite=None` is unavoidable and the browser's own
 * protection is gone.
 *
 * A custom header is not CORS-safelisted, so the browser sends a preflight, and
 * the preflight only succeeds for an allowlisted origin. `multipart/form-data`
 * uploads need the header too — that content type *is* safelisted and would
 * otherwise skip the preflight entirely.
 */
export function requireCsrfHeader(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  if (request.headers.get('x-cre8-csrf') !== '1') {
    throw forbidden(
      'Missing CSRF header',
      'State-changing requests must send x-cre8-csrf: 1.'
    );
  }
}

/* --------------------------------------------------------------------------
 * Cookies
 * ----------------------------------------------------------------------- */

export const SESSION_COOKIE = 'cre8_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

/**
 * `SameSite` follows the deployment, because it has to.
 *
 * One Worker serving the editor and the API means every call is same-site, and
 * `Lax` gets the browser to refuse the cookie on cross-site requests for us —
 * CSRF handled by the platform. A split deployment cannot use `Lax` at all: the
 * editor's calls would arrive cookie-less and nobody could stay signed in. So
 * configuring `ALLOWED_ORIGINS` is what widens this, and nothing else does.
 *
 * `HttpOnly` throughout keeps the token away from the rich-text renderer's
 * `dangerouslySetInnerHTML` surface. `Secure` throughout because production is
 * HTTPS and browsers treat localhost as trustworthy regardless.
 */
export function sessionCookie(env: Env, token: string, maxAgeSeconds: number): string {
  const crossOrigin = allowedOrigins(env).length > 0;
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    crossOrigin ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function clearedSessionCookie(env: Env): string {
  return sessionCookie(env, '', 0);
}

/* --------------------------------------------------------------------------
 * Bodies
 * ----------------------------------------------------------------------- */

const MAX_JSON_BYTES = 12 * 1024 * 1024;

export async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_JSON_BYTES) throw badRequest('Request too large');
  try {
    return (await request.json()) as T;
  } catch {
    throw badRequest('Invalid JSON body');
  }
}
