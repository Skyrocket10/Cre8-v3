/**
 * Document operations.
 *
 * Every editor mutation lands here as a plain function over a mutable document.
 * The store runs them inside an immer transaction and records the resulting
 * patches, which is what makes undo/redo, batching and (later) AI-authored
 * edits all use one code path instead of three.
 *
 * These functions never touch selection, viewport or any other UI concern.
 */

import {
  allRoots,
  bakeOverrides,
  exposableTargets,
  livingProperties,
  rootForInstance,
  scopeForInstance,
  targetKey,
  type ExposableTarget,
} from './components';
import {
  buildTree,
  cloneSubtree,
  createNode,
  pruneRefs,
  structuredCloneCompat,
  type NodeSpec,
} from './factory';
import { uid, slugify } from './id';
import { fieldsRead } from '../renderer/test';
import { SWITCH_SHOW_ALL, canContain, getElement, readCase, slug } from './schema';
import {
  canReparent,
  collectSubtree,
  getNode,
  isAncestorOf,
  topMostNodes,
  type NodeMap,
} from './tree';
import { LIMITS } from './types';
import type {
  Breakpoint,
  Collection,
  ComponentDefinition,
  ComponentProperty,
  ComponentVariant,
  Cre8Document,
  ElementType,
  Field,
  FieldType,
  NodeId,
  NodeProps,
  Page,
  SceneNode,
  StyleDecl,
  StyleProp,
  StyleRule,
} from './types';

/* --------------------------------------------------------------------------
 * Structure
 * ----------------------------------------------------------------------- */

export function attachChild(
  nodes: NodeMap,
  parentId: NodeId,
  childId: NodeId,
  index?: number
): void {
  const parent = nodes[parentId];
  const child = nodes[childId];
  if (!parent || !child) return;

  detachChild(nodes, childId);
  const at = index === undefined ? parent.children.length : clamp(index, 0, parent.children.length);
  parent.children.splice(at, 0, childId);
  child.parentId = parentId;
}

export function detachChild(nodes: NodeMap, childId: NodeId): void {
  const child = nodes[childId];
  if (!child?.parentId) return;
  const parent = nodes[child.parentId];
  if (!parent) return;
  const index = parent.children.indexOf(childId);
  if (index >= 0) parent.children.splice(index, 1);
}

/** Insert an already-built subtree (root plus descendants) into the document. */
export function insertSubtree(
  doc: Cre8Document,
  subtree: NodeMap,
  rootId: NodeId,
  parentId: NodeId,
  index?: number
): NodeId | null {
  if (!doc.nodes[parentId]) return null;
  for (const [id, node] of Object.entries(subtree)) doc.nodes[id] = node;
  attachChild(doc.nodes, parentId, rootId, index);
  return rootId;
}

export function insertElement(
  doc: Cre8Document,
  type: ElementType,
  parentId: NodeId,
  index?: number,
  overrides?: { name?: string; props?: NodeProps; styles?: StyleDecl }
): NodeId | null {
  const parent = doc.nodes[parentId];
  if (!parent) return null;

  const node = createNode(type, overrides);
  node.name = overrides?.name ?? uniqueName(doc.nodes, getElement(type).defaultName);
  doc.nodes[node.id] = node;
  attachChild(doc.nodes, parentId, node.id, index);
  return node.id;
}

export function insertSpec(
  doc: Cre8Document,
  spec: NodeSpec,
  parentId: NodeId,
  index?: number
): NodeId | null {
  const subtree: NodeMap = {};
  const { rootId } = buildTree(spec, subtree, parentId);
  return insertSubtree(doc, subtree, rootId, parentId, index);
}

export function removeNodes(doc: Cre8Document, ids: NodeId[]): void {
  const roots = topMostNodes(doc.nodes, ids);
  for (const id of roots) {
    const node = doc.nodes[id];
    if (!node) continue;
    // Never delete a page root or a component master through this path.
    if (doc.pages.some((p) => p.rootNodeId === id)) continue;
    if (doc.components.some((c) => allRoots(c).includes(id))) continue;

    detachChild(doc.nodes, id);
    for (const descendant of collectSubtree(doc.nodes, id)) delete doc.nodes[descendant];
  }
  pruneComponentProperties(doc);
  // And every reference into what was just deleted. Component properties had
  // this and references did not, so deleting a panel left each button that
  // opened it pointing at an id no longer in the document — which renders as
  // `popovertarget="p-<gone>"` and makes the button do nothing at all.
  pruneRefs(doc.nodes);
}

/* --------------------------------------------------------------------------
 * References
 * ----------------------------------------------------------------------- */

/** Which button, if any, opens this panel. */
export function invokerOf(doc: Cre8Document, panelId: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.refs?.popover?.node === panelId) return node.id;
  }
  return null;
}

/** Which element a panel is currently positioned against. */
export function anchorOf(doc: Cre8Document, panelId: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.refs?.anchorFor?.node === panelId) return node.id;
  }
  return null;
}

/**
 * "Put this menu next to that button."
 *
 * One call for what the document stores as a back-reference on the *other*
 * element, because that is the sentence somebody means and it should be one
 * action in history rather than two. Any previous anchor for this panel is
 * cleared first: two elements claiming the name resolves to whichever is
 * lower in the tree, which is a menu that moves when an unrelated part of the
 * page is reordered.
 *
 * `null` un-anchors. Passing no anchor at all falls back to the button that
 * opens the panel, which is what somebody means nine times in ten and saves
 * them naming a thing they already named.
 */
export function setAnchor(
  doc: Cre8Document,
  panelId: NodeId,
  anchorNodeId?: NodeId | null
): NodeId | null {
  const previous = anchorOf(doc, panelId);
  if (previous) {
    const node = doc.nodes[previous];
    if (node?.refs) {
      delete node.refs.anchorFor;
      if (!Object.keys(node.refs).length) delete node.refs;
    }
  }

  const wanted = anchorNodeId === undefined ? invokerOf(doc, panelId) : anchorNodeId;
  if (!wanted) return null;
  const node = doc.nodes[wanted];
  if (!node || !doc.nodes[panelId]) return null;
  node.refs = { ...node.refs, anchorFor: { node: panelId } };
  return wanted;
}

export function moveNodes(
  doc: Cre8Document,
  ids: NodeId[],
  parentId: NodeId,
  index: number
): void {
  const roots = topMostNodes(doc.nodes, ids).filter(
    (id) => canReparent(doc.nodes, id, parentId) && !isAncestorOf(doc.nodes, id, parentId)
  );
  if (!roots.length) return;

  const parent = doc.nodes[parentId];
  if (!parent) return;

  // Removing earlier siblings shifts the target index left; account for that
  // before any detach happens so the drop lands where the indicator was drawn.
  let target = clamp(index, 0, parent.children.length);
  for (const id of roots) {
    const current = parent.children.indexOf(id);
    if (current >= 0 && current < target) target--;
  }

  for (const id of roots) {
    attachChild(doc.nodes, parentId, id, target);
    target++;
  }
}

export function duplicateNodes(doc: Cre8Document, ids: NodeId[]): NodeId[] {
  const roots = topMostNodes(doc.nodes, ids);
  const created: NodeId[] = [];

  for (const id of roots) {
    const node = doc.nodes[id];
    if (!node?.parentId) continue;
    const parent = doc.nodes[node.parentId];
    if (!parent) continue;

    const subtree: NodeMap = {};
    const cloneId = cloneSubtree(doc.nodes, id, subtree, node.parentId);
    if (!cloneId) continue;
    const clone = subtree[cloneId]!;
    clone.name = uniqueName(doc.nodes, node.name);

    const index = parent.children.indexOf(id);
    insertSubtree(doc, subtree, cloneId, node.parentId, index + 1);
    created.push(cloneId);
  }
  return created;
}

/**
 * Wrap a contiguous selection in a new element, preserving order and position.
 *
 * `type` is not decoration. Wrapping in a `link` is how a whole card becomes
 * clickable, and it produces the markup that should have been there — one
 * anchor around the content, with the browser's own focus and keyboard
 * behaviour — rather than a click handler on a `div`.
 */
export function groupNodes(doc: Cre8Document, ids: NodeId[], type: ElementType = 'frame'): NodeId | null {
  const roots = topMostNodes(doc.nodes, ids);
  if (!roots.length) return null;

  const first = doc.nodes[roots[0]!];
  const parentId = first?.parentId;
  if (!parentId) return null;
  const parent = doc.nodes[parentId];
  if (!parent) return null;
  if (!roots.every((id) => doc.nodes[id]?.parentId === parentId)) return null;

  const ordered = [...roots].sort(
    (a, b) => parent.children.indexOf(a) - parent.children.indexOf(b)
  );
  const insertAt = parent.children.indexOf(ordered[0]!);

  const group = createNode(type, {
    // Named for what it is. "Group 3" is right for a frame and useless in a
    // layer tree where the thing is a link.
    name: uniqueName(doc.nodes, type === 'frame' ? 'Group' : getElement(type).defaultName),
    styles: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      paddingTop: '0px',
      paddingRight: '0px',
      paddingBottom: '0px',
      paddingLeft: '0px',
      width: 'auto',
    },
  });
  doc.nodes[group.id] = group;
  attachChild(doc.nodes, parentId, group.id, insertAt);
  for (const id of ordered) attachChild(doc.nodes, group.id, id);
  return group.id;
}

export function ungroupNodes(doc: Cre8Document, ids: NodeId[]): NodeId[] {
  const released: NodeId[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node?.parentId || !node.children.length) continue;
    const parentId = node.parentId;
    const parent = doc.nodes[parentId];
    if (!parent) continue;

    let at = parent.children.indexOf(id) + 1;
    for (const childId of [...node.children]) {
      attachChild(doc.nodes, parentId, childId, at++);
      released.push(childId);
    }
    detachChild(doc.nodes, id);
    delete doc.nodes[id];
  }
  return released;
}

export function renameNode(doc: Cre8Document, id: NodeId, name: string): void {
  const node = doc.nodes[id];
  if (node) node.name = name.trim() || getElement(node.type).defaultName;
}

export function setNodeMeta(doc: Cre8Document, ids: NodeId[], patch: Partial<SceneNode['meta']>): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (node) Object.assign(node.meta, patch);
  }
}

/* --------------------------------------------------------------------------
 * Props & styles
 * ----------------------------------------------------------------------- */

export function setProps(doc: Cre8Document, ids: NodeId[], patch: NodeProps): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete node.props[key];
      else node.props[key] = value;
    }
  }
}

/**
 * Write style values at a breakpoint. `undefined` removes the declaration,
 * which is how "reset to inherited" works on tablet/mobile.
 */
export function setStyles(
  doc: Cre8Document,
  ids: NodeId[],
  breakpoint: Breakpoint,
  patch: StyleDecl
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    const layer = (node.styles[breakpoint] ??= {});
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') delete layer[key as StyleProp];
      else layer[key as StyleProp] = value as never;
    }
    if (breakpoint !== 'desktop' && Object.keys(layer).length === 0) delete node.styles[breakpoint];
  }
}

export function clearStyles(
  doc: Cre8Document,
  ids: NodeId[],
  breakpoint: Breakpoint,
  props: StyleProp[]
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    const layer = node?.styles[breakpoint];
    if (!layer) continue;
    for (const prop of props) delete layer[prop];
    if (breakpoint !== 'desktop' && Object.keys(layer).length === 0) delete node!.styles[breakpoint];
  }
}

/**
 * Write declarations into one of a node's rules.
 *
 * The rule has to exist — the inspector creates it when the designer adds a
 * condition, and this only ever fills it in. Emptying a rule of declarations
 * leaves it in the list rather than deleting it: the condition is still
 * something the designer wrote, and having it vanish because the last
 * declaration was cleared would be a surprise.
 */
export function setRuleStyles(
  doc: Cre8Document,
  ids: NodeId[],
  ruleId: string,
  patch: StyleDecl
): void {
  for (const id of ids) {
    const rule = doc.nodes[id]?.rules?.find((r) => r.id === ruleId);
    if (!rule) continue;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') delete rule.apply[key as StyleProp];
      else rule.apply[key as StyleProp] = value as never;
    }
  }
}

/**
 * Write prop overrides into one of a node's rules.
 *
 * The mirror of `setRuleStyles`, and separate from it for the same reason the
 * model keeps `set` separate from `apply`: styles compile to CSS and content
 * compiles to extra elements, so they cost different things and the panel says
 * so. Clearing the last override removes `set` rather than leaving an empty
 * object, because an empty one would still make the node expand.
 */
export function setRuleProps(
  doc: Cre8Document,
  ids: NodeId[],
  ruleId: string,
  patch: NodeProps
): void {
  for (const id of ids) {
    const rule = doc.nodes[id]?.rules?.find((r) => r.id === ruleId);
    if (!rule) continue;
    const set = (rule.set ??= {});
    for (const [prop, value] of Object.entries(patch)) {
      if (value === undefined || value === '') delete set[prop];
      else set[prop] = value;
    }
    if (Object.keys(set).length === 0) delete rule.set;
  }
}

/* --------------------------------------------------------------------------
 * Assignments that also style
 * ----------------------------------------------------------------------- */

/**
 * What an assignment does beyond naming a state.
 *
 * Phase C of the expression model, and the thing to notice is how little of it
 * is new. `WHEN price > 500000 → hide` is a Test resolving to a state and an
 * ordinary rule conditioned on that state — which is what a designer would
 * have built by hand in two panels. This writes both in one step and in one
 * transaction, so it is a *preset over the same assignment*, not a second
 * mechanism. Nothing downstream can tell the difference, and a check asserts
 * exactly that.
 */
export type AssignEffect =
  /** Only the state. The designer styles it themselves. */
  | { kind: 'state' }
  | { kind: 'hide' }
  | { kind: 'show' }
  | { kind: 'style'; prop: StyleProp; value: string };

/**
 * The rule an effect becomes, or null when the effect is "just a state".
 *
 * `show` is `display: revert` rather than a guessed value. A node hidden by
 * something else — a `meta.hidden`, an earlier rule — has some display the
 * cascade would have given it, and inventing `block` for a flex container is
 * how a row of cards comes back stacked.
 */
function styleForEffect(effect: AssignEffect): StyleDecl | null {
  switch (effect.kind) {
    case 'hide':
      return { display: 'none' };
    case 'show':
      return { display: 'revert' };
    case 'style':
      return { [effect.prop]: effect.value } as StyleDecl;
    default:
      return null;
  }
}

/**
 * Which rule belongs to an assignment: the one whose only condition is it.
 *
 * Found by shape rather than by a stored id, so a rule the designer edits into
 * something else stops being owned by the assignment — which is the right
 * answer. The moment they add a second condition or point it at another state,
 * it is their rule, and this stops rewriting it under them.
 */
function ruleForAssignment(node: SceneNode, key: string, value: string): StyleRule | undefined {
  return node.rules?.find(
    (rule) =>
      rule.when.length === 1 &&
      rule.when[0]?.kind === 'state' &&
      rule.when[0].key === key &&
      rule.when[0].op === 'is' &&
      rule.when[0].values.length === 1 &&
      rule.when[0].values[0] === value &&
      !rule.part &&
      !rule.breakpoint
  );
}

/**
 * Give one assignment an effect, replacing whatever it had.
 *
 * Rewrites in place when there is already a rule for this state, so changing
 * Hide to Fade is one rule that changed rather than two that fight. Removing
 * the effect removes the rule, because a rule with no declarations left would
 * still be a row in the panel saying nothing.
 */
export function setAssignEffect(
  doc: Cre8Document,
  id: NodeId,
  assignId: string,
  effect: AssignEffect
): void {
  const node = doc.nodes[id];
  const assignment = node?.assign?.find((rule) => rule.id === assignId);
  if (!node || !assignment) return;

  const key = slug(node.props.switchKey);
  const value = slug(assignment.value);
  if (!key || !value) return;

  const existing = ruleForAssignment(node, key, value);
  const apply = styleForEffect(effect);

  if (!apply) {
    if (existing) removeRule(doc, id, existing.id);
    return;
  }
  if (existing) {
    existing.apply = apply;
    return;
  }
  addRule(doc, id, {
    id: uid(),
    when: [{ kind: 'state', key, op: 'is', values: [value] }],
    apply,
  });
}

/**
 * Rename the state an assignment produces, taking its rule with it.
 *
 * Renaming without this leaves a rule answering to a value nothing sets any
 * more — the styling silently stops, and the panel still shows a rule that
 * looks right.
 */
export function setAssignValue(
  doc: Cre8Document,
  id: NodeId,
  assignId: string,
  value: string
): void {
  const node = doc.nodes[id];
  const assignment = node?.assign?.find((rule) => rule.id === assignId);
  if (!node || !assignment) return;

  const key = slug(node.props.switchKey);
  const owned = ruleForAssignment(node, key, slug(assignment.value));
  assignment.value = slug(value);
  const next = slug(assignment.value);
  if (!owned) return;
  if (!next) removeRule(doc, id, owned.id);
  else owned.when = [{ kind: 'state', key, op: 'is', values: [next] }];
}

/**
 * Rename the state key this node carries, and every rule of its own that names it.
 *
 * Only this node's rules. A descendant styling the state almost always
 * conditions on the *nearest* one — an empty key — which a rename cannot
 * break. One that names the key explicitly is reaching past its own group on
 * purpose, and rewriting somebody else's rule from here would be a worse
 * surprise than the one this avoids.
 */
export function setStateKey(doc: Cre8Document, id: NodeId, key: string): void {
  const node = doc.nodes[id];
  if (!node) return;
  const before = slug(node.props.switchKey);
  const after = slug(key) || 'state';
  if (before === after) return;
  node.props.switchKey = after;
  for (const rule of node.rules ?? []) {
    for (const condition of rule.when) {
      if (condition.kind === 'state' && condition.key === before) condition.key = after;
    }
  }
}

/** What an assignment currently does, read back off the rule it wrote. */
export function assignEffect(node: SceneNode, assignId: string): AssignEffect {
  const assignment = node.assign?.find((rule) => rule.id === assignId);
  const key = slug(node.props.switchKey);
  const value = slug(assignment?.value);
  if (!assignment || !key || !value) return { kind: 'state' };

  const rule = ruleForAssignment(node, key, value);
  const entries = Object.entries(rule?.apply ?? {});
  if (entries.length !== 1) return { kind: 'state' };
  const [prop, applied] = entries[0] as [StyleProp, string];
  if (prop === 'display' && applied === 'none') return { kind: 'hide' };
  if (prop === 'display' && applied === 'revert') return { kind: 'show' };
  return { kind: 'style', prop, value: applied };
}

/**
 * Remove an assignment, and the rule it wrote with it.
 *
 * The rule goes because the state it answers to is about to stop existing —
 * leaving it behind would be a rule that can never match, which is worse than
 * useless in a panel that lists them.
 */
export function removeAssign(doc: Cre8Document, id: NodeId, assignId: string): void {
  const node = doc.nodes[id];
  if (!node?.assign) return;
  const going = node.assign.find((rule) => rule.id === assignId);
  if (going) {
    const owned = ruleForAssignment(node, slug(node.props.switchKey), slug(going.value));
    if (owned) removeRule(doc, id, owned.id);
  }
  node.assign = node.assign.filter((rule) => rule.id !== assignId);
  if (!node.assign.length) delete node.assign;
}

export function addRule(doc: Cre8Document, id: NodeId, rule: StyleRule): string | null {
  const node = doc.nodes[id];
  if (!node) return null;
  (node.rules ??= []).push(rule);
  return rule.id;
}

export function removeRule(doc: Cre8Document, id: NodeId, ruleId: string): void {
  const node = doc.nodes[id];
  if (!node?.rules) return;
  node.rules = node.rules.filter((rule) => rule.id !== ruleId);
  if (node.rules.length === 0) delete node.rules;
}

/** Order is precedence, so moving a rule is a real edit rather than a view. */
export function moveRule(doc: Cre8Document, id: NodeId, ruleId: string, delta: number): void {
  const rules = doc.nodes[id]?.rules;
  if (!rules) return;
  const from = rules.findIndex((rule) => rule.id === ruleId);
  if (from < 0) return;
  const to = clamp(from + delta, 0, rules.length - 1);
  if (to === from) return;
  const [moved] = rules.splice(from, 1);
  rules.splice(to, 0, moved!);
}

export function updateRule(
  doc: Cre8Document,
  id: NodeId,
  ruleId: string,
  patch: Partial<Pick<StyleRule, 'when' | 'part' | 'breakpoint'>>
): void {
  const rule = doc.nodes[id]?.rules?.find((r) => r.id === ruleId);
  if (rule) Object.assign(rule, patch);
}

/** Copy the full style stack from one node onto others. */
export function pasteStyles(doc: Cre8Document, sourceId: NodeId, targetIds: NodeId[]): void {
  const source = doc.nodes[sourceId];
  if (!source) return;
  for (const id of targetIds) {
    const node = doc.nodes[id];
    if (!node || node.id === sourceId) continue;
    node.styles = structuredCloneCompat(source.styles);
    if (source.rules) node.rules = structuredCloneCompat(source.rules);
  }
}

/* --------------------------------------------------------------------------
 * Pages
 * ----------------------------------------------------------------------- */

export function addPage(doc: Cre8Document, name: string): Page {
  const root = createNode('page', { name });
  doc.nodes[root.id] = root;

  const page: Page = {
    id: uid(),
    name,
    slug: uniqueSlug(doc, slugify(name) || 'page'),
    rootNodeId: root.id,
    order: doc.pages.length,
    meta: {},
  };
  doc.pages.push(page);
  return page;
}

export function duplicatePage(doc: Cre8Document, pageId: string): Page | null {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return null;

  const subtree: NodeMap = {};
  const rootId = cloneSubtree(doc.nodes, page.rootNodeId, subtree, null);
  if (!rootId) return null;
  for (const [id, node] of Object.entries(subtree)) doc.nodes[id] = node;

  const name = `${page.name} copy`;
  const copy: Page = {
    ...structuredCloneCompat(page),
    id: uid(),
    name,
    slug: uniqueSlug(doc, slugify(name)),
    rootNodeId: rootId,
    order: doc.pages.length,
    isHome: false,
  };
  doc.pages.push(copy);
  return copy;
}

export function removePage(doc: Cre8Document, pageId: string): void {
  if (doc.pages.length <= 1) return;
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index < 0) return;
  const [page] = doc.pages.splice(index, 1);
  if (!page) return;

  for (const id of collectSubtree(doc.nodes, page.rootNodeId)) delete doc.nodes[id];
  doc.pages.forEach((p, i) => (p.order = i));
  if (page.isHome && doc.pages[0]) doc.pages[0].isHome = true;
}

export function updatePage(doc: Cre8Document, pageId: string, patch: Partial<Page>): void {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return;
  if (patch.slug !== undefined) {
    const next = page.isHome ? '' : slugify(patch.slug);
    patch = { ...patch, slug: next === page.slug ? next : uniqueSlug(doc, next || 'page', pageId) };
  }
  Object.assign(page, patch);
  if (patch.name) {
    const root = doc.nodes[page.rootNodeId];
    if (root) root.name = patch.name;
  }
}

export function reorderPages(doc: Cre8Document, fromIndex: number, toIndex: number): void {
  const ordered = [...doc.pages].sort((a, b) => a.order - b.order);
  const [moved] = ordered.splice(fromIndex, 1);
  if (!moved) return;
  ordered.splice(clamp(toIndex, 0, ordered.length), 0, moved);
  ordered.forEach((p, i) => (p.order = i));
}

export function setHomePage(doc: Cre8Document, pageId: string): void {
  for (const page of doc.pages) {
    const isHome = page.id === pageId;
    page.isHome = isHome;
    if (isHome) page.slug = '';
    else if (page.slug === '') page.slug = uniqueSlug(doc, slugify(page.name) || 'page', page.id);
  }
}

function uniqueSlug(doc: Cre8Document, base: string, ignoreId?: string): string {
  const taken = new Set(doc.pages.filter((p) => p.id !== ignoreId).map((p) => p.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* --------------------------------------------------------------------------
 * Components
 * ----------------------------------------------------------------------- */

/**
 * Promote a subtree to a component and replace it in place with an instance.
 *
 * The master lives in `doc.nodes` (unparented), so editing it updates every
 * instance — which is the whole point of having components rather than copies.
 */
export function createComponentFromNode(
  doc: Cre8Document,
  nodeId: NodeId,
  name?: string
): { component: ComponentDefinition; instanceId: NodeId } | null {
  const node = doc.nodes[nodeId];
  if (!node?.parentId) return null;
  const parent = doc.nodes[node.parentId];
  if (!parent) return null;
  if (doc.components.some((c) => c.rootNodeId === nodeId)) return null;

  const master: NodeMap = {};
  const masterRootId = cloneSubtree(doc.nodes, nodeId, master, null);
  if (!masterRootId) return null;

  const component: ComponentDefinition = {
    id: uid(),
    name: name?.trim() || node.name,
    rootNodeId: masterRootId,
    createdAt: Date.now(),
  };

  for (const [id, n] of Object.entries(master)) {
    n.meta.componentId = component.id;
    doc.nodes[id] = n;
  }
  doc.components.push(component);

  const index = parent.children.indexOf(nodeId);
  removeNodes(doc, [nodeId]);
  const instanceId = insertInstance(doc, component.id, parent.id, index);
  if (!instanceId) return null;
  return { component, instanceId };
}

/**
 * A second component with the same design, and no thread back to the first.
 *
 * The one operation in the component set that could not be assembled out of
 * the others, which is why the menu has been missing it: a component is not a
 * subtree, it is a *master tree, plus a tree per variant, plus properties that
 * name nodes inside all of them*. Cloning the master and stopping leaves a
 * component whose variants are shared with the original — edit the copy's
 * secondary button and the original's changes with it, which is the exact
 * confusion a duplicate exists to avoid.
 *
 * So every tree is cloned through **one** id map. That is the load-bearing
 * detail: `properties.nodeIds` names a node in each tree it reaches, and a map
 * per tree could only remap the one it was built for — the property would
 * follow the copy's master and the original's variants at the same time.
 */
export function duplicateComponent(
  doc: Cre8Document,
  componentId: string,
  name?: string
): ComponentDefinition | null {
  const source = doc.components.find((c) => c.id === componentId);
  if (!source || !doc.nodes[source.rootNodeId]) return null;

  const subtree: NodeMap = {};
  const remap = new Map<NodeId, NodeId>();
  const rootNodeId = cloneSubtree(doc.nodes, source.rootNodeId, subtree, null, remap);
  if (!rootNodeId) return null;

  const variants: ComponentVariant[] = [];
  for (const variant of source.variants ?? []) {
    if (!doc.nodes[variant.rootNodeId]) continue;
    const cloned = cloneSubtree(doc.nodes, variant.rootNodeId, subtree, null, remap);
    if (cloned) variants.push({ id: uid(), name: variant.name, rootNodeId: cloned });
  }

  const copy: ComponentDefinition = {
    id: uid(),
    name: uniqueComponentName(doc, name?.trim() || source.name),
    rootNodeId,
    createdAt: Date.now(),
    ...(source.category ? { category: source.category } : {}),
    ...(variants.length ? { variants } : {}),
  };

  /*
   * Properties keep their names and their defaults and get new ids, because a
   * property id is what an instance's overrides are keyed by — sharing them
   * would make an override written against the original apply to the copy.
   * A `nodeId` with no counterpart is dropped rather than carried across: it
   * would point into the original's tree, and a property that reaches into
   * another component is not a property, it is a bug with a name.
   */
  const properties = (source.properties ?? [])
    .map((property) => ({
      ...structuredCloneCompat(property),
      id: uid(),
      nodeIds: property.nodeIds
        .map((id) => remap.get(id))
        .filter((id): id is NodeId => Boolean(id)),
    }))
    .filter((property) => property.nodeIds.length > 0);
  if (properties.length) copy.properties = properties;

  for (const [id, node] of Object.entries(subtree)) {
    node.meta.componentId = copy.id;
    doc.nodes[id] = node;
  }
  // The trees are named after the component, and the copy is not that
  // component any more. Left alone they would all read "Card" in the layer
  // tree, which is where somebody goes to work out which one they are editing.
  const newRoot = doc.nodes[rootNodeId];
  if (newRoot) newRoot.name = copy.name;
  for (const variant of variants) {
    const root = doc.nodes[variant.rootNodeId];
    if (root) root.name = `${copy.name} — ${variant.name}`;
  }

  doc.components.push(copy);
  return copy;
}

function uniqueComponentName(doc: Cre8Document, wanted: string): string {
  const taken = new Set(doc.components.map((c) => c.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

export function insertInstance(
  doc: Cre8Document,
  componentId: string,
  parentId: NodeId,
  index?: number
): NodeId | null {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component) return null;

  const node = createNode('instance', {
    name: component.name,
    props: { componentId },
  });
  doc.nodes[node.id] = node;
  attachChild(doc.nodes, parentId, node.id, index);
  return node.id;
}

/** Turn an instance back into ordinary, directly editable nodes. */
export function detachInstance(doc: Cre8Document, instanceId: NodeId): NodeId | null {
  const instance = doc.nodes[instanceId];
  if (!instance || instance.type !== 'instance' || !instance.parentId) return null;
  const component = doc.components.find((c) => c.id === instance.props.componentId);
  if (!component) return null;
  const parent = doc.nodes[instance.parentId];
  if (!parent) return null;

  // The tree this instance was actually wearing, not the default one.
  const subtree: NodeMap = {};
  const remap = new Map<NodeId, NodeId>();
  const from = rootForInstance(component, instance);
  if (!from) return null;
  const rootId = cloneSubtree(doc.nodes, from, subtree, instance.parentId, remap);
  if (!rootId) return null;
  for (const n of Object.values(subtree)) delete n.meta.componentId;
  // What this instance was saying becomes what these nodes say. Without it,
  // detaching quietly throws away every word the instance had customised.
  bakeOverrides(subtree, remap, scopeForInstance(component, instance));

  const index = parent.children.indexOf(instanceId);
  detachChild(doc.nodes, instanceId);
  delete doc.nodes[instanceId];
  insertSubtree(doc, subtree, rootId, parent.id, index);
  return rootId;
}

/* --- Properties --------------------------------------------------------- */

/**
 * Open a hole in a master: this prop of this node is the instance's to fill.
 *
 * Refuses a second property on the same target, because two names for one prop
 * is a fight over which of them wins that has no good answer.
 *
 * The default is read off the master *now*, which is what an instance shows
 * until somebody changes it and what "Reset" puts back. Editing the master
 * afterwards moves every unmodified instance with it — the stored default is
 * only consulted by the inspector, never by a renderer, so the master stays the
 * single source of what an unmodified instance says.
 */
export function exposeProperty(
  doc: Cre8Document,
  componentId: string,
  nodeId: NodeId,
  target: ExposableTarget,
  name?: string
): ComponentProperty | null {
  const component = doc.components.find((c) => c.id === componentId);
  const node = doc.nodes[nodeId];
  if (!component || !node) return null;
  if (node.meta.componentId !== componentId) return null;
  if (!exposableTargets(node).some((t) => targetKey(t) === targetKey(target))) return null;

  const properties = (component.properties ??= []);
  if (properties.some((p) => p.nodeIds.includes(nodeId) && targetKey(p) === targetKey(target))) {
    return null;
  }

  const property: ComponentProperty = {
    id: uid(),
    name: name?.trim() || uniquePropertyName(properties, `${node.name} ${target.label.toLowerCase()}`),
    type: target.type,
    // The one node it starts on. A property exposed while a component already
    // has variants reaches only the tree it was exposed from — the trees have
    // diverged by then and there is no honest way to guess which node in the
    // other one it meant. Exposing it before adding a variant, or exposing it
    // again inside the variant, both work; guessing does not.
    nodeIds: [nodeId],
    ...(target.prop ? { prop: target.prop } : {}),
    defaultValue: target.type === 'visible' ? !node.meta.hidden : (node.props[target.prop!] ?? ''),
  };
  properties.push(property);
  return property;
}

function uniquePropertyName(properties: ComponentProperty[], wanted: string): string {
  const taken = new Set(properties.map((p) => p.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

/** Close the hole, and forget what every instance had put in it. */
export function removeComponentProperty(
  doc: Cre8Document,
  componentId: string,
  propertyId: string
): void {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component?.properties) return;
  component.properties = component.properties.filter((p) => p.id !== propertyId);

  // The values would be ignored either way — nothing names them any more — but
  // leaving them behind grows the document for ever, and re-exposing the same
  // prop mints a new id, so there is nothing they could ever be reunited with.
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'instance' || !node.overrides) continue;
    if (!(propertyId in node.overrides)) continue;
    delete node.overrides[propertyId];
    if (!Object.keys(node.overrides).length) delete node.overrides;
  }
}

export function renameComponentProperty(
  doc: Cre8Document,
  componentId: string,
  propertyId: string,
  name: string
): void {
  const property = doc.components
    .find((c) => c.id === componentId)
    ?.properties?.find((p) => p.id === propertyId);
  if (property) property.name = name.trim() || property.name;
}

/**
 * Move a continuous value's starting number, and every slider that drives it.
 *
 * The number lives in two places because with no script running they are two
 * different elements that both have to be right: the group's custom property
 * puts the split somewhere, and the slider's `value` puts the handle there.
 * Resolving one from the other when rendering was tried and taken out — the
 * canvas gives the element model an empty document by design, so the lookup
 * worked in the published file and returned nothing on the canvas.
 *
 * So they are kept in step here, in one operation, and a static check asserts
 * they agree across the whole block library.
 */
export function setRangeValue(doc: Cre8Document, groupId: NodeId, value: number): void {
  const group = doc.nodes[groupId];
  const key = slug(group?.props.rangeKey);
  if (!group || !key) return;

  group.props.rangeValue = value;
  for (const id of collectSubtree(doc.nodes, groupId)) {
    const node = doc.nodes[id];
    if (node?.type === 'range' && slug(node.props.drives) === key) node.props.value = value;
  }
}

/** What one instance says. `undefined` puts it back to the master's value. */
export function setInstanceOverride(
  doc: Cre8Document,
  instanceId: NodeId,
  propertyId: string,
  value: string | number | boolean | null | undefined
): void {
  const instance = doc.nodes[instanceId];
  if (!instance || instance.type !== 'instance') return;

  if (value === undefined) {
    if (!instance.overrides) return;
    delete instance.overrides[propertyId];
    if (!Object.keys(instance.overrides).length) delete instance.overrides;
    return;
  }
  (instance.overrides ??= {})[propertyId] = value;
}

/**
 * Drop properties whose node is no longer in the master.
 *
 * Deleting a node out of a component leaves anything pointing at it with
 * nothing to fill, and a control that writes into a hole that is not there
 * would be a silent no-op. Called after every removal rather than only the
 * ones inside a master, because "was that node part of a component?" is a
 * question with more wrong answers than this costs to skip.
 */
function pruneComponentProperties(doc: Cre8Document): void {
  for (const component of doc.components) {
    if (!component.properties?.length) continue;
    const living = livingProperties(component, doc.nodes);
    // Only written when it changed: an unconditional assignment would hand
    // immer a new array on every delete anywhere in the document.
    if (living.length !== component.properties.length) component.properties = living;
  }
}

/* --- Variants ------------------------------------------------------------ */

/**
 * A second look for the same component: a whole new tree, cloned from one that
 * exists.
 *
 * Cloned rather than started empty, and that is the design rather than a
 * convenience. "Secondary button" is "primary button, three declarations
 * different" — starting from nothing means rebuilding it and getting the
 * padding subtly wrong. Cloning also gives the one thing that makes properties
 * survive the jump: `cloneSubtree`'s remap says which node in the new tree
 * corresponds to which in the old, so every property picks up its counterpart
 * and an instance switching variant keeps its words.
 */
export function addVariant(
  doc: Cre8Document,
  componentId: string,
  name?: string,
  fromVariantId?: string
): ComponentVariant | null {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component) return null;

  const sourceRoot =
    component.variants?.find((v) => v.id === fromVariantId)?.rootNodeId ?? component.rootNodeId;
  if (!doc.nodes[sourceRoot]) return null;

  const subtree: NodeMap = {};
  const remap = new Map<NodeId, NodeId>();
  const rootId = cloneSubtree(doc.nodes, sourceRoot, subtree, null, remap);
  if (!rootId) return null;

  const variants = (component.variants ??= []);
  const variant: ComponentVariant = {
    id: uid(),
    name: uniqueVariantName(component, name?.trim() || `Variant ${variants.length + 2}`),
    rootNodeId: rootId,
  };

  for (const [id, node] of Object.entries(subtree)) {
    node.meta.componentId = componentId;
    doc.nodes[id] = node;
  }
  const newRoot = doc.nodes[rootId];
  if (newRoot) newRoot.name = `${component.name} — ${variant.name}`;
  variants.push(variant);

  // Every property gains the counterpart of whatever it was already pointing
  // at. A property with nothing in the source tree — one exposed inside a
  // different variant — is left alone rather than guessed at.
  for (const property of component.properties ?? []) {
    const added = property.nodeIds.map((id) => remap.get(id)).filter((id): id is NodeId => Boolean(id));
    property.nodeIds.push(...added.filter((id) => !property.nodeIds.includes(id)));
  }

  return variant;
}

function uniqueVariantName(component: ComponentDefinition, wanted: string): string {
  const taken = new Set((component.variants ?? []).map((v) => v.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

export function renameVariant(
  doc: Cre8Document,
  componentId: string,
  variantId: string,
  name: string
): void {
  const component = doc.components.find((c) => c.id === componentId);
  const variant = component?.variants?.find((v) => v.id === variantId);
  if (!component || !variant) return;
  variant.name = name.trim() || variant.name;
  const root = doc.nodes[variant.rootNodeId];
  if (root) root.name = `${component.name} — ${variant.name}`;
}

/**
 * Remove a variant, and put every instance that was using it back on the
 * default.
 *
 * The instances are moved explicitly rather than left to fall back. They would
 * render correctly either way — `rootForInstance` returns the default for a
 * variant that no longer exists — but a document carrying a `variantId`
 * nothing answers to is a document where the inspector shows a select with no
 * matching option, and where undo has nothing to restore the choice from.
 */
export function removeVariant(doc: Cre8Document, componentId: string, variantId: string): void {
  const component = doc.components.find((c) => c.id === componentId);
  const variant = component?.variants?.find((v) => v.id === variantId);
  if (!component || !variant) return;

  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'instance' && node.props.variantId === variantId) delete node.props.variantId;
  }

  for (const id of collectSubtree(doc.nodes, variant.rootNodeId)) delete doc.nodes[id];
  component.variants = (component.variants ?? []).filter((v) => v.id !== variantId);
  if (!component.variants.length) delete component.variants;
  pruneComponentProperties(doc);
}

/** Which look this instance wears. `undefined` is the default tree. */
export function setInstanceVariant(
  doc: Cre8Document,
  instanceId: NodeId,
  variantId: string | undefined
): void {
  const instance = doc.nodes[instanceId];
  if (!instance || instance.type !== 'instance') return;
  if (variantId) instance.props.variantId = variantId;
  else delete instance.props.variantId;
}

export function renameComponent(doc: Cre8Document, componentId: string, name: string): void {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component) return;
  component.name = name.trim() || component.name;
  const root = doc.nodes[component.rootNodeId];
  if (root) root.name = component.name;
}

/** Delete a component, detaching every instance so nothing silently vanishes. */
export function deleteComponent(doc: Cre8Document, componentId: string): void {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component) return;

  const instances = Object.values(doc.nodes).filter(
    (n) => n.type === 'instance' && n.props.componentId === componentId
  );
  for (const instance of instances) detachInstance(doc, instance.id);

  // Every tree, not just the default: a variant left behind would be a subtree
  // parented to nothing, invisible everywhere and carried in the document for
  // ever.
  for (const root of allRoots(component)) {
    for (const id of collectSubtree(doc.nodes, root)) delete doc.nodes[id];
  }
  doc.components = doc.components.filter((c) => c.id !== componentId);
}

/* --------------------------------------------------------------------------
 * Assets & theme
 * ----------------------------------------------------------------------- */

export function removeAsset(doc: Cre8Document, assetId: string): void {
  doc.assets = doc.assets.filter((a) => a.id !== assetId);
}

export function renameAsset(doc: Cre8Document, assetId: string, name: string): void {
  const asset = doc.assets.find((a) => a.id === assetId);
  if (asset) asset.name = name.trim() || asset.name;
}

export type ThemeScaleGroup = 'colors' | 'spacing' | 'radii' | 'shadows' | 'widths';

export function setToken(
  doc: Cre8Document,
  group: ThemeScaleGroup,
  id: string,
  patch: { name?: string; value?: string }
): void {
  const token = doc.theme[group].find((t) => t.id === id);
  if (!token) return;
  if (patch.name !== undefined) token.name = patch.name;
  if (patch.value !== undefined) token.value = patch.value;
}

export function addToken(
  doc: Cre8Document,
  group: ThemeScaleGroup,
  name: string,
  value: string
): string {
  const base = slugify(name) || 'token';
  let id = base;
  let n = 2;
  while (doc.theme[group].some((t) => t.id === id)) id = `${base}-${n++}`;
  doc.theme[group].push({ id, name, value });
  return id;
}

export function removeToken(doc: Cre8Document, group: ThemeScaleGroup, id: string): void {
  doc.theme[group] = doc.theme[group].filter((t) => t.id !== id);
}

export function setThemeFont(doc: Cre8Document, id: string, stack: string): void {
  const font = doc.theme.fonts.find((f) => f.id === id);
  if (font) font.stack = stack;
}

/* --------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "Section" → "Section 2" when the name is already taken. */
export function uniqueName(nodes: NodeMap, base: string): string {
  const stripped = base.replace(/\s\d+$/, '');
  const taken = new Set(Object.values(nodes).map((n) => n.name));
  if (!taken.has(stripped)) return stripped;
  let n = 2;
  while (taken.has(`${stripped} ${n}`)) n++;
  return `${stripped} ${n}`;
}

/**
 * Where a newly inserted element should go, given the current selection.
 *
 * `type` is optional so the caller can ask "where would anything go"; passed,
 * the walk skips ancestors that could not legally hold it. Without that, a
 * heading added while a table row is selected lands inside the row, renders
 * fine on the canvas, and is moved out of the table by the parser on the
 * published page.
 *
 * `null` means there is nowhere legal — a table row with no table anywhere
 * above the selection. Refusing beats parking it at the page root, where it
 * would look placed on the canvas and be discarded when the file is written.
 */
export function resolveInsertTarget(
  doc: Cre8Document,
  selectedId: NodeId | null,
  pageRootId: NodeId,
  type?: ElementType
): { parentId: NodeId; index: number } | null {
  const accepts = (parentType: ElementType): boolean =>
    type ? canContain(parentType, type) : getElement(parentType).container;

  const root = doc.nodes[pageRootId];
  const atRoot =
    root && accepts(root.type) ? { parentId: pageRootId, index: root.children.length } : null;

  let selected: SceneNode | undefined = getNode(doc.nodes, selectedId);
  if (!selected) return atRoot;

  // Dropping into a container puts the element inside it; otherwise it lands
  // directly after the selection, which is what people expect.
  if (accepts(selected.type)) {
    return { parentId: selected.id, index: selected.children.length };
  }

  // Climb until something can hold it, so inserting from the panel always
  // produces a legal tree rather than the nearest-looking one.
  let guard = 0;
  while (selected && guard++ < 200) {
    const parentId: NodeId | null = selected.parentId;
    const parent: SceneNode | undefined = parentId ? doc.nodes[parentId] : undefined;
    if (!parent || !parentId) break;
    if (accepts(parent.type)) {
      return { parentId, index: parent.children.indexOf(selected.id) + 1 };
    }
    selected = parent;
  }
  return atRoot;
}

/* --------------------------------------------------------------------------
 * Switches
 * ----------------------------------------------------------------------- */

/**
 * Bring whatever was just selected into view.
 *
 * A case that is not current is `display: none`, so it has no box: selecting
 * it from the layer tree used to put the selection outline around nothing,
 * and the eye in the tree looked broken because dimming something already
 * hidden changes nothing you can see. The tree was showing a node the canvas
 * refused to draw.
 *
 * So selection drives the switch. Two directions, and both read as the same
 * sentence — *show me that one*:
 *
 *   - selecting a tab shows the tab's panel;
 *   - selecting anything inside a case shows that case, at every level of
 *     nesting between it and the page.
 *
 * A group already showing the case is left alone, which matters for a filter:
 * clicking a card while the grid is filtered to Brand must not silently reset
 * it to Everything.
 */
export function revealSwitchPath(doc: Cre8Document, nodeId: NodeId): boolean {
  const node = doc.nodes[nodeId];
  if (!node) return false;
  let changed = false;

  const valueOf = (group: SceneNode): string =>
    slug(group.props.switchDesign) || slug(group.props.switchDefault);

  /** Which element owns the named state — itself first, then upwards. */
  const ownerOf = (from: SceneNode, name: string): SceneNode | undefined => {
    const own = slug(from.props.switchKey);
    if (own && (!name || own === name)) return from;
    let current: SceneNode | undefined = from.parentId ? doc.nodes[from.parentId] : undefined;
    let guard = 0;
    while (current && guard++ < 200) {
      const key = slug(current.props.switchKey);
      if (key && (!name || key === name)) return current;
      current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
    return undefined;
  };

  /** Put a state into some value that satisfies the condition, if it is not. */
  const satisfy = (from: SceneNode): void => {
    const when = readCase(from.rules);
    if (!when) return;
    const group = ownerOf(from, when.state);
    if (!group || group.props.switchDesign === SWITCH_SHOW_ALL) return;

    const current = valueOf(group);
    const matches = when.values.includes(current);
    if (when.negated ? !matches : matches) return;

    if (!when.negated) {
      group.props.switchDesign = when.values[0]!;
      changed = true;
      return;
    }
    // "Shown unless the state is X." Anything not in the list will do, and
    // what it ships as is the least surprising choice; if that is in the list
    // too there is nothing to fall back to and it is left alone.
    const fallback = slug(group.props.switchDefault);
    if (fallback && !when.values.includes(fallback)) {
      group.props.switchDesign = fallback;
      changed = true;
    }
  };

  // Selecting a tab is the most direct way of saying which panel to work on.
  const set = slug(node.props.switchSet);
  if (set) {
    const group = ownerOf(node, '');
    // A setter inside the group it drives, not the group itself.
    const target = group === node ? ownerOf(doc.nodes[node.parentId ?? ''] ?? node, '') : group;
    if (target && target.props.switchDesign !== SWITCH_SHOW_ALL && valueOf(target) !== set) {
      target.props.switchDesign = set;
      changed = true;
    }
  }

  // Then the node itself and everything between it and the page root, so a
  // panel three states deep is reachable in one click.
  let current: SceneNode | undefined = node;
  let guard = 0;
  while (current && guard++ < 200) {
    satisfy(current);
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }

  return changed;
}

/* --------------------------------------------------------------------------
 * Collections
 *
 * The *shape* of a collection, which is design and lives in the document. Its
 * records do not: they are content, they live in D1, and nothing here can
 * touch them — which is the point. An undo has to be unable to revert somebody
 * else's blog post.
 * ----------------------------------------------------------------------- */

/** Field types that can be safely read as one another, both ways. */
const INTERCHANGEABLE: Partial<Record<FieldType, FieldType[]>> = {
  text: ['richtext', 'select'],
  richtext: ['text'],
  select: ['text'],
  number: [],
  boolean: [],
  date: ['text'],
  image: ['text'],
  reference: ['text'],
};

/**
 * What retyping a field would cost, in a sentence, or null if it costs nothing.
 *
 * Nothing here converts anything: the values are in D1, there may be five
 * thousand of them, and rewriting them all on a keystroke in the inspector is
 * not a thing a design tool should do quietly. So the honest arrangement is
 * that the *shape* changes, the stored values do not, and the editor says
 * plainly which of them will stop making sense.
 */
export function retypeCost(from: FieldType, to: FieldType): string | null {
  if (from === to) return null;
  if (INTERCHANGEABLE[from]?.includes(to)) return null;
  return `Existing values were saved as ${from}. They stay as they are, and any that a ${to} field cannot read will show as empty.`;
}

export function addCollection(doc: Cre8Document, name: string): Collection | null {
  const collections = (doc.collections ??= []);
  if (collections.length >= LIMITS.collections) return null;

  const collection: Collection = {
    id: uid('c'),
    name,
    fields: [{ key: 'title', label: 'Title', type: 'text' }],
    slugField: 'title',
  };
  collections.push(collection);
  return collection;
}

export function updateCollection(
  doc: Cre8Document,
  collectionId: string,
  patch: Partial<Pick<Collection, 'name' | 'slugField'>>
): void {
  const collection = doc.collections?.find((c) => c.id === collectionId);
  if (collection) Object.assign(collection, patch);
}

/**
 * Forget the shape. The rows stay in D1, unreachable and unbilled-for.
 *
 * Deliberately not a cascade: deleting a collection in the editor is an undoable
 * design change, and a delete that reached across into content would be an
 * undoable design change that destroyed somebody's writing. Re-creating a
 * collection with the same id brings the records back, which is the behaviour
 * an undo needs.
 */
export function removeCollection(doc: Cre8Document, collectionId: string): void {
  if (!doc.collections) return;
  doc.collections = doc.collections.filter((c) => c.id !== collectionId);
  if (!doc.collections.length) delete doc.collections;

  // Anything pointing at it now points at nothing, and a repeater over a
  // collection that has gone renders nothing rather than erroring — but a
  // dangling reference in the document is a thing the layer tree cannot
  // explain, so it goes too.
  for (const node of Object.values(doc.nodes)) {
    if (node.repeat?.collection === collectionId) delete node.repeat;
  }
  for (const page of doc.pages) {
    if (page.dynamic?.collection === collectionId) delete page.dynamic;
  }
}

/** A key that is unique in its collection and safe in a binding. */
function uniqueKey(collection: Collection, wanted: string): string {
  const base = slugify(wanted).replace(/-/g, '_') || 'field';
  if (!collection.fields.some((f) => f.key === base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}_${i}`;
    if (!collection.fields.some((f) => f.key === candidate)) return candidate;
  }
  return `${base}_${uid()}`;
}

export function addField(
  doc: Cre8Document,
  collectionId: string,
  label: string,
  type: FieldType = 'text'
): Field | null {
  const collection = doc.collections?.find((c) => c.id === collectionId);
  if (!collection || collection.fields.length >= LIMITS.fieldsPerCollection) return null;

  const field: Field = { key: uniqueKey(collection, label), label, type };
  if (type === 'select') field.options = ['One', 'Two'];
  collection.fields.push(field);
  return field;
}

/**
 * Change a field, keeping its key stable across a rename.
 *
 * Bindings point at the key, so renaming "Title" to "Headline" must not empty
 * every heading on the site. The key is generated once from the first label
 * and never moves again.
 */
export function updateField(
  doc: Cre8Document,
  collectionId: string,
  key: string,
  patch: Partial<Omit<Field, 'key'>>
): void {
  const field = doc.collections
    ?.find((c) => c.id === collectionId)
    ?.fields.find((f) => f.key === key);
  if (!field) return;
  Object.assign(field, patch);
  if (field.type !== 'select') delete field.options;
  if (field.type !== 'reference') delete field.of;
}

export function removeField(doc: Cre8Document, collectionId: string, key: string): void {
  const collection = doc.collections?.find((c) => c.id === collectionId);
  if (!collection || collection.fields.length <= 1) return;
  collection.fields = collection.fields.filter((f) => f.key !== key);
  if (collection.slugField === key) delete collection.slugField;

  // A binding to a field that no longer exists falls back to the node's own
  // prop, which reads as "the placeholder came back" and is impossible to
  // diagnose. Clearing it here makes the loss visible in the inspector, where
  // the person who caused it is standing.
  for (const node of Object.values(doc.nodes)) {
    if (!node.bind) continue;
    for (const [prop, binding] of Object.entries(node.bind)) {
      if (binding.value.kind === 'field' && binding.value.key === key) delete node.bind[prop];
    }
    if (!Object.keys(node.bind).length) delete node.bind;
  }

  // And an assignment reading it, for the same reason. This one is worse to
  // lose quietly than a binding: a binding that stops resolving shows the
  // placeholder, which somebody notices, while a Test that stops resolving
  // just means the state never comes on.
  for (const node of Object.values(doc.nodes)) {
    if (!node.assign) continue;
    node.assign = node.assign.filter((rule) => !fieldsRead(rule.when).includes(key));
    if (!node.assign.length) delete node.assign;
  }
}

export function reorderFields(doc: Cre8Document, collectionId: string, from: number, to: number): void {
  const collection = doc.collections?.find((c) => c.id === collectionId);
  if (!collection) return;
  const fields = collection.fields;
  if (from < 0 || from >= fields.length || to < 0 || to >= fields.length) return;
  const [moved] = fields.splice(from, 1);
  if (moved) fields.splice(to, 0, moved);
}
