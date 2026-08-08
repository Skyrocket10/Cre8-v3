'use client';

/**
 * Sign in / sign up.
 *
 * One component for both, because the two differ by a single field and a
 * single call — splitting them duplicates the error handling and the key
 * derivation, which is where the subtlety lives.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { api, ApiError, isHosted } from '@/lib/api/client';
import { deriveKey, passwordProblem } from '@/lib/auth/derive';
import { useSession } from '@/lib/auth/session';
import { cn } from '@/lib/utils/cn';
import { Button } from '../ui/primitives';

export function AuthForm({
  mode,
  inviteToken,
  onDone,
}: {
  mode: 'signin' | 'signup';
  inviteToken?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { applySession, setActiveTeam } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);

  const isSignUp = mode === 'signup';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (isSignUp) {
      const problem = passwordProblem(password);
      if (problem) {
        setError({ message: problem });
        return;
      }
    }

    setBusy(true);
    try {
      // The password stops here — only a PBKDF2 derivative crosses the wire.
      const derived = await deriveKey(email, password);
      const session = isSignUp
        ? await api.signUp(email, derived, name)
        : await api.signIn(email, derived);

      applySession(session.user, session.teams);

      if (inviteToken) {
        // Redeeming is its own failure mode — the account exists either way,
        // so a stale link must not read as "sign-up failed".
        let accepted;
        try {
          accepted = await api.acceptInvite(inviteToken);
        } catch (caught) {
          setError({
            message: caught instanceof ApiError ? caught.message : 'Could not accept the invite',
            detail: `Your account is ready and you are signed in as ${email}. Ask for a fresh invite link to join the team.`,
          });
          setBusy(false);
          return;
        }
        applySession(session.user, accepted.teams);
        // Land in the workspace they were invited to, not their own — being
        // dropped into an empty personal space is the whole invite wasted.
        setActiveTeam(accepted.teamId);
      }

      onDone?.();
      router.push('/');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? { message: caught.message, detail: caught.detail }
          : { message: 'Something went wrong. Try again.' }
      );
    } finally {
      setBusy(false);
    }
  };

  if (!isHosted) {
    return (
      <Notice
        title="No workspace connected"
        body="This build stores projects in your browser. Accounts need NEXT_PUBLIC_CRE8_API_URL pointing at a deployed Cre8 API."
      />
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3">
      {isSignUp && (
        <Field label="Your name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Ada Lovelace"
            className={inputClass}
          />
        </Field>
      )}

      <Field label="Email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@company.com"
          className={inputClass}
        />
      </Field>

      <Field label="Password">
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          placeholder={isSignUp ? 'At least 10 characters' : '••••••••••'}
          className={inputClass}
        />
      </Field>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--danger)]/35 bg-[var(--danger-subtle)] px-3 py-2">
          <TriangleAlert size={13} className="mt-px shrink-0 text-[var(--danger)]" />
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-[var(--danger)]">{error.message}</p>
            {error.detail && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                {error.detail}
              </p>
            )}
          </div>
        </div>
      )}

      <Button type="submit" size="md" variant="primary" loading={busy} className="mt-1 w-full">
        {busy ? 'Securing your password…' : isSignUp ? 'Create account' : 'Sign in'}
        {!busy && <ArrowRight size={12} />}
      </Button>

      {/* Worth saying: a second of PBKDF2 in the browser looks like a hang. */}
      {busy && (
        <p className="text-center text-[10.5px] text-[var(--text-faint)]">
          Hashing locally so your password never leaves this device.
        </p>
      )}

      <p className="pt-1 text-center text-[11.5px] text-[var(--text-muted)]">
        {isSignUp ? 'Already have an account? ' : 'No account yet? '}
        <Link
          href={isSignUp ? '/signin' : '/signup'}
          className="text-[var(--accent)] transition-opacity hover:opacity-80"
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </form>
  );
}

const inputClass = cn(
  'h-9 w-full rounded-md bg-[var(--field)] px-2.5 text-[12.5px] text-[var(--text)]',
  'outline-none transition-colors placeholder:text-[var(--text-faint)]',
  'hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset'
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-4 py-3">
      <p className="text-[12.5px] font-medium text-[var(--text)]">{title}</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

/** Shared shell so both auth pages and the invite page look like one product. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--app)] px-6 py-12">
      <div className="anim-slide-up w-full max-w-[360px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--text)] text-[var(--app)]">
            <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M4 3h5.6a5 5 0 0 1 0 10H7.2v4H4V3Zm3.2 2.8v4.4h2.4a2.2 2.2 0 0 0 0-4.4H7.2Z" />
            </svg>
          </span>
          <div>
            <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
