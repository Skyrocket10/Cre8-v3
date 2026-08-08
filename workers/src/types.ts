export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  SITES: R2Bucket;
  /** One instance per project; holds the live document and the peer list. */
  ROOMS: DurableObjectNamespace;

  /** Comma-separated exact origins allowed to call the API with credentials. */
  ALLOWED_ORIGINS: string;
  /** Server-side secret mixed into every stored password verifier. */
  AUTH_PEPPER: string;
  /** Set to "false" to close signups once your team is in. */
  ALLOW_SIGNUP?: string;
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

/** Ascending capability. A check is "is your rank at least this". */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export interface UserRow {
  id: string;
  email: string;
  name: string;
  verifier: string;
  auth_version: number;
  avatar_hue: number;
  created_at: number;
  updated_at: number;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarHue: number;
}

export interface TeamRow {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
  personal: number;
}

export interface ProjectRow {
  id: string;
  team_id: string;
  created_by: string | null;
  name: string;
  document: string;
  page_count: number;
  version: number;
  created_at: number;
  updated_at: number;
}
