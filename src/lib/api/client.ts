'use client';

/**
 * Typed client for the Cre8 API.
 *
 * The API lives at `/api/*` on whatever origin the editor was loaded from,
 * because one Worker serves both. That is why there is no URL to configure:
 * there is nothing to point at.
 *
 * `NEXT_PUBLIC_CRE8_API_URL` remains as an override for a split deployment —
 * editor on one host, API on another — and setting it is what switches the
 * server to `SameSite=None` cookies and turns the CORS allowlist on.
 *
 * Two things every request carries:
 *
 *   • `credentials: 'include'` — the session is an HttpOnly cookie.
 *   • `x-cre8-csrf` — not CORS-safelisted, so a cross-site form cannot forge
 *     it and a cross-origin caller must survive a preflight to send it.
 */

import type { CollectionRecord, Cre8Document } from '../document/types';

/**
 * What a caller may set on a record.
 *
 * `collectionId` is required on creation and absent from updates: a record
 * does not move between shapes, and letting it would leave rows keyed on a
 * collection whose fields they were never written against.
 */
export interface RecordInput {
  collectionId: string;
  slug?: string | null;
  position?: number;
  published?: boolean;
  data: Record<string, string | number | boolean | null>;
}

/** Empty means same-origin, which is the normal deployment. */
export const API_URL = (process.env.NEXT_PUBLIC_CRE8_API_URL?.trim() ?? '').replace(/\/+$/, '');

/**
 * Whether a backend is reachable.
 *
 * Not knowable at build time any more: the same static export runs against a
 * Worker that serves it *and* the API, or gets dropped on a dumb CDN with no
 * backend behind it at all. `SessionProvider` settles this once on boot, before
 * anything that depends on it renders — see `probeBackend`.
 *
 * An explicit `NEXT_PUBLIC_CRE8_API_URL` is a promise that a backend exists, so
 * it short-circuits the probe.
 */
let backend: boolean = API_URL.length > 0;

export function hasBackend(): boolean {
  return backend;
}

export type ProbeResult =
  /** Nothing is listening. Browser-only mode, exactly as it works offline. */
  | { kind: 'absent' }
  /** An API answered and told us who we are. */
  | { kind: 'ready'; session: SessionResponse }
  /**
   * An API answered, and answered with a complaint.
   *
   * Worth its own state: "the Worker is deployed but `AUTH_PEPPER` is unset" is
   * a completely different problem from "there is no Worker", and the server
   * has already said which. Collapsing the two sends people to look for a
   * deployment that is sitting right in front of them.
   */
  | { kind: 'broken'; message: string; detail?: string };

/** Ask the API who we are, and learn from the answer what kind of world this is. */
export async function probeBackend(): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/auth/me`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
  } catch {
    backend = false;
    return { kind: 'absent' };
  }

  // A static host with nothing behind it answers with its own 404 page.
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  if (!isJson) {
    backend = false;
    return { kind: 'absent' };
  }

  const body = (await response.json().catch(() => null)) as
    | (SessionResponse & { error?: string; detail?: string })
    | null;
  if (!body) {
    backend = false;
    return { kind: 'absent' };
  }

  if (!response.ok && response.status !== 401) {
    backend = false;
    return {
      kind: 'broken',
      message: body.error ?? `The workspace API returned ${response.status}`,
      ...(body.detail ? { detail: body.detail } : {}),
    };
  }

  backend = true;
  return { kind: 'ready', session: { user: body.user ?? null, teams: body.teams ?? [] } };
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  avatarHue: number;
}

export interface Team {
  id: string;
  name: string;
  role: Role;
  personal: boolean;
  memberCount: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarHue: number;
  role: Role;
  joinedAt: number;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  created_at: number;
  expires_at: number;
}

/** Carries the server's message so the UI never has to invent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!backend) throw new ApiError(0, 'No workspace connected');

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'x-cre8-csrf': '1',
        ...(init.body && !(init.body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
        ...init.headers,
      },
    });
  } catch {
    // The browser hides the real reason for a network-level failure. On one
    // origin it is almost always "the Worker is down"; on a split deployment it
    // is almost always CORS. Say both rather than "Failed to fetch".
    throw new ApiError(
      0,
      'Could not reach the workspace',
      API_URL
        ? 'Check the API is deployed and that this origin is in ALLOWED_ORIGINS.'
        : 'The API is served from this same origin — check the Worker is deployed.'
    );
  }

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    detail?: string;
  };

  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`, body.detail);
  }
  return body as T;
}

/* --------------------------------------------------------------------------
 * Accounts
 * ----------------------------------------------------------------------- */

/** One form submission from a published site. */
export interface FormSubmission {
  id: string;
  formId: string;
  /** Whatever the visitor typed. Field names come from the form, so untrusted. */
  payload: Record<string, string>;
  createdAt: number;
}

export interface SessionResponse {
  user: AccountUser | null;
  teams: Team[];
}

export const api = {
  me: () => call<SessionResponse>('/api/auth/me'),

  signUp: (email: string, derivedKey: string, name: string) =>
    call<SessionResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, derivedKey, name }),
    }),

  signIn: (email: string, derivedKey: string) =>
    call<SessionResponse>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, derivedKey }),
    }),

  signOut: () => call<{ ok: true }>('/api/auth/signout', { method: 'POST' }),

  /* ---------------------------------------------------------------- teams */

  createTeam: (name: string) =>
    call<{ team: Team }>('/api/teams', { method: 'POST', body: JSON.stringify({ name }) }),

  members: (teamId: string) =>
    call<{ members: TeamMember[]; invites: PendingInvite[] }>(`/api/teams/${teamId}/members`),

  invite: (teamId: string, email: string, role: Role) =>
    call<{ token: string; email: string; role: Role; expiresAt: number }>(
      `/api/teams/${teamId}/invites`,
      { method: 'POST', body: JSON.stringify({ email, role }) }
    ),

  revokeInvite: (teamId: string, inviteId: string) =>
    call<{ ok: true }>(`/api/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' }),

  peekInvite: (token: string) =>
    call<{ email: string; role: Role; teamName: string; invitedBy: string }>(
      `/api/invites/${encodeURIComponent(token)}`
    ),

  acceptInvite: (token: string) =>
    call<{ teams: Team[]; teamId: string }>('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  setMemberRole: (teamId: string, memberId: string, role: Role) =>
    call<{ ok: true }>(`/api/teams/${teamId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeMember: (teamId: string, memberId: string) =>
    call<{ ok: true }>(`/api/teams/${teamId}/members/${memberId}`, { method: 'DELETE' }),

  /* ------------------------------------------------------------- projects */

  listProjects: (teamId?: string) =>
    call<{
      projects: {
        id: string;
        name: string;
        pageCount: number;
        createdAt: number;
        updatedAt: number;
        teamId: string;
      }[];
    }>(`/api/projects${teamId ? `?team=${encodeURIComponent(teamId)}` : ''}`),

  getProject: (id: string) =>
    call<{
      document: Cre8Document;
      version: number;
      role: Role;
      subdomain: string | null;
      siteDomain: string;
    }>(`/api/projects/${id}`),

  saveProject: (doc: Cre8Document & { teamId?: string }) =>
    call<{ ok: true; version: number }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(doc),
    }),

  deleteProject: (id: string) => call<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),

  /**
   * Publish. No body: the Worker renders from the live document and D1.
   *
   * What used to travel here was the finished site — every page, every byte,
   * generated in the browser. Sending nothing is the whole of D3: the server
   * decides what a published page contains, so it can publish again later
   * with no browser involved.
   */
  publish: (id: string) =>
    call<{
      ok: true;
      publishedAt: number;
      bytes: number;
      pageCount: number;
      pages: { slug: string; title: string; path: string }[];
      url: string;
      subdomain: string;
      siteDomain: string;
    }>(`/api/projects/${id}/publish`, { method: 'POST' }),

  /** Rename a published site's address. Frees the old hostname immediately. */
  submissions: (id: string) =>
    call<{ submissions: FormSubmission[] }>(`/api/projects/${id}/submissions`),

  setSubdomain: (id: string, subdomain: string) =>
    call<{ subdomain: string }>(`/api/projects/${id}/subdomain`, {
      method: 'PUT',
      body: JSON.stringify({ subdomain }),
    }),

  /* --- Collection records ---------------------------------------------- */

  listRecords: (
    projectId: string,
    collectionId: string,
    options: { limit?: number; offset?: number; publishedOnly?: boolean } = {}
  ) => {
    const query = new URLSearchParams({ collection: collectionId });
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.publishedOnly) query.set('published', 'true');
    return call<{ records: CollectionRecord[]; total: number }>(
      `/api/projects/${projectId}/records?${query}`
    );
  },

  createRecord: (projectId: string, input: RecordInput) =>
    call<{ record: CollectionRecord }>(`/api/projects/${projectId}/records`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Partial: anything left out keeps the value it had. */
  updateRecord: (projectId: string, recordId: string, patch: Partial<RecordInput>) =>
    call<{ record: CollectionRecord }>(`/api/projects/${projectId}/records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteRecord: (projectId: string, recordId: string) =>
    call<{ ok: true }>(`/api/projects/${projectId}/records/${recordId}`, { method: 'DELETE' }),

  uploadAsset: async (projectId: string, blob: Blob, filename: string) => {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('file', blob, filename);
    const { url } = await call<{ id: string; url: string }>('/api/assets', {
      method: 'POST',
      body: form,
    });
    return `${API_URL}${url}`;
  },
};

/** WebSocket URL for a project's collaboration room. */
/**
 * Where published pages should send form submissions.
 *
 * Null in local mode: with no backend there is nowhere to post, and a form
 * published with no action posts back to its own page and does nothing, which
 * is better than an action pointing at a host that will never answer.
 */
export function apiOrigin(): string | null {
  if (!backend) return null;
  return API_URL || window.location.origin;
}

export function socketUrl(projectId: string): string {
  // Same origin by default, so the socket inherits the page's scheme — wss on
  // a real deployment, ws on a local one — with nothing to configure.
  const base = API_URL || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/api/projects/${projectId}/socket`;
}
