'use client';

import { useEffect } from 'react';
import { registerElement } from '@/lib/editor/registry';
import { useEditor } from '@/lib/editor/store';
import type { RenderEngine } from '@/lib/renderer/render';
import { activeVariant } from '@/lib/renderer/variants';

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

  useComponent: (componentId) =>
    useEditor((s) => s.doc.components.find((c) => c.id === componentId)),

  // Asking is what loads them. Only a repeater ever calls this, so a page with
  // no bound list makes no request — and a page with three repeaters over one
  // collection makes one, because `loadRecords` is idempotent and dedupes what
  // is already in the air.
  useRecords: (collectionId) => {
    const rows = useEditor((s) => s.records[collectionId]);
    useEffect(() => {
      useEditor.getState().loadRecords(collectionId);
    }, [collectionId]);
    return rows;
  },

  // Links must never navigate away from the editor.
  resolveHref: () => '#',

  registerRef: registerElement,

  // A subscription, not a read: the answer depends on an ancestor's state, so
  // nothing about this node changes when the switch moves and a plain read
  // would leave the editor attached to the copy that just went off screen.
  // Only nodes that actually have variants ask, so the cost is theirs alone.
  useActiveVariantKey: (node) =>
    useEditor((s) => activeVariant(s.doc.nodes, node, s.doc.settings).key),

  commitText: (id, prop, value, ruleId) => {
    const store = useEditor.getState();
    const node = store.doc.nodes[id];
    if (!node) return;

    if (ruleId) {
      // The copy on screen came from a rule, so that is what typing over it
      // changes. Writing to the node's props instead would look like it
      // worked and then be overwritten the moment the state moved.
      const rule = node.rules?.find((r) => r.id === ruleId);
      if (rule && String(rule.set?.[prop] ?? '') !== value) {
        store.setRuleProps(ruleId, { [prop]: value });
      }
    } else if (String(node.props[prop] ?? '') !== value) {
      store.setNodeProps({ [prop]: value }, [id]);
    }
    store.beginTextEdit(null);
  },
};
