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
import type { Cre8Document, NodeId, SceneNode } from '../document/types';
import { describeElement, toReactAttrs, type RenderMode } from './element-model';

export interface RenderEngine {
  mode: RenderMode;
  /** Must be a hook — it is called unconditionally, once per node. */
  useNode: (id: NodeId) => SceneNode | undefined;
  /** Resolve a component id to its master root node. */
  useComponentRoot: (componentId: string) => NodeId | undefined;
  resolveHref: (href: string) => string;
  registerRef?: (id: NodeId, el: HTMLElement | null) => void;
  commitText?: (id: NodeId, prop: string, value: string) => void;
}

const EngineContext = createContext<RenderEngine | null>(null);

/** Kept separate from the engine so entering text edit doesn't invalidate it. */
const EditingContext = createContext<NodeId | null>(null);

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
  depth?: number;
}

const MAX_DEPTH = 64;

export const NodeView = memo(function NodeView({
  id,
  identityId,
  inert = false,
  depth = 0,
}: NodeViewProps) {
  const engine = useRenderEngine();
  const node = engine.useNode(id);

  if (!node || depth > MAX_DEPTH) return null;
  if (node.meta.hidden && engine.mode !== 'edit') return null;

  if (node.type === 'instance') {
    return <InstanceView node={node} depth={depth} />;
  }
  return <ElementView node={node} identityId={identityId} inert={inert} depth={depth} />;
});

function InstanceView({ node, depth }: { node: SceneNode; depth: number }) {
  const engine = useRenderEngine();
  const componentId = String(node.props.componentId ?? '');
  const rootId = engine.useComponentRoot(componentId);

  if (!rootId) {
    return engine.mode === 'edit' ? (
      <div className={`c-${node.id}`} data-cre8-id={node.id} data-cre8-placeholder>
        Missing component
      </div>
    ) : null;
  }
  // The master root supplies the styling; the instance supplies the identity,
  // so clicking anywhere inside selects the instance rather than the master.
  return <NodeView id={rootId} identityId={node.id} inert depth={depth} />;
}

function ElementView({
  node,
  identityId,
  inert,
  depth,
}: {
  node: SceneNode;
  identityId?: NodeId;
  inert: boolean;
  depth: number;
}) {
  const engine = useRenderEngine();
  const editingId = useContext(EditingContext);
  const identity = identityId ?? node.id;
  const isEditing = engine.mode === 'edit' && editingId === identity;

  const model = useMemo(
    () =>
      describeElement(node, EMPTY_DOC, {
        mode: engine.mode,
        hrefResolver: engine.resolveHref,
      }),
    [node, engine.mode, engine.resolveHref]
  );

  /**
   * Nodes inside a component instance are drawn from the master tree, so they
   * must not claim an identity of their own — the instance owns selection and
   * measurement for the whole subtree. Only the element that carries the
   * identity registers a ref.
   */
  const exposed = identityId !== undefined || !inert;

  const setRef = useCallback(
    (el: HTMLElement | null) => {
      if (exposed) engine.registerRef?.(identity, el);
    },
    [engine, identity, exposed]
  );

  const def = getElement(node.type);
  const attrs = toReactAttrs(model.attrs) as Record<string, unknown>;

  if (engine.mode === 'edit') {
    if (exposed) {
      attrs['data-cre8-id'] = identity;
      attrs['data-cre8-type'] = node.type;
    }
    if (identityId !== undefined) attrs['data-cre8-instance'] = 'true';
    if (node.meta.hidden) attrs['data-cre8-hidden'] = 'true';
    if (def.container && node.children.length === 0 && !hasExplicitSize(node)) {
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
        onCommit={(value) => engine.commitText?.(identity, model.editableProp!, value)}
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
  const rendered = model.acceptsChildren
    ? node.children.map((childId) => (
        <NodeView key={childId} id={childId} inert={inert} depth={depth + 1} />
      ))
    : null;

  const children = model.wrapChildren
    ? React.createElement(model.wrapChildren, { key: '__wrap' }, rendered)
    : rendered;

  const lead = model.lead
    ? React.createElement(model.lead.tag, { key: '__lead' }, model.lead.text)
    : null;

  return React.createElement(Tag, { ...attrs, ref: setRef }, lead, children);
}

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
  hrefResolver?: (href: string) => string
): RenderEngine {
  const componentRoots = new Map(doc.components.map((c) => [c.id, c.rootNodeId]));
  return {
    mode,
    useNode: (id) => doc.nodes[id],
    useComponentRoot: (componentId) => componentRoots.get(componentId),
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
