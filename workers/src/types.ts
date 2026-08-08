export interface Env {
  DB: D1Database;
  /** The editor's static build. Bound so the handler can serve out/404.html. */
  ASSETS: Fetcher;
  /** Images and files people upload into a project. */
  UPLOADS: R2Bucket;
  /** Generated HTML for published sites. */
  SITES: R2Bucket;
  /**
   * hostname → project id, for the published-sites Worker.
   *
   * KV rather than D1 because this is read on the highest-volume path in the
   * system — every request to every published page — and it keeps the sites
   * Worker off the database entirely. Written here, at publish time.
   */
  SITE_ROUTES: KVNamespace;
  /** One instance per project; holds the live document and the peer list. */
  ROOMS: DurableObjectNamespace;

  /**
   * Apex for published sites, e.g. `cre8.app`. A project publishes to
   * `<subdomain>.<PUBLIC_SITE_DOMAIN>`. Empty disables the whole mechanism and
   * sites stay on this Worker's `/s/<projectId>/` path.
   */
  PUBLIC_SITE_DOMAIN?: string;

  /**
   * Comma-separated exact origins allowed to call the API with credentials.
   *
   * Empty is the normal case: the editor is served by this same Worker, so its
   * calls are same-origin and CORS never enters into it. Only a split
   * deployment needs entries here.
   */
  ALLOWED_ORIGINS?: string;
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
  subdomain: string | null;
  created_at: number;
  updated_at: number;
}
