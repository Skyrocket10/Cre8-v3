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
  Collection,
  CollectionRecord,
  Field,
  Cre8Document,
  ElementType,
  NodeAction,
  NodeId,
  NodeProps,
  StyleDecl,
  StyleProp,
  Condition,
  Part,
  StyleRule,
} from '../document/types';
import { commit, emptyHistory, redo as redoHistory, undo as undoHistory, type HistoryState } from '../history/history';
import { cloneSubtree, type NodeSpec } from '../document/factory';
import type { ThemeScaleGroup } from '../document/operations';
import { uid } from '../document/id';
import { getElementFor } from './registry';
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
 * Depth, expressed the only way this document model can express it.
 *
 * There is no z-index layer to shuffle: what paints on top is what comes later
 * among its siblings, so "bring to front" is "become the last child". That is
 * also why these are one action rather than four — the direction is data, and
 * a single reorder handles all of it.
 */
export type ArrangeDirection = 'front' | 'forward' | 'backward' | 'back';
export type AlignEdge = 'left' | 'hcentre' | 'right' | 'top' | 'vmiddle' | 'bottom';
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
   * A node somebody asked to rename from outside the layer tree.
   *
   * The tree owns the text field — it is the only surface with a row to type
   * into — but the request can come from a context menu on the canvas, so it
   * travels through the store rather than through a ref nobody else can reach.
   */
  renameRequest: NodeId | null;

  /**
   * A record somebody asked to edit from outside the form.
   *
   * Same shape as `renameRequest` and for the same reason: the Collections
   * panel owns the form, the menu does not, and a ref would not reach across.
   */
  recordEditRequest: { collectionId: string; recordId: string } | null;

  /**
   * A handful of declarations lifted off one element, for `pasteStyleValues`.
   *
   * Not `styleSource`, which names a whole node and means "make this look like
   * that". This is narrower on purpose: the value of one row, or of one
   * section, going somewhere the rest of the styles must not follow.
   */
  valueClipboard: { decl: StyleDecl; label: string } | null;

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
  /** Replace what the selected control does when it is pressed. */
  setActions(actions: NodeAction[]): void;
  setPreviewing(on: boolean): void;
  setPreviewDevice(bp: Breakpoint): void;
  toggleRulers(): void;
  toggleOutlines(): void;
  toggleSnap(): void;
  setTheme(theme: 'dark' | 'light'): void;

  /* Pages & components */
  setActivePage(pageId: string): void;

  /* Pages, components and assets — lifted out of the three panels that each
     had their own transaction for these. See `commands.ts`. */
  addPage(name?: string): string | null;
  duplicatePage(pageId: string): void;
  removePage(pageId: string): void;
  setHomePage(pageId: string): void;
  renamePage(pageId: string, name: string): void;
  movePage(pageId: string, delta: 1 | -1): void;
  renameComponent(componentId: string, name: string): void;
  deleteComponent(componentId: string): void;
  renameVariant(componentId: string, variantId: string, name: string): void;
  removeComponentVariant(componentId: string, variantId: string): void;
  renameAsset(assetId: string, name: string): void;
  removeAsset(assetId: string): void;
  placeAsset(assetId: string, parentId?: NodeId, index?: number): NodeId | null;
  insertSpec(spec: NodeSpec, label: string): NodeId | null;

  /* Collections and their fields */
  addCollection(name?: string): string | null;
  updateCollection(collectionId: string, patch: Partial<Pick<Collection, 'name' | 'slugField'>>): void;
  removeCollection(collectionId: string): void;
  addField(collectionId: string, label?: string): string | null;
  updateField(collectionId: string, key: string, patch: Partial<Omit<Field, 'key'>>): void;
  removeField(collectionId: string, key: string): void;
  moveField(collectionId: string, key: string, delta: 1 | -1): void;

  /* Theme tokens */
  setToken(group: ThemeScaleGroup, id: string, patch: { name?: string; value?: string }, options?: TransactOptions): void;
  addToken(group: ThemeScaleGroup, name: string, value: string): string | null;
  removeToken(group: ThemeScaleGroup, id: string): void;
  setThemeFont(fontId: string, stack: string): void;
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
  /**
   * Which element a panel is positioned against.
   *
   * `undefined` means "whatever opens it", which is the default somebody
   * means; `null` un-anchors. One step in history, because the document
   * stores it as a back-reference on the other element and two steps would
   * let undo leave half a relationship behind.
   */
  setAnchor(panelId: NodeId, anchorNodeId?: NodeId | null): void;
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
  duplicateComponent(componentId: string): string | null;
  toggleHidden(ids?: NodeId[]): void;
  toggleLocked(ids?: NodeId[]): void;
  reorderInParent(id: NodeId, direction: 1 | -1): void;
  arrangeSelection(direction: ArrangeDirection): void;
  alignSelection(edge: AlignEdge): void;
  distributeSelection(axis: 'x' | 'y'): void;
  resetStyles(ids?: NodeId[]): void;
  copyStyleValues(props: StyleProp[], label: string): void;
  pasteStyleValues(props?: StyleProp[]): void;
  resetStyleProps(props: StyleProp[]): void;
  resetStylePropsEverywhere(props: StyleProp[]): void;
  liftToAllBreakpoints(props: StyleProp[]): void;
  detachSelection(): void;
  createComponentFromSelection(): void;
  selectChildren(): void;
  /** Ask the layer tree to put a row into rename mode. It clears this when done. */
  requestRename(id: NodeId | null): void;
  revealInLayers(): void;

  /* Clipboard */
  copySelection(): void;
  cutSelection(): void;
  paste(): void;
  pasteInto(): void;
  clearInstanceOverrides(ids?: NodeId[]): void;
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
  duplicateRecord(collectionId: string, recordId: string): Promise<boolean>;
  /** Ask the Collections panel to open its form on a record. It clears this. */
  requestRecordEdit(request: { collectionId: string; recordId: string } | null): void;
  /** Which record a dynamic page is drawn against on the canvas. */
  designAgainst(collectionId: string, recordId: string | null): void;

  /* Persistence & feedback */
  setSaveStatus(status: SaveStatus): void;
  markSaved(): void;
  toast(message: string, tone?: Toast['tone'], action?: Toast['action']): void;
  copyToClipboard(text: string, message: string): void;
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
    renameRequest: null,
    recordEditRequest: null,
    valueClipboard: null,
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

  /* --------------------------------------------------- pages and library -- */

  addPage(name) {
    let created: string | null = null;
    get().transact('Add page', (draft) => {
      created = ops.addPage(draft, name ?? `Page ${draft.pages.length + 1}`).id;
    });
    if (created) {
      get().setActivePage(created);
      // Straight into rename: a page called "Page 3" is a placeholder, and the
      // moment it is created is the moment somebody knows what to call it.
      get().requestRename(created);
    }
    return created;
  },

  duplicatePage(pageId) {
    let created: string | null = null;
    get().transact('Duplicate page', (draft) => {
      created = ops.duplicatePage(draft, pageId)?.id ?? null;
    });
    if (created) get().setActivePage(created);
  },

  removePage(pageId) {
    const state = get();
    // The last page cannot go: a document with no pages has nothing to draw
    // and no way back to having one.
    if (state.doc.pages.length <= 1) return;
    get().transact('Delete page', (draft) => {
      ops.removePage(draft, pageId);
    });
    if (state.activePageId === pageId) {
      const next = get().doc.pages.find((p) => p.id !== pageId);
      if (next) get().setActivePage(next.id);
    }
  },

  setHomePage(pageId) {
    get().transact('Set home page', (draft) => ops.setHomePage(draft, pageId));
  },

  renamePage(pageId, name) {
    const page = get().doc.pages.find((p) => p.id === pageId);
    if (!page || !name || name === page.name) return;
    get().transact('Rename page', (draft) => ops.updatePage(draft, pageId, { name }), {
      quiet: true,
    });
  },

  movePage(pageId, delta) {
    const ordered = [...get().doc.pages].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((p) => p.id === pageId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    get().transact('Reorder pages', (draft) => ops.reorderPages(draft, index, next));
  },

  renameComponent(componentId, name) {
    if (!name) return;
    get().transact('Rename component', (draft) => ops.renameComponent(draft, componentId, name), {
      quiet: true,
    });
  },

  deleteComponent(componentId) {
    // Leaving the canvas pointed at a master that is about to stop existing
    // would draw nothing and offer no way out.
    if (get().editingComponentId === componentId) get().editComponent(null);
    get().transact('Delete component', (draft) => ops.deleteComponent(draft, componentId));
  },

  renameVariant(componentId, variantId, name) {
    if (!name) return;
    get().transact(
      'Rename variant',
      (draft) => ops.renameVariant(draft, componentId, variantId, name),
      { quiet: true }
    );
  },

  removeComponentVariant(componentId, variantId) {
    if (get().editingVariantId === variantId) get().editComponent(componentId, null);
    get().transact('Delete variant', (draft) => ops.removeVariant(draft, componentId, variantId));
  },

  renameAsset(assetId, name) {
    if (!name) return;
    get().transact('Rename asset', (draft) => ops.renameAsset(draft, assetId, name), {
      quiet: true,
    });
  },

  removeAsset(assetId) {
    get().transact('Delete asset', (draft) => ops.removeAsset(draft, assetId));
  },

  /**
   * Put an asset on the page.
   *
   * Both ways in come here: the drop controller passes the parent and index it
   * worked out from the pointer, the menu passes nothing and takes whatever
   * `resolveInsertTarget` would have given an inserted element. Dragging an
   * image in and placing one from a menu therefore produce the same node —
   * same type, same name, same props — which they did not when the drop
   * controller owned its own copy of this.
   */
  placeAsset(assetId, parentId, index) {
    const state = get();
    const asset = state.doc.assets.find((a) => a.id === assetId);
    if (!asset) return null;

    const type: ElementType = asset.type === 'video' ? 'video' : 'image';
    const rootId = activeRootId(state);
    const target =
      parentId !== undefined
        ? { parentId, index: index ?? Number.MAX_SAFE_INTEGER }
        : rootId
          ? ops.resolveInsertTarget(state.doc, state.selection[0] ?? null, rootId, type)
          : null;
    if (!target) return null;

    let created: NodeId | null = null;
    get().transact('Add image', (draft) => {
      created = ops.insertElement(draft, type, target.parentId, target.index);
      const node = created ? draft.nodes[created] : undefined;
      if (node) {
        node.name = ops.uniqueName(draft.nodes, asset.name);
        node.props = { ...node.props, src: asset.url, alt: asset.name };
      }
      return created ? [created] : undefined;
    });
    return created;
  },

  /**
   * Insert a whole block, from the Insert panel or from anywhere else.
   *
   * Takes the built spec rather than a block id, because the block registry is
   * a library the store has no business importing — but the *insertion* is an
   * editor action like any other, and having the panel write its own meant a
   * block landed by one route and an element by another.
   */
  insertSpec(spec, label) {
    const rootId = activeRootId(get());
    if (!rootId) return null;
    let created: NodeId | null = null;
    get().transact(`Add ${label}`, (draft) => {
      // Appended to the page root, which is what a *block* means — it is a
      // band across the page, not something to drop inside whatever happens to
      // be selected. Elements go through `insertElement` and its target rules.
      created = ops.insertSpec(draft, spec, rootId);
      return created ? [created] : undefined;
    });
    return created;
  },

  /* ------------------------------------------------------- collections -- */

  addCollection(name) {
    let created: string | null = null;
    get().transact('Add collection', (draft) => {
      created =
        ops.addCollection(draft, name ?? `Collection ${(draft.collections?.length ?? 0) + 1}`)?.id ??
        null;
    });
    return created;
  },

  updateCollection(collectionId, patch) {
    get().transact('Edit collection', (draft) => ops.updateCollection(draft, collectionId, patch), {
      quiet: true,
    });
  },

  removeCollection(collectionId) {
    get().transact('Delete collection', (draft) => ops.removeCollection(draft, collectionId));
  },

  addField(collectionId, label) {
    const collection = get().doc.collections?.find((c) => c.id === collectionId);
    if (!collection) return null;
    let created: string | null = null;
    get().transact('Add field', (draft) => {
      created =
        ops.addField(draft, collectionId, label ?? `Field ${collection.fields.length + 1}`)?.key ??
        null;
    });
    return created;
  },

  updateField(collectionId, key, patch) {
    get().transact('Edit field', (draft) => ops.updateField(draft, collectionId, key, patch), {
      quiet: true,
    });
  },

  removeField(collectionId, key) {
    get().transact('Delete field', (draft) => ops.removeField(draft, collectionId, key));
  },

  moveField(collectionId, key, delta) {
    const fields = get().doc.collections?.find((c) => c.id === collectionId)?.fields ?? [];
    const index = fields.findIndex((f) => f.key === key);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= fields.length) return;
    get().transact('Reorder fields', (draft) =>
      ops.reorderFields(draft, collectionId, index, next)
    );
  },

  /* ------------------------------------------------------------ theme -- */

  setToken(group, id, patch, options) {
    get().transact('Edit token', (draft) => ops.setToken(draft, group, id, patch), {
      quiet: true,
      ...options,
    });
  },

  addToken(group, name, value) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    let created: string | null = null;
    get().transact('Add token', (draft) => {
      created = ops.addToken(draft, group, trimmed, value);
    });
    return created;
  },

  removeToken(group, id) {
    get().transact('Remove token', (draft) => ops.removeToken(draft, group, id));
  },

  setThemeFont(fontId, stack) {
    get().transact('Set typeface', (draft) => ops.setThemeFont(draft, fontId, stack));
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

  setAnchor(panelId, anchorNodeId) {
    get().transact(anchorNodeId === null ? 'Unanchor panel' : 'Anchor panel', (draft) => {
      ops.setAnchor(draft, panelId, anchorNodeId);
      return [panelId];
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

  duplicateComponent(componentId) {
    let created: string | null = null;
    get().transact('Duplicate component', (draft) => {
      created = ops.duplicateComponent(draft, componentId)?.id ?? null;
    });
    // Not opened, unlike a new variant. A variant you cannot see is a tree in
    // a document and the next thing anybody does is change it; a duplicated
    // component is usually the *start* of something, and dropping somebody
    // into the master editor is one Escape they did not ask for.
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

  setActions(actions) {
    const id = get().selection[0];
    if (!id) return;
    /*
     * One transaction for the whole list, and one undo step.
     *
     * Not merged by key with the previous edit, unlike a slider: picking a
     * different value is a decision rather than a drag, and somebody who
     * changes their mind twice wants both steps back.
     */
    get().transact('Edit what this does', (draft) => ops.setActions(draft, id, actions));
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

  /**
   * Move the whole selection through its siblings, keeping their relative order.
   *
   * Front and back are one splice each; forward and backward step the block by
   * one *free* slot, which is not the same as stepping each member by one — the
   * naive version makes a contiguous pair swap places with each other and go
   * nowhere.
   */
  arrangeSelection(direction) {
    const { selection, doc } = get();
    const first = selection[0] ? doc.nodes[selection[0]] : undefined;
    const parentId = first?.parentId;
    const parent = parentId ? doc.nodes[parentId] : undefined;
    if (!parent) return;

    // One parent only: "in front of" has no meaning across two of them.
    const moving = selection.filter((id) => doc.nodes[id]?.parentId === parentId);
    if (!moving.length) return;

    const order = parent.children;
    const inOrder = order.filter((id) => moving.includes(id));
    const rest = order.filter((id) => !moving.includes(id));
    const firstIndex = order.indexOf(inOrder[0]!);
    const lastIndex = order.indexOf(inOrder[inOrder.length - 1]!);

    let at: number;
    switch (direction) {
      case 'back':
        at = 0;
        break;
      case 'front':
        at = rest.length;
        break;
      case 'backward': {
        // How many non-selected siblings sit before the block; step over one.
        const before = order.slice(0, firstIndex).filter((id) => !moving.includes(id)).length;
        at = Math.max(0, before - 1);
        break;
      }
      default: {
        const before = order.slice(0, lastIndex).filter((id) => !moving.includes(id)).length;
        at = Math.min(rest.length, before + 1);
        break;
      }
    }

    const next = [...rest.slice(0, at), ...inOrder, ...rest.slice(at)];
    if (next.every((id, i) => id === order[i])) return;

    get().transact('Arrange', (draft) => {
      const p = draft.nodes[parent.id];
      if (p) p.children = next;
      return moving;
    });
  },

  /**
   * Align absolutely positioned siblings to the extreme of their union box.
   *
   * Deltas, not absolute coordinates. Where `left: 0` actually lands depends on
   * which ancestor is positioned and how much padding it has, and getting that
   * wrong moves elements to a place nobody asked for. Adding a measured
   * difference to the value already written cannot be wrong about the origin,
   * because it never needs to know it — the same trick `nudgeSelection` uses.
   */
  alignSelection(edge) {
    const state = get();
    const boxes = measureSelection(state);
    if (boxes.length < 2) return;

    const horizontal = edge === 'left' || edge === 'hcentre' || edge === 'right';
    const left = Math.min(...boxes.map((b) => (horizontal ? b.x : b.y)));
    const right = Math.max(...boxes.map((b) => (horizontal ? b.x + b.w : b.y + b.h)));

    const deltas = new Map<NodeId, number>();
    for (const box of boxes) {
      const start = horizontal ? box.x : box.y;
      const size = horizontal ? box.w : box.h;
      const target =
        edge === 'left' || edge === 'top'
          ? left
          : edge === 'right' || edge === 'bottom'
            ? right - size
            : (left + right) / 2 - size / 2;
      deltas.set(box.id, target - start);
    }
    shiftBy(get(), deltas, horizontal ? 'left' : 'top', 'Align');
  },

  /** Even gaps between the outermost two, which stay where they are. */
  distributeSelection(axis) {
    const state = get();
    const boxes = measureSelection(state);
    if (boxes.length < 3) return;

    const horizontal = axis === 'x';
    const sorted = [...boxes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const span =
      (horizontal ? last.x + last.w : last.y + last.h) - (horizontal ? first.x : first.y);
    const used = sorted.reduce((sum, b) => sum + (horizontal ? b.w : b.h), 0);
    const gap = (span - used) / (sorted.length - 1);

    const deltas = new Map<NodeId, number>();
    let cursor = horizontal ? first.x : first.y;
    for (const box of sorted) {
      deltas.set(box.id, cursor - (horizontal ? box.x : box.y));
      cursor += (horizontal ? box.w : box.h) + gap;
    }
    shiftBy(get(), deltas, horizontal ? 'left' : 'top', 'Distribute');
  },

  /**
   * Throw away everything the inspector wrote at this breakpoint.
   *
   * This breakpoint, not all of them: the inspector writes to one layer at a
   * time and says which, so resetting a wider set than the panel in front of
   * you edits would be a surprise you could not see.
   */
  resetStyles(ids) {
    const state = get();
    const targets = ids ?? state.selection;
    if (!targets.length) return;
    get().transact('Reset styles', (draft) => {
      for (const id of targets) {
        const layer = draft.nodes[id]?.styles[state.breakpoint];
        if (layer) ops.clearStyles(draft, [id], state.breakpoint, Object.keys(layer) as StyleProp[]);
      }
      return targets;
    });
  },

  /**
   * A few declarations on their own clipboard, separate from the whole-node one.
   *
   * `copyStyles` takes everything a node has and is aimed at making a second
   * element look like the first. This is the other thing people want: that
   * shadow, that radius, that one gap — carried to somewhere the rest of the
   * styles must not follow.
   */
  copyStyleValues(props, label) {
    const state = get();
    const id = state.selection[0];
    if (!id || !props.length) return;
    const decl: StyleDecl = {};
    let found = 0;
    for (const prop of props) {
      const value = readStyleProp(state, id, prop);
      if (value === undefined) continue;
      (decl as Record<string, string>)[prop] = value;
      found++;
    }
    if (!found) return;
    set({ valueClipboard: { decl, label } });
    get().toast(`Copied ${label.toLowerCase()}`);
  },

  pasteStyleValues(props) {
    const state = get();
    const clipboard = state.valueClipboard;
    if (!clipboard || !state.selection.length) return;
    // A subset when the menu was opened on one row, everything when it was not:
    // pasting a whole section onto a single field would be a surprise.
    const patch: StyleDecl = props?.length
      ? Object.fromEntries(
          Object.entries(clipboard.decl).filter(([prop]) => props.includes(prop as StyleProp))
        )
      : clipboard.decl;
    if (!Object.keys(patch).length) return;
    writeStyle(get(), patch);
  },

  /**
   * Drop these declarations from wherever the inspector is currently writing.
   *
   * Which is the point: with a state selected the inspector edits that rule, so
   * Reset has to empty the rule rather than the base layer underneath it. Same
   * rule as `useStyleReset`, in the store, so the row's dot and the menu item
   * cannot come to different conclusions.
   */
  resetStyleProps(props) {
    const state = get();
    if (!props.length || !state.selection.length) return;
    if (!state.activeRuleId) {
      get().clearStyle(props);
      return;
    }
    const patch: StyleDecl = {};
    for (const prop of props) (patch as Record<string, undefined>)[prop] = undefined;
    get().setRuleStyle(state.activeRuleId, patch);
  },

  resetStylePropsEverywhere(props) {
    const state = get();
    if (!props.length || !state.selection.length) return;
    get().transact('Reset everywhere', (draft) => {
      for (const id of state.selection) {
        const node = draft.nodes[id];
        if (!node) continue;
        for (const layer of Object.keys(node.styles) as Breakpoint[]) {
          ops.clearStyles(draft, [id], layer, props);
        }
        for (const rule of node.rules ?? []) {
          for (const prop of props) delete rule.apply[prop];
        }
      }
      return state.selection;
    });
  },

  /**
   * Make what you are looking at the answer at every width.
   *
   * Writes the value the current breakpoint resolves to into the base layer and
   * drops the narrower overrides, rather than copying it into each layer — the
   * result reads the same and leaves the node with one declaration instead of
   * three, which is what a designer means by "everywhere".
   */
  liftToAllBreakpoints(props) {
    const state = get();
    if (!props.length || !state.selection.length) return;
    get().transact('Apply to all breakpoints', (draft) => {
      for (const id of state.selection) {
        const node = draft.nodes[id];
        if (!node) continue;
        for (const prop of props) {
          const value = readStyleProp(state, id, prop);
          if (value === undefined) continue;
          (node.styles.desktop ??= {} as StyleDecl)[prop as 'width'] = value as never;
          for (const layer of Object.keys(node.styles) as Breakpoint[]) {
            if (layer !== 'desktop') ops.clearStyles(draft, [id], layer, [prop]);
          }
        }
      }
      return state.selection;
    });
  },

  detachSelection() {
    const { selection, doc } = get();
    const instances = selection.filter((id) => doc.nodes[id]?.type === 'instance');
    if (!instances.length) return;
    get().transact('Detach instance', (draft) => {
      const created: NodeId[] = [];
      for (const id of instances) {
        const root = ops.detachInstance(draft, id);
        if (root) created.push(root);
      }
      return created;
    });
  },

  createComponentFromSelection() {
    const { selection } = get();
    const id = selection.length === 1 ? selection[0] : undefined;
    if (!id) return;
    let created: string | null = null;
    get().transact('Create component', (draft) => {
      const result = ops.createComponentFromNode(draft, id);
      if (!result) return;
      created = result.component.id;
      return [result.instanceId];
    });
    if (created) {
      get().toast('Component created', 'success');
      // Named at the moment somebody knows what it is, like a new page.
      get().requestRename(created);
    }
  },

  selectChildren() {
    const { selection, doc } = get();
    const first = selection[0];
    const children = first ? doc.nodes[first]?.children : undefined;
    if (children?.length) get().select([...children]);
  },

  requestRename(id) {
    if (get().renameRequest === id) return;
    /*
     * One request, four panels. Whichever of them owns a row with that id
     * takes it and clears it — the layer tree for a node, and the Pages,
     * Components or Assets panel for their own.
     *
     * Only a *node* reveals the layer tree. Asking for a page to be renamed
     * and being thrown into Layers, where no such row exists, would be a
     * request that visibly did the wrong thing.
     */
    if (id && get().doc.nodes[id]) get().revealInLayers();
    set({ renameRequest: id });
  },

  revealInLayers() {
    get().setLeftTab('layers');
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

  /**
   * Paste as the selection's last child rather than as its next sibling.
   *
   * `paste` puts things beside what is selected, which is right most of the
   * time and wrong for the one case people reach for a menu to express: an
   * empty container they want filled.
   */
  pasteInto() {
    const state = get();
    const clipboard = state.clipboard;
    const parentId = state.selection[0];
    const parent = parentId ? state.doc.nodes[parentId] : undefined;
    if (!clipboard || !parent || !getElement(parent.type).container) return;

    get().transact('Paste inside', (draft) => {
      const created: NodeId[] = [];
      let index = parent.children.length;
      for (const sourceRoot of clipboard.rootIds) {
        const fresh: NodeMap = {};
        const newRoot = cloneSubtree(clipboard.nodes, sourceRoot, fresh, parent.id);
        if (!newRoot) continue;
        const node = fresh[newRoot];
        if (node) node.name = ops.uniqueName(draft.nodes, node.name);
        ops.insertSubtree(draft, fresh, newRoot, parent.id, index++);
        created.push(newRoot);
      }
      return created;
    });
  },

  /** Put an instance back to saying whatever its component says. */
  clearInstanceOverrides(ids) {
    const state = get();
    const targets = (ids ?? state.selection).filter((id) => state.doc.nodes[id]?.overrides);
    if (!targets.length) return;
    get().transact('Reset to component', (draft) => {
      for (const id of targets) delete draft.nodes[id]?.overrides;
      return targets;
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

  /**
   * A copy of a record, deliberately unpublished.
   *
   * Writing a record republishes the site on its own — that is the whole point
   * of the alarm in `room.ts` — so a duplicate that inherited `published: true`
   * would put a second copy of somebody's post on the live site the moment
   * they asked for a draft to work from.
   */
  async duplicateRecord(collectionId, recordId) {
    const record = get().records[collectionId]?.find((r) => r.id === recordId);
    if (!record) return false;
    return get().saveRecord(collectionId, {
      data: { ...record.data },
      published: false,
      position: (get().records[collectionId]?.length ?? 0) + 1,
    });
  },

  requestRecordEdit(request) {
    set({ recordEditRequest: request });
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
      // Drafts included. The panel is where somebody works on a record before
      // it is live, and a duplicate made as a draft has to appear in the list
      // it was made from — it did not, and looked like Duplicate doing nothing.
      .listRecords(projectId, collectionId, { publishedOnly: false })
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
      const rows = await adapter.listRecords(projectId, collectionId, { publishedOnly: false });
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
  /**
   * Text to the system clipboard, with a toast either way.
   *
   * The write can be refused — an insecure origin, a document that is not
   * focused — and a copy that silently did nothing is worse than one that
   * says so, because the paste happens somewhere else entirely.
   */
  copyToClipboard(text, message) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => get().toast(message))
      .catch(() => get().toast('Could not reach the clipboard', 'error'));
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

/** The value a property resolves to for one node, rule-aware like the panels. */
function readStyleProp(state: EditorStore, id: NodeId, prop: StyleProp): string | undefined {
  if (state.activeRuleId) {
    const rule = state.doc.nodes[id]?.rules?.find((r) => r.id === state.activeRuleId);
    const own = rule?.apply[prop];
    if (own !== undefined) return String(own);
  }
  return resolveStyleValue(state.doc, id, state.breakpoint, prop);
}

/** Write declarations wherever the inspector is currently pointed. */
function writeStyle(state: EditorStore, patch: StyleDecl): void {
  if (state.activeRuleId) state.setRuleStyle(state.activeRuleId, patch);
  else state.setStyle(patch);
}

interface MeasuredBox {
  id: NodeId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the selection actually is, in CSS pixels, for align and distribute.
 *
 * Only positioned siblings qualify, and the two conditions are not fussiness.
 * Different parents means "align to each other" has no shared frame to be
 * relative to; in flow means the layout decides position and writing `left`
 * would either do nothing or shove the element out of the flow it belongs to.
 * `commandContext` gates the menu on exactly this, so the actions never appear
 * for a selection they would silently no-op on.
 *
 * A DOM read inside the store, which nothing else here does — but the question
 * is genuinely geometric. A percentage width, a flexed sibling and a token
 * gap all resolve to a number only once the browser has laid them out.
 */
function measureSelection(state: EditorStore): MeasuredBox[] {
  if (!alignableSelection(state)) return [];

  const boxes: MeasuredBox[] = [];
  for (const id of state.selection) {
    const el = getElementFor(id);
    if (!el) return [];
    const rect = el.getBoundingClientRect();
    // Viewport pixels are zoomed; the numbers we write are not.
    boxes.push({
      id,
      x: rect.left / state.zoom,
      y: rect.top / state.zoom,
      w: rect.width / state.zoom,
      h: rect.height / state.zoom,
    });
  }
  return boxes;
}

/**
 * Whether align and distribute would mean anything for this selection.
 *
 * Exported because the command catalogue gates the menu items on exactly this,
 * and two copies of the rule would eventually disagree — leaving an item that
 * looks live and does nothing, or one hidden from a selection it would work on.
 */
export function alignableSelection(
  state: Pick<EditorState, 'selection' | 'doc' | 'breakpoint'>
): boolean {
  if (state.selection.length < 2) return false;
  const parentId = state.doc.nodes[state.selection[0]!]?.parentId;
  if (!parentId) return false;
  return state.selection.every((id) => {
    const node = state.doc.nodes[id];
    if (!node || node.parentId !== parentId) return false;
    const position = resolveStyleValue(state.doc, id, state.breakpoint, 'position');
    return position === 'absolute' || position === 'fixed';
  });
}

/** Add a per-node delta to `left` or `top`, in one transaction. */
function shiftBy(
  state: EditorStore,
  deltas: Map<NodeId, number>,
  prop: 'left' | 'top',
  label: string
): void {
  const moved = [...deltas].filter(([, delta]) => Math.abs(delta) >= 0.5);
  if (!moved.length) return;
  state.transact(label, (draft) => {
    for (const [id, delta] of moved) {
      const node = draft.nodes[id];
      if (!node) continue;
      const layer = (node.styles[state.breakpoint] ??= {});
      const current =
        Number.parseFloat(String(layer[prop] ?? resolveStyleValue(state.doc, id, state.breakpoint, prop) ?? '0')) || 0;
      layer[prop] = `${Math.round(current + delta)}px`;
    }
    return moved.map(([id]) => id);
  });
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

