/**
 * Loads the D1 upgrade list into plain Node, and gives it a database to run on.
 *
 * `workers/src/lib/schema.ts` has no runtime imports — everything it needs from
 * D1 is described structurally — so `tsc` transpiles that one file on its own,
 * the same trick the block registry uses. No bundler, nothing to install.
 *
 * The database is `node:sqlite`, which is the same SQLite D1 is built on. That
 * is what makes these checks worth anything: they run the real ALTER
 * statements against a real engine rather than comparing two lists of strings.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'node_modules/.cache/cre8-schema');

export function loadSchemaModule() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const result = spawnSync(
    'npx',
    [
      'tsc',
      'workers/src/lib/schema.ts',
      '--outDir',
      OUT,
      '--rootDir',
      'workers/src/lib',
      // CommonJS so `require` below can pick it up with no extension.
      '--module',
      'commonjs',
      '--target',
      'es2022',
      '--skipLibCheck',
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(
      `Could not transpile workers/src/lib/schema.ts:\n${result.stdout}${result.stderr}\n` +
        'That module is compiled on its own, with `--rootDir workers/src/lib`. TS6059 ' +
        'means it now imports something from outside that directory — including a ' +
        '`import type`, which emits nothing but is still part of the program.'
    );
  }

  // One file in, one file out. The module's freedom from runtime imports is
  // the thing that makes it loadable here at all, and this is what says so:
  // add `import { badRequest } from './http'` and tsc emits `http.js` beside
  // it, and this throws instead of quietly dragging half the Worker along.
  const emitted = readdirSync(OUT).sort();
  if (emitted.length !== 1 || emitted[0] !== 'schema.js') {
    throw new Error(
      `workers/src/lib/schema.ts must have no runtime imports; tsc emitted ${emitted.join(', ')}`
    );
  }

  return createRequire(import.meta.url)(path.join(OUT, 'schema.js'));
}

/**
 * A `SqlRunner` over an in-memory SQLite database.
 *
 * Deliberately the whole of the interface and not one method more: if the
 * module ever reaches for something D1 has and this does not, it fails here
 * rather than in production.
 */
export function runnerFor(db) {
  return {
    prepare(sql) {
      return {
        async all() {
          return { results: db.prepare(sql).all() };
        },
        async run() {
          return db.prepare(sql).run();
        },
      };
    },
  };
}

/** A database with `sql` applied. */
export function databaseWith(sql) {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  return db;
}

/** `{ table: { column: declaredType } }` for every table in a database. */
export function shapeOf(db) {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all();

  const shape = {};
  for (const { name } of tables) {
    const columns = {};
    for (const row of db.prepare(`PRAGMA table_info(${name})`).all()) {
      columns[row.name] = String(row.type).toUpperCase();
    }
    shape[name] = columns;
  }
  return shape;
}

/** Every index name in a database, excluding the ones SQLite makes itself. */
export function indexesOf(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((row) => row.name)
    .sort();
}
