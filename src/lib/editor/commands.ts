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

import { BREAKPOINT_DEFS, type Breakpoint } from '../document/types';
import { ELEMENTS, getElement } from '../document/schema';
import { describeElement } from '../renderer/element-model';
import type {
  Asset,
  ComponentDefinition,
  ElementType,
  NodeId,
  Page,
  SceneNode,
  StyleProp,
} from '../document/types';
import {
  activeRootId,
  alignableSelection,
  useEditor,
  type AlignEdge,
  type ArrangeDirection,
  type EditorStore,
} from './store';

/* --------------------------------------------------------------------------
 * Subjects
 * ----------------------------------------------------------------------- */

/**
 * What was right-clicked, as opposed to what should be done about it.
 *
 * A caller says "this was a padding row" and stops there. It cannot supply
 * actions — that is still the catalogue's job and only the catalogue's — but
 * without this the inspector's menu could only ever be about the element,
 * which is not what somebody right-clicking a shadow field is asking about.
 *
 * `element` is the default and needs no subject at all; the canvas and the
 * layer tree pass nothing.
 */
export type MenuSubject =
  | { kind: 'style'; props: StyleProp[]; label: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'component'; componentId: string }
  | { kind: 'variant'; componentId: string; variantId: string }
  | { kind: 'asset'; assetId: string };

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
  /** What was right-clicked, when it was something more specific than an element. */
  subject?: MenuSubject;
  /** Which style layer the inspector is writing to, for wording that says so. */
  breakpoint: Breakpoint;
  /** A rule is selected, so Reset means "reset in this state". */
  ruleName?: string;
}

export function commandContext(
  subject?: MenuSubject,
  store: EditorStore = useEditor.getState()
): CommandContext {
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
    subject,
    breakpoint: store.breakpoint,
    ruleName: activeRuleName(store),
  };
}

function activeRuleName(store: EditorStore): string | undefined {
  if (!store.activeRuleId) return undefined;
  const node = store.selection[0] ? store.doc.nodes[store.selection[0]] : undefined;
  const rule = node?.rules?.find((r) => r.id === store.activeRuleId);
  if (!rule) return undefined;
  return rule.part ? `::${rule.part}` : (rule.when?.[0]?.kind ?? 'this state');
}

/** The style subject, when there is one. Property commands are gated on it. */
function styleSubject(ctx: CommandContext): { props: StyleProp[]; label: string } | null {
  return ctx.subject?.kind === 'style' && ctx.subject.props.length ? ctx.subject : null;
}

/*
 * The library subjects, each resolved to the thing it names.
 *
 * Resolved rather than trusted: a menu can outlive what it was opened on — a
 * collaborator deleting a page while somebody's pointer is over its menu is
 * not exotic — and a command that ran on a missing id would be a silent no-op
 * at best. Returning null disables the row instead.
 */
function pageOf(ctx: CommandContext): Page | null {
  const subject = ctx.subject;
  if (subject?.kind !== 'page') return null;
  return ctx.store.doc.pages.find((p) => p.id === subject.pageId) ?? null;
}

function componentOf(ctx: CommandContext): ComponentDefinition | null {
  const subject = ctx.subject;
  if (subject?.kind !== 'component' && subject?.kind !== 'variant') return null;
  return ctx.store.doc.components.find((c) => c.id === subject.componentId) ?? null;
}

function variantOf(
  ctx: CommandContext
): { component: ComponentDefinition; variantId: string } | null {
  const subject = ctx.subject;
  if (subject?.kind !== 'variant') return null;
  const component = componentOf(ctx);
  const variantId = subject.variantId;
  return component?.variants?.some((v) => v.id === variantId)
    ? { component, variantId }
    : null;
}

function assetOf(ctx: CommandContext): Asset | null {
  const subject = ctx.subject;
  if (subject?.kind !== 'asset') return null;
  return ctx.store.doc.assets.find((a) => a.id === subject.assetId) ?? null;
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
  /**
   * A key into the menu's icon map, not a component.
   *
   * This module is data — it is read by the keyboard layer, which has no use
   * for an SVG, and by a static check that parses it. Naming an icon keeps the
   * catalogue free of React while still letting the menu draw one.
   */
  icon?: string;
  /** Renders a tick. For the handful of items that report a setting's state. */
  checked?: (ctx: CommandContext) => boolean;
  /** Absent means "always", which is true of very few of them. */
  enabled?: (ctx: CommandContext, arg?: string) => boolean;
  run: (ctx: CommandContext, arg?: string) => void;
}

/** Does the subject resolve to anything at all right now? */
function hasAnyValue(ctx: CommandContext): boolean {
  const subject = styleSubject(ctx);
  if (!subject) return false;
  return ctx.selection.some((id) => {
    const node = ctx.store.doc.nodes[id];
    if (!node) return false;
    return subject.props.some((prop) =>
      Object.values(node.styles).some((layer) => layer?.[prop] !== undefined) ||
      (node.rules ?? []).some((rule) => rule.apply[prop] !== undefined)
    );
  });
}

/** Declared in more than one layer or rule, so "everywhere" means something. */
function declaredInMoreThanOnePlace(ctx: CommandContext): boolean {
  const subject = styleSubject(ctx);
  if (!subject) return false;
  return ctx.selection.some((id) => {
    const node = ctx.store.doc.nodes[id];
    if (!node) return false;
    let places = 0;
    for (const prop of subject.props) {
      for (const layer of Object.values(node.styles)) if (layer?.[prop] !== undefined) places++;
      for (const rule of node.rules ?? []) if (rule.apply[prop] !== undefined) places++;
      if (places > 1) return true;
    }
    return false;
  });
}

/**
 * How many instances a component has, and how many nodes use an asset.
 *
 * Both go in the Delete label. Deleting a component detaches every instance
 * and deleting an asset leaves images pointing at nothing; a count is the
 * difference between an informed decision and a surprise.
 */
function instanceCount(ctx: CommandContext): number {
  const component = componentOf(ctx);
  if (!component) return 0;
  return Object.values(ctx.store.doc.nodes).filter(
    (n) => n.type === 'instance' && n.props.componentId === component.id
  ).length;
}

function assetUses(ctx: CommandContext): number {
  const asset = assetOf(ctx);
  if (!asset) return 0;
  return Object.values(ctx.store.doc.nodes).filter((n) => n.props.src === asset.url).length;
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
    icon: 'scissors',
    label: 'Cut',
    keys: ['mod+x'],
    enabled: movable,
    run: (ctx) => ctx.store.cutSelection(),
  },
  copy: {
    id: 'copy',
    icon: 'copy',
    label: 'Copy',
    keys: ['mod+c'],
    enabled: (ctx) => ctx.count > 0,
    run: (ctx) => ctx.store.copySelection(),
  },
  paste: {
    id: 'paste',
    icon: 'clipboard',
    label: 'Paste',
    keys: ['mod+v'],
    enabled: (ctx) => editable(ctx) && Boolean(ctx.store.clipboard),
    run: (ctx) => ctx.store.paste(),
  },
  duplicate: {
    id: 'duplicate',
    icon: 'copyPlus',
    label: 'Duplicate',
    keys: ['mod+d'],
    enabled: movable,
    run: (ctx) => ctx.store.duplicateSelection(),
  },
  delete: {
    id: 'delete',
    icon: 'trash',
    label: 'Delete',
    keys: ['Delete', 'Backspace'],
    danger: true,
    enabled: movable,
    run: (ctx) => ctx.store.deleteSelection(),
  },

  pasteInto: {
    id: 'pasteInto',
    icon: 'clipboardPlus',
    label: 'Paste inside',
    // Distinct from Paste, which lands *beside* the selection. On a container
    // the two mean different things and picking one for you is guessing.
    enabled: (ctx) => editable(ctx) && ctx.container && ctx.count === 1 && Boolean(ctx.store.clipboard),
    run: (ctx) => ctx.store.pasteInto(),
  },

  /* --- Styles ---------------------------------------------------------- */
  copyStyles: {
    id: 'copyStyles',
    icon: 'paintbrush',
    label: 'Copy styles',
    enabled: (ctx) => ctx.count === 1,
    run: (ctx) => ctx.store.copyStyles(),
  },
  pasteStyles: {
    id: 'pasteStyles',
    icon: 'paintRoller',
    label: 'Paste styles',
    enabled: (ctx) => editable(ctx) && ctx.count > 0 && Boolean(ctx.store.styleSource),
    run: (ctx) => ctx.store.pasteStyles(),
  },
  resetStyles: {
    id: 'resetStyles',
    icon: 'rotate',
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

  /* --- One property, or one section of them ----------------------------- */
  /*
   * Everything here is gated on a style subject, so none of it appears on the
   * canvas or in the layer tree — there is no property to be about out there.
   * The wording names what was clicked and where it is writing, because "Reset"
   * on its own is a question ("reset what, at which width?") rather than an
   * answer.
   */
  resetProperty: {
    id: 'resetProperty',
    icon: 'rotate',
    label: (ctx) => {
      const subject = styleSubject(ctx);
      if (!subject) return 'Reset';
      if (ctx.ruleName) return `Reset ${subject.label.toLowerCase()} in this state`;
      return ctx.breakpoint === 'desktop'
        ? `Reset ${subject.label.toLowerCase()}`
        : `Reset ${subject.label.toLowerCase()} on ${BREAKPOINT_DEFS[ctx.breakpoint].label}`;
    },
    enabled: (ctx) => editable(ctx) && hasAnyValue(ctx),
    run: (ctx) => {
      const subject = styleSubject(ctx);
      if (subject) ctx.store.resetStyleProps(subject.props);
    },
  },
  resetPropertyEverywhere: {
    id: 'resetPropertyEverywhere',
    icon: 'rotate',
    label: (ctx) => `Reset ${styleSubject(ctx)?.label.toLowerCase() ?? 'this'} everywhere`,
    danger: true,
    // Only where it would do more than the plain Reset: with one breakpoint in
    // play and no rules, the two are the same action wearing two labels.
    enabled: (ctx) => editable(ctx) && declaredInMoreThanOnePlace(ctx),
    run: (ctx) => {
      const subject = styleSubject(ctx);
      if (subject) ctx.store.resetStylePropsEverywhere(subject.props);
    },
  },
  copyValue: {
    id: 'copyValue',
    icon: 'copy',
    label: (ctx) => `Copy ${styleSubject(ctx)?.label.toLowerCase() ?? 'value'}`,
    enabled: (ctx) => ctx.count > 0 && hasAnyValue(ctx),
    run: (ctx) => {
      const subject = styleSubject(ctx);
      if (subject) ctx.store.copyStyleValues(subject.props, subject.label);
    },
  },
  pasteValue: {
    id: 'pasteValue',
    icon: 'clipboard',
    label: (ctx) => {
      const held = ctx.store.valueClipboard?.label;
      return held ? `Paste ${held.toLowerCase()}` : 'Paste value';
    },
    enabled: (ctx) => editable(ctx) && ctx.count > 0 && Boolean(ctx.store.valueClipboard),
    run: (ctx) => {
      // Narrowed to the row when the menu was opened on one, whole otherwise.
      const subject = styleSubject(ctx);
      ctx.store.pasteStyleValues(subject?.props);
    },
  },
  liftToAllBreakpoints: {
    id: 'liftToAllBreakpoints',
    icon: 'monitor',
    label: 'Apply at every width',
    // Nothing to lift from the widest layer: it is already the answer
    // everywhere unless something narrower overrides it, and that is what the
    // narrower breakpoints' own menus are for.
    enabled: (ctx) => editable(ctx) && ctx.breakpoint !== 'desktop' && hasAnyValue(ctx),
    run: (ctx) => {
      const subject = styleSubject(ctx);
      if (subject) ctx.store.liftToAllBreakpoints(subject.props);
    },
  },

  /* --- Structure ------------------------------------------------------- */
  group: {
    id: 'group',
    icon: 'group',
    label: 'Group',
    keys: ['mod+g'],
    enabled: movable,
    run: (ctx) => ctx.store.groupSelection(),
  },
  ungroup: {
    id: 'ungroup',
    icon: 'ungroup',
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
    icon: 'link',
    label: 'Wrap in link',
    enabled: movable,
    run: (ctx) => ctx.store.wrapInLink(),
  },

  /* --- Components ------------------------------------------------------ */
  createComponent: {
    id: 'createComponent',
    icon: 'component',
    label: 'Create component',
    keys: ['mod+e'],
    enabled: (ctx) => movable(ctx) && ctx.count === 1 && !ctx.instance,
    run: (ctx) => ctx.store.createComponentFromSelection(),
  },
  editComponent: {
    id: 'editComponent',
    icon: 'squarePen',
    label: 'Edit component',
    enabled: (ctx) => ctx.instance,
    run: (ctx) => {
      const componentId = ctx.node?.props.componentId;
      if (typeof componentId === 'string') ctx.store.editComponent(componentId);
    },
  },
  resetInstanceOverrides: {
    id: 'resetInstanceOverrides',
    icon: 'rotate',
    label: 'Reset to component',
    enabled: (ctx) =>
      editable(ctx) &&
      ctx.selection.some((id) => {
        const overrides = ctx.store.doc.nodes[id]?.overrides;
        return overrides !== undefined && Object.keys(overrides).length > 0;
      }),
    run: (ctx) => ctx.store.clearInstanceOverrides(),
  },
  detach: {
    id: 'detach',
    icon: 'unlink',
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
    icon: 'cornerUp',
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
    icon: 'boxSelect',
    label: 'Select all',
    keys: ['mod+a'],
    enabled: (ctx) => Boolean(ctx.root),
    run: (ctx) => ctx.store.selectAll(),
  },

  /* --- The node itself -------------------------------------------------- */
  rename: {
    id: 'rename',
    icon: 'pencil',
    label: 'Rename',
    keys: ['F2'],
    enabled: (ctx) => editable(ctx) && ctx.count === 1,
    run: (ctx) => ctx.store.requestRename(ctx.selection[0] ?? null),
  },
  editText: {
    id: 'editText',
    icon: 'type',
    label: 'Edit text',
    keys: ['Enter'],
    enabled: (ctx) => editable(ctx) && ctx.editableText && !ctx.locked,
    run: (ctx) => ctx.store.beginTextEdit(ctx.selection[0] ?? null),
  },
  toggleHidden: {
    id: 'toggleHidden',
    icon: 'eye',
    label: (ctx) => (ctx.hidden ? 'Show' : 'Hide'),
    keys: ['mod+shift+h'],
    enabled: (ctx) => editable(ctx) && ctx.count > 0,
    run: (ctx) => ctx.store.toggleHidden(),
  },
  toggleLocked: {
    id: 'toggleLocked',
    icon: 'lock',
    label: (ctx) => (ctx.locked ? 'Unlock' : 'Lock'),
    keys: ['mod+shift+l'],
    enabled: (ctx) => editable(ctx) && ctx.count > 0,
    run: (ctx) => ctx.store.toggleLocked(),
  },
  showInLayers: {
    id: 'showInLayers',
    icon: 'layers',
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
    icon: 'plus',
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
    icon: 'enter',
    label: (ctx) => `Edit ${ctx.node ? ctx.node.name : 'contents'}`,
    enabled: (ctx) => ctx.overlayNode && ctx.store.editingOverlayId !== ctx.node?.id,
    run: (ctx) => ctx.store.editOverlay(ctx.selection[0] ?? null),
  },
  exitOverlay: {
    id: 'exitOverlay',
    icon: 'exit',
    label: 'Finish editing overlay',
    keys: ['Escape'],
    laddered: true,
    enabled: (ctx) => Boolean(ctx.store.editingOverlayId),
    run: (ctx) => ctx.store.editOverlay(null),
  },
  /* --- A page in the Pages panel ----------------------------------------- */
  /*
   * All gated on `pageOf`, so none of them can appear anywhere but a page row,
   * and none can act on a page a collaborator has meanwhile deleted.
   */
  openPage: {
    id: 'openPage',
    icon: 'file',
    label: 'Open',
    enabled: (ctx) => Boolean(pageOf(ctx)) && ctx.store.activePageId !== pageOf(ctx)?.id,
    run: (ctx) => {
      const page = pageOf(ctx);
      if (page) ctx.store.setActivePage(page.id);
    },
  },
  duplicatePage: {
    id: 'duplicatePage',
    icon: 'copyPlus',
    label: 'Duplicate page',
    enabled: (ctx) => editable(ctx) && Boolean(pageOf(ctx)),
    run: (ctx) => {
      const page = pageOf(ctx);
      if (page) ctx.store.duplicatePage(page.id);
    },
  },
  setHomePage: {
    id: 'setHomePage',
    icon: 'home',
    label: 'Set as home',
    enabled: (ctx) => editable(ctx) && Boolean(pageOf(ctx)) && !pageOf(ctx)?.isHome,
    run: (ctx) => {
      const page = pageOf(ctx);
      if (page) ctx.store.setHomePage(page.id);
    },
  },
  movePage: {
    id: 'movePage',
    icon: 'layers',
    label: (_ctx, arg) => (arg === 'up' ? 'Move up' : 'Move down'),
    enabled: (ctx, arg) => {
      const page = pageOf(ctx);
      if (!editable(ctx) || !page) return false;
      const ordered = [...ctx.store.doc.pages].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex((p) => p.id === page.id);
      return arg === 'up' ? index > 0 : index >= 0 && index < ordered.length - 1;
    },
    run: (ctx, arg) => {
      const page = pageOf(ctx);
      if (page) ctx.store.movePage(page.id, arg === 'up' ? -1 : 1);
    },
  },
  renamePage: {
    id: 'renamePage',
    icon: 'pencil',
    label: 'Rename',
    enabled: (ctx) => editable(ctx) && Boolean(pageOf(ctx)),
    run: (ctx) => {
      const page = pageOf(ctx);
      if (page) ctx.store.requestRename(page.id);
    },
  },
  deletePage: {
    id: 'deletePage',
    icon: 'trash',
    label: 'Delete page',
    danger: true,
    // The last page cannot go, and the store refuses it too — this is so the
    // row says so rather than looking live and doing nothing.
    enabled: (ctx) => editable(ctx) && Boolean(pageOf(ctx)) && ctx.store.doc.pages.length > 1,
    run: (ctx) => {
      const page = pageOf(ctx);
      if (page) ctx.store.removePage(page.id);
    },
  },
  addPage: {
    id: 'addPage',
    icon: 'plus',
    label: 'New page',
    enabled: editable,
    run: (ctx) => ctx.store.addPage(),
  },

  /* --- A component, or one of its variants -------------------------------- */
  editComponentMain: {
    id: 'editComponentMain',
    icon: 'squarePen',
    label: 'Edit main component',
    enabled: (ctx) => Boolean(componentOf(ctx)),
    run: (ctx) => {
      const component = componentOf(ctx);
      if (component) ctx.store.editComponent(component.id);
    },
  },
  insertInstance: {
    id: 'insertInstance',
    icon: 'plus',
    label: 'Insert instance',
    enabled: (ctx) => editable(ctx) && Boolean(componentOf(ctx)) && Boolean(ctx.root),
    run: (ctx) => {
      const component = componentOf(ctx);
      if (component) ctx.store.insertComponentInstance(component.id);
    },
  },
  addVariant: {
    id: 'addVariant',
    icon: 'copyPlus',
    label: 'Add a variant',
    enabled: (ctx) => editable(ctx) && Boolean(componentOf(ctx)),
    run: (ctx) => {
      const component = componentOf(ctx);
      if (!component) return;
      // From the variant you right-clicked when you right-clicked one, so
      // "add a variant" from a variant means "another like this".
      const from = ctx.subject?.kind === 'variant' ? ctx.subject.variantId : undefined;
      if (ctx.store.addComponentVariant(component.id, from)) {
        ctx.store.toast('Variant added', 'success');
      }
    },
  },
  renameComponent: {
    id: 'renameComponent',
    icon: 'pencil',
    label: 'Rename',
    enabled: (ctx) => editable(ctx) && Boolean(componentOf(ctx)),
    run: (ctx) => {
      const variant = variantOf(ctx);
      const component = componentOf(ctx);
      ctx.store.requestRename(variant ? variant.variantId : (component?.id ?? null));
    },
  },
  deleteComponent: {
    id: 'deleteComponent',
    icon: 'trash',
    label: (ctx) => {
      const count = instanceCount(ctx);
      return count ? `Delete component (${count} in use)` : 'Delete component';
    },
    danger: true,
    enabled: (ctx) => editable(ctx) && ctx.subject?.kind === 'component' && Boolean(componentOf(ctx)),
    run: (ctx) => {
      const component = componentOf(ctx);
      if (component) ctx.store.deleteComponent(component.id);
    },
  },
  editVariant: {
    id: 'editVariant',
    icon: 'squarePen',
    label: 'Edit this variant',
    enabled: (ctx) => Boolean(variantOf(ctx)),
    run: (ctx) => {
      const variant = variantOf(ctx);
      if (variant) ctx.store.editComponent(variant.component.id, variant.variantId);
    },
  },
  deleteVariant: {
    id: 'deleteVariant',
    icon: 'trash',
    label: 'Delete variant',
    danger: true,
    enabled: (ctx) => editable(ctx) && Boolean(variantOf(ctx)),
    run: (ctx) => {
      const variant = variantOf(ctx);
      if (variant) ctx.store.removeComponentVariant(variant.component.id, variant.variantId);
    },
  },

  /* --- An asset ------------------------------------------------------------ */
  placeAsset: {
    id: 'placeAsset',
    icon: 'image',
    label: (ctx) => (assetOf(ctx)?.type === 'video' ? 'Place video' : 'Place image'),
    enabled: (ctx) => editable(ctx) && Boolean(assetOf(ctx)) && Boolean(ctx.root),
    run: (ctx) => {
      const asset = assetOf(ctx);
      if (asset) ctx.store.placeAsset(asset.id);
    },
  },
  copyAssetUrl: {
    id: 'copyAssetUrl',
    icon: 'link',
    label: 'Copy address',
    // Not for a blob or a data URL, which mean nothing outside this tab — an
    // address copied out of here has to be one somebody can paste somewhere.
    enabled: (ctx) => {
      const url = assetOf(ctx)?.url ?? '';
      return url.length > 0 && !url.startsWith('blob:') && !url.startsWith('data:');
    },
    run: (ctx) => {
      const asset = assetOf(ctx);
      if (asset) ctx.store.copyToClipboard(asset.url, 'Address copied');
    },
  },
  renameAsset: {
    id: 'renameAsset',
    icon: 'pencil',
    label: 'Rename',
    enabled: (ctx) => editable(ctx) && Boolean(assetOf(ctx)),
    run: (ctx) => {
      const asset = assetOf(ctx);
      if (asset) ctx.store.requestRename(asset.id);
    },
  },
  deleteAsset: {
    id: 'deleteAsset',
    icon: 'trash',
    label: (ctx) => {
      const uses = assetUses(ctx);
      return uses ? `Delete asset (used ${uses}\u00d7)` : 'Delete asset';
    },
    danger: true,
    enabled: (ctx) => editable(ctx) && Boolean(assetOf(ctx)),
    run: (ctx) => {
      const asset = assetOf(ctx);
      if (asset) ctx.store.removeAsset(asset.id);
    },
  },

  /* --- What the canvas shows -------------------------------------------- */
  toggleRulers: {
    id: 'toggleRulers',
    icon: 'ruler',
    label: 'Rulers',
    checked: (ctx) => ctx.store.showRulers,
    enabled: () => true,
    run: (ctx) => ctx.store.toggleRulers(),
  },
  toggleOutlines: {
    id: 'toggleOutlines',
    icon: 'frame',
    label: 'Outlines',
    checked: (ctx) => ctx.store.showOutlines,
    enabled: () => true,
    run: (ctx) => ctx.store.toggleOutlines(),
  },
  toggleSnap: {
    id: 'toggleSnap',
    icon: 'magnet',
    label: 'Snapping',
    checked: (ctx) => ctx.store.snapEnabled,
    enabled: () => true,
    run: (ctx) => ctx.store.toggleSnap(),
  },
  zoomFit: {
    id: 'zoomFit',
    icon: 'maximize',
    label: 'Fit to screen',
    keys: ['!'],
    enabled: () => true,
    run: (ctx) => ctx.store.requestFit(),
  },
  zoomReset: {
    id: 'zoomReset',
    icon: 'search',
    label: 'Zoom to 100%',
    enabled: (ctx) => Math.abs(ctx.store.zoom - 1) > 0.001,
    run: (ctx) => ctx.store.setZoom(1),
  },
  pageSettings: {
    id: 'pageSettings',
    icon: 'settings',
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
 * The *state* is rebuilt here rather than passed in: a menu that has been open
 * for a while was built against a selection that may since have changed, and
 * acting on the stale copy is the same bug the inspector had.
 *
 * The subject is not state and must be carried through, which is a lesson this
 * function learned the hard way — rebuilding without it left every property
 * command reading "no property was clicked", failing its own `enabled` check
 * and returning silently. Reset padding looked wired and did nothing.
 */
export function runCommand(id: string, arg?: string, subject?: MenuSubject): void {
  const command = COMMANDS[id];
  if (!command) return;
  const ctx = commandContext(subject);
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
