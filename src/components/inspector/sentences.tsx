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
import type { CompareOp, Field, RecordFilter, Test } from '@/lib/document/types';
import { OPS_FOR, OP_LABELS, literalFor, literalText, needsOperand } from '@/lib/renderer/test';
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
  onChange?: (next: Test) => void;
  /** Prefix. "When" in an assignment, "Only when" in a filter. */
  opening?: string;
}): Part[] {
  const { test, fields, controls = [], onChange, opening = 'When' } = options;
  const parts: Part[] = [{ kind: 'word', text: opening, key: 'open' }];

  if (test.kind !== 'compare') {
    // Everything the sentence builder does not have words for yet — a nested
    // `every`, a browser condition. Said plainly rather than rendered as an
    // empty sentence, which would read as a rule that does nothing.
    parts.push({ kind: 'word', text: describeOther(test), key: 'other' });
    return parts;
  }

  const left = test.left;
  const source = left.kind === 'field' ? left.key : `${TYPED}${left.name}`;
  const field =
    left.kind === 'field' ? fields.find((f) => f.key === left.key) : AS_TEXT;
  const operators = field ? OPS_FOR[field.type] : [];

  parts.push({
    kind: 'pick',
    key: 'source',
    value: source,
    placeholder: 'a field',
    menuWidth: 200,
    options: [
      ...fields.map((f) => ({ value: f.key, label: f.label })),
      ...controls.map((name) => ({ value: `${TYPED}${name}`, label: `${name} — what is typed` })),
    ],
    onChange:
      onChange &&
      ((next) => {
        const typed = next.startsWith(TYPED);
        const picked = typed ? AS_TEXT : fields.find((f) => f.key === next);
        if (!picked) return;
        // A new source is a new type, and an operator the new type cannot
        // answer. Rebuilt rather than patched, so the sentence is never
        // momentarily ungrammatical.
        onChange({
          kind: 'compare',
          left: typed ? { kind: 'input', name: next.slice(TYPED.length) } : { kind: 'field', key: next },
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

  return parts;
}

/** Marks a source that is a form control rather than a record field. */
const TYPED = 'typed:';

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

/** What a Test says when it is not a plain comparison. */
function describeOther(test: Test): string {
  switch (test.kind) {
    case 'every':
      return `all of ${test.tests.length} conditions hold`;
    case 'some':
      return `any of ${test.tests.length} conditions holds`;
    case 'pointer':
      return `the pointer is ${test.pseudo}`;
    case 'control':
      return `the control is ${test.pseudo}`;
    case 'state':
      return `${test.key || 'the nearest state'} ${test.op === 'is' ? 'is' : 'is not'} ${test.values.join(' or ')}`;
    case 'attr':
      return `${test.name} ${test.op === 'is' ? 'is' : 'is not'} ${test.values.join(' or ')}`;
    case 'data':
      return `${test.source} ${test.op === 'is' ? 'is' : 'is not'} ${test.values.join(' or ')}`;
    default:
      // `compare` is handled by the caller before it reaches here. Named
      // rather than left to fall off the end, so a new Test kind arrives as a
      // sentence that says nothing useful instead of one that says nothing.
      return 'a condition this panel cannot spell yet';
  }
}
