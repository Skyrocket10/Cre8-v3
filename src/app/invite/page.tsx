'use client';

/**
 * Invite landing page.
 *
 * Shows who invited you and to what *before* asking for anything, then routes
 * to the right action: accept if you're already signed in as the invited
 * address, otherwise sign in or create an account and accept in one step.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/auth/session';
import { AuthForm, AuthShell, Notice } from '@/components/auth/auth-form';
import { Button } from '@/components/ui/primitives';

export default function InvitePage() {
  return (
    <Suspense fallback={<AuthShell title="Loading invite…">{null}</AuthShell>}>
      <InviteInner />
    </Suspense>
  );
}

interface InviteDetails {
  email: string;
  role: string;
  teamName: string;
  invitedBy: string;
}

function InviteInner() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const { status, mode, user, applySession, setActiveTeam } = useSession();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This link is missing its invite code.');
      return;
    }
    // This page is deliberately outside the auth guard — you should be able to
    // read an invite before you have an account — so it has to wait for the
    // backend probe itself. Peeking any earlier fails as "no workspace".
    if (status === 'loading') return;
    if (mode === 'local') {
      setError('This build has no workspace connected.');
      return;
    }
    api
      .peekInvite(token)
      .then(setInvite)
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Could not load this invite.')
      );
  }, [token, status, mode]);

  const accept = useCallback(async () => {
    setBusy(true);
    try {
      const accepted = await api.acceptInvite(token);
      applySession(user, accepted.teams);
      // Straight into the workspace they just joined.
      setActiveTeam(accepted.teamId);
      router.push('/');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not accept this invite.');
      setBusy(false);
    }
  }, [token, user, applySession, setActiveTeam, router]);

  if (error) {
    return (
      <AuthShell title="Invite unavailable">
        <Notice title={error} body="Ask whoever invited you to send a fresh link." />
      </AuthShell>
    );
  }

  if (!invite) return <AuthShell title="Loading invite…">{null}</AuthShell>;

  const subtitle = (
    <>
      <strong className="text-[var(--text)]">{invite.invitedBy}</strong> invited you to join{' '}
      <strong className="text-[var(--text)]">{invite.teamName}</strong> as {invite.role}.
    </>
  );

  // Already signed in as the invited address — one button, nothing else.
  if (status === 'signed-in' && user?.email === invite.email) {
    return (
      <AuthShell title="Join the team" subtitle={subtitle}>
        <Button size="md" variant="primary" loading={busy} onClick={accept} className="w-full">
          <Users size={13} />
          Join {invite.teamName}
        </Button>
      </AuthShell>
    );
  }

  // Signed in as somebody else. The invite names an address, so honouring it
  // for a different account would let a leaked link be redeemed by anyone.
  if (status === 'signed-in') {
    return (
      <AuthShell title="Wrong account" subtitle={subtitle}>
        <Notice
          title={`This invite is for ${invite.email}`}
          body={`You are signed in as ${user?.email}. Sign out and sign back in as the invited address to accept.`}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join the team" subtitle={subtitle}>
      <AuthForm mode="signup" inviteToken={token} />
    </AuthShell>
  );
}
