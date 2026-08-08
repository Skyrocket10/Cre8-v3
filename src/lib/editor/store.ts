'use client';

/**
 * The editor store.
 *
 * One store holds the document, the history stack and the transient UI state.
 * Components subscribe to narrow slices, so a hover change re-renders the
 * hover overlay and nothing else, and a style change re-renders exactly the
 * node that changed.
 *
 * Rule: nothing outside this file mutates `doc`. Every change goes through
 * `transact`, which produces immer patches and records them for undo.
 */

import { create } from 'zustand';
import { createEmptyDocument, structuredCloneCompat } from '../document/factory';
import { getElement } from '../document/schema';
import * as ops from '../document/operations';
import {
  collectSubtree,
  getHomePage,
  getNode,
  isEffectivelyLocked,
  topMostNodes,
  type NodeMap,
} from '../document/tree';
import type {
  Breakpoint,
  Cre8Document,
  ElementType,
  NodeId,
  NodeProps,
  StyleDecl,
  StyleProp,
  StyleState,
} from '../document/types';
import { commit, emptyHistory, redo as redoHistory, undo as undoHistory, type HistoryState } from '../history/history';
import { cloneSubtree } from '../document/factory';
import { uid } from '../document/id';

/* --------------------------------------------------------------------------
 * UI types
 * ----------------------------------------------------------------------- */

export type LeftTab = 'layers' | 'insert' | 'pages' | 'assets' | 'components' | 'theme';
export type InspectorTab = 'design' | 'page';
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline';

export interface DropIndicator {
  parentId: NodeId;
  index: number;
  /** Frame-space geometry of the insertion line. */
  rect: { x: number; y: number; width: number; height: number };
  orientation: 'horizontal' | 'vertical';
  /** Highlight the receiving container. */
  containerRect?: { x: number; y: number; width: number; height: number };
}

export type DragPayload =
  | { kind: 'new-element'; elementType: ElementType }
  | { kind: 'new-component'; componentId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'move'; nodeIds: NodeId[] };

export interface DragState {
  payload: DragPayload;
  /** Pointer position in viewport coordinates, for the drag preview. */
  x: number;
  y: number;
  label: string;
  /** True once the pointer has passed the drag threshold. */
  active: boolean;
}

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  kind: 'edge' | 'center' | 'spacing';
  label?: string;
}

/* --------------------------------------------------------------------------
 * State
 * ----------------------------------------------------------------------- */

interface EditorState {
  /* Document */
  doc: Cre8Document;
  history: HistoryState;
  loaded: boolean;

  /* Context */
  activePageId: string;
  /** When set, the canvas edits a component master instead of a page. */
  editingComponentId: string | null;

  /* Selection */
  selection: NodeId[];
  hoverId: NodeId | null;
  editingTextId: NodeId | null;

  /* Viewport */
  breakpoint: Breakpoint;
  zoom: number;
  pan: { x: number; y: number };
  fitRequest: number;
  spacePanning: boolean;

  /* Chrome */
  leftTab: LeftTab;
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
  inspectorTab: InspectorTab;
  /** Which style layer the inspector writes to: the base, or an interaction state. */
  styleState: 'default' | StyleState;
  previewing: boolean;
  previewDevice: Breakpoint;
  showRulers: boolean;
  showOutlines: boolean;
  snapEnabled: boolean;
  theme: 'dark' | 'light';

  /* Transient interaction */
  drag: DragState | null;
  dropIndicator: DropIndicator | null;
  guides: SnapGuide[];
  /** Bumped whenever something happened that overlays must re-measure after. */
  measureToken: number;

  /* Clipboard */
  clipboard: { nodes: NodeMap; rootIds: NodeId[] } | null;
  styleSource: NodeId | null;

  /* Persistence */
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  toasts: Toast[];
}

interface TransactOptions {
  /** Consecutive transactions with the same key merge into one undo step. */
  mergeKey?: string;
  select?: NodeId[];
  /** Skip the automatic overlay re-measure (pure metadata changes). */
  quiet?: boolean;
}

interface EditorActions {
  /* Lifecycle */
  loadDocument(doc: Cre8Document, pageId?: string): void;
  resetDocument(): void;

  /* Core */
  transact(
    label: string,
    recipe: (draft: Cre8Document) => NodeId[] | void,
    options?: TransactOptions
  ): void;
  undo(): void;
  redo(): void;

  /* Selection */
  select(ids: NodeId[] | NodeId | null, mode?: 'replace' | 'add' | 'toggle'): void;
  selectParent(): void;
  selectChild(): void;
  selectSibling(direction: 1 | -1): void;
  selectAll(): void;
  setHover(id: NodeId | null): void;
  beginTextEdit(id: NodeId | null): void;

  /* Viewport */
  setBreakpoint(bp: Breakpoint): void;
  setZoom(zoom: number, origin?: { x: number; y: number }): void;
  zoomBy(delta: number): void;
  requestFit(): void;
  setPan(pan: { x: number; y: number }): void;
  panBy(dx: number, dy: number): void;
  setSpacePanning(on: boolean): void;

  /* Chrome */
  setLeftTab(tab: LeftTab): void;
  toggleLeft(open?: boolean): void;
  toggleRight(open?: boolean): void;
  setLeftWidth(width: number): void;
  setRightWidth(width: number): void;
  setInspectorTab(tab: InspectorTab): void;
  setStyleState(state: 'default' | StyleState): void;
  setPreviewing(on: boolean): void;
  setPreviewDevice(bp: Breakpoint): void;
  toggleRulers(): void;
  toggleOutlines(): void;
  toggleSnap(): void;
  setTheme(theme: 'dark' | 'light'): void;

  /* Pages & components */
  setActivePage(pageId: string): void;
  editComponent(componentId: string | null): void;

  /* Document editing */
  insertElement(type: ElementType, parentId?: NodeId, index?: number): NodeId | null;
  insertComponentInstance(componentId: string, parentId?: NodeId, index?: number): NodeId | null;
  deleteSelection(): void;
  duplicateSelection(): void;
  moveSelection(parentId: NodeId, index: number): void;
  nudgeSelection(dx: number, dy: number): void;
  groupSelection(): void;
  ungroupSelection(): void;
  renameNode(id: NodeId, name: string): void;
  setNodeProps(patch: NodeProps, ids?: NodeId[]): void;
  setStyle(patch: StyleDecl, options?: TransactOptions & { ids?: NodeId[] }): void;
  clearStyle(props: StyleProp[], ids?: NodeId[]): void;
  setStateStyle(state: StyleState, patch: StyleDecl, options?: TransactOptions): void;
  toggleHidden(ids?: NodeId[]): void;
  toggleLocked(ids?: NodeId[]): void;
  reorderInParent(id: NodeId, direction: 1 | -1): void;

  /* Clipboard */
  copySelection(): void;
  cutSelection(): void;
  paste(): void;
  copyStyles(): void;
  pasteStyles(): void;

  /* Interaction */
  setDrag(drag: DragState | null): void;
  setDropIndicator(indicator: DropIndicator | null): void;
  setGuides(guides: SnapGuide[]): void;
  invalidate(): void;

  /* Persistence & feedback */
  setSaveStatus(status: SaveStatus): void;
  markSaved(): void;
  toast(message: string, tone?: Toast['tone'], action?: Toast['action']): void;
  dismissToast(id: string): void;
}

export type EditorStore = EditorState & EditorActions;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

function initialState(): EditorState {
  const doc = createEmptyDocument();
  return {
    doc,
    history: emptyHistory(),
    loaded: false,
    activePageId: doc.pages[0]?.id ?? '',
    editingComponentId: null,
    selection: [],
    hoverId: null,
    editingTextId: null,
    breakpoint: 'desktop',
    zoom: 1,
    pan: { x: 0, y: 0 },
    fitRequest: 0,
    spacePanning: false,
    leftTab: 'layers',
    leftOpen: true,
    leftWidth: 264,
    rightOpen: true,
    rightWidth: 288,
    inspectorTab: 'design',
    styleState: 'default',
    previewing: false,
    previewDevice: 'desktop',
    showRulers: true,
    showOutlines: false,
    snapEnabled: true,
    theme: 'dark',
    drag: null,
    dropIndicator: null,
    guides: [],
    measureToken: 0,
    clipboard: null,
    styleSource: null,
    saveStatus: 'idle',
    lastSavedAt: null,
    toasts: [],
  };
}

export const useEditor = create<EditorStore>()((set, get) => ({
  ...initialState(),

  /* ---------------------------------------------------------- lifecycle -- */

  loadDocument(doc, pageId) {
    const home = getHomePage(doc);
    set({
      doc,
      history: emptyHistory(),
      loaded: true,
      activePageId: pageId ?? home?.id ?? doc.pages[0]?.id ?? '',
      editingComponentId: null,
      selection: [],
      hoverId: null,
      editingTextId: null,
      saveStatus: 'saved',
      lastSavedAt: Date.now(),
      fitRequest: get().fitRequest + 1,
    });
  },

  resetDocument() {
    set(initialState());
  },

  /* --------------------------------------------------------------- core -- */

  transact(label, recipe, options) {
    const state = get();
    let selectAfter: NodeId[] | null = options?.select ?? null;

    const result = commit(
      state.doc,
      state.history,
      (draft) => {
        const returned = recipe(draft);
        if (Array.isArray(returned) && !options?.select) selectAfter = returned;
      },
      {
        label,
        selectionBefore: state.selection,
        selectionAfter: selectAfter ?? state.selection,
        pageBefore: state.activePageId,
        pageAfter: state.activePageId,
        mergeKey: options?.mergeKey,
      }
    );

    if (!result.changed) return;

    // Selection must not point at nodes the transaction removed.
    const nextSelection = (selectAfter ?? state.selection).filter((id) => result.doc.nodes[id]);

    set({
      doc: result.doc,
      history: result.history,
      selection: nextSelection,
      saveStatus: 'dirty',
      measureToken: options?.quiet ? state.measureToken : state.measureToken + 1,
    });
  },

  undo() {
    const { doc, history, measureToken } = get();
    const result = undoHistory(doc, history);
    if (!result.transaction) return;
    set({
      doc: result.doc,
      history: result.history,
      selection: result.transaction.selectionBefore.filter((id) => result.doc.nodes[id]),
      activePageId: result.doc.pages.some((p) => p.id === result.transaction!.pageBefore)
        ? result.transaction.pageBefore
        : (getHomePage(result.doc)?.id ?? ''),
      saveStatus: 'dirty',
      editingTextId: null,
      measureToken: measureToken + 1,
    });
  },

  redo() {
    const { doc, history, measureToken } = get();
    const result = redoHistory(doc, history);
    if (!result.transaction) return;
    set({
      doc: result.doc,
      history: result.history,
      selection: result.transaction.selectionAfter.filter((id) => result.doc.nodes[id]),
      activePageId: result.doc.pages.some((p) => p.id === result.transaction!.pageAfter)
        ? result.transaction.pageAfter
        : (getHomePage(result.doc)?.id ?? ''),
      saveStatus: 'dirty',
      editingTextId: null,
      measureToken: measureToken + 1,
    });
  },

  /* ---------------------------------------------------------- selection -- */

  select(ids, mode = 'replace') {
    const next = ids === null ? [] : Array.isArray(ids) ? ids : [ids];
    const { selection, doc } = get();
    const valid = next.filter((id) => doc.nodes[id]);

    let result: NodeId[];
    if (mode === 'replace') result = valid;
    else if (mode === 'add') result = [...new Set([...selection, ...valid])];
    else {
      const set_ = new Set(selection);
      for (const id of valid) (set_.has(id) ? set_.delete(id) : set_.add(id));
      result = [...set_];
    }

    if (result.length === selection.length && result.every((id, i) => selection[i] === id)) return;
    set({ selection: result, editingTextId: null });
  },

  selectParent() {
    const { selection, doc, activePageId } = get();
    const first = selection[0];
    if (!first) return;
    const page = doc.pages.find((p) => p.id === activePageId);
    const parentId = doc.nodes[first]?.parentId;
    if (!parentId) return;
    // Stop at the page root rather than selecting an unselectable container.
    get().select(parentId === page?.rootNodeId ? parentId : parentId);
  },

  selectChild() {
    const { selection, doc } = get();
    const first = selection[0];
    const child = first ? doc.nodes[first]?.children[0] : undefined;
    if (child) get().select(child);
  },

  selectSibling(direction) {
    const { selection, doc } = get();
    const first = selection[0];
    const node = first ? doc.nodes[first] : undefined;
    const parent = node?.parentId ? doc.nodes[node.parentId] : undefined;
    if (!node || !parent) return;
    const index = parent.children.indexOf(node.id);
    const next = parent.children[index + direction];
    if (next) get().select(next);
  },

  selectAll() {
    const { doc, activePageId, editingComponentId } = get();
    const rootId = editingComponentId
      ? doc.components.find((c) => c.id === editingComponentId)?.rootNodeId
      : doc.pages.find((p) => p.id === activePageId)?.rootNodeId;
    const root = rootId ? doc.nodes[rootId] : undefined;
    if (root) get().select([...root.children]);
  },

  setHover(id) {
    if (get().hoverId === id) return;
    set({ hoverId: id });
  },

  beginTextEdit(id) {
    set({ editingTextId: id, ...(id ? { selection: [id] } : {}) });
  },

  /* ----------------------------------------------------------- viewport -- */

  setBreakpoint(bp) {
    if (get().breakpoint === bp) return;
    set({ breakpoint: bp, fitRequest: get().fitRequest + 1, measureToken: get().measureToken + 1 });
  },

  setZoom(zoom) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (Math.abs(clamped - get().zoom) < 0.0001) return;
    set({ zoom: clamped, measureToken: get().measureToken + 1 });
  },

  zoomBy(delta) {
    get().setZoom(get().zoom * (1 + delta));
  },

  requestFit() {
    set({ fitRequest: get().fitRequest + 1 });
  },

  setPan(pan) {
    set({ pan });
  },

  panBy(dx, dy) {
    const { pan } = get();
    set({ pan: { x: pan.x + dx, y: pan.y + dy } });
  },

  setSpacePanning(on) {
    if (get().spacePanning === on) return;
    set({ spacePanning: on });
  },

  /* ------------------------------------------------------------- chrome -- */

  setLeftTab(tab) {
    set({ leftTab: tab, leftOpen: true });
  },
  toggleLeft(open) {
    set({ leftOpen: open ?? !get().leftOpen });
  },
  toggleRight(open) {
    set({ rightOpen: open ?? !get().rightOpen });
  },
  setLeftWidth(width) {
    set({ leftWidth: Math.min(460, Math.max(200, width)) });
  },
  setRightWidth(width) {
    set({ rightWidth: Math.min(460, Math.max(240, width)) });
  },
  setInspectorTab(tab) {
    set({ inspectorTab: tab });
  },
  setStyleState(state) {
    set({ styleState: state });
  },
  setPreviewing(on) {
    set({ previewing: on, previewDevice: get().breakpoint, editingTextId: null });
  },
  setPreviewDevice(bp) {
    set({ previewDevice: bp });
  },
  toggleRulers() {
    set({ showRulers: !get().showRulers });
  },
  toggleOutlines() {
    set({ showOutlines: !get().showOutlines });
  },
  toggleSnap() {
    set({ snapEnabled: !get().snapEnabled });
  },
  setTheme(theme) {
    set({ theme });
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem('cre8:theme', theme);
      } catch {
        /* storage can be unavailable; the theme still applies for this session */
      }
    }
  },

  /* ------------------------------------------------- pages & components -- */

  setActivePage(pageId) {
    if (get().activePageId === pageId && !get().editingComponentId) return;
    set({
      activePageId: pageId,
      editingComponentId: null,
      selection: [],
      hoverId: null,
      editingTextId: null,
      fitRequest: get().fitRequest + 1,
    });
  },

  editComponent(componentId) {
    set({
      editingComponentId: componentId,
      selection: [],
      hoverId: null,
      editingTextId: null,
      fitRequest: get().fitRequest + 1,
    });
  },

  /* ---------------------------------------------------- document edits -- */

  insertElement(type, parentId, index) {
    const state = get();
    const rootId = activeRootId(state);
    if (!rootId) return null;

    const target =
      parentId !== undefined
        ? { parentId, index: index ?? Number.MAX_SAFE_INTEGER }
        : ops.resolveInsertTarget(state.doc, state.selection[0] ?? null, rootId);

    let created: NodeId | null = null;
    get().transact(`Add ${getElement(type).label}`, (draft) => {
      created = ops.insertElement(draft, type, target.parentId, target.index);
      return created ? [created] : undefined;
    });
    return created;
  },

  insertComponentInstance(componentId, parentId, index) {
    const state = get();
    const rootId = activeRootId(state);
    if (!rootId) return null;
    const target =
      parentId !== undefined
        ? { parentId, index: index ?? Number.MAX_SAFE_INTEGER }
        : ops.resolveInsertTarget(state.doc, state.selection[0] ?? null, rootId);

    let created: NodeId | null = null;
    get().transact('Add component', (draft) => {
      created = ops.insertInstance(draft, componentId, target.parentId, target.index);
      return created ? [created] : undefined;
    });
    return created;
  },

  deleteSelection() {
    const { selection, doc } = get();
    const deletable = selection.filter((id) => isDeletable(doc, id));
    if (!deletable.length) return;

    // Land the caret somewhere sensible: the previous sibling, else the parent.
    const first = doc.nodes[deletable[0]!];
    const parent = first?.parentId ? doc.nodes[first.parentId] : undefined;
    const index = parent ? parent.children.indexOf(first!.id) : -1;
    const fallback =
      parent && index > 0 ? parent.children[index - 1]! : (parent?.id ?? null);

    get().transact(deletable.length > 1 ? 'Delete elements' : 'Delete element', (draft) => {
      ops.removeNodes(draft, deletable);
      return fallback ? [fallback] : [];
    });
  },

  duplicateSelection() {
    const { selection } = get();
    if (!selection.length) return;
    get().transact('Duplicate', (draft) => ops.duplicateNodes(draft, selection));
  },

  moveSelection(parentId, index) {
    const { selection } = get();
    if (!selection.length) return;
    get().transact('Move', (draft) => {
      ops.moveNodes(draft, selection, parentId, index);
      return selection;
    });
  },

  /**
   * Arrow-key nudge. Absolutely positioned elements move; elements in flow
   * change their order instead, because moving them by pixels would silently
   * produce a layout the designer didn't ask for.
   */
  nudgeSelection(dx, dy) {
    const { selection, doc, breakpoint } = get();
    if (!selection.length) return;

    const first = doc.nodes[selection[0]!];
    if (!first) return;
    const position = resolveStyleValue(doc, first.id, breakpoint, 'position');
    const absolute = position === 'absolute' || position === 'fixed';

    if (!absolute) {
      if (dy !== 0) get().reorderInParent(first.id, dy > 0 ? 1 : -1);
      return;
    }

    get().transact(
      'Nudge',
      (draft) => {
        for (const id of selection) {
          const node = draft.nodes[id];
          if (!node) continue;
          const layer = (node.styles[breakpoint] ??= {});
          const left = Number.parseFloat(String(layer.left ?? node.styles.desktop?.left ?? '0')) || 0;
          const top = Number.parseFloat(String(layer.top ?? node.styles.desktop?.top ?? '0')) || 0;
          if (dx) layer.left = `${left + dx}px`;
          if (dy) layer.top = `${top + dy}px`;
        }
      },
      { mergeKey: `nudge:${selection.join(',')}` }
    );
  },

  groupSelection() {
    const { selection } = get();
    if (selection.length < 1) return;
    get().transact('Group', (draft) => {
      const id = ops.groupNodes(draft, selection);
      return id ? [id] : undefined;
    });
  },

  ungroupSelection() {
    const { selection, doc } = get();
    const groups = selection.filter((id) => {
      const node = doc.nodes[id];
      return node && getElement(node.type).container && node.children.length > 0;
    });
    if (!groups.length) return;
    get().transact('Ungroup', (draft) => ops.ungroupNodes(draft, groups));
  },

  renameNode(id, name) {
    get().transact('Rename', (draft) => {
      ops.renameNode(draft, id, name);
    }, { quiet: true });
  },

  setNodeProps(patch, ids) {
    const targets = ids ?? get().selection;
    if (!targets.length) return;
    get().transact('Edit content', (draft) => {
      ops.setProps(draft, targets, patch);
      return targets;
    });
  },

  setStyle(patch, options) {
    const state = get();
    const targets = options?.ids ?? state.selection;
    if (!targets.length) return;
    get().transact(
      'Style',
      (draft) => {
        ops.setStyles(draft, targets, state.breakpoint, patch);
        return targets;
      },
      options
    );
  },

  clearStyle(props, ids) {
    const state = get();
    const targets = ids ?? state.selection;
    if (!targets.length) return;
    get().transact('Reset style', (draft) => {
      ops.clearStyles(draft, targets, state.breakpoint, props);
      return targets;
    });
  },

  setStateStyle(state_, patch, options) {
    const targets = get().selection;
    if (!targets.length) return;
    get().transact(
      'Style',
      (draft) => {
        ops.setStateStyles(draft, targets, state_, patch);
        return targets;
      },
      options
    );
  },

  toggleHidden(ids) {
    const { selection, doc } = get();
    const targets = ids ?? selection;
    if (!targets.length) return;
    const makeHidden = !doc.nodes[targets[0]!]?.meta.hidden;
    get().transact(makeHidden ? 'Hide' : 'Show', (draft) => {
      ops.setNodeMeta(draft, targets, { hidden: makeHidden || undefined });
      return targets;
    });
  },

  toggleLocked(ids) {
    const { selection, doc } = get();
    const targets = ids ?? selection;
    if (!targets.length) return;
    const makeLocked = !doc.nodes[targets[0]!]?.meta.locked;
    get().transact(makeLocked ? 'Lock' : 'Unlock', (draft) => {
      ops.setNodeMeta(draft, targets, { locked: makeLocked || undefined });
      return targets;
    }, { quiet: true });
  },

  reorderInParent(id, direction) {
    const { doc } = get();
    const node = doc.nodes[id];
    const parent = node?.parentId ? doc.nodes[node.parentId] : undefined;
    if (!node || !parent) return;
    const index = parent.children.indexOf(id);
    const next = index + direction;
    if (next < 0 || next >= parent.children.length) return;
    get().transact('Reorder', (draft) => {
      const p = draft.nodes[parent.id];
      if (!p) return;
      p.children.splice(index, 1);
      p.children.splice(next, 0, id);
      return [id];
    });
  },

  /* ---------------------------------------------------------- clipboard -- */

  copySelection() {
    const { selection, doc } = get();
    const roots = topMostNodes(doc.nodes, selection);
    if (!roots.length) return;
    const nodes: NodeMap = {};
    const rootIds: NodeId[] = [];
    for (const id of roots) {
      const copyId = cloneSubtree(doc.nodes, id, nodes, null);
      if (copyId) rootIds.push(copyId);
    }
    set({ clipboard: { nodes, rootIds } });
    get().toast(`Copied ${rootIds.length} element${rootIds.length > 1 ? 's' : ''}`);
  },

  cutSelection() {
    get().copySelection();
    get().deleteSelection();
  },

  paste() {
    const state = get();
    const clipboard = state.clipboard;
    const rootId = activeRootId(state);
    if (!clipboard || !rootId) return;

    const target = ops.resolveInsertTarget(state.doc, state.selection[0] ?? null, rootId);

    get().transact('Paste', (draft) => {
      const created: NodeId[] = [];
      let index = target.index;
      for (const sourceRoot of clipboard.rootIds) {
        // Clone again on every paste so repeated pastes get fresh ids.
        const fresh: NodeMap = {};
        const newRoot = cloneSubtree(clipboard.nodes, sourceRoot, fresh, target.parentId);
        if (!newRoot) continue;
        const node = fresh[newRoot];
        if (node) node.name = ops.uniqueName(draft.nodes, node.name);
        ops.insertSubtree(draft, fresh, newRoot, target.parentId, index++);
        created.push(newRoot);
      }
      return created;
    });
  },

  copyStyles() {
    const id = get().selection[0];
    if (!id) return;
    set({ styleSource: id });
    get().toast('Copied styles');
  },

  pasteStyles() {
    const { styleSource, selection } = get();
    if (!styleSource || !selection.length) return;
    get().transact('Paste styles', (draft) => {
      ops.pasteStyles(draft, styleSource, selection);
      return selection;
    });
  },

  /* -------------------------------------------------------- interaction -- */

  setDrag(drag) {
    set({ drag });
    if (!drag) set({ dropIndicator: null });
  },
  setDropIndicator(indicator) {
    const current = get().dropIndicator;
    if (
      current === indicator ||
      (current &&
        indicator &&
        current.parentId === indicator.parentId &&
        current.index === indicator.index &&
        current.rect.x === indicator.rect.x &&
        current.rect.y === indicator.rect.y)
    ) {
      return;
    }
    set({ dropIndicator: indicator });
  },
  setGuides(guides) {
    if (!guides.length && !get().guides.length) return;
    set({ guides });
  },
  invalidate() {
    set({ measureToken: get().measureToken + 1 });
  },

  /* ------------------------------------------------- persistence & UI -- */

  setSaveStatus(status) {
    set({ saveStatus: status });
  },
  markSaved() {
    set({ saveStatus: 'saved', lastSavedAt: Date.now() });
  },
  toast(message, tone = 'info', action) {
    const id = uid();
    set({ toasts: [...get().toasts.slice(-3), { id, message, tone, action }] });
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 2600);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/* --------------------------------------------------------------------------
 * Derived helpers
 * ----------------------------------------------------------------------- */

/** Root node currently on the canvas: a page root, or a component master. */
export function activeRootId(state: Pick<EditorState, 'doc' | 'activePageId' | 'editingComponentId'>): NodeId | null {
  if (state.editingComponentId) {
    return state.doc.components.find((c) => c.id === state.editingComponentId)?.rootNodeId ?? null;
  }
  return state.doc.pages.find((p) => p.id === state.activePageId)?.rootNodeId ?? null;
}

export function useActiveRootId(): NodeId | null {
  return useEditor((s) => activeRootId(s));
}

function isDeletable(doc: Cre8Document, id: NodeId): boolean {
  if (doc.pages.some((p) => p.rootNodeId === id)) return false;
  if (doc.components.some((c) => c.rootNodeId === id)) return false;
  return !isEffectivelyLocked(doc.nodes, id);
}

function resolveStyleValue(
  doc: Cre8Document,
  id: NodeId,
  breakpoint: Breakpoint,
  prop: StyleProp
): string | undefined {
  const node = doc.nodes[id];
  if (!node) return undefined;
  const order: Breakpoint[] =
    breakpoint === 'desktop'
      ? ['desktop']
      : breakpoint === 'tablet'
        ? ['desktop', 'tablet']
        : ['desktop', 'tablet', 'mobile'];
  let value: string | undefined;
  for (const bp of order) {
    const candidate = node.styles[bp]?.[prop];
    if (candidate !== undefined) value = candidate as string;
  }
  return value;
}

/** Snapshot of the document for saving, preview and publishing. */
export function snapshotDocument(): Cre8Document {
  const doc = useEditor.getState().doc;
  return structuredCloneCompat({ ...doc, updatedAt: Date.now() });
}

/** Cheap subscription for components that only need "is anything selected". */
export function useSelectionCount(): number {
  return useEditor((s) => s.selection.length);
}

export function useSelectedNode() {
  return useEditor((s) => (s.selection.length === 1 ? getNode(s.doc.nodes, s.selection[0]) : undefined));
}

export function useNodeById(id: NodeId | null | undefined) {
  return useEditor((s) => (id ? s.doc.nodes[id] : undefined));
}

/** Ids affected by an operation on the current selection, ancestors removed. */
export function effectiveSelection(): NodeId[] {
  const { doc, selection } = useEditor.getState();
  return topMostNodes(doc.nodes, selection);
}

export function subtreeSize(id: NodeId): number {
  return collectSubtree(useEditor.getState().doc.nodes, id).length;
}
