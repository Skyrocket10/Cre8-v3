'use client';

/**
 * Typed client for the Cre8 API Worker.
 *
 * Two things every request needs and neither is optional:
 *
 *   • `credentials: 'include'` — the session is an HttpOnly cookie, and the
 *     editor is on a different origin to the API, so the browser only attaches
 *     it when asked.
 *   • `x-cre8-csrf` — a non-safelisted header forces a CORS preflight, which
 *     only an allowlisted origin can pass. That is the CSRF defence, since
 *     `SameSite=None` gives up the browser's built-in one.
 */

import type { Cre8Document } from '../document/types';

export const API_URL = process.env.NEXT_PUBLIC_CRE8_API_URL?.trim() ?? '';

/** True when this build is wired to a backend at all. */
export const isHosted = API_URL.length > 0;

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
  if (!isHosted) throw new ApiError(0, 'No workspace connected');

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
    // A network-level failure here is usually CORS, and the browser hides the
    // real reason. Saying so beats "Failed to fetch".
    throw new ApiError(
      0,
      'Could not reach the workspace',
      'Check the API is deployed and that this origin is in ALLOWED_ORIGINS.'
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
    call<{ document: Cre8Document; version: number; role: Role }>(`/api/projects/${id}`),

  saveProject: (doc: Cre8Document & { teamId?: string }) =>
    call<{ ok: true; version: number }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(doc),
    }),

  deleteProject: (id: string) => call<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),

  publish: (id: string, files: { path: string; contents: string }[]) =>
    call<{ ok: true; publishedAt: number; bytes: number; url: string }>(
      `/api/projects/${id}/publish`,
      { method: 'POST', body: JSON.stringify({ files }) }
    ),

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
export function socketUrl(projectId: string): string {
  return `${API_URL.replace(/^http/, 'ws')}/api/projects/${projectId}/socket`;
}
