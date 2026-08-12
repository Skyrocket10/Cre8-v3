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
 * One attribute, space separated, each part either
 *
 *     value          put the *nearest* enclosing state into `value`
 *     key:value      put the state named `key` into `value`
 *
 * which works because `slug()` narrows both halves to `[A-Za-z0-9_-]` before
 * either is written. A space or a colon cannot appear inside a key or a value,
 * so neither separator is ambiguous and nothing needs escaping — the same
 * argument that lets a switch key go into a stylesheet selector unquoted.
 *
 * The bare form is not legacy. It is the more robust statement: a card that
 * says `annual` drives whichever set it is dropped into, and a card that says
 * `billing:annual` insists on one. A designer means the first far more often
 * than the second, and it is also what every existing document holds, so the
 * common case stays byte-identical in the published file.
 */
import type { NodeAction, NodeEventBinding, SceneNode } from './types';
import { slug } from './schema';

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
  event: string = CLICK
): { state: string; value: string; quiet: boolean }[] {
  const out: { state: string; value: string; quiet: boolean }[] = [];
  for (const action of actionsFor(node, event)) {
    if (action.type !== 'setState') continue;
    const value = slug(action.value);
    if (!value) continue;
    out.push({ state: slug(action.state), value, quiet: Boolean(action.quiet) });
  }
  return out;
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
export function copyTextFor(node: SceneNode, event: string = CLICK): string {
  let text = '';
  for (const action of actionsFor(node, event)) {
    if (action.type === 'copy' && action.text) text = action.text;
  }
  return text;
}

/**
 * Whether pressing this does anything the runtime has to hear about.
 *
 * Read by `resolveTag`: a control that acts is a `<button>`, whatever else it
 * carries, because an `<a>` with no destination is a link a screen reader
 * announces and a keyboard user follows into nothing.
 */
export function actsOnPress(node: SceneNode): boolean {
  return actionsFor(node).some(
    (action) =>
      (action.type === 'setState' && Boolean(slug(action.value))) ||
      (action.type === 'copy' && Boolean(action.text))
  );
}

/** One `onClick` binding holding these actions, or nothing for an empty list. */
export function clickBinding(actions: NodeAction[]): NodeEventBinding[] | undefined {
  return actions.length ? [{ event: CLICK, actions }] : undefined;
}
