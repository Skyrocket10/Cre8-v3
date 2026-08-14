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
import {
  CONTROL_LABELS,
  conditionOffers,
  controlPseudosFor,
  offerGroups,
  type ControlPseudo,
} from '@/lib/document/conditions';
import { eachCondition, replaceCondition, unreachable } from '@/lib/document/when';
import { stateKeyOf, stateOf } from '@/lib/document/state';
import { slug, slugList } from '@/lib/document/schema';
import type { Condition, ElementType, Field, StyleRule, Test } from '@/lib/document/types';
import { DATA_SOURCES, QUERY_PREFIX, describeSource } from '@/lib/runtime/data';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { Popover, Section, Segmented, Select, TextInput, Tooltip } from '../ui/primitives';
import { Sentence, partsToText } from '../ui/sentence';
import { ruleSentence, testSentence } from './sentences';
import { InspectorGroup, StyleRow } from './controls';
import { collectionInScope } from './section-data';

/** One array, so a node with no record in scope does not re-render the panel. */
const EMPTY_FIELDS: Field[] = [];

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
      const key = stateKeyOf(s.doc.nodes[ownerId]);
      if (!key || seen.has(key)) return;
      seen.add(key);
      // What the state can be: what it ships as, and every value a control
      // sets it to. Read off the tree rather than declared anywhere, so the
      // list cannot fall out of step with the nodes.
      const values: string[] = [];
      const add = (raw: unknown) => {
        for (const v of slugList(raw).split(' ')) if (v && !values.includes(v)) values.push(v);
      };
      // Declared first, then whatever a control sets that the declaration
      // has not heard of. What somebody wrote down leads the menu.
      for (const one of stateOf(s.doc.nodes[ownerId])?.values ?? []) add(one);
      add(stateOf(s.doc.nodes[ownerId])?.initial);
      for (const id of collectSubtree(s.doc.nodes, ownerId)) {
        const node = s.doc.nodes[id];
        if (node) add(valuesSetting(node, key).join(' '));
        for (const rule of s.doc.nodes[id]?.rules ?? []) {
          eachCondition(rule.when, (condition) => {
            if (condition.kind === 'state' && (!condition.key || condition.key === key)) {
              add(condition.values.join(' '));
            }
          });
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
  const type = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.type : undefined;
  });
  // Recomputed from the type alone, which is the only thing it depends on —
  // built inside the selector it would be a fresh array on every store update
  // and re-render the panel for an edit three sections away.
  const controls = useMemo(() => (type ? controlPseudosFor(type) : []), [type]);
  /*
   * The record's fields, when this element sits inside one.
   *
   * The same walk the Data section does and by the same function, because a
   * panel that disagreed with the canvas about which record is in scope would
   * be worse than no panel — and here it would be worse still: a comparison
   * against a field that is not really in scope compiles to an attribute
   * nothing ever sets.
   */
  const fields = useEditor((s) => {
    const id = s.selection[0];
    const node = id ? s.doc.nodes[id] : undefined;
    if (!node || !s.doc.collections?.length) return EMPTY_FIELDS;
    const page = s.doc.pages.find((one) => one.id === s.activePageId);
    const scope = collectionInScope(s.doc.nodes, node, s.doc.collections, page?.dynamic?.collection);
    return scope?.fields ?? EMPTY_FIELDS;
  });

  const list = rules ?? [];

  return (
    <Section title="States & conditions" defaultOpen={list.length > 0}>
      <InspectorGroup>
        {list.length === 0 && (
          <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">
            Change how this looks when something is true — pointed at, ticked, filled in wrongly, or
            while a state you named holds a value.
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
            controls={controls}
            fields={fields}
          />
        ))}

        {type && <AddCondition type={type} states={states} fields={fields} />}
      </InspectorGroup>
    </Section>
  );
}

/**
 * One menu holding the whole condition vocabulary.
 *
 * It was five buttons in a wrapping row, offering four of the eleven shapes
 * `css.ts` compiles. Eleven buttons would be four lines of chips in a 280px
 * panel before the rules themselves start, so the row becomes a menu — the
 * same shape the section list settled on, and for the same reason: the choices
 * are worth having and not worth looking at until you want one.
 *
 * The menu is also where the hints live. "Ticked" needs none; the difference
 * between *focused* and *focused by keyboard* is the whole reason a designer
 * picks one over the other, and a chip label has nowhere to explain it.
 */
function AddCondition({
  type,
  states,
  fields,
}: {
  type: ElementType;
  states: { key: string; values: string[] }[];
  fields: Field[];
}) {
  const offers = useMemo(
    () => conditionOffers({ type, states, fields }),
    [type, states, fields]
  );
  const groups = offerGroups(offers);

  return (
    <div className="pt-0.5">
      <Popover
        align="start"
        trigger={({ toggle, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            className="flex h-[24px] items-center gap-1 rounded-md bg-[var(--field)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--field-hover)] hover:text-[var(--text)]"
          >
            <Plus size={10} />
            When…
          </button>
        )}
      >
        {/* Closes on a pick, so the rule it just added is not underneath the
            menu that added it. */}
        {(close) => (
          <div className="max-h-[380px] w-[244px] overflow-y-auto p-1">
            {groups.map((group) => (
              <div key={group}>
                <div className="panel-group px-2 pt-2 pb-1">{group}</div>
                {offers
                  .filter((offer) => offer.group === group)
                  .map((offer) => (
                  <button
                    key={offer.key}
                    type="button"
                    onClick={() => {
                      useEditor.getState().addRule(offer.when, offer.part);
                      close();
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--field)]"
                  >
                    <span className="text-[11.5px] font-medium text-[var(--text)]">
                      {offer.label}
                    </span>
                    <span className="text-[10.5px] leading-snug text-[var(--text-faint)]">
                      {offer.hint}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

function RuleRow({
  rule,
  active,
  first,
  last,
  states,
  controls,
  fields,
}: {
  rule: StyleRule;
  active: boolean;
  first: boolean;
  last: boolean;
  states: { key: string; values: string[] }[];
  controls: ControlPseudo[];
  fields: Field[];
}) {
  const store = useEditor.getState;

  /*
   * What the sentence cannot say for itself.
   *
   * Three readings off the same tree: which data sources need their own form,
   * whether to mention that several values mean any of them, and whether the
   * rule can ever apply at all. All three used to be per-row decisions in a
   * loop over a flat list; a tree has no rows, so they are answered once for
   * the whole rule.
   */
  const conditions = useMemo(() => {
    const found: Condition[] = [];
    eachCondition(rule.when, (condition) => found.push(condition));
    return found;
  }, [rule.when]);
  const dataConditions = conditions.filter(
    (one): one is Extract<Condition, { kind: 'data' }> => one.kind === 'data'
  );
  const hasState = conditions.some((one) => one.kind === 'state');
  const dead = conditions.find(
    (one) => one.kind === 'control' && !controls.includes(one.pseudo)
  );
  const warning =
    unreachable(rule.when) ??
    (dead?.kind === 'control'
      ? // Not a warning about something the designer typed — the panel would
        // not have offered it. It is a rule that was fine when it was written
        // and is not any more, usually because the element changed under it.
        `This kind of element is never ${CONTROL_LABELS[dead.pseudo]}, so this rule cannot apply.`
      : null);

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

      {active && (
        <div className="border-t border-[var(--border-soft)]">
          {!rule.when && (
            <p className="px-2 py-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
              {rule.part
                ? `Always, on the ${rule.part}.`
                : 'Always — nothing has to be true for this to apply.'}
            </p>
          )}

          {rule.when && (
            <div className="flex flex-col gap-1.5 px-2 py-2">
              {/*
                One sentence for the whole condition, however deep it goes.
                This was a loop over a flat list rendering one row each, which
                could say "hovered and annual" and had no way to say "hovered
                or annual" — the tree was in the model and in the generator and
                stopped at the panel.
              */}
              <Sentence
                parts={testSentence({
                  test: rule.when,
                  /*
                   * The record's fields, so a comparison already on the rule
                   * renders as a sentence rather than as an unnamed chip. What
                   * "+ condition" adds is still a browser condition — a
                   * comparison is reached from the When… menu, where it sits
                   * beside everything else that can be true.
                   */
                  fields,
                  states,
                  controlStates: controls,
                  newLeaf: () => ({ kind: 'pointer', pseudo: 'hover' }),
                  opening: 'When',
                  onChange: (next: Test) => store().updateRule(rule.id, { when: next }),
                })}
              />
              {warning && (
                <p className="text-[10px] leading-relaxed text-[var(--warning,var(--text-faint))]">
                  {warning}
                </p>
              )}
              {hasState && (
                <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
                  More than one value, separated by spaces, means any of them.
                </p>
              )}
            </div>
          )}

          {/*
            A data condition keeps its labelled form *as well* as its place in
            the sentence, because two of its controls are not about this rule
            at all: what the file ships with and what the canvas designs
            against are settings on the source, shared by every rule that reads
            it. Folding those into a chip would be a sentence that lies about
            its scope.
          */}
          {dataConditions.map((condition, index) => (
            <DataFields key={index} rule={rule} condition={condition} divide />
          ))}
        </div>
      )}
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
  divide,
}: {
  rule: StyleRule;
  condition: Extract<Condition, { kind: 'data' }>;
  /** A separator above, when this is not the rule's first condition. */
  divide?: boolean;
}) {
  const store = useEditor.getState;
  const config = useEditor((s) => s.doc.settings.data?.[condition.source]);
  const source = describeSource(condition.source);
  const open = source ? source.values.length === 0 : true;

  const setCondition = (patch: Partial<Extract<Condition, { kind: 'data' }>>) => {
    if (!rule.when) return;
    store().updateRule(rule.id, {
      when: replaceCondition(rule.when, condition, { ...condition, ...patch }),
    });
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 px-2 py-2',
        divide && 'border-t border-[var(--border-subtle)]'
      )}
    >
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
