'use client';

/**
 * Global drag controller.
 *
 * One place owns dragging, whatever started it: an item from the insert panel,
 * an asset thumbnail, a component, or an element already on the canvas. They
 * all put a payload in the store; this listens on the window, keeps the drop
 * indicator up to date, and commits the drop.
 *
 * Doing it once means "drag a heading from the panel" and "drag a heading that
 * is already on the page" resolve their target through identical code, so they
 * can never disagree about where an element would land.
 */

import { useEffect } from 'react';
import { computeDrop } from '@/lib/canvas/dnd';
import { getElement } from '@/lib/document/schema';
import * as ops from '@/lib/document/operations';
import { collectSubtree } from '@/lib/document/tree';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { createNode } from '@/lib/document/factory';
import type { Cre8Document, ElementType, NodeId } from '@/lib/document/types';

export function DragController() {
  const dragging = useEditor((s) => Boolean(s.drag));

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const state = useEditor.getState();
      const drag = state.drag;
      if (!drag) return;

      const active = drag.active || Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3;
      if (drag.x !== e.clientX || drag.y !== e.clientY || active !== drag.active) {
        useEditor.setState({ drag: { ...drag, x: e.clientX, y: e.clientY, active } });
      }
      if (!active) return;

      const rootId = activeRootId(state);
      if (!rootId) return;

      const exclude =
        drag.payload.kind === 'move'
          ? drag.payload.nodeIds.flatMap((id) => collectSubtree(state.doc.nodes, id))
          : [];

      const result = computeDrop({
        clientX: e.clientX,
        clientY: e.clientY,
        doc: state.doc,
        rootId,
        excludeIds: exclude,
        payloadTypes: payloadTypes(drag.payload, state.doc),
      });

      state.setDropIndicator(
        result
          ? {
              parentId: result.parentId,
              index: result.index,
              rect: result.rect,
              orientation: result.orientation,
              containerRect: result.containerRect,
            }
          : null
      );
    };

    const onUp = () => {
      const state = useEditor.getState();
      const drag = state.drag;
      const target = state.dropIndicator;
      state.setDrag(null);
      if (!drag?.active || !target) return;
      commitDrop(drag.payload, target.parentId, target.index);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useEditor.getState().setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [dragging]);

  return null;
}

type DragPayload = NonNullable<ReturnType<typeof useEditor.getState>['drag']>['payload'];

/**
 * What the drop would put in the target, so the target can refuse it.
 *
 * Every branch answers in element types rather than in payload kinds, which is
 * what lets one containment rule cover a fresh element, a moved subtree and a
 * dragged asset alike.
 */
function payloadTypes(payload: DragPayload, doc: Cre8Document): ElementType[] {
  switch (payload.kind) {
    case 'new-element':
      return [payload.elementType];
    case 'new-component':
      return ['instance'];
    case 'asset': {
      const asset = doc.assets.find((a) => a.id === payload.assetId);
      return [asset?.type === 'video' ? 'video' : 'image'];
    }
    case 'move':
      return payload.nodeIds
        .map((id) => doc.nodes[id]?.type)
        .filter((type): type is ElementType => Boolean(type));
  }
}

function commitDrop(payload: DragPayload, parentId: NodeId, index: number): void {
  const store = useEditor.getState();

  switch (payload.kind) {
    case 'new-element': {
      store.transact(`Add ${getElement(payload.elementType).label}`, (draft) => {
        const id = ops.insertElement(draft, payload.elementType, parentId, index);
        return id ? [id] : undefined;
      });
      break;
    }
    case 'new-component': {
      store.transact('Add component', (draft) => {
        const id = ops.insertInstance(draft, payload.componentId, parentId, index);
        return id ? [id] : undefined;
      });
      break;
    }
    case 'asset': {
      const asset = store.doc.assets.find((a) => a.id === payload.assetId);
      if (!asset) break;
      store.transact('Add image', (draft) => {
        const node = createNode(asset.type === 'video' ? 'video' : 'image', {
          name: asset.name,
          props: { src: asset.url, alt: asset.name },
        });
        draft.nodes[node.id] = node;
        ops.attachChild(draft.nodes, parentId, node.id, index);
        return [node.id];
      });
      break;
    }
    case 'move': {
      store.transact('Move', (draft) => {
        ops.moveNodes(draft, payload.nodeIds, parentId, index);
        return payload.nodeIds;
      });
      break;
    }
  }
}

/** Floating label that follows the pointer while a drag is in flight. */
export function DragGhost() {
  const drag = useEditor((s) => s.drag);
  if (!drag?.active) return null;

  return (
    <div
      className="pointer-events-none fixed z-[1000] flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--overlay)] px-2 py-1 text-[11px] font-medium text-[var(--text)] shadow-[var(--shadow-float)]"
      style={{ left: drag.x + 12, top: drag.y + 14 }}
    >
      {drag.label}
    </div>
  );
}
