/**
 * What can happen to an element, and what it can do about it.
 *
 * Two tables, because they answer two different questions and the panel needs
 * both: `EVENTS` says *when*, `VERBS` says *what*. Data rather than a `switch`
 * for the same reason `STYLE_VOCABULARY` and `conditionOffers` are — the menu
 * is generated from the table, so "the panel can author everything the
 * compiler understands" is a claim a check can drive rather than a claim a
 * reviewer has to take on trust.
 *
 * ## Why the events are a table at all
 *
 * `ElementDefinition.events` existed before this and was, in full:
 *
 *     events: ['onClick']   // button
 *     events: ['onClick']   // link
 *     events: ['onSubmit']  // form
 *
 * Three entries, a bare list of strings, and **nothing read it**. `actionsFor`
 * defaulted to `onClick` and no caller ever passed anything else, so `onSubmit`
 * was declared, typed, documented, and unread. A registry that nothing reads is
 * not a registry, and the fix is not to delete it — it is to make it the thing
 * the panel and the renderer both ask.
 *
 * ## Why there is one event in it
 *
 * Because one is what is delivered. `onChange` and `onSubmit` are both wanted
 * and both cost the same two things: a listener in a runtime that is
 * serialised into every interactive page, and a declared answer for the
 * visitor with scripting off. The second is not optional here — the execution
 * model makes the no-script fallback a *required* declaration, which is why
 * `unfinished()` refuses to call an assignment complete without one — and the
 * machinery for demanding it of an *action* is X7's.
 *
 * `onVisible`, `onLoad` and `onKey` are the same argument with no native
 * gesture behind them at all.
 *
 * So this table is shorter than the plan's, on purpose. It is still strictly
 * better than what it replaces: `ElementDefinition.events` promised `onSubmit`
 * on every form and delivered nothing, and a promise nothing keeps is worse
 * than an absence — `eventApplies` now makes reintroducing one impossible
 * without also making it true.
 */

import type { ElementType, NodeAction } from './types';

/** One thing that can happen to an element. */
export interface EventDecl {
  /** As it is spelled in `NodeEventBinding.event`. */
  id: string;
  /** The panel's word for it, in the second person and the present tense. */
  label: string;
  hint: string;
  /**
   * Which element types raise it. `'any'` for the events that are really about
   * a gesture rather than a control: anything can be pressed since C2 made a
   * layout box able to carry a destination, and refusing a card the same event
   * a button gets would be the panel disagreeing with the renderer.
   */
  appliesTo: readonly ElementType[] | 'any';
}

/**
 * Every event, in the order a panel should offer them.
 *
 * Pressed first because it is what nine designs in ten mean.
 */
export const EVENTS: readonly EventDecl[] = [
  {
    id: 'onClick',
    label: 'Pressed',
    hint: 'Clicked, tapped, or reached with the keyboard and activated',
    // Anything can be pressed. C2 gave a layout box a destination, so refusing
    // a card the event a button gets would be the panel disagreeing with the
    // renderer about what the page does.
    appliesTo: 'any',
  },
] as const;

/** The events this element type offers, which is what a panel lists. */
export function eventsFor(type: ElementType): EventDecl[] {
  return EVENTS.filter(
    (event) => event.appliesTo === 'any' || event.appliesTo.includes(type)
  );
}

/** Whether an element raises this event at all. Guards a hand-edited document. */
export function eventApplies(id: string, type: ElementType): boolean {
  return eventsFor(type).some((event) => event.id === id);
}

/* --------------------------------------------------------------------------
 * Verbs
 * ----------------------------------------------------------------------- */

export type VerbType = NodeAction['type'];

/**
 * What carries a verb once the page is a file.
 *
 * The whole of the native-first discipline is in this one field. A verb with a
 * carrier compiles to markup the browser already acts on and costs no script;
 * a verb with `null` has nothing behind it and is the reason a page ships the
 * runtime at all.
 *
 * An element has one of each carrier, which is not an implementation limit —
 * an `<a>` has one `href`, a `<button>` has one `popovertarget`, and no
 * element submits two forms. So two verbs wanting the same carrier is a
 * genuine conflict rather than something a cleverer compiler could resolve,
 * and `planActions` reports it rather than silently dropping one.
 */
export type Carrier = 'href' | 'popover' | 'submit' | null;

export interface VerbDecl {
  type: VerbType;
  label: string;
  hint: string;
  carrier: Carrier;
  /**
   * Which element types can do it. Mostly `'any'`: what a press *does* is
   * rarely a property of what the thing looks like. `submit` is the exception
   * — nothing but a control inside a form can send one.
   */
  appliesTo: readonly ElementType[] | 'any';
}

/**
 * Every verb, keyed so a `NodeAction` can be looked up without a `switch`.
 *
 * Deliberately absent, and staying absent: create a record, call an API, send
 * an email. Those are the server half of what Bubble does. This project's data
 * layer is D1 plus a publish pipeline — it has no request-time execution on a
 * published page by design — and offering a verb that quietly needs one would
 * put a half-working backend inside a website builder.
 */
export const VERBS: Record<VerbType, VerbDecl> = {
  setState: {
    type: 'setState',
    label: 'Set a state',
    hint: 'Put a switch into one of its cases',
    carrier: null,
    appliesTo: 'any',
  },
  toggleState: {
    type: 'toggleState',
    label: 'Flip a state',
    hint: 'Move a two-case switch to whichever case it is not in',
    carrier: null,
    appliesTo: 'any',
  },
  copy: {
    type: 'copy',
    label: 'Copy text',
    hint: 'Put something on the clipboard and say so',
    carrier: null,
    appliesTo: 'any',
  },
  navigate: {
    type: 'navigate',
    label: 'Go somewhere',
    hint: 'Another page, or an address outside the site',
    carrier: 'href',
    appliesTo: 'any',
  },
  scrollTo: {
    type: 'scrollTo',
    label: 'Scroll to a section',
    hint: 'Somewhere further down this page',
    carrier: 'href',
    appliesTo: 'any',
  },
  openPanel: {
    type: 'openPanel',
    label: 'Open a panel',
    hint: 'A menu or a dialog on this page',
    carrier: 'popover',
    appliesTo: 'any',
  },
  closePanel: {
    type: 'closePanel',
    label: 'Close a panel',
    hint: 'Dismiss one — usually the panel this button is inside',
    carrier: 'popover',
    appliesTo: 'any',
  },
  submit: {
    type: 'submit',
    label: 'Send the form',
    hint: 'Post the form this is inside',
    carrier: 'submit',
    appliesTo: 'any',
  },
};

/** The verbs offered on this element type, in table order. */
export function verbsFor(type: ElementType): VerbDecl[] {
  return Object.values(VERBS).filter(
    (verb) => verb.appliesTo === 'any' || verb.appliesTo.includes(type)
  );
}

/**
 * What would carry this action in the published file, or null for the runtime.
 *
 * A function rather than a field read in place, because an action's carrier is
 * a property of the *action* and not only of its type — the moment X7 puts an
 * `only` on one, a `navigate` that has to be decided in the browser stops
 * being an `href`. Routing every caller through here now means that change
 * lands in one function rather than in nine call sites.
 */
export function carrierOf(action: NodeAction): Carrier {
  return VERBS[action.type]?.carrier ?? null;
}

/** Whether running this needs the behaviour runtime on the page. */
export function needsScript(action: NodeAction): boolean {
  return carrierOf(action) === null;
}
