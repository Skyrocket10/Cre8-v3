'use client';

/**
 * Turning an expression into a sentence.
 *
 * One builder per grammar, and each returns `Part[]` rather than markup — so
 * the same function serves the editor and every place that only needs to *say*
 * what a rule does. Given handlers the parts are chips; given none they are
 * prose. A tooltip and the panel cannot describe a Test differently, because
 * there is only one description.
 *
 * The grammars this covers are the same shape three times over, which is the
 * reason the builders live together rather than inside the panels that use
 * them:
 *
 *   a Test          field · operator · value
 *   a record filter field · operator · value
 *   a condition     state · operator · values
 *
 * They were three different arrangements of labelled rows before this file
 * existed, and a designer had no reason to believe they were the same idea.
 */

import React from 'react';
import { Trash2 } from 'lucide-react';
import type {
  Binding,
  CompareOp,
  Condition,
  DatePattern,
  Field,
  Format,
  RecordFilter,
  StyleRule,
  Test,
} from '@/lib/document/types';
import { slugList } from '@/lib/document/schema';
import {
  CONTROL_HINTS,
  CONTROL_LABELS,
  POINTER_HINTS,
  POINTER_LABELS,
  attrName,
  attrValue,
  type ControlPseudo,
  type PointerPseudo,
} from '@/lib/document/conditions';
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
  literalFor,
  literalText,
  needsOperand,
  simplify,
} from '@/lib/renderer/test';
import { describeSource } from '@/lib/runtime/data';
import type { Part } from '../ui/sentence';

/** The one field type a form control's value is read as: text, undeclared. */
const AS_TEXT: Field = { key: '', label: 'Typed', type: 'text' };

/**
 * `When ⟨Price⟩ ⟨is over⟩ ⟨500000⟩`.
 *
 * @param onChange Absent for the read-only projection.
 */
export function testSentence(options: {
  test: Test;
  fields: Field[];
  /** Named form controls inside the node, offered alongside the record's fields. */
  controls?: string[];
  /**
   * Controls anywhere on the page, by node.
   *
   * Offered beside the two above because to the person writing the sentence
   * they are the same kind of thing — something on the page that holds a
   * value. What differs is underneath: this one survives a rename and dies
   * with the element.
   */
  elements?: { id: string; name: string }[];
  /** States a condition leaf may name, for the rules panel. */
  states?: { key: string; values: string[] }[];
  /**
   * Control states this element can be in.
   *
   * Named apart from `controls` above, which is a different thing wearing a
   * similar word: those are form fields the sentence can *read a value from*,
   * these are pseudo-classes the element can *be in*.
   */
  controlStates?: ControlPseudo[];
  /**
   * What "+ condition" adds.
   *
   * A `Test` in an assignment grows by another comparison, because that is
   * what an assignment is made of and the fields are right there. A `Test` on
   * a *style rule* has no fields to compare — most pages have no collection at
   * all — and grows by another browser condition instead. One builder, two
   * grammars underneath it, and the caller says which by saying what a new
   * leaf looks like.
   */
  newLeaf?: () => Test;
  onChange?: (next: Test) => void;
  /** Prefix. "When" in an assignment, "Only when" in a filter, "" inside a group. */
  opening?: string;
  /** How deep this sentence already is, for keys and for what may be added. */
  depth?: number;
}): Part[] {
  const {
    test,
    fields,
    controls = [],
    elements = [],
    states = [],
    controlStates = [],
    newLeaf,
    onChange,
    opening = 'When',
    depth = 0,
  } = options;
  // The seed for "+ condition". Falls back to a blank comparison so every
  // caller that predates this keeps exactly the behaviour it had.
  const seed = newLeaf ?? (fields[0] ? () => blankTest(fields[0]!) : undefined);

  const parts: Part[] = opening ? [{ kind: 'word', text: opening, key: 'open' }] : [];
  const nest = (inner: Test, index: number) =>
    testSentence({
      test: inner,
      fields,
      controls,
      elements,
      states,
      controlStates,
      newLeaf,
      opening: '',
      depth: depth + 1,
      onChange:
        onChange &&
        ((next) =>
          onChange({
            ...(test as Extract<Test, { kind: 'every' | 'some' }>),
            tests: (test as Extract<Test, { kind: 'every' | 'some' }>).tests.map((one, at) =>
              at === index ? next : one
            ),
          })),
    });

  if (test.kind === 'every' || test.kind === 'some') {
    /*
     * A group reads as its own line and its members as clauses under it, which
     * is the only arrangement that survives a 280px panel — "all of these hold
     * Price is over 500000 and Status is available" in one run is a sentence
     * nobody can parse at a glance.
     *
     * The and/or is one chip, so turning "all" into "any" is a click rather
     * than a rebuild. That is the thing most builders make hard.
     */
    parts.push({
      kind: 'pick',
      key: `${depth}-mode`,
      value: test.kind,
      menuWidth: 170,
      options: [
        { value: 'every', label: 'all of these' },
        { value: 'some', label: 'any of these' },
      ],
      onChange: onChange && ((kind) => onChange({ ...test, kind: kind as 'every' | 'some' })),
    });
    parts.push({ kind: 'word', text: 'hold', key: `${depth}-hold` });

    test.tests.forEach((inner, index) => {
      parts.push({
        kind: 'clause',
        key: `${depth}-${index}`,
        parts: [
          ...(index > 0
            ? [
                {
                  kind: 'word' as const,
                  text: test.kind === 'every' ? 'and' : 'or',
                  key: `join${index}`,
                },
              ]
            : []),
          ...nest(inner, index),
          ...(onChange && test.tests.length > 1
            ? [
                {
                  kind: 'action' as const,
                  key: `drop${index}`,
                  title: 'Remove this condition',
                  label: <Trash2 size={10} />,
                  onClick: () => {
                    // Through `simplify`, so deleting down to one condition
                    // leaves that condition rather than a group of one.
                    const left = simplify({
                      ...test,
                      tests: test.tests.filter((_, at) => at !== index),
                    });
                    if (left) onChange(left);
                  },
                },
              ]
            : []),
        ],
      });
    });

    if (onChange && seed) {
      parts.push({
        kind: 'clause',
        key: `${depth}-add`,
        parts: [
          {
            kind: 'action',
            key: 'add',
            title: 'Add a condition',
            label: <span className="text-[10px]">+ condition</span>,
            onClick: () => onChange({ ...test, tests: [...test.tests, seed()] }),
          },
          // One level of grouping is offered, not unlimited. Two nested groups
          // in a 280px panel is a diagram, and the model can still hold deeper
          // — anything that arrives that way is rendered, just not authored
          // here.
          ...(depth < 1
            ? [
                {
                  kind: 'action' as const,
                  key: 'add-group',
                  title: 'Add a group of conditions',
                  label: <span className="text-[10px]">+ group</span>,
                  onClick: () =>
                    onChange({
                      ...test,
                      tests: [
                        ...test.tests,
                        {
                          kind: test.kind === 'every' ? 'some' : 'every',
                          tests: [seed(), seed()],
                        },
                      ],
                    }),
                },
              ]
            : []),
        ],
      });
    }
    return parts;
  }

  if (test.kind !== 'compare') {
    /*
     * A browser condition inside a Test, handed to the builder that edits one.
     *
     * This used to print `describeOther(test)` — a flat phrase with nothing to
     * click — which was right while nothing could edit a condition and became
     * wrong the moment something could. Delegating rather than duplicating is
     * also what lets a style rule use this function at all: the tree grammar
     * is here, the leaf grammar is there, and neither knows about the other's
     * callers.
     */
    parts.push(
      ...conditionSentence({
        condition: test,
        states,
        controls: controlStates,
        onChange,
        keyPrefix: `d${depth}-`,
      })
    );
    return parts;
  }

  const left = test.left;
  const source =
    left.kind === 'field'
      ? left.key
      : left.kind === 'input'
        ? `${TYPED}${left.name}`
        : `${ON_PAGE}${left.ref.node}`;
  const field =
    left.kind === 'field' ? fields.find((f) => f.key === left.key) : AS_TEXT;
  const operators = field ? OPS_FOR[field.type] : [];
  /*
   * A reference whose element the caller could not name.
   *
   * Without this the chip falls through to its placeholder and the sentence
   * reads `When ⟨a field⟩ is not empty` — which says the source was never
   * chosen, when in truth one was chosen and the thing it named is gone. The
   * two failures want opposite responses, so the sentence has to tell them
   * apart before the warning underneath is worth reading.
   *
   * It is a real option rather than a bare label because a `Select` takes its
   * text from the option matching its value; choosing it again is a no-op,
   * which is the right amount of nothing for a chip that exists to be replaced.
   */
  const orphaned =
    left.kind === 'element' && !elements.some((one) => one.id === left.ref.node);

  parts.push({
    kind: 'pick',
    key: 'source',
    value: source,
    placeholder: 'a field',
    menuWidth: 200,
    options: [
      ...fields.map((f) => ({ value: f.key, label: f.label })),
      ...controls.map((name) => ({ value: `${TYPED}${name}`, label: `${name} — what is typed` })),
      ...elements.map((one) => ({
        value: `${ON_PAGE}${one.id}`,
        label: `${one.name} — what it holds`,
      })),
      ...(orphaned ? [{ value: source, label: DELETED_ELEMENT }] : []),
    ],
    onChange:
      onChange &&
      ((next) => {
        const typed = next.startsWith(TYPED);
        const onPage = next.startsWith(ON_PAGE);
        const picked = typed || onPage ? AS_TEXT : fields.find((f) => f.key === next);
        if (!picked) return;
        // A new source is a new type, and an operator the new type cannot
        // answer. Rebuilt rather than patched, so the sentence is never
        // momentarily ungrammatical.
        onChange({
          kind: 'compare',
          left: typed
            ? { kind: 'input', name: next.slice(TYPED.length) }
            : onPage
              ? { kind: 'element', ref: { node: next.slice(ON_PAGE.length) } }
              : { kind: 'field', key: next },
          op: (OPS_FOR[picked.type][0] ?? 'eq') as CompareOp,
          right: literalFor(picked.type, ''),
        });
      }),
  });

  parts.push({
    kind: 'pick',
    key: 'op',
    value: test.op,
    menuWidth: 168,
    options: operators.map((op) => ({ value: op, label: OP_LABELS[op] })),
    onChange:
      onChange &&
      ((op) => {
        const next: Test = { ...test, op: op as CompareOp };
        if (!needsOperand(op as CompareOp)) delete next.right;
        else if (!next.right && field) next.right = literalFor(field.type, '');
        onChange(next);
      }),
  });

  if (needsOperand(test.op) && field) {
    if (field.type === 'boolean') {
      parts.push({
        kind: 'pick',
        key: 'value',
        value: literalText(test.right) === 'true' ? 'true' : 'false',
        menuWidth: 140,
        options: [
          { value: 'true', label: 'ticked' },
          { value: 'false', label: 'not ticked' },
        ],
        onChange: onChange && ((raw) => onChange({ ...test, right: literalFor('boolean', raw) })),
      });
    } else if (field.type === 'select' && field.options?.length) {
      parts.push({
        kind: 'pick',
        key: 'value',
        value: literalText(test.right),
        placeholder: 'a value',
        menuWidth: 180,
        options: field.options.map((option) => ({ value: option, label: option })),
        onChange: onChange && ((raw) => onChange({ ...test, right: literalFor(field.type, raw) })),
      });
    } else {
      parts.push({
        kind: 'type',
        key: 'value',
        value: literalText(test.right),
        placeholder: field.type === 'number' ? '0' : 'value',
        numeric: field.type === 'number',
        onChange: onChange && ((raw) => onChange({ ...test, right: literalFor(field.type, raw) })),
      });
    }
  }

  /*
   * And the way a single condition becomes two. Offered only at the top,
   * because inside a group the group's own "+ condition" is the way to do it
   * and two affordances for one action is worse than either.
   */
  if (onChange && depth === 0 && seed) {
    parts.push({
      kind: 'action',
      key: 'grow',
      title: 'Add another condition',
      label: <span className="text-[10px]">+ and</span>,
      onClick: () => onChange({ kind: 'every', tests: [test, seed()] }),
    });
  }

  return parts;
}

/** Marks a source that is a form control rather than a record field. */
const TYPED = 'typed:';
/**
 * Marks a picked option as an element on the page rather than a field or a
 * named control. A prefix for the same reason `TYPED` is one: the picker deals
 * in strings, and the three kinds of source have to stay tellable apart.
 */
const ON_PAGE = 'on-page:';
/**
 * What an element reference reads as once its element is gone.
 *
 * Exported because the panel that warns about it must not spell the same fact
 * a second way: the chip names the thing and the warning explains it, and one
 * of those going stale while the other did not is how a rule ends up described
 * as both unset and broken in the same panel.
 */
export const DELETED_ELEMENT = 'a deleted element';

/**
 * The sentence somebody starts with: the first field, its first operator, and
 * a blank to type into. Grammatical from the moment it appears, which is why
 * it is built here rather than in the panel — a new rule that read
 * "When ⟨⟩ ⟨⟩ ⟨⟩" would be a form again.
 */
export function blankTest(field: Field): Test {
  return {
    kind: 'compare',
    left: { kind: 'field', key: field.key },
    op: (OPS_FOR[field.type][0] ?? 'eq') as CompareOp,
    right: literalFor(field.type, ''),
  };
}

/**
 * The same, over whatever this element can actually read.
 *
 * `blankTest` needs a field, and the panel that guards an action often has
 * none: most pages carry no collection at all, and *only when the email box is
 * not empty* is the guard people reach for first. So the seed falls through the
 * three operand kinds in the order they are worth offering, and answers `null`
 * when there is nothing here to compare — which is the case where the panel
 * must not offer a guard, because a comparison with no operand is a condition
 * that ships and can never hold.
 *
 * `notEmpty` for the two control kinds, because it needs no right-hand side and
 * is therefore complete the moment it appears — the same standard `blankTest`
 * sets with "grammatical from the moment it appears".
 */
export function blankGuard(readable: {
  fields: Field[];
  controls: string[];
  elements: { id: string; name: string }[];
}): Test | null {
  const field = readable.fields[0];
  if (field) return blankTest(field);
  const control = readable.controls[0];
  if (control) return { kind: 'compare', left: { kind: 'input', name: control }, op: 'notEmpty' };
  const element = readable.elements[0];
  if (element) {
    return { kind: 'compare', left: { kind: 'element', ref: { node: element.id } }, op: 'notEmpty' };
  }
  return null;
}

/**
 * `Only when ⟨Tag⟩ ⟨is⟩ ⟨news⟩`, for the repeater.
 *
 * The same three parts as a Test, over a smaller operator set, because a filter
 * runs against the whole collection before anything is drawn and only ever
 * compares text. Worth saying in the same shape all the same: a designer who
 * has written one has written the other.
 */
export function filterSentence(options: {
  filter: RecordFilter;
  fields: Field[];
  onChange?: (next: RecordFilter) => void;
  onRemove?: () => void;
}): Part[] {
  const { filter, fields, onChange, onRemove } = options;
  const parts: Part[] = [
    { kind: 'word', text: 'Only when', key: 'open' },
    {
      kind: 'pick',
      key: 'field',
      value: filter.field,
      placeholder: 'a field',
      menuWidth: 200,
      options: fields.map((f) => ({ value: f.key, label: f.label })),
      onChange: onChange && ((field) => onChange({ ...filter, field })),
    },
    {
      kind: 'pick',
      key: 'op',
      value: filter.op,
      menuWidth: 168,
      options: [
        { value: 'is', label: 'is' },
        { value: 'isNot', label: 'is not' },
        { value: 'has', label: 'contains' },
      ],
      onChange: onChange && ((op) => onChange({ ...filter, op: op as RecordFilter['op'] })),
    },
    {
      kind: 'type',
      key: 'value',
      value: filter.value,
      placeholder: 'value',
      onChange: onChange && ((value) => onChange({ ...filter, value })),
    },
  ];
  if (onRemove) {
    parts.push({
      kind: 'action',
      key: 'remove',
      title: 'Remove this filter',
      label: <Trash2 size={11} />,
      onClick: onRemove,
    });
  }
  return parts;
}

/* --------------------------------------------------------------------------
 * A binding
 * ----------------------------------------------------------------------- */

/**
 * `Text reads ⟨Price⟩ as ⟨currency⟩, ⟨$⟩ ⟨before it⟩, ⟨2⟩ decimals`.
 *
 * The prop is a word rather than a chip: it is what the row *is about*, and a
 * binding cannot be moved from `text` to `alt` any more than a paragraph can
 * be moved to another element by editing a dropdown. Everything the author
 * actually chooses is a chip.
 *
 * The format's settings are in the same sentence rather than folded away
 * behind it. A currency with the wrong number of decimals is wrong in a way
 * that is invisible until somebody looks at the published page, and a
 * disclosure triangle is a good place for a mistake to live.
 */
export function bindingSentence(options: {
  prop: string;
  binding: Binding | undefined;
  fields: Field[];
  onBind?: (fieldKey: string) => void;
  onFormat?: (format: Format | undefined) => void;
}): Part[] {
  const { prop, binding, fields, onBind, onFormat } = options;
  const source = binding?.value.kind === 'field' ? binding.value.key : '';
  const field = fields.find((f) => f.key === source);

  const parts: Part[] = [
    { kind: 'word', text: prop === 'text' ? 'Text' : prop, key: 'prop' },
    { kind: 'word', text: 'reads', key: 'reads' },
    {
      kind: 'pick',
      key: 'field',
      value: source,
      placeholder: 'what is typed here',
      menuWidth: 200,
      options: [
        { value: '', label: 'what is typed here' },
        ...fields.map((f) => ({ value: f.key, label: f.label })),
      ],
      onChange: onBind,
    },
  ];
  if (!binding || !field) return parts;

  const kinds = formatsFor(prop, field);
  if (!kinds.length) return parts;

  const format = binding.format;
  parts.push({ kind: 'word', text: 'as', key: 'as' });
  parts.push({
    kind: 'pick',
    key: 'format',
    value: format?.kind ?? '',
    menuWidth: 190,
    options: [
      { value: '', label: 'it is written' },
      ...kinds.map((kind) => ({ value: kind, label: FORMAT_LABELS[kind].toLowerCase() })),
    ],
    onChange:
      onFormat && ((kind) => onFormat(kind ? defaultFormat(kind as FormatKind) : undefined)),
  });
  if (!format) return parts;

  switch (format.kind) {
    case 'currency':
      parts.push({ kind: 'word', text: 'in', key: 'in' });
      parts.push({
        kind: 'type',
        key: 'symbol',
        value: format.symbol ?? '$',
        placeholder: '$',
        onChange: onFormat && ((symbol) => onFormat({ ...format, symbol: symbol.slice(0, 4) })),
      });
      parts.push({
        kind: 'pick',
        key: 'side',
        value: format.after ? 'after' : 'before',
        menuWidth: 150,
        options: [
          { value: 'before', label: 'before it' },
          { value: 'after', label: 'after it' },
        ],
        onChange: onFormat && ((where) => onFormat({ ...format, after: where === 'after' })),
      });
    // falls through — a currency is a number with a symbol, and takes the
    // same decimals and grouping chips after it.
    case 'number':
    case 'percent':
      parts.push({ kind: 'word', text: ', with', key: 'with' });
      parts.push({
        kind: 'pick',
        key: 'decimals',
        value: String(format.decimals ?? 0),
        menuWidth: 110,
        options: [0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) })),
        onChange: onFormat && ((n) => onFormat({ ...format, decimals: Number(n) })),
      });
      parts.push({ kind: 'word', text: 'decimals, as', key: 'dp' });
      parts.push({
        kind: 'pick',
        key: 'group',
        value: format.group === false ? 'plain' : 'grouped',
        menuWidth: 130,
        options: [
          { value: 'grouped', label: '1,234' },
          { value: 'plain', label: '1234' },
        ],
        onChange: onFormat && ((how) => onFormat({ ...format, group: how === 'grouped' })),
      });
      break;
    case 'date':
      parts.push({
        kind: 'pick',
        key: 'pattern',
        value: format.pattern,
        menuWidth: 180,
        options: DATE_PATTERNS.map((p) => ({ value: p.value, label: p.label })),
        onChange: onFormat && ((pattern) => onFormat({ ...format, pattern: pattern as DatePattern })),
      });
      break;
    case 'case':
      parts.push({
        kind: 'pick',
        key: 'to',
        value: format.to,
        menuWidth: 190,
        options: [
          { value: 'upper', label: 'UPPERCASE' },
          { value: 'lower', label: 'lowercase' },
          { value: 'capitalize', label: 'Capitalised' },
        ],
        onChange:
          onFormat && ((to) => onFormat({ ...format, to: to as 'upper' | 'lower' | 'capitalize' })),
      });
      break;
    case 'truncate':
      parts.push({ kind: 'word', text: 'its first', key: 'first' });
      parts.push({
        kind: 'type',
        key: 'chars',
        value: String(format.chars),
        numeric: true,
        onChange:
          onFormat &&
          ((raw) => {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) onFormat({ ...format, chars: Math.floor(n) });
          }),
      });
      parts.push({ kind: 'word', text: 'characters', key: 'chars-w' });
      break;
  }
  return parts;
}

/* --------------------------------------------------------------------------
 * A condition, and the rule it belongs to
 * ----------------------------------------------------------------------- */

/**
 * `⟨plan⟩ ⟨is⟩ ⟨annual⟩`, and the same for every other kind of condition.
 *
 * This used to say that handlers were "only ever supplied for `state` and
 * `data` — the two the panel can edit", and that a pointer condition had
 * nothing to choose because *it is hover*. Both halves were true of the panel
 * and neither was true of the generator, which has compiled four pointer
 * pseudo-classes, four control pseudo-classes and an attribute test the whole
 * time. A rule carrying one of those rendered as an unclickable phrase —
 * "the control is checked" — which reads as a description of something the
 * designer is not allowed to touch, and was in fact a description of something
 * nothing could produce.
 *
 * Every kind is now a sentence with chips in it. The words come from
 * `document/conditions.ts` so the menu that offers a shape, the chip that
 * edits it and the heading that summarises it cannot disagree about what it is
 * called.
 */
export function conditionSentence(options: {
  condition: Condition;
  states?: { key: string; values: string[] }[];
  /**
   * The control states this element can actually be in.
   *
   * Passed in rather than worked out here because it depends on the node and
   * this file only ever sees the condition. Empty is the honest answer for
   * most elements: a `div` is never ticked.
   */
  controls?: ControlPseudo[];
  onChange?: (next: Condition) => void;
  keyPrefix?: string;
}): Part[] {
  const { condition, states = [], controls = [], onChange, keyPrefix = '' } = options;
  const k = (name: string) => `${keyPrefix}${name}`;

  if (condition.kind === 'pointer' && onChange) {
    return [
      {
        kind: 'pick',
        key: k('pointer'),
        value: condition.pseudo,
        menuWidth: 220,
        options: pointerOptions(),
        onChange: (pseudo) => onChange({ kind: 'pointer', pseudo: pseudo as PointerPseudo }),
      },
    ];
  }

  if (condition.kind === 'control' && onChange) {
    /*
     * A pseudo-class the element cannot be in is still offered — as the one it
     * currently says. A block can plant a condition the panel would not have
     * built, and changing an element's type leaves whatever rules it had.
     * Dropping the value would make the chip fall through to its placeholder,
     * so a rule that says something specific and impossible would read as a
     * rule nobody had finished writing. Those want opposite responses.
     */
    const offered = controls.includes(condition.pseudo)
      ? controls
      : [...controls, condition.pseudo];
    return [
      {
        kind: 'pick',
        key: k('control'),
        value: condition.pseudo,
        menuWidth: 220,
        options: offered.map((pseudo) => ({
          value: pseudo,
          label: CONTROL_LABELS[pseudo],
          hint: CONTROL_HINTS[pseudo],
        })),
        onChange: (pseudo) => onChange({ kind: 'control', pseudo: pseudo as ControlPseudo }),
      },
    ];
  }

  if (condition.kind === 'attr' && onChange) {
    return [
      {
        kind: 'type',
        key: k('attr'),
        value: condition.name,
        placeholder: 'aria-expanded',
        // Narrowed to what an attribute name may contain, for the same reason
        // `slug` narrows a state key: this string reaches a selector unquoted,
        // and a space in it would end the attribute test early.
        onChange: (raw) => {
          const name = attrName(raw);
          if (name) onChange({ ...condition, name });
        },
      },
      {
        kind: 'pick',
        key: k('attr-op'),
        value: condition.op,
        menuWidth: 130,
        options: [
          { value: 'is', label: 'is' },
          { value: 'isNot', label: 'is not' },
        ],
        onChange: (op) => onChange({ ...condition, op: op as 'is' | 'isNot' }),
      },
      {
        kind: 'type',
        key: k('attr-value'),
        value: condition.values.join(' '),
        // An attribute can be present with no value — `<details open>` — and
        // that is a real thing to style on, so an empty box is a meaning
        // rather than an unfinished sentence.
        placeholder: 'set at all',
        onChange: (raw) => onChange({ ...condition, values: [attrValue(raw)] }),
      },
    ];
  }

  if (condition.kind === 'state' && onChange) {
    const chosen = states.find((state) => state.key === condition.key);
    return [
      {
        kind: 'pick',
        key: k('state'),
        value: condition.key,
        placeholder: 'the nearest state',
        menuWidth: 200,
        options: states.map((state) => ({
          value: state.key,
          label: state.key,
          hint: state.values.join(' ') || undefined,
        })),
        onChange: (key) => onChange({ ...condition, key }),
      },
      {
        kind: 'pick',
        key: k('op'),
        value: condition.op,
        menuWidth: 130,
        options: [
          { value: 'is', label: 'is' },
          { value: 'isNot', label: 'is not' },
        ],
        onChange: (op) => onChange({ ...condition, op: op as 'is' | 'isNot' }),
      },
      {
        kind: 'type',
        key: k('values'),
        value: condition.values.join(' '),
        placeholder: chosen?.values[0] ?? 'a value',
        onChange: (raw) => {
          const values = slugList(raw).split(' ').filter(Boolean);
          if (values.length) onChange({ ...condition, values });
        },
      },
    ];
  }

  if (condition.kind === 'data' && onChange) {
    const source = describeSource(condition.source);
    return [
      { kind: 'word', text: source?.label ?? condition.source, key: k('source') },
      {
        kind: 'pick',
        key: k('op'),
        value: condition.op,
        menuWidth: 130,
        options: [
          { value: 'is', label: 'is' },
          { value: 'isNot', label: 'is not' },
        ],
        onChange: (op) => onChange({ ...condition, op: op as 'is' | 'isNot' }),
      },
      source?.values.length
        ? {
            kind: 'pick',
            key: k('values'),
            value: condition.values[0] ?? '',
            placeholder: 'a value',
            menuWidth: 170,
            options: source.values.map((value) => ({ value, label: value })),
            onChange: (value) => onChange({ ...condition, values: [value] }),
          }
        : {
            kind: 'type',
            key: k('values'),
            value: condition.values.join(' '),
            placeholder: 'a value',
            onChange: (raw) => {
              const values = slugList(raw).split(' ').filter(Boolean);
              if (values.length) onChange({ ...condition, values });
            },
          },
    ];
  }

  return [{ kind: 'word', text: describeOther(condition), key: k('prose') }];
}

/**
 * A whole rule as a sentence.
 *
 * Read-only — this is the row heading, and the row expands to edit. The same
 * builder produces both, which is the point: the heading cannot describe a
 * rule differently from the controls underneath it. That was a claim about two
 * functions agreeing when `when` was a list of conditions this walked itself;
 * now it is one function called twice, with and without handlers.
 */
export function ruleSentence(rule: StyleRule): Part[] {
  if (!rule.when) {
    return [
      { kind: 'word', text: 'Always', key: 'always' },
      ...(rule.part ? [{ kind: 'word' as const, text: `· ${rule.part}`, key: 'part' }] : []),
    ];
  }
  const parts = testSentence({ test: rule.when, fields: [], opening: '' });
  if (rule.part) parts.push({ kind: 'word', text: `· ${rule.part}`, key: 'part' });
  return parts;
}

/**
 * Every pointer state, in a fixed order, straight off the label map.
 *
 * Total by construction: a pseudo-class added to `Condition` gets a label —
 * the `Record` makes that a compile error otherwise — and appears in the menu
 * the same day, rather than waiting for somebody to notice a second list.
 */
function pointerOptions() {
  return (Object.keys(POINTER_LABELS) as PointerPseudo[]).map((pseudo) => ({
    value: pseudo,
    label: POINTER_LABELS[pseudo],
    hint: POINTER_HINTS[pseudo],
  }));
}

/** What a Test says when it is not a plain comparison. */
function describeOther(test: Test): string {
  switch (test.kind) {
    case 'every':
      return `all of ${test.tests.length} conditions hold`;
    case 'some':
      return `any of ${test.tests.length} conditions holds`;
    case 'pointer':
      // The same words the chip shows. Two spellings of one condition — a row
      // reading "the pointer is focus-visible" over an editor offering
      // "focused by keyboard" — is the drift this file exists to prevent.
      return POINTER_LABELS[test.pseudo];
    case 'control':
      return CONTROL_LABELS[test.pseudo];
    case 'state':
      return `${test.key || 'the nearest state'} ${test.op === 'is' ? 'is' : 'is not'} ${test.values.join(' or ')}`;
    case 'attr': {
      // An empty value is "present at all" rather than "equal to nothing",
      // which is what `<details open>` means and what the chip's placeholder
      // says. Reading it back as `open is ` would look like a half-written
      // rule instead of the finished one it is.
      const values = test.values.filter(Boolean);
      if (!values.length) return `${test.name} is ${test.op === 'is' ? '' : 'not '}set at all`;
      return `${test.name} ${test.op === 'is' ? 'is' : 'is not'} ${values.join(' or ')}`;
    }
    case 'data':
      return `${test.source} ${test.op === 'is' ? 'is' : 'is not'} ${test.values.join(' or ')}`;
    default:
      // `compare` is handled by the caller before it reaches here. Named
      // rather than left to fall off the end, so a new Test kind arrives as a
      // sentence that says nothing useful instead of one that says nothing.
      return 'a condition this panel cannot spell yet';
  }
}
