'use client';

import { registerElement } from '@/lib/editor/registry';
import { useEditor } from '@/lib/editor/store';
import type { RenderEngine } from '@/lib/renderer/render';

/**
 * The editor's render engine.
 *
 * `useNode` subscribes each rendered element to its own node, so an edit
 * re-renders exactly the nodes it touched — not the page. That is what keeps
 * the canvas responsive at a thousand nodes.
 *
 * Module-level and frozen: the object identity must never change, or every
 * element in the document would re-render on each store update.
 */
export const editorEngine: RenderEngine = {
  mode: 'edit',

  useNode: (id) => useEditor((s) => s.doc.nodes[id]),

  useComponentRoot: (componentId) =>
    useEditor((s) => s.doc.components.find((c) => c.id === componentId)?.rootNodeId),

  // Links must never navigate away from the editor.
  resolveHref: () => '#',

  registerRef: registerElement,

  commitText: (id, prop, value) => {
    const store = useEditor.getState();
    const node = store.doc.nodes[id];
    if (node && String(node.props[prop] ?? '') !== value) {
      store.setNodeProps({ [prop]: value }, [id]);
    }
    store.beginTextEdit(null);
  },
};
