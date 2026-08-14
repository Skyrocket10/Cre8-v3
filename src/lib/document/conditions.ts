/**
 * The condition vocabulary: what each shape is called, and where it can match.
 *
 * `css.ts` compiles eleven condition shapes. For most of this project's life
 * the panel could author four of them, and the seven it could not included
 * every `control` pseudo-class — a ticked checkbox, a disabled button, a field
 * filled in wrongly. The CSS for all of them was written, commented and
 * correct; two shapes existed in real documents only because `blocks/kit.ts`
 * hand-writes them. Nothing was broken. There was simply no control.
 *
 * This module is what a control needs and the generator does not: the words,
 * and the answer to *may this element be asked this question*.
 *
 * ## Offer what can match; withhold only what provably cannot
 *
 * The two halves of that rule are not symmetrical, and the asymmetry is the
 * whole design.
 *
 * `:hover` and `:active` match any element, and `:focus-visible` matches
 * anything focusable — which a designer can make almost anything into. Refusing
 * those on a `div` would be refusing a rule that works. So pointer conditions
 * are offered everywhere.
 *
 * `:checked` on a `div` is different in kind. It is not unlikely, it is
 * *impossible*: the selector compiles, ships, and can never match, and the
 * designer sees a rule that silently does nothing with no error anywhere
 * saying why. That is the exact failure `conditionParts` documents having
 * shipped once already, when a checkbox's class landed on its `<label>` and
 * `.c-abc:where(:checked)` matched nothing. So control conditions are offered
 * only where the browser can answer them.
 *
 * ## Why the applicability table is written out by hand
 *
 * It is a fact about HTML, not about this codebase's element registry, and
 * there is no field in a registry entry that encodes it. What keeps it honest
 * is `Record<ControlPseudo, …>`: adding a pseudo-class to `Condition` without
 * saying where it applies is a compile error rather than an omission somebody
 * has to notice.
 */

import { DATA_SOURCES } from '../runtime/data';
import { OPS_FOR } from '../renderer/test';
import type { Condition, ElementType, Field, Test, Value } from './types';

/** The pointer pseudo-classes, derived so a new one cannot be forgotten here. */
export type PointerPseudo = Extract<Condition, { kind: 'pointer' }>['pseudo'];
/** The control pseudo-classes, likewise. */
export type ControlPseudo = Extract<Condition, { kind: 'control' }>['pseudo'];

/* --------------------------------------------------------------------------
 * The words
 * ----------------------------------------------------------------------- */

/**
 * What each pointer state reads as in a sentence beginning "When".
 *
 * Plain words rather than the CSS spelling, and one map rather than two: the
 * chip's options, the read-only prose and the row heading all come from here,
 * so a rule cannot be described as "Hovered" in the list and "hover" in the
 * editor underneath it. That drift is the reason `describeRule` exists.
 */
export const POINTER_LABELS: Record<PointerPseudo, string> = {
  hover: 'pointed at',
  active: 'being pressed',
  focus: 'focused',
  'focus-visible': 'focused by keyboard',
};

/** The same, for a control's own state. */
export const CONTROL_LABELS: Record<ControlPseudo, string> = {
  checked: 'ticked',
  disabled: 'unavailable',
  invalid: 'filled in wrongly',
  'placeholder-shown': 'still empty',
};

/** What the menu says underneath each, where the label alone is not enough. */
export const POINTER_HINTS: Record<PointerPseudo, string> = {
  hover: 'The pointer is over it',
  active: 'Held down, for the instant of the press',
  focus: 'Focused however it got there, including by mouse',
  'focus-visible': 'Focused by tabbing — the ring sighted users expect',
};

export const CONTROL_HINTS: Record<ControlPseudo, string> = {
  checked: 'The box or radio is on',
  disabled: 'Turned off, so it cannot be used',
  invalid: 'What was typed fails the field’s own rules',
  'placeholder-shown': 'Nothing typed yet, so the placeholder is showing',
};

/* --------------------------------------------------------------------------
 * Where a control condition can match
 * ----------------------------------------------------------------------- */

/**
 * The element types each control pseudo-class can be true of.
 *
 * `checkbox` and `radio` are in three of the four lists despite rendering as a
 * `<label>`, because `conditionParts` compiles them through `:has()` — the
 * question is asked of the real input inside. That is also why they are absent
 * from `placeholder-shown`: there is no placeholder on a tick box to show.
 */
const APPLIES_TO: Record<ControlPseudo, readonly ElementType[]> = {
  checked: ['checkbox', 'radio'],
  disabled: [
    'input',
    'textarea',
    'select',
    'button',
    'checkbox',
    'radio',
    'range',
    'file',
    'fieldset',
  ],
  invalid: ['input', 'textarea', 'select', 'checkbox', 'radio', 'file'],
  'placeholder-shown': ['input', 'textarea'],
};

/** Every control state this element can actually be in. Often none. */
export function controlPseudosFor(type: ElementType): ControlPseudo[] {
  return (Object.keys(APPLIES_TO) as ControlPseudo[]).filter((pseudo) =>
    APPLIES_TO[pseudo].includes(type)
  );
}

/**
 * Whether asking this element this question can ever be answered.
 *
 * The check a rule should be validated against rather than the menu it was
 * built from — a block can plant a condition the panel would not have offered,
 * and a designer can change an element's type underneath a rule that was fine
 * when it was written.
 */
export function controlApplies(type: ElementType, pseudo: ControlPseudo): boolean {
  return APPLIES_TO[pseudo].includes(type);
}

/* --------------------------------------------------------------------------
 * Attributes
 * ----------------------------------------------------------------------- */

/**
 * Attributes worth suggesting, and what they mean here.
 *
 * An `attr` condition takes any name — it is the escape hatch, and the runtime
 * writes some of these itself — but a free text field with no suggestions is a
 * control nobody uses. These are the ones an element in this system genuinely
 * carries: the ARIA state a component sets, and the marker the copy button's
 * runtime writes after a successful copy.
 */
export const SUGGESTED_ATTRS: readonly { name: string; value: string; hint: string }[] = [
  { name: 'aria-expanded', value: 'true', hint: 'A disclosure is open' },
  { name: 'aria-selected', value: 'true', hint: 'A tab or option is chosen' },
  { name: 'aria-current', value: 'page', hint: 'The nav link for the page you are on' },
  { name: 'aria-pressed', value: 'true', hint: 'A toggle button is on' },
  { name: 'data-cre8-copied', value: '', hint: 'Just copied to the clipboard' },
  { name: 'open', value: '', hint: 'A details or dialog is open' },
];

/* --------------------------------------------------------------------------
 * What may go in the selector
 * ----------------------------------------------------------------------- */

/**
 * An attribute name, narrowed to what can sit in a selector unquoted.
 *
 * `conditionParts` writes `[${name}="${value}"]` with **no escaping**, and
 * that has been safe for exactly as long as the only things reaching it were
 * literals in `blocks/kit.ts`. A text field in the panel changes that: a space
 * in a name ends the attribute test early and everything after it becomes
 * selector syntax, which is how a typo turns into a stylesheet that stops
 * parsing at the point of the mistake and silently drops every rule after it.
 *
 * Narrowing here rather than escaping there for the same reason `slug` exists:
 * a value that cannot contain the dangerous character needs nothing downstream
 * to remember. It also has to survive being stored, sent to a collaborator and
 * compiled in a Worker, none of which would run an escaper the browser would.
 *
 * Leading non-letters are dropped because an attribute name must start with
 * one, and `1st` is not a name that becomes valid by keeping the digits.
 */
export function attrName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_:-]/g, '').replace(/^[^A-Za-z]+/, '');
}

/**
 * An attribute value, with the characters that would break out of the quotes
 * removed.
 *
 * Looser than a name on purpose — a value is arbitrary text and narrowing it
 * to an identifier would refuse `?ref=acme` and every other real value. It
 * only has to survive sitting between double quotes, so a double quote and a
 * backslash are the two that cannot be allowed, plus the newlines that would
 * split the declaration.
 */
export function attrValue(raw: string): string {
  return raw.replace(/["\\\r\n]/g, '');
}

/* --------------------------------------------------------------------------
 * The menu
 * ----------------------------------------------------------------------- */

/** One entry in the "When…" menu: what it is called, and the rule it starts. */
export interface ConditionOffer {
  key: string;
  /** The menu heading it sits under. */
  group: string;
  label: string;
  hint: string;
  /**
   * The rule this offer starts, in the authoring shorthand.
   *
   * A `Test` rather than a list of conditions for exactly one entry: a
   * comparison against a record field is not a `Condition` and never will be —
   * a selector cannot read a record. It is offered here all the same, because
   * to the person adding it a field is one more thing that can be true, and
   * the compiler is what knows the difference.
   */
  when: Condition[] | Test;
  /** A pseudo-element the rule targets instead of the element itself. */
  part?: 'backdrop';
}

export interface OfferContext {
  type: ElementType;
  /** The states this element can talk about, nearest first. */
  states: { key: string; values: string[] }[];
  /** The record's fields, when this element sits inside one. Usually none. */
  fields?: Field[];
}

/**
 * Everything this element can be asked about.
 *
 * Data rather than markup, and the reason is a check that did not work.
 *
 * The first version of the menu built its entries inline in the panel, and the
 * static check that "every kind the generator compiles can be authored"
 * scraped `kind: '…'` literals out of the panel's source. It passed. Then it
 * was falsified by deleting the attribute group — and it *still* passed,
 * because the literal was sitting in the callback of a `.map` over an empty
 * list. The check was reading code that could no longer run.
 *
 * A function returning the offers cannot be fooled that way: the check calls
 * it and reads what comes back, so an entry that is unreachable is an entry
 * that is absent. It is the same move `sections.ts` made for the section list
 * and `style-vocabulary.ts` made for the property list, for the same reason —
 * a menu generated from a table is a menu a test can enumerate.
 */
export function conditionOffers(ctx: OfferContext): ConditionOffer[] {
  const offers: ConditionOffer[] = [];

  for (const pseudo of Object.keys(POINTER_LABELS) as PointerPseudo[]) {
    offers.push({
      key: `pointer-${pseudo}`,
      group: 'The pointer',
      label: capitalise(POINTER_LABELS[pseudo]),
      hint: POINTER_HINTS[pseudo],
      when: [{ kind: 'pointer', pseudo }],
    });
  }

  // Empty for most elements, and the group header goes with it. A `div` that
  // offered "Ticked" would be offering a rule that compiles, ships, and can
  // never match.
  for (const pseudo of controlPseudosFor(ctx.type)) {
    offers.push({
      key: `control-${pseudo}`,
      group: 'This control',
      label: capitalise(CONTROL_LABELS[pseudo]),
      hint: CONTROL_HINTS[pseudo],
      when: [{ kind: 'control', pseudo }],
    });
  }

  const state = ctx.states[0];
  if (state) {
    offers.push({
      key: 'state',
      group: 'Something you named',
      label: 'A state',
      hint: `${state.key} is ${state.values[0] ?? 'on'}`,
      when: [{ kind: 'state', key: state.key, op: 'is', values: [state.values[0] ?? 'on'] }],
    });
  }

  const visit = DATA_SOURCES[0];
  if (visit) {
    offers.push({
      key: 'data',
      group: 'Something you named',
      label: 'Something about the visit',
      hint: visit.hint,
      when: [{ kind: 'data', source: visit.id, op: 'is', values: [visit.values[0] ?? 'yes'] }],
    });
  }

  /*
   * The record, when there is one in scope.
   *
   * This is the entry that closes the audit's worst finding. Making a card red
   * when its price is over half a million used to be five steps across two
   * panels and an invented intermediate name; it is now one line in this menu,
   * and the name still exists — the compiler mints it.
   */
  for (const field of ctx.fields ?? []) {
    const op = OPS_FOR[field.type][0] ?? 'eq';
    offers.push({
      key: `field-${field.key}`,
      group: 'From the record',
      label: field.label,
      hint: `Compare what this row holds in ${field.label}`,
      when: {
        kind: 'compare',
        left: { kind: 'field', key: field.key },
        op,
        ...(op === 'empty' || op === 'notEmpty'
          ? {}
          : { right: literalSeed(field) }),
      },
    });
  }

  for (const attr of SUGGESTED_ATTRS) {
    offers.push({
      key: `attr-${attr.name}`,
      group: 'An attribute',
      label: attr.name,
      hint: attr.hint,
      when: [{ kind: 'attr', name: attr.name, op: 'is', values: [attr.value] }],
    });
  }

  if (ctx.type === 'dialog' || ctx.type === 'popover') {
    offers.push({
      key: 'backdrop',
      group: 'A part of it',
      label: 'The backdrop',
      hint: 'The dimmed area behind it while it is open',
      when: [],
      part: 'backdrop',
    });
  }

  return offers;
}

/** The group headings, in the order the menu draws them. */
export function offerGroups(offers: ConditionOffer[]): string[] {
  const seen: string[] = [];
  for (const offer of offers) if (!seen.includes(offer.group)) seen.push(offer.group);
  return seen;
}

/** A shared label, capitalised for a menu entry that stands on its own. */
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A blank operand of the right type.
 *
 * Typed from the field rather than from the spelling of anything, which is the
 * rule the interaction model states: *types are declared, never inferred*. The
 * sentence is grammatical from the moment it appears — a new condition reading
 * `When ⟨Price⟩ ⟨is over⟩ ⟨0⟩` is one to edit, where `When ⟨⟩ ⟨⟩ ⟨⟩` is a form
 * again.
 */
function literalSeed(field: Field): Value {
  if (field.type === 'number') return { kind: 'literal', type: 'number', value: 0 };
  if (field.type === 'boolean') return { kind: 'literal', type: 'boolean', value: true };
  return { kind: 'literal', type: 'text', value: '' };
}
