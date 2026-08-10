/**
 * The columns the schema grew after the first deploy, and the code that adds
 * them.
 *
 * `schema.sql` is written to be re-runnable, and every statement in it is
 * guarded — but `CREATE TABLE IF NOT EXISTS` does nothing to a table that
 * already exists, and SQLite has no `ADD COLUMN IF NOT EXISTS`. So a column
 * added to a shipped table cannot live in that file at all. Until now the
 * answer was four `wrangler d1 execute` commands in a comment, which works
 * right up to the moment somebody deploys the code without reading it: the
 * publisher writes `projects.site_manifest`, the history writes
 * `deployments.document`, and publishing 500s on a site that was fine an hour
 * ago.
 *
 * So ask the database what it has, add only what is missing, and say what was
 * done. Additive, idempotent, and it never touches a row — which is what makes
 * it safe to put behind a route instead of a shell.
 *
 * ── This module has no runtime imports, on purpose ──────────────────────────
 * Everything it needs from D1 is described structurally below. That lets the
 * static suite transpile this one file on its own and check `LATE_COLUMNS`
 * against `schema.sql` in a real SQLite database — so a column added to the
 * schema and forgotten here fails the build rather than a deploy.
 */

/** Just enough of D1 to introspect and alter. `D1Database` satisfies it. */
export interface SqlRunner {
  prepare(sql: string): {
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
}

export interface LateColumn {
  readonly table: string;
  readonly column: string;
  readonly type: string;
}

/**
 * Every column added to an existing table since the first deploy.
 *
 * Order matters only in that a column must appear before any index that needs
 * it. Nothing is ever removed from this list: a database that skipped three
 * releases has to be able to catch up in one pass.
 */
export const LATE_COLUMNS: readonly LateColumn[] = [
  // Added with per-project subdomains, in the two-Worker split.
  { table: 'projects', column: 'subdomain', type: 'TEXT' },
  // Added with incremental publishing — without it a republish cannot know
  // which paths have gone, and a deleted record's page stays on the internet.
  { table: 'projects', column: 'site_manifest', type: 'TEXT' },
  // Added with publish history. Publishing writes both, so their absence is
  // the one that takes the feature down rather than degrading it.
  { table: 'deployments', column: 'document', type: 'TEXT' },
  { table: 'deployments', column: 'changed', type: 'TEXT' },
];

export interface LateIndex {
  readonly table: string;
  readonly name: string;
  /** Columns it reads, as `table.column`. Skipped until they all exist. */
  readonly needs: readonly string[];
  readonly ddl: string;
}

export const LATE_INDEXES: readonly LateIndex[] = [
  {
    table: 'projects',
    name: 'projects_subdomain',
    needs: ['projects.subdomain'],
    ddl: 'CREATE UNIQUE INDEX IF NOT EXISTS projects_subdomain ON projects (subdomain)',
  },
];

export interface SchemaReport {
  /** Nothing left to do. */
  ready: boolean;
  /** Still missing after this call — always empty after a successful apply. */
  pending: string[];
  /** Columns this call added, as `table.column`. */
  added: string[];
  /** Columns that were already there. */
  present: string[];
  /** Indexes this call created. */
  indexes: string[];
  /**
   * Tables the database does not have at all. Not something to patch around:
   * it means `db:init` was never run, and the fix is the whole schema file.
   */
  missingTables: string[];
}

/*
 * Identifiers cannot be bound as parameters, so they are interpolated — which
 * is only safe because every one of them is a literal in this file and is
 * checked against these before it reaches a statement. Nothing from a request
 * ever gets here, and this makes that a property of the code rather than a
 * thing to remember.
 */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const COLUMN_TYPE = /^(TEXT|INTEGER|REAL|BLOB)$/;

function assertName(value: string, what: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe ${what}: ${JSON.stringify(value)}`);
}

/** What the schema needs, without changing anything. */
export function inspectSchema(db: SqlRunner): Promise<SchemaReport> {
  return reviewSchema(db, false);
}

/** The same, then adds whatever was missing. */
export function ensureSchema(db: SqlRunner): Promise<SchemaReport> {
  return reviewSchema(db, true);
}

async function reviewSchema(db: SqlRunner, apply: boolean): Promise<SchemaReport> {
  const tables = [...new Set(LATE_COLUMNS.map((c) => c.table))].sort();
  const columns = new Map<string, Set<string>>();

  for (const table of tables) {
    assertName(table, 'table name');
    // A table that does not exist returns no rows rather than raising, which
    // is why the empty case is distinguishable from a table with no columns —
    // there is no such thing as a table with no columns.
    const { results } = await db
      .prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string }>();
    columns.set(table, new Set(results.map((row) => row.name)));
  }

  const missingTables = tables.filter((t) => columns.get(t)!.size === 0);
  const present: string[] = [];
  const pending: string[] = [];
  const added: string[] = [];

  for (const spec of LATE_COLUMNS) {
    const have = columns.get(spec.table)!;
    // Nothing to add to a table that isn't there. Reported above instead.
    if (have.size === 0) continue;

    const label = `${spec.table}.${spec.column}`;
    if (have.has(spec.column)) {
      present.push(label);
      continue;
    }
    if (!apply) {
      pending.push(label);
      continue;
    }

    assertName(spec.column, 'column name');
    if (!COLUMN_TYPE.test(spec.type)) {
      throw new Error(`Unsafe column type: ${JSON.stringify(spec.type)}`);
    }
    // No NOT NULL and no default: adding either to a populated table means
    // deciding what every existing row should say, and none of these columns
    // has an answer to that. They are all "unknown until the next publish".
    await db
      .prepare(`ALTER TABLE ${spec.table} ADD COLUMN ${spec.column} ${spec.type}`)
      .run();
    have.add(spec.column);
    added.push(label);
  }

  const indexes = apply ? await ensureIndexes(db, columns) : [];

  return {
    ready: pending.length === 0 && missingTables.length === 0,
    pending,
    added,
    present,
    indexes,
    missingTables,
  };
}

/**
 * Indexes are checked even when no column was added.
 *
 * The old instructions were four `ALTER TABLE` commands in a comment, and the
 * index was a separate step further down the page. Somebody who ran the first
 * four and stopped has the columns and not the uniqueness — so this cannot be
 * conditional on having just added something.
 */
async function ensureIndexes(
  db: SqlRunner,
  columns: Map<string, Set<string>>
): Promise<string[]> {
  const created: string[] = [];

  for (const spec of LATE_INDEXES) {
    const usable = spec.needs.every((need) => {
      const [table, column] = need.split('.');
      return Boolean(table && column && columns.get(table)?.has(column));
    });
    if (!usable) continue;

    assertName(spec.table, 'table name');
    const { results } = await db
      .prepare(`PRAGMA index_list(${spec.table})`)
      .all<{ name: string }>();
    // `IF NOT EXISTS` would make running it unconditionally harmless, but then
    // the report would claim to have created an index that was already there.
    if (results.some((row) => row.name === spec.name)) continue;

    await db.prepare(spec.ddl).run();
    created.push(spec.name);
  }

  return created;
}

/**
 * Does this error look like the database is behind the code?
 *
 * SQLite's message is the only signal — D1 surfaces it verbatim and gives it no
 * code of its own. Used to turn an opaque 500 into the one sentence that says
 * what to do about it.
 */
export function looksLikeMissingColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no such column|has no column named/i.test(message);
}
