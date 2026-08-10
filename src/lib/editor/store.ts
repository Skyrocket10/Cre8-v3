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

import { applyPatches, type Patch } from 'immer';
import { create } from 'zustand';
import { createEmptyDocument } from '../document/factory';
import { getElement } from '../document/schema';
import * as ops from '../document/operations';
import { allRoots } from '../document/components';
import {
  getHomePage,
  isEffectivelyLocked,
  topMostNodes,
  type NodeMap,
} from '../document/tree';
import type {
  Breakpoint,
  CollectionRecord,
  Cre8Document,
  ElementType,
  NodeId,
  NodeProps,
  StyleDecl,
  StyleProp,
  Condition,
  Part,
  StyleRule,
} from '../document/types';
import { commit, emptyHistory, redo as redoHistory, undo as undoHistory, type HistoryState } from '../history/history';
import { cloneSubtree } from '../document/factory';
import { uid } from '../document/id';
import { getStorage } from '../api/storage';
import { api, type RecordInput } from '../api/client';

/* --------------------------------------------------------------------------
 * UI types
 * ----------------------------------------------------------------------- */

export type LeftTab =
  | 'layers'
  | 'insert'
  | 'pages'
  | 'assets'
  | 'components'
  | 'collections'
  | 'theme'
  | 'submissions';
export type InspectorTab = 'design' | 'page';
/**
 * `live` means a collaboration room is persisting for us.
 *
 * There is no debounced HTTP save in that mode — every patch is already on the
 * server before the indicator could have finished spinning.
 */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'live';

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
  /** Which of that component's trees. `null` is the default one. */
  editingVariantId: string | null;
  /**
   * An overlay opened *for editing*: a popover or a dialog.
   *
   * The third editing context, and the one that is a scope rather than a
   * place. A page and a component master are two different trees; an overlay
   * is a subtree of whichever of those is already open, and entering it
   * narrows what the editor will touch rather than navigating anywhere.
   *
   * That narrowing is the whole point. A popover on the canvas sits over the
   * page it belongs to, so without it the obvious gestures do the wrong thing:
   * an element dropped from the Insert panel lands on the page *behind* the
   * panel you are looking at, and a click meant for the panel selects whatever
   * it happens to be covering.
   */
  editingOverlayId: NodeId | null;

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
  /**
   * Which rule the style panels write into, or `null` for the base layer.
   *
   * Replaces `styleState`. The old field named a fixed set of states; a node
   * can now carry any number of rules, so the mode is an id.
   */
  activeRuleId: string | null;
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

  /**
   * Collection rows the canvas has loaded, by collection id.
   *
   * Not part of `doc`, and that is the whole point of the split: a schema is
   * design and belongs in the thing that is versioned, undone and
   * collaborated on; records are content, arrive over the network, and must
   * never enter the patch stream. An undo has to be unable to revert somebody
   * else's blog post.
   *
   * An absent key means "not asked for yet", which is what makes the load
   * lazy — a repeater asking is what fetches it. An empty array means asked
   * and there is nothing, so nothing asks again.
   */
  records: Record<string, CollectionRecord[]>;

  /* Persistence */
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  toasts: Toast[];

  /**
   * Set when the server says this person may look but not touch.
   *
   * Gating `transact` rather than disabling controls one by one means a new
   * panel is read-only the day it is written, without anyone remembering to
   * make it so. The server refuses the patches regardless — this exists so a
   * viewer sees an honest editor instead of edits that silently vanish.
   */
  readOnly: boolean;
}

/** A record as the form has it: no id yet when it is being created. */
export type RecordDraft = Omit<RecordInput, 'collectionId'> & { id?: string };

interface TransactOptions {
  /** Consecutive transactions with the same key merge into one undo step. */
  mergeKey?: string;
  select?: NodeId[];
  /** Skip the automatic overlay re-measure (pure metadata changes). */
  quiet?: boolean;
  /**
   * Set false for writes the system makes on the user's behalf, so they never
   * become something Ctrl+Z walks back. See `CommitInput.record`.
   */
  record?: boolean;
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

  /* Collaboration — applied from the room, never recorded in local history */
  applyRemotePatches(patches: Patch[]): void;
  replaceDocument(doc: Cre8Document): void;
  setReadOnly(readOnly: boolean): void;

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
  setActiveRule(ruleId: string | null): void;
  addRule(when: Condition[], part?: Part): string | null;
  removeRule(ruleId: string): void;
  moveRule(ruleId: string, delta: number): void;
  updateRule(ruleId: string, patch: Partial<Pick<StyleRule, 'when' | 'part' | 'breakpoint'>>): void;
  setPreviewing(on: boolean): void;
  setPreviewDevice(bp: Breakpoint): void;
  toggleRulers(): void;
  toggleOutlines(): void;
  toggleSnap(): void;
  setTheme(theme: 'dark' | 'light'): void;

  /* Pages & components */
  setActivePage(pageId: string): void;
  editComponent(componentId: string | null, variantId?: string | null): void;
  /**
   * Enter or leave an overlay's editing context.
   *
   * `null` returns to the page or master the overlay sits in — the overlay is
   * still there and still visible, it simply stops being what the editor is
   * pointed at.
   */
  editOverlay(nodeId: NodeId | null): void;

  /* Document editing */
  insertElement(type: ElementType, parentId?: NodeId, index?: number): NodeId | null;
  insertComponentInstance(componentId: string, parentId?: NodeId, index?: number): NodeId | null;
  deleteSelection(): void;
  duplicateSelection(): void;
  moveSelection(parentId: NodeId, index: number): void;
  nudgeSelection(dx: number, dy: number): void;
  groupSelection(): void;
  /**
   * Wrap the selection in a link, which is how anything becomes clickable.
   *
   * A link that holds a subtree rather than text — the markup a clickable card
   * should have had all along, and the reason this is a wrap rather than an
   * `onClick` on whatever happens to be selected.
   */
  wrapInLink(): void;
  ungroupSelection(): void;
  renameNode(id: NodeId, name: string): void;
  setNodeProps(patch: NodeProps, ids?: NodeId[]): void;
  setStyle(patch: StyleDecl, options?: TransactOptions & { ids?: NodeId[] }): void;
  clearStyle(props: StyleProp[], ids?: NodeId[]): void;
  setRuleStyle(ruleId: string, patch: StyleDecl, options?: TransactOptions & { ids?: NodeId[] }): void;
  setRuleProps(ruleId: string, patch: NodeProps, ids?: NodeId[]): void;
  /**
   * What one component instance says for itself. `undefined` resets it.
   *
   * Coalesced like a style scrub rather than recorded per keystroke: the
   * control is a text field, and one undo per character is not an undo stack.
   */
  setInstanceOverride(
    instanceId: NodeId,
    propertyId: string,
    value: string | number | boolean | null | undefined
  ): void;
  /** Which of the component's looks this instance wears. */
  setInstanceVariant(instanceId: NodeId, variantId: string | undefined): void;
  /** Clone a tree into a new variant and open it. Returns its id. */
  addComponentVariant(componentId: string, fromVariantId?: string): string | null;
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

  /* Collection records */
  loadRecords(collectionId: string): void;
  /** Fetch again whether or not it is already cached. */
  reloadRecords(collectionId: string): Promise<void>;
  saveRecord(collectionId: string, input: RecordDraft): Promise<boolean>;
  deleteRecord(collectionId: string, recordId: string): Promise<boolean>;
  /** Which record a dynamic page is drawn against on the canvas. */
  designAgainst(collectionId: string, recordId: string | null): void;

  /* Persistence & feedback */
  setSaveStatus(status: SaveStatus): void;
  markSaved(): void;
  toast(message: string, tone?: Toast['tone'], action?: Toast['action']): void;
  dismissToast(id: string): void;
}

export type EditorStore = EditorState & EditorActions;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

/* --------------------------------------------------------------------------
 * Collaboration hooks
 *
 * Kept as a module-level listener set rather than store state: the
 * collaboration layer is optional, and the store must not grow a dependency on
 * it. When nothing is listening these are a no-op and the editor behaves
 * exactly as it does offline.
 * ----------------------------------------------------------------------- */

type PatchListener = (patches: Patch[], label: string) => void;

const patchListeners = new Set<PatchListener>();

/** Called by the collaboration client to receive locally produced patches. */
export function onLocalPatches(listener: PatchListener): () => void {
  patchListeners.add(listener);
  return () => patchListeners.delete(listener);
}

/**
 * True while remote patches are being applied.
 *
 * Guards against echoing someone else's change straight back to the room.
 */
let applyingRemote = false;

/**
 * Collections with a load in the air.
 *
 * Module-level rather than store state because it is not something anything
 * renders — and because a repeater asks on every render until the rows land,
 * so without it a single canvas paint would fire one request per row.
 */
const inFlight = new Set<string>();

/** What a record write actually said, when it bothered to say something. */
function recordProblem(error: unknown): string {
  const said = error instanceof Error ? error.message.trim() : '';
  // The server explains the two that happen: a slug already taken, and a
  // record over the size limit. Both are the author's to fix, and both are
  // useless as "Could not save".
  return said && said.length < 200 ? said : 'Could not save that record.';
}

function initialState(): EditorState {
  const doc = createEmptyDocument();
  return {
    doc,
    history: emptyHistory(),
    loaded: false,
    activePageId: doc.pages[0]?.id ?? '',
    editingComponentId: null,
    editingVariantId: null,
    editingOverlayId: null,
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
    activeRuleId: null,
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
    records: {},
    saveStatus: 'idle',
    lastSavedAt: null,
    toasts: [],
    readOnly: false,
  };
}

export const useEditor = create<EditorStore>()((set, get) => ({
  ...initialState(),

  /* ---------------------------------------------------------- lifecycle -- */

  loadDocument(doc, pageId) {
    const home = getHomePage(doc);
    // Anything still in the air belongs to the project being left. Its result
    // is discarded on arrival, but the entry would otherwise stay claimed and
    // a collection of the same id in the new project would never load.
    inFlight.clear();
    set({
      doc,
      history: emptyHistory(),
      loaded: true,
      activePageId: pageId ?? home?.id ?? doc.pages[0]?.id ?? '',
      editingComponentId: null,
      editingVariantId: null,
      editingOverlayId: null,
      selection: [],
      hoverId: null,
      editingTextId: null,
      saveStatus: 'saved',
      lastSavedAt: Date.now(),
      fitRequest: get().fitRequest + 1,
      // A different project's rows are a different project's content, and a
      // collection id is only unique inside one document.
      records: {},
    });
  },

  resetDocument() {
    inFlight.clear();
    set(initialState());
  },

  /* --------------------------------------------------------------- core -- */

  transact(label, recipe, options) {
    const state = get();
    if (state.readOnly) {
      get().toast('You have view-only access to this project', 'error');
      return;
    }
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
        record: options?.record,
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

    if (!applyingRemote && patchListeners.size) {
      for (const listener of patchListeners) listener(result.patches, label);
    }
  },

  undo() {
    const { doc, history, measureToken } = get();
    let result;
    try {
      result = undoHistory(doc, history);
    } catch (error) {
      // A collaborator can remove the very node an inverse patch targets. The
      // stack is no longer meaningful, so drop it rather than half-apply it.
      console.warn('[cre8] undo no longer applies after a remote change', error);
      set({ history: emptyHistory() });
      get().toast('Undo history reset after a change from someone else', 'info');
      return;
    }
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
    let result;
    try {
      result = redoHistory(doc, history);
    } catch (error) {
      console.warn('[cre8] redo no longer applies after a remote change', error);
      set({ history: emptyHistory() });
      return;
    }
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

  /* ------------------------------------------------------ collaboration -- */

  /**
   * Apply someone else's change.
   *
   * Deliberately not recorded in local history: undo should walk back through
   * *your* edits, not silently revert a colleague's. The flag stops the patch
   * being echoed back to the room as if it were ours.
   */
  applyRemotePatches(patches) {
    const state = get();
    applyingRemote = true;
    try {
      const doc = applyPatches(state.doc, patches);
      set({
        doc,
        // A remote delete can strip nodes out from under the local selection.
        selection: state.selection.filter((id) => doc.nodes[id]),
        measureToken: state.measureToken + 1,
      });
    } catch (error) {
      console.error('[cre8] could not apply remote patches', error);
    } finally {
      applyingRemote = false;
    }
  },

  setReadOnly(readOnly) {
    if (get().readOnly === readOnly) return;
    set({ readOnly, editingTextId: null });
  },

  /** Wholesale replacement after a resync. Local history no longer applies. */
  replaceDocument(doc) {
    const state = get();
    applyingRemote = true;
    try {
      set({
        doc,
        history: emptyHistory(),
        selection: state.selection.filter((id) => doc.nodes[id]),
        editingTextId: null,
        measureToken: state.measureToken + 1,
      });
    } finally {
      applyingRemote = false;
    }
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

    const first = result[0];

    // A rule id belongs to one node, so it cannot survive the selection
    // moving to another. Left sticky, the style panels would write into a
    // rule that is no longer on screen.
    const keepsRule =
      get().activeRuleId !== null &&
      first !== undefined &&
      Boolean(doc.nodes[first]?.rules?.some((rule) => rule.id === get().activeRuleId));

    set({
      selection: result,
      editingTextId: null,
      ...(keepsRule ? {} : { activeRuleId: null }),
    });

    // A case that is not current has no box on the canvas, so selecting one
    // would otherwise outline nothing. Recorded as `false`: revealing is the
    // editor following the user, not an edit, and Ctrl+Z should walk back
    // what they did rather than where they looked.
    // Skipped for a viewer, who cannot write anything: `transact` would
    // answer every click with a "view-only" toast.
    if (first && !get().readOnly) {
      get().transact('Reveal', (draft) => void ops.revealSwitchPath(draft, first), {
        record: false,
        quiet: true,
      });
    }
  },

  selectParent() {
    const state = get();
    const first = state.selection[0];
    if (!first) return;
    // The scope is the ceiling. Walking out of an open overlay would select
    // the page behind it — which is the one thing the context exists to stop,
    // and it would happen on a keypress people use constantly.
    if (first === activeRootId(state)) return;
    const parentId = state.doc.nodes[first]?.parentId;
    if (!parentId) return;
    get().select(parentId);
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
    const state = get();
    const rootId = activeRootId(state);
    const root = rootId ? state.doc.nodes[rootId] : undefined;
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
  setActiveRule(ruleId) {
    set({ activeRuleId: ruleId });
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
      editingVariantId: null,
      editingOverlayId: null,
      selection: [],
      hoverId: null,
      editingTextId: null,
      fitRequest: get().fitRequest + 1,
    });
  },

  editOverlay(nodeId) {
    const leaving = get().editingOverlayId;
    const node = nodeId ? get().doc.nodes[nodeId] : null;
    // Only the two element types the browser puts in the top layer. Anything
    // else claiming to be an overlay would be a scope with no visual meaning.
    if (nodeId && node?.type !== 'popover' && node?.type !== 'dialog') return;

    // Into the overlay's first child on the way in, and onto the overlay
    // itself on the way out — both are the thing you would have clicked next.
    const selection = nodeId
      ? node?.children[0]
        ? [node.children[0]]
        : [nodeId]
      : leaving
        ? [leaving]
        : [];

    set({
      editingOverlayId: nodeId,
      selection,
      hoverId: null,
      editingTextId: null,
      measureToken: get().measureToken + 1,
    });
  },

  editComponent(componentId, variantId = null) {
    set({
      editingComponentId: componentId,
      // A different tree entirely, so any overlay scope inside the old one is
      // meaningless — and leaving it set would scope the editor to a node that
      // is no longer on the canvas.
      editingOverlayId: null,
      editingVariantId: componentId ? variantId : null,
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
        : ops.resolveInsertTarget(state.doc, state.selection[0] ?? null, rootId, type);
    if (!target) return null;

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
        : ops.resolveInsertTarget(state.doc, state.selection[0] ?? null, rootId, 'instance');
    if (!target) return null;

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

  wrapInLink() {
    const { selection } = get();
    if (!selection.length) return;
    get().transact('Wrap in link', (draft) => {
      const id = ops.groupNodes(draft, selection, 'link');
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

  setRuleStyle(ruleId, patch, options) {
    const targets = options?.ids ?? get().selection;
    if (!targets.length) return;
    get().transact(
      'Style',
      (draft) => {
        ops.setRuleStyles(draft, targets, ruleId, patch);
        return targets;
      },
      options
    );
  },

  setInstanceOverride(instanceId, propertyId, value) {
    get().transact(
      'Component property',
      (draft) => {
        ops.setInstanceOverride(draft, instanceId, propertyId, value);
      },
      // Per property rather than per instance: typing into one field and then
      // another should be two undo steps, because they are two decisions.
      { mergeKey: `override:${instanceId}:${propertyId}` }
    );
  },

  setInstanceVariant(instanceId, variantId) {
    get().transact('Change variant', (draft) => {
      ops.setInstanceVariant(draft, instanceId, variantId);
      return [instanceId];
    });
  },

  addComponentVariant(componentId, fromVariantId) {
    let created: string | null = null;
    get().transact('Add variant', (draft) => {
      created = ops.addVariant(draft, componentId, undefined, fromVariantId)?.id ?? null;
    });
    // Opened rather than merely created. A variant you cannot see is a tree in
    // a document, and the next thing anybody wants is to change what makes it
    // different from the one it was cloned from.
    if (created) get().editComponent(componentId, created);
    return created;
  },

  setRuleProps(ruleId, patch, ids) {
    const targets = ids ?? get().selection;
    if (!targets.length) return;
    get().transact('Content', (draft) => {
      ops.setRuleProps(draft, targets, ruleId, patch);
      return targets;
    });
  },

  addRule(when, part) {
    const id = get().selection[0];
    if (!id) return null;
    const ruleId = uid();
    get().transact('Add condition', (draft) => {
      ops.addRule(draft, id, { id: ruleId, when, ...(part ? { part } : {}), apply: {} });
    });
    set({ activeRuleId: ruleId });
    return ruleId;
  },

  removeRule(ruleId) {
    const id = get().selection[0];
    if (!id) return;
    get().transact('Remove condition', (draft) => ops.removeRule(draft, id, ruleId));
    if (get().activeRuleId === ruleId) set({ activeRuleId: null });
  },

  moveRule(ruleId, delta) {
    const id = get().selection[0];
    if (!id) return;
    get().transact('Reorder conditions', (draft) => ops.moveRule(draft, id, ruleId, delta));
  },

  updateRule(ruleId, patch) {
    const id = get().selection[0];
    if (!id) return;
    get().transact('Edit condition', (draft) => ops.updateRule(draft, id, ruleId, patch));
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

    // Resolved for what is on the clipboard: pasting a table row looks for a
    // table above the selection rather than dropping it wherever the caret is.
    const target = ops.resolveInsertTarget(
      state.doc,
      state.selection[0] ?? null,
      rootId,
      clipboard.rootIds[0] ? clipboard.nodes[clipboard.rootIds[0]]?.type : undefined
    );
    if (!target) return;

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

  /* -------------------------------------------------- collection records -- */

  loadRecords(collectionId) {
    if (!collectionId || collectionId in get().records) return;
    if (inFlight.has(collectionId)) return;

    const adapter = getStorage();
    const projectId = get().doc.id;
    if (!adapter.listRecords) {
      // No record store behind this adapter — say so once, in the shape a
      // repeater understands, so nothing asks again on every render.
      set((state) => ({ records: { ...state.records, [collectionId]: [] } }));
      return;
    }

    inFlight.add(collectionId);
    void adapter
      .listRecords(projectId, collectionId)
      .then((rows) => {
        // The project changed while this was in the air. Its rows belong to a
        // document nobody is looking at any more.
        if (get().doc.id !== projectId) return;
        set((state) => ({ records: { ...state.records, [collectionId]: rows } }));
      })
      .catch(() => {
        // A failed load must not become a permanent empty list — leaving the
        // key absent is what lets the next render try again.
      })
      .finally(() => inFlight.delete(collectionId));
  },

  async reloadRecords(collectionId) {
    const adapter = getStorage();
    const projectId = get().doc.id;
    if (!collectionId || !adapter.listRecords) return;
    try {
      const rows = await adapter.listRecords(projectId, collectionId);
      if (get().doc.id !== projectId) return;
      set((state) => ({ records: { ...state.records, [collectionId]: rows } }));
    } catch {
      // Left as it was. A list that fails to refresh is better than one that
      // empties itself because the network blinked.
    }
  },

  /**
   * Create or update one row, then reload the collection.
   *
   * Reloaded rather than patched in place because the server decides things
   * the client cannot: the slug after cleaning, `updatedAt`, and whether the
   * slug collided with another record's. Guessing any of those and being wrong
   * shows a row that does not exist.
   */
  async saveRecord(collectionId, input) {
    const projectId = get().doc.id;
    try {
      if (input.id) await api.updateRecord(projectId, input.id, { ...input, collectionId });
      else await api.createRecord(projectId, { ...input, collectionId });
    } catch (error) {
      get().toast(recordProblem(error), 'error');
      return false;
    }
    await get().reloadRecords(collectionId);
    return true;
  },

  async deleteRecord(collectionId, recordId) {
    const projectId = get().doc.id;
    try {
      await api.deleteRecord(projectId, recordId);
    } catch (error) {
      get().toast(recordProblem(error), 'error');
      return false;
    }
    await get().reloadRecords(collectionId);
    return true;
  },

  /**
   * Editor-only, and stored with the other design-time choices.
   *
   * Exactly what `switchDesign` does for a state and what the data panel's
   * "Designing" control does for the time of day: it changes what the canvas
   * shows and nothing about what the site publishes. Looking at one post must
   * not be a way to publish that post.
   */
  designAgainst(collectionId, recordId) {
    get().transact(
      'Design against a record',
      (draft) => {
        const against = (draft.settings.designRecord ??= {});
        if (recordId) against[collectionId] = recordId;
        else delete against[collectionId];
        if (!Object.keys(against).length) delete draft.settings.designRecord;
      },
      { record: false, quiet: true }
    );
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

/**
 * What the editor is currently *pointed at*.
 *
 * The layer tree roots here, the Insert panel drops here, select-all selects
 * here, and the status bar counts from here. An open overlay narrows all four
 * at once, which is the whole of the scoping — every panel already asked this
 * question, so none of them needed to learn a new one.
 *
 * Deliberately not what the *canvas draws*: see `canvasRootId`. A popover is
 * meaningless without the page under it, so the page stays on screen and only
 * what the editor will *touch* narrows.
 */
export function activeRootId(
  state: Pick<EditorState, 'doc' | 'activePageId' | 'editingComponentId' | 'editingVariantId' | 'editingOverlayId'>
): NodeId | null {
  const overlay = state.editingOverlayId;
  if (overlay && state.doc.nodes[overlay]) return overlay;
  return canvasRootId(state);
}


/** Root node currently on the canvas: a page root, or a component master. */
export function canvasRootId(
  state: Pick<EditorState, 'doc' | 'activePageId' | 'editingComponentId' | 'editingVariantId'>
): NodeId | null {
  if (state.editingComponentId) {
    const component = state.doc.components.find((c) => c.id === state.editingComponentId);
    if (!component) return null;
    // A variant is a tree of its own, so opening one is the same operation as
    // opening the master — a different root, and everything downstream of
    // "what is on the canvas" follows without knowing which it got.
    const variant = component.variants?.find((v) => v.id === state.editingVariantId);
    return variant?.rootNodeId ?? component.rootNodeId;
  }
  return state.doc.pages.find((p) => p.id === state.activePageId)?.rootNodeId ?? null;
}

function isDeletable(doc: Cre8Document, id: NodeId): boolean {
  if (doc.pages.some((p) => p.rootNodeId === id)) return false;
  if (doc.components.some((c) => allRoots(c).includes(id))) return false;
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

