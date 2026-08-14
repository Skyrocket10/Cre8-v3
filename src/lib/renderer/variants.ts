/**
 * One node, more than one element.
 *
 * Style overrides compile to CSS. **Content overrides cannot** — `content:`
 * works only on pseudo-elements, which are not selectable, not reliably in the
 * accessibility tree and not indexed. So conditional text has exactly two
 * possible implementations: put both strings in the markup and let a rule hide
 * one, or keep them in a data blob and have a script write `textContent`. The
 * second gives a crawler the default only and stops being honest with
 * scripting off.
 *
 * The rule this file implements:
 *
 *   > Alternatives known at publish time expand into elements.
 *   > Values not known until runtime are written by the runtime.
 *
 * The designer never sees the duplication. The document holds one node whose
 * rules carry `set`, and this turns it into the list of elements that node
 * becomes — base first, then one per rule — each with a synthetic hiding rule
 * of exactly the shape a switch case already compiles to. The generator learns
 * nothing new: it emits those rules the way it emits every other one.
 *
 * Both renderers loop over this, so the published DOM and the canvas DOM have
 * the same shape. Only the editor-only attributes differ, and `activeVariant`
 * decides which element gets them.
 *
 * The axis an expansion varies on is a switch value **or** a data source —
 * `axisOf` flattens the two into one shape, and nothing below it knows which
 * it was handed. That is stage 3's claim, and it is the reason a strip that
 * reads differently after nine at night needed no new expansion path.
 */

import { SWITCH_SHOW_ALL, readCase, slug } from '../document/schema';
import { conditionsOf } from '../document/when';
import { stateKeyOf, stateOf } from '../document/state';
import { designValue } from '../runtime/data';
import type {
  Condition,
  NodeProps,
  ProjectSettings,
  SceneNode,
  StyleRule,
} from '../document/types';

/** Stable, collision-free class name for a node. */
export function nodeClass(id: string): string {
  return `c-${id}`;
}

/**
 * The class that addresses one variant rather than all of them.
 *
 * Every variant carries the node class *and* this, so the node's own styles,
 * its breakpoint overrides and any rule that does not `set` reach all of them,
 * while the hiding rule and the rule's own `apply` reach exactly one. Both are
 * a single class, so everything still weighs (0,1,0) and source order is still
 * the whole of precedence.
 */
export function variantClass(id: string, key: string): string {
  return `c-${id}-${key}`;
}

export interface Variant {
  /** Empty when the node renders as a single element, which is the usual case. */
  key: string;
  /** The `class` attribute this element carries. */
  className: string;
  /** The node's props with the rule's `set` merged over them. */
  props: NodeProps;
  /**
   * When this element is on screen, as a rule the generator compiles like any
   * other. Null when it always is.
   */
  hide: StyleRule | null;
  /** Which rule's `set` produced it. The generator keys that rule's `apply` here. */
  ruleId: string | null;
}

/** Props a rule is allowed to override. */
const SETTABLE = new Set([
  'text',
  'html',
  'label',
  'alt',
  'src',
  'href',
  'name',
  'caption',
  'placeholder',
  'value',
  'title',
]);

/**
 * Deliberately narrow, for two different reasons.
 *
 * Structure — `switchKey`, `level`, `popoverTarget` — would make the variants
 * different *elements* rather than the same element saying something else, and
 * two of them would then fight over one DOM id. And a prop nobody can see the
 * effect of is a control that appears to do nothing.
 */
export function isSettable(prop: string): boolean {
  return SETTABLE.has(prop);
}

/** A rule that changes content, as opposed to only styling. */
export function setsContent(rule: StyleRule): boolean {
  if (!rule.set) return false;
  for (const key of Object.keys(rule.set)) if (isSettable(key)) return true;
  return false;
}

const hideRule = (id: string, when: Condition): StyleRule => ({
  id,
  when,
  apply: { display: 'none' },
});

/**
 * The one axis a rule varies on, if it varies on exactly one.
 *
 * A state and a data source are the same shape here on purpose — that is the
 * whole claim stage 3 makes. Content that changes with the time of day and
 * content that changes with a switch expand identically, and nothing below
 * this function knows which it was handed.
 */
function axisOf(
  condition: Condition
): { kind: Axis; key: string; values: string[] } | null {
  // Narrowed before the operator is read: `pointer` and `control` conditions
  // are pseudo-classes and carry neither an operator nor values.
  switch (condition.kind) {
    case 'state':
      return condition.op === 'is' && condition.values.length
        ? { kind: 'state', key: condition.key, values: condition.values }
        : null;
    case 'data':
      return condition.op === 'is' && condition.values.length
        ? { kind: 'data', key: condition.source, values: condition.values }
        : null;
    /*
     * An attribute is an axis too, and the guarantee this function exists to
     * protect holds for it unchanged.
     *
     * What is required is mutual exclusion: each variant needs exactly one
     * condition, and the base needs one more. An attribute either equals one of
     * a set of values or it does not — the same two-sided split a state gives —
     * so the expansion stays linear. Nothing about `state` was load-bearing
     * beyond that.
     *
     * It was excluded because attributes came later and nobody revisited the
     * list, which cost the copy button its word: the runtime marks it with
     * `data-cre8-copied`, a rule keyed on that could restyle it, and a rule
     * that changed it to "Copied" was silently dropped here.
     */
    case 'attr':
      return condition.op === 'is' && condition.values.length
        ? { kind: 'attr', key: condition.name, values: condition.values }
        : null;
    default:
      return null;
  }
}

/** The three things a content variant may key on. */
type Axis = 'state' | 'data' | 'attr';

const onAxis = (kind: Axis, key: string, op: 'is' | 'isNot', values: string[]): Condition => {
  if (kind === 'data') return { kind: 'data', source: key, op, values };
  if (kind === 'attr') return { kind: 'attr', name: key, op, values };
  return { kind: 'state', key, op, values };
};

const cache = new WeakMap<SceneNode, Variant[]>();

/**
 * The elements a node becomes.
 *
 * Memoised on node identity: Immer hands back a new object only for nodes that
 * actually changed, so this costs one allocation per edited node rather than
 * one per node per render.
 *
 * @param base What the variants start from. Defaults to the node's own props;
 *   inside a repeater it is those props with the record's fields written over
 *   them, which is how the documented order — base → bind → set — falls out
 *   without a third merge. A caller-supplied base skips the cache: it changes
 *   per row while the node does not, and one entry per node is the whole point
 *   of keying on node identity.
 */
export function variantsOf(node: SceneNode, base?: NodeProps): Variant[] {
  if (base && base !== node.props) return build(node, base);
  const cached = cache.get(node);
  if (cached) return cached;
  const built = build(node, node.props);
  cache.set(node, built);
  return built;
}

function build(node: SceneNode, props: NodeProps): Variant[] {
  const single: Variant[] = [
    { key: '', className: nodeClass(node.id), props, hide: null, ruleId: null },
  ];

  const setting = (node.rules ?? []).filter(setsContent);
  if (!setting.length) return single;

  /*
   * The constraint that keeps this linear.
   *
   * If two `set` rules could match at once, each element would have to say
   * "show me when my rule matches and no later one does", and the number of
   * generated conditions would grow with the square of the rules. Requiring
   * them to be mutually exclusive — one state, `is`, disjoint values — means
   * each variant needs one condition and the base needs one more.
   *
   * A rule that does not fit is skipped rather than approximated: its `set`
   * simply does not apply. That is the same policy the generator uses for a
   * condition it cannot resolve, and the static suite refuses to let a block
   * ship one.
   */
  let axis: { kind: Axis; key: string } | null = null;
  const claimed = new Set<string>();
  const usable: { rule: StyleRule; values: string[] }[] = [];

  for (const rule of setting) {
    if (rule.part || rule.breakpoint) continue;
    /*
     * Exactly one condition, and `conditionsOf` is how that question is now
     * asked: it answers with the flat AND when the rule is one, and `null`
     * when the rule branches or compares. Both of those are rules this
     * expansion cannot make mutually exclusive, so both are skipped — the
     * same answer the length check gave, for a wider set of shapes.
     */
    const conditions = conditionsOf(rule.when);
    if (conditions?.length !== 1) continue;
    const found = axisOf(conditions[0]!);
    if (!found) continue;
    if (axis === null) axis = { kind: found.kind, key: found.key };
    else if (axis.kind !== found.kind || axis.key !== found.key) continue;
    if (found.values.some((value) => claimed.has(value))) continue;

    for (const value of found.values) claimed.add(value);
    usable.push({ rule, values: found.values });
  }

  if (!usable.length || !axis) return single;
  const { kind, key } = axis;

  const variants: Variant[] = [
    {
      key: 'v0',
      className: `${nodeClass(node.id)} ${variantClass(node.id, 'v0')}`,
      props,
      // The base is what shows when none of the alternatives do, which is one
      // condition rather than one per rule because they are exclusive.
      hide: hideRule(`${node.id}-v0`, onAxis(kind, key, 'is', [...claimed])),
      ruleId: null,
    },
  ];

  usable.forEach(({ rule, values }, index) => {
    const key_ = `v${index + 1}`;
    variants.push({
      key: key_,
      className: `${nodeClass(node.id)} ${variantClass(node.id, key_)}`,
      props: merge(props, rule.set!),
      hide: hideRule(`${node.id}-${key_}`, onAxis(kind, key, 'isNot', values)),
      ruleId: rule.id,
    });
  });

  return variants;
}

/** `set` only carries the props it overrides; an explicit `undefined` clears one. */
function merge(base: NodeProps, over: NodeProps): NodeProps {
  const out: NodeProps = { ...base };
  for (const [prop, value] of Object.entries(over)) {
    if (!isSettable(prop)) continue;
    if (value === undefined) delete out[prop];
    else out[prop] = value;
  }
  return out;
}

/**
 * Which case an element belongs to, for the attributes the runtime reads.
 *
 * The node's own case wins when it has one: that is the structural fact a tab
 * set pairs a panel on. A variant's condition is expressed purely in CSS and
 * needs no attribute — except when the node has no case of its own, which is
 * the pricing row that varies its text by the billing state and nothing else.
 */
export function caseOf(node: SceneNode, variant: Variant) {
  return readCase(node.rules) ?? (variant.hide ? readCase([variant.hide]) : null);
}

/* --------------------------------------------------------------------------
 * Resolving a state
 * ----------------------------------------------------------------------- */

/**
 * Which element owns the state a condition names.
 *
 * Named explicitly, a condition can reach past the nearest state to one
 * further up — a card inside a filtered grid reacting to the section's billing
 * switch. Unnamed it means the nearest, and *itself* first: a node that
 * declares a state and also depends on it is the dismissible case.
 */
export function stateOwner(
  nodes: Record<string, SceneNode>,
  node: SceneNode,
  name: string
): { node: SceneNode; key: string; self: boolean } | null {
  const own = stateKeyOf(node);
  if (own && (!name || own === name)) return { node, key: own, self: true };

  let current: SceneNode | undefined = node.parentId ? nodes[node.parentId] : undefined;
  let guard = 0;
  while (current && guard++ < 200) {
    const key = stateKeyOf(current);
    if (key && (!name || key === name)) return { node: current, key, self: false };
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return null;
}

/**
 * The variant the canvas should treat as the real element.
 *
 * Every surface renders every variant, so the published DOM and the canvas DOM
 * have the same shape — but exactly one of them has a box at a time, and the
 * editor needs to know which. Selection outlines are measured from a real
 * element, a click has to select something, and double-clicking to edit text
 * has to put the caret in the copy the designer can see.
 *
 * The renderer itself stays state-blind: CSS decides what is on screen. This
 * is the editor asking the same question in advance, from the design-time
 * value, and it is the only place in the codebase that evaluates a condition
 * outside a stylesheet.
 */
export function activeVariant(
  nodes: Record<string, SceneNode>,
  node: SceneNode,
  settings: ProjectSettings
): Variant {
  const variants = variantsOf(node);
  if (variants.length === 1) return variants[0]!;

  for (const variant of variants) {
    if (!variant.hide) return variant;
    const condition = conditionsOf(variant.hide.when)?.[0];
    if (!condition) return variant;

    let value: string;
    if (condition.kind === 'data') {
      // The data equivalent of `switchDesign`: which value the canvas is
      // working against. It never leaves the editor, so looking at the evening
      // copy cannot change what the site says in the morning.
      value = designValue(settings, condition.source);
    } else if (condition.kind === 'state') {
      const owner = stateOwner(nodes, node, condition.key);
      // Nothing declares the state, or the group is laid out with every case
      // at once — either way nothing is hidden, so the base is the honest
      // answer.
      if (!owner) break;
      const decl = stateOf(owner.node);
      if (decl?.design === SWITCH_SHOW_ALL) break;
      value = slug(decl?.design) || slug(decl?.initial);
    } else {
      /*
       * An attribute axis, and the base variant is always the answer.
       *
       * The attributes content varies on are written by the runtime in response
       * to a press — `data-cre8-copied` after a successful copy — so at design
       * time none of them is set and the base is what a visitor sees first.
       * That is also what a designer wants on the canvas: a copy button reading
       * "Copy", not one frozen in its confirmation.
       */
      return variant;
    }

    const matches = condition.values.includes(value);
    if (condition.op === 'is' ? !matches : matches) return variant;
  }
  return variants[0]!;
}
