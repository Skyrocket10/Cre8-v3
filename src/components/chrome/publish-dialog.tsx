'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, Copy, Download, FileCode2, Globe, Pencil, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api/client';
import { exportProject, type PublishResult } from '@/lib/publishing/publish';
import { routes } from '@/lib/routes';
import { useEditor } from '@/lib/editor/store';
import { cn, formatBytes } from '@/lib/utils/cn';
import { Button } from '../ui/primitives';

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[850] flex items-center justify-center p-6">
      <div
        className="anim-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="anim-pop relative overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--overlay)] shadow-[var(--shadow-float)]"
        style={{ width }}
      >
        <div className="flex h-10 items-center justify-between border-b border-[var(--border-soft)] pr-1.5 pl-4">
          <h2 className="text-[12.5px] font-medium text-[var(--text)]">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-[var(--text-faint)] transition-colors hover:bg-[var(--field)] hover:text-[var(--text)]"
          >
            <X size={13} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function PublishDialog({
  result,
  onClose,
}: {
  result: PublishResult | null;
  onClose: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const [address, setAddress] = useState<string | null>(null);

  // The dialog outlives one publish, so the address has to reset with it.
  useEffect(() => setAddress(result?.subdomain ?? null), [result?.subdomain]);

  const siteUrl =
    address && result?.siteDomain ? `https://${address}.${result.siteDomain}/` : result?.url;

  return (
    <Modal open={Boolean(result)} onClose={onClose} title="Published" width={440}>
      {result && (
        <div className="flex flex-col">
          <div className="flex items-start gap-3 px-4 py-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]">
              <Check size={15} strokeWidth={2.4} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-[var(--text)]">
                {result.pageCount} page{result.pageCount === 1 ? '' : 's'} published
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                {formatBytes(result.bytes)} of static HTML and CSS — no JavaScript runtime.
              </p>
            </div>
          </div>

          {result.siteDomain && address && (
            <SiteAddress
              projectId={result.site.projectId}
              subdomain={address}
              domain={result.siteDomain}
              onChange={setAddress}
            />
          )}

          <div className="mx-4 mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
            {result.site.pages.map((page) => (
              <a
                key={page.slug}
                href={
                  address && result.siteDomain
                    ? `https://${address}.${result.siteDomain}/${page.slug}`
                    : routes.publishedSite(result.site.projectId, page.slug)
                }
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-2 text-[11.5px] transition-colors last:border-b-0 hover:bg-[var(--field)]"
              >
                <FileCode2 size={12} className="shrink-0 text-[var(--text-faint)]" />
                <span className="flex-1 truncate text-[var(--text)]">{page.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-faint)]">
                  /{page.slug}
                </span>
                <ArrowUpRight
                  size={12}
                  className="shrink-0 text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100"
                />
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border-soft)] px-4 py-3">
            <Button size="md" variant="secondary" onClick={() => exportProject(doc)}>
              <Download size={12} />
              Download ZIP
            </Button>
            <div className="flex-1" />
            <Button size="md" onClick={onClose}>
              Keep editing
            </Button>
            <Button
              size="md"
              variant="primary"
              onClick={() => window.open(siteUrl, '_blank', 'noreferrer')}
            >
              View site
              <ArrowUpRight size={12} />
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------------------
 * Site address
 * ----------------------------------------------------------------------- */

/**
 * The site's own hostname, shown the moment it exists.
 *
 * A project earns an address on its first publish rather than at creation —
 * most projects are never published, and reserving names for them would just
 * be squatting. So this is the first time anyone sees it, which makes it the
 * right place to let them change it.
 *
 * Renaming frees the old hostname immediately: leaving it resolving would mean
 * a site still answering at an address its owner believes they gave up.
 */
function SiteAddress({
  projectId,
  subdomain,
  domain,
  onChange,
}: {
  projectId: string;
  subdomain: string;
  domain: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(subdomain);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = `https://${subdomain}.${domain}/`;

  const save = async () => {
    const next = draft.trim().toLowerCase();
    if (next === subdomain) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.setSubdomain(projectId, next);
      onChange(result.subdomain);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change the address');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (editing) {
    return (
      <div className="mx-4 mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') {
                setDraft(subdomain);
                setEditing(false);
              }
            }}
            className={cn(
              'h-8 min-w-0 flex-1 rounded-md bg-[var(--field)] px-2.5 text-right font-mono',
              'text-[12px] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset'
            )}
          />
          <span className="shrink-0 font-mono text-[12px] text-[var(--text-faint)]">.{domain}</span>
          <Button size="md" variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-[11px] text-[var(--danger)]">{error}</p>
        ) : (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            Lowercase letters, numbers and hyphens. The old address stops working straight away.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
      <Globe size={13} className="shrink-0 text-[var(--success)]" />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)] transition-opacity hover:opacity-75"
      >
        {subdomain}.{domain}
      </a>
      <button
        type="button"
        aria-label="Copy site address"
        onClick={() => void copy()}
        className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] transition-colors hover:bg-[var(--field)] hover:text-[var(--text)]"
      >
        {copied ? <Check size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
      </button>
      <button
        type="button"
        aria-label="Change site address"
        onClick={() => {
          setDraft(subdomain);
          setEditing(true);
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] transition-colors hover:bg-[var(--field)] hover:text-[var(--text)]"
      >
        <Pencil size={11} />
      </button>
    </div>
  );
}
