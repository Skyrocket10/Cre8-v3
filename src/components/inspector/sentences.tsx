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
  Collection,
  CompareOp,
  Condition,
  DatePattern,
  Field,
  FieldType,
  Format,
  RecordFilter,
  Step,
  StyleRule,
  Test,
  Value,
} from '@/lib/document/types';
import { slugList } from '@/lib/document/schema';
import { STEPS, isTransform, stepsFor, typeAfter } from '@/lib/document/steps';
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
  FORMATS_FOR,
  FORMAT_LABELS,
  defaultFormat,
  formatsFor,
  type FormatKind,
} from '@/lib/document/format';
import {
  OPS_FOR,
  OP_LABELS,
  literalFor,
  literalText,
  needsOperand,
  simplify,
} from '@/lib/renderer/test';
import { QUERY_PREFIX, describeSource, offerableSources } from '@/lib/runtime/data';
import type { Part } from '../ui/sentence';

/**
 * "Posts" → "post". Good enough for the two words this ever sees.
 *
 * Here rather than in the panel because it is a wording decision, and every
 * other wording decision in the inspector is already in this file — a chip
 * reading "the writers itself" is a collection name in a slot that wants one
 * record.
 */
export const singular = (name: string) =>
  name.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

/** The one field type a form control's value is read as: text, undeclared. */
const AS_TEXT: Field = { key: '', label: 'Typed', type: 'text' };

/** The picker's stand-in for "a parameter you name", which has no id of its own. */
const OTHER_QUERY = 'query.\u0000';

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
   * The fields of the row this test is asking about, inside a `where`.
   *
   * Present turns the whole sentence around: the left of every comparison is a
   * field of the *candidate row* rather than of the record in scope, and the
   * source menu offers those and nothing else. A control cannot be read from
   * here — a list is narrowed when the page is published, and nobody has typed
   * anything then — and reading the record in scope on the left would be a
   * test that answers the same thing for every row.
   *
   * The record in scope reappears on the *right*, which is the relational
   * case: `⟨the comment's Post⟩ is ⟨this Post⟩`.
   */
  rowFields?: Field[];
  /** The collection the record in scope belongs to, for "this ⟨Post⟩". */
  scope?: Collection;
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
    rowFields,
    scope,
    newLeaf,
    onChange,
    opening = 'When',
    depth = 0,
  } = options;
  /** Whether this sentence is inside a `where`. See `rowFields`. */
  const rows = rowFields ?? [];
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
      rowFields,
      scope,
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

  /*
   * The two ways one leaf becomes two, for either kind of leaf.
   *
   * Built here and appended by both branches below, because it used to sit at
   * the bottom of the function — *after* the early return that hands a browser
   * condition to `conditionSentence`. So it only ever appeared on a comparison,
   * and a comparison needs a record in scope. On a page with no collection,
   * which is most pages, adding "Pointed at" produced a sentence with no way to
   * add a second condition: X1 made the shapes reachable, X2 widened the model,
   * X3 taught the generator to compile an OR, and the one affordance that turns
   * one condition into two was behind a `return`. See §4.1.11.
   */
  const grow = (): Part[] =>
    onChange && depth === 0 && seed
      ? [
          {
            kind: 'action',
            key: 'grow',
            title: 'Add another condition, and both have to hold',
            label: <span className="text-[10px]">+ and</span>,
            onClick: () => onChange({ kind: 'every', tests: [test, seed()] }),
          },
          /*
           * Both words, not just "and". X3 put OR in the model, in the
           * generator and in this builder's group mode, and left the only route
           * to *either of these* running through *both of these* — a rule that
           * means the opposite of what is being written. Somebody who wants
           * "or" knows it before they click.
           */
          {
            kind: 'action',
            key: 'grow-any',
            title: 'Add another condition, and either will do',
            label: <span className="text-[10px]">+ or</span>,
            onClick: () => onChange({ kind: 'some', tests: [test, seed()] }),
          },
        ]
      : [];

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
      }),
      ...grow()
    );
    return parts;
  }

  const left = test.left;
  const source =
    left.kind === 'field'
      ? left.key
      : left.kind === 'row'
        ? `${A_ROW}${left.key}`
        : left.kind === 'input'
          ? `${TYPED}${left.name}`
          : left.kind === 'element'
            ? `${ON_PAGE}${left.ref.node}`
            : // A constant on the *left* is a comparison with nothing to
              // compare. The model allows it because both operands are one
              // type — that symmetry is the whole of E1 — and this panel never
              // writes one, so it renders as a source nobody chose and the
              // chip is the way out.
              '';
  const field =
    left.kind === 'field'
      ? fields.find((f) => f.key === left.key)
      : left.kind === 'row'
        ? rows.find((f) => f.key === left.key)
        : AS_TEXT;
  /*
   * What the left side is worth by the time the operator sees it.
   *
   * `⟨First⟩ ⟨joined with ⟨Last⟩⟩` is text however it started, so the
   * operators, the operand chip and the fields it can be compared against are
   * all asked of the *ended* type. Asking the head would offer `is over` on a
   * sentence — the same shape of wrong answer as offering `×` on a name.
   */
  const asks = typeAfter(field?.type, left.steps ?? []) ?? field?.type;
  const operators = asks ? OPS_FOR[asks] : [];
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
  /*
   * And the same failure on the other operand kind, which had no answer.
   *
   * A named control is looked up *inside* the node that owns the rule —
   * `holder.querySelector('[name="…"]')` — so a name that is not among
   * `controls` is not merely unoffered, it will never resolve. Without this
   * the chip fell through to its placeholder and the sentence read
   * `When ⟨a field⟩ is not empty`: a rule that names something, rendered as a
   * rule that names nothing. Same reasoning as `orphaned`, one line along.
   */
  const notInside = left.kind === 'input' && !controls.includes(left.name);

  parts.push({
    kind: 'pick',
    key: 'source',
    value: source,
    placeholder: 'a field',
    menuWidth: 200,
    options: rowFields
      ? // Inside a `where`: the row, and only the row. See `rowFields`.
        rows.map((f) => ({ value: `${A_ROW}${f.key}`, label: f.label }))
      : [
          ...fields.map((f) => ({ value: f.key, label: f.label })),
          ...controls.map((name) => ({ value: `${TYPED}${name}`, label: `${name} — what is typed` })),
          ...elements.map((one) => ({
            value: `${ON_PAGE}${one.id}`,
            label: `${one.name} — what it holds`,
          })),
          ...(orphaned ? [{ value: source, label: DELETED_ELEMENT }] : []),
          ...(notInside && left.kind === 'input'
            ? [{ value: source, label: `${left.name} — not inside this` }]
            : []),
        ],
    onChange:
      onChange &&
      ((next) => {
        const typed = next.startsWith(TYPED);
        const onPage = next.startsWith(ON_PAGE);
        const inRow = next.startsWith(A_ROW);
        const picked = inRow
          ? rows.find((f) => f.key === next.slice(A_ROW.length))
          : typed || onPage
            ? AS_TEXT
            : fields.find((f) => f.key === next);
        if (!picked) return;
        // A new source is a new type, and an operator the new type cannot
        // answer. Rebuilt rather than patched, so the sentence is never
        // momentarily ungrammatical.
        onChange({
          kind: 'compare',
          left: inRow
            ? { kind: 'row', key: picked.key }
            : typed
              ? { kind: 'input', name: next.slice(TYPED.length) }
              : onPage
                ? { kind: 'element', ref: { node: next.slice(ON_PAGE.length) } }
                : { kind: 'field', key: next },
          op: (OPS_FOR[picked.type][0] ?? 'eq') as CompareOp,
          right: rightFor(picked, scope, inRow),
        });
      }),
  });

  /*
   * And what is done to it before the comparison is made.
   *
   * The affordance E5 and E7 built the runtime branches for and could not
   * reach: the chain editor lived in the Data panel, which authors bindings,
   * and a binding never travels. `⟨what is typed⟩ ⟨lowercased⟩ is ⟨yes⟩` is
   * the guard this makes sayable — text `eq` is exact, so *is `yes`* fails on
   * `Yes` and there is no case-insensitive equality anywhere in the operator
   * set.
   *
   * Keyed apart from everything else in the sentence because a group nests
   * these, and two clauses each holding an `op0` would collide.
   */
  if (field) {
    parts.push(
      ...chainChips({
        held: left,
        type: field.type,
        fields,
        keyPrefix: `d${depth}-l`,
        onBind: onChange && ((value) => value && onChange({ ...test, left: value })),
      })
    );
  }

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
        else if (!next.right && asks) next.right = literalFor(asks, '');
        onChange(next);
      }),
  });

  if (needsOperand(test.op) && field && asks) {
    /*
     * The other fields this one can be compared against.
     *
     * Same declared type only, and it is worth being strict about: `Price` and
     * `Title` compile to a comparison that is undecidable on every row, which
     * is the *offer a step the head cannot do* failure `VALUES.md` §3.5 names
     * — a rule that silently never fires, with nothing anywhere saying why.
     *
     * Only over the record, and only when the left side reads the record too.
     * A comparison whose left is a form control is answered in the browser
     * against what somebody typed, and the fields there are the ones on the
     * row this element was drawn for — which, off a repeater, is no row at all.
     */
    const others =
      left.kind === 'field'
        ? fields.filter((f) => f.type === asks && f.key !== left.key)
        : left.kind === 'row'
          ? /*
             * The record in scope, from inside a `where` — which is the whole
             * relational half of the language. "Comments whose Author is this
             * post's Author" is two records compared in one clause, and the
             * left side being the row is exactly what makes the *outer* fields
             * the interesting thing to offer here rather than the excluded
             * one.
             */
            fields.filter((f) => f.type === asks)
          : [];
    const against = test.right?.kind === 'field' ? test.right.key : '';
    const pickRight = (key: string) =>
      onChange?.({ ...test, right: key === A_SELF ? { kind: 'self' } : { kind: 'field', key } });
    /** The record in scope, as the operand chip names it. */
    const thisRecord = scope ? `this ${singular(scope.name)}` : 'this record';
    /*
     * A reference on the row pointing back at the collection the page is
     * about: `⟨the comment's Post⟩ is ⟨this Post⟩`. Offered only when the
     * reference genuinely points there, which is §3.5's rule — a comparison
     * against a record of the wrong collection is one that compiles and can
     * never hold, and there is nothing on the page to say why.
     */
    const relational =
      left.kind === 'row' && field.type === 'reference' && !!field.of && field.of === scope?.id;
    const selfOption =
      relational || test.right?.kind === 'self'
        ? [{ value: A_SELF, label: thisRecord }]
        : [];
    // Named rather than left to the placeholder, for the reason `orphaned`
    // gives one line up: a chip that falls through says nothing was chosen,
    // and something was.
    const named = test.right?.kind === 'self' ? A_SELF : against;

    if (named) {
      /*
       * Pointed at another field, so the chip names it — and its menu is the
       * way back, with the constant first because that is what it was before
       * and what most sentences want. `unknownField` keeps a rule readable
       * after somebody deletes the field it compares against: a chip falling
       * through to its placeholder says *nothing was chosen*, which is the
       * opposite of what happened. Same reasoning as `orphaned`, one operand
       * along.
       */
      const known = !against || others.some((f) => f.key === against);
      parts.push({
        kind: 'pick',
        key: 'value',
        value: named,
        menuWidth: 200,
        options: [
          { value: AS_TYPED, label: 'a value you type' },
          ...selfOption,
          ...others.map((f) => ({ value: f.key, label: f.label })),
          ...(known ? [] : [{ value: against, label: `${against} — no longer a field` }]),
        ],
        onChange:
          onChange &&
          ((key) =>
            key === AS_TYPED
              ? onChange({ ...test, right: literalFor(asks, '') })
              : pickRight(key)),
      });
    } else if (asks === 'boolean') {
      parts.push({
        kind: 'pick',
        key: 'value',
        value: literalText(test.right) === 'true' ? 'true' : 'false',
        menuWidth: 140,
        options: [
          { value: 'true', label: 'ticked' },
          { value: 'false', label: 'not ticked' },
          ...others.map((f) => ({ value: `${A_FIELD}${f.key}`, label: f.label })),
        ],
        onChange:
          onChange &&
          ((raw) =>
            raw.startsWith(A_FIELD)
              ? pickRight(raw.slice(A_FIELD.length))
              : onChange({ ...test, right: literalFor('boolean', raw) })),
      });
    } else if (asks === 'select' && field.options?.length) {
      parts.push({
        kind: 'pick',
        key: 'value',
        value: literalText(test.right),
        placeholder: 'a value',
        menuWidth: 180,
        options: [
          ...field.options.map((option) => ({ value: option, label: option })),
          ...others.map((f) => ({ value: `${A_FIELD}${f.key}`, label: f.label })),
        ],
        onChange:
          onChange &&
          ((raw) =>
            raw.startsWith(A_FIELD)
              ? pickRight(raw.slice(A_FIELD.length))
              : onChange({ ...test, right: literalFor(asks, raw) })),
      });
    } else {
      parts.push({
        kind: 'type',
        key: 'value',
        value: literalText(test.right),
        placeholder: asks === 'number' ? '0' : 'value',
        numeric: asks === 'number',
        onChange: onChange && ((raw) => onChange({ ...test, right: literalFor(asks, raw) })),
        // The box keeps its width and gains a chevron. See `Part`'s `type`
        // member for why this is one chip rather than two.
        options: [...selfOption, ...others.map((f) => ({ value: f.key, label: f.label }))],
        menuWidth: 200,
        onPick: onChange && pickRight,
      });
    }
  }

  // Offered only at the top, because inside a group the group's own
  // "+ condition" is the way to do it and two affordances for one action is
  // worse than either.
  parts.push(...grow());

  return parts;
}

/** A typed number as an operand. Types are declared, so this one is declared. */
const numberFor = (raw: string): Value => literalFor('number', raw);
/** And a typed string, for the other family. */
const textFor = (raw: string): Value => literalFor('text', raw);

/** The fields a step's operand may read, which is the type it can work in. */
const among = (fields: Field[], type: FieldType) => fields.filter((f) => f.type === type);

/** An operand that names a field, as the chip should show it. */
function fieldLabel(value: Value, fields: Field[]): string {
  if (value.kind !== 'field') return '';
  return fields.find((f) => f.key === value.key)?.label ?? value.key;
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
 * The same trick on the right-hand operand, where the strings collide harder.
 *
 * A `select` field's options and a boolean's `true`/`false` are raw values in
 * the same menu as the fields to compare against, and a collection with a
 * field keyed `true` is not a hypothetical. So the field entries are prefixed
 * and the constants are not — the constants are what the menu was already for.
 */
const A_FIELD = 'field:';
/**
 * A source that is a whole collection rather than a field of the record.
 *
 * Prefixed for the reason every other marker here is: the picker deals in
 * strings, and a collection id and a field key are both just words.
 */
const A_LIST = 'list:';
/**
 * A field of the row a `where` is asking about, rather than of the record in
 * scope. Both are fields with keys, both belong in one menu's value space, so
 * they are told apart the way everything else here is.
 */
const A_ROW = 'row:';
/**
 * The record in scope itself, as an operand — `⟨the comment's Post⟩ is ⟨this
 * Post⟩`.
 *
 * A NUL rather than a prefix, for the reason `AS_TYPED` uses one: it shares a
 * menu with bare field keys, where a prefix is only unambiguous for as long as
 * nobody keys a field `self:`.
 */
const A_SELF = 'self\u0000';
/** And the way back, in the menu the chip grows once it names a field. */
const AS_TYPED = 'typed\u0000';
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
 * What a fresh comparison compares against.
 *
 * A constant, except in the one place where typing one is absurd: a reference
 * on the row that points back at the collection the page is about. Nobody
 * types a record id, and `⟨the comment's Post⟩ is ⟨this Post⟩` is what
 * somebody picking `Post` on a comment meant — so it is what the sentence says
 * the moment they pick it, rather than an empty box they have to work out.
 */
function rightFor(field: Field, scope: Collection | undefined, inRow: boolean): Value {
  if (inRow && field.type === 'reference' && field.of && field.of === scope?.id) {
    return { kind: 'self' };
  }
  return literalFor(field.type, '');
}

/**
 * The first comparison inside a `where`, over the row rather than the record.
 *
 * `blankTest`'s counterpart, and separate for the reason the `row` head exists
 * at all: the two mint different left sides, and one function taking a flag
 * would be the place those two meanings got mixed up.
 */
export function blankRowTest(field: Field, scope?: Collection): Test {
  return {
    kind: 'compare',
    left: { kind: 'row', key: field.key },
    op: (OPS_FOR[field.type][0] ?? 'eq') as CompareOp,
    right: rightFor(field, scope, true),
  };
}

/**
 * A leaf this test does not already hold.
 *
 * Growing a condition used to seed a constant — `{ pointer: 'hover' }` from the
 * rules panel, `blankTest(fields[0])` from an assignment — so one press of
 * "+ or" turned *pointed at* into **"any of these hold: pointed at or pointed
 * at"**. Grammatical, finished-looking, and a tautology: two identical branches
 * in the compiled selector list, saying exactly what the one branch said.
 *
 * That is `blankTest`'s own standard failing one step along. Its docblock asks
 * for a sentence that is "grammatical from the moment it appears" so a new rule
 * is not a form to fill in; a duplicate leaf clears that bar and still says
 * nothing, which is worse than a blank, because a blank looks unfinished and
 * this does not.
 *
 * Preference order is the order the When… menu offers them, so the second
 * condition is the one somebody would most likely have picked next. Falling
 * back to the first pointer state when everything is used means the tautology
 * is still reachable — by a designer who has already written four conditions
 * and asked for a fifth, which is a different thing from getting one on the
 * first press.
 */
export function unusedLeaf(options: {
  test?: Test;
  fields?: Field[];
  controlStates?: ControlPseudo[];
}): Test {
  const { test, fields = [], controlStates = [] } = options;
  const usedPointers = new Set<string>();
  const usedControls = new Set<string>();
  const usedFields = new Set<string>();
  const walk = (one: Test): void => {
    if (one.kind === 'every' || one.kind === 'some') one.tests.forEach(walk);
    else if (one.kind === 'compare') {
      if (one.left.kind === 'field') usedFields.add(one.left.key);
    } else if (one.kind === 'pointer') usedPointers.add(one.pseudo);
    else if (one.kind === 'control') usedControls.add(one.pseudo);
  };
  if (test) walk(test);

  // A record in scope means the sentence is made of comparisons, which is what
  // `testSentence`'s `newLeaf` docblock calls the assignment grammar.
  const field = fields.find((one) => !usedFields.has(one.key));
  if (field) return blankTest(field);

  const pointer = (Object.keys(POINTER_LABELS) as PointerPseudo[]).find(
    (one) => !usedPointers.has(one)
  );
  if (pointer) return { kind: 'pointer', pseudo: pointer };

  const control = controlStates.find((one) => !usedControls.has(one));
  if (control) return { kind: 'control', pseudo: control };

  return fields[0] ? blankTest(fields[0]) : { kind: 'pointer', pseudo: 'hover' };
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
  /**
   * Every collection, so a reference can be followed into the one it names.
   *
   * The whole list rather than the one collection: which one a reference
   * points at is `Field.of`, and looking it up here keeps the caller from
   * having to resolve it — the panel knows the element's scope, not the
   * schema's shape.
   */
  collections?: Collection[];
  /** The collection the record in scope belongs to, for "this ⟨Post⟩". */
  scope?: Collection;
  onBind?: (value: Value | null) => void;
  onFormat?: (format: Format | undefined) => void;
}): Part[] {
  const { prop, binding, fields, collections = [], scope, onBind, onFormat } = options;
  const held = binding?.value;
  const steps = held?.steps ?? [];
  /*
   * Which step turns the list into one thing, and where it is.
   *
   * Found rather than assumed to be first, which is what it was until a chain
   * could be narrowed: `⟨Comments⟩ ⟨where …⟩ ⟨count⟩` puts two steps before it,
   * and a panel reading `steps[0]` would have called that chain a `where` and
   * rebuilt it as one.
   */
  const reducer = steps.find(isReducer);
  const at = reducer ? steps.indexOf(reducer) : -1;
  const source =
    held?.kind === 'field'
      ? held.key
      : held?.kind === 'records'
        ? `${A_LIST}${held.collection}:${reducer?.op ?? 'first'}`
        : '';
  const field = held?.kind === 'field' ? fields.find((f) => f.key === source) : undefined;
  /*
   * The chain past whatever put a record in hand, if there is one.
   *
   * The last step is the only one this panel writes past a record — `field` —
   * and everything before it is what got there: `follow` from a reference, or
   * `first`/`last` off a list, with whatever narrowed or ordered that list
   * before them. Anything longer arrived from somewhere else and is left alone
   * rather than half-shown. One level, as §4 says.
   */
  const tail = steps[steps.length - 1];
  const followed = steps.length >= 2 && tail?.op === 'field' ? tail.key : '';

  /*
   * The counts and the ends of a list, one entry per collection.
   *
   * A separate group rather than more fields, because they are not fields of
   * the record in scope — they are facts about a *collection*, and a page with
   * no record in scope at all can still say one. Unnarrowed as picked, and the
   * sentence says so in the word after the chip: "in total" for as long as
   * there is no `where` under it, and gone the moment there is.
   */
  const lists = collections.flatMap((one) => [
    { value: `${A_LIST}${one.id}:count`, label: `How many ${one.name}` },
    { value: `${A_LIST}${one.id}:first`, label: `The first ${singular(one.name)}` },
    { value: `${A_LIST}${one.id}:last`, label: `The last ${singular(one.name)}` },
  ]);

  const pickSource = (choice: string): Value | null => {
    if (!choice) return null;
    if (!choice.startsWith(A_LIST)) return { kind: 'field', key: choice };
    const [collection, op] = choice.slice(A_LIST.length).split(':');
    return {
      kind: 'records',
      collection: collection!,
      steps: [{ op: op as 'count' | 'first' | 'last' }],
    };
  };

  const parts: Part[] = [
    { kind: 'word', text: prop === 'text' ? 'Text' : prop, key: 'prop' },
    { kind: 'word', text: 'reads', key: 'reads' },
    {
      kind: 'pick',
      key: 'field',
      value: source,
      placeholder: 'what is typed here',
      menuWidth: 220,
      options: [
        { value: '', label: 'what is typed here' },
        ...fields.map((f) => ({ value: f.key, label: f.label })),
        ...lists,
      ],
      // A new source is a new chain: the steps belonged to the old one, and a
      // `follow` left behind on a text field is a binding that resolves to
      // nothing for ever.
      onChange: onBind && ((choice) => onBind(pickSource(choice))),
    },
  ];
  if (!binding) return parts;

  /*
   * What the list is narrowed to and how it is ordered, when the head is one.
   *
   * Before the `→` chip, because they happen before it: the chain is
   * `⟨Comments⟩ ⟨only when …⟩ ⟨by …⟩ ⟨the first⟩ ⟨→ Name⟩`, and a sentence that
   * put the narrowing after the record it produced would be describing a
   * different chain from the one it writes.
   */
  const listOf =
    held?.kind === 'records'
      ? (collections.find((one) => one.id === held.collection) ?? null)
      : null;
  if (held?.kind === 'records' && listOf && reducer) {
    parts.push(
      ...listClauses({
        held,
        list: listOf,
        steps,
        at,
        reducer,
        fields,
        scope,
        onBind,
      })
    );
  }

  /*
   * Whatever the chain is holding a record *of*, so the next chip can offer
   * that collection's fields.
   *
   * Two ways to be at a record and one chip for both: a reference followed —
   * `VALUES.md` §1.3, declared and unreadable until E3 — or the first or last
   * row of a list. Written as "which collection are we in" rather than as two
   * branches, because the chip after it is the same chip either way.
   */
  const target =
    held?.kind === 'records' && reducer?.op !== 'count'
      ? listOf
      : field?.type === 'reference' && field.of
        ? (collections.find((one) => one.id === field.of) ?? null)
        : null;
  if (!field && !target) return parts;
  let effective = field;
  if (target?.fields.length) {
    const inner = target.fields.find((f) => f.key === followed);
    if (inner) effective = inner;
    /*
     * How the chain got to that record: `follow` from a reference, or `first`
     * / `last` off a list — with whatever narrowed and ordered that list ahead
     * of them. Kept from what is already there rather than recomputed, so this
     * chip only ever appends the field and never rewrites how somebody got
     * here.
     */
    const reach: Step[] = held?.kind === 'records' ? steps.slice(0, at + 1) : [{ op: 'follow' }];
    const head: Value = held?.kind === 'records' ? { ...held, steps: reach } : { kind: 'field', key: source };
    parts.push({ kind: 'word', text: '→', key: 'follow' });
    parts.push({
      kind: 'pick',
      key: 'followed',
      value: followed,
      menuWidth: 200,
      options: [
        // Singular, because it is one record: a chip reading "the writers
        // itself" is a collection name where a thing should be.
        { value: '', label: `the ${singular(target.name)} itself` },
        ...target.fields.map((f) => ({ value: f.key, label: f.label })),
      ],
      onChange:
        onBind &&
        ((key) =>
          onBind(key ? { ...head, steps: [...reach, { op: 'field', key }] } : head)),
    });
    // A chain that stops at the record has not produced anything to print, so
    // there is nothing to format either. Said by not offering it.
    if (!inner) return parts;
  }

  /*
   * A count is a number, and the format chips are about the value the chain
   * ends on — so a count gets a number's formats even though nothing in
   * `fields` describes it.
   */
  if (!effective && held?.kind === 'records' && reducer?.op === 'count') {
    effective = { key: '', label: 'How many', type: 'number' };
  }
  if (!effective) return parts;

  /*
   * What is done to the value the chain arrived at, if anything can be.
   *
   * One chip pair per step — an operator and what to do it with — and a `+` to
   * grow the chain, which is what keeps `⟨Price⟩ ⟨× ⟨Quantity⟩⟩ ⟨rounded to
   * ⟨0⟩⟩` a sentence rather than a formula.
   *
   * What is offered comes from `document/steps.ts`, which is §3.5's rule as a
   * table: a step the value cannot do is one that compiles and can never
   * resolve. It was two hand-written lists and a branch on the field's type
   * until E8, which is the arrangement every other vocabulary in this codebase
   * has already outgrown.
   */
  if (held) parts.push(...chainChips({ held, type: effective.type, fields, onBind }));

  /*
   * The formats for what the chain *produces*, which is not always what it
   * started on.
   *
   * Two things this gets right that asking `field` would not. After a follow
   * it is the other collection's field — offering a date's formats for a
   * reference is what the old spelling did. And after a text step it is text:
   * `⟨Price⟩ ⟨joined with " per month"⟩` is a sentence, and a currency format
   * applied to a sentence is a decoration on the wrong thing.
   */
  const ended = typeAfter(effective.type, held?.steps ?? []);
  const kinds = formatsFor(prop, ended ? { ...effective, type: ended } : effective);
  if (!kinds.length) return parts;

  parts.push({ kind: 'word', text: 'as', key: 'as' });
  parts.push(
    ...formatChips({
      format: binding.format,
      kinds,
      none: 'it is written',
      onChange: onFormat,
    })
  );
  return parts;
}

/**
 * `as ⟨currency⟩, in ⟨$⟩ ⟨before it⟩, with ⟨2⟩ decimals, as ⟨1,234⟩`.
 *
 * The format's own chips, on their own, because two places render them now: a
 * binding's terminal format, and the `written as` step that E9 added. Those
 * two are the same question — *how should this number read* — asked at
 * different points in the sentence, and a second copy of these twenty chips
 * would be two panels disagreeing about what "with 2 decimals" means within a
 * release or two.
 *
 * @param none What the "leave it alone" option says, when there is one. A
 *   binding may have no format; a `written as` step may not, because a step
 *   that formats as nothing is a step that should have been deleted.
 */
function formatChips(options: {
  format: Format | undefined;
  kinds: readonly FormatKind[];
  none?: string;
  keyPrefix?: string;
  onChange?: (format: Format | undefined) => void;
}): Part[] {
  const { format, kinds, none, keyPrefix = '', onChange } = options;
  const k = (name: string) => `${keyPrefix}${name}`;
  const parts: Part[] = [];
  parts.push({
    kind: 'pick',
    key: k('format'),
    value: format?.kind ?? '',
    menuWidth: 190,
    options: [
      ...(none ? [{ value: '', label: none }] : []),
      ...kinds.map((kind) => ({ value: kind, label: FORMAT_LABELS[kind].toLowerCase() })),
    ],
    onChange:
      onChange && ((kind) => onChange(kind ? defaultFormat(kind as FormatKind) : undefined)),
  });
  if (!format) return parts;

  switch (format.kind) {
    case 'currency':
      parts.push({ kind: 'word', text: 'in', key: 'in' });
      parts.push({
        kind: 'type',
        key: k('symbol'),
        value: format.symbol ?? '$',
        placeholder: '$',
        onChange: onChange && ((symbol) => onChange({ ...format, symbol: symbol.slice(0, 4) })),
      });
      parts.push({
        kind: 'pick',
        key: k('side'),
        value: format.after ? 'after' : 'before',
        menuWidth: 150,
        options: [
          { value: 'before', label: 'before it' },
          { value: 'after', label: 'after it' },
        ],
        onChange: onChange && ((where) => onChange({ ...format, after: where === 'after' })),
      });
    // falls through — a currency is a number with a symbol, and takes the
    // same decimals and grouping chips after it.
    case 'number':
    case 'percent':
      parts.push({ kind: 'word', text: ', with', key: 'with' });
      parts.push({
        kind: 'pick',
        key: k('decimals'),
        value: String(format.decimals ?? 0),
        menuWidth: 110,
        options: [0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) })),
        onChange: onChange && ((n) => onChange({ ...format, decimals: Number(n) })),
      });
      parts.push({ kind: 'word', text: 'decimals, as', key: 'dp' });
      parts.push({
        kind: 'pick',
        key: k('group'),
        value: format.group === false ? 'plain' : 'grouped',
        menuWidth: 130,
        options: [
          { value: 'grouped', label: '1,234' },
          { value: 'plain', label: '1234' },
        ],
        onChange: onChange && ((how) => onChange({ ...format, group: how === 'grouped' })),
      });
      break;
    case 'date':
      parts.push({
        kind: 'pick',
        key: k('pattern'),
        value: format.pattern,
        menuWidth: 180,
        options: DATE_PATTERNS.map((p) => ({ value: p.value, label: p.label })),
        onChange: onChange && ((pattern) => onChange({ ...format, pattern: pattern as DatePattern })),
      });
      break;
    case 'case':
      parts.push({
        kind: 'pick',
        key: k('to'),
        value: format.to,
        menuWidth: 190,
        options: [
          { value: 'upper', label: 'UPPERCASE' },
          { value: 'lower', label: 'lowercase' },
          { value: 'capitalize', label: 'Capitalised' },
        ],
        onChange:
          onChange && ((to) => onChange({ ...format, to: to as 'upper' | 'lower' | 'capitalize' })),
      });
      break;
    case 'truncate':
      parts.push({ kind: 'word', text: 'its first', key: 'first' });
      parts.push({
        kind: 'type',
        key: k('chars'),
        value: String(format.chars),
        numeric: true,
        onChange:
          onChange &&
          ((raw) => {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) onChange({ ...format, chars: Math.floor(n) });
          }),
      });
      parts.push({ kind: 'word', text: 'characters', key: 'chars-w' });
      break;
  }
  return parts;
}

/** The step that turns a list into one thing: a number, or one row of it. */
function isReducer(step: Step): step is Extract<Step, { op: 'count' | 'first' | 'last' }> {
  return step.op === 'count' || step.op === 'first' || step.op === 'last';
}

/**
 * `⟨× ⟨Quantity⟩⟩ ⟨rounded to ⟨0⟩⟩`, and `⟨joined with ⟨" "⟩⟩ ⟨UPPERCASE⟩`.
 *
 * One editor for both, because they are one thing: a list of transforms
 * applied left to right to whatever the chain arrived at. What differs is the
 * menu — a number cannot be capitalised and text cannot be divided — and that
 * is a parameter rather than a second copy of this function. E5 wrote the
 * arithmetic half; E7 found that the text half needed the same forty lines
 * and generalising them was cheaper than having two of them drift.
 *
 * The steps this does not edit are kept, in front. That is what stops editing
 * a sum from disturbing the `follow` that reached the record, and it is also
 * why a chain carrying *both* families — which this panel cannot author, but a
 * document can hold — renders the half that matches the type and preserves the
 * other rather than deleting it.
 */
function chainChips(options: {
  held: Value;
  /** The type the chain arrives at this editor holding. */
  type: FieldType | undefined;
  fields: Field[];
  keyPrefix?: string;
  onBind?: (value: Value | null) => void;
}): Part[] {
  const { held, type, fields, keyPrefix = '', onBind } = options;
  const steps = held.steps ?? [];
  const chain = steps.filter(isTransform);
  const before = steps.filter((step) => !isTransform(step));
  const write = (next: Step[]) => onBind?.({ ...held, steps: [...before, ...next] });
  /** The chain with one step replaced, which is every edit here. */
  const at = (index: number, step: Step) => write(chain.map((one, i) => (i === index ? step : one)));
  const k = (name: string) => `${keyPrefix}${name}`;

  const parts: Part[] = [];
  chain.forEach((step, index) => {
    /*
     * The menu at *this* position, from the type in hand *here*.
     *
     * Folded through the steps before it rather than taken from the head,
     * which is what makes this generated rather than filtered: after a join
     * the value is text, so the step after it is offered text's vocabulary
     * even though the chain started on a number.
     */
    const offered = stepsFor(typeAfter(type, chain.slice(0, index)));
    parts.push({
      kind: 'pick',
      key: k(`op${index}`),
      value: step.op,
      menuWidth: 170,
      // The step's own label, always, even when the type would not offer it —
      // a document can carry a chain this panel would not write, and a chip
      // falling through to its placeholder would say nothing was chosen.
      options: (offered.includes(step.op) ? offered : [...offered, step.op]).map((op) => ({
        value: op,
        label: STEPS[op]?.label ?? op,
      })),
      onChange:
        onBind && ((op) => at(index, seedStep(op, step, FORMATS_FOR[typeAfter(type, chain.slice(0, index)) ?? 'text'][0]))),
    });

    /*
     * And what the step is done *with*, for the three that take something.
     * The two operand chips are the same two-mode box the right of a
     * comparison uses — a constant, or a field of the same type through the
     * chevron — because it is the same question asked in a different sentence.
     */
    if (step.op === 'formatted') {
      /*
       * The format's own chips, at this point in the sentence rather than at
       * the end of it. Same builder as the binding's terminal format, so
       * `written as ⟨currency⟩ in ⟨£⟩ ⟨before it⟩` reads and behaves exactly
       * as the tail does — and no "leave it alone" option, because a step
       * that formats as nothing is a step somebody meant to delete.
       */
      parts.push(
        ...formatChips({
          format: step.as,
          kinds: FORMATS_FOR[typeAfter(type, chain.slice(0, index)) ?? 'text'],
          keyPrefix: k(`fmt${index}-`),
          onChange: onBind && ((as) => as && at(index, { op: 'formatted', as })),
        })
      );
    } else if (step.op === 'round') {
      parts.push({
        kind: 'type',
        key: k(`by${index}`),
        value: String(step.places ?? 0),
        placeholder: '0',
        numeric: true,
        onChange: onBind && ((raw) => at(index, { op: 'round', places: Number(raw.trim()) || 0 })),
      });
    } else if (step.op === 'truncate') {
      parts.push({
        kind: 'type',
        key: k(`by${index}`),
        value: String(step.chars ?? 0),
        placeholder: '20',
        numeric: true,
        onChange: onBind && ((raw) => at(index, { op: 'truncate', chars: Number(raw.trim()) || 0 })),
      });
      parts.push({ kind: 'word', text: 'characters', key: k(`chars${index}`) });
    } else if (step.op === 'join') {
      parts.push({
        kind: 'type',
        key: k(`by${index}`),
        value: literalText(step.with) || fieldLabel(step.with, fields),
        placeholder: 'text',
        menuWidth: 200,
        pickLabel: 'Use text from the record',
        options: among(fields, 'text').map((f) => ({ value: f.key, label: f.label })),
        onChange: onBind && ((raw) => at(index, { op: 'join', with: textFor(raw) })),
        onPick: onBind && ((key) => at(index, { op: 'join', with: { kind: 'field', key } })),
      });
    } else if ('by' in step) {
      parts.push({
        kind: 'type',
        key: k(`by${index}`),
        value: literalText(step.by) || fieldLabel(step.by, fields),
        placeholder: '0',
        numeric: step.by.kind === 'literal',
        menuWidth: 200,
        pickLabel: 'Use a number from the record',
        options: among(fields, 'number').map((f) => ({ value: f.key, label: f.label })),
        onChange: onBind && ((raw) => at(index, { ...step, by: numberFor(raw) })),
        onPick: onBind && ((key) => at(index, { ...step, by: { kind: 'field', key } })),
      });
    }
  });

  /*
   * And what can be done to whatever the chain ends on, which is the offer the
   * `+` makes. Empty for a type with no steps — a boolean, an image — so the
   * button is absent rather than present and useless.
   */
  const next = stepsFor(typeAfter(type, chain));
  const arithmetic = next.includes('times');
  if (onBind && next.length && chain.length < 3) {
    parts.push({
      kind: 'action',
      key: k('add-step'),
      title: arithmetic ? 'Do something to this number' : 'Do something to this text',
      label: <span className="text-[10px]">{arithmetic ? '+ maths' : '+ text'}</span>,
      // A step that changes nothing, so the sentence it lands in is
      // grammatical and finished-looking before anybody types: `× 1` and
      // `joined with ⟨⟩` both leave the value exactly as it was.
      onClick: () =>
        write([...chain, seedStep(next[0]!, undefined, FORMATS_FOR[typeAfter(type, chain) ?? 'text'][0])]),
    });
  }
  if (onBind && chain.length) {
    parts.push({
      kind: 'action',
      key: k('drop-step'),
      title: 'Remove the last step',
      label: <Trash2 size={10} />,
      onClick: () => write(chain.slice(0, -1)),
    });
  }
  return parts;
}

/**
 * A step of the chosen kind, keeping what the old one can lend it.
 *
 * Switching `×` to `+` should not clear the operand somebody chose — it is the
 * same operand, asked a different question — and switching `×` to `UPPERCASE`
 * has nothing to keep. Written once because the add button and the operator
 * chip both need it and they must agree about what a fresh step looks like.
 */
function seedStep(op: string, from?: Step, seed?: FormatKind): Step {
  if (op === 'round') return { op: 'round', places: 0 };
  if (op === 'truncate') return { op: 'truncate', chars: 20 };
  if (op === 'join') {
    return { op: 'join', with: from && 'with' in from ? from.with : textFor('') };
  }
  // Seeded with the format the type's menu offers first, so the step says
  // something the moment it appears rather than waiting to be filled in.
  if (op === 'formatted') return { op: 'formatted', as: defaultFormat(seed ?? 'number') };
  if (op === 'upper' || op === 'lower' || op === 'capitalize') return { op } as Step;
  return { op: op as 'plus', by: from && 'by' in from ? from.by : numberFor('1') };
}

/**
 * `only when ⟨Post⟩ is ⟨this Property⟩` and `by ⟨Date⟩ ⟨Z → A⟩`.
 *
 * The two clauses that sit between a list and what is taken out of it. Its own
 * function because it is where the panel's canonical order lives — narrow,
 * then order, then reduce — and that order is a decision rather than a
 * formatting detail. Every write goes through `put`, which rebuilds the lead of
 * the chain from the two clauses and leaves everything past the reducer exactly
 * where it was, so editing the filter cannot disturb the field or the maths
 * after it.
 *
 * The model does not require the order; `advance` applies whatever it is
 * handed, and a document that narrows after it sorts gets the same rows. The
 * panel picks one so that two people writing the same sentence produce the same
 * document.
 */
function listClauses(options: {
  held: Value;
  list: Collection;
  steps: Step[];
  at: number;
  reducer: Extract<Step, { op: 'count' | 'first' | 'last' }>;
  fields: Field[];
  scope?: Collection;
  onBind?: (value: Value | null) => void;
}): Part[] {
  const { held, list, steps, at, reducer, fields, scope, onBind } = options;
  const lead = steps.slice(0, at);
  const rest = steps.slice(at + 1);
  const filter = lead.find((one): one is Extract<Step, { op: 'where' }> => one.op === 'where');
  const order = lead.find(
    (one): one is Extract<Step, { op: 'sortedBy' }> => one.op === 'sortedBy'
  );
  const put = (
    narrow: Extract<Step, { op: 'where' }> | undefined,
    sorted: Extract<Step, { op: 'sortedBy' }> | undefined
  ) =>
    onBind?.({
      ...held,
      steps: [...(narrow ? [narrow] : []), ...(sorted ? [sorted] : []), reducer, ...rest],
    });

  const parts: Part[] = [];
  /*
   * "in total", for exactly as long as it is true.
   *
   * The words E4 put in the menu label, moved out of it. In the label they
   * were a promise the sentence could not take back once `where` existed —
   * "How many Comments, in total, only when Post is this Post" is a sentence
   * that contradicts itself in the middle.
   */
  if (reducer.op === 'count' && !filter) {
    parts.push({ kind: 'word', text: 'in total', key: 'total' });
  }

  if (filter) {
    parts.push({
      kind: 'clause',
      key: 'where',
      parts: [
        ...testSentence({
          test: filter.test,
          fields,
          rowFields: list.fields,
          scope,
          opening: 'only when',
          newLeaf: list.fields[0] && (() => blankRowTest(list.fields[0]!, scope)),
          onChange: onBind && ((next) => put({ op: 'where', test: next }, order)),
        }),
        ...(onBind
          ? [
              {
                kind: 'action' as const,
                key: 'drop-where',
                title: 'Count all of them again',
                label: <Trash2 size={10} />,
                onClick: () => put(undefined, order),
              },
            ]
          : []),
      ],
    });
  } else if (onBind && list.fields[0]) {
    parts.push({
      kind: 'action',
      key: 'add-where',
      title: `Only some of the ${list.name}`,
      label: <span className="text-[10px]">+ only when</span>,
      onClick: () => put({ op: 'where', test: blankRowTest(list.fields[0]!, scope) }, order),
    });
  }

  /*
   * And the order, which only the ends of a list care about.
   *
   * A count is the same number whichever way the rows are arranged, so
   * offering `by ⟨Date⟩` beside one would be a chip that provably does
   * nothing — §3.5's rule, and the cheapest possible instance of it.
   */
  if (reducer.op !== 'count') {
    if (order) {
      parts.push({
        kind: 'clause',
        key: 'sorted',
        parts: [
          { kind: 'word', text: 'by', key: 'by' },
          {
            kind: 'pick',
            key: 'sort-field',
            value: order.field,
            placeholder: 'a field',
            menuWidth: 200,
            options: list.fields.map((f) => ({ value: f.key, label: f.label })),
            onChange: onBind && ((key) => put(filter, { ...order, field: key })),
          },
          {
            // The repeater's two words, deliberately. One idea, one wording:
            // a designer who has sorted a list has sorted this one.
            kind: 'pick',
            key: 'sort-dir',
            value: order.desc ? 'desc' : 'asc',
            menuWidth: 104,
            options: [
              { value: 'asc', label: 'A → Z' },
              { value: 'desc', label: 'Z → A' },
            ],
            onChange:
              onBind &&
              ((direction) =>
                put(
                  filter,
                  direction === 'desc'
                    ? { op: 'sortedBy', field: order.field, desc: true }
                    : // Absent rather than `desc: false`, so two documents
                      // meaning ascending are one document.
                      { op: 'sortedBy', field: order.field }
                )),
          },
          ...(onBind
            ? [
                {
                  kind: 'action' as const,
                  key: 'drop-sort',
                  title: 'Back to the collection order',
                  label: <Trash2 size={10} />,
                  onClick: () => put(filter, undefined),
                },
              ]
            : []),
        ],
      });
    } else if (onBind && list.fields[0]) {
      parts.push({
        kind: 'action',
        key: 'add-sort',
        title: 'Choose which one that is',
        label: <span className="text-[10px]">+ in order of</span>,
        onClick: () => put(filter, { op: 'sortedBy', field: list.fields[0]!.key }),
      });
    }
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
    const isQuery = condition.source.startsWith(QUERY_PREFIX);
    const offered = offerableSources();
    /*
     * Which fact about the visit, as a chip rather than a word.
     *
     * It was a word — unclickable — so the source was whatever the When… menu
     * seeded and stayed there, and the menu seeds `DATA_SOURCES[0]`. That made
     * *time of day* the only condition on a visit anybody could write, while
     * `referrer` and every URL parameter compiled, shipped, resolved before
     * paint and could not be asked for. X1's finding on the other axis, still
     * open. See §4.1.21.
     */
    return [
      {
        kind: 'pick',
        key: k('source'),
        value: offered.some((one) => one.id === condition.source)
          ? condition.source
          : isQuery
            ? OTHER_QUERY
            : condition.source,
        menuWidth: 230,
        options: [
          ...offered.map((one) => ({ value: one.id, label: one.label, hint: one.hint })),
          {
            value: OTHER_QUERY,
            label: 'Another URL parameter',
            hint: 'Anything the link carries — a campaign, a variant',
          },
          // A source nothing offers, kept nameable rather than shown as unset:
          // the same reason a deleted element keeps a label.
          ...(!isQuery && !offered.some((one) => one.id === condition.source)
            ? [{ value: condition.source, label: condition.source }]
            : []),
        ],
        onChange: (next) => {
          if (next === OTHER_QUERY) {
            onChange({ ...condition, source: `${QUERY_PREFIX}ref`, values: [] });
            return;
          }
          // A new source is a new set of values, and the old one's mean
          // nothing against it.
          const picked = describeSource(next);
          onChange({ ...condition, source: next, values: picked?.values.slice(0, 1) ?? [] });
        },
      },
      // And which parameter, when it is one the site does not name itself.
      ...(isQuery && !offered.some((one) => one.id === condition.source)
        ? [
            {
              kind: 'type' as const,
              key: k('param'),
              value: condition.source.slice(QUERY_PREFIX.length),
              placeholder: 'name',
              onChange: (raw: string) => {
                const name = slugList(raw).split(' ')[0] ?? '';
                if (name) onChange({ ...condition, source: `${QUERY_PREFIX}${name}` });
              },
            },
          ]
        : []),
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
export function ruleSentence(rule: StyleRule, fields: Field[] = []): Part[] {
  if (!rule.when) {
    return [
      { kind: 'word', text: 'Always', key: 'always' },
      ...(rule.part ? [{ kind: 'word' as const, text: `· ${rule.part}`, key: 'part' }] : []),
    ];
  }
  /*
   * `fields` is what turns `a field …` into `Asking price`.
   *
   * It was hard-coded empty here, so a rule conditioned on the record read as
   * "a field is" in the row above the sentence that spelled it out correctly —
   * the placeholder for *nothing chosen*, over a rule where something plainly
   * had been. Harmless while a field comparison in a style rule was an
   * unusual thing to write, and not once E1 made "when Price is over Budget"
   * the reason the panel exists.
   */
  const parts = testSentence({ test: rule.when, fields, opening: '' });
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
