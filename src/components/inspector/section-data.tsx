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
import { Database, Layers, Sparkles, Trash2 } from 'lucide-react';
import { uid } from '@/lib/document/id';
import * as ops from '@/lib/document/operations';
import { getElement, slug } from '@/lib/document/schema';
import {
  LIMITS,
  type Collection,
  type DatePattern,
  type CompareOp,
  type Field,
  type Format,
  type SceneNode,
  type StateRule,
  type StyleProp,
  type TestLiteral,
} from '@/lib/document/types';
import {
  DATE_PATTERNS,
  FORMAT_LABELS,
  defaultFormat,
  formatsFor,
  type FormatKind,
} from '@/lib/renderer/format';
import {
  OPS_FOR,
  OP_LABELS,
  fieldsRead,
  literalFor,
  literalText,
  needsOperand,
  needsRuntime,
  provablyOverlap,
  unfinished,
} from '@/lib/renderer/test';
import { isSettable } from '@/lib/renderer/variants';
import { useEditor } from '@/lib/editor/store';
import { Section, Select, TextInput } from '../ui/primitives';
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

      {offered.map((prop) => {
        const binding = node.bind?.[prop];
        const source = binding?.value.kind === 'field' ? binding.value.key : undefined;
        const field = collection.fields.find((f) => f.key === source);
        return (
          <React.Fragment key={prop}>
            <StyleRow label={prop === 'text' ? 'Text' : prop}>
              <Select
                className="flex-1"
                value={source ?? ''}
                options={[
                  { value: '', label: 'Typed here' },
                  ...collection.fields.map((f) => ({ value: f.key, label: f.label })),
                ]}
                onChange={(key) => setBinding(prop, key)}
              />
            </StyleRow>
            {binding && <FormatControls node={node} prop={prop} field={field} format={binding.format} />}
          </React.Fragment>
        );
      })}

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
 * How a bound value reads
 * ----------------------------------------------------------------------- */

/**
 * The format, and whatever that format needs to know.
 *
 * Indented under its binding rather than given a row of its own, because it is
 * a property of that binding and a flat list of six controls would not say so.
 * Nothing appears at all unless the field has a format worth offering — a
 * boolean has none, and neither does anything bound to `src`.
 */
function FormatControls({
  node,
  prop,
  field,
  format,
}: {
  node: SceneNode;
  prop: string;
  field: Field | undefined;
  format: Format | undefined;
}) {
  const kinds = formatsFor(prop, field);
  if (!kinds.length) return null;

  const write = (next: Format | undefined) =>
    useEditor.getState().transact('Change how this reads', (draft) => {
      const binding = draft.nodes[node.id]?.bind?.[prop];
      if (!binding) return;
      if (next) binding.format = next;
      else delete binding.format;
    });

  // Every option is spelled out against the same example value, so choosing is
  // reading rather than guessing what "Currency" will do to this field.
  const sample = SAMPLE[format?.kind ?? kinds[0]!];

  return (
    <div className="ml-2 border-l border-[var(--border-subtle)] pl-2">
      <StyleRow label="Reads as">
        <Select
          className="flex-1"
          value={format?.kind ?? ''}
          options={[
            { value: '', label: 'As written' },
            ...kinds.map((kind) => ({ value: kind, label: FORMAT_LABELS[kind] })),
          ]}
          onChange={(kind) => write(kind ? defaultFormat(kind as FormatKind) : undefined)}
        />
      </StyleRow>

      {format?.kind === 'currency' && (
        <StyleRow label="Symbol">
          <TextInput
            width={64}
            value={format.symbol ?? '$'}
            onValueChange={(symbol) => write({ ...format, symbol: symbol.slice(0, 4) })}
          />
          <Select
            className="flex-1"
            value={format.after ? 'after' : 'before'}
            options={[
              { value: 'before', label: `${format.symbol ?? '$'}1,234` },
              { value: 'after', label: `1,234${format.symbol ?? '$'}` },
            ]}
            onChange={(where) => write({ ...format, after: where === 'after' })}
          />
        </StyleRow>
      )}

      {(format?.kind === 'number' || format?.kind === 'currency' || format?.kind === 'percent') && (
        <StyleRow label="Decimals">
          <Select
            width={64}
            value={String(format.decimals ?? 0)}
            options={[0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(n) => write({ ...format, decimals: Number(n) })}
          />
          <Select
            className="flex-1"
            value={format.group === false ? 'plain' : 'grouped'}
            options={[
              { value: 'grouped', label: '1,234' },
              { value: 'plain', label: '1234' },
            ]}
            onChange={(how) => write({ ...format, group: how === 'grouped' })}
          />
        </StyleRow>
      )}

      {format?.kind === 'date' && (
        <StyleRow label="Pattern">
          <Select
            className="flex-1"
            value={format.pattern}
            options={DATE_PATTERNS.map((p) => ({ value: p.value, label: p.label }))}
            onChange={(pattern) => write({ ...format, pattern: pattern as DatePattern })}
          />
        </StyleRow>
      )}

      {format?.kind === 'case' && (
        <StyleRow label="Letters">
          <Select
            className="flex-1"
            value={format.to}
            options={[
              { value: 'upper', label: 'UPPERCASE' },
              { value: 'lower', label: 'lowercase' },
              { value: 'capitalize', label: 'Capitalise Each Word' },
            ]}
            onChange={(to) => write({ ...format, to: to as 'upper' | 'lower' | 'capitalize' })}
          />
        </StyleRow>
      )}

      {format?.kind === 'truncate' && (
        <StyleRow label="Length" hint="Cut at the nearest word, then add an ellipsis">
          <TextInput
            className="flex-1"
            value={String(format.chars)}
            inputMode="numeric"
            suffix="characters"
            onValueChange={(value) => {
              const n = Number(value);
              if (Number.isFinite(n) && n > 0) write({ ...format, chars: Math.floor(n) });
            }}
          />
        </StyleRow>
      )}

      {format && (
        <p className="pt-0.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
          {sample} — how it looks, not what it is. Sorting and filtering still use the value the
          record holds.
        </p>
      )}
    </div>
  );
}

/** One worked example per format, so the note under the picker is concrete. */
const SAMPLE: Record<FormatKind, string> = {
  number: '1234.5 reads as 1,235',
  currency: '1234.5 reads as $1,234.50',
  percent: '12.5 reads as 13%',
  date: '2026-08-11 reads as 11 August 2026',
  case: 'sold out reads as SOLD OUT',
  truncate: 'A long paragraph reads as its first few words…',
};

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
          when: {
            kind: 'compare',
            left: { kind: 'field', key: field.key },
            op: (OPS_FOR[field.type][0] ?? 'eq') as CompareOp,
            right: literalFor(field.type, ''),
          },
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
        const test = rule.when;
        const compare = test.kind === 'compare' ? test : null;
        const left = compare?.left;
        // A form control's value has no declared type, so it is treated as
        // text. A number typed into a box is a string until something says
        // otherwise, and inferring from the spelling is the thing the model
        // forbids — so the comparison is the one the field it is next to would
        // make, or text when there is no field.
        const field =
          left?.kind === 'field'
            ? collection.fields.find((f) => f.key === left.key)
            : left?.kind === 'input'
              ? TYPED_AS_TEXT
              : undefined;
        const operators = field ? OPS_FOR[field.type] : [];
        // Only against rules *before* this one: the warning is about which of
        // the two wins, and the answer is always "the later one", so it
        // belongs on the later one.
        const effect = ops.assignEffect(node, rule.id);
        const shadows =
          compare &&
          rules
            .slice(0, index)
            .filter((earlier) => provablyOverlap(earlier.when, compare))
            .map((earlier) => earlier.value)
            .filter(Boolean);

        return (
          <div key={rule.id} className="rounded border border-[var(--border-subtle)] p-1.5">
            <StyleRow label="When">
              <Select
                className="flex-1"
                value={left ? (left.kind === 'field' ? left.key : `${TYPED_PREFIX}${left.name}`) : ''}
                options={[
                  ...collection.fields.map((f) => ({ value: f.key, label: f.label })),
                  ...controls.map((name) => ({
                    value: `${TYPED_PREFIX}${name}`,
                    label: `${name} — what is typed`,
                  })),
                ]}
                onChange={(next) => {
                  const typed = next.startsWith(TYPED_PREFIX);
                  const picked = typed ? TYPED_AS_TEXT : collection.fields.find((f) => f.key === next);
                  if (!picked) return;
                  write(rule.id, (target) => {
                    // A new source means a new type, and an operator the new
                    // type cannot answer. Reset rather than carry it over.
                    target.when = {
                      kind: 'compare',
                      left: typed
                        ? { kind: 'input', name: next.slice(TYPED_PREFIX.length) }
                        : { kind: 'field', key: picked.key },
                      op: (OPS_FOR[picked.type][0] ?? 'eq') as CompareOp,
                      right: literalFor(picked.type, ''),
                    };
                  });
                }}
              />
            </StyleRow>

            <StyleRow label="">
              <Select
                className="flex-1"
                value={compare?.op ?? 'eq'}
                options={operators.map((op) => ({ value: op, label: OP_LABELS[op] }))}
                onChange={(op) =>
                  write(rule.id, (target) => {
                    if (target.when.kind !== 'compare') return;
                    target.when.op = op as CompareOp;
                    if (!needsOperand(op as CompareOp)) delete target.when.right;
                    else if (!target.when.right && field) {
                      target.when.right = literalFor(field.type, '');
                    }
                  })
                }
              />
              {compare && needsOperand(compare.op) && field && (
                <BooleanOrText
                  field={field}
                  literal={compare.right}
                  onChange={(raw) =>
                    write(rule.id, (target) => {
                      if (target.when.kind === 'compare') {
                        target.when.right = literalFor(field.type, raw);
                      }
                    })
                  }
                />
              )}
            </StyleRow>

            <StyleRow label="Becomes" hint="The state name you will style — “expensive”, “sold”">
              <TextInput
                className="flex-1"
                value={rule.value}
                placeholder="state name"
                onValueChange={(value) =>
                  useEditor.getState().transact('Rename a state', (draft) => {
                    ops.setAssignValue(draft, node.id, rule.id, value);
                  })
                }
              />
              <button
                type="button"
                title="Remove this rule"
                onClick={() =>
                  useEditor.getState().transact('Remove a state rule', (draft) => {
                    ops.removeAssign(draft, node.id, rule.id);
                  })
                }
                className="rounded px-1 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]"
              >
                <Trash2 size={11} />
              </button>
            </StyleRow>

            {/*
              And what that state does, if the designer wants it said here.
              Writing a rule from this row is a shortcut, not a mechanism: it
              produces exactly the rule they would have built in Conditions,
              and Conditions still owns it afterwards.
            */}
            <StyleRow label="And" hint="A shortcut for the rule you would otherwise write by hand">
              <Select
                className="flex-1"
                value={effect.kind === 'style' ? `p:${effect.prop}` : effect.kind}
                options={[
                  { value: 'state', label: 'nothing — I will style it' },
                  { value: 'hide', label: 'hide this element' },
                  { value: 'show', label: 'show this element' },
                  ...EFFECT_PROPS.map((prop) => ({ value: `p:${prop}`, label: `set ${prop}` })),
                ]}
                onChange={(next) =>
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
                            value: effect.kind === 'style' && effect.prop === prop ? effect.value : '',
                          }
                        : { kind: next as 'state' | 'hide' | 'show' }
                    );
                  })
                }
              />
              {effect.kind === 'style' && (
                <TextInput
                  width={92}
                  value={effect.value}
                  placeholder="value"
                  onValueChange={(value) =>
                    useEditor.getState().transact('Change what a state does', (draft) => {
                      ops.setAssignEffect(draft, node.id, rule.id, {
                        kind: 'style',
                        prop: effect.prop,
                        value,
                      });
                    })
                  }
                />
              )}
            </StyleRow>

            {effect.kind === 'hide' && (
              /*
               * The disclosure that matters most, said where the decision is
               * made. Hiding is CSS, which is what makes it work with no
               * script and before first paint — and it means the row is in the
               * file. For a sold house that is fine; for something that should
               * not be published at all, a filter on the repeater is the
               * honest tool and this is not.
               */
              <p className="pt-0.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
                Hidden with CSS, so the content is still in the published file. To keep a record off
                the page entirely, filter the list instead.
              </p>
            )}

            {shadows && shadows.length > 0 && (
              <p className="pt-0.5 text-[10px] leading-relaxed text-[var(--warning,#d97706)]">
                This can be true at the same time as {shadows.join(', ')}. When both hold, this one
                wins — it is later in the list.
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
 * The handful of properties worth offering as a one-line effect.
 *
 * Not every `StyleProp`. This row is a shortcut for the two or three things a
 * data-driven state usually does — fade it, tint it, put a line through it —
 * and a picker with a hundred entries would be a worse Conditions panel rather
 * than a quicker one. Anything else is a rule, written where rules are written.
 */
const EFFECT_PROPS = ['opacity', 'color', 'backgroundColor', 'borderColor', 'textDecorationLine'] as const;

/** Marks a source that is read as text: a form control, which declares no type. */
const TYPED_PREFIX = 'typed:';
const TYPED_AS_TEXT: Field = { key: '', label: 'Typed', type: 'text' };

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

/** A checkbox field gets true/false; everything else gets a box to type in. */
function BooleanOrText({
  field,
  literal,
  onChange,
}: {
  field: Field;
  literal: TestLiteral | undefined;
  onChange: (raw: string) => void;
}) {
  if (field.type === 'boolean') {
    return (
      <Select
        width={92}
        value={literalText(literal) === 'true' ? 'true' : 'false'}
        options={[
          { value: 'true', label: 'ticked' },
          { value: 'false', label: 'not ticked' },
        ]}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'select' && field.options?.length) {
    return (
      <Select
        className="flex-1"
        value={literalText(literal)}
        options={field.options.map((option) => ({ value: option, label: option }))}
        onChange={onChange}
      />
    );
  }
  return (
    <TextInput
      className="flex-1"
      value={literalText(literal)}
      inputMode={field.type === 'number' ? 'numeric' : undefined}
      placeholder={field.type === 'number' ? '0' : 'value'}
      onValueChange={onChange}
    />
  );
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
