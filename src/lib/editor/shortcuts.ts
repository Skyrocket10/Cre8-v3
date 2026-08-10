'use client';

/**
 * Keyboard layer.
 *
 * One listener, and — for anything that touches the document — no table of its
 * own. Every element command lives in `commands.ts` with its chords attached,
 * and `dispatchChord` runs whichever one claims the event, so a shortcut and
 * the same item in the context menu are not merely consistent: they are one
 * object. What is left here is the rest of the editor — zoom, panels, the
 * breakpoint, saving, publishing — plus Escape, which unwinds a ladder rather
 * than firing a single action.
 *
 * Nothing fires while the user is typing — in a field, in a layer rename, or in
 * canvas text editing.
 */

import { useEffect } from 'react';
import { BREAKPOINT_DEFS, type Breakpoint } from '../document/types';
import { boundCommands, dispatchChord, runCommand } from './commands';
import { activeRootId, useEditor, type LeftTab } from './store';

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
        /*
         * Up one level, then out of the overlay — but only when going up would
         * actually move. `selectParent` stops at the scope ceiling, so once the
         * overlay itself is selected it does nothing, and calling it anyway
         * swallowed the key: Escape became inert instead of leaving.
         */
        const first = store.selection[0];
        if (first && first !== activeRootId(store)) {
          store.selectParent();
          return;
        }
        if (store.editingOverlayId) {
          // The last rung, and the same command the menu's "Finish editing
          // overlay" runs — see `laddered` on it.
          runCommand('exitOverlay');
          return;
        }
        return;
      }

      if (isTyping(e.target)) return;
      if (store.previewing) {
        if (e.key === 'p' && !mod) store.setPreviewing(false);
        return;
      }

      /*
       * The catalogue first.
       *
       * Everything that edits the document is bound there, so this listener
       * has no opinion about what Duplicate means — it hands the chord over
       * and stops if something took it. A chord nobody claimed, or one whose
       * command is unavailable for the current selection, falls through to the
       * editor-level keys below.
       */
      if (dispatchChord(e)) {
        e.preventDefault();
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
          case 's':
            e.preventDefault();
            options.onSave();
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
          // Both, because shift changes the character: ⇧⌘\ arrives as `|`, so
          // the inspector toggle had never once fired. The catalogue avoids
          // this by refusing shifted punctuation outright; this switch is
          // hand-written and has to say both.
          case '\\':
          case '|':
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
        // Delete and Enter-to-edit-text are catalogue commands and were
        // handled above. Enter reaching here means there was no text to edit,
        // so it means the other thing it has always meant: go one level in.
        case 'Enter':
          if (!store.selection.length) return;
          e.preventDefault();
          store.selectChild();
          return;
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

/**
 * Rendered in the help popover.
 *
 * The element group is generated from the catalogue rather than typed out, so
 * it cannot describe a binding that no longer exists — which the hand-written
 * version it replaced had already started to do. Only the keys this file still
 * owns are listed by hand.
 */
export function shortcutReference(): { group: string; items: [string, string][] }[] {
  return [
    {
      group: 'Elements',
      items: boundCommands().map(({ chord, label }) => [chord, label] as [string, string]),
    },
    ...STATIC_REFERENCE,
  ];
}

const STATIC_REFERENCE: { group: string; items: [string, string][] }[] = [
  {
    group: 'Essentials',
    items: [
      ['⌘Z / ⇧⌘Z', 'Undo / Redo'],
      ['⌘S', 'Save now'],
      ['⇧⌘P', 'Publish'],
    ],
  },
  {
    group: 'Selection',
    items: [
      ['Click', 'Select element'],
      ['⇧ Click', 'Add to selection'],
      ['⌥ Click', 'Select parent'],
      ['Esc', 'Up one level, then out of an overlay'],
      ['Enter', 'Go one level in'],
      ['Tab', 'Next sibling'],
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
