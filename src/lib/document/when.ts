/**
 * What a rule's `when` says, and what it can become.
 *
 * The structural half of the condition model, kept apart from the vocabulary
 * in `conditions.ts` for a reason worth stating: this module imports nothing
 * but types. `conditions.ts` reaches for `runtime/data` to seed the visit
 * entry in its menu, and `runtime/data` needs to walk a rule's conditions to
 * decide whether a page carries the resolver at all — so putting both halves
 * in one file closes an import cycle between them.
 *
 * The split is not only expedient. *What a Test means* is a question about the
 * model, answerable with no idea what any of it is called or which elements
 * can be asked it; *what a condition is called* is a question about the panel.
 * The first is what the generator needs.
 */

import type { Condition, Test } from './types';

/* --------------------------------------------------------------------------
 * What a Test compiles to
 * ----------------------------------------------------------------------- */

/**
 * The most selector branches one rule may become.
 *
 * A selector list is how a stylesheet has always spelled OR — `a, b { … }` —
 * so `some` costs nothing new to emit. What it does cost is multiplication:
 * an `every` holding two `some`s of three is nine branches, and nesting that
 * again is twenty-seven. The panel authors one level of grouping and cannot
 * reach numbers like those, but a document can be hand-edited and one arriving
 * from a future release must not be able to make the generator do unbounded
 * work.
 *
 * Sixteen is chosen to sit well clear of anything the panel can build while
 * still refusing a pathological tree. Past it the rule is dropped, which is
 * the same policy the generator already applies to a condition it cannot
 * resolve — and `unreachable()` exists so the editor can say so rather than
 * leaving a designer with a rule that silently does nothing.
 */
export const BRANCH_LIMIT = 16;

/**
 * Every combination of conditions this Test compiles to, or `null`.
 *
 * One entry per selector the rule needs. `null` means *this cannot be a
 * selector* — a comparison against a record field, or a tree so wide it
 * exceeds `BRANCH_LIMIT` — and the caller drops the rule rather than
 * approximating it, because a rule that compiles to *almost* the right
 * selector is worse than one that compiles to none.
 *
 * The empty branch is not the same as no branches. `[[]]` is one selector with
 * no conditions on it — a rule that always applies, which is what a backdrop
 * is. `[]` would be a rule with nowhere to land, and nothing returns it.
 */
export function branchesOf(when: Test | undefined): Condition[][] | null {
  if (!when) return [[]];

  switch (when.kind) {
    case 'every': {
      /*
       * The cross product, because "all of these hold" over a member that is
       * itself "any of these" means every way of satisfying the group. Seeded
       * with one empty branch so an `every` of nothing is *always* rather than
       * never — `simplify` should have removed it, and a generator that
       * disagreed with the editor about the empty case is how a rule ends up
       * applying to everything.
       */
      let branches: Condition[][] = [[]];
      for (const inner of when.tests) {
        const next = branchesOf(inner);
        if (!next) return null;
        const grown: Condition[][] = [];
        for (const base of branches) {
          for (const one of next) {
            grown.push([...base, ...one]);
            if (grown.length > BRANCH_LIMIT) return null;
          }
        }
        branches = grown;
      }
      return branches;
    }

    case 'some': {
      const branches: Condition[][] = [];
      for (const inner of when.tests) {
        const next = branchesOf(inner);
        if (!next) return null;
        branches.push(...next);
        if (branches.length > BRANCH_LIMIT) return null;
      }
      // "Any of nothing" holds for nobody, and there is no selector that
      // matches nothing — so it is refused rather than compiled to a rule
      // that would quietly apply always.
      return branches.length ? branches : null;
    }

    case 'compare':
      // A comparison is answered by reading a record or a form control, not by
      // the browser matching a selector. `renderer/test.ts` evaluates these;
      // nothing here can.
      return null;

    default:
      return [[when]];
  }
}

/**
 * The one flat list of conditions, when the Test is a plain AND of them.
 *
 * The shape almost every reader outside the generator wants: `readCase` asking
 * whether a rule is a switch case, `variantsOf` asking what axis a content
 * override varies on, the editor asking which state a rule names. All of them
 * were written against `Condition[]` and all of them mean *exactly this*, so
 * they say it once here instead of each re-deriving it.
 *
 * `null` when the rule branches or cannot compile — which those callers should
 * treat as "not the simple shape I handle", never as "no conditions".
 */
export function conditionsOf(when: Test | undefined): Condition[] | null {
  const branches = branchesOf(when);
  return branches && branches.length === 1 ? branches[0]! : null;
}

/* --------------------------------------------------------------------------
 * Minting: a comparison the stylesheet can answer
 * ----------------------------------------------------------------------- */

/**
 * The attribute a minted comparison turns on.
 *
 * ## Why an attribute rather than a state
 *
 * The plan for this said *mint a state*, because that is what a designer had
 * been doing by hand: name a state, assign it from a comparison, condition a
 * style rule on it. Five steps for one sentence, and the fix was supposed to
 * be the compiler doing those steps instead of the person.
 *
 * A state cannot carry it. An element holds exactly one `data-cre8-switch`
 * and `stateFrom` settles exactly one value, so minting onto a node's state
 * would collide with whatever that node's switch was already for, and two
 * comparisons on one node could not both be true. Neither is a corner case:
 * "red when it is expensive **and** faded when it is sold" is two.
 *
 * An attribute has none of those problems. Each minted comparison gets its
 * own, present or absent, any number per element, and `attr` conditions have
 * compiled since long before this — so the generator learns nothing new. The
 * intermediate variable still exists, which was always the point; it is a
 * better-shaped one than the plan guessed, and the designer still never types
 * it.
 */
export const MINT_PREFIX = 'data-cre8-w-';

export interface Minted {
  /** The attribute this comparison turns on when it holds. */
  attr: string;
  /** The comparison, as the evaluator and the runtime both want it. */
  when: Test;
}

/**
 * The attribute for one comparison, from the rule that owns it.
 *
 * Derived from the rule id and the comparison's position, never from a
 * counter: the same document has to publish the same bytes twice, or D6's
 * write-only-what-changed cannot tell an edit from a rebuild. Rule ids are
 * `uid()` output — lowercase letters and digits — so this needs no escaping to
 * sit in a selector, by the same argument that lets a state key go in one.
 */
const mintName = (ruleId: string, index: number) => `${MINT_PREFIX}${ruleId}-${index}`;

/** Every comparison in a rule's `when`, in walk order, with its attribute. */
export function mintedIn(when: Test | undefined, ruleId: string): Minted[] {
  const found: Minted[] = [];
  const walk = (inner: Test | undefined): void => {
    if (!inner) return;
    if (inner.kind === 'every' || inner.kind === 'some') {
      for (const one of inner.tests) walk(one);
      return;
    }
    if (inner.kind === 'compare') {
      found.push({ attr: mintName(ruleId, found.length), when: inner });
    }
  };
  walk(when);
  return found;
}

/**
 * The same `when`, with every comparison swapped for the attribute it sets.
 *
 * What the generator compiles. The walk is the same walk `mintedIn` does and
 * in the same order, so the *n*th comparison and the *n*th attribute are the
 * same one — the two functions are a pair and editing one without the other
 * would silently pair a rule with somebody else's answer.
 */
export function plannedWhen(when: Test | undefined, ruleId: string): Test | undefined {
  if (!when) return undefined;
  let index = 0;
  const walk = (inner: Test): Test => {
    if (inner.kind === 'every' || inner.kind === 'some') {
      return { ...inner, tests: inner.tests.map(walk) };
    }
    if (inner.kind === 'compare') {
      return { kind: 'attr', name: mintName(ruleId, index++), op: 'is', values: [''] };
    }
    return inner;
  };
  return walk(when);
}

/**
 * Every condition in a Test, in order.
 *
 * The same objects, not copies, so a caller renaming a state key can edit them
 * where they sit. `branchesOf` is the wrong tool for that: it builds fresh
 * arrays and duplicates a condition that appears in more than one branch, so a
 * rename through it would either miss the original or apply twice.
 */
export function eachCondition(when: Test | undefined, visit: (condition: Condition) => void): void {
  if (!when) return;
  if (when.kind === 'every' || when.kind === 'some') {
    for (const inner of when.tests) eachCondition(inner, visit);
    return;
  }
  if (when.kind !== 'compare') visit(when);
}

/**
 * The same Test with one condition swapped for another.
 *
 * Matched by identity, not by value: two `hover` conditions on one rule are
 * indistinguishable by their contents, and editing either of them must not
 * edit both. Rebuilt rather than mutated because this is what an immer draft
 * wants handed to it, and because a caller holding the old tree should keep
 * seeing the old tree.
 */
export function replaceCondition(when: Test, target: Condition, next: Condition): Test {
  if (when === (target as Test)) return next;
  if (when.kind === 'every' || when.kind === 'some') {
    return { ...when, tests: when.tests.map((inner) => replaceCondition(inner, target, next)) };
  }
  return when;
}

/** Why this rule will never apply, or null when it will. */
export function unreachable(when: Test | undefined): string | null {
  if (!when) return null;
  if (branchesOf(when)) return null;
  // The two reasons are told apart by asking again without the comparison: if
  // it still cannot compile, the tree is the problem.
  return hasCompare(when)
    ? 'This compares a value, which a stylesheet cannot do on its own yet.'
    : `This has more ways to be true than one rule can carry (over ${BRANCH_LIMIT}). Split it into two rules.`;
}

function hasCompare(when: Test): boolean {
  if (when.kind === 'compare') return true;
  if (when.kind === 'every' || when.kind === 'some') return when.tests.some(hasCompare);
  return false;
}

/**
 * The authoring shorthand, folded into the stored shape.
 *
 * Specs, blocks and the editor's own add menu all describe a new rule as a
 * list of conditions, because that is what somebody writing one means. The
 * document holds a `Test`. Normalising here rather than at each call site is
 * the same arrangement `NodeSpec.states` already has with `rules`: authoring
 * keeps the convenient form and nothing downstream sees two shapes.
 *
 * A list of one becomes that condition bare, not a group of one — a group with
 * a single member is an extra level in the panel, an extra indent in the
 * summary, and a document that differs from an identical design built the
 * other way round. `simplify` makes the same choice for the same reason.
 */
export function asTest(when: Condition[] | Test | undefined): Test | undefined {
  if (!when) return undefined;
  if (!Array.isArray(when)) return when;
  if (!when.length) return undefined;
  if (when.length === 1) return when[0];
  return { kind: 'every', tests: when };
}
