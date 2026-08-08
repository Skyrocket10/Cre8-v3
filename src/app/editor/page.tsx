'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RequireSession } from '@/components/auth/require-session';
import { EditorShell } from '@/components/editor/editor-shell';
import { EditorSkeleton } from '@/components/editor/editor-skeleton';

/**
 * The editor route.
 *
 * The project id arrives as `?p=` rather than a path segment so the whole app
 * can be exported as static files — see `lib/routes.ts`.
 */
export default function EditorRoute() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <RequireSession>
        <EditorRouteInner />
      </RequireSession>
    </Suspense>
  );
}

function EditorRouteInner() {
  const projectId = useSearchParams().get('p');

  if (!projectId) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-[var(--app)] px-6 text-center">
        <p className="text-[14px] font-medium text-[var(--text)]">No project selected</p>
        <p className="max-w-[300px] text-[12px] leading-relaxed text-[var(--text-muted)]">
          Open a project from the dashboard, or start a new one from a template.
        </p>
        <Link
          href="/"
          className="mt-1 rounded-md bg-[var(--field)] px-3 py-1.5 text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
        >
          All projects
        </Link>
      </div>
    );
  }

  return <EditorShell key={projectId} projectId={projectId} />;
}
