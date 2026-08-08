-- Cre8 — D1 schema.
--
-- Deliberately thin. The editor's document is a single JSON blob because the
-- server never needs to reason about its contents: all structure lives in the
-- client-side document model, and querying inside a design would buy nothing.
-- When the CMS layer arrives it gets its own tables alongside these; the
-- document format does not change.

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  document    TEXT NOT NULL,          -- serialised Cre8Document
  page_count  INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_owner_updated
  ON projects (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS deployments (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  published_at  INTEGER NOT NULL,
  page_count    INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  -- R2 key prefix the generated files were written under.
  r2_prefix     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS deployments_project
  ON deployments (project_id, published_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS assets_project ON assets (project_id, created_at DESC);
