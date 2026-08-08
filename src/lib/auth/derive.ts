'use client';

/**
 * Client-side key derivation.
 *
 * The password never leaves this function. What goes over the wire is 32 bytes
 * of PBKDF2 output, which the Worker peppers with a server-held secret before
 * storing — see workers/src/lib/crypto.ts for the full reasoning.
 *
 * The work lives here because Workers on the free plan get 10ms of CPU per
 * request and a defensible iteration count costs far more than that. Moving it
 * to the browser is what lets the iteration count be high enough to matter:
 * there is real CPU budget on this side, and a login taking a second is fine.
 */

const ITERATIONS = 600_000;
const KEY_BITS = 256;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * The salt is derived from the email rather than random.
 *
 * Salts must be unique per user, not secret — and deriving it means the client
 * can start hashing immediately. Asking the server for a per-account salt
 * would have turned sign-in into an account-existence oracle before the
 * password was even checked.
 */
async function saltFor(email: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(`cre8-auth:${email}`));
}

export async function deriveKey(email: string, password: string): Promise<string> {
  const normalised = email.trim().toLowerCase();

  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: await saltFor(normalised),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    KEY_BITS
  );

  return toHex(bits);
}

/**
 * Minimum bar for a new password.
 *
 * Deliberately length-first rather than a character-class checklist: length is
 * what actually costs an attacker, and complexity rules mostly produce
 * `Password1!`.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters';
  if (/^\d+$/.test(password)) return 'Digits alone are easy to guess';
  if (/^(.)\1+$/.test(password)) return 'That is one character repeated';
  return null;
}
