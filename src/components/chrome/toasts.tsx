'use client';

import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';

const ICONS = {
  info: <Info size={12} />,
  success: <Check size={12} />,
  error: <TriangleAlert size={12} />,
};

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-11 left-1/2 z-[800] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'anim-slide-up pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-2',
            'border border-[var(--border-strong)] bg-[var(--overlay)] shadow-[var(--shadow-float)]',
            'text-[11.5px] whitespace-nowrap',
            toast.tone === 'error'
              ? 'text-[var(--danger)]'
              : toast.tone === 'success'
                ? 'text-[var(--success)]'
                : 'text-[var(--text-secondary)]'
          )}
        >
          <span className="shrink-0">{ICONS[toast.tone]}</span>
          <span className="text-[var(--text)]">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                useEditor.getState().dismissToast(toast.id);
              }}
              className="ml-1 rounded px-1.5 py-0.5 text-[var(--accent)] transition-colors hover:bg-[var(--accent-subtle)]"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => useEditor.getState().dismissToast(toast.id)}
            className="ml-0.5 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
