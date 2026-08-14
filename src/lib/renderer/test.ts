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
import { stateKeyOf, stateOf } from '../document/state';
import { mintedIn, MINT_PREFIX, type Minted } from '../document/when';
import { actionsFor, guardOf, planActions } from '../document/actions';
/*
 * The evaluator and the scheduling rule, which moved to `document/` when an
 * action's `only` started asking the same question a style rule does.
 * Re-exported so every caller that already reads them from here still can —
 * where a function lives is not something forty call sites should have to
 * care about.
 */
import { evaluate, foldable, type FindRecord, type Verdict } from '../document/schedule';
import type { TestConst, TestNode, TestOperand, TestTable } from '../runtime/behaviour';

export { evaluate, foldable };
export type { FindRecord, Verdict };

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
export function stateFrom(
  node: SceneNode,
  record: CollectionRecord | null,
  find?: FindRecord
): string | null {
  const rules = node.assign;
  if (!rules?.length) return null;

  let chosen: string | null = null;
  for (const rule of rules) {
    if (evaluate(rule.when, record, find) === true) chosen = slug(rule.value) || null;
  }
  return chosen;
}

/* --------------------------------------------------------------------------
 * What a Test reads
 * ----------------------------------------------------------------------- */

/**
 * Every operand in a Test, however deeply grouped.
 *
 * The three functions under this used to be three copies of one walk, each
 * reading `left` and each having to be found and changed the day a comparison
 * grew a second operand — which is the day this was written. Declared once and
 * derived three times, for the reason `content-props.ts` gives: two lists kept
 * in step by nobody drift, and they drift silently.
 *
 * Order is source order — left before right, and a group's members in the
 * order they were written — because one caller prints them.
 */
export function operandsIn(test: Test): Value[] {
  const out: Value[] = [];
  const walk = (inner: Test): void => {
    if (inner.kind === 'compare') {
      out.push(inner.left);
      if (inner.right) out.push(inner.right);
    } else if (inner.kind === 'every' || inner.kind === 'some') inner.tests.forEach(walk);
  };
  walk(test);
  return out;
}

/** The distinct operands of one kind, in source order. */
function readsOfKind<K extends Value['kind']>(
  test: Test,
  kind: K,
  name: (value: Extract<Value, { kind: K }>) => string
): string[] {
  const found = new Set<string>();
  for (const value of operandsIn(test)) {
    if (value.kind === kind) found.add(name(value as Extract<Value, { kind: K }>));
  }
  return [...found];
}

/**
 * Every field key a Test depends on.
 *
 * Two callers with quite different reasons. Deleting a field has to clear the
 * assignments that read it, for the same reason it clears bindings: an
 * assignment pointing at a field that no longer exists silently stops
 * resolving, and "the state never comes on any more" is not a diagnosable
 * symptom. And the execution model needs it — `publishedValues` ships exactly
 * these, so a field this misses is one the runtime answers `null` to for ever.
 */
export function fieldsRead(test: Test): string[] {
  return readsOfKind(test, 'field', (value) => value.key);
}

/** Every form control a Test reads, by name. */
export function inputsRead(test: Test): string[] {
  return readsOfKind(test, 'input', (value) => value.name);
}

/**
 * Every element a Test reads, by node id.
 *
 * The counterpart to `inputsRead` for the operand that names an element rather
 * than a form field. Exported for the same reason: what a Test depends on is
 * how the editor knows when to warn, and how a check knows what to plant.
 */
export function elementsRead(test: Test): string[] {
  return readsOfKind(test, 'element', (value) => value.ref.node);
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
  /*
   * And the guard on what this element *does*, which is the same mechanism
   * pointed at the other axis.
   *
   * A style rule's comparison mints an attribute because a selector cannot
   * hold one; an action's `only` mints one because the two runtimes are two
   * closures serialised separately and `behaviourRuntime` cannot call
   * `testRuntime`'s evaluator. Both end up needing exactly the same thing —
   * *put the answer in the DOM* — so both get it from here, and everything
   * downstream (`needsRuntime`, `testTable`, `publishedValues`, `foldedAttrs`,
   * the `data-cre8-test` pointer) services them without knowing which is
   * which.
   *
   * One per node rather than one per action, because the element has one
   * attribute to be gated by. `guardOf` is what decides that a binding's
   * actions agree on their guard; this only has to name it.
   */
  const guard = guardOf(node);
  if (guard) out.push({ attr: guardName(node.id), when: guard });
  return out;
}

/** The attribute that gates what an element does. One per node; see `mintedFor`. */
export function guardName(nodeId: string): string {
  return `${MINT_PREFIX}${nodeId}-g`;
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
export function foldedAttrs(
  node: SceneNode,
  record: CollectionRecord | null,
  find?: FindRecord
): string[] {
  const on: string[] = [];
  for (const one of mintedFor(node)) {
    if (evaluate(one.when, record, find) === true) on.push(one.attr);
  }
  return on;
}

/**
 * What a live guard does not do, said where the guard is written.
 *
 * A guard that reads something typed cannot be answered in a file, and what a
 * visitor with no scripting gets then depends on which verb it is guarding —
 * not on anything the author chose. A `copy` does nothing, which is what it
 * does unguarded. A `navigate` *goes*: the `href` is in the markup and there is
 * nothing to stop it. That second one is worth a sentence, because "only when
 * signed in" reads like a lock and is not one.
 *
 * Its own function since X10 so the press list can print it. It is the panel
 * where the guard is authored and the only one that is always there — the Data
 * section, which had it, needs a collection in scope. One wording still, for
 * the reason `unfinished` gives: two places deciding how to word one rule is
 * how they end up disagreeing about what the rule is.
 */
export function guardWarning(node: SceneNode): string | null {
  if (!guardOf(node)) return null;
  const carried = planActions(actionsFor(node)).native;
  if (!carried.length) return null;
  return `“Only when” is answered in the browser, so a visitor with no scripting still ${carried[0]!.carrier === 'href' ? 'follows this link' : 'gets this'}. Use it to tidy an interface, not to keep anybody out.`;
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
  // The guard first, because it is the one thing here a designer cannot
  // discover by looking at the page.
  const gate = guardWarning(node);
  if (gate) return gate;
  if (!node.assign?.length) return null;
  if (!stateKeyOf(node)) {
    return 'This has no state name, so nothing is written when a rule matches.';
  }
  if (needsRuntime(node) && !slug(stateOf(node)?.initial)) {
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
      ...(node.assign ?? []).map((rule) => ({ when: lowerTest(rule.when), value: slug(rule.value) })),
      /*
       * And the minted ones, which set an attribute rather than choosing a
       * value. They travel in the same table because they are answered by the
       * same evaluator over the same published values — giving them a second
       * table would mean a second copy of `holds`, and the runtime is
       * serialised with `toString()` and cannot share one.
       */
      ...mintedFor(node).map((one) => ({ when: lowerTest(one.when), attr: one.attr })),
    ];
    if (rules.length) table[id] = rules;
  }
  return table;
}

/**
 * A Test as the browser needs it, which is not a Test as the document holds it.
 *
 * The two used to be the same object and that was a coincidence rather than a
 * design — `testTable` put the stored Test straight into the page. It stops
 * being true the moment a `Value` carries anything the runtime does not read,
 * and `kind: 'literal'` is the first such thing: down there an operand with a
 * `type` *is* a literal, so the tag is four hundred bytes of nothing across a
 * site.
 *
 * Kept to dropping, deliberately. Resolving anything here — folding a field
 * because the record is to hand — would be a second evaluator living beside
 * `evaluate`, and two of those disagreeing is the failure this codebase is
 * most careful about. The runtime reads a foldable operand the same way it
 * always has, out of the values published on the element.
 */
export function lowerTest(test: Test): TestNode {
  if (test.kind === 'every' || test.kind === 'some') {
    return { kind: test.kind, tests: test.tests.map(lowerTest) };
  }
  if (test.kind !== 'compare') return test as unknown as TestNode;
  const out: TestNode = { kind: 'compare', left: test.left, op: test.op };
  if (test.right) out.right = bare(test.right);
  return out;
}

/** An operand with the tag the runtime infers from its shape taken back off. */
function bare(value: Value): TestConst | TestOperand {
  if (value.kind !== 'literal') return value;
  return { type: value.type, value: value.value };
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
export function literalFor(type: FieldType, raw: string): Value {
  if (type === 'number') {
    const n = Number(raw.trim());
    return { kind: 'literal', type: 'number', value: Number.isFinite(n) ? n : 0 };
  }
  if (type === 'boolean') return { kind: 'literal', type: 'boolean', value: raw === 'true' };
  return { kind: 'literal', type: 'text', value: raw };
}

/**
 * The literal inside a Value, or nothing.
 *
 * Two callers, and they want it for opposite reasons: the panel needs the text
 * to put in a box, and `provablyOverlap` needs to know it is looking at a
 * constant before it claims two rules can both hold. Both of them have to ask,
 * because an operand is no longer a constant by construction.
 */
export function asLiteral(value: Value | undefined): TestLiteral | undefined {
  return value?.kind === 'literal' ? value : undefined;
}

/** The literal as the editor should show it in an input. */
export function literalText(value: Value | undefined): string {
  const literal = asLiteral(value);
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
  /*
   * And both operands have to be constants, which is new and is a *narrowing*.
   *
   * Everything below reasons about the numbers and strings somebody typed:
   * `> 100` and `< 50` cannot both hold because 100 and 50 are known here.
   * `> Budget` and `< Deposit` are two half-lines whose ends are only known
   * per row, and on some row they certainly do overlap — so the honest answer
   * is the one this function gives to everything it cannot demonstrate.
   */
  const left = asLiteral(a.right);
  const right = asLiteral(b.right);
  if (!left || !right || left.type !== right.type) return false;

  if (left.type === 'number' && right.type === 'number') {
    return numbersOverlap(a.op, left.value, b.op, right.value);
  }

  // Equality on text: two Tests wanting different values cannot both hold; the
  // same value obviously can. `contains` is left undecided — one substring can
  // sit inside another and proving it needs the values, not the operators.
  if (a.op === 'eq' && b.op === 'eq') return left.value === right.value;
  if (a.op === 'eq' && b.op === 'neq') return left.value !== right.value;
  if (a.op === 'neq' && b.op === 'eq') return left.value !== right.value;
  return false;
}

/** How an operand is identified when two of them are compared. */
function operandName(value: Value): string {
  if (value.kind === 'field') return value.key;
  if (value.kind === 'input') return value.name;
  if (value.kind === 'literal') return `=${String(value.value)}`;
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
