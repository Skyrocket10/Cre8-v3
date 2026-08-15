'use client';

/**
 * What a record fills in, written where the content is written.
 *
 * `docs/INSPECTOR.md` Rule 2: **content is part of Appearance**. A heading's
 * words are the heading, and where those words come from is not a second
 * subject. Until A2 these sentences rendered inside a section called Data —
 * filed under what an element *declares*, next to the repeater, and on screen
 * only when the project had collections and this element was in scope of one.
 * So the panel taught that a bound heading is a database feature, and the first
 * thing anybody had to learn in order to write one was where the database
 * lives.
 *
 * Nothing about the document moved. `node.bind` is the same map of prop to
 * `Binding` it has been since D2, the resolver is the same one, and the
 * published bytes are identical. What moved is the sentence: into the accordion
 * that holds the field it fills, under the words somebody typed there first.
 *
 * ## Why it is one block rather than a chevron on each field
 *
 * The end state §3.2 describes is the affordance *on the property* — a text
 * field that grows the same chip a comparison's operand has. That is A3's
 * shape and it will reach content too. This is the honest half-step: every
 * bindable prop this element has, in one list, inside the section that owns
 * those props. It is one component rather than twenty edited controls, which
 * is also what stops the next content type shipping without it.
 */

import { Database } from 'lucide-react';
import { bindableProps } from '@/lib/document/content-props';
import type { Value } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { Sentence } from '../ui/sentence';
import { bindingSentence } from './sentences';
import { collectionInScope } from './section-data';

export function ContentBindings() {
  const node = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id] : undefined;
  });
  const collections = useEditor((s) => s.doc.collections);
  const nodes = useEditor((s) => s.doc.nodes);
  const pageCollection = useEditor(
    (s) => s.doc.pages.find((page) => page.id === s.activePageId)?.dynamic?.collection
  );
  /*
   * Whether the panel above these rows is editing a condition rather than the
   * element. The content fields write into the rule when one is active — that
   * is what `ContentModeNote` says — and a binding does not, so the difference
   * has to be said here rather than left to be discovered.
   */
  const inRule = useEditor((s) => {
    const id = s.selection[0];
    if (!id || !s.activeRuleId) return false;
    return Boolean(s.doc.nodes[id]?.rules?.some((rule) => rule.id === s.activeRuleId));
  });

  if (!node || !collections?.length) return null;
  // A repeater is outside its own rows: it is the thing drawing them, so there
  // is no record for it to read. Its children are the ones inside.
  if (node.repeat) return null;
  const collection = collectionInScope(nodes, node, collections, pageCollection);
  if (!collection) return null;

  // Only the props this element actually has. Offering `src` on a heading is
  // a control that appears to do nothing.
  const offered = bindableProps().filter((prop) => prop in node.props);
  /*
   * Nothing to bind is nothing to say. The Data section used to print "this
   * element has no content to bind" here, because otherwise adding the section
   * produced an empty accordion and no explanation. There is no empty
   * accordion now — the content controls are directly above — so the sentence
   * would be a paragraph telling somebody about a thing that is not there.
   */
  if (!offered.length) return null;

  const bound = Object.keys(node.bind ?? {}).length > 0;

  const setBinding = (prop: string, value: Value | null) =>
    useEditor.getState().transact(value ? 'Bind to a field' : 'Unbind', (draft) => {
      const scene = draft.nodes[node.id];
      if (!scene) return;
      if (value) {
        // A new value means a new type, and a currency format on a date is
        // nonsense. Dropped rather than migrated: there is no honest mapping.
        scene.bind = { ...(scene.bind ?? {}), [prop]: { value } };
      } else if (scene.bind) {
        delete scene.bind[prop];
        if (!Object.keys(scene.bind).length) delete scene.bind;
      }
    });

  return (
    <div className="mt-2.5 flex flex-col gap-1.5 border-t border-[var(--border-soft)] pt-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
        <Database size={10} className="shrink-0" />
        <span className="truncate">Inside {collection.name}</span>
      </div>

      {offered.map((prop) => (
        <Sentence
          key={prop}
          parts={bindingSentence({
            prop,
            binding: node.bind?.[prop],
            fields: collection.fields,
            collections,
            // Which collection the record in scope is from, so a `where` can
            // compare a row's reference against *this* record rather than
            // against a record id somebody would have to type.
            scope: collection,
            onBind: (value) => setBinding(prop, value),
            onFormat: (format) =>
              useEditor.getState().transact('Change how this reads', (draft) => {
                const target = draft.nodes[node.id]?.bind?.[prop];
                if (!target) return;
                if (format) target.format = format;
                else delete target.format;
              }),
          })}
        />
      ))}

      {inRule ? (
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          These belong to the element rather than to this condition — the record fills it in every
          one. A condition that sets the same prop still wins over it.
        </p>
      ) : bound ? (
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          A bound value is replaced by the record. A condition that sets the same prop still wins
          over it.
        </p>
      ) : null}
    </div>
  );
}
