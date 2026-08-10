/**
 * Component properties: the named holes an instance is allowed to fill.
 *
 * An instance draws from its master's nodes — the same nodes, with the same
 * ids and therefore the same classes. That is what makes a component a
 * component rather than a copy, and it is also the constraint everything here
 * is shaped by: whatever an instance is allowed to change must be something
 * that leaves the stylesheet alone. Props do. Styles do not.
 *
 * So a property is a pointer at one prop of one node inside the master, and an
 * instance supplies a value for it. Both renderers resolve the same scope from
 * the same function below, apply it in the same place, and generate exactly
 * the CSS they generated before this existed.
 *
 * The tricky case is the one that reads as an exception and is not: hiding.
 * `visible` is not a prop, so it is carried separately in the scope — but it
 * is applied at the same point as the props are, by both renderers, and a
 * hidden node is simply not drawn. No rule, no class, nothing in the sheet.
 */

import { getElement } from './schema';
import type {
  ComponentDefinition,
  ComponentProperty,
  ComponentPropertyType,
  NodeId,
  NodeProps,
  SceneNode,
} from './types';

/* --------------------------------------------------------------------------
 * What can be exposed
 * ----------------------------------------------------------------------- */

export interface ExposableTarget {
  type: ComponentPropertyType;
  /** Absent for `visible`. */
  prop?: string;
  /** What to call the property if nobody renames it. */
  label: string;
}

/**
 * The props of one node that an instance could be allowed to change.
 *
 * Read off the element table rather than listed here, wherever the table
 * knows: `textProp` is already the single answer to "which prop holds this
 * element's words", and duplicating it would mean a button whose label moved
 * silently stopped being exposable.
 */
export function exposableTargets(node: SceneNode): ExposableTarget[] {
  const def = getElement(node.type);
  const out: ExposableTarget[] = [];

  if (def.textual && def.textProp) out.push({ type: 'text', prop: def.textProp, label: 'Text' });
  if (node.type === 'image') {
    out.push({ type: 'image', prop: 'src', label: 'Image' });
    out.push({ type: 'text', prop: 'alt', label: 'Alt text' });
  }
  if (node.type === 'link' || node.type === 'button') {
    out.push({ type: 'link', prop: 'href', label: 'Link' });
  }

  // Last, and available on everything. A card with an optional badge is the
  // commonest reason to reach for a component property at all.
  out.push({ type: 'visible', label: 'Visible' });

  return out;
}

/** One property per target, so the same prop cannot be exposed twice. */
export function targetKey(target: { type: ComponentPropertyType; prop?: string }): string {
  return target.type === 'visible' ? '@visible' : String(target.prop);
}

export function propertyKey(property: ComponentProperty): string {
  return `${property.nodeId}:${targetKey(property)}`;
}

/* --------------------------------------------------------------------------
 * Resolving an instance
 * ----------------------------------------------------------------------- */

export interface OverrideValues {
  props?: NodeProps;
  hidden?: boolean;
}

/** `nodeId → what this instance says about it`. */
export type OverrideScope = Record<NodeId, OverrideValues>;

/**
 * What one instance changes about its master's nodes.
 *
 * Returns `null` when it changes nothing, which is the common case and worth
 * distinguishing: the renderers skip the whole apply step on `null` rather
 * than walking a scope that would have matched nothing.
 *
 * A property whose value the instance has not set contributes nothing — not
 * its default. The master already says the default; writing it into the scope
 * would only make every unmodified instance carry a redundant copy of what it
 * was already going to render.
 */
export function scopeForInstance(
  component: ComponentDefinition | undefined,
  instance: SceneNode
): OverrideScope | null {
  const properties = component?.properties;
  const values = instance.overrides;
  if (!properties?.length || !values) return null;

  let scope: OverrideScope | null = null;

  for (const property of properties) {
    if (!(property.id in values)) continue;
    const value = values[property.id];
    if (value === undefined) continue;

    scope ??= {};
    const entry = (scope[property.nodeId] ??= {});

    if (property.type === 'visible') {
      // Anything but an explicit false leaves it showing. A property that
      // hides a node on a truthy value would be the opposite of its name.
      entry.hidden = value === false;
      continue;
    }
    if (!property.prop) continue;
    (entry.props ??= {})[property.prop] = value;
  }

  return scope;
}

/**
 * A node's props with this instance's values written over them.
 *
 * Returns the node's own object untouched when there is nothing to apply, so
 * the identity the canvas caches on survives an instance that overrides
 * something three nodes away.
 */
export function overriddenProps(node: SceneNode, scope: OverrideScope | null): NodeProps {
  const props = scope?.[node.id]?.props;
  if (!props) return node.props;

  const out = { ...node.props, ...props };

  /*
   * The same trap a record binding falls into, for the same reason.
   *
   * An uploaded image carries a `srcset` ladder and its intrinsic `width` and
   * `height` alongside `src`, and all four describe one file. Point `src` at
   * another and the other three are about the wrong picture — `srcset` worst
   * of all, because it outranks `src` and is therefore what a visitor
   * actually sees. Every instance of the card would show the master's photo
   * however carefully its property had been set.
   *
   * Dropped rather than guessed at. See `boundProps` in renderer/repeat.ts,
   * which has the longer version of this note and the same three deletes.
   */
  if ('src' in props) {
    delete out.srcset;
    delete out.width;
    delete out.height;
  }
  return out;
}

/**
 * What the instance says about this node's visibility, if anything.
 *
 * Three-valued because the two renderers need different things from it, and
 * flattening it here would hand one of them the wrong answer.
 *
 * The published page wants `instanceHidden(…) ?? node.meta.hidden` — a
 * property that says "visible" un-hides a node the master hid, which is the
 * whole point of exposing it.
 *
 * The canvas wants to tell the two apart. It draws a node hidden by `meta`
 * dimmed rather than omitting it, so a designer can find it and bring it back.
 * Doing the same for a node an *instance* hid would be a lie twice over: it is
 * not this node that is hidden, and there is nothing on the canvas that could
 * unhide it — the control is in the inspector. So an instance-hidden node is
 * simply not drawn, on every surface, which is also the only reading that
 * keeps the canvas showing what the file will contain.
 */
export function instanceHidden(node: SceneNode, scope: OverrideScope | null): boolean | undefined {
  return scope?.[node.id]?.hidden;
}

/* --------------------------------------------------------------------------
 * Keeping the two sides honest
 * ----------------------------------------------------------------------- */

/**
 * Properties whose target node still exists in the master.
 *
 * Deleting a node out of a master leaves any property pointing at it with
 * nothing to fill. Pruned rather than repaired, because there is no sensible
 * repair — the hole is gone.
 */
export function livingProperties(
  component: ComponentDefinition,
  nodes: Record<NodeId, SceneNode | undefined>
): ComponentProperty[] {
  return (component.properties ?? []).filter((p) => Boolean(nodes[p.nodeId]));
}

/**
 * Write what an instance was saying into a fresh copy of the master's nodes.
 *
 * Detaching is the moment a component's holes stop existing, so whatever was
 * in them has to become ordinary props on ordinary nodes. Skipping this is the
 * kind of bug that reads as data loss: press Detach and every card on the page
 * reverts to the placeholder text the master was drawn with.
 *
 * @param remap `master node id → the id of its copy`, from `cloneSubtree`.
 */
export function bakeOverrides(
  into: Record<NodeId, SceneNode | undefined>,
  remap: Map<NodeId, NodeId>,
  scope: OverrideScope | null
): void {
  if (!scope) return;

  for (const [masterId, values] of Object.entries(scope)) {
    const copy = into[remap.get(masterId) ?? ''];
    if (!copy) continue;

    if (values.props) Object.assign(copy.props, values.props);
    if (values.hidden === true) copy.meta.hidden = true;
    // An instance showing something the master hides keeps showing it.
    else if (values.hidden === false) delete copy.meta.hidden;
  }
}

/**
 * The value an instance is showing for a property, default included.
 *
 * The inspector needs the default and the renderers do not, which is why this
 * is separate from `scopeForInstance` — a control has to show what is on
 * screen even when nothing has been overridden.
 */
export function valueOf(
  property: ComponentProperty,
  instance: SceneNode
): string | number | boolean | null | undefined {
  const set = instance.overrides?.[property.id];
  if (set !== undefined) return set;
  return property.defaultValue;
}
