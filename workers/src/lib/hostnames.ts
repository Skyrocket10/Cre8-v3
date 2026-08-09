/**
 * Where a published site answers.
 *
 * A project earns a hostname on its first publish — not at creation, since most
 * projects are never published and would just be squatting on names. That put
 * this code on the publish path, and D6 gave the publish path a second caller
 * with no request and no session behind it, so it moved out of the route and
 * into here rather than being reached for across a cycle.
 *
 * The KV map is the only thing the published-sites Worker reads: hostname →
 * project id, written here, so serving a page never touches the database.
 */

import type { Env } from '../types';

const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'cdn', 'assets', 'static', 'mail', 'ftp',
  'dashboard', 'status', 'docs', 'blog', 'help', 'support', 'cre8',
]);

/**
 * Turn a project name into a hostname label.
 *
 * Deliberately narrow: lowercase, digits and single hyphens. Anything else and
 * the label either fails DNS or renders differently to how it reads, which for
 * something people will type is worse than being strict.
 */
export function slugifySubdomain(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function subdomainProblem(value: string): string | null {
  if (value.length < 3) return 'At least 3 characters';
  if (value.length > 40) return 'At most 40 characters';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return 'Lowercase letters, numbers and hyphens only';
  }
  if (RESERVED.has(value)) return 'That name is reserved';
  return null;
}

/**
 * Claim a hostname label for a project, retrying past collisions.
 *
 * The unique index is the real arbiter — two people publishing similarly named
 * projects at the same moment both pass a `SELECT` check, and only the write
 * can settle it. So the insert is what we retry on, not the lookup.
 */
export async function claimSubdomain(
  env: Env,
  projectId: string,
  preferred: string
): Promise<string> {
  const base = slugifySubdomain(preferred) || 'site';
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    if (subdomainProblem(candidate)) continue;
    try {
      const { meta } = await env.DB.prepare(
        `UPDATE projects SET subdomain = ?1 WHERE id = ?2 AND subdomain IS NULL`
      )
        .bind(candidate, projectId)
        .run();
      if (meta.changes > 0) return candidate;
      // Already had one; whatever it is, that is the answer.
      const row = await env.DB.prepare(`SELECT subdomain FROM projects WHERE id = ?1`)
        .bind(projectId)
        .first<{ subdomain: string | null }>();
      if (row?.subdomain) return row.subdomain;
    } catch {
      // Unique-index collision. Try again with a suffix.
    }
  }
  // Fall back to something that cannot collide.
  await env.DB.prepare(`UPDATE projects SET subdomain = ?1 WHERE id = ?2`)
    .bind(projectId, projectId)
    .run();
  return projectId;
}

function randomSuffix(): string {
  return Math.abs(
    [...crypto.getRandomValues(new Uint8Array(3))].reduce((a, b) => a * 256 + b, 0)
  )
    .toString(36)
    .slice(0, 4);
}

/** Point a hostname at a project, so the sites Worker needs no database. */
export async function mapHostname(env: Env, subdomain: string, projectId: string): Promise<void> {
  if (!env.PUBLIC_SITE_DOMAIN) return;
  await env.SITE_ROUTES.put(`${subdomain}.${env.PUBLIC_SITE_DOMAIN}`.toLowerCase(), projectId);
}

/**
 * Stop a hostname resolving.
 *
 * Used when an address is given up or a project is deleted. Leaving it in place
 * would mean a site still answering at an address its owner believes they no
 * longer have.
 */
export async function unmapHostname(env: Env, subdomain: string | null): Promise<void> {
  if (!subdomain || !env.PUBLIC_SITE_DOMAIN) return;
  await env.SITE_ROUTES.delete(
    `${subdomain}.${env.PUBLIC_SITE_DOMAIN}`.toLowerCase()
  ).catch(() => undefined);
}
