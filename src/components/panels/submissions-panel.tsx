'use client';

/**
 * What visitors sent from the published site.
 *
 * Everything on this panel is text a stranger typed into a form on the open
 * internet, so it is rendered as text and never as anything else — field names
 * included, since those come from the document and can be edited to anything.
 * React escapes it, and the CSV download quotes it; there is no path here that
 * builds markup from a payload.
 *
 * Not part of the document, so it is fetched rather than read from the store,
 * and it is the one panel that can be genuinely empty for a healthy project.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Download, Inbox, RefreshCw } from 'lucide-react';
import { api, hasBackend, type FormSubmission } from '@/lib/api/client';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { Button, EmptyState, Tooltip } from '../ui/primitives';

export function SubmissionsPanel() {
  const projectId = useEditor((s) => s.doc.id);
  const lastPublished = useEditor((s) => s.doc.lastPublished);

  const [rows, setRows] = useState<FormSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!hasBackend()) return;
    setLoading(true);
    setError(null);
    try {
      const { submissions } = await api.submissions(projectId);
      setRows(submissions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load submissions');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!hasBackend()) {
    return (
      <EmptyState
        compact
        title="No workspace connected"
        description="Form submissions are stored by the Cre8 Worker. This build keeps projects in your browser, so there is nowhere for a published form to post."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="panel-title">
          {rows === null ? 'Submissions' : `${rows.length} submission${rows.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-1">
          {rows !== null && rows.length > 0 && (
            <Tooltip content="Download as CSV" side="bottom">
              <button
                type="button"
                aria-label="Download as CSV"
                onClick={() => downloadCsv(rows)}
                className="flex size-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--field-hover)] hover:text-[var(--text)]"
              >
                <Download size={13} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Refresh" side="bottom">
            <button
              type="button"
              aria-label="Refresh submissions"
              onClick={() => void load()}
              className="flex size-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--field-hover)] hover:text-[var(--text)]"
            >
              <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
        {error && (
          <EmptyState
            compact
            title="Could not load submissions"
            description={error}
            action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
          />
        )}

        {!error && rows !== null && rows.length === 0 && (
          <EmptyState
            compact
            icon={<Inbox size={18} />}
            title="Nothing yet"
            description={
              lastPublished
                ? 'Submissions from forms on your published site will appear here.'
                : 'Publish the site, and anything sent through a form on it will appear here.'
            }
          />
        )}

        {!error &&
          rows?.map((row) => <SubmissionCard key={row.id} submission={row} />)}
      </div>
    </div>
  );
}

function SubmissionCard({ submission }: { submission: FormSubmission }) {
  const entries = Object.entries(submission.payload);
  return (
    <article className="mb-1 rounded-md border border-[var(--border)] bg-[var(--field)] px-2.5 py-2">
      <header className="mb-1.5 flex items-baseline justify-between gap-2">
        <time
          dateTime={new Date(submission.createdAt).toISOString()}
          className="text-[10.5px] text-[var(--text-faint)]"
        >
          {formatWhen(submission.createdAt)}
        </time>
        <span className="truncate text-[10px] text-[var(--text-faint)]">{submission.formId}</span>
      </header>

      {entries.length === 0 ? (
        <p className="text-[11px] text-[var(--text-faint)] italic">Empty submission</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2.5 gap-y-1">
          {entries.map(([field, value]) => (
            <React.Fragment key={field}>
              <dt className="truncate text-[10.5px] text-[var(--text-faint)]">{field}</dt>
              {/* `break-words` rather than `truncate`: a message is the reason
                  someone opens this panel, and hiding it behind an ellipsis
                  would make the panel useless for the field that matters most. */}
              <dd className="min-w-0 text-[11.5px] break-words text-[var(--text)]">
                {value || <span className="text-[var(--text-faint)] italic">empty</span>}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </article>
  );
}

/* --------------------------------------------------------------------------
 * CSV
 * ----------------------------------------------------------------------- */

/**
 * Quote every cell, always.
 *
 * A field value is untrusted text, and a spreadsheet reads a cell beginning
 * `=`, `+`, `-` or `@` as a formula — so those get a leading apostrophe as
 * well. Downloading your own contact form should not be able to run anything.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function downloadCsv(rows: FormSubmission[]): void {
  // One sheet for every form, so the columns are the union of every field
  // anyone submitted rather than only the first row's.
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row.payload)))];
  const header = ['Received', 'Form', ...fields];
  const lines = [
    header.map(csvCell).join(','),
    ...rows.map((row) =>
      [
        new Date(row.createdAt).toISOString(),
        row.formId,
        ...fields.map((field) => row.payload[field] ?? ''),
      ]
        .map(csvCell)
        .join(',')
    ),
  ];

  // A BOM, so Excel opens UTF-8 as UTF-8 instead of mangling every accent.
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `submissions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
