'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, Download, FileCode2, X } from 'lucide-react';
import { exportProject, type PublishResult } from '@/lib/publishing/publish';
import { useEditor } from '@/lib/editor/store';
import { formatBytes } from '@/lib/utils/cn';
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

          <div className="mx-4 mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel)]">
            {result.site.pages.map((page) => (
              <a
                key={page.slug}
                href={`${result.url}${page.slug ? `/${page.slug}` : ''}`}
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
              onClick={() => window.open(result.url, '_blank', 'noreferrer')}
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
