/**
 * Data access and authorisation.
 *
 * Every read or write of a project goes through `requireProjectAccess`, which
 * resolves the caller's role from team membership. There is no path that
 * touches a project row without proving membership first — that is the whole
 * authorisation model, kept in one place so it can be audited by reading one
 * function rather than every route.
 */

import { forbidden, notFound, unauthorised } from './http';
import { hashToken, newId } from './crypto';
import { ROLE_RANK, type Env, type ProjectRow, type Role, type SessionUser, type TeamRow, type UserRow } from '../types';

/* --------------------------------------------------------------------------
 * Sessions
 * ----------------------------------------------------------------------- */

export async function userForToken(env: Env, token: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.avatar_hue
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.expires_at > ?2`
  )
    .bind(await hashToken(token), Date.now())
    .first<{ id: string; email: string; name: string; avatar_hue: number }>();

  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, avatarHue: row.avatar_hue };
}

export async function createSession(
  env: Env,
  userId: string,
  tokenHash: string,
  userAgent: string | null,
  ttlMs: number
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(tokenHash, userId, now, now + ttlMs, userAgent?.slice(0, 256) ?? null)
    .run();
}

export async function deleteSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(tokenHash).run();
}

/** Housekeeping so the table doesn't grow without bound. */
export async function purgeExpiredSessions(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(Date.now()).run();
}

/* --------------------------------------------------------------------------
 * Users
 * ----------------------------------------------------------------------- */

export async function findUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT * FROM users WHERE email = ?1`).bind(email).first<UserRow>();
}

/* --------------------------------------------------------------------------
 * Teams
 * ----------------------------------------------------------------------- */

export interface TeamWithRole {
  id: string;
  name: string;
  role: Role;
  personal: boolean;
  memberCount: number;
}

export async function teamsForUser(env: Env, userId: string): Promise<TeamWithRole[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.personal, m.role,
            (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
       FROM team_members m
       JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = ?1
      ORDER BY t.personal DESC, t.created_at ASC`
  )
    .bind(userId)
    .all<{ id: string; name: string; personal: number; role: Role; member_count: number }>();

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    personal: r.personal === 1,
    memberCount: r.member_count,
  }));
}

export async function roleInTeam(env: Env, teamId: string, userId: string): Promise<Role | null> {
  const row = await env.DB.prepare(
    `SELECT role FROM team_members WHERE team_id = ?1 AND user_id = ?2`
  )
    .bind(teamId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

export async function requireTeamRole(
  env: Env,
  teamId: string,
  user: SessionUser | null,
  minimum: Role
): Promise<Role> {
  if (!user) throw unauthorised();
  const role = await roleInTeam(env, teamId, user.id);
  // Same response for "no such team" and "not a member": otherwise the API
  // confirms the existence of teams the caller has no business knowing about.
  if (!role) throw notFound('Team not found');
  if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
    throw forbidden(`Requires ${minimum} access`, `You are ${role} on this team.`);
  }
  return role;
}

export async function createTeam(
  env: Env,
  name: string,
  ownerId: string,
  personal: boolean
): Promise<TeamRow> {
  const now = Date.now();
  const team: TeamRow = {
    id: newId(),
    name,
    created_by: ownerId,
    created_at: now,
    personal: personal ? 1 : 0,
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO teams (id, name, created_by, created_at, personal) VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(team.id, team.name, ownerId, now, team.personal),
    env.DB.prepare(
      `INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)`
    ).bind(team.id, ownerId, now),
  ]);

  return team;
}

/* --------------------------------------------------------------------------
 * Projects
 * ----------------------------------------------------------------------- */

export interface ProjectAccess {
  project: ProjectRow;
  role: Role;
}

/**
 * The single gate for project data.
 *
 * Resolves the project and the caller's role in one query, then enforces the
 * minimum. A missing project and an inaccessible one both return 404 so the
 * API never confirms that someone else's project id exists.
 */
export async function requireProjectAccess(
  env: Env,
  projectId: string,
  user: SessionUser | null,
  minimum: Role
): Promise<ProjectAccess> {
  if (!user) throw unauthorised();

  const row = await env.DB.prepare(
    `SELECT p.*, m.role AS caller_role
       FROM projects p
       LEFT JOIN team_members m ON m.team_id = p.team_id AND m.user_id = ?2
      WHERE p.id = ?1`
  )
    .bind(projectId, user.id)
    .first<ProjectRow & { caller_role: Role | null }>();

  if (!row?.caller_role) throw notFound('Project not found');
  if (ROLE_RANK[row.caller_role] < ROLE_RANK[minimum]) {
    throw forbidden(`Requires ${minimum} access`, `You are ${row.caller_role} on this team.`);
  }

  const { caller_role, ...project } = row;
  return { project: project as ProjectRow, role: caller_role };
}

export async function requireUser(user: SessionUser | null): Promise<SessionUser> {
  if (!user) throw unauthorised();
  return user;
}
