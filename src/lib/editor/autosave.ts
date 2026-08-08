'use client';

/**
 * Autosave.
 *
 * Debounced, never blocking, and never modal. The only thing the user should
 * ever notice is the word in the top bar changing from "Unsaved" to "Saved".
 * A flush on page-hide covers the case where they close the tab mid-edit.
 */

import { useCallback, useEffect, useRef } from 'react';
import { getStorage } from '../api/storage';
import { useEditor } from './store';

const DEBOUNCE_MS = 900;

export function useAutosave(): { saveNow: () => Promise<void> } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const pending = useRef(false);

  const persist = useCallback(async () => {
    if (saving.current) {
      pending.current = true;
      return;
    }
    const store = useEditor.getState();
    if (!store.loaded) return;

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
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(), DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [persist]);

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
