/**
 * Form submissions from published sites.
 *
 * This is the one write endpoint with no account behind it: the person filling
 * in a contact form is a visitor to someone else's site, not a Cre8 user. That
 * shapes every decision here.
 *
 * It is deliberately reachable by a plain HTML form. No script runs on a
 * published page, so the browser posts natively and follows the redirect —
 * which means no CORS preflight, no fetch, and no CSRF token. Skipping the
 * token is not a hole: CSRF matters when a request carries ambient authority,
 * and this one carries none. Anyone can post to it from anywhere, exactly as
 * they could type into the form itself. What has to be defended instead is
 * volume, payload size, and where the response sends the browser next.
 */

import type { Env } from '../types';
import { newId } from '../lib/crypto';

/** Bots fill in every field they can see. Humans never see this one. */
const HONEYPOT_FIELD = '_trap';

/** Fields the endpoint owns rather than stores. */
const RESERVED = new Set([HONEYPOT_FIELD, '_redirect']);

const MAX_FIELDS = 40;
const MAX_FIELD_BYTES = 8_000;
const MAX_TOTAL_BYTES = 64_000;

/** Per-IP ceiling, and the window it applies over. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * A stable, non-reversible handle for one submitter.
 *
 * Enough to rate limit and to spot a flood; not enough to identify anyone. The
 * project id is mixed in so the same visitor is a different handle on every
 * site, which stops the table becoming a cross-site tracking log.
 */
async function hashIp(ip: string, projectId: string): Promise<string> {
  const data = new TextEncoder().encode(`${projectId}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Where to send the browser afterwards.
 *
 * A form field naming the destination is an open redirect unless it is checked,
 * and this endpoint is reachable by anyone — so the target has to be same-origin
 * with the page that posted, and that page has to belong to this project.
 */
function safeRedirect(candidate: string | null, referer: string | null, origin: string): string | null {
  const base = referer ?? origin;
  for (const value of [candidate, referer]) {
    if (!value) continue;
    try {
      const target = new URL(value, base);
      if (target.protocol !== 'https:' && target.protocol !== 'http:') continue;
      // Only back where it came from. Anything else is somebody using a
      // stranger's form as a redirector.
      if (referer && new URL(referer).origin !== target.origin) continue;
      target.searchParams.set('sent', '1');
      return target.toString();
    } catch {
      // Unparseable; fall through to the next candidate.
    }
  }
  return null;
}

/**
 * The return path the publisher wrote into the action.
 *
 * Needed because the same-origin `/s/` fallback is served under a sandbox CSP.
 * That makes the page an opaque origin, so the browser sends no Referer, and
 * without this a visitor who submits a form lands on a bare thank-you page
 * instead of back on the site they were reading.
 *
 * It is a path, never a URL: the origin and the `/s/<projectId>/` prefix are
 * both supplied here, so the only thing the page can influence is which of its
 * own pages it returns to.
 */
function returnFromPath(raw: string | null, projectId: string, origin: string): string | null {
  if (raw === null) return null;
  const path = raw.replace(/^\/+/, '');
  // No scheme, no protocol-relative escape, no climbing out of the prefix.
  if (path.includes(':') || path.includes('//') || path.split('/').includes('..')) return null;
  const target = new URL(`/s/${encodeURIComponent(projectId)}/${path}`, origin);
  target.searchParams.set('sent', '1');
  return target.toString();
}

/** A minimal page for the case where there is nowhere to send them back to. */
function thanksPage(): Response {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Thank you</title>' +
      '<p style="font:16px/1.5 system-ui;margin:3rem auto;max-width:32rem">Thanks — your message was sent.</p>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function handleFormSubmission(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  }

  const [, , , projectId, formId = 'default'] = url.pathname.split('/');
  if (!projectId) return new Response('Not found', { status: 404 });

  // A submission to a project that does not exist is a 404, not a silent
  // success — otherwise a typo in the action URL looks like it is working.
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) return new Response('Not found', { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Expected a form submission', { status: 400 });
  }

  const referer = request.headers.get('referer');
  const destination =
    safeRedirect(
      typeof form.get('_redirect') === 'string' ? String(form.get('_redirect')) : null,
      referer,
      url.origin
    ) ?? returnFromPath(url.searchParams.get('r'), projectId, url.origin);
  const done = destination ? Response.redirect(destination, 303) : thanksPage();

  // Filled in means a bot. Answer exactly as a success would, so whatever is
  // on the other end learns nothing from the difference, and store nothing.
  if (String(form.get(HONEYPOT_FIELD) ?? '').trim() !== '') return done;

  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  const ipHash = await hashIp(ip, projectId);

  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM form_submissions WHERE ip_hash = ? AND created_at > ?'
  )
    .bind(ipHash, Date.now() - RATE_WINDOW_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_LIMIT) {
    return new Response('Too many submissions. Try again later.', {
      status: 429,
      headers: { 'retry-after': String(Math.ceil(RATE_WINDOW_MS / 1000)) },
    });
  }

  const payload: Record<string, string> = {};
  let total = 0;
  let fields = 0;
  for (const [key, value] of form.entries()) {
    if (RESERVED.has(key)) continue;
    if (++fields > MAX_FIELDS) break;
    // Files are not accepted. Storing uploads from anonymous visitors is a
    // different feature with a different threat model.
    const text = typeof value === 'string' ? value : `[file: ${value.name}]`;
    const clipped = text.slice(0, MAX_FIELD_BYTES);
    total += clipped.length;
    if (total > MAX_TOTAL_BYTES) break;
    payload[key.slice(0, 200)] = clipped;
  }

  if (Object.keys(payload).length === 0) {
    return new Response('Nothing to submit', { status: 400 });
  }

  await env.DB.prepare(
    `INSERT INTO form_submissions (id, project_id, form_id, payload, ip_hash, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      newId(),
      projectId,
      formId.slice(0, 120),
      JSON.stringify(payload),
      ipHash,
      (request.headers.get('user-agent') ?? '').slice(0, 400),
      Date.now()
    )
    .run();

  return done;
}

/* --------------------------------------------------------------------------
 * Reading them back
 * ----------------------------------------------------------------------- */

export interface SubmissionRow {
  id: string;
  formId: string;
  payload: Record<string, string>;
  createdAt: number;
}

/** Authenticated — the caller has already been checked against the project. */
export async function listSubmissions(env: Env, projectId: string, limit = 100) {
  const { results } = await env.DB.prepare(
    `SELECT id, form_id, payload, created_at
       FROM form_submissions
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?`
  )
    .bind(projectId, Math.min(limit, 500))
    .all<{ id: string; form_id: string; payload: string; created_at: number }>();

  return (results ?? []).map((row): SubmissionRow => ({
    id: row.id,
    formId: row.form_id,
    // Stored opaque and parsed here; a malformed row must not take the list
    // down for every other submission.
    payload: safeParse(row.payload),
    createdAt: row.created_at,
  }));
}

function safeParse(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Fall through.
  }
  return {};
}
