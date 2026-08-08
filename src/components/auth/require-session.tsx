'use client';

/**
 * Route guard.
 *
 * Only guards hosted builds. With no API configured there is no account to
 * require, and bouncing someone to a sign-in page that says "no workspace
 * connected" would be a dead end — so local mode renders straight through.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/session';

export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signed-out') router.replace('/signin');
  }, [status, router]);

  if (status === 'local' || status === 'signed-in') return <>{children}</>;

  // 'loading' and the frame between 'signed-out' and the redirect landing.
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--app)]">
      <span className="anim-spin size-5 rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text-muted)]" />
    </div>
  );
}
