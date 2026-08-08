/**
 * Teams, membership and invites.
 *
 * Invites are link-based rather than email-based: this instance has no mail
 * provider wired in, and inventing one would be a bigger commitment than the
 * feature warrants. The API mints a single-use token, the UI shows the link,
 * and you send it however you like. Swapping in Resend later means calling it
 * at one place in `handleCreateInvite` — the token flow doesn't change.
 */

import { cleanName, hashToken, newId, normaliseEmail, randomToken } from '../lib/crypto';
import { createTeam, requireTeamRole, roleInTeam, teamsForUser } from '../lib/db';
import { badRequest, conflict, forbidden, json, notFound, readJson } from '../lib/http';
import { ROLE_RANK, type Env, type Role, type SessionUser } from '../types';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ASSIGNABLE: Role[] = ['admin', 'editor', 'viewer'];

export async function handleCreateTeam(
  request: Request,
  env: Env,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const body = await readJson<{ name?: unknown }>(request);
  const name = cleanName(body.name, '');
  if (!name) throw badRequest('Give the team a name');

  const team = await createTeam(env, name, user.id, false);
  return json({ team: { id: team.id, name: team.name, role: 'owner', personal: false, memberCount: 1 } }, 200, cors);
}

export async function handleListTeams(
  env: Env,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  return json({ teams: await teamsForUser(env, user.id) }, 200, cors);
}

export async function handleListMembers(
  env: Env,
  teamId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireTeamRole(env, teamId, user, 'viewer');

  const members = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.avatar_hue, m.role, m.created_at
       FROM team_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ?1
      ORDER BY CASE m.role
                 WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
                 WHEN 'editor' THEN 2 ELSE 3 END,
               u.name`
  )
    .bind(teamId)
    .all<{ id: string; name: string; email: string; avatar_hue: number; role: Role; created_at: number }>();

  const invites = await env.DB.prepare(
    `SELECT id, email, role, created_at, expires_at
       FROM invites
      WHERE team_id = ?1 AND accepted_at IS NULL AND expires_at > ?2
      ORDER BY created_at DESC`
  )
    .bind(teamId, Date.now())
    .all<{ id: string; email: string; role: Role; created_at: number; expires_at: number }>();

  return json(
    {
      members: members.results.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        avatarHue: m.avatar_hue,
        role: m.role,
        joinedAt: m.created_at,
      })),
      invites: invites.results,
    },
    200,
    cors
  );
}

export async function handleCreateInvite(
  request: Request,
  env: Env,
  teamId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireTeamRole(env, teamId, user, 'admin');

  const body = await readJson<{ email?: unknown; role?: unknown }>(request);
  const email = normaliseEmail(body.email);
  if (!email) throw badRequest('Enter a valid email address');

  const role = typeof body.role === 'string' && ASSIGNABLE.includes(body.role as Role)
    ? (body.role as Role)
    : 'editor';

  const already = await env.DB.prepare(
    `SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ?1 AND u.email = ?2`
  )
    .bind(teamId, email)
    .first();
  if (already) throw conflict('That person is already on the team');

  const token = randomToken();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO invites (id, team_id, email, role, token_hash, invited_by, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(newId(), teamId, email, role, await hashToken(token), user.id, now, now + INVITE_TTL_MS)
    .run();

  // The raw token is returned exactly once, here. Only its hash is stored, so
  // it cannot be recovered from the database later.
  return json({ token, email, role, expiresAt: now + INVITE_TTL_MS }, 200, cors);
}

export async function handleRevokeInvite(
  env: Env,
  teamId: string,
  inviteId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  await requireTeamRole(env, teamId, user, 'admin');
  await env.DB.prepare(`DELETE FROM invites WHERE id = ?1 AND team_id = ?2`)
    .bind(inviteId, teamId)
    .run();
  return json({ ok: true }, 200, cors);
}

/** Look up an invite without consuming it, so the UI can show what's on offer. */
export async function handlePeekInvite(
  env: Env,
  token: string,
  cors: Record<string, string>
): Promise<Response> {
  const invite = await env.DB.prepare(
    `SELECT i.email, i.role, i.expires_at, t.name AS team_name, u.name AS invited_by
       FROM invites i
       JOIN teams t ON t.id = i.team_id
       JOIN users u ON u.id = i.invited_by
      WHERE i.token_hash = ?1 AND i.accepted_at IS NULL AND i.expires_at > ?2`
  )
    .bind(await hashToken(token), Date.now())
    .first<{ email: string; role: Role; expires_at: number; team_name: string; invited_by: string }>();

  if (!invite) throw notFound('This invite has expired or already been used');

  return json(
    {
      email: invite.email,
      role: invite.role,
      teamName: invite.team_name,
      invitedBy: invite.invited_by,
    },
    200,
    cors
  );
}

export async function handleAcceptInvite(
  request: Request,
  env: Env,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const body = await readJson<{ token?: unknown }>(request);
  if (typeof body.token !== 'string') throw badRequest('Missing invite token');

  const tokenHash = await hashToken(body.token);
  const invite = await env.DB.prepare(
    `SELECT id, team_id, email, role FROM invites
      WHERE token_hash = ?1 AND accepted_at IS NULL AND expires_at > ?2`
  )
    .bind(tokenHash, Date.now())
    .first<{ id: string; team_id: string; email: string; role: Role }>();

  if (!invite) throw notFound('This invite has expired or already been used');

  // The invite names an address. Honouring it for a different signed-in
  // account would let a leaked link be redeemed by whoever found it.
  if (invite.email !== user.email) {
    throw forbidden(
      'This invite is for a different account',
      `It was sent to ${invite.email}. Sign in as that account to accept it.`
    );
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (team_id, user_id) DO NOTHING`
    ).bind(invite.team_id, user.id, invite.role, now),
    env.DB.prepare(`UPDATE invites SET accepted_at = ?1 WHERE id = ?2`).bind(now, invite.id),
  ]);

  return json({ teams: await teamsForUser(env, user.id), teamId: invite.team_id }, 200, cors);
}

export async function handleUpdateMember(
  request: Request,
  env: Env,
  teamId: string,
  memberId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const callerRole = await requireTeamRole(env, teamId, user, 'admin');
  const body = await readJson<{ role?: unknown }>(request);
  const role = body.role;
  if (typeof role !== 'string' || !(role in ROLE_RANK)) throw badRequest('Unknown role');

  const targetRole = await roleInTeam(env, teamId, memberId);
  if (!targetRole) throw notFound('Not a member of this team');

  // An admin must not be able to promote past themselves, demote an owner, or
  // hand out ownership — otherwise "admin" is quietly equivalent to "owner".
  if (targetRole === 'owner' || role === 'owner') {
    throw forbidden('Ownership can only be changed by the owner');
  }
  if (ROLE_RANK[role as Role] > ROLE_RANK[callerRole]) {
    throw forbidden('You cannot grant a role above your own');
  }

  await env.DB.prepare(`UPDATE team_members SET role = ?1 WHERE team_id = ?2 AND user_id = ?3`)
    .bind(role, teamId, memberId)
    .run();
  return json({ ok: true }, 200, cors);
}

export async function handleRemoveMember(
  env: Env,
  teamId: string,
  memberId: string,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  // Leaving is always allowed; removing someone else needs admin.
  if (memberId !== user.id) await requireTeamRole(env, teamId, user, 'admin');
  else await requireTeamRole(env, teamId, user, 'viewer');

  const targetRole = await roleInTeam(env, teamId, memberId);
  if (!targetRole) throw notFound('Not a member of this team');
  if (targetRole === 'owner') {
    throw forbidden('The owner cannot be removed', 'Transfer ownership first.');
  }

  await env.DB.prepare(`DELETE FROM team_members WHERE team_id = ?1 AND user_id = ?2`)
    .bind(teamId, memberId)
    .run();
  return json({ ok: true }, 200, cors);
}
