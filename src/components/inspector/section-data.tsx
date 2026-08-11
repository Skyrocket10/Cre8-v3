'use client';

/**
 * Repeating and binding, in the inspector.
 *
 * Two controls that look unrelated and are the same idea at two scales. A
 * **repeater** puts a record in scope for its children, once per row. A
 * **binding** reads a field of whatever record is in scope. Neither means
 * anything without the other, so they are one section — and the section says
 * which record is in scope, because "why is this heading still the
 * placeholder" is otherwise unanswerable from the panel.
 *
 * What is deliberately not here: the records themselves. Those live in the
 * Collections panel, they go straight to D1, and they do not undo. A control
 * that edited content from the design inspector would put somebody's blog post
 * on the undo stack.
 */

import React from 'react';
import { Database, Gauge, Layers, Sparkles, Trash2 } from 'lucide-react';
import { danglingReads } from '@/lib/document/factory';
import { uid } from '@/lib/document/id';
import * as ops from '@/lib/document/operations';
import { getElement, slug } from '@/lib/document/schema';
import {
  LIMITS,
  type Collection,
  type SceneNode,
  type StateRule,
  type StyleProp,
  type Test,
  type ValueVar,
} from '@/lib/document/types';
import {
  elementsRead,
  fieldsRead,
  needsRuntime,
  provablyOverlap,
  unfinished,
} from '@/lib/renderer/test';
import { varReference } from '@/lib/renderer/values';
import { isSettable } from '@/lib/renderer/variants';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { Section, Select, TextInput } from '../ui/primitives';
import { Sentence, type Part } from '../ui/sentence';
import { bindingSentence, blankTest, filterSentence, testSentence } from './sentences';
import { InspectorGroup, StyleRow } from './controls';

/** Props worth offering a binding for, in the order they appear in Content. */
const BINDABLE = ['text', 'html', 'label', 'alt', 'src', 'href', 'caption', 'placeholder', 'value', 'title'];

export function DataSection() {
  const node = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id] : undefined;
  });
  const collections = useEditor((s) => s.doc.collections);
  const nodes = useEditor((s) => s.doc.nodes);
  const page = useEditor((s) => s.doc.pages.find((p) => p.id === s.activePageId));

  if (!node || !collections?.length) return null;

  const scope = collectionInScope(nodes, node, collections, page?.dynamic?.collection);
  const canRepeat = getElement(node.type).container;
  if (!canRepeat && !scope) return null;

  // What this node now contains, said on the node that made it so. Read off
  // `node.repeat` rather than off `scope`, which is deliberately about what is
  // in scope *for this node* — a repeater is outside its own rows.
  const repeating = collections.find((c) => c.id === node.repeat?.collection);

  return (
    <Section title="Data" badge={node.repeat ? <Layers size={10} /> : undefined}>
      <InspectorGroup>
        {canRepeat && <RepeatControls node={node} collections={collections} />}
        {repeating && (
          <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
            Everything inside this repeats once per {singular(repeating.name)} — select a child to
            bind its content.
          </p>
        )}
        {scope && !node.repeat && <BindControls node={node} collection={scope} />}
        {scope && !node.repeat && <AssignControls node={node} collection={scope} />}
        {scope && !node.repeat && <VarControls node={node} collection={scope} />}
      </InspectorGroup>
    </Section>
  );
}

/** "Posts" → "post". Good enough for the two words this ever sees. */
const singular = (name: string) => name.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

/**
 * Which collection's record is in scope here.
 *
 * The nearest repeater above, or the page itself when the page is a template.
 * Mirrors what the renderer does, because a panel that disagreed with the
 * canvas about which record is in scope would be worse than no panel.
 */
function collectionInScope(
  nodes: Record<string, SceneNode>,
  node: SceneNode,
  collections: Collection[],
  pageCollection: string | undefined
): Collection | null {
  let current: SceneNode | undefined = node;
  let guard = 0;
  while (current && guard++ < 200) {
    const id = current.repeat?.collection;
    // A repeater's own element is outside its rows; only its children are in.
    if (id && current !== node) return collections.find((c) => c.id === id) ?? null;
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return pageCollection ? (collections.find((c) => c.id === pageCollection) ?? null) : null;
}

/* --------------------------------------------------------------------------
 * Repeat
 * ----------------------------------------------------------------------- */

function RepeatControls({ node, collections }: { node: SceneNode; collections: Collection[] }) {
  const repeat = node.repeat;
  const target = collections.find((c) => c.id === repeat?.collection);

  const write = (label: string, patch: (current: NonNullable<SceneNode['repeat']>) => void) =>
    useEditor.getState().transact(label, (draft) => {
      const target = draft.nodes[node.id];
      if (target?.repeat) patch(target.repeat);
    });

  return (
    <>
      <StyleRow label="Repeat" hint="Draw everything inside this once per record">
        <Select
          className="flex-1"
          value={repeat?.collection ?? ''}
          options={[
            { value: '', label: 'No — draw once' },
            ...collections.map((c) => ({ value: c.id, label: c.name })),
          ]}
          onChange={(collection) =>
            useEditor.getState().transact(collection ? 'Repeat over records' : 'Stop repeating', (draft) => {
              const scene = draft.nodes[node.id];
              if (!scene) return;
              if (collection) scene.repeat = { ...(scene.repeat ?? {}), collection };
              else delete scene.repeat;
            })
          }
        />
      </StyleRow>

      {repeat && target && (
        <>
          <StyleRow label="Sort by">
            <Select
              className="flex-1"
              value={repeat.sort?.field ?? ''}
              options={[
                { value: '', label: 'Collection order' },
                ...target.fields.map((f) => ({ value: f.key, label: f.label })),
              ]}
              onChange={(field) =>
                write('Sort records', (current) => {
                  if (field) current.sort = { field, direction: current.sort?.direction ?? 'asc' };
                  else delete current.sort;
                })
              }
            />
            {repeat.sort && (
              <Select
                width={104}
                value={repeat.sort.direction}
                options={[
                  { value: 'asc', label: 'A → Z' },
                  { value: 'desc', label: 'Z → A' },
                ]}
                onChange={(direction) =>
                  write('Sort records', (current) => {
                    if (current.sort) current.sort.direction = direction;
                  })
                }
              />
            )}
          </StyleRow>

          <StyleRow label="Show" hint="How many rows at most. Empty means all of them.">
            <TextInput
              className="flex-1"
              value={repeat.limit === undefined ? '' : String(repeat.limit)}
              placeholder="All"
              inputMode="numeric"
              onValueChange={(value) =>
                write('Limit records', (current) => {
                  const n = Number(value);
                  if (!value || !Number.isFinite(n) || n <= 0) delete current.limit;
                  else current.limit = Math.min(Math.floor(n), LIMITS.recordsPerRepeat);
                })
              }
              suffix={`max ${LIMITS.recordsPerRepeat}`}
            />
          </StyleRow>

          <StyleRow
            label="Split"
            hint="Publish this page in slices — /blog/, /blog/2/ — instead of one long list"
          >
            <TextInput
              className="flex-1"
              value={repeat.paginate === undefined ? '' : String(repeat.paginate)}
              placeholder="One page"
              inputMode="numeric"
              onValueChange={(value) =>
                write('Split into pages', (current) => {
                  const n = Number(value);
                  if (!value || !Number.isFinite(n) || n <= 0) delete current.paginate;
                  else current.paginate = Math.floor(n);
                })
              }
              suffix="per page"
            />
          </StyleRow>

          {/*
            Filters, in the same sentence a Test is written in. `RecordFilter`
            has always been field · operator · value — the same grammar — and
            saying it three different ways in three panels was the reason a
            designer had no way of noticing that.

            This is also the honest answer to "hide the sold ones": a filter
            keeps a record out of the file, where hiding it with CSS does not.
          */}
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <span className="text-[10px] text-[var(--text-faint)]">Which records</span>
            <button
              type="button"
              onClick={() =>
                write('Filter records', (current) => {
                  const field = target.fields[0];
                  if (field) {
                    current.filter = [...(current.filter ?? []), { field: field.key, op: 'is', value: '' }];
                  }
                })
              }
              className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              + Filter
            </button>
          </div>
          {(repeat.filter ?? []).map((filter, index) => (
            <Sentence
              key={index}
              parts={filterSentence({
                filter,
                fields: target.fields,
                onChange: (next) =>
                  write('Filter records', (current) => {
                    if (current.filter?.[index]) current.filter[index] = next;
                  }),
                onRemove: () =>
                  write('Remove a filter', (current) => {
                    current.filter = (current.filter ?? []).filter((_, at) => at !== index);
                    if (!current.filter.length) delete current.filter;
                  }),
              })}
            />
          ))}

          {repeat.paginate ? (
            <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
              Each slice publishes as its own file, so every one can be found and linked. Use a
              link with <code className="font-mono">series:next</code> to move between them.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
 * Bind
 * ----------------------------------------------------------------------- */

function BindControls({ node, collection }: { node: SceneNode; collection: Collection }) {
  // Only the props this element actually has. Offering `src` on a heading is
  // a control that appears to do nothing.
  const offered = BINDABLE.filter((prop) => isSettable(prop) && prop in node.props);
  if (!offered.length) {
    return (
      <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
        Inside {collection.name} — this element has no content to bind.
      </p>
    );
  }

  const setBinding = (prop: string, key: string) =>
    useEditor.getState().transact(key ? 'Bind to a field' : 'Unbind', (draft) => {
      const scene = draft.nodes[node.id];
      if (!scene) return;
      if (key) {
        // A new field means a new type, and a currency format on a date is
        // nonsense. Dropped rather than migrated: there is no honest mapping.
        scene.bind = { ...(scene.bind ?? {}), [prop]: { value: { kind: 'field', key } } };
      } else if (scene.bind) {
        delete scene.bind[prop];
        if (!Object.keys(scene.bind).length) delete scene.bind;
      }
    });

  return (
    <>
      <div className="flex items-center gap-1.5 pb-0.5 text-[10px] text-[var(--text-faint)]">
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
            onBind: (key) => setBinding(prop, key),
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

      {node.bind && Object.keys(node.bind).length > 0 && (
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          A bound value is replaced by the record. A condition that sets the same prop still wins
          over it.
        </p>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
 * When something is true, the element is in a state
 * ----------------------------------------------------------------------- */

/**
 * `WHEN price is over 500000 → expensive`.
 *
 * Phase B of the expression model, and the reason it is worth having before
 * anything that puts a value into a CSS declaration: the answer is a *state*,
 * and states are already the thing the whole styling system is built on. The
 * designer writes the test here and then styles `expensive` with the ordinary
 * inspector, on machinery that has existed since stage 2.
 *
 * Nothing is evaluated in the browser. The record is known when the page is
 * published, so the state is written straight into the markup — no script, no
 * flash, correct with scripting off, and one stylesheet however many rows the
 * repeater draws.
 */
function AssignControls({ node, collection }: { node: SceneNode; collection: Collection }) {
  const nodes = useEditor((s) => s.doc.nodes);
  const rules = node.assign ?? [];
  const key = String(node.props.switchKey ?? '');
  const controls = namedControlsInside(nodes, node);
  const elements = alsoAlreadyRead(
    controlsOnPage(nodes, activeRootId(useEditor.getState()) ?? undefined, node),
    rules,
    nodes
  );
  /*
   * Rules whose element is not in the document at all, by rule.
   *
   * Read from the shared walk rather than recomputed here, because "what
   * counts as dangling" is exactly the kind of definition that drifts when two
   * places own it — cleanup would keep a rule the panel called broken, or the
   * other way round.
   */
  const dangling = danglingReads(nodes).filter((one) => one.node.id === node.id);
  /** What the element is left in when a rule can never hold. */
  const fallback = slug(node.props.switchDefault) || 'in no state';
  const problem = unfinished(node);
  const live = needsRuntime(node);
  const exposed = live
    ? [...new Set(rules.flatMap((rule) => fieldsRead(rule.when)))].map(
        (fieldKey) => collection.fields.find((f) => f.key === fieldKey)?.label ?? fieldKey
      )
    : [];

  const edit = (label: string, patch: (scene: SceneNode) => void) =>
    useEditor.getState().transact(label, (draft) => {
      const scene = draft.nodes[node.id];
      if (scene) patch(scene);
    });

  const add = () => {
    const field = collection.fields[0];
    if (!field) return;
    edit('Add a state rule', (scene) => {
      /*
       * An element carries one state, and it carries it under a key — that is
       * what `data-cre8-switch` is. A rule with no key would resolve correctly
       * and write nowhere, which is the worst kind of broken: the inspector
       * would look right and the page would never change. So the first rule
       * names the key after the element, and the designer can rename it.
       */
      if (!slug(scene.props.switchKey)) scene.props.switchKey = slug(scene.name) || 'state';
      scene.assign = [
        ...(scene.assign ?? []),
        {
          id: uid(),
          when: blankTest(field),
          value: '',
        },
      ];
    });
  };

  const write = (id: string, patch: (rule: StateRule) => void) =>
    edit('Change a state rule', (scene) => {
      const rule = scene.assign?.find((r) => r.id === id);
      if (rule) patch(rule);
    });

  return (
    <>
      <div className="flex items-center justify-between gap-2 pt-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
          <Sparkles size={10} className="shrink-0" />
          <span>State from the record</span>
        </div>
        <button
          type="button"
          onClick={add}
          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          + Rule
        </button>
      </div>

      {!rules.length && (
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          Put this element in a state when the record says so — then style that state like any
          other.
        </p>
      )}

      {rules.map((rule, index) => {
        const compare = rule.when.kind === 'compare' ? rule.when : null;
        const effect = ops.assignEffect(node, rule.id);
        // Only against rules *before* this one: the warning is about which of
        // the two wins, and the answer is always "the later one", so it
        // belongs on the later one.
        const shadows =
          compare &&
          rules
            .slice(0, index)
            .filter((earlier) => provablyOverlap(earlier.when, compare))
            .map((earlier) => earlier.value)
            .filter(Boolean);

        return (
          <div key={rule.id} className="rounded border border-[var(--border-subtle)] p-1.5">
            <Sentence
              parts={[
                ...testSentence({
                  test: rule.when,
                  fields: collection.fields,
                  controls,
                  elements,
                  onChange: (next: Test) => write(rule.id, (target) => (target.when = next)),
                }),
                { kind: 'break', key: 'b1' },
                { kind: 'word', text: 'this is', key: 'is' },
                {
                  kind: 'type',
                  key: 'state',
                  value: rule.value,
                  placeholder: 'a state',
                  onChange: (value: string) =>
                    useEditor.getState().transact('Rename a state', (draft) => {
                      ops.setAssignValue(draft, node.id, rule.id, value);
                    }),
                },
                { kind: 'word', text: 'and it', key: 'and' },
                {
                  kind: 'pick',
                  key: 'effect',
                  value: effect.kind === 'style' ? `p:${effect.prop}` : effect.kind,
                  menuWidth: 200,
                  options: [
                    { value: 'state', label: 'does nothing else' },
                    { value: 'hide', label: 'hides' },
                    { value: 'show', label: 'shows' },
                    ...EFFECT_PROPS.map(([prop, word]) => ({
                      value: `p:${prop}`,
                      label: `sets ${word}`,
                    })),
                  ],
                  onChange: (next: string) =>
                    useEditor.getState().transact('Change what a state does', (draft) => {
                      const prop = next.startsWith('p:') ? (next.slice(2) as StyleProp) : null;
                      ops.setAssignEffect(
                        draft,
                        node.id,
                        rule.id,
                        prop
                          ? {
                              kind: 'style',
                              prop,
                              value:
                                effect.kind === 'style' && effect.prop === prop ? effect.value : '',
                            }
                          : { kind: next as 'state' | 'hide' | 'show' }
                      );
                    }),
                },
                ...(effect.kind === 'style'
                  ? ([
                      { kind: 'word', text: 'to', key: 'to' },
                      {
                        kind: 'type',
                        key: 'to-value',
                        value: effect.value,
                        placeholder: 'value',
                        onChange: (value: string) =>
                          useEditor.getState().transact('Change what a state does', (draft) => {
                            ops.setAssignEffect(draft, node.id, rule.id, {
                              kind: 'style',
                              prop: effect.prop,
                              value,
                            });
                          }),
                      },
                    ] as Part[])
                  : []),
                {
                  kind: 'action',
                  key: 'remove',
                  title: 'Remove this rule',
                  label: <Trash2 size={11} />,
                  onClick: () =>
                    useEditor.getState().transact('Remove a state rule', (draft) => {
                      ops.removeAssign(draft, node.id, rule.id);
                    }),
                },
              ]}
            />

            {effect.kind === 'hide' && (
              /*
               * The disclosure that matters most, said where the decision is
               * made. Hiding is CSS, which is what makes it work with no
               * script and before first paint — and it means the row is in the
               * file. For a sold house that is fine; for something that should
               * not be published at all, a filter on the repeater is the
               * honest tool and this is not.
               */
              <p className="pt-1 text-[10px] leading-relaxed text-[var(--text-faint)]">
                Hidden with CSS, so the content is still in the published file. To keep a record off
                the page entirely, filter the list instead.
              </p>
            )}

            {shadows && shadows.length > 0 && (
              <p className="pt-1 text-[10px] leading-relaxed text-[var(--warning,#d97706)]">
                This can be true at the same time as {shadows.join(', ')}. When both hold, this one
                wins — it is later in the list.
              </p>
            )}

            {dangling.some((one) => one.rule === rule.id) && (
              /*
               * Beside the sentence, not at the foot of the panel: the fix is
               * to repoint the source chip a line above this, and a panel-level
               * warning listing four rules of which one is broken makes the
               * reader do the matching.
               *
               * Said rather than repaired. Deleting an element does not delete
               * the rule reading it — that would throw away work over a change
               * the designer may be about to undo — so the rule stays, answers
               * "don't know" forever, and the element falls through to its
               * Otherwise. All three of those are facts somebody has to be told
               * before they can decide which one they wanted.
               */
              <p className="pt-1 text-[10px] leading-relaxed text-[var(--danger,#dc2626)]">
                The element this reads is gone, so this can never hold —{' '}
                {node.name} stays {fallback}. Pick another source above, or remove the rule.
              </p>
            )}
          </div>
        );
      })}

      {rules.length > 0 && (
        <>
          <StyleRow label="Otherwise" hint="What it is when no rule matches — and what ships in the file">
            <TextInput
              className="flex-1"
              value={String(node.props.switchDefault ?? '')}
              placeholder="no state"
              onValueChange={(value) =>
                edit('Change the fallback state', (scene) => {
                  scene.props.switchDefault = slug(value);
                })
              }
            />
          </StyleRow>
          <StyleRow label="Named" hint="What this state is called, for rules that reach it from elsewhere">
            <TextInput
              className="flex-1"
              value={key}
              onValueChange={(value) =>
                useEditor.getState().transact('Rename the state', (draft) => {
                  ops.setStateKey(draft, node.id, value);
                })
              }
            />
          </StyleRow>
          {problem ? (
            <p className="rounded bg-[var(--danger-surface,rgba(220,38,38,0.08))] px-1.5 py-1 text-[10px] leading-relaxed text-[var(--danger,#dc2626)]">
              {problem}
            </p>
          ) : live ? (
            /*
             * The disclosure. A Test that cannot be answered until somebody
             * types has to travel to the browser, and so do the record values
             * it reads — which makes them public. That is a decision about
             * what the published application exposes, not an implementation
             * detail, so it is said here rather than discovered in a view
             * source.
             */
            <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
              This reads what is typed on the page, so it is worked out in the browser.
              {exposed.length > 0 && (
                <>
                  {' '}
                  Each row will carry <strong>{exposed.join(', ')}</strong> in the published file,
                  where anybody can read it.
                </>
              )}
            </p>
          ) : (
            <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
              Resolved when the site is published, so there is no script and nothing to wait for.
              Everything inside this element can be styled by the state too.
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * The handful of properties worth offering as a one-line effect, and the words
 * for them.
 *
 * Not every `StyleProp`. This row is a shortcut for the two or three things a
 * data-driven state usually does — fade it, tint it, put a line through it —
 * and a picker with a hundred entries would be a worse Conditions panel rather
 * than a quicker one. Anything else is a rule, written where rules are written.
 *
 * Typed as `StyleProp`, which it was not, and that omission was the whole bug:
 * the list carried `textDecorationLine`, a property the model does not have.
 * Nothing objected — the picker round-tripped it and the generator kebab-cases
 * whatever it is handed — so the effect *worked* while sitting outside the
 * closed set that `resolveValue`, the override badge and the row context menu
 * all key on. The Typography row and the rule were editing one visual through
 * two names, neither able to see the other. The annotation is the fix: a typo
 * now fails the build rather than shipping as a property.
 *
 * The words are here rather than derived, because `sets backgroundColor` is a
 * variable name on screen in a panel whose entire argument is that a rule reads
 * as a sentence.
 */
const EFFECT_PROPS: [prop: StyleProp, word: string][] = [
  ['opacity', 'how see-through it is'],
  ['color', 'the text colour'],
  ['backgroundColor', 'the background'],
  ['borderColor', 'the border colour'],
  ['textDecoration', 'the underline'],
];

/**
 * Form controls inside this node, by name.
 *
 * Inside, because that is the scope the interaction model gives a rule: it
 * evaluates against the node that owns it, and descendants react to the
 * resulting state. So the way to light up a submit button when a field is
 * filled is to put the rule on the form and style the button through the
 * state — not to reach across the page from the button, which is the
 * arbitrary targeting the model defers.
 */
/**
 * Every control on the page, whether or not it is inside this node.
 *
 * The other half of the source list, and the one that could not exist before
 * references did: a control here is offered by *node*, so the rule survives the
 * field being renamed and is cleared when the field is deleted. Named controls
 * inside the node stay on offer beside them — they are one string in the
 * document rather than a reference, which is the lighter thing to reach for
 * when the control really is a child.
 */
function controlsOnPage(
  nodes: Record<string, SceneNode>,
  rootId: string | undefined,
  exclude: SceneNode
): { id: string; name: string }[] {
  if (!rootId) return [];
  const inside = new Set<string>();
  const mark = (id: string, depth: number): void => {
    if (depth > 60) return;
    inside.add(id);
    for (const child of nodes[id]?.children ?? []) mark(child, depth + 1);
  };
  mark(exclude.id, 0);

  const out: { id: string; name: string }[] = [];
  const walk = (id: string, depth: number): void => {
    if (depth > 60) return;
    const node = nodes[id];
    if (!node) return;
    // Not the ones already offered as "what is typed" — the same control twice
    // under two spellings is a menu nobody can choose from.
    if (READABLE_TYPES.has(node.type) && !inside.has(id)) out.push({ id, name: node.name });
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(rootId, 0);
  return out;
}

/**
 * Those, plus any element the rules already read that is not among them.
 *
 * Because what is worth *offering* and what has to be *named* are different
 * questions, and `controlsOnPage` answers the first. It leaves out the node's
 * own descendants on purpose — they are offered as "what is typed" instead — so
 * a control that was picked from the page and has since been dragged inside
 * this node is a live, working reference that the offer list cannot label. Ask
 * the offer list to do the naming and that rule renders as unset and then gets
 * reported as broken, which is two lies about a rule that works.
 *
 * After this, a reference the sentence cannot name is one whose node is
 * genuinely not in the document — the same thing `danglingReads` reports, which
 * is what lets the chip and the warning underneath agree.
 */
function alsoAlreadyRead(
  offered: { id: string; name: string }[],
  rules: StateRule[],
  nodes: Record<string, SceneNode>
): { id: string; name: string }[] {
  const out = [...offered];
  for (const rule of rules) {
    for (const id of elementsRead(rule.when)) {
      if (out.some((one) => one.id === id)) continue;
      const found = nodes[id];
      if (found) out.push({ id, name: found.name });
    }
  }
  return out;
}

const READABLE_TYPES = new Set(['input', 'textarea', 'select', 'checkbox', 'radio', 'range', 'file']);

function namedControlsInside(nodes: Record<string, SceneNode>, root: SceneNode): string[] {
  const found: string[] = [];
  const walk = (id: string, depth: number): void => {
    if (depth > 40) return;
    const child = nodes[id];
    if (!child) return;
    const name = slug(child.props.name);
    if (name && !found.includes(name)) found.push(name);
    for (const grandchild of child.children) walk(grandchild, depth + 1);
  };
  for (const child of root.children) walk(child, 0);
  return found;
}

/* --------------------------------------------------------------------------
 * A number from the record, on a scale
 * ----------------------------------------------------------------------- */

/**
 * `price 0 → 1,000,000 becomes opacity 0.3 → 1`.
 *
 * Phase D, and the only value in the whole model that differs per row — which
 * is why it goes in the element's own style rather than into a rule. The
 * designer gets a name to paste into any style field, and from there it is
 * ordinary CSS: `opacity: var(--cre8-heat)`, written once, drawn a hundred
 * times with a hundred different numbers.
 */
function VarControls({ node, collection }: { node: SceneNode; collection: Collection }) {
  const vars = Object.entries(node.vars ?? {});
  const numbers = collection.fields.filter((f) => f.type === 'number');
  if (!numbers.length && !vars.length) return null;

  const write = (label: string, patch: (scene: SceneNode) => void) =>
    useEditor.getState().transact(label, (draft) => {
      const scene = draft.nodes[node.id];
      if (scene) patch(scene);
    });

  const add = () => {
    const field = numbers[0];
    if (!field) return;
    write('Add a live value', (scene) => {
      const key = uniqueVarKey(scene, field.key);
      scene.vars = {
        ...(scene.vars ?? {}),
        [key]: { value: { kind: 'field', key: field.key }, from: [0, 100], to: [0, 1] },
      };
    });
  };

  const edit = (key: string, patch: (spec: ValueVar) => void) =>
    write('Change a live value', (scene) => {
      const spec = scene.vars?.[key];
      if (spec) patch(spec);
    });

  return (
    <>
      <div className="flex items-center justify-between gap-2 pt-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
          <Gauge size={10} className="shrink-0" />
          <span>Numbers on a scale</span>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!numbers.length}
          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
        >
          + Value
        </button>
      </div>

      {!vars.length && (
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          {numbers.length
            ? 'Turn a number into something you can style with — an opacity, a width, a rotation.'
            : 'Add a number field to this collection to map one onto a scale.'}
        </p>
      )}

      {vars.map(([key, spec]) => (
        <div key={key} className="rounded border border-[var(--border-subtle)] p-1.5">
          <StyleRow label="Value">
            <Select
              className="flex-1"
              value={spec.value.kind === 'field' ? spec.value.key : ''}
              options={numbers.map((f) => ({ value: f.key, label: f.label }))}
              onChange={(next) => edit(key, (target) => (target.value = { kind: 'field', key: next }))}
            />
          </StyleRow>
          <StyleRow label="From" hint="The span of the data. Anything outside it is pinned to the nearest end.">
            <NumberPair
              value={spec.from}
              onChange={(pair) => edit(key, (target) => (target.from = pair))}
            />
          </StyleRow>
          <StyleRow label="Becomes">
            <NumberPair
              value={spec.to}
              onChange={(pair) => edit(key, (target) => (target.to = pair))}
            />
            <button
              type="button"
              title="Remove this value"
              onClick={() =>
                write('Remove a live value', (scene) => {
                  if (!scene.vars) return;
                  delete scene.vars[key];
                  if (!Object.keys(scene.vars).length) delete scene.vars;
                })
              }
              className="rounded px-1 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]"
            >
              <Trash2 size={11} />
            </button>
          </StyleRow>
          {/*
            The name, and the thing to do with it. Shown as the literal text to
            paste rather than explained, because "a CSS custom property" is not
            a sentence a designer should have to parse to fade a card.
          */}
          <p className="pt-0.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
            Use it in any style field as{' '}
            <code className="select-all font-mono text-[var(--text)]">{varReference(key)}</code> —
            one rule, a different number on every row.
          </p>
        </div>
      ))}
    </>
  );
}

/** Two numbers that mean a span. */
function NumberPair({
  value,
  onChange,
}: {
  value: [number, number];
  onChange: (pair: [number, number]) => void;
}) {
  const set = (at: 0 | 1, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const next: [number, number] = [value[0], value[1]];
    next[at] = n;
    onChange(next);
  };
  return (
    <>
      <TextInput
        width={72}
        inputMode="numeric"
        value={String(value[0])}
        onValueChange={(raw) => set(0, raw)}
      />
      <TextInput
        width={72}
        inputMode="numeric"
        value={String(value[1])}
        onValueChange={(raw) => set(1, raw)}
      />
    </>
  );
}

/** A name nothing on this node is already using. */
function uniqueVarKey(node: SceneNode, base: string): string {
  const taken = new Set(Object.keys(node.vars ?? {}));
  const root = slug(base) || 'value';
  if (!taken.has(root)) return root;
  for (let n = 2; n < 100; n++) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
  return `${root}-${taken.size + 1}`;
}

/* --------------------------------------------------------------------------
 * A page as a template
 * ----------------------------------------------------------------------- */

/**
 * Rendered by the Page panel rather than here, because it is a fact about the
 * page rather than about anything selected.
 */
export function PageRouteControls() {
  const page = useEditor((s) => s.doc.pages.find((p) => p.id === s.activePageId));
  const collections = useEditor((s) => s.doc.collections);
  const rows = useEditor((s) => (page?.dynamic ? s.records[page.dynamic.collection] : undefined));
  const designing = useEditor((s) =>
    page?.dynamic ? s.doc.settings.designRecord?.[page.dynamic.collection] : undefined
  );

  React.useEffect(() => {
    if (page?.dynamic) useEditor.getState().loadRecords(page.dynamic.collection);
  }, [page?.dynamic?.collection]);

  if (!page || !collections?.length) return null;
  const target = collections.find((c) => c.id === page.dynamic?.collection);
  const naming = target?.fields.find((f) => f.type === 'text') ?? target?.fields[0];

  return (
    <>
      <StyleRow label="One per" hint="Publish this page once per record, instead of once">
        <Select
          className="flex-1"
          value={page.dynamic?.collection ?? ''}
          options={[
            { value: '', label: 'Just this page' },
            ...collections.map((c) => ({ value: c.id, label: c.name })),
          ]}
          onChange={(collection) =>
            useEditor.getState().transact(collection ? 'Route this page' : 'Stop routing', (draft) => {
              const target = draft.pages.find((p) => p.id === page.id);
              if (!target) return;
              if (collection) target.dynamic = { collection };
              else delete target.dynamic;
            })
          }
        />
      </StyleRow>

      {page.dynamic && target && (
        <>
          <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
            Publishes to <code className="font-mono">/{page.slug}/…/</code>, one page per{' '}
            {target.name.toLowerCase().replace(/s$/, '')}, named by{' '}
            {target.fields.find((f) => f.key === target.slugField)?.label ?? 'its id'}.
          </p>

          {/*
            The same control `switchDesign` and the data panel's "Designing"
            offer, for the same reason: a template with nothing in scope is a
            page nobody can lay out. It never leaves the editor.
          */}
          <StyleRow label="Showing" hint="Which record the canvas draws this page against">
            <Select
              className="flex-1"
              value={designing ?? ''}
              options={[
                { value: '', label: rows?.length ? 'First record' : 'Placeholder text' },
                ...(rows ?? []).map((r) => ({
                  value: r.id,
                  label: String(r.data[naming?.key ?? ''] ?? '').trim() || 'Untitled',
                })),
              ]}
              onChange={(recordId) =>
                useEditor.getState().designAgainst(page.dynamic!.collection, recordId || null)
              }
            />
          </StyleRow>

          {rows?.length === 0 && (
            <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
              No records yet, so the canvas shows the text you typed. Add one in Collections and it
              appears here.
            </p>
          )}
        </>
      )}
    </>
  );
}
