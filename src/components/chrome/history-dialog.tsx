'use client';

/**
 * Publish history.
 *
 * Two questions, and they want different answers on the same screen: *when did
 * the site last change, and was that me?* — which every publish answers,
 * including the ones nobody asked for — and *can I put last week's design
 * back?* — which only some of them do.
 *
 * So the list is complete and the Restore button is not. A row with no button
 * says why it has none, because "some rows have one and some don't" is the
 * sort of thing a person will otherwise read as a bug.
 *
 * The sentence at the bottom is load-bearing. Restoring re-publishes an old
 * *design* against today's records — it does not roll content back — and
 * somebody expecting "undo the last month" would be right to be surprised by
 * that if nothing said so before they clicked.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Clock, History, RotateCcw, User } from 'lucide-react';
import { api, ApiError } from '@/lib/api/client';
import { useEditor } from '@/lib/editor/store';
import { cn, formatBytes, relativeTime } from '@/lib/utils/cn';
import { Button, EmptyState, Skeleton } from '../ui/primitives';
import { Modal } from './publish-dialog';

type Deployment = Awaited<ReturnType<typeof api.deployments>>['deployments'][number];

export function HistoryDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Deployment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { deployments } = await api.deployments(projectId);
      setRows(deployments);
    } catch (caught) {
      setRows([]);
      setError(caught instanceof ApiError ? caught.message : 'Could not read the history');
    }
  }, [projectId]);

  // Re-read every time it opens rather than once: a background republish can
  // have happened since, and a history that is quietly stale is worse than no
  // history at all.
  useEffect(() => {
    if (!open) return;
    setRows(null);
    setConfirming(null);
    void load();
  }, [open, load]);

  const restore = async (id: string) => {
    setRestoring(id);
    setError(null);
    try {
      const result = await api.restoreDeployment(projectId, id);
      // The canvas moves on its own — the restore writes through the room and
      // the socket resyncs — so there is nothing to reload here. Say what it
      // did to the site, which is the part that is not visible from the editor.
      useEditor
        .getState()
        .toast(
          result.written
            ? `Design restored — ${result.written} file${result.written === 1 ? '' : 's'} rewritten`
            : 'Design restored — the site was already serving it',
          'success'
        );
      setConfirming(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not restore that version');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Publish history" width={460}>
      <div className="flex max-h-[min(560px,70vh)] flex-col">
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {rows === null ? (
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[52px] rounded-lg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<History size={16} />}
              title="Nothing published yet"
              description="Every publish is kept here, and the ones you make by hand can be put back."
              compact
            />
          ) : (
            <div className="flex flex-col gap-1">
              {rows.map((row, index) => (
                <Row
                  key={row.id}
                  deployment={row}
                  live={index === 0}
                  confirming={confirming === row.id}
                  busy={restoring === row.id}
                  onAsk={() => setConfirming(row.id)}
                  onCancel={() => setConfirming(null)}
                  onRestore={() => void restore(row.id)}
                />
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="border-t border-[var(--border-soft)] px-4 py-2.5 text-[11px] text-[var(--danger)]">
            {error}
          </p>
        )}

        <p className="border-t border-[var(--border-soft)] px-4 py-2.5 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
          Restoring brings back the <span className="text-[var(--text-secondary)]">design</span> and
          publishes it. Records are live, so today’s content stays where it is.
        </p>
      </div>
    </Modal>
  );
}

function Row({
  deployment,
  live,
  confirming,
  busy,
  onAsk,
  onCancel,
  onRestore,
}: {
  deployment: Deployment;
  live: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRestore: () => void;
}) {
  const automatic = deployment.publishedBy === null;

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 transition-colors',
        confirming
          ? 'border-[var(--accent)] bg-[var(--field)]'
          : 'border-[var(--border-soft)] bg-[var(--panel)]'
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md',
            automatic
              ? 'bg-[var(--field)] text-[var(--text-faint)]'
              : 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]'
          )}
        >
          {automatic ? <Clock size={11} /> : <User size={11} />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] text-[var(--text)]">
            {automatic ? 'Followed a content change' : (deployment.publishedBy?.name ?? 'Someone')}
            {live && (
              <span className="ml-1.5 rounded bg-[color-mix(in_srgb,var(--success)_18%,transparent)] px-1 py-px text-[9.5px] font-medium text-[var(--success)]">
                live
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] text-[var(--text-faint)]">
            {relativeTime(deployment.publishedAt)} · {describe(deployment)}
          </p>
        </div>

        {!live && deployment.restorable && !confirming && (
          <Button size="sm" variant="ghost" onClick={onAsk}>
            <RotateCcw size={11} />
            Restore
          </Button>
        )}
      </div>

      {confirming && (
        <div className="mt-2.5 flex items-center gap-2 border-t border-[var(--border-soft)] pt-2.5">
          <p className="flex-1 text-[10.5px] text-[var(--text-muted)]">
            Replace the live site with this design?
          </p>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={busy} onClick={onRestore}>
            Restore
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * What a publish did, in one clause.
 *
 * The counts, when there are any — because "2 files" is the number that makes
 * the diff visible to somebody who never reads a log. Falling back to the
 * size, which every row has.
 */
function describe(deployment: Deployment): string {
  const { changed, pageCount, bytes } = deployment;
  if (!changed) return `${pageCount} page${pageCount === 1 ? '' : 's'} · ${formatBytes(bytes)}`;

  const parts: string[] = [];
  if (changed.written) parts.push(`${changed.written} written`);
  if (changed.removed) parts.push(`${changed.removed} removed`);
  if (!parts.length) return `nothing to write · ${formatBytes(bytes)}`;
  return `${parts.join(', ')} · ${formatBytes(bytes)}`;
}
