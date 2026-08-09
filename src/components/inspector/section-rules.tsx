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
import { slug, slugList } from '@/lib/document/schema';
import type { Condition, StyleRule } from '@/lib/document/types';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { Section, Segmented, Select, TextInput, Tooltip } from '../ui/primitives';
import { InspectorGroup, StyleRow } from './controls';

/** A rule as a sentence, for the row and for the "editing" banner. */
export function describeRule(rule: StyleRule): string {
  const parts = rule.when.map((condition) => {
    switch (condition.kind) {
      case 'pointer':
      case 'control':
        return condition.pseudo === 'focus-visible' ? 'Focused' : title(condition.pseudo);
      case 'attr':
        return `${condition.name} ${condition.op === 'is' ? 'is' : 'isn’t'} ${condition.values.join(' or ')}`;
      case 'state':
        return `${condition.key || 'state'} ${condition.op === 'is' ? 'is' : 'isn’t'} ${condition.values.join(' or ')}`;
    }
  });
  const where = rule.part ? ` · ${rule.part}` : '';
  if (parts.length === 0) return `Always${where}`;
  return `${parts.join(' and ')}${where}`;
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

const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
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
        add(s.doc.nodes[id]?.props.switchSet);
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
  const chosen = states.find((s) => s.key === (condition?.kind === 'state' ? condition.key : ''));

  const setCondition = (patch: Partial<Extract<Condition, { kind: 'state' }>>) => {
    if (condition?.kind !== 'state') return;
    store().updateRule(rule.id, {
      when: rule.when.map((c) => (c === condition ? { ...condition, ...patch } : c)),
    });
  };

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
          <StyleRow label="State" labelWidth={48}>
            <Select
              className="flex-1"
              value={condition.key || states[0]?.key || ''}
              onChange={(key) => setCondition({ key })}
              options={states.map((state) => ({
                value: state.key,
                label: state.key,
                hint: state.values.join(' ') || undefined,
              }))}
            />
          </StyleRow>
          <StyleRow label="Is" labelWidth={48}>
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
          <StyleRow label="Value" labelWidth={48}>
            <TextInput
              className="flex-1"
              value={condition.values.join(' ')}
              onValueChange={(raw) => {
                const values = slugList(raw).split(' ').filter(Boolean);
                if (values.length) setCondition({ values });
              }}
              placeholder={chosen?.values.join(' ') || 'annual'}
            />
          </StyleRow>
          <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
            More than one value, separated by spaces, means any of them.
          </p>
        </div>
      )}
    </div>
  );
}
