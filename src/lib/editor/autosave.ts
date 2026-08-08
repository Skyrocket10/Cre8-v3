'use client';

/**
 * Autosave.
 *
 * Debounced, never blocking, and never modal. The only thing the user should
 * ever notice is the word in the top bar changing from "Unsaved" to "Saved".
 * A flush on page-hide covers the case where they close the tab mid-edit.
 *
 * `suspended` turns it off entirely, which is what a live collaboration
 * session wants: the room already persists every patch, and a whole-document
 * PUT on top of that would bump the version and force everyone — including the
 * person who just typed — into a resync every nine hundred milliseconds.
 */

import { useCallback, useEffect, useRef } from 'react';
import { getStorage } from '../api/storage';
import { useEditor } from './store';

const DEBOUNCE_MS = 900;

export function useAutosave(options?: { suspended?: boolean }): { saveNow: () => Promise<void> } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const pending = useRef(false);

  // Read through a ref so the subscription below never has to be torn down and
  // rebuilt just because the socket came up.
  const suspended = useRef(false);
  suspended.current = options?.suspended ?? false;

  const persist = useCallback(async () => {
    if (suspended.current) return;
    if (saving.current) {
      pending.current = true;
      return;
    }
    const store = useEditor.getState();
    if (!store.loaded || store.readOnly) return;

    saving.current = true;
    store.setSaveStatus('saving');
    try {
      // `updatedAt` is metadata, not undoable state, so it is stamped here
      // rather than inside a transaction.
      await getStorage().saveProject({ ...store.doc, updatedAt: Date.now() });
      useEditor.getState().markSaved();
    } catch (error) {
      console.error('[cre8] save failed', error);
      useEditor.getState().setSaveStatus(navigator.onLine === false ? 'offline' : 'error');
    } finally {
      saving.current = false;
      if (pending.current) {
        pending.current = false;
        void persist();
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.doc === previous.doc || !state.loaded) return;
      if (suspended.current) {
        useEditor.getState().setSaveStatus('live');
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(), DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [persist]);

  // Coming back from a dropped room. Nothing changed the document on the way
  // out, so the store subscription will not fire on its own — but everything
  // that arrived over the socket is unsaved as far as HTTP is concerned.
  const wasSuspended = useRef(suspended.current);
  useEffect(() => {
    const now = options?.suspended ?? false;
    const resumed = wasSuspended.current && !now;
    wasSuspended.current = now;
    if (resumed && useEditor.getState().loaded) void persist();
  }, [options?.suspended, persist]);

  useEffect(() => {
    const flush = () => {
      if (useEditor.getState().saveStatus === 'dirty') void persist();
    };
    const onOnline = () => {
      if (useEditor.getState().saveStatus === 'offline') void persist();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', () => useEditor.getState().setSaveStatus('offline'));
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', onOnline);
    };
  }, [persist]);

  return { saveNow: persist };
}
