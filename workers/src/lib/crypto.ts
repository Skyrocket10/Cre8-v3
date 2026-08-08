/**
 * Credential and token handling.
 *
 * ## Where the work happens
 *
 * The expensive key derivation runs in the *browser*, not here. Workers on the
 * free plan get 10ms of CPU per request, and PBKDF2 at any defensible
 * iteration count costs an order of magnitude more than that, so a
 * conventional server-side KDF simply cannot run on this platform.
 *
 * So the split is:
 *
 *   browser   derived = PBKDF2-SHA256(password, SHA256("cre8-auth:" + email),
 *                                     600_000 iterations, 32 bytes)
 *   worker    verifier = HMAC-SHA256(PEPPER, derived)
 *
 * The server never sees the password, and the stored verifier is useless
 * without `PEPPER` — which lives in a Worker secret, not in D1. A database
 * leak alone therefore yields nothing to attack offline; an attacker needs the
 * secret store too, and even then faces the browser's 600k-iteration KDF.
 *
 * The salt is derived from the email rather than random. Salts need to be
 * unique per user, not secret, and deriving it means the client can start
 * hashing without first asking the server for a salt — which would have leaked
 * whether an account exists.
 *
 * The trade this makes: the derived key is password-equivalent in transit, so
 * it relies on TLS exactly as a plaintext password would. Nothing is weaker
 * than the conventional design; the offline-attack cost has simply moved to
 * the client where there is CPU budget for it.
 */

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const byte of view) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Random, URL-safe, 256 bits of entropy. Used for session and invite tokens. */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function newId(): string {
  return crypto.randomUUID();
}

/** What gets stored for a bearer-style token, so a leak isn't a live credential. */
export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}

/** Turn the client's derived key into the value stored in D1. */
export async function makeVerifier(derivedKeyHex: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(derivedKeyHex)));
}

/**
 * Comparison whose running time doesn't depend on where the first difference
 * is — otherwise the response time leaks the verifier a byte at a time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* --------------------------------------------------------------------------
 * Validation
 * ----------------------------------------------------------------------- */

/** Deliberately permissive: the only authority on a valid address is delivery. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** The client sends 32 bytes of PBKDF2 output as hex; anything else is a bug or an attack. */
export function isDerivedKey(input: unknown): input is string {
  return typeof input === 'string' && /^[0-9a-f]{64}$/.test(input);
}

export function cleanName(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  const name = input.trim().replace(/\s+/g, ' ').slice(0, 64);
  return name || fallback;
}

/** Stable per-user colour for avatars and collaboration cursors. */
export async function hueFor(email: string): Promise<number> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(email)));
  return ((digest[0]! << 8) | digest[1]!) % 360;
}
