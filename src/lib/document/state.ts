/**
 * What an element's state is, and what it can be.
 *
 * A switch group used to be three loose props with no relationship to each
 * other — `switchKey`, `switchDefault`, `switchDesign` — and its **values were
 * not written down anywhere at all**. They were recovered by walking the
 * subtree and reading every control that set one.
 *
 * That was not laziness. `NodeProps` holds primitives, so there was nowhere to
 * put a list; the scrape was the only shape available. It cost three things:
 *
 * - A value could not exist before something set it. The empty case of a
 *   filter, or the error case of a form, could not be designed until the
 *   control that reached it was wired — which is backwards, because the design
 *   is how you decide what the control should do.
 * - Renaming one meant finding every control that mentioned it.
 * - `valuesSetting`'s own docblock admitted the walk attributes a control in a
 *   *nested* group to the outer one as well.
 *
 * So the four move into one declaration and the values are declared. The
 * scrape survives — as a suggestion in the panel, and as the one-time source
 * the migration reads — but it is no longer the truth.
 *
 * ## Why this is a module rather than four fields read in place
 *
 * Forty-odd places asked a node about its state, each by reaching for a prop.
 * One accessor is what makes the migration non-load-bearing: everything reads
 * `stateOf`, `hydrateDocument` folds the old spelling into the new one on the
 * way in, and no other file has to know there were ever two.
 */

import { SWITCH_SHOW_ALL, slug, slugList } from './schema';
import { valuesSetting } from './actions';
import { collectSubtree } from './tree';
import type { NodeProps, SceneNode, StateDecl } from './types';

/**
 * The state this element declares, or null.
 *
 * Null for the overwhelming majority of nodes. A declaration with no key is
 * the same as none — the key reaches an attribute and a selector, and an empty
 * one addresses nothing — so it is normalised away here rather than left for
 * each caller to remember.
 */
export function stateOf(node: SceneNode | undefined): StateDecl | null {
  const decl = node?.state;
  if (!decl) return null;
  const key = slug(decl.key);
  return key ? { ...decl, key } : null;
}

/** The state's name, or empty. The question most callers are actually asking. */
export function stateKeyOf(node: SceneNode | undefined): string {
  return stateOf(node)?.key ?? '';
}

/**
 * Every value a state can take, declared first and scraped only to fill gaps.
 *
 * The order matters and is the whole behaviour change: what the designer wrote
 * down comes first, in the order they wrote it, and anything a control sets
 * that the declaration has not heard of is appended rather than dropped.
 *
 * Appending rather than dropping is deliberate. A control setting an
 * undeclared value is a mistake worth *seeing* — the value is real, it will
 * reach the attribute at runtime, and hiding it from the panel would leave a
 * designer unable to style a case their own page can enter.
 */
export function valuesOf(
  nodes: Record<string, SceneNode>,
  ownerId: string,
  decl: StateDecl
): string[] {
  const found = [...decl.values.map((one) => slug(one)).filter(Boolean)];
  for (const value of scrapedValues(nodes, ownerId, decl.key)) {
    if (!found.includes(value)) found.push(value);
  }
  return found;
}

/**
 * The values controls in this subtree actually set.
 *
 * What the declaration used to be inferred from, kept for two jobs: the
 * migration reads it once, and the panel offers it as *suggestions* beside the
 * declared list. Imprecise in one direction — a control in a nested group is
 * attributed to the outer one too — which was a defect while this was the
 * source of truth and is merely a generous suggestion now.
 */
export function scrapedValues(
  nodes: Record<string, SceneNode>,
  ownerId: string,
  key: string
): string[] {
  const found: string[] = [];
  const add = (raw: unknown) => {
    for (const one of slugList(raw).split(' ')) if (one && !found.includes(one)) found.push(one);
  };
  for (const id of collectSubtree(nodes, ownerId)) {
    const node = nodes[id];
    if (node) add(valuesSetting(node, key).join(' '));
    for (const rule of node?.rules ?? []) {
      forEachStateCondition(rule.when, key, (values) => add(values.join(' ')));
    }
  }
  return found;
}

/** Every `state` condition naming this key, wherever it sits in the tree. */
function forEachStateCondition(
  when: unknown,
  key: string,
  visit: (values: string[]) => void
): void {
  const test = when as { kind?: string; tests?: unknown[]; key?: string; values?: string[] };
  if (!test || typeof test !== 'object') return;
  if (test.kind === 'every' || test.kind === 'some') {
    for (const inner of test.tests ?? []) forEachStateCondition(inner, key, visit);
    return;
  }
  if (test.kind === 'state' && (!test.key || test.key === key)) visit(test.values ?? []);
}

/* --------------------------------------------------------------------------
 * The upgrade
 * ----------------------------------------------------------------------- */

/** The three props a state used to be spread across. */
export const LEGACY_STATE_PROPS = ['switchKey', 'switchDefault', 'switchDesign'] as const;

/**
 * One node's declaration, folded out of the props it used to be.
 *
 * Returns null when the node never declared a state, which is almost all of
 * them. The values are scraped once, here, and written down — after this the
 * document says what it means and nothing has to walk the tree to find out.
 */
export function declarationFrom(
  nodes: Record<string, SceneNode>,
  node: SceneNode
): StateDecl | null {
  const props = node.props as NodeProps & Record<string, unknown>;
  const key = slug(props.switchKey as string | undefined);
  if (!key) return null;

  const initial = slug(props.switchDefault as string | undefined);
  const scraped = scrapedValues(nodes, node.id, key);
  /*
   * The declared value comes first even when nothing sets it. A group whose
   * `switchDefault` names a case no control reaches is a real arrangement —
   * a banner dismissed by one button and never re-shown — and losing it here
   * would turn a working design into one with an undesignable base case.
   */
  const values = initial && !scraped.includes(initial) ? [initial, ...scraped] : scraped;

  /*
   * Not slugged, and that is the one field where slugging would be wrong.
   * `SWITCH_SHOW_ALL` is `*`, a sentinel meaning "lay every case out at once"
   * rather than a case name — `slug` would strip it to nothing and the
   * designer's working view would silently become the first case.
   */
  const raw = props.switchDesign as string | undefined;
  const design = raw === SWITCH_SHOW_ALL ? raw : slug(raw);
  return {
    key,
    values,
    initial: initial || values[0] || '',
    ...(design ? { design } : {}),
  };
}
