'use client';

import { Skeleton } from '../ui/primitives';

/** Matches the real layout so the transition to the loaded editor is calm. */
export function EditorSkeleton() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--app)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-2.5">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-4 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-6 w-[132px] rounded-md" />
        <div className="flex-1" />
        <Skeleton className="h-6 w-20 rounded-md" />
        <Skeleton className="h-6 w-20 rounded-md" />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-[var(--border)] py-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="size-7 rounded-md" />
          ))}
        </div>

        <div className="w-[264px] shrink-0 space-y-1.5 border-r border-[var(--border)] p-2">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-5 rounded" style={{ opacity: 1 - i * 0.09 }} />
          ))}
        </div>

        <div className="canvas-surface flex flex-1 items-start justify-center pt-12">
          <Skeleton className="h-[70vh] w-[min(1100px,80%)] rounded-lg" />
        </div>

        <div className="w-[288px] shrink-0 space-y-2 border-l border-[var(--border)] p-3">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-6 rounded" style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      </div>

      <div className="h-7 shrink-0 border-t border-[var(--border)]" />
    </div>
  );
}
