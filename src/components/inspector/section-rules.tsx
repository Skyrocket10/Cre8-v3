'use client';

/**
 * States and conditions.
 *
 * One list where there used to be four mechanisms — hover, `::backdrop`, the
 * selected-option style and visibility all compiled to the same shape and were
 * authored four different ways. The sentence a designer already knows, *when
 * hovered, change the background*, now extends to states they name
 * themselves: when plan is Pro, when the menu is open, when the filter isn't
 * Everything.
 *
 * Two things this panel has to make obvious, because getting either wrong is
 * silent:
 *
 *   which rule the style fields are writing into — there can be any number of
 *     them now, not two;
 *   what order they are in, because order *is* precedence.
 */

import React, { useMemo } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { collectSubtree } from '@/lib/document/tree';
import { valuesSetting } from '@/lib/document/actions';
import { slug, slugList } from '@/lib/document/schema';
import type { Condition, StyleRule } from '@/lib/document/types';
import { DATA_SOURCES, QUERY_PREFIX, describeSource } from '@/lib/runtime/data';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { Section, Segmented, Select, TextInput, Tooltip } from '../ui/primitives';
import { Sentence, partsToText } from '../ui/sentence';
import { conditionSentence, ruleSentence } from './sentences';
import { InspectorGroup, StyleRow } from './controls';

/**
 * A rule as a sentence, for the row and for the "editing" banner.
 *
 * The string form of the same parts the row renders and the controls below it
 * edit. It used to be a switch of its own, written next to the controls and
 * free to drift from them — a heading that said "Hovered" over a panel that
 * said "hover" is the small version of that, and "state is annual" over a
 * control set to something else is the large one.
 */
export function describeRule(rule: StyleRule): string {
  return partsToText(ruleSentence(rule));
}

/** What a rule changes, in the shortest form that is still true. */
function summarise(rule: StyleRule): string {
  const keys = Object.keys(rule.apply);
  // Content first, because it is the one with a cost the designer should be
  // able to see: it makes the element ship twice.
  const content = Object.keys(rule.set ?? {}).map(readable);
  if (keys.length === 0) return content.length ? content.join(', ') : 'no changes yet';
  // A rule that only hides is the common one, and reading it back as
  // "display" would make the designer translate it every time.
  if (keys.length === 1 && (keys[0] === 'display' || keys[0] === 'visibility')) {
    return rule.apply.display === 'none' || rule.apply.visibility === 'hidden' ? 'Hidden' : 'Shown';
  }
  return [...content, ...keys.slice(0, 3).map(readable)].join(', ') + (keys.length > 3 ? '…' : '');
}

const readable = (prop: string) => prop.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`);

const FIELD = '\u0000';
const ENTRY = '\u0001';

/**
 * Every state the selected node can talk about, nearest first.
 *
 * Nearest first because that is the one a condition means when it does not
 * say. Exported because the setter control in Content needs the same list —
 * one walk of the tree, so the two panels cannot disagree about what a state
 * can be.
 */
export function useStatesInScope(): { key: string; values: string[] }[] {
  const encoded = useEditor((s) => {
    const nodeId = s.selection[0];
    if (!nodeId) return '';
    const found: string[] = [];
    const seen = new Set<string>();

    const collect = (ownerId: string) => {
      const key = slug(s.doc.nodes[ownerId]?.props.switchKey);
      if (!key || seen.has(key)) return;
      seen.add(key);
      // What the state can be: what it ships as, and every value a control
      // sets it to. Read off the tree rather than declared anywhere, so the
      // list cannot fall out of step with the nodes.
      const values: string[] = [];
      const add = (raw: unknown) => {
        for (const v of slugList(raw).split(' ')) if (v && !values.includes(v)) values.push(v);
      };
      add(s.doc.nodes[ownerId]?.props.switchDefault);
      for (const id of collectSubtree(s.doc.nodes, ownerId)) {
        const node = s.doc.nodes[id];
        if (node) add(valuesSetting(node, key).join(' '));
        for (const rule of s.doc.nodes[id]?.rules ?? []) {
          for (const condition of rule.when) {
            if (condition.kind === 'state' && (!condition.key || condition.key === key)) {
              add(condition.values.join(' '));
            }
          }
        }
      }
      found.push(`${key}${FIELD}${values.join(' ')}`);
    };

    // Itself first: a node that declares a state can depend on it, which is
    // what a dismissible banner is.
    collect(nodeId);
    let current = s.doc.nodes[nodeId]?.parentId;
    let guard = 0;
    while (current && guard++ < 200) {
      collect(current);
      current = s.doc.nodes[current]?.parentId ?? undefined;
    }
    // A page-level state is in scope for everything, whether or not the
    // selection happens to sit under it.
    const root = activeRootId(s);
    if (root) collect(root);
    return found.join(ENTRY);
  });

  return useMemo(() => {
    if (!encoded) return [];
    return encoded.split(ENTRY).map((entry) => {
      const [key = '', values = ''] = entry.split(FIELD);
      return { key, values: values ? values.split(' ') : [] };
    });
  }, [encoded]);
}

/**
 * Continuous values the selection sits inside, nearest first.
 *
 * Ancestors only, unlike `useStatesInScope`, which starts with the node
 * itself. A node cannot drive the value it declares: the driver is a slider
 * and the group is the box the slider sits in, so the two are never the same
 * element — and offering it would be offering to write a custom property onto
 * the very element whose value it reads.
 *
 * Encoded into a string for the same reason the states hook does it: a fresh
 * array out of a zustand selector re-renders the panel on every store update.
 */
export function useRangesInScope(): string[] {
  const encoded = useEditor((s) => {
    const nodeId = s.selection[0];
    if (!nodeId) return '';
    const found: string[] = [];

    let current = s.doc.nodes[nodeId]?.parentId;
    let guard = 0;
    while (current && guard++ < 200) {
      const key = slug(s.doc.nodes[current]?.props.rangeKey);
      if (key && !found.includes(key)) found.push(key);
      current = s.doc.nodes[current]?.parentId ?? undefined;
    }
    return found.join(' ');
  });

  return useMemo(() => (encoded ? encoded.split(' ') : []), [encoded]);
}

export function RulesSection() {
  const rules = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.rules : undefined;
  });
  const activeRuleId = useEditor((s) => s.activeRuleId);
  const states = useStatesInScope();
  const canBackdrop = useEditor((s) => {
    const id = s.selection[0];
    const type = id ? s.doc.nodes[id]?.type : undefined;
    return type === 'dialog' || type === 'popover';
  });

  const list = rules ?? [];

  return (
    <Section title="States & conditions" defaultOpen={list.length > 0}>
      <InspectorGroup>
        {list.length === 0 && (
          <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">
            Change how this looks when something is true — pointed at, or while a state you named
            holds a value.
          </p>
        )}

        {list.map((rule, index) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            active={rule.id === activeRuleId}
            first={index === 0}
            last={index === list.length - 1}
            states={states}
          />
        ))}

        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <AddButton
            label="Hover"
            onClick={() => useEditor.getState().addRule([{ kind: 'pointer', pseudo: 'hover' }])}
          />
          <AddButton
            label="Focus"
            onClick={() =>
              useEditor.getState().addRule([{ kind: 'pointer', pseudo: 'focus-visible' }])
            }
          />
          {states.length > 0 && (
            <AddButton
              label="State…"
              onClick={() =>
                useEditor.getState().addRule([
                  {
                    kind: 'state',
                    key: states[0]!.key,
                    op: 'is',
                    values: [states[0]!.values[0] ?? 'on'],
                  },
                ])
              }
            />
          )}
          <AddButton
            label="Visit…"
            onClick={() =>
              useEditor.getState().addRule([
                {
                  kind: 'data',
                  source: DATA_SOURCES[0]!.id,
                  op: 'is',
                  values: [DATA_SOURCES[0]!.values[0]!],
                },
              ])
            }
          />
          {canBackdrop && (
            <AddButton
              label="Backdrop"
              onClick={() => useEditor.getState().addRule([], 'backdrop')}
            />
          )}
        </div>
      </InspectorGroup>
    </Section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[24px] items-center gap-1 rounded-md bg-[var(--field)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--field-hover)] hover:text-[var(--text)]"
    >
      <Plus size={10} />
      {label}
    </button>
  );
}

function RuleRow({
  rule,
  active,
  first,
  last,
  states,
}: {
  rule: StyleRule;
  active: boolean;
  first: boolean;
  last: boolean;
  states: { key: string; values: string[] }[];
}) {
  const store = useEditor.getState;
  const condition = rule.when.find((c) => c.kind === 'state');
  const data = rule.when.find((c) => c.kind === 'data');

  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        active
          ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
          : 'border-[var(--border-soft)] bg-[var(--field)]'
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => store().setActiveRule(active ? null : rule.id)}
          className="flex min-w-0 flex-1 flex-col items-start text-left"
        >
          <span
            className={cn(
              'truncate text-[11.5px] font-medium',
              active ? 'text-[var(--accent)]' : 'text-[var(--text)]'
            )}
          >
            {describeRule(rule)}
          </span>
          <span className="truncate text-[10px] text-[var(--text-faint)]">{summarise(rule)}</span>
        </button>

        {/* Order is precedence, so it has to be movable and visible. */}
        <Tooltip content="Applies earlier" side="left">
          <button
            type="button"
            disabled={first}
            onClick={() => store().moveRule(rule.id, -1)}
            className="shrink-0 rounded p-0.5 text-[var(--text-faint)] transition-colors hover:text-[var(--text)] disabled:opacity-25"
          >
            <ChevronUp size={11} />
          </button>
        </Tooltip>
        <Tooltip content="Applies later, so it wins" side="left">
          <button
            type="button"
            disabled={last}
            onClick={() => store().moveRule(rule.id, 1)}
            className="shrink-0 rounded p-0.5 text-[var(--text-faint)] transition-colors hover:text-[var(--text)] disabled:opacity-25"
          >
            <ChevronDown size={11} />
          </button>
        </Tooltip>
        <Tooltip content="Remove" side="left">
          <button
            type="button"
            onClick={() => store().removeRule(rule.id)}
            className="shrink-0 rounded p-0.5 text-[var(--text-faint)] transition-colors hover:text-[var(--danger,var(--text))]"
          >
            <Trash2 size={11} />
          </button>
        </Tooltip>
      </div>

      {active && condition?.kind === 'state' && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--border-soft)] px-2 py-2">
          {/*
            The same sentence the heading above shows, with handlers. Three
            labelled rows said the same thing in a shape a reader had to
            reassemble — and the heading was a second description of it,
            written separately and free to disagree.
          */}
          <Sentence
            parts={[
              { kind: 'word', text: 'When', key: 'when' },
              ...conditionSentence({
                condition,
                states,
                onChange: (next: Condition) =>
                  store().updateRule(rule.id, {
                    when: rule.when.map((c) => (c === condition ? next : c)),
                  }),
              }),
            ]}
          />
          <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
            More than one value, separated by spaces, means any of them.
          </p>
        </div>
      )}

      {active && data?.kind === 'data' && <DataFields rule={rule} condition={data} />}
    </div>
  );
}

/**
 * A condition on the visit rather than on the page.
 *
 * Three controls, and the second two are the ones that matter. What a source
 * *is* the resolver decides; what the file **ships** with is a design decision,
 * because that is what a visitor sees for the instant before the resolver runs
 * and for ever if they have no scripting. What the canvas is **designing
 * against** never leaves the editor, exactly like a switch's design-time case.
 */
/**
 * Site-wide, not per-rule: two rules on the same source must agree about what
 * ships, or the file would have to carry the attribute twice.
 */
function configure(source: string, patch: { ships?: string; designing?: string }): void {
  useEditor.getState().transact('Data source', (draft) => {
    const data = (draft.settings.data ??= {});
    data[source] = { ...data[source], ...patch };
  });
}

function DataFields({
  rule,
  condition,
}: {
  rule: StyleRule;
  condition: Extract<Condition, { kind: 'data' }>;
}) {
  const store = useEditor.getState;
  const config = useEditor((s) => s.doc.settings.data?.[condition.source]);
  const source = describeSource(condition.source);
  const open = source ? source.values.length === 0 : true;

  const setCondition = (patch: Partial<Extract<Condition, { kind: 'data' }>>) => {
    store().updateRule(rule.id, {
      when: rule.when.map((c) => (c === condition ? { ...condition, ...patch } : c)),
    });
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--border-soft)] px-2 py-2">
      <StyleRow label="About" labelWidth={62}>
        <Select
          className="flex-1"
          value={DATA_SOURCES.some((s) => s.id === condition.source) ? condition.source : 'query'}
          onChange={(id) => {
            if (id === 'query') {
              setCondition({ source: `${QUERY_PREFIX}ref`, values: ['acme'] });
              return;
            }
            const next = describeSource(id);
            setCondition({ source: id, values: [next?.values[0] ?? 'yes'] });
          }}
          options={[
            ...DATA_SOURCES.map((s) => ({ value: s.id, label: s.label, hint: s.hint })),
            { value: 'query', label: 'A link parameter', hint: '?ref=acme' },
          ]}
        />
      </StyleRow>

      {open && (
        <StyleRow label="Parameter" labelWidth={62}>
          <TextInput
            className="flex-1"
            value={condition.source.replace(QUERY_PREFIX, '')}
            onValueChange={(raw) => {
              const name = slug(raw);
              if (name) setCondition({ source: `${QUERY_PREFIX}${name}` });
            }}
            placeholder="ref"
          />
        </StyleRow>
      )}

      <StyleRow label="Is" labelWidth={62}>
        <Segmented
          full
          value={condition.op}
          onChange={(op) => setCondition({ op: op as 'is' | 'isNot' })}
          options={[
            { value: 'is', label: 'is' },
            { value: 'isNot', label: 'isn’t' },
          ]}
        />
      </StyleRow>

      <StyleRow label="Value" labelWidth={62}>
        {source && source.values.length > 0 ? (
          <Select
            className="flex-1"
            value={condition.values[0] ?? source.values[0]!}
            onChange={(value) => setCondition({ values: [value] })}
            options={source.values.map((value) => ({ value, label: value }))}
          />
        ) : (
          <TextInput
            className="flex-1"
            value={condition.values.join(' ')}
            onValueChange={(raw) => {
              const values = slugList(raw).split(' ').filter(Boolean);
              if (values.length) setCondition({ values });
            }}
            placeholder="acme"
          />
        )}
      </StyleRow>

      {source && source.values.length > 0 && (
        <>
          <StyleRow label="Ships as" labelWidth={62} hint="Before the page resolves it, and for ever with no scripting">
            <Select
              className="flex-1"
              value={config?.ships ?? source.fallback}
              onChange={(value) => configure(condition.source, { ships: value })}
              options={source.values.map((value) => ({ value, label: value }))}
            />
          </StyleRow>
          <StyleRow label="Designing" labelWidth={62} hint="What the canvas shows. Never published">
            <Select
              className="flex-1"
              value={config?.designing || config?.ships || source.fallback}
              onChange={(value) => configure(condition.source, { designing: value })}
              options={source.values.map((value) => ({ value, label: value }))}
            />
          </StyleRow>
        </>
      )}

      <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
        {open
          ? 'Absent unless the link carries it — so the base version is what most visitors get.'
          : 'Resolved before the page paints, so nothing flashes. No storage, nothing to consent to.'}
      </p>
    </div>
  );
}
