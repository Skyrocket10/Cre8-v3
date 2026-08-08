'use client';

/**
 * Keyboard layer.
 *
 * One listener, one table. Everything is routed through store actions, so a
 * shortcut and the equivalent click produce the same transaction and the same
 * undo entry.
 *
 * Nothing fires while the user is typing — in a field, in a layer rename, or in
 * canvas text editing.
 */

import { useEffect } from 'react';
import { BREAKPOINT_DEFS, type Breakpoint, type ElementType } from '../document/types';
import { createComponentFromNode } from '../document/operations';
import { useEditor, type LeftTab } from './store';

const INSERT_KEYS: Record<string, ElementType> = {
  f: 'frame',
  s: 'section',
  c: 'container',
  t: 'text',
  h: 'heading',
  p: 'paragraph',
  b: 'button',
  m: 'image',
  g: 'grid',
  k: 'stack',
};

const PANEL_ORDER: LeftTab[] = ['insert', 'layers', 'pages', 'components', 'assets', 'theme'];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useKeyboardShortcuts(options: { onSave: () => void; onPublish: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;

      /* --- Space-to-pan works even mid-interaction ----------------------- */
      if (e.code === 'Space' && !isTyping(e.target) && !e.repeat) {
        e.preventDefault();
        store.setSpacePanning(true);
        return;
      }

      /* --- Escape unwinds one level at a time ---------------------------- */
      if (e.key === 'Escape') {
        if (store.previewing) {
          store.setPreviewing(false);
          return;
        }
        if (store.editingTextId) {
          store.beginTextEdit(null);
          return;
        }
        if (isTyping(e.target)) return;
        if (store.selection.length) {
          store.selectParent();
          return;
        }
        return;
      }

      if (isTyping(e.target)) return;
      if (store.previewing) {
        if (e.key === 'p' && !mod) store.setPreviewing(false);
        return;
      }

      /* --- Modifier combinations ----------------------------------------- */
      if (mod) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) store.redo();
            else store.undo();
            return;
          case 'y':
            e.preventDefault();
            store.redo();
            return;
          case 'c':
            e.preventDefault();
            store.copySelection();
            return;
          case 'x':
            e.preventDefault();
            store.cutSelection();
            return;
          case 'v':
            e.preventDefault();
            store.paste();
            return;
          case 'd':
            e.preventDefault();
            store.duplicateSelection();
            return;
          case 'a':
            e.preventDefault();
            store.selectAll();
            return;
          case 'g':
            e.preventDefault();
            if (e.shiftKey) store.ungroupSelection();
            else store.groupSelection();
            return;
          case 's':
            e.preventDefault();
            options.onSave();
            return;
          case 'e':
            e.preventDefault();
            if (store.selection.length === 1) {
              const id = store.selection[0]!;
              store.transact('Create component', (draft) => {
                const result = createComponentFromNode(draft, id);
                return result ? [result.instanceId] : undefined;
              });
            }
            return;
          case 'h':
            if (e.shiftKey) {
              e.preventDefault();
              store.toggleHidden();
            }
            return;
          case 'l':
            if (e.shiftKey) {
              e.preventDefault();
              store.toggleLocked();
            }
            return;
          case '=':
          case '+':
            e.preventDefault();
            store.setZoom(store.zoom * 1.2);
            return;
          case '-':
            e.preventDefault();
            store.setZoom(store.zoom / 1.2);
            return;
          case '0':
            e.preventDefault();
            store.setZoom(1);
            return;
          case '\\':
            e.preventDefault();
            if (e.shiftKey) store.toggleRight();
            else store.toggleLeft();
            return;
          case 'p':
            if (e.shiftKey) {
              e.preventDefault();
              options.onPublish();
            }
            return;
          default:
            return;
        }
      }

      /* --- Alt + digit switches the left panel ---------------------------- */
      if (e.altKey) {
        const index = Number(e.key) - 1;
        const tab = PANEL_ORDER[index];
        if (tab) {
          e.preventDefault();
          store.setLeftTab(tab);
        }
        return;
      }

      /* --- Plain keys ----------------------------------------------------- */
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          store.deleteSelection();
          return;
        case 'Enter': {
          const id = store.selection[0];
          if (!id) return;
          e.preventDefault();
          const node = store.doc.nodes[id];
          if (node && (node.type === 'heading' || node.type === 'paragraph' || node.type === 'text' || node.type === 'button' || node.type === 'link')) {
            store.beginTextEdit(id);
          } else {
            store.selectChild();
          }
          return;
        }
        case 'Tab':
          e.preventDefault();
          store.selectSibling(e.shiftKey ? -1 : 1);
          return;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!store.selection.length) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          store.nudgeSelection(dx, dy);
          return;
        }
        case '1':
        case '2':
        case '3': {
          if (e.shiftKey) {
            if (e.key === '1') store.requestFit();
            return;
          }
          const entry = (Object.keys(BREAKPOINT_DEFS) as Breakpoint[]).find(
            (id) => BREAKPOINT_DEFS[id].shortcut === e.key
          );
          if (entry) store.setBreakpoint(entry);
          return;
        }
        case '!':
          store.requestFit();
          return;
        default: {
          const type = INSERT_KEYS[e.key.toLowerCase()];
          if (type) {
            e.preventDefault();
            store.insertElement(type);
          }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useEditor.getState().setSpacePanning(false);
    };

    // Releasing space outside the window would otherwise leave pan mode stuck.
    const onBlur = () => useEditor.getState().setSpacePanning(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [options]);
}

/** Rendered in the help popover. */
export const SHORTCUT_REFERENCE: { group: string; items: [string, string][] }[] = [
  {
    group: 'Essentials',
    items: [
      ['⌘Z / ⇧⌘Z', 'Undo / Redo'],
      ['⌘C ⌘X ⌘V', 'Copy, cut, paste'],
      ['⌘D', 'Duplicate'],
      ['⌫', 'Delete'],
      ['⌘S', 'Save now'],
    ],
  },
  {
    group: 'Selection',
    items: [
      ['Click', 'Select element'],
      ['⇧ Click', 'Add to selection'],
      ['⌥ Click', 'Select parent'],
      ['Esc', 'Select parent'],
      ['Enter', 'Edit text / go deeper'],
      ['Tab', 'Next sibling'],
      ['⌘A', 'Select all'],
      ['⌘G / ⇧⌘G', 'Group / Ungroup'],
    ],
  },
  {
    group: 'Insert',
    items: [
      ['S', 'Section'],
      ['C', 'Container'],
      ['F', 'Frame'],
      ['K', 'Stack'],
      ['G', 'Grid'],
      ['H', 'Heading'],
      ['P', 'Paragraph'],
      ['T', 'Text'],
      ['B', 'Button'],
      ['M', 'Image'],
    ],
  },
  {
    group: 'View',
    items: [
      ['Space + drag', 'Pan'],
      ['⌘ Scroll', 'Zoom'],
      ['⌘+ / ⌘−', 'Zoom in / out'],
      ['⌘0', 'Zoom to 100%'],
      ['⇧1', 'Fit to screen'],
      ['1 / 2 / 3', 'Desktop / Tablet / Mobile'],
      ['⌘\\', 'Toggle left panel'],
      ['⇧⌘\\', 'Toggle inspector'],
      ['⌥1…6', 'Switch left panel'],
    ],
  },
];
