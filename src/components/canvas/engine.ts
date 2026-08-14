'use client';

import { useEffect, useMemo } from 'react';
import { registerElement } from '@/lib/editor/registry';
import { useEditor } from '@/lib/editor/store';
import type { RenderEngine } from '@/lib/renderer/render';
import { recordIndex, withReferences } from '@/lib/renderer/repeat';
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

  /*
   * Asking is what loads them. Only a repeater ever calls this, so a page with
   * no bound list makes no request — and a page with three repeaters over one
   * collection makes one, because `loadRecords` is idempotent and dedupes what
   * is already in the air.
   *
   * And whatever this collection points at, by the same rule `publish.ts`
   * follows: a card that says `⟨Author⟩ → ⟨Name⟩` needs the authors, nothing
   * repeats the authors, so nothing else was ever going to ask. Asked here
   * rather than by `useFindRecord` because that one is called by *every* node
   * and has no collection to start from — this one is called by the repeater
   * that put the record in scope, which is exactly where the answer is known.
   */
  useRecords: (collectionId) => {
    const rows = useEditor((s) => s.records[collectionId]);
    useEffect(() => {
      const store = useEditor.getState();
      for (const id of withReferences([collectionId], store.doc.collections ?? [])) {
        store.loadRecords(id);
      }
    }, [collectionId]);
    return rows;
  },

  /*
   * Whatever rows are already loaded, by id, for a chain that follows a
   * reference.
   *
   * Deliberately does *not* load anything. `useRecords` is called by a
   * repeater, which knows which collection it wants; this is called by every
   * node, so asking would fetch every collection in the project the moment one
   * card mentioned an author — and on a page with no `follow` on it at all.
   * What it does instead is read what the repeater above already pulled in and
   * whatever the Collections panel has been looking at, which covers the case
   * this exists for: the record and the thing it points at are nearly always
   * both on screen.
   *
   * When a row is genuinely not loaded the chain resolves to nothing and the
   * binding leaves the design-time text alone — the same answer it gives for a
   * deleted record. It is not the same as the published file, which has every
   * row; that is the one place the canvas can be behind, and it catches up as
   * soon as the rows arrive because this is a subscription.
   *
   * Subscribed by identity, not by value: `s.records` is replaced whenever any
   * collection lands, and rebuilding the index inside the selector would
   * return a new function on every store update and re-render the whole
   * canvas. `useMemo` on the map keeps it stable between those landings.
   */
  useFindRecord: () => {
    const records = useEditor((s) => s.records);
    return useMemo(() => recordIndex(records), [records]);
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
        // `[id]`, not the live selection. A commit can arrive after the click
        // that ended the edit has already selected something else — which is
        // exactly the bug the inspector had, on a different path.
        store.setRuleProps(ruleId, { [prop]: value }, [id]);
      }
    } else if (String(node.props[prop] ?? '') !== value) {
      store.setNodeProps({ [prop]: value }, [id]);
    }
    store.beginTextEdit(null);
  },
};
