/**
 * Bringing a deployed database up to the code that is running against it.
 *
 * The only operation here is additive DDL from a fixed list — see
 * `lib/schema.ts`, which is where the reasoning lives. This file is the
 * authorisation and the wire format.
 */

import { json } from '../lib/http';
import { ensureSchema, inspectSchema, type SchemaReport } from '../lib/schema';
import type { Env, SessionUser } from '../types';

/** What the database is missing. */
export async function handleSchemaReport(
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  return json(describe(await inspectSchema(env.DB)), 200, cors);
}

/**
 * Add it.
 *
 * A session is the whole bar, and that is deliberate rather than an oversight.
 * A team role would look like authorisation and enforce nothing: signup
 * creates a personal team with the new account as its owner, so every account
 * that exists is already an owner of something, and the check would refuse
 * nobody. A guard that cannot fail is worse than none — it invites the next
 * person to trust it.
 *
 * What actually bounds this is the operation. It issues `ALTER TABLE … ADD
 * COLUMN` for a list fixed at build time, reads no rows and writes none, and
 * every column it can add is one the running code already expects. The worst
 * an unwelcome caller achieves is making publishing work.
 *
 * The alternative — an operator secret — buys a threat model this does not
 * have, at the price of an instance that cannot repair itself until whoever
 * holds the secret wakes up.
 */
export async function handleSchemaUpgrade(
  env: Env,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const report = await ensureSchema(env.DB);
  if (report.added.length || report.indexes.length) {
    console.log('[cre8-api] schema upgraded', {
      by: user.id,
      added: report.added,
      indexes: report.indexes,
    });
  }
  return json(describe(report), 200, cors);
}

/** The report, plus a sentence saying what it means. */
function describe(report: SchemaReport): SchemaReport & { message: string } {
  return { ...report, message: summarise(report) };
}

function summarise(report: SchemaReport): string {
  if (report.missingTables.length) {
    return (
      `No ${report.missingTables.join(' or ')} table. This database was never ` +
      'initialised — run `npm run db:init` rather than patching columns onto it.'
    );
  }
  const done: string[] = [];
  if (report.added.length) done.push(`added ${report.added.join(', ')}`);
  if (report.indexes.length) done.push(`created index ${report.indexes.join(', ')}`);
  if (done.length) return `Up to date: ${done.join('; ')}.`;
  if (report.pending.length) return `Missing ${report.pending.join(', ')}. POST here to add them.`;
  return 'Already up to date.';
}
