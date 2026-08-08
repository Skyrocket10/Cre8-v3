/**
 * Account routes: sign up, sign in, sign out, whoami.
 *
 * The password never reaches this file — the browser sends a PBKDF2-derived
 * key and the Worker peppers it. See lib/crypto.ts for why the work is split
 * that way.
 */

import {
  cleanName,
  hashToken,
  hueFor,
  isDerivedKey,
  makeVerifier,
  newId,
  normaliseEmail,
  randomToken,
  timingSafeEqual,
} from '../lib/crypto';
import {
  createSession,
  createTeam,
  deleteSession,
  findUserByEmail,
  purgeExpiredSessions,
  teamsForUser,
} from '../lib/db';
import {
  badRequest,
  clearedSessionCookie,
  conflict,
  json,
  readCookie,
  readJson,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookie,
  unauthorised,
} from '../lib/http';
import type { Env, SessionUser } from '../types';

interface CredentialsBody {
  email?: unknown;
  derivedKey?: unknown;
  name?: unknown;
}

/**
 * A verifier that no derived key will ever match, used to keep the failure
 * path for an unknown email identical in shape and cost to a wrong password.
 */
const DUMMY_VERIFIER = 'f'.repeat(64);

export async function handleSignUp(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  if (env.ALLOW_SIGNUP === 'false') {
    throw badRequest('Signups are closed', 'This instance is not accepting new accounts.');
  }

  const body = await readJson<CredentialsBody>(request);
  const email = normaliseEmail(body.email);
  if (!email) throw badRequest('Enter a valid email address');
  if (!isDerivedKey(body.derivedKey)) {
    throw badRequest('Malformed credentials', 'The client did not derive a key correctly.');
  }

  const existing = await findUserByEmail(env, email);
  if (existing) {
    throw conflict('That email already has an account', 'Sign in instead.');
  }

  const now = Date.now();
  const user = {
    id: newId(),
    email,
    name: cleanName(body.name, email.split('@')[0] ?? 'You'),
    verifier: await makeVerifier(body.derivedKey, env.AUTH_PEPPER),
    hue: await hueFor(email),
  };

  await env.DB.prepare(
    `INSERT INTO users (id, email, name, verifier, auth_version, avatar_hue, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)`
  )
    .bind(user.id, user.email, user.name, user.verifier, user.hue, now)
    .run();

  // Everything is owned by a team, so a solo account still gets one. Sharing
  // later is then a membership row rather than a data migration.
  await createTeam(env, `${user.name}'s workspace`, user.id, true);

  return startSession(env, request, { id: user.id, email, name: user.name, avatarHue: user.hue }, cors);
}

export async function handleSignIn(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const body = await readJson<CredentialsBody>(request);
  const email = normaliseEmail(body.email);
  if (!email || !isDerivedKey(body.derivedKey)) {
    throw unauthorised('Wrong email or password');
  }

  const row = await findUserByEmail(env, email);
  const candidate = await makeVerifier(body.derivedKey, env.AUTH_PEPPER);

  // Compare even when the account is unknown, against a fixed dummy. Bailing
  // early would make "no such account" measurably faster than "wrong
  // password" and turn the endpoint into an account-existence oracle.
  const matches = timingSafeEqual(candidate, row?.verifier ?? DUMMY_VERIFIER);
  if (!row || !matches) throw unauthorised('Wrong email or password');

  return startSession(
    env,
    request,
    { id: row.id, email: row.email, name: row.name, avatarHue: row.avatar_hue },
    cors
  );
}

export async function handleSignOut(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await deleteSession(env, await hashToken(token));
  return json({ ok: true }, 200, { ...cors, 'set-cookie': clearedSessionCookie() });
}

export async function handleMe(
  env: Env,
  user: SessionUser | null,
  cors: Record<string, string>
): Promise<Response> {
  if (!user) return json({ user: null, teams: [] }, 200, cors);
  return json({ user, teams: await teamsForUser(env, user.id) }, 200, cors);
}

async function startSession(
  env: Env,
  request: Request,
  user: SessionUser,
  cors: Record<string, string>
): Promise<Response> {
  const token = randomToken();
  await createSession(
    env,
    user.id,
    await hashToken(token),
    request.headers.get('user-agent'),
    SESSION_TTL_MS
  );

  // Cheap enough to fold into the login path rather than run a cron for it.
  await purgeExpiredSessions(env).catch(() => undefined);

  return json({ user, teams: await teamsForUser(env, user.id) }, 200, {
    ...cors,
    'set-cookie': sessionCookie(token, SESSION_TTL_MS / 1000),
  });
}
