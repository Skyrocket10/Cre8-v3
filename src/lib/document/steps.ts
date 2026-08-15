/**
 * What each step can be done to, and what it leaves behind.
 *
 * `docs/VALUES.md` §3.5 states the rule this file exists to make true:
 *
 *   > **Offer only what the head can do.** A `follow` on a text field is a
 *   > step that compiles and can never resolve — the same failure as offering
 *   > "Ticked" on a `div`. The step menu is generated from the head's type.
 *
 * Until E8 the menu was two hand-written lists — the arithmetic ops and the
 * text ops — chosen by a branch on the field's type. That is the same shape as
 * every list this codebase has replaced with a table: correct on the day it is
 * written, and wrong the first time somebody adds a step to the model and not
 * to the panel.
 *
 * ## This is the authoring vocabulary, not a validator
 *
 * The resolver applies what it is given. `⟨Price⟩ uppercased` resolves fine —
 * it produces `"19.99"` — and nothing here refuses it. What this says is what
 * the panel *offers*, which is a different and softer claim: a document may
 * hold a chain nobody could have built here, and it renders.
 *
 * The distinction matters because the alternative is a second evaluator. A
 * table that decided what resolves would have to agree with `advance` for ever,
 * and two things that must agree are one thing too many. So `tests/static`
 * checks that every op here is one `advance` handles and vice versa, and stops
 * there.
 *
 * ## Types flow along the chain
 *
 * `gives`/`to` are what make the menu *generated* rather than merely filtered:
 * the offer at each position comes from the type in hand at that position, not
 * from the head. `⟨Price⟩ ⟨joined with " per month"⟩` is text from the join
 * onwards, so nothing after it offers `×` — and the format chips at the end of
 * the sentence follow the same fold, which is what stops a currency format
 * from being offered for a value that is now a sentence.
 */

import type { FieldType, Step } from './types';

/** What a chain is holding at one point along it. */
export type Shape = 'value' | 'record' | 'list';

export interface StepKind {
  /** What the sentence calls it. The `case` and truncate words are the
   *  format chips', deliberately: one idea, one wording. */
  label: string;
  /** What has to be in hand for this step to make sense. */
  takes: Shape;
  /** What it leaves in hand. */
  gives: Shape;
  /**
   * The value types it may be offered on, when it takes a value.
   *
   * Absent means "any scalar", which nothing currently is — every value step
   * here is choosy, and that is the point of the rule.
   */
  from?: readonly FieldType[];
  /** What the value becomes. Absent means it is unchanged. */
  to?: FieldType;
}

/** Text a person reads and writes. `select` is one of a fixed set of words. */
const PROSE = ['text', 'select'] as const;

/**
 * Every step, and the shape of the sentence it can appear in.
 *
 * Keyed by the `op` in the document, so a step added to `Step` and not to this
 * table is unoffered rather than mis-offered — and the coverage check says so
 * rather than leaving it to be discovered by a designer who cannot find it.
 */
export const STEPS: Record<Step['op'], StepKind> = {
  // record and list — the half that folds, and cannot travel
  follow: { label: 'the record it names', takes: 'value', gives: 'record', from: ['reference'] },
  field: { label: 'a field of it', takes: 'record', gives: 'value' },
  count: { label: 'how many', takes: 'list', gives: 'value', to: 'number' },
  first: { label: 'the first', takes: 'list', gives: 'record' },
  last: { label: 'the last', takes: 'list', gives: 'record' },
  where: { label: 'only when', takes: 'list', gives: 'list' },
  sortedBy: { label: 'in order of', takes: 'list', gives: 'list' },

  // arithmetic — the first half that travels
  times: { label: '×', takes: 'value', gives: 'value', from: ['number'], to: 'number' },
  over: { label: '÷', takes: 'value', gives: 'value', from: ['number'], to: 'number' },
  plus: { label: '+', takes: 'value', gives: 'value', from: ['number'], to: 'number' },
  minus: { label: '−', takes: 'value', gives: 'value', from: ['number'], to: 'number' },
  round: { label: 'rounded to', takes: 'value', gives: 'value', from: ['number'], to: 'number' },

  // text — the second
  join: {
    label: 'joined with',
    takes: 'value',
    gives: 'value',
    /*
     * Wider than the other text steps, and deliberately: `⟨Rooms⟩ ⟨joined with
     * " bedrooms"⟩` is an ordinary thing to write and a join is the one step
     * that does not care what it was handed. A date joins as the raw value it
     * holds, which is honest rather than pretty — reaching the *formatted* one
     * needs a step that does not exist yet.
     *
     * `richtext` and `image` are out for the reason they carry no formats
     * either: one is markup, where appending lands outside the last tag, and
     * the other is an address rather than prose.
     */
    from: ['text', 'select', 'number', 'date'],
    to: 'text',
  },
  /*
   * Offered on the two types whose formats are not already steps, which is
   * also what keeps it off anything a control can hold: a control's value
   * reads as text, text's formats are `case` and `truncate`, and both of
   * those are steps of their own. So the one step that cannot travel is the
   * one step nothing can put over something typed.
   */
  formatted: { label: 'written as', takes: 'value', gives: 'value', from: ['number', 'date'], to: 'text' },
  upper: { label: 'UPPERCASE', takes: 'value', gives: 'value', from: PROSE, to: 'text' },
  lower: { label: 'lowercase', takes: 'value', gives: 'value', from: PROSE, to: 'text' },
  capitalize: { label: 'Capitalised', takes: 'value', gives: 'value', from: PROSE, to: 'text' },
  truncate: { label: 'its first', takes: 'value', gives: 'value', from: PROSE, to: 'text' },
};

/**
 * The steps a value of this type can be asked to do, in menu order.
 *
 * Menu order is the order of `STEPS`, which is the order the vocabulary is
 * written in — arithmetic before text, and `join` first among the text ones
 * because it is what anybody comes here for.
 */
export function stepsFor(type: FieldType | undefined): Step['op'][] {
  if (!type) return [];
  return (Object.keys(STEPS) as Step['op'][]).filter((op) => {
    const kind = STEPS[op];
    return kind.takes === 'value' && kind.gives === 'value' && (kind.from?.includes(type) ?? true);
  });
}

/**
 * The steps that leave the value usable where it is going.
 *
 * `stepsFor` answers "what can this type do"; this answers the other half of
 * §3.5, which is about the *place* rather than the value: a `ValueVar` maps a
 * number onto a scale, so `joined with` is a step that would compile there and
 * never resolve. A binding needs nothing in particular and asks `stepsFor`.
 *
 * A step with no `to` leaves the type alone, so it keeps whatever was needed.
 */
export function stepsKeeping(
  type: FieldType | undefined,
  needs: FieldType | undefined
): Step['op'][] {
  const offered = stepsFor(type);
  return needs ? offered.filter((op) => (STEPS[op].to ?? needs) === needs) : offered;
}

/**
 * What the value is once these steps have run.
 *
 * Only the scalar steps move the type; a `follow` or a `count` has already
 * been dealt with by the time the panel is asking this, because those are
 * chips of their own. An op the table does not know leaves the type alone,
 * which is the reading that keeps a document from the future rendering as
 * nonsense rather than not rendering.
 */
export function typeAfter(type: FieldType | undefined, steps: readonly Step[]): FieldType | undefined {
  let held = type;
  for (const step of steps) {
    const kind = STEPS[step.op];
    if (!kind || kind.takes !== 'value' || kind.gives !== 'value') continue;
    held = kind.to ?? held;
  }
  return held;
}

/** Whether this is a step the chain editor writes, rather than one that walks data. */
export function isTransform(step: Step): boolean {
  const kind = STEPS[step.op];
  return !!kind && kind.takes === 'value' && kind.gives === 'value';
}
