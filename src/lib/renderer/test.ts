/**
 * Evaluating a Test, and turning the answer into a state.
 *
 * Phase B of the expression model:
 *
 *     Value  →  Test  →  State
 *
 * and the reason it goes before anything that puts a value in a CSS
 * declaration is that it needs nothing new underneath it. A Test resolves to a
 * name, the name lands in the state attribute the switch machinery already
 * reads, and the designer styles it with the inspector they already have. No
 * generated CSS is added, no script is shipped, and nothing here scales with
 * the number of rows in a repeater — a hundred cards are a hundred attribute
 * values and the same one stylesheet.
 *
 * ## Three answers, not two
 *
 * `evaluate` returns `true`, `false`, or `null` for *cannot decide here*. The
 * third is the whole execution model in one return value: a Test whose inputs
 * are all known at publish time folds to a boolean, and one that depends on
 * something the browser will only know later cannot, so it says so rather than
 * guessing. Today an undecidable Test falls through to the next assignment and
 * then to the node's declared default, which is exactly what a visitor with no
 * scripting will see when the runtime half of this arrives.
 *
 * Guessing would be the tempting alternative and it is the wrong one: a Test
 * that quietly answered `false` for "the field this reads has not loaded yet"
 * is indistinguishable, in the output, from one that answered `false` because
 * the price really is under half a million.
 *
 * ## Raw values, always
 *
 * Comparisons see what the record holds. There is no `format` in a `Test` and
 * no way to reach one — `Format` hangs off `Binding`, one level above `Value`
 * — so `$1,234.50` cannot be compared to anything, by construction rather than
 * by a rule somebody remembered to check. See `format.ts`.
 */

import type {
  CollectionRecord,
  CompareOp,
  FieldType,
  SceneNode,
  Test,
  TestLiteral,
  Value,
} from '../document/types';
import { slug } from '../document/schema';
import { mintedIn, type Minted } from '../document/when';
import type { TestTable } from '../runtime/behaviour';

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

/* --------------------------------------------------------------------------
 * What a node's state resolves to
 * ----------------------------------------------------------------------- */

/**
 * The value the node's state attribute takes, or `null` for "nothing decided".
 *
 * Later rules win. That is the arbitration `docs/EXPRESSIONS.md` settles on,
 * and it is the one `rules` already uses for two rules setting one property:
 * two Tests may legitimately target one key, overlap is often undecidable, and
 * the only precedence a designer can predict is the order they are in.
 *
 * A `null` verdict does not win and does not block — it is passed over, so a
 * later rule that *can* be decided still lands. The caller falls back to the
 * node's declared default, which is the value a visitor sees before anything
 * resolves and for ever with no scripting.
 */
export function stateFrom(node: SceneNode, record: CollectionRecord | null): string | null {
  const rules = node.assign;
  if (!rules?.length) return null;

  let chosen: string | null = null;
  for (const rule of rules) {
    if (evaluate(rule.when, record) === true) chosen = slug(rule.value) || null;
  }
  return chosen;
}

/* --------------------------------------------------------------------------
 * What a Test reads
 * ----------------------------------------------------------------------- */

/**
 * Every field key a Test depends on.
 *
 * Two callers with quite different reasons. Deleting a field has to clear the
 * assignments that read it, for the same reason it clears bindings: an
 * assignment pointing at a field that no longer exists silently stops
 * resolving, and "the state never comes on any more" is not a diagnosable
 * symptom. And the execution model needs it — a Test whose dependencies are
 * all record fields is one that folds.
 */
export function fieldsRead(test: Test): string[] {
  const found = new Set<string>();
  const walk = (inner: Test): void => {
    if (inner.kind === 'compare') {
      if (inner.left.kind === 'field') found.add(inner.left.key);
    } else if (inner.kind === 'every' || inner.kind === 'some') inner.tests.forEach(walk);
  };
  walk(test);
  return [...found];
}

/** Every form control a Test reads, by name. */
export function inputsRead(test: Test): string[] {
  const found = new Set<string>();
  const walk = (inner: Test): void => {
    if (inner.kind === 'compare') {
      if (inner.left.kind === 'input') found.add(inner.left.name);
    } else if (inner.kind === 'every' || inner.kind === 'some') inner.tests.forEach(walk);
  };
  walk(test);
  return [...found];
}

/**
 * Every element a Test reads, by node id.
 *
 * The counterpart to `inputsRead` for the operand that names an element rather
 * than a form field. Exported for the same reason: what a Test depends on is
 * how the editor knows when to warn, and how a check knows what to plant.
 */
export function elementsRead(test: Test): string[] {
  const found = new Set<string>();
  const walk = (inner: Test): void => {
    if (inner.kind === 'compare') {
      if (inner.left.kind === 'element') found.add(inner.left.ref.node);
    } else if (inner.kind === 'every' || inner.kind === 'some') inner.tests.forEach(walk);
  };
  walk(test);
  return [...found];
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

/**
 * A Test with the groups that are not groups taken out.
 *
 * `every` of one thing is that thing, and a designer who deletes the second
 * half of "all of these" means "just this one" rather than "a group with one
 * member in it". Leaving the wrapper would be harmless to the evaluator and
 * visible everywhere else: an extra indent in the panel, an extra level in the
 * summary, and a document that differs from an identical design built the
 * other way round.
 *
 * An empty group is `null` — there is no Test left, and the caller decides
 * whether that means removing the rule or refusing the edit. Answering with a
 * group of nothing would be answering `true` for every record, which is the
 * opposite of what deleting the last condition means.
 */
export function simplify(test: Test): Test | null {
  if (test.kind !== 'every' && test.kind !== 'some') return test;
  const inner = test.tests.map(simplify).filter((one): one is Test => one !== null);
  if (!inner.length) return null;
  if (inner.length === 1) return inner[0]!;
  return { ...test, tests: inner };
}

/**
 * Every comparison this node's style rules mint, with the attribute each sets.
 *
 * A style rule cannot hold a comparison in a selector, so the compiler hoists
 * it: `when.ts` swaps it for an attribute and hands back the pair. This is the
 * half the *renderer* needs — what to write on the element, and what to ship
 * to the browser when the answer is not knowable yet.
 */
export function mintedFor(node: SceneNode): Minted[] {
  const out: Minted[] = [];
  for (const rule of node.rules ?? []) out.push(...mintedIn(rule.when, rule.id));
  return out;
}

/**
 * Whether anything on this node has to be evaluated in the browser.
 *
 * Assignments and minted comparisons alike. They are two authoring routes to
 * one mechanism — a Test whose answer decides how the element looks — and the
 * scheduling decision is the same for both: fold when every operand is
 * publish-time data, subscribe when any of them can change afterwards.
 */
export function needsRuntime(node: SceneNode): boolean {
  return (
    (node.assign ?? []).some((rule) => !foldable(rule.when)) ||
    mintedFor(node).some((one) => !foldable(one.when))
  );
}

/**
 * The minted attributes that are already decided, and can go in the markup.
 *
 * `true` writes the attribute, `false` leaves it off, and `null` — cannot
 * decide here — leaves it off too. That is not a guess: an undecidable
 * comparison is one the runtime will answer, and off is what a visitor with no
 * scripting sees, which is the fallback the execution model requires anyway.
 */
export function foldedAttrs(node: SceneNode, record: CollectionRecord | null): string[] {
  const on: string[] = [];
  for (const one of mintedFor(node)) {
    if (evaluate(one.when, record) === true) on.push(one.attr);
  }
  return on;
}

/**
 * What is stopping this node's assignments from being finished.
 *
 * The execution model makes the scripting-off fallback **required**, not
 * optional: a Test with a runtime dependency cannot run with scripting
 * disabled, so the author has to say what the output falls back to. An
 * interaction with no answer for that visitor is one that has not been
 * finished, and the editor should say so rather than publishing a page that
 * silently does nothing for them.
 *
 * Returned as a sentence rather than a boolean because the inspector has to
 * print it, and two places deciding how to word one rule is how they end up
 * disagreeing about what the rule is.
 */
export function unfinished(node: SceneNode): string | null {
  if (!node.assign?.length) return null;
  if (!slug(node.props.switchKey)) {
    return 'This has no state name, so nothing is written when a rule matches.';
  }
  if (needsRuntime(node) && !slug(node.props.switchDefault)) {
    return 'This reads something typed on the page, so it needs an “Otherwise” — that is what a visitor sees before they type anything, and all they ever see with scripting off.';
  }
  return null;
}

/* --------------------------------------------------------------------------
 * What gets published when a Test cannot be folded
 * ----------------------------------------------------------------------- */

/**
 * The rules that have to travel to the browser, keyed by the node they are on.
 *
 * One entry per node, not per row: a repeater draws the same node a hundred
 * times and they all point at this one list. What varies per row is the values,
 * and those go on the element.
 *
 * All of a node's rules travel, not only the unfoldable ones. A node with a
 * record rule *and* an input rule has to arbitrate between them in the browser
 * — later wins — and it cannot do that with half the list. The folded answer is
 * still published as the element's state, so a visitor with no scripting gets
 * everything that was knowable without them.
 */
export function testTable(
  nodes: Record<string, SceneNode>,
  nodeIds: Iterable<string>
): TestTable {
  const table: TestTable = {};
  for (const id of nodeIds) {
    const node = nodes[id];
    if (!node || !needsRuntime(node)) continue;
    const rules = [
      ...(node.assign ?? []).map((rule) => ({ when: rule.when, value: slug(rule.value) })),
      /*
       * And the minted ones, which set an attribute rather than choosing a
       * value. They travel in the same table because they are answered by the
       * same evaluator over the same published values — giving them a second
       * table would mean a second copy of `holds`, and the runtime is
       * serialised with `toString()` and cannot share one.
       */
      ...mintedFor(node).map((one) => ({ when: one.when, attr: one.attr })),
    ];
    if (rules.length) table[id] = rules;
  }
  return table;
}

/**
 * The record values one element has to publish for its Tests to be answerable.
 *
 * Only the fields a Test reads, raw, and `null` when there is nothing to
 * publish. Absent fields are left out rather than sent as `null`: "the record
 * does not carry this" is a state the evaluator answers `null` to, and the way
 * it recognises it is the key not being there.
 */
export function publishedValues(
  node: SceneNode,
  record: CollectionRecord | null
): Record<string, unknown> | null {
  if (!needsRuntime(node) || !record) return null;
  const wanted = new Set<string>();
  for (const rule of node.assign ?? []) for (const key of fieldsRead(rule.when)) wanted.add(key);
  // A minted comparison reads the record too, and a rule shipped without the
  // values it reads is one the runtime answers `null` to for ever.
  for (const one of mintedFor(node)) for (const key of fieldsRead(one.when)) wanted.add(key);
  if (!wanted.size) return null;

  const out: Record<string, unknown> = {};
  for (const key of wanted) if (key in record.data) out[key] = record.data[key];
  return Object.keys(out).length ? out : null;
}

/* --------------------------------------------------------------------------
 * What can be asked of what
 * ----------------------------------------------------------------------- */

/**
 * The comparisons each field type can answer.
 *
 * Ordered comparisons are offered on numbers and nowhere else. "Is this name
 * greater than that one" is a locale question, and this codebase does not
 * answer locale questions — see `format.ts` for the same decision made about
 * printing. A date can be asked whether it is set; asking which of two is
 * earlier needs a date literal and a date operand, and that is worth doing
 * properly rather than by comparing the strings and hoping they are ISO.
 */
export const OPS_FOR: Record<FieldType, readonly CompareOp[]> = {
  text: ['eq', 'neq', 'contains', 'empty', 'notEmpty'],
  richtext: ['empty', 'notEmpty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'],
  boolean: ['eq', 'neq'],
  date: ['eq', 'neq', 'empty', 'notEmpty'],
  image: ['empty', 'notEmpty'],
  select: ['eq', 'neq', 'empty', 'notEmpty'],
  reference: ['eq', 'neq', 'empty', 'notEmpty'],
};

/** What each operator reads as, in a sentence starting with the field's name. */
export const OP_LABELS: Record<CompareOp, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is over',
  gte: 'is at least',
  lt: 'is under',
  lte: 'is at most',
  contains: 'contains',
  empty: 'is empty',
  notEmpty: 'is not empty',
};

/** Operators that stand alone — there is nothing to compare against. */
export function needsOperand(op: CompareOp): boolean {
  return op !== 'empty' && op !== 'notEmpty';
}

/**
 * A typed literal for this field, from what somebody typed.
 *
 * The type comes from the field rather than from the spelling of the input,
 * which is the rule the interaction model states: *types are declared, never
 * inferred*. `"500000"` typed against a number field is the number; the same
 * string against a text field is the string; and nothing anywhere guesses
 * which was meant.
 */
export function literalFor(type: FieldType, raw: string): TestLiteral {
  if (type === 'number') {
    const n = Number(raw.trim());
    return { type: 'number', value: Number.isFinite(n) ? n : 0 };
  }
  if (type === 'boolean') return { type: 'boolean', value: raw === 'true' };
  return { type: 'text', value: raw };
}

/** The literal as the editor should show it in an input. */
export function literalText(literal: TestLiteral | undefined): string {
  if (!literal) return '';
  return String(literal.value);
}

/* --------------------------------------------------------------------------
 * The overlap warning
 * ----------------------------------------------------------------------- */

/**
 * Whether two Tests can be *shown* to hold at once.
 *
 * The burden of proof is deliberately on the editor. `docs/EXPRESSIONS.md`
 * settles arbitration as ordering rather than mutual exclusion, because
 * `price > 500000` and `status = "sold"` read different fields and can plainly
 * both hold — refusing that pair would block a reasonable design. So overlap
 * is a warning, and a warning that fires on every pair is a warning nobody
 * reads.
 *
 * It therefore answers `false` unless it can demonstrate the overlap: same
 * field, comparable operands, ranges that genuinely intersect. Anything it
 * cannot decide — different fields, a compound Test, mismatched types — is
 * silence rather than a guess.
 */
export function provablyOverlap(a: Test, b: Test): boolean {
  if (a.kind !== 'compare' || b.kind !== 'compare') return false;
  // Two operands are the same source only if they are the same kind reading
  // the same name. A field called `size` and a control called `size` are two
  // different things that happen to share a word.
  if (a.left.kind !== b.left.kind) return false;
  if (operandName(a.left) !== operandName(b.left)) return false;
  if (a.op === 'empty' || a.op === 'notEmpty' || b.op === 'empty' || b.op === 'notEmpty') {
    // Decidable, and worth deciding: `empty` and `notEmpty` on one field are
    // the one pair that provably cannot overlap.
    return !(
      (a.op === 'empty' && b.op === 'notEmpty') ||
      (a.op === 'notEmpty' && b.op === 'empty')
    );
  }
  if (!a.right || !b.right || a.right.type !== b.right.type) return false;

  if (a.right.type === 'number' && b.right.type === 'number') {
    return numbersOverlap(a.op, a.right.value, b.op, b.right.value);
  }

  // Equality on text: two Tests wanting different values cannot both hold; the
  // same value obviously can. `contains` is left undecided — one substring can
  // sit inside another and proving it needs the values, not the operators.
  if (a.op === 'eq' && b.op === 'eq') return a.right.value === b.right.value;
  if (a.op === 'eq' && b.op === 'neq') return a.right.value !== b.right.value;
  if (a.op === 'neq' && b.op === 'eq') return a.right.value !== b.right.value;
  return false;
}

/** How an operand is identified when two of them are compared. */
function operandName(value: Value): string {
  if (value.kind === 'field') return value.key;
  if (value.kind === 'input') return value.name;
  // The node id, which is exactly the identity wanted: two rules reading the
  // same element overlap, and two reading different ones do not, whatever
  // those elements happen to be called.
  return value.ref.node;
}

/** Do the two numeric half-lines share a point? */
function numbersOverlap(aOp: CompareOp, a: number, bOp: CompareOp, b: number): boolean {
  const range = (op: CompareOp, at: number): { lo: number; hi: number } | null => {
    switch (op) {
      case 'eq':
        return { lo: at, hi: at };
      case 'gt':
        return { lo: at + EPSILON, hi: Infinity };
      case 'gte':
        return { lo: at, hi: Infinity };
      case 'lt':
        return { lo: -Infinity, hi: at - EPSILON };
      case 'lte':
        return { lo: -Infinity, hi: at };
      default:
        // `neq` is two half-lines with a hole, and a hole is exactly the case
        // where a naive interval says "no overlap" and is wrong.
        return null;
    }
  };
  const left = range(aOp, a);
  const right = range(bOp, b);
  if (!left || !right) return false;
  return left.lo <= right.hi && right.lo <= left.hi;
}

/**
 * The gap between two representable prices, near enough.
 *
 * `price > 500000` and `price < 500000` do not overlap, and saying so needs
 * *some* notion of the next number along. A true epsilon would be
 * scale-dependent; this is deliberately coarse, and coarse in the safe
 * direction — it can only ever make the warning fire on a pair that is a
 * fraction of a penny apart, never suppress one that genuinely overlaps.
 */
const EPSILON = 1e-9;
