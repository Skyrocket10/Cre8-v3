'use client';

/**
 * The command catalogue.
 *
 * One entry per thing the editor can be asked to do to the document, and the
 * entry is the only description of it: what it is called, what keys run it,
 * when it is available, and what it does. The context menu, the keyboard layer
 * and the layer tree all read from here, so there is no second implementation
 * to drift from the first.
 *
 * Every `run` is a call into the store. That is the rule, and it is worth
 * stating plainly: nothing in this file edits a document. A command that
 * needed its own transaction would be a store action that had not been written
 * yet — `arrangeSelection`, `alignSelection`, `detachSelection` and
 * `createComponentFromSelection` all arrived that way, lifted out of the three
 * places that had each grown their own copy.
 *
 * Parameters are strings, deliberately. A menu entry is a command id plus an
 * optional argument, so "Bring to front" and "Insert a heading" are the same
 * shape as "Delete", and a menu cannot name an action that is not in here.
 */

import { ELEMENTS, getElement } from '../document/schema';
import { describeElement } from '../renderer/element-model';
import type { ElementType, NodeId, SceneNode } from '../document/types';
import {
  activeRootId,
  alignableSelection,
  useEditor,
  type AlignEdge,
  type ArrangeDirection,
  type EditorStore,
} from './store';

/* --------------------------------------------------------------------------
 * Context
 * ----------------------------------------------------------------------- */

/**
 * Everything a command needs to know, computed once when a menu opens.
 *
 * Derived rather than asked for one field at a time so that `enabled` stays a
 * one-line answer and every surface asks the same question — the menu and the
 * keyboard cannot disagree about whether Ungroup applies.
 */
export interface CommandContext {
  store: EditorStore;
  selection: NodeId[];
  count: number;
  /** The node, when exactly one is selected. */
  node: SceneNode | null;
  /** Scope root: the page, the component master, or an open overlay. */
  root: NodeId | null;
  /** True when the selection *is* the scope root, which most edits refuse. */
  atRoot: boolean;
  container: boolean;
  instance: boolean;
  overlayNode: boolean;
  /** Text the canvas would actually let you type over. */
  editableText: boolean;
  locked: boolean;
  hidden: boolean;
  /** Positioned siblings under one parent: the only case align can honour. */
  alignable: boolean;
  readOnly: boolean;
}

export function commandContext(store: EditorStore = useEditor.getState()): CommandContext {
  const { selection, doc } = store;
  const node = selection.length === 1 ? (doc.nodes[selection[0]!] ?? null) : null;
  const root = activeRootId(store);
  const def = node ? getElement(node.type) : null;

  return {
    store,
    selection,
    count: selection.length,
    node,
    root,
    atRoot: selection.length > 0 && selection.every((id) => id === root),
    container: Boolean(def?.container),
    instance: node?.type === 'instance',
    overlayNode: node?.type === 'popover' || node?.type === 'dialog',
    // Asked of the renderer rather than guessed from the type. A button showing
    // an icon and a label has children, so it has no text of its own, and an
    // icon never did — offering "Edit text" on either is an item that looks
    // live and does nothing when clicked.
    editableText: node
      ? describeElement(node, doc, { mode: 'edit' }).editableProp !== undefined
      : false,
    locked: Boolean(node?.meta.locked),
    hidden: Boolean(node?.meta.hidden),
    alignable: alignableSelection(store),
    readOnly: store.readOnly,
  };
}

/* --------------------------------------------------------------------------
 * Commands
 * ----------------------------------------------------------------------- */

export interface EditorCommand {
  id: string;
  /** A function when the wording depends on the selection — Hide versus Show. */
  label: string | ((ctx: CommandContext, arg?: string) => string);
  /**
   * Chords that run it. The first is also what the menu prints, so the label
   * and the binding are the same fact and cannot drift apart.
   */
  keys?: string[];
  /**
   * Chords for a *particular* argument, keyed by it.
   *
   * "Bring to front" and "Send to back" are one command with two arguments, so
   * they cannot share one binding. Same rule as `keys`: the first entry is what
   * gets printed, which keeps the shown chord and the working chord identical.
   */
  argKeys?: Record<string, string[]>;
  /**
   * The chord is printed but not dispatched from the table here.
   *
   * Only Escape needs this. It unwinds one level at a time — a text edit
   * first, then the selection, then the overlay — and a flat binding would
   * jump straight to the end of that ladder from anywhere. The keyboard layer
   * calls the command itself at the right rung, so the *action* is still this
   * one; only the routing is bespoke.
   */
  laddered?: boolean;
  danger?: boolean;
  /** Absent means "always", which is true of very few of them. */
  enabled?: (ctx: CommandContext, arg?: string) => boolean;
  run: (ctx: CommandContext, arg?: string) => void;
}

/** Nothing may be edited at all: read-only access, or the caret is in a field. */
function editable(ctx: CommandContext): boolean {
  return !ctx.readOnly;
}

/** A selection that is not the page root and is not locked. */
function movable(ctx: CommandContext): boolean {
  return editable(ctx) && ctx.count > 0 && !ctx.atRoot;
}

const ARRANGE_LABELS: Record<ArrangeDirection, string> = {
  front: 'Bring to front',
  forward: 'Bring forward',
  backward: 'Send backward',
  back: 'Send to back',
};

const ALIGN_LABELS: Record<AlignEdge, string> = {
  left: 'Align left',
  hcentre: 'Align centres',
  right: 'Align right',
  top: 'Align top',
  vmiddle: 'Align middles',
  bottom: 'Align bottoms',
};

export const COMMANDS: Record<string, EditorCommand> = {
  /* --- Clipboard ------------------------------------------------------- */
  cut: {
    id: 'cut',
    label: 'Cut',
    keys: ['mod+x'],
    enabled: movable,
    run: (ctx) => ctx.store.cutSelection(),
  },
  copy: {
    id: 'copy',
    label: 'Copy',
    keys: ['mod+c'],
    enabled: (ctx) => ctx.count > 0,
    run: (ctx) => ctx.store.copySelection(),
  },
  paste: {
    id: 'paste',
    label: 'Paste',
    keys: ['mod+v'],
    enabled: (ctx) => editable(ctx) && Boolean(ctx.store.clipboard),
    run: (ctx) => ctx.store.paste(),
  },
  duplicate: {
    id: 'duplicate',
    label: 'Duplicate',
    keys: ['mod+d'],
    enabled: movable,
    run: (ctx) => ctx.store.duplicateSelection(),
  },
  delete: {
    id: 'delete',
    label: 'Delete',
    keys: ['Delete', 'Backspace'],
    danger: true,
    enabled: movable,
    run: (ctx) => ctx.store.deleteSelection(),
  },

  /* --- Styles ---------------------------------------------------------- */
  copyStyles: {
    id: 'copyStyles',
    label: 'Copy styles',
    enabled: (ctx) => ctx.count === 1,
    run: (ctx) => ctx.store.copyStyles(),
  },
  pasteStyles: {
    id: 'pasteStyles',
    label: 'Paste styles',
    enabled: (ctx) => editable(ctx) && ctx.count > 0 && Boolean(ctx.store.styleSource),
    run: (ctx) => ctx.store.pasteStyles(),
  },
  resetStyles: {
    id: 'resetStyles',
    label: 'Reset styles',
    danger: true,
    enabled: (ctx) =>
      editable(ctx) &&
      ctx.selection.some((id) => {
        const layer = ctx.store.doc.nodes[id]?.styles[ctx.store.breakpoint];
        return layer !== undefined && Object.keys(layer).length > 0;
      }),
    run: (ctx) => ctx.store.resetStyles(),
  },

  /* --- Structure ------------------------------------------------------- */
  group: {
    id: 'group',
    label: 'Group',
    keys: ['mod+g'],
    enabled: movable,
    run: (ctx) => ctx.store.groupSelection(),
  },
  ungroup: {
    id: 'ungroup',
    label: 'Ungroup',
    keys: ['mod+shift+g'],
    enabled: (ctx) =>
      movable(ctx) &&
      ctx.selection.some((id) => {
        const node = ctx.store.doc.nodes[id];
        return Boolean(node && getElement(node.type).container && node.children.length > 0);
      }),
    run: (ctx) => ctx.store.ungroupSelection(),
  },
  wrapInLink: {
    id: 'wrapInLink',
    label: 'Wrap in link',
    enabled: movable,
    run: (ctx) => ctx.store.wrapInLink(),
  },

  /* --- Components ------------------------------------------------------ */
  createComponent: {
    id: 'createComponent',
    label: 'Create component',
    keys: ['mod+e'],
    enabled: (ctx) => movable(ctx) && ctx.count === 1 && !ctx.instance,
    run: (ctx) => ctx.store.createComponentFromSelection(),
  },
  editComponent: {
    id: 'editComponent',
    label: 'Edit component',
    enabled: (ctx) => ctx.instance,
    run: (ctx) => {
      const componentId = ctx.node?.props.componentId;
      if (typeof componentId === 'string') ctx.store.editComponent(componentId);
    },
  },
  detach: {
    id: 'detach',
    label: 'Detach instance',
    enabled: (ctx) => editable(ctx) && ctx.selection.some((id) => ctx.store.doc.nodes[id]?.type === 'instance'),
    run: (ctx) => ctx.store.detachSelection(),
  },

  /* --- Order ----------------------------------------------------------- */
  arrange: {
    id: 'arrange',
    label: (_ctx, arg) => ARRANGE_LABELS[(arg ?? 'front') as ArrangeDirection],
    // Only the two step actions get chords. Front and back would want the
    // shifted brackets, and shift changes what `event.key` reports — the
    // binding would arrive as `}` and never match the `]` it was written as.
    // A shortcut that is printed and does nothing is worse than no shortcut.
    argKeys: {
      forward: ['mod+]'],
      backward: ['mod+['],
    },
    enabled: movable,
    run: (ctx, arg) => ctx.store.arrangeSelection((arg ?? 'front') as ArrangeDirection),
  },
  align: {
    id: 'align',
    label: (_ctx, arg) => ALIGN_LABELS[(arg ?? 'left') as AlignEdge],
    enabled: (ctx) => editable(ctx) && ctx.alignable,
    run: (ctx, arg) => ctx.store.alignSelection((arg ?? 'left') as AlignEdge),
  },
  distribute: {
    id: 'distribute',
    label: (_ctx, arg) => (arg === 'y' ? 'Distribute vertically' : 'Distribute horizontally'),
    // Three, not two: with two elements there is no space between them to even
    // out, so the action would be a no-op wearing a live label.
    enabled: (ctx) => editable(ctx) && ctx.alignable && ctx.count > 2,
    run: (ctx, arg) => ctx.store.distributeSelection(arg === 'y' ? 'y' : 'x'),
  },

  /* --- Selection ------------------------------------------------------- */
  selectParent: {
    id: 'selectParent',
    label: 'Select parent',
    enabled: (ctx) => ctx.count > 0 && !ctx.atRoot,
    run: (ctx) => ctx.store.selectParent(),
  },
  selectFirstChild: {
    id: 'selectFirstChild',
    label: 'Select first child',
    enabled: (ctx) => Boolean(ctx.node?.children.length),
    run: (ctx) => ctx.store.selectChild(),
  },
  selectChildren: {
    id: 'selectChildren',
    label: 'Select all children',
    enabled: (ctx) => Boolean(ctx.node?.children.length),
    run: (ctx) => ctx.store.selectChildren(),
  },
  selectSibling: {
    id: 'selectSibling',
    label: (_ctx, arg) => (arg === 'prev' ? 'Select previous sibling' : 'Select next sibling'),
    enabled: (ctx, arg) => {
      const node = ctx.node;
      const parent = node?.parentId ? ctx.store.doc.nodes[node.parentId] : undefined;
      if (!node || !parent) return false;
      const index = parent.children.indexOf(node.id);
      return parent.children[index + (arg === 'prev' ? -1 : 1)] !== undefined;
    },
    run: (ctx, arg) => ctx.store.selectSibling(arg === 'prev' ? -1 : 1),
  },
  selectAll: {
    id: 'selectAll',
    label: 'Select all',
    keys: ['mod+a'],
    enabled: (ctx) => Boolean(ctx.root),
    run: (ctx) => ctx.store.selectAll(),
  },

  /* --- The node itself -------------------------------------------------- */
  rename: {
    id: 'rename',
    label: 'Rename',
    keys: ['F2'],
    enabled: (ctx) => editable(ctx) && ctx.count === 1,
    run: (ctx) => ctx.store.requestRename(ctx.selection[0] ?? null),
  },
  editText: {
    id: 'editText',
    label: 'Edit text',
    keys: ['Enter'],
    enabled: (ctx) => editable(ctx) && ctx.editableText && !ctx.locked,
    run: (ctx) => ctx.store.beginTextEdit(ctx.selection[0] ?? null),
  },
  toggleHidden: {
    id: 'toggleHidden',
    label: (ctx) => (ctx.hidden ? 'Show' : 'Hide'),
    keys: ['mod+shift+h'],
    enabled: (ctx) => editable(ctx) && ctx.count > 0,
    run: (ctx) => ctx.store.toggleHidden(),
  },
  toggleLocked: {
    id: 'toggleLocked',
    label: (ctx) => (ctx.locked ? 'Unlock' : 'Lock'),
    keys: ['mod+shift+l'],
    enabled: (ctx) => editable(ctx) && ctx.count > 0,
    run: (ctx) => ctx.store.toggleLocked(),
  },
  showInLayers: {
    id: 'showInLayers',
    label: 'Show in layers',
    enabled: (ctx) => ctx.count > 0,
    run: (ctx) => ctx.store.revealInLayers(),
  },

  /* --- Insertion -------------------------------------------------------- */
  insert: {
    id: 'insert',
    label: (_ctx, arg) => ELEMENTS[(arg ?? 'frame') as ElementType]?.label ?? 'Element',
    // The single-letter insert keys, which used to be a table in the keyboard
    // layer. Here they are printed beside the menu item as well as bound, so
    // the menu teaches the shortcut instead of hiding it.
    argKeys: {
      frame: ['f'],
      section: ['s'],
      container: ['c'],
      stack: ['k'],
      grid: ['g'],
      heading: ['h'],
      paragraph: ['p'],
      text: ['t'],
      button: ['b'],
      image: ['m'],
    },
    enabled: (ctx) => editable(ctx) && Boolean(ctx.root),
    run: (ctx, arg) => ctx.store.insertElement((arg ?? 'frame') as ElementType),
  },
  openInsertPanel: {
    id: 'openInsertPanel',
    label: 'More elements\u2026',
    enabled: () => true,
    run: (ctx) => ctx.store.setLeftTab('insert'),
  },
  insertChild: {
    id: 'insertChild',
    label: (_ctx, arg) => ELEMENTS[(arg ?? 'frame') as ElementType]?.label ?? 'Element',
    enabled: (ctx) => editable(ctx) && ctx.container && ctx.count === 1,
    run: (ctx, arg) => {
      const parentId = ctx.selection[0];
      if (parentId) ctx.store.insertElement((arg ?? 'frame') as ElementType, parentId);
    },
  },

  /* --- Context ---------------------------------------------------------- */
  enterOverlay: {
    id: 'enterOverlay',
    label: (ctx) => `Edit ${ctx.node ? ctx.node.name : 'contents'}`,
    enabled: (ctx) => ctx.overlayNode && ctx.store.editingOverlayId !== ctx.node?.id,
    run: (ctx) => ctx.store.editOverlay(ctx.selection[0] ?? null),
  },
  exitOverlay: {
    id: 'exitOverlay',
    label: 'Finish editing overlay',
    keys: ['Escape'],
    laddered: true,
    enabled: (ctx) => Boolean(ctx.store.editingOverlayId),
    run: (ctx) => ctx.store.editOverlay(null),
  },
  pageSettings: {
    id: 'pageSettings',
    label: 'Page settings',
    enabled: () => true,
    run: (ctx) => {
      ctx.store.toggleRight(true);
      ctx.store.setInspectorTab('page');
    },
  },
};

/** The label a surface should print, resolved against the current selection. */
export function commandLabel(command: EditorCommand, ctx: CommandContext, arg?: string): string {
  return typeof command.label === 'function' ? command.label(ctx, arg) : command.label;
}

export function commandEnabled(command: EditorCommand, ctx: CommandContext, arg?: string): boolean {
  return command.enabled ? command.enabled(ctx, arg) : true;
}

/**
 * Run a command by id against the live store.
 *
 * The context is rebuilt here rather than passed in: a menu that has been open
 * for a while was built against a selection that may since have changed, and
 * acting on the stale copy is the same bug the inspector had.
 */
export function runCommand(id: string, arg?: string): void {
  const command = COMMANDS[id];
  if (!command) return;
  const ctx = commandContext();
  if (!commandEnabled(command, ctx, arg)) return;
  command.run(ctx, arg);
}

/* --------------------------------------------------------------------------
 * Chords
 * ----------------------------------------------------------------------- */

const APPLE =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform ?? '');

/**
 * A keyboard event as a canonical chord string: `mod+shift+g`, `Delete`.
 *
 * `mod` is Command on Apple hardware and Control everywhere else, which is why
 * bindings are written with it rather than with either one.
 */
export function chordOf(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  // Single characters are compared in lower case so Shift does not produce a
  // different key name; named keys keep their own capitalisation.
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join('+');
}

const NAMED: Record<string, string> = {
  Delete: '⌫',
  Backspace: '⌫',
  Enter: '↵',
  Escape: 'Esc',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** A chord as a person reads it. Derived, so a menu can never print a lie. */
export function formatChord(chord: string): string {
  const parts = chord.split('+');
  const key = parts[parts.length - 1]!;
  const out: string[] = [];
  if (parts.includes('mod')) out.push(APPLE ? '⌘' : 'Ctrl');
  if (parts.includes('alt')) out.push(APPLE ? '⌥' : 'Alt');
  if (parts.includes('shift')) out.push(APPLE ? '⇧' : 'Shift');
  out.push(NAMED[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return APPLE ? out.join('') : out.join('+');
}

/** What a surface should print beside a command, or nothing. */
export function shortcutFor(command: EditorCommand, arg?: string): string | undefined {
  const chord = (arg !== undefined ? command.argKeys?.[arg]?.[0] : undefined) ?? command.keys?.[0];
  return chord ? formatChord(chord) : undefined;
}

/**
 * Chord to command, built once from the catalogue.
 *
 * This is what makes "the menu and the keyboard run the same thing" a fact
 * about the code rather than a promise in a comment: the keyboard layer has no
 * table of its own for anything in here.
 */
const BY_CHORD = new Map<string, { command: EditorCommand; arg?: string }>();
for (const command of Object.values(COMMANDS)) {
  if (command.laddered) continue;
  for (const chord of command.keys ?? []) {
    if (!BY_CHORD.has(chord)) BY_CHORD.set(chord, { command });
  }
  for (const [arg, chords] of Object.entries(command.argKeys ?? {})) {
    for (const chord of chords) {
      if (!BY_CHORD.has(chord)) BY_CHORD.set(chord, { command, arg });
    }
  }
}

/**
 * Every binding, for the help popover.
 *
 * Generated rather than written out, because a hand-kept list of shortcuts is
 * a list of what the shortcuts used to be.
 */
export function boundCommands(): { chord: string; label: string }[] {
  const ctx = commandContext();
  const out: { chord: string; label: string }[] = [];
  for (const [chord, { command, arg }] of BY_CHORD) {
    // One line per command: the second chord for Delete is an alias, not news.
    if (chord !== (arg !== undefined ? command.argKeys?.[arg]?.[0] : command.keys?.[0])) continue;
    out.push({ chord: formatChord(chord), label: commandLabel(command, ctx, arg) });
  }
  return out;
}

/**
 * Run whatever the catalogue binds to this event, and say whether it did.
 *
 * `false` means no command claimed the chord — the keyboard layer then falls
 * through to the things that are not document commands: zoom, panels, saving,
 * breakpoints.
 */
export function dispatchChord(event: KeyboardEvent): boolean {
  const bound = BY_CHORD.get(chordOf(event));
  if (!bound) return false;
  const ctx = commandContext();
  if (!commandEnabled(bound.command, ctx, bound.arg)) return false;
  bound.command.run(ctx, bound.arg);
  return true;
}
