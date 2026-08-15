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

import type { CollectionRecord, CompareOp, Step, Test, TestLiteral, Value } from './types';
import { compareWith } from './records';

/** True, false, or "not from here". */
export type Verdict = boolean | null;

/** What a record's field holds. */
type Raw = string | number | boolean | null | undefined;

/**
 * How a chain reaches records that are not the one in scope.
 *
 * Two questions, because a chain asks two. `byId` is what `follow` needs: a
 * record id is unique across a project, so following a reference is a lookup
 * rather than a search — and a step that had to name its target collection
 * would be a second copy of the field's `of`, free to go stale the day
 * somebody repoints it. `of` is what a `records` head needs, which is the
 * other direction entirely: every row of one collection.
 *
 * Optional everywhere it is taken. A caller with no records to hand is not
 * wrong, it is somewhere that cannot answer this — so a `follow` without one
 * is `null`, *cannot decide here*, which is the same answer the model already
 * gives for a control's value at publish time.
 */
export interface RecordLookup {
  byId(id: string): CollectionRecord | null;
  /** Every published row of a collection, in the order a list would draw them. */
  of(collection: string): CollectionRecord[];
}

/**
 * The older name, kept because six files thread this value through without
 * ever calling it and renaming them all would be churn for its own sake.
 */
export type FindRecord = RecordLookup;

/**
 * What a chain is worth, part way along it.
 *
 * A chain is not scalar all the way down: `⟨Author⟩ ⟨→ the record⟩ ⟨Name⟩` is
 * a value, then a *record*, then a value again. Saying so in the type is what
 * stops `follow` from having to pretend a record is a string — and it is the
 * shape E4 grows a third member of, when a chain can also be a list.
 *
 * On the value side, `type` is the declared one and only a literal has it,
 * which is the whole of the coercion story: a comparison against a constant is
 * made *in the type that constant was typed as*, and one against a field is
 * made in whatever that field turned out to hold. See `compare`.
 *
 * `has` separates absent from present-and-empty, because `empty` is the
 * operator that exists to tell them apart.
 */
type Resolved =
  | { at: 'value'; raw: Raw; has: boolean; type?: TestLiteral['type'] }
  | { at: 'record'; record: CollectionRecord }
  | { at: 'list'; records: CollectionRecord[] };

/** The scalar a chain ended on, or nothing if it ended on a record. */
type Known = Extract<Resolved, { at: 'value' }>;

/**
 * What a Value is worth at publish time, or `null` for "not from here".
 *
 * The scheduling rule in one function, and `foldable` is the same question
 * asked without a record: a literal is known because somebody typed it, a
 * field is known because the record is right here, and a control's value is
 * not known because nobody has typed anything yet. That last one is not
 * `false` — "empty because the page has not been visited" is the absence of a
 * fact rather than a fact.
 *
 * Exported because the binder needs exactly this: `boundProps` used to read
 * `record.data[key]` itself, which was the whole of a `Value` when a `Value`
 * was one leaf. Two resolvers walking one chain is how the canvas and the file
 * come to disagree, so there is one.
 */
export function resolveValue(
  value: Value,
  record: CollectionRecord | null,
  find?: RecordLookup,
  row?: CollectionRecord | null
): Known | null {
  let at: Resolved | null = headOf(value, record, find, row);

  for (const step of value.steps ?? []) {
    if (!at) return null;
    at = advance(at, step, record, find, row);
  }

  // A chain that ends on a record has not produced a value. Nothing downstream
  // can print or compare one, so it says so rather than stringifying an id.
  return at && at.at === 'value' ? at : null;
}

/** Where the chain starts, before any step has been applied. */
function headOf(
  value: Value,
  record: CollectionRecord | null,
  find: RecordLookup | undefined,
  row: CollectionRecord | null | undefined
): Resolved | null {
  switch (value.kind) {
    case 'literal':
      return { at: 'value', raw: value.value, has: true, type: value.type };
    case 'field':
      return record ? fieldOf(record, value.key) : null;
    /*
     * The row a `where` is asking about. Nothing else ever has one in hand, so
     * this head answering `null` everywhere else is what makes it "legal only
     * inside a `where`" without anything having to check.
     */
    case 'row':
      return row ? fieldOf(row, value.key) : null;
    /*
     * The record in scope, as its id — the other half of `⟨row's Post⟩ is
     * ⟨this Post⟩`. Always present when there is a record at all, which is why
     * it carries `has: true` unconditionally: a record without an id is not a
     * record.
     */
    case 'self':
      return record ? { at: 'value', raw: record.id, has: true } : null;
    case 'records':
      // A list, and an *empty* list is still a list — the collection having no
      // rows is a fact, and `count` has to be able to say 0 about it. `null`
      // here would make "0 comments" indistinguishable from "this surface has
      // no records", which is the case E4 exists to keep apart.
      return find ? { at: 'list', records: find.of(value.collection) } : null;
    default:
      // `input` and `element` read a form control, which is the operand this
      // function exists to *not* answer.
      return null;
  }
}

/**
 * One step, applied.
 *
 * Its own function rather than the body of the loop above, and not only for
 * reading: a `let` reassigned inside a loop from an expression that reads its
 * own narrowed type is a circular inference, and TypeScript says so.
 */
function advance(
  at: Resolved,
  step: Step,
  record: CollectionRecord | null,
  find: RecordLookup | undefined,
  row: CollectionRecord | null | undefined
): Resolved | null {
  if (step.op === 'follow') {
    // Only an id can be followed, and only from the value side. A `follow`
    // straight after a `follow` would be following a record, which the panel
    // does not offer and the model should not invent an answer for.
    if (at.at !== 'value' || !at.has || !find) return null;
    const raw: Raw = at.raw;
    const id = raw === null || raw === undefined ? '' : String(raw);
    // The record is gone, or the reference was never set. Undecidable rather
    // than empty: "the author was deleted" and "this post has no author" are
    // different facts, and neither of them is a name.
    const found: CollectionRecord | null = id ? find.byId(id) : null;
    return found ? { at: 'record', record: found } : null;
  }

  /*
   * The list steps.
   *
   * `count` is the one that answers on an empty list, and the only step in the
   * whole vocabulary that does. Everything else says `null` for "nothing
   * here", and a binding reads `null` as *leave the design-time text alone* —
   * which for a count would print the placeholder where a truthful "0"
   * belongs. The empty case is the one that reads as broken, so it is the one
   * written down.
   */
  if (step.op === 'count') {
    if (at.at !== 'list') return null;
    return { at: 'value', raw: at.records.length, has: true };
  }
  if (step.op === 'first' || step.op === 'last') {
    if (at.at !== 'list') return null;
    const end = step.op === 'first' ? at.records[0] : at.records[at.records.length - 1];
    // No rows means no record, which is genuinely nothing to say — unlike a
    // count of them.
    return end ? { at: 'record', record: end } : null;
  }

  /*
   * The rows that pass, and only the rows that pass.
   *
   * `=== true` rather than `!== false`, which is the three-valued rule this
   * codebase applies everywhere else pointed at a set: a row whose answer
   * cannot be decided — the field is absent, the types do not match — is not a
   * row somebody asked for. `foldedAttrs` leaves an undecidable attribute off
   * and `stateFrom` passes an undecidable rule over; this leaves the row out.
   *
   * The candidate becomes the `row` in scope and the record in scope stays
   * exactly what it was, which is the whole point of the two heads: `⟨row's
   * Post⟩ is ⟨this Post⟩` is two records named in one sentence.
   */
  if (step.op === 'where') {
    if (at.at !== 'list') return null;
    return {
      at: 'list',
      records: at.records.filter(
        (candidate) => evaluate(step.test, record, find, candidate) === true
      ),
    };
  }

  /*
   * The same rows, in a different order.
   *
   * Copied before sorting, because the array came out of `find.of` and that is
   * the *cached* list for the collection — sorting in place would reorder
   * every other chain on the page, and the repeater underneath it.
   *
   * `compareWith` rather than a comparator of its own: see
   * `document/records.ts`. A hero reading "the newest post" over a list sorted
   * the same way has to name the row at the top of it.
   */
  if (step.op === 'sortedBy') {
    if (at.at !== 'list') return null;
    const ordered = [...at.records];
    ordered.sort(compareWith({ field: step.field, direction: step.desc ? 'desc' : 'asc' }));
    return { at: 'list', records: ordered };
  }

  /*
   * Rounding, mid-chain.
   *
   * `toFixed` because it is specified to the digit, so the Worker and the
   * browser cannot disagree — the same argument `format.ts` makes at length.
   * Clamped because `toFixed` *throws* outside 0–100 and a hand-written
   * document must not be able to take a publish down.
   */
  if (step.op === 'round') {
    if (at.at !== 'value') return null;
    const n = Number(at.raw);
    if (!Number.isFinite(n)) return null;
    const places = Math.min(10, Math.max(0, Math.trunc(step.places) || 0));
    return { at: 'value', raw: Number(n.toFixed(places)), has: true };
  }

  // `'by' in step` rather than four `op` comparisons: one member of `Step`
  // carries a four-way `op`, and TypeScript will not narrow it away on the
  // else branch however many of the four are listed. The operand is what makes
  // these steps what they are anyway.
  if ('by' in step) {
    if (at.at !== 'value' || !at.has) return null;
    // The row travels into the operand too: `⟨row's Price⟩ × ⟨2⟩ is over ⟨100⟩`
    // is a `where` test whose left side has a step of its own, and an operand
    // resolved without the row in hand would answer nothing on every row.
    const other = resolveValue(step.by, record, find, row);
    if (!other || !other.has) return null;
    const a = Number(at.raw);
    const b = Number(other.raw);
    // Arithmetic on something that is not a number has no answer, and
    // answering `NaN` would put the word in the markup. Same rule as a type
    // mismatch in a comparison: undecidable rather than wrong.
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // And dividing by nothing is the same kind of nothing. `Infinity` is a
    // real number to JavaScript and a bug to a reader.
    if (step.op === 'over' && b === 0) return null;
    const out =
      step.op === 'plus' ? a + b : step.op === 'minus' ? a - b : step.op === 'times' ? a * b : a / b;
    return { at: 'value', raw: out, has: true };
  }

  if (at.at !== 'record') return null;
  return fieldOf(at.record, step.key);
}

/** One field of one record, keeping absent and present-but-empty apart. */
function fieldOf(record: CollectionRecord, key: string): Known {
  const has = key in record.data;
  return { at: 'value', raw: has ? (record.data[key] as Raw) : undefined, has };
}

/**
 * Every operand in a Test, however deeply grouped.
 *
 * `fieldsRead`, `inputsRead` and `refsInTest` used to be three copies of one
 * walk, each reading `left` and each wrong the day a comparison grew a second
 * operand. Declared once and derived from, for the reason `content-props.ts`
 * gives: two lists kept in step by nobody drift, and they drift silently.
 *
 * Here rather than in `renderer/test.ts`, where it was written, because
 * `repeat.ts` needs it to know which collections a page reads — and
 * `repeat.ts → renderer/test.ts → document/actions.ts → renderer/test.ts` is a
 * cycle. This module is what a `Value` means, which is where the walk belongs.
 *
 * Order is source order — left before right, and a group's members in the
 * order they were written — because one caller prints them.
 */
export function operandsIn(test: Test): Value[] {
  const out: Value[] = [];
  const walk = (inner: Test): void => {
    if (inner.kind === 'compare') {
      out.push(...valuesIn(inner.left));
      if (inner.right) out.push(...valuesIn(inner.right));
    } else if (inner.kind === 'every' || inner.kind === 'some') inner.tests.forEach(walk);
  };
  walk(test);
  return out;
}

/**
 * One operand, and every operand nested inside its steps.
 *
 * `⟨Price⟩ × ⟨Quantity⟩` reads two fields and only one of them is the head, so
 * a walk that stopped at the head would ship `price` to the runtime and leave
 * `quantity` behind — a comparison that answers `null` for ever, on a page
 * with no sign of why. The same failure `fieldsRead` had when it read `left`
 * alone, one level down.
 */
export function valuesIn(value: Value): Value[] {
  const out: Value[] = [value];
  for (const step of value.steps ?? []) {
    if ('by' in step) out.push(...valuesIn(step.by));
    /*
     * And everything a `where` compares, which is where the second half of a
     * relational chain lives: `⟨Comments⟩ where ⟨row's Post⟩ is ⟨this Post⟩`
     * reads the record in scope from inside a step, and a walk that stopped at
     * the head would not know the page depended on it.
     *
     * `row` heads come back too and are harmless: every caller filters by
     * kind, and a row's field is deliberately not one of the record's — a
     * `where` on `Comments.title` must not make deleting `Posts.title` clear
     * the binding.
     */
    if (step.op === 'where') out.push(...operandsIn(step.test));
  }
  return out;
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
 * @param find How to reach a record a reference names. Omitted by every caller
 *   that has no records to hand, which makes a `follow` undecidable there
 *   rather than wrong.
 * @param row The candidate a `where` is asking about. Bound by `advance` and
 *   by nothing else — every other caller passes none, which is what makes a
 *   `row` head outside a `where` answer nothing rather than answer wrongly.
 */
export function evaluate(
  test: Test,
  record: CollectionRecord | null,
  find?: RecordLookup,
  row?: CollectionRecord | null
): Verdict {
  switch (test.kind) {
    case 'compare': {
      // A form control's value is the operand this function exists to *not*
      // answer. Nobody has typed anything when a page is being published, and
      // "empty because nothing has been typed yet" is not a fact about the
      // page — it is the absence of one.
      const left = resolveValue(test.left, record, find, row);
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
      const right = test.right ? resolveValue(test.right, record, find, row) : null;
      if (!right || !right.has) return null;
      return compare(left.raw, test.op, right);
    }
    case 'every': {
      // One false settles it. One undecidable, with no false, leaves the whole
      // thing undecidable — `A && B` is not knowable when B is not.
      let unknown = false;
      for (const inner of test.tests) {
        const verdict = evaluate(inner, record, find, row);
        if (verdict === false) return false;
        if (verdict === null) unknown = true;
      }
      return unknown ? null : true;
    }
    case 'some': {
      let unknown = false;
      for (const inner of test.tests) {
        const verdict = evaluate(inner, record, find, row);
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
 * The heads that are: a field and a row's field, because the records are
 * compiled into the page; a literal, because somebody typed it into the panel;
 * a list, because it is the rows the page was published with; and this
 * record's id, because a record with no id is not one. The two that are not
 * are the two that read a form control, and they are why there is a runtime at
 * all.
 *
 * Most steps do not change the answer, and that is `VALUES.md` §3.3 in one
 * line: `follow`, `field`, `count`, `first`, `where` and `sortedBy` can only
 * ever appear over a record or a list, both of which are publish-time data, so
 * a chain that folds at its head folds all the way down and costs the browser
 * nothing. It stops being true the day a list can change after publish — see
 * §6, where that is settled as *not yet* rather than *never* — and the day it
 * does, this function is where it stops.
 */
export function foldableValue(value: Value): boolean {
  const head =
    value.kind === 'field' ||
    value.kind === 'literal' ||
    value.kind === 'records' ||
    value.kind === 'row' ||
    value.kind === 'self';
  if (!head) return false;
  /*
   * And every operand of every step, because two of them can reach a control.
   * Arithmetic is the obvious one: `⟨Price⟩ × ⟨Quantity typed here⟩` starts at
   * publish-time data and is not publish-time data. A `where` is the same
   * thing wearing a Test — "the products under ⟨what is typed⟩" is a list
   * nobody can narrow in a file — and it is worth being exact about what
   * happens then rather than leaving it to the runtime: the chain does not
   * fold, so the binding keeps its design-time text, and the runtime refuses
   * the step rather than answering the unfiltered list. Undecidable on both
   * surfaces, which is the only answer they can agree on.
   */
  return (value.steps ?? []).every((step) =>
    'by' in step ? foldableValue(step.by) : step.op !== 'where' || foldable(step.test)
  );
}
