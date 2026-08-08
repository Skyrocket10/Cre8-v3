-- Cre8 — D1 schema.
--
-- Safe to re-run: every statement is guarded. If you applied the pre-accounts
-- version of this file, run migrations/0002_accounts_and_teams.sql instead of
-- editing tables by hand — `CREATE TABLE IF NOT EXISTS` will not add the new
-- columns to a table that already exists.
--
-- Design notes
--
--  • A project document is a single JSON blob. The server never reasons about
--    its contents; all structure lives in the client-side document model, and
--    querying inside a design would buy nothing.
--  • Everything is owned by a team, never directly by a user. A solo account
--    still gets a team of one, so sharing later is a membership row rather than
--    a data migration.

/* ---------------------------------------------------------------- accounts */

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,       -- always stored lowercased
  name          TEXT NOT NULL,
  -- HMAC(PEPPER, client-derived key). The expensive KDF runs in the browser;
  -- see workers/src/lib/crypto.ts for why.
  verifier      TEXT NOT NULL,
  -- Identifies the hashing scheme so it can be rotated without a flag day.
  auth_version  INTEGER NOT NULL DEFAULT 1,
  avatar_hue    INTEGER NOT NULL DEFAULT 220,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  -- SHA-256 of the cookie token. A database leak must not yield live sessions.
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id, expires_at DESC);

/* ------------------------------------------------------------------- teams */

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users (id),
  created_at  INTEGER NOT NULL,
  -- Set on the team created automatically at signup, so the UI can label it.
  personal    INTEGER NOT NULL DEFAULT 0
);

-- owner  — billing and deletion, cannot be removed by others
-- admin  — manage members and projects
-- editor — edit projects
-- viewer — read and preview only
CREATE TABLE IF NOT EXISTS team_members (
  team_id    TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_members_user ON team_members (user_id);

CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  email       TEXT NOT NULL,               -- lowercased
  role        TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  -- SHA-256 of the invite token, same reasoning as sessions.
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  TEXT NOT NULL REFERENCES users (id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  accepted_at INTEGER
);

CREATE INDEX IF NOT EXISTS invites_team ON invites (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invites_email ON invites (email) WHERE accepted_at IS NULL;

/* ---------------------------------------------------------------- projects */

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users (id),
  name        TEXT NOT NULL,
  document    TEXT NOT NULL,               -- serialised Cre8Document
  page_count  INTEGER NOT NULL DEFAULT 1,
  -- Bumped by the collaboration room on every accepted change. Clients fence
  -- their writes against it so a stale write can never silently win.
  version     INTEGER NOT NULL DEFAULT 0,
  -- Label of the published site's hostname: <subdomain>.<PUBLIC_SITE_DOMAIN>.
  -- Assigned on first publish, editable after. NULL until then, and the unique
  -- index below ignores NULLs, so unpublished projects don't collide.
  subdomain   TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_team_updated ON projects (team_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS projects_subdomain ON projects (subdomain);

-- Upgrading a database created before subdomains existed? `ALTER TABLE` has no
-- IF NOT EXISTS in SQLite, so it cannot live above. Run it once, by hand:
--
--   npx wrangler d1 execute cre8 --remote \
--     --command "ALTER TABLE projects ADD COLUMN subdomain TEXT"
--
-- then re-run this file to pick up the index.

CREATE TABLE IF NOT EXISTS deployments (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  published_by  TEXT REFERENCES users (id),
  published_at  INTEGER NOT NULL,
  page_count    INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  r2_prefix     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS deployments_project ON deployments (project_id, published_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  bytes       INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS assets_project ON assets (project_id, created_at DESC);

-- Form submissions from published sites.
--
-- Public and unauthenticated by necessity: the person filling in a contact
-- form on someone's published site has no account here. That makes every
-- column below untrusted input, so `payload` is stored as opaque JSON and is
-- never interpolated into anything — the editor renders it as text.
--
-- `ip_hash` is a hash, not an address. Rate limiting and abuse triage need to
-- tell submissions apart, not identify anyone, and a site owner should not be
-- handed their visitors' IP addresses as a side effect of collecting an email.
CREATE TABLE IF NOT EXISTS form_submissions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  form_id     TEXT NOT NULL,
  payload     TEXT NOT NULL,
  ip_hash     TEXT,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_project
  ON form_submissions (project_id, created_at DESC);

-- Rate limiting reads this on every submission, so it gets its own index
-- rather than scanning the project's history.
CREATE INDEX IF NOT EXISTS submissions_rate
  ON form_submissions (ip_hash, created_at DESC);
