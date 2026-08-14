/**
 * When a Test can be answered, and what it answers.
 *
 * Split out of `renderer/test.ts` for the reason `when.ts` was split out of
 * `conditions.ts`: two things need it and one of them is upstream of the
 * renderer. The scheduling rule now decides three separate questions — how a
 * style rule compiles, how an assignment is published, and whether an action's
 * `only` travels — and the third is asked by `document/actions.ts`, which the
 * renderer imports. Leaving these there made that a cycle.
 *
 * Nothing here knows about rendering. It is a Test, a record, and the two
 * questions worth asking of the pair.
 */

import type { CollectionRecord, CompareOp, Test, TestLiteral } from './types';

/** True, false, or "not from here". */
export type Verdict = boolean | null;

/** What a record's field holds. */
type Raw = string | number | boolean | null | undefined;

/* --------------------------------------------------------------------------
 * Evaluating
 * ----------------------------------------------------------------------- */

/**
 * Whether the Test holds for this record.
 *
 * @param record The record in scope, or null when there is none — which is
 *   not the same as an empty one. With no record a field comparison cannot be
 *   answered at all, so it is `null` rather than `false`: a card outside any
 *   repeater has not failed the test, it was never in a position to take it.
 */
export function evaluate(test: Test, record: CollectionRecord | null): Verdict {
  switch (test.kind) {
    case 'compare': {
      // A form control's value is the operand this function exists to *not*
      // answer. Nobody has typed anything when a page is being published, and
      // "empty because nothing has been typed yet" is not a fact about the
      // page — it is the absence of one.
      if (test.left.kind !== 'field') return null;
      if (!record) return null;
      // Absent and present-but-empty are different, and only the second is a
      // value. `empty` is the operator that exists to tell them apart, so it
      // is the one operator a missing field can still answer.
      const has = test.left.key in record.data;
      const raw = has ? record.data[test.left.key] : undefined;
      if (!has && test.op !== 'empty' && test.op !== 'notEmpty') return null;
      return compare(raw, test.op, test.right);
    }
    case 'every': {
      // One false settles it. One undecidable, with no false, leaves the whole
      // thing undecidable — `A && B` is not knowable when B is not.
      let unknown = false;
      for (const inner of test.tests) {
        const verdict = evaluate(inner, record);
        if (verdict === false) return false;
        if (verdict === null) unknown = true;
      }
      return unknown ? null : true;
    }
    case 'some': {
      let unknown = false;
      for (const inner of test.tests) {
        const verdict = evaluate(inner, record);
        if (verdict === true) return true;
        if (verdict === null) unknown = true;
      }
      return unknown ? null : false;
    }
    default:
      /*
       * A `Condition` — pointer, control, state, attr, data. These are the
       * CSS-compilable subset, and they are compilable precisely because they
       * are answered by the browser rather than by the publisher. Nothing here
       * can decide one, and pretending otherwise would put a hover state into
       * a published file.
       */
      return null;
  }
}

function compare(raw: Raw, op: CompareOp, right: TestLiteral | undefined): Verdict {
  const absent = raw === null || raw === undefined || raw === '';
  if (op === 'empty') return absent;
  if (op === 'notEmpty') return !absent;
  if (!right) return null;

  // Types are declared, never inferred, and a mismatch is undecidable rather
  // than false: `price > "sold"` has no answer, and answering it would make a
  // typo look like a design decision.
  if (right.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) return null;
    return ordered(n, op, right.value);
  }

  if (right.type === 'boolean') {
    if (typeof raw !== 'boolean') return null;
    if (op === 'eq') return raw === right.value;
    if (op === 'neq') return raw !== right.value;
    return null;
  }

  // Text. Ordered comparisons on text are refused rather than done
  // code-point-wise: "is this name greater than that one" is a locale
  // question, and locale questions are the ones this codebase does not answer.
  const text = absent ? '' : String(raw);
  switch (op) {
    case 'eq':
      return text === right.value;
    case 'neq':
      return text !== right.value;
    case 'contains':
      return text.toLowerCase().includes(right.value.toLowerCase());
    default:
      return null;
  }
}

function ordered(left: number, op: CompareOp, right: number): Verdict {
  switch (op) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    default:
      return null;
  }
}


/**
 * Whether every input a Test reads is known when the site is published.
 *
 * This is the whole of the execution model's scheduling decision, and it is
 * derived rather than chosen: *fold when every dependency is publish-time
 * data, subscribe when any dependency can change after publish.* Nobody picks
 * a mode.
 */
export function foldable(test: Test): boolean {
  switch (test.kind) {
    case 'compare':
      return test.left.kind === 'field';
    case 'every':
    case 'some':
      return test.tests.every(foldable);
    default:
      // A Condition is resolved by the browser, by definition.
      return false;
  }
}
