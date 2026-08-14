/**
 * What a control does, and how that reaches the markup.
 *
 * The behaviour axis, which `ARCHITECTURE.md` §10 has listed as reserved since
 * the first release. It was reserved for longer than it needed to be, because
 * actions arrived anyway — as props. `switchSet` put the nearest state into a
 * value, `copyText` put a string on the clipboard, and both worked. What a
 * prop cannot do is hold two of anything, or name what it is aimed at, and
 * those turn out to be the same limitation seen from two sides:
 *
 * - A control could only drive the state it was *inside*. A link in a mobile
 *   nav could not close the nav, because the nav is its ancestor and the link
 *   is not inside the thing it wants to shut — it *is* inside it, but so is
 *   every tab set the designer nested underneath, and `closest()` answers with
 *   the innermost. Naming the group is the only way to say which one.
 * - A control could only do one thing. "Close the menu *and* go to Pricing" is
 *   two assignments, and two props have no order and no shared identity.
 *
 * So actions become a list on the node, and this module is the one place that
 * knows how that list is spelled in an attribute. The runtime parses the same
 * grammar from literals, because it is serialised with `toString()` and may
 * not import — the two are kept in step by the checks in `tests/static`, which
 * encode with this and decode with the runtime's own reader.
 *
 * ## The grammar
 *
 * One attribute, space separated, each part one of
 *
 *     value          put the *nearest* enclosing state into `value`
 *     key:value      put the state named `key` into `value`
 *     a|b            put it into whichever of the two it is not in
 *     key:a|b        the same, naming the state
 *
 * which works because `slug()` narrows every half to `[A-Za-z0-9_-]` before
 * any of it is written. A space, a colon and a bar cannot appear inside a key
 * or a value, so no separator is ambiguous and nothing needs escaping — the
 * same argument that lets a switch key go into a stylesheet selector unquoted.
 *
 * The bare form is not legacy. It is the more robust statement: a card that
 * says `annual` drives whichever set it is dropped into, and a card that says
 * `billing:annual` insists on one. A designer means the first far more often
 * than the second, and it is also what every existing document holds, so the
 * common case stays byte-identical in the published file.
 *
 * The third and fourth forms are `toggleState`, and riding this grammar rather
 * than getting an attribute of their own is the whole reason a flip costs
 * about a hundred and fifty bytes instead of five hundred. Everything a set
 * already has — the ancestor-then-page lookup, `sync`, the tab pairing —
 * works unchanged, because by the time the runtime has picked which of the two
 * to write it is holding a value like any other.
 */
import type { Carrier } from './events';
import { EVENTS, carrierOf } from './events';
import type { CollectionRecord, NodeAction, NodeEventBinding, SceneNode, Test } from './types';
import { slug } from './schema';
/*
 * The scheduling rule and the evaluator, borrowed rather than restated.
 *
 * "Can this be answered when the file is written" has one answer in this
 * codebase and it is `foldable`; a second opinion about it here would be a
 * guard that folds for the stylesheet and travels for the action, on the same
 * condition.
 */
import { evaluate, foldable } from '../renderer/test';

/** The event a click-driven action hangs off. Named as the registry names it. */
export const CLICK = 'onClick';

/** Every action a node runs for one event, in the order they were authored. */
export function actionsFor(node: SceneNode, event: string = CLICK): NodeAction[] {
  const out: NodeAction[] = [];
  for (const binding of node.events ?? []) {
    if (binding.event === event) out.push(...binding.actions);
  }
  return out;
}

/**
 * The state assignments, cleaned.
 *
 * Slugged here rather than trusted from the document, for the reason `slug`
 * itself exists: these strings reach an attribute *and* a stylesheet selector,
 * and a document can be hand-edited or arrive from an older release. An
 * assignment with no value is dropped rather than written empty — an empty
 * `data-cre8-set` would make the runtime clear the state on click, which is
 * not something anybody asked for.
 */
export function stateSets(
  node: SceneNode,
  event: string = CLICK,
  record?: CollectionRecord | null
): { state: string; value: string; quiet: boolean }[] {
  const out: { state: string; value: string; quiet: boolean }[] = [];
  for (const action of keptFor(node, event, record)) {
    if (action.type === 'setState') {
      const value = slug(action.value);
      if (!value) continue;
      out.push({ state: slug(action.state), value, quiet: Boolean(action.quiet) });
      continue;
    }
    /*
     * A flip is an assignment whose value has not been decided yet, so it
     * travels as one and the runtime picks. Both halves have to be there:
     * `a|` would encode a bar with nothing after it, and the reader would
     * write an empty value — the same failure the dropped-empty rule above
     * exists to prevent, arriving by a different door.
     *
     * Never quiet. `quiet` means "this control changes the value without
     * being one of the choices" — Back, Next — and a flip is the opposite: it
     * is the only control, and `sync` has to leave its `aria-pressed` alone
     * rather than announce it as one option among several.
     */
    if (action.type === 'toggleState') {
      const [a, b] = action.values ?? [];
      const pair = [slug(a), slug(b)];
      if (!pair[0] || !pair[1]) continue;
      out.push({ state: slug(action.state), value: pair.join(TOGGLE), quiet: false });
    }
  }
  return out;
}

/**
 * Between the two halves of a flip.
 *
 * Outside `slug`'s allowlist, like the space and the colon, so the grammar
 * stays unambiguous and the parser stays three splits.
 */
export const TOGGLE = '|';

/** Whether an encoded assignment is a flip rather than a value. */
export function isToggle(value: string): boolean {
  return value.includes(TOGGLE);
}

/**
 * Those assignments as the attribute the runtime reads.
 *
 * Empty when there are none, so a caller writes the attribute only when it
 * says something.
 */
export function encodeSets(sets: { state: string; value: string }[]): string {
  return sets.map(({ state, value }) => (state ? `${state}:${value}` : value)).join(' ');
}

/**
 * The reverse, for the editor and the checks.
 *
 * Not used by the runtime — that has its own reader, written in literals for
 * the reason its docblock gives — so this exists to be compared against it
 * rather than to be shared with it.
 */
export function decodeSets(attr: string): { state: string; value: string }[] {
  const out: { state: string; value: string }[] = [];
  for (const part of attr.split(/\s+/)) {
    if (!part) continue;
    const at = part.indexOf(':');
    const state = at === -1 ? '' : part.slice(0, at);
    const value = at === -1 ? part : part.slice(at + 1);
    if (value) out.push({ state, value });
  }
  return out;
}

/**
 * The values this node puts a particular state into.
 *
 * What the editor needs to answer "what can this state be": the values are not
 * declared anywhere, they are read off the controls that set them, so the menu
 * cannot fall out of step with the page.
 *
 * A bare assignment counts, because the group being asked about is the one the
 * walk is inside. That is imprecise in one direction — a control in a *nested*
 * group is attributed to the outer one as well — and it was imprecise the same
 * way when this read a prop. Offering a value the outer state cannot actually
 * reach is a menu entry that does nothing; missing one is a state a designer
 * cannot style. The first is recoverable and the second is not.
 */
export function valuesSetting(node: SceneNode, key: string): string[] {
  const out: string[] = [];
  for (const { state, value } of stateSets(node)) {
    if (state && state !== key) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Text this node copies, or empty.
 *
 * Its own attribute rather than a member of the grammar above, because a copy
 * text is arbitrary — spaces, colons, an API key — and the whole reason that
 * grammar needs no escaping is that its operands cannot contain either
 * separator. One clipboard action per node: two would be one overwriting the
 * other, so the last one authored wins and the panel offers a single field.
 */
export function copyTextFor(
  node: SceneNode,
  event: string = CLICK,
  record?: CollectionRecord | null
): string {
  let text = '';
  for (const action of keptFor(node, event, record)) {
    if (action.type === 'copy' && action.text) text = action.text;
  }
  return text;
}

/**
 * The actions that survive planning, in the order they were written.
 *
 * The readers above used to walk `actionsFor` directly, which was right while
 * every action in the list was an action in the file. A guard changes that: an
 * `only` the publisher answered `false` means the action is not there, and a
 * reader that did not know would put its value in the attribute anyway — a
 * button whose condition failed, still setting the state, on a page with no
 * script to stop it.
 *
 * By identity rather than by re-deciding, so there is exactly one place that
 * knows what survives.
 */
export function keptFor(
  node: SceneNode,
  event: string = CLICK,
  record?: CollectionRecord | null
): NodeAction[] {
  const list = actionsFor(node, event);
  const plan = planActions(list, record);
  const inPlan = new Set<NodeAction>([...plan.script, ...plan.native.map((one) => one.action)]);
  return list.filter((action) => inPlan.has(action));
}

/**
 * Whether pressing this does anything the runtime has to hear about.
 *
 * Read by `resolveTag`: a control that acts is a `<button>`, whatever else it
 * carries, because an `<a>` with no destination is a link a screen reader
 * announces and a keyboard user follows into nothing.
 *
 * The emptiness tests are the point rather than an afterthought. An action
 * with nothing in it is not an action — a `setState` with no value would make
 * the runtime *clear* the state on press, and a `copy` with no text would put
 * an empty string on the clipboard — so a node carrying only those still
 * renders as whatever it was and still ships no script.
 */
export function actsOnPress(node: SceneNode): boolean {
  return actionsFor(node).some(runnable);
}

/**
 * Whether this action, as written, asks the runtime to do something.
 *
 * Both halves matter: the verb has to be one with no native carrier, *and* it
 * has to be filled in. Split out of `actsOnPress` because the publisher's
 * script gate and the tag decision now ask it about different lists — a page
 * asks about every event, a tag asks about the press.
 */
export function runnable(action: NodeAction): boolean {
  if (carrierOf(action) !== null) return false;
  switch (action.type) {
    case 'setState':
      return Boolean(slug(action.value));
    case 'toggleState':
      return true;
    case 'copy':
      return Boolean(action.text);
    default:
      return false;
  }
}

/* --------------------------------------------------------------------------
 * The absorption
 * ----------------------------------------------------------------------- */

/**
 * What a press does, gathered into one list.
 *
 * "What happens when this is pressed" was stored in three shapes across four
 * panels — a prop, two references and an action list — with no ordering
 * between them, because there was no list they were all in. This folds the
 * three that can move.
 *
 * ## Why `href` is not one of them
 *
 * Because it is *content*, and the two lists that say so are `SETTABLE` and
 * `BINDABLE`. A destination varies by rule — the same button pointing
 * somewhere else in the annual case — and binds to a record, which is how
 * every card in a repeater links to its own post. An action cannot do either.
 *
 * `refs.popover`, `refs.scrollTo` and `props.submit` carry none of that, and
 * `isSettable`'s docblock says why: structure "would make the variants
 * different *elements* rather than the same element saying something else".
 *
 * So a `navigate` **names** the prop rather than replacing it. With no `to` it
 * means *go where this element's `href` says*, which puts the destination in
 * the list — in order, with its own `only` — while leaving the value itself
 * where a rule and a binding can reach it.
 *
 * Idempotent, and recognised by shape: a node that already says a thing as a
 * verb keeps its verb and loses the older spelling, so running this twice, or
 * on a document half-migrated by an earlier release, changes nothing the
 * second time.
 */
export function migratePress(node: SceneNode): void {
  const already = new Set(everyAction(node).map((action) => action.type));
  const folded: NodeAction[] = [];

  const panel = node.refs?.popover?.node;
  if (panel && !already.has('openPanel') && !already.has('closePanel')) {
    // `popoverAction` is the older spelling of which verb it is. `hide` is a
    // different word, not a different mode — a Close button is what it is.
    const mode = String(node.props.popoverAction ?? 'toggle');
    folded.push(
      mode === 'hide'
        ? { type: 'closePanel', ref: { node: panel } }
        : { type: 'openPanel', ref: { node: panel }, ...(mode === 'show' ? { mode: 'show' } : {}) }
    );
  }
  const jump = node.refs?.scrollTo?.node;
  if (jump && !already.has('scrollTo')) folded.push({ type: 'scrollTo', ref: { node: jump } });
  if (node.props.submit && !already.has('submit')) folded.push({ type: 'submit' });

  if (folded.length) {
    const others = (node.events ?? []).filter((binding) => binding.event !== CLICK);
    const mine = [...actionsFor(node), ...folded];
    node.events = [...others, { event: CLICK, actions: mine }];
  }

  /*
   * The older spellings go, and that is what makes this a migration rather
   * than a second way to say the same thing. `pressed()` reads the verb first
   * and the prop second, so leaving them would be harmless today and would be
   * two sources of truth the moment somebody edited one of them.
   */
  if (node.refs) {
    delete node.refs.popover;
    delete node.refs.scrollTo;
    if (!Object.keys(node.refs).length) delete node.refs;
  }
  delete node.props.popoverAction;
  delete node.props.submit;
}

/**
 * The one action of a kind this node does when pressed, if any.
 *
 * Singular on purpose, for the kinds that name something: an element has one
 * panel it opens and one section it jumps to, because it has one
 * `popovertarget` and one `href`. `planActions` refuses a second at compile
 * time; this is how the editor avoids writing one in the first place.
 */
export function pressActionOfType<T extends NodeAction['type']>(
  node: SceneNode,
  type: T
): Extract<NodeAction, { type: T }> | undefined {
  return actionsFor(node).find((action): action is Extract<NodeAction, { type: T }> =>
    action.type === type
  );
}

/**
 * Replace, add or remove the one action of a kind, leaving the rest in order.
 *
 * The editor's half of the absorption. Every panel that used to write a prop
 * or a reference writes through here instead, so "what happens when this is
 * pressed" has one storage shape and the order a designer sees is the order
 * the document holds.
 */
export function setPressAction(
  node: SceneNode,
  type: NodeAction['type'],
  next: NodeAction | null
): void {
  const others = (node.events ?? []).filter((binding) => binding.event !== CLICK);
  const kept = actionsFor(node).filter((action) => action.type !== type);
  const actions = next ? [...kept, next] : kept;
  if (actions.length || others.length) {
    node.events = [...others, ...(actions.length ? [{ event: CLICK, actions }] : [])];
    if (!node.events.length) delete node.events;
  } else {
    delete node.events;
  }
}

/* --------------------------------------------------------------------------
 * "…but only when"
 * ----------------------------------------------------------------------- */

/**
 * The guard this element is gated by in the browser, or null.
 *
 * A guard that the publisher could answer is not here: `planActions` has
 * already kept or dropped that action, and a decided condition has nothing
 * left to travel. What reaches this is the other kind — a guard reading
 * something a visitor can change — and it becomes one attribute on the
 * element, because an element has one attribute to be gated by.
 *
 * ## Why one, when `only` is per action
 *
 * Because the two halves have different limits and it is worth being exact
 * about which is which.
 *
 * A guard that **folds** is per action in the fullest sense: it is answered
 * per row of a repeater, at publish, and two actions on one control can carry
 * two completely different folded guards. Nothing here is involved.
 *
 * A guard that **does not fold** has to be an attribute, and there is one
 * element. So an unfoldable guard gates the whole gesture, and a binding whose
 * actions do not agree about it is a design a page cannot express —
 * `planActions` refuses the ones that differ rather than running them under
 * somebody else's condition, which is the same bargain two verbs wanting one
 * `href` strike.
 *
 * Compared by shape rather than by identity: two actions written with the same
 * condition are the same condition, and a designer who wrote it twice should
 * not get a refusal for it.
 */
export function guardOf(node: SceneNode): Test | undefined {
  for (const action of everyAction(node)) {
    if (action.only && !foldable(action.only)) return action.only;
  }
  return undefined;
}

/** Whether two guards are the same condition. Absence counts as a guard too. */
function sameGuard(a: Test | undefined, b: Test | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/* --------------------------------------------------------------------------
 * The native-first compiler
 * ----------------------------------------------------------------------- */

/** What one carrier ended up holding, and which action put it there. */
export interface Claim {
  carrier: Exclude<Carrier, null>;
  action: NodeAction;
}

/**
 * What a list of actions compiles to.
 *
 * `native` is at most one claim per carrier; `script` is everything the
 * runtime has to run; `refused` is the honest answer to a list that asks one
 * element to do two contradictory things.
 */
export interface ActionPlan {
  native: Claim[];
  script: NodeAction[];
  refused: NodeAction[];
  /** The guard the browser has to answer before any of it runs, if there is one. */
  gated?: Test;
}

/**
 * Sort a list of actions into what the markup carries and what the script runs.
 *
 * The one place the native-first rule lives, so "does this page need the
 * runtime", "is this an `<a>` or a `<button>`" and "what attributes does it
 * get" are three readings of one answer rather than three functions that have
 * to agree. They did not have to agree while there were two verbs; with nine
 * they would drift within a month.
 *
 * **First claim wins, in authored order.** An element has one `href`, one
 * `popovertarget` and one `type`, so a second action wanting a carrier the
 * list has already spent cannot be honoured — not because the compiler is
 * simple, but because the markup has nowhere to put it. Reported rather than
 * dropped: a designer who wrote "go to Pricing and also open the menu" has
 * asked for something a page cannot do, and the panel should say so. Silently
 * keeping the first would be the same class of bug as the switch section that
 * stopped responding — a change that appears to land and does not.
 *
 * An unrunnable action is neither: a `copy` with no text is an unfinished
 * thought, not a reason to ship two kilobytes of runtime.
 *
 * ## Guards
 *
 * A `record` makes the difference between the two schedules. With one in hand
 * a foldable guard is *answered*: true and the action is as if it had never
 * been conditional, false and it is not in the plan at all — no attribute, no
 * entry in the table, nothing in the file. Without one — the canvas, where
 * there is no row to be — a foldable guard is left alone rather than guessed
 * at, so the editor draws the control the designer is working on.
 *
 * An unfoldable guard survives into `gated`, and every action in the plan has
 * to agree about it, because it becomes one attribute on one element. The odd
 * ones out are refused for the same reason a second `href` is: the markup has
 * nowhere to put them, and running them under a condition their author did not
 * write would be worse than saying so.
 */
export function planActions(
  actions: readonly NodeAction[],
  record?: CollectionRecord | null
): ActionPlan {
  const native: Claim[] = [];
  const script: NodeAction[] = [];
  const refused: NodeAction[] = [];
  const taken = new Set<string>();
  // The first unfoldable guard sets the terms; `guardOf` reads the node the
  // same way, so the attribute the renderer mints and the condition the plan
  // enforces are the same one by construction rather than by agreement.
  const gated = actions.find((action) => action.only && !foldable(action.only))?.only;

  for (const action of actions) {
    if (action.only) {
      if (foldable(action.only)) {
        // Undecidable stays: `evaluate` answers null for a foldable test with
        // no record, which is the canvas. Only a flat `false` drops it.
        if (record !== undefined && evaluate(action.only, record ?? null) === false) continue;
      } else if (!sameGuard(action.only, gated)) {
        refused.push(action);
        continue;
      }
    } else if (gated) {
      // An unguarded action on a gated element. Refused rather than run,
      // because the attribute gates the element and there is no way to exempt
      // one action from it — and quietly making it conditional would be a
      // control that stops working for reasons nothing on screen explains.
      refused.push(action);
      continue;
    }

    const carrier = carrierOf(action);
    if (carrier === null) {
      if (runnable(action)) script.push(action);
      continue;
    }
    if (taken.has(carrier)) {
      refused.push(action);
      continue;
    }
    taken.add(carrier);
    native.push({ carrier, action });
  }
  return { native, script, refused, gated };
}

/** The action holding a carrier, or undefined. The question every caller asks. */
export function claimed(plan: ActionPlan, carrier: Exclude<Carrier, null>): NodeAction | undefined {
  return plan.native.find((claim) => claim.carrier === carrier)?.action;
}

/**
 * Everything a node does, across every event that is actually delivered.
 *
 * Filtered against the registry rather than flattened, and the difference is
 * not academic: a binding for an event nothing raises has always been inert —
 * `actionsFor` matches by name, so `onHover` reached no attribute — and a gate
 * that flattened every binding would have started shipping two kilobytes of
 * runtime for it while still doing nothing when the visitor hovered. A page
 * that carries the script and has no way to run it is worse than either
 * honest answer.
 */
export function everyAction(node: SceneNode): NodeAction[] {
  return (node.events ?? [])
    .filter((binding) => EVENTS.some((event) => event.id === binding.event))
    .flatMap((binding) => binding.actions);
}

/**
 * Whether this node puts any script on the page, whatever event it hangs off.
 *
 * The publisher's gate. Wider than `actsOnPress` on purpose: a select that
 * sets a state `onChange` needs the runtime exactly as much as a button that
 * sets one `onClick`, and asking only about the press is how the second one
 * would have shipped a page whose dropdown did nothing.
 */
export function runsScript(node: SceneNode): boolean {
  return everyAction(node).some(runnable);
}

/** One `onClick` binding holding these actions, or nothing for an empty list. */
export function clickBinding(actions: NodeAction[]): NodeEventBinding[] | undefined {
  return actions.length ? [{ event: CLICK, actions }] : undefined;
}
