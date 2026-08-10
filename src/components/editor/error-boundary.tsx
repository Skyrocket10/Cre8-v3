'use client';

/**
 * A wall around one part of the editor.
 *
 * React unmounts the entire tree when a render throws and nothing catches it,
 * so before this a bad node, a malformed style or an unhandled shape anywhere
 * in the canvas, the inspector or a panel took the whole application with it —
 * white screen, no explanation, and the only way back a reload.
 *
 * The renderer is already defensive about the failures it can name: an unknown
 * element type falls back to a frame, a missing node renders nothing, a cycle
 * is stopped by a depth limit. This is not about those. It is about the blast
 * radius of the ones nobody has thought of yet, and the whole of the fix is
 * making that radius one panel instead of the editor.
 *
 * ## Why it recovers on the document rather than on a button
 *
 * A "Try again" button that re-renders the same document with the same bug
 * fails again immediately, which reads as a broken button rather than as a
 * persistent problem. So the boundary resets when the thing it renders
 * changes — pass the document version as `resetKey` and fixing the offending
 * element, undoing, or a collaborator's edit clears it by itself.
 */

import React from 'react';
import { useEditor } from '@/lib/editor/store';

interface Props {
  children: React.ReactNode;
  /** What failed, in the words a person would use: "the canvas", "the inspector". */
  label: string;
  /** Changing this clears the error — see above. */
  resetKey?: unknown;
  /** Extra recovery offered alongside a reload, when the surface has one. */
  action?: { label: string; onClick: () => void };
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Logged rather than swallowed. The message on screen is for the person
    // using the editor; this is the one a bug report can be written from.
    console.error(`[cre8] ${this.props.label} failed to render`, error, info.componentStack);
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 overflow-auto bg-[var(--panel)] p-6 text-center">
        <div className="flex size-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--field)] text-[var(--danger)]">
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-[12.5px] font-medium text-[var(--text)]">
            Something in {this.props.label} could not be drawn
          </p>
          <p className="max-w-[260px] text-[11px] leading-relaxed text-[var(--text-muted)]">
            The rest of the editor is still working, and your work is saved. Undoing the last
            change usually clears it.
          </p>
        </div>

        {/* The message itself, because "an error occurred" helps nobody and
            this is the one string a bug report needs. */}
        <code className="max-w-[300px] truncate rounded bg-[var(--field)] px-2 py-1 font-mono text-[10px] text-[var(--text-faint)]">
          {this.state.error.message || String(this.state.error)}
        </code>

        <div className="flex items-center gap-2">
          {this.props.action && (
            <button
              type="button"
              onClick={this.props.action.onClick}
              className="h-7 rounded-md bg-[var(--field)] px-3 text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
            >
              {this.props.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-7 rounded-md bg-[var(--accent)] px-3 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Reload the editor
          </button>
        </div>
      </div>
    );
  }
}

/**
 * The boundary, wired to the document.
 *
 * Subscribing here rather than in the shell keeps the cost to nothing: this
 * component renders one element and passes `children` straight through, and
 * React skips re-rendering a child whose element identity has not changed —
 * which it has not, because the parent did not re-render.
 */
export function EditorErrorBoundary({
  label,
  action,
  children,
}: {
  label: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  const doc = useEditor((s) => s.doc);
  return (
    <ErrorBoundary label={label} resetKey={doc} {...(action ? { action } : {})}>
      {children}
    </ErrorBoundary>
  );
}
