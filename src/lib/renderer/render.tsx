'use client';

/**
 * The React renderer.
 *
 * The canvas, preview mode and the published-site route all mount this. The
 * only difference between them is the *engine* they're given: the canvas
 * supplies one backed by the editor store (so a node re-renders when — and
 * only when — that node changes), while preview and static rendering supply
 * one backed by a plain snapshot.
 *
 * Nothing here knows about selection, dragging or overlays. Editor chrome is
 * drawn on top of the document, never inside it.
 */

import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { getElement } from '../document/schema';
import {
  instanceHidden,
  overriddenProps,
  rootForInstance,
  scopeForInstance,
  type OverrideScope,
} from '../document/components';
import type {
  CollectionRecord,
  ComponentDefinition,
  Cre8Document,
  NodeId,
  SceneNode,
} from '../document/types';
import { describeElement, toReactAttrs, type RenderMode } from './element-model';
import { boundProps, repeatRows } from './repeat';
import { activeVariant, variantsOf, type Variant } from './variants';

export interface RenderEngine {
  mode: RenderMode;
  /** Must be a hook — it is called unconditionally, once per node. */
  useNode: (id: NodeId) => SceneNode | undefined;
  /**
   * Resolve a component id to its definition. Must be a hook.
   *
   * The definition rather than just its root, because an instance needs both
   * halves at once: the tree to draw, and the properties that say which of it
   * this instance gets to change.
   */
  useComponent: (componentId: string) => ComponentDefinition | undefined;
  /**
   * The rows of one collection. Must be a hook.
   *
   * A hook because the editor loads them over the network — a repeater has to
   * redraw when they land, and again when a record is edited, without the node
   * itself having changed.
   */
  useRecords: (collectionId: string) => CollectionRecord[] | undefined;
  resolveHref: (href: string) => string;
  registerRef?: (id: NodeId, el: HTMLElement | null) => void;
  commitText?: (id: NodeId, prop: string, value: string, ruleId?: string | null) => void;
  /**
   * Which of a node's variants is on screen. Must be a hook.
   *
   * A node whose rules change its content renders as one element per
   * alternative and CSS picks between them, so nothing about the markup says
   * which one a designer is looking at. The canvas needs to know, because
   * selection and the text caret have to land on it.
   *
   * A hook rather than a plain call because the answer depends on an
   * *ancestor's* state, and every other subscription in the renderer is to the
   * node itself — so nothing would re-render when the switch moved, and the
   * editor would stay attached to the copy that just went off screen.
   */
  useActiveVariantKey: (node: SceneNode) => string;
}

const EngineContext = createContext<RenderEngine | null>(null);

/** Kept separate from the engine so entering text edit doesn't invalidate it. */
const EditingContext = createContext<NodeId | null>(null);

/**
 * The record the nearest repeater above put in scope.
 *
 * A context rather than a prop threaded through `NodeView` because it has to
 * survive `memo`: React re-renders a consumer when the context value changes
 * whatever its props did, which is precisely the behaviour a repeated subtree
 * needs and precisely what a prop would not give it.
 */
const RecordContext = createContext<CollectionRecord | null>(null);

/**
 * What the component instance above filled in.
 *
 * A context for the same reason the record is one: the nodes it applies to are
 * the *master's*, drawn under an instance that may be several levels up, and a
 * prop would have to be threaded through every `NodeView` in between. It is
 * `null` for every node not inside an instance, which is almost all of them,
 * and a `null` context never changes — so the subscription costs nothing on
 * the pages that do not use components.
 */
const OverrideContext = createContext<OverrideScope | null>(null);

/**
 * Put a record in scope for a whole subtree.
 *
 * The surface equivalent of what a dynamic route does at publish: a page that
 * is a template for a collection has one record in scope before the tree is
 * entered, so `bind` on it reads exactly as it does inside a repeater.
 *
 * The canvas and preview use it to show a *real* record rather than the
 * placeholder text a template was drawn with — a page nobody can lay out is
 * not a design surface. Which record is an editor-only choice, the same as
 * `switchDesign`, so looking at one post cannot change what the site says.
 */
export function RecordScope({
  record,
  children,
}: {
  record: CollectionRecord | null;
  children: React.ReactNode;
}) {
  return <RecordContext.Provider value={record}>{children}</RecordContext.Provider>;
}

export function useRenderEngine(): RenderEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('Cre8 renderer used outside of a RenderProvider');
  return engine;
}

export function RenderProvider({
  engine,
  editingId = null,
  children,
}: {
  engine: RenderEngine;
  editingId?: NodeId | null;
  children: React.ReactNode;
}) {
  return (
    <EngineContext.Provider value={engine}>
      <EditingContext.Provider value={editingId}>{children}</EditingContext.Provider>
    </EngineContext.Provider>
  );
}

/* --------------------------------------------------------------------------
 * Node view
 * ----------------------------------------------------------------------- */

interface NodeViewProps {
  id: NodeId;
  /** Component instances render the master tree under the instance's identity. */
  identityId?: NodeId;
  /** Inside an instance: visible, measurable, but not individually selectable. */
  inert?: boolean;
  /**
   * A copy the editor must not attach to.
   *
   * Stronger than `inert`, and a separate flag for exactly that reason: an
   * inert instance still exposes the instance's own identity, which is how you
   * select one. Every row of a repeater after the first is the *same node*
   * again, so a shared `data-cre8-id` would put two elements in the registry
   * under one key and a text edit would open in all of them at once.
   */
  repeated?: boolean;
  depth?: number;
}

const MAX_DEPTH = 64;

export const NodeView = memo(function NodeView({
  id,
  identityId,
  inert = false,
  repeated = false,
  depth = 0,
}: NodeViewProps) {
  const engine = useRenderEngine();
  const node = engine.useNode(id);
  // Unconditional, above the early returns: it is a hook, and a repeated
  // subtree redraws through this rather than through `useNode` — the node has
  // not changed, the record has.
  const record = useContext(RecordContext);
  const scope = useContext(OverrideContext);

  if (!node || depth > MAX_DEPTH) return null;

  // Two kinds of hidden, and they are not the same kind.
  //
  // An instance that hides a node hides it here too, in edit mode included:
  // the courtesy of drawing a hidden node dimmed exists so it can be found and
  // brought back, and neither applies to this one — it is not this node that
  // is hidden, and the control that would bring it back is the instance's, in
  // the inspector. Drawing it would only make the canvas disagree with the
  // file for a node nobody can click.
  const forced = instanceHidden(node, scope);
  if (forced === true) return null;
  if (forced === undefined && node.meta.hidden && engine.mode !== 'edit') return null;

  if (node.type === 'instance') {
    return <InstanceView node={node} repeated={repeated} depth={depth} />;
  }

  const shared = { identityId, inert, repeated, depth };

  // A node whose rules change its content renders as one element per
  // alternative, with CSS choosing between them. The single-element case is
  // kept off the mapping path entirely: it is every node on every page but a
  // handful, and an extra array walk per node per render is not free.
  const variants = variantsOf(node, boundProps(node, record, overriddenProps(node, scope)));
  if (variants.length === 1) {
    return <ElementView node={node} variant={variants[0]!} live {...shared} />;
  }
  return (
    <>
      {variants.map((variant) => (
        <VariantView key={variant.key} node={node} variant={variant} {...shared} />
      ))}
    </>
  );
});

/**
 * A variant, and whether it is the one on screen.
 *
 * Its own component so the subscription exists only for nodes that have
 * variants — every other node on the page is the branch above, which asks
 * nothing and subscribes to nothing.
 */
function VariantView(props: {
  node: SceneNode;
  variant: Variant;
  identityId?: NodeId;
  inert: boolean;
  repeated: boolean;
  depth: number;
}) {
  const active = useRenderEngine().useActiveVariantKey(props.node);
  return <ElementView {...props} live={props.variant.key === active} />;
}

function InstanceView({
  node,
  repeated,
  depth,
}: {
  node: SceneNode;
  repeated: boolean;
  depth: number;
}) {
  const engine = useRenderEngine();
  const componentId = String(node.props.componentId ?? '');
  const component = engine.useComponent(componentId);

  // Narrow on purpose: these two are the entire input. Depending on the whole
  // definition or the whole node would hand every element below a new context
  // value when the instance was merely renamed or moved, and the point of a
  // memo here is that an instance nobody has customised keeps handing down the
  // same `null`.
  const properties = component?.properties;
  const overrides = node.overrides;
  const scope = useMemo(
    () => (component ? scopeForInstance(component, node) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [properties, overrides]
  );

  const rootId = rootForInstance(component, node);
  if (!rootId) {
    return engine.mode === 'edit' ? (
      <div
        className={`c-${node.id}`}
        {...(repeated ? {} : { 'data-cre8-id': node.id })}
        data-cre8-placeholder
      >
        Missing component
      </div>
    ) : null;
  }
  // The master root supplies the styling; the instance supplies the identity,
  // so clicking anywhere inside selects the instance rather than the master.
  // The instance's own inertness is deliberately not folded into `repeated`:
  // an instance nested inside a master is inert and still selectable, which is
  // the only way to reach it.
  //
  // The provider goes on unconditionally, `null` included. An instance inside
  // another component's master must *replace* the scope it inherited, not add
  // to it — the nodes below belong to this component, and the outer scope is
  // keyed by ids from a different one.
  return (
    <OverrideContext.Provider value={scope}>
      <NodeView id={rootId} identityId={node.id} inert repeated={repeated} depth={depth} />
    </OverrideContext.Provider>
  );
}

/**
 * @param live Whether this is the variant currently on screen. Every surface
 *   renders every variant, but only one of them has a box, and the editor's
 *   attachments — the id it selects by, the ref it measures from, the caret —
 *   all have to land on that one.
 */
function ElementView({
  node,
  variant,
  live,
  identityId,
  inert,
  repeated,
  depth,
}: {
  node: SceneNode;
  variant: Variant;
  live: boolean;
  identityId?: NodeId;
  inert: boolean;
  repeated: boolean;
  depth: number;
}) {
  const engine = useRenderEngine();
  const editingId = useContext(EditingContext);
  const identity = identityId ?? node.id;
  // `!repeated` because rows two onward are the same node: without it, typing
  // into the first card would open a caret in every card at once.
  const isEditing = engine.mode === 'edit' && editingId === identity && live && !repeated;

  const model = useMemo(
    () =>
      describeElement(
        node,
        EMPTY_DOC,
        { mode: engine.mode, hrefResolver: engine.resolveHref },
        variant
      ),
    [node, variant, engine.mode, engine.resolveHref]
  );

  /**
   * Nodes inside a component instance are drawn from the master tree, so they
   * must not claim an identity of their own — the instance owns selection and
   * measurement for the whole subtree. Only the element that carries the
   * identity registers a ref.
   */
  const exposed = (identityId !== undefined || !inert) && live && !repeated;

  const setRef = useCallback(
    (el: HTMLElement | null) => {
      if (exposed) engine.registerRef?.(identity, el);
    },
    [engine, identity, exposed]
  );

  const def = getElement(node.type);
  const attrs = toReactAttrs(model.attrs, model.tag) as Record<string, unknown>;

  if (engine.mode === 'edit') {
    if (exposed) {
      attrs['data-cre8-id'] = identity;
      attrs['data-cre8-type'] = node.type;
    }
    if (identityId !== undefined) attrs['data-cre8-instance'] = 'true';
    if (node.meta.hidden) attrs['data-cre8-hidden'] = 'true';
    // `model.text === undefined` rather than just "no children": a button with
    // a label and no children is not an empty box, and drawing the empty-state
    // outline over it would be a placeholder on top of finished work.
    if (
      def.container &&
      model.text === undefined &&
      node.children.length === 0 &&
      !hasExplicitSize(node)
    ) {
      attrs['data-cre8-empty'] = 'true';
    }
  }

  const Tag = model.tag as keyof React.JSX.IntrinsicElements;

  /* --- Inline text editing ------------------------------------------------ */
  if (isEditing && model.editableProp) {
    return (
      <InlineTextEditor
        tag={model.tag}
        attrs={attrs}
        initial={model.text ?? ''}
        setRef={setRef}
        // Typing over a variant edits what produced it: the rule's `set` when
        // it came from one, the node's own props otherwise. Anything else and
        // the change would appear to work and then vanish when the state moved.
        onCommit={(value) =>
          engine.commitText?.(identity, model.editableProp!, value, variant.ruleId)
        }
      />
    );
  }

  /* --- Void elements ------------------------------------------------------ */
  if (model.void) {
    return React.createElement(Tag, { ...attrs, ref: setRef });
  }

  /* --- Raw markup (rich text, icon geometry) ------------------------------ */
  if (model.html !== undefined) {
    return React.createElement(Tag, {
      ...attrs,
      ref: setRef,
      dangerouslySetInnerHTML: { __html: model.html },
    });
  }

  /* --- Text-bearing leaves ------------------------------------------------ */
  if (model.text !== undefined) {
    return React.createElement(Tag, { ...attrs, ref: setRef }, model.text);
  }

  /* --- Containers --------------------------------------------------------- */
  // The repeating branch is its own component so the records subscription
  // exists only for nodes that repeat. Every other container on the page takes
  // the path it always took and asks nothing.
  const rendered = !model.acceptsChildren ? null : node.repeat ? (
    <RepeatedChildren node={node} inert={inert} repeated={repeated} depth={depth} />
  ) : (
    node.children.map((childId) => (
      <NodeView key={childId} id={childId} inert={inert} repeated={repeated} depth={depth + 1} />
    ))
  );

  const children = model.wrapChildren
    ? React.createElement(model.wrapChildren, { key: '__wrap' }, rendered)
    : rendered;

  const lead = model.lead
    ? React.createElement(model.lead.tag, { key: '__lead' }, model.lead.text)
    : null;

  return React.createElement(Tag, { ...attrs, ref: setRef }, lead, children);
}

/**
 * The subtree, once per record.
 *
 * The repeating node's own element is drawn once — the grid stays a grid — and
 * its `children` are what multiply, each group with a record in scope. The
 * template is normally a single child; several repeat together as a group.
 *
 * Nothing here writes a class, and that is the whole economy of the feature: a
 * hundred rows are a hundred subtrees carrying the classes the node already
 * had, so the stylesheet is exactly the size it was with one.
 */
function RepeatedChildren({
  node,
  inert,
  repeated,
  depth,
}: {
  node: SceneNode;
  inert: boolean;
  repeated: boolean;
  depth: number;
}) {
  const engine = useRenderEngine();
  const repeat = node.repeat!;
  const pool = engine.useRecords(repeat.collection);
  const rows = repeatRows(repeat, pool, engine.mode);

  return (
    <>
      {rows.map((record, index) => (
        <RecordContext.Provider key={record?.id ?? TEMPLATE_KEY} value={record}>
          {node.children.map((childId) => (
            <NodeView
              key={childId}
              id={childId}
              inert={inert}
              // Only the first row is the designer's; the rest are copies of
              // it, and two elements answering to one node id would break
              // selection, measurement and the text caret at once.
              repeated={repeated || index > 0}
              depth={depth + 1}
            />
          ))}
        </RecordContext.Provider>
      ))}
    </>
  );
}

/** React key for the design-time row an empty collection draws. */
const TEMPLATE_KEY = '__cre8-template';

/**
 * `describeElement` only needs the document to resolve internal page links,
 * and the engine already owns that. Passing a stub keeps every node render
 * free of a document-shaped dependency that would defeat memoisation.
 */
const EMPTY_DOC = { pages: [] } as unknown as Cre8Document;

/**
 * A container that sizes itself — a divider strip, a coloured dot, a chart
 * placeholder — must not get the editor's empty-container minimum height, or
 * the canvas would draw it at a size the published page never will.
 */
function hasExplicitSize(node: SceneNode): boolean {
  for (const layer of Object.values(node.styles)) {
    if (!layer) continue;
    if (layer.height || layer.minHeight || layer.aspectRatio) return true;
  }
  return false;
}

/* --------------------------------------------------------------------------
 * Inline text editing
 * ----------------------------------------------------------------------- */

function InlineTextEditor({
  tag,
  attrs,
  initial,
  setRef,
  onCommit,
}: {
  tag: string;
  attrs: Record<string, unknown>;
  initial: string;
  setRef: (el: HTMLElement | null) => void;
  onCommit: (value: string) => void;
}) {
  const elementRef = useRef<HTMLElement | null>(null);
  const committed = useRef(false);

  const attach = useCallback(
    (el: HTMLElement | null) => {
      elementRef.current = el;
      setRef(el);
    },
    [setRef]
  );

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // Select everything so the first keystroke replaces placeholder copy —
    // the same behaviour as renaming a layer in Figma.
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    committed.current = false;
  }, []);

  const commit = useCallback(() => {
    if (committed.current) return;
    committed.current = true;
    const value = elementRef.current?.innerText ?? '';
    onCommit(value.replace(/ /g, ' '));
  }, [onCommit]);

  return React.createElement(
    tag as keyof React.JSX.IntrinsicElements,
    {
      ...attrs,
      ref: attach,
      contentEditable: true,
      suppressContentEditableWarning: true,
      spellCheck: false,
      'data-cre8-editing': 'true',
      onBlur: commit,
      onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
      onKeyDown: (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          committed.current = true;
          (e.currentTarget as HTMLElement).blur();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLElement).blur();
        }
      },
      onPaste: (e: React.ClipboardEvent) => {
        // Keep pasted content plain so a stray copy can't inject markup.
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      },
    },
    initial
  );
}

/* --------------------------------------------------------------------------
 * Snapshot engine — preview and any non-editing surface
 * ----------------------------------------------------------------------- */

export function createSnapshotEngine(
  doc: Cre8Document,
  mode: RenderMode,
  hrefResolver?: (href: string) => string,
  records?: Record<string, CollectionRecord[] | undefined>
): RenderEngine {
  const componentsById = new Map(doc.components.map((c) => [c.id, c]));
  return {
    mode,
    useNode: (id) => doc.nodes[id],
    useComponent: (componentId) => componentsById.get(componentId),
    // A snapshot is a fixed set of rows, handed in rather than fetched.
    // Preview is given the same ones the canvas is looking at, so the two
    // agree. Anything else — a block thumbnail — is given none, and since a
    // snapshot never runs in `edit` mode its repeaters draw nothing at all
    // rather than a template row.
    useRecords: (collectionId) => records?.[collectionId],
    // A snapshot has no design-time state to consult, so the base is the
    // honest answer — and nothing outside the canvas uses what it decides.
    useActiveVariantKey: (node) => activeVariant(doc.nodes, node, doc.settings).key,
    resolveHref: hrefResolver ?? ((href) => defaultHref(doc, href, mode)),
  };
}

function defaultHref(doc: Cre8Document, href: string, mode: RenderMode): string {
  if (!href) return '#';
  if (!href.startsWith('page:')) return href;
  const page = doc.pages.find((p) => p.id === href.slice(5));
  if (!page) return '#';
  if (mode !== 'publish') return '#';
  return page.isHome || page.slug === '' ? '/' : `/${page.slug}`;
}
