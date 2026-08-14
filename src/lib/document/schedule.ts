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

import type { CollectionRecord, CompareOp, Test, TestLiteral, Value } from './types';

/** True, false, or "not from here". */
export type Verdict = boolean | null;

/** What a record's field holds. */
type Raw = string | number | boolean | null | undefined;

/**
 * An operand this evaluator could resolve, and how much it knows about it.
 *
 * `type` is the declared one, and only a literal has it — which is the whole
 * of the coercion story: a comparison against a constant is made *in the type
 * that constant was typed as*, and a comparison against a field is made in
 * whatever that field turned out to hold. See `compare`.
 *
 * `has` separates absent from present-and-empty, because `empty` is the
 * operator that exists to tell them apart.
 */
type Known = { raw: Raw; has: boolean; type?: TestLiteral['type'] };

/**
 * What a Value is worth at publish time, or `null` for "not from here".
 *
 * The scheduling rule in one function, and `foldable` is the same question
 * asked without a record: a literal is known because somebody typed it, a
 * field is known because the record is right here, and a control's value is
 * not known because nobody has typed anything yet. That last one is not
 * `false` — "empty because the page has not been visited" is the absence of a
 * fact rather than a fact.
 */
function known(value: Value, record: CollectionRecord | null): Known | null {
  if (value.kind === 'literal') return { raw: value.value, has: true, type: value.type };
  if (value.kind !== 'field') return null;
  if (!record) return null;
  const has = value.key in record.data;
  return { raw: has ? (record.data[value.key] as Raw) : undefined, has };
}

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
      const left = known(test.left, record);
      if (!left) return null;
      // Absent and present-but-empty are different, and only the second is a
      // value. `empty` is the operator that exists to tell them apart, so it
      // is the one operator a missing field can still answer.
      if (test.op === 'empty' || test.op === 'notEmpty') return compare(left.raw, test.op, null);
      if (!left.has) return null;
      // The same three questions of the other side, which is what makes
      // `Price > Budget` sayable: a right-hand operand that is absent from
      // this record leaves the comparison undecided rather than false, exactly
      // as a missing left-hand one does.
      const right = test.right ? known(test.right, record) : null;
      if (!right || !right.has) return null;
      return compare(left.raw, test.op, right);
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

function compare(raw: Raw, op: CompareOp, right: Known | null): Verdict {
  const absent = raw === null || raw === undefined || raw === '';
  if (op === 'empty') return absent;
  if (op === 'notEmpty') return !absent;
  if (!right) return null;

  /*
   * The right side says what type the comparison is made in, and the left is
   * coerced to it. A constant declares one, because `literalFor` typed it from
   * the field the sentence is about; a field does not, so what it holds is the
   * witness instead — which is not inference in the sense the rule forbids,
   * because the alternative is not "ask the declaration", it is "have no
   * answer at all".
   *
   * A mismatch is still undecidable rather than false: `price > "sold"` has no
   * answer, and answering it would make a typo look like a design decision.
   * This mirrors `testRuntime`'s `holds` line for line, and it has to — the
   * canvas, the file and the browser are one renderer's three surfaces.
   */
  const as = right.type ?? typeof right.raw;
  if (as === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    const to = typeof right.raw === 'number' ? right.raw : Number(String(right.raw).trim());
    if (!Number.isFinite(n) || !Number.isFinite(to)) return null;
    return ordered(n, op, to);
  }

  if (as === 'boolean') {
    if (typeof raw !== 'boolean') return null;
    if (op === 'eq') return raw === right.raw;
    if (op === 'neq') return raw !== right.raw;
    return null;
  }

  // Text. Ordered comparisons on text are refused rather than done
  // code-point-wise: "is this name greater than that one" is a locale
  // question, and locale questions are the ones this codebase does not answer.
  const text = absent ? '' : String(raw);
  const want = String(right.raw);
  switch (op) {
    case 'eq':
      return text === want;
    case 'neq':
      return text !== want;
    case 'contains':
      return text.toLowerCase().includes(want.toLowerCase());
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
      // Every operand, not only the first. A comparison folds when both sides
      // do, and `foldableValue` is the whole of the rule — it is asked of one
      // Value at a time so that the answer does not have to be rewritten each
      // time a Value can be made of more parts.
      return foldableValue(test.left) && (!test.right || foldableValue(test.right));
    case 'every':
    case 'some':
      return test.tests.every(foldable);
    default:
      // A Condition is resolved by the browser, by definition.
      return false;
  }
}

/**
 * Whether one operand is known when the site is published.
 *
 * The two that are: a field, because the record is compiled into the page, and
 * a literal, because somebody typed it into the panel. The two that are not
 * are the two that read a form control, and they are why there is a runtime at
 * all.
 */
export function foldableValue(value: Value): boolean {
  return value.kind === 'field' || value.kind === 'literal';
}
