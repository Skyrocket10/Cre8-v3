/**
 * Transactional history.
 *
 * Every mutation the editor performs is produced with immer and recorded as a
 * forward patch set plus its inverse. Nothing mutates the document directly,
 * which buys three things at once:
 *
 *   • undo/redo that is exact rather than approximate,
 *   • cheap coalescing of high-frequency edits (scrubbing a value, dragging a
 *     handle) into one user-visible step,
 *   • a description of *what changed* that a future collaboration or AI layer
 *     can consume without re-deriving it from snapshots.
 */

import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { Cre8Document, NodeId } from '../document/types';

enablePatches();

export interface Transaction {
  id: number;
  label: string;
  patches: Patch[];
  inverse: Patch[];
  timestamp: number;
  /** Restored on undo/redo so the user lands back where they were working. */
  selectionBefore: NodeId[];
  selectionAfter: NodeId[];
  pageBefore: string;
  pageAfter: string;
  /** Consecutive transactions sharing a key inside the window are merged. */
  mergeKey?: string;
}

export interface HistoryState {
  past: Transaction[];
  future: Transaction[];
}

export const MAX_HISTORY = 250;
/** Two edits closer together than this, with the same merge key, become one. */
export const MERGE_WINDOW_MS = 700;

export function emptyHistory(): HistoryState {
  return { past: [], future: [] };
}

let counter = 0;

export interface CommitInput {
  label: string;
  selectionBefore: NodeId[];
  selectionAfter: NodeId[];
  pageBefore: string;
  pageAfter: string;
  mergeKey?: string;
}

export interface CommitResult {
  doc: Cre8Document;
  history: HistoryState;
  changed: boolean;
}

export function commit(
  doc: Cre8Document,
  history: HistoryState,
  recipe: (draft: Cre8Document) => void,
  input: CommitInput
): CommitResult {
  const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
    recipe(draft);
  });

  if (patches.length === 0) return { doc, history, changed: false };

  const now = Date.now();
  const last = history.past[history.past.length - 1];
  const canMerge =
    Boolean(input.mergeKey) &&
    last !== undefined &&
    last.mergeKey === input.mergeKey &&
    now - last.timestamp < MERGE_WINDOW_MS;

  let past: Transaction[];
  if (canMerge && last) {
    past = [
      ...history.past.slice(0, -1),
      {
        ...last,
        patches: [...last.patches, ...patches],
        // Undo has to unwind the newest change first.
        inverse: [...inverse, ...last.inverse],
        timestamp: now,
        selectionAfter: input.selectionAfter,
        pageAfter: input.pageAfter,
      },
    ];
  } else {
    past = [
      ...history.past,
      {
        id: ++counter,
        label: input.label,
        patches,
        inverse,
        timestamp: now,
        selectionBefore: input.selectionBefore,
        selectionAfter: input.selectionAfter,
        pageBefore: input.pageBefore,
        pageAfter: input.pageAfter,
        mergeKey: input.mergeKey,
      },
    ];
  }

  if (past.length > MAX_HISTORY) past = past.slice(past.length - MAX_HISTORY);

  return { doc: next, history: { past, future: [] }, changed: true };
}

export interface TravelResult {
  doc: Cre8Document;
  history: HistoryState;
  transaction: Transaction | null;
}

export function undo(doc: Cre8Document, history: HistoryState): TravelResult {
  const transaction = history.past[history.past.length - 1];
  if (!transaction) return { doc, history, transaction: null };
  return {
    doc: applyPatches(doc, transaction.inverse),
    history: { past: history.past.slice(0, -1), future: [transaction, ...history.future] },
    transaction,
  };
}

export function redo(doc: Cre8Document, history: HistoryState): TravelResult {
  const transaction = history.future[0];
  if (!transaction) return { doc, history, transaction: null };
  return {
    doc: applyPatches(doc, transaction.patches),
    history: { past: [...history.past, transaction], future: history.future.slice(1) },
    transaction,
  };
}

/** Label for the undo/redo tooltips. */
export function describeNext(history: HistoryState, direction: 'undo' | 'redo'): string | null {
  const tx = direction === 'undo' ? history.past[history.past.length - 1] : history.future[0];
  return tx?.label ?? null;
}
