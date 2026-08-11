/**
 * Constructors for every document entity.
 *
 * Nothing else in the app builds a node literal by hand — going through here
 * guarantees schema defaults, ids and required fields are always present, which
 * is what lets templates, the insert panel, paste, duplication and (later) AI
 * all produce identical, valid documents.
 */

import { uid } from './id';
import { bindingFrom, migrateDocument, rulesFromLegacy } from './migrate';
import { getElement, splitFragment } from './schema';
import { createDefaultTheme } from './theme';
import {
  DOCUMENT_VERSION,
  type Asset,
  type Binding,
  type Cre8Document,
  type ElementType,
  type NodeId,
  type NodeProps,
  type Page,
  type RepeatSpec,
  type ResponsiveStyles,
  type SceneNode,
  type StateStyles,
  type StyleDecl,
  type StyleRule,
} from './types';
import type { NodeMap } from './tree';

export interface CreateNodeOptions {
  id?: NodeId;
  name?: string;
  props?: NodeProps;
  styles?: StyleDecl;
  responsive?: ResponsiveStyles;
  children?: NodeId[];
  parentId?: NodeId | null;
}

export function createNode(type: ElementType, options: CreateNodeOptions = {}): SceneNode {
  const def = getElement(type);
  return {
    id: options.id ?? uid(),
    type,
    name: options.name ?? def.defaultName,
    parentId: options.parentId ?? null,
    children: options.children ?? [],
    props: { ...def.defaultProps, ...options.props },
    styles: {
      ...options.responsive,
      desktop: { ...def.defaultStyles, ...options.styles, ...options.responsive?.desktop },
    },
    meta: {},
    ...(def.defaultStates
      ? { rules: rulesFromLegacy(structuredCloneCompat(def.defaultStates), {}) }
      : {}),
  };
}

/**
 * Declarative tree builder. Templates read far better as nested literals than
 * as a sequence of imperative inserts, and this keeps them a single expression
 * that can be serialised straight back out.
 */
export interface NodeSpec {
  type: ElementType;
  name?: string;
  props?: NodeProps;
  styles?: StyleDecl;
  responsive?: ResponsiveStyles;
  /** Authoring shorthand, folded into `rules` on the way in. */
  states?: StateStyles;
  rules?: StyleRule[];
  meta?: SceneNode['meta'];
  /** Render `children` once per record. */
  repeat?: RepeatSpec;
  /**
   * Read fields of the record in scope into props.
   *
   * A bare field name is the shorthand — `{ text: 'title' }` — and is folded
   * into a `Binding` on the way in by the same function the migration uses.
   */
  bind?: Record<string, string | Binding>;
  children?: NodeSpec[];
}

export function buildTree(
  spec: NodeSpec,
  into: NodeMap = {},
  parentId: NodeId | null = null
): { rootId: NodeId; nodes: NodeMap } {
  const rootId = buildSubtree(spec, into, parentId);
  // Only once the whole tree exists do the popovers have ids to point at.
  resolvePopoverRefs(into);
  return { rootId, nodes: into };
}

function buildSubtree(spec: NodeSpec, into: NodeMap, parentId: NodeId | null): NodeId {
  const node = createNode(spec.type, {
    name: spec.name,
    props: spec.props,
    styles: spec.styles,
    responsive: spec.responsive,
    parentId,
  });
  // `states` and `rules` are both accepted from a spec: the first is the
  // shorthand most blocks are written in, the second is what a block reaches
  // for when it needs a condition a state name cannot express.
  const fromStates = rulesFromLegacy(spec.states, node.props);
  if (fromStates.length || spec.rules?.length) {
    node.rules = [...(node.rules ?? []), ...fromStates, ...(spec.rules ?? [])];
  }
  if (spec.meta) node.meta = { ...node.meta, ...spec.meta };
  if (spec.repeat) node.repeat = structuredCloneCompat(spec.repeat);
  if (spec.bind) {
    node.bind = Object.fromEntries(
      Object.entries(spec.bind).map(([prop, entry]) => [prop, bindingFrom(entry)])
    );
  }

  into[node.id] = node;
  for (const childSpec of spec.children ?? []) {
    node.children.push(buildSubtree(childSpec, into, node.id));
  }
  return node.id;
}

/**
 * Point every deferred popover reference at the popover it names.
 *
 * A block describes its own wiring — "this button opens the Menu popover" —
 * but a spec has no ids, so the reference travels as a name until the nodes
 * exist. A name that matches nothing has the prop removed rather than left
 * dangling: a `popovertarget` pointing at no element makes the button do
 * nothing at all, which is worse than the button simply not being an invoker.
 */
const POPOVER_REF = 'popover@';

function resolvePopoverRefs(nodes: NodeMap): void {
  const byName = new Map<string, NodeId>();
  for (const node of Object.values(nodes)) {
    if (node.type === 'popover' || node.type === 'dialog') byName.set(node.name, node.id);
  }

  for (const node of Object.values(nodes)) {
    const target = node.props.popoverTarget;
    if (typeof target !== 'string' || !target.startsWith(POPOVER_REF)) continue;
    const id = byName.get(target.slice(POPOVER_REF.length));
    if (id) node.props.popoverTarget = id;
    else delete node.props.popoverTarget;
  }
}

/** Deep-copy a subtree with fresh ids. Returns the new root id. */
/**
 * @param remap Filled in with `original id → copy id`, for callers that have
 *   something to say about the copies. Detaching a component instance is the
 *   one that does: what the instance was overriding has to be written into the
 *   new nodes, and the only thing connecting the two is this map.
 */
export function cloneSubtree(
  source: NodeMap,
  rootId: NodeId,
  into: NodeMap,
  parentId: NodeId | null,
  remap: Map<NodeId, NodeId> = new Map()
): NodeId | null {
  const newRoot = copySubtree(source, rootId, into, parentId, remap);
  if (newRoot) rewireInternalRefs(into, remap);
  return newRoot;
}

function copySubtree(
  source: NodeMap,
  rootId: NodeId,
  into: NodeMap,
  parentId: NodeId | null,
  remap: Map<NodeId, NodeId>
): NodeId | null {
  const original = source[rootId];
  if (!original) return null;

  const copy: SceneNode = {
    ...structuredCloneCompat(original),
    id: uid(),
    parentId,
    children: [],
  };
  into[copy.id] = copy;
  remap.set(rootId, copy.id);

  for (const childId of original.children) {
    const childCopy = copySubtree(source, childId, into, copy.id, remap);
    if (childCopy) copy.children.push(childCopy);
  }
  return copy.id;
}

/**
 * Re-point props that name another node in the same copied subtree.
 *
 * Duplicate a header whose button opens its menu and, without this, both
 * copies open the *first* menu — the second one is unreachable and the bug
 * only shows up when someone clicks. A reference that leaves the subtree is
 * left pointing where it did, which is the right answer for copying a button
 * out of a nav that stays where it is.
 */
function rewireInternalRefs(nodes: NodeMap, remap: Map<NodeId, NodeId>): void {
  for (const id of remap.values()) {
    const node = nodes[id];
    const target = node?.props.popoverTarget;
    if (!node || typeof target !== 'string') continue;
    const moved = remap.get(target);
    if (moved) node.props.popoverTarget = moved;
  }
}

/** `structuredClone` isn't available on every runtime we target. */
function structuredCloneCompat<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* immer drafts and proxies can throw — fall through */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export { structuredCloneCompat };

/* --------------------------------------------------------------------------
 * Pages, assets, components
 * ----------------------------------------------------------------------- */

/**
 * A link target that names a page by slug instead of by id.
 *
 * The inspector writes `page:<id>`, which templates cannot: they describe a
 * whole site in one expression, so the pages they link to do not have ids yet.
 * This is the deferred form — `resolvePageRefs` turns it into a real reference
 * once the document is assembled.
 */
const PAGE_REF = 'page@';

export const pageRef = (slug: string): string => `${PAGE_REF}${slug}`;

/**
 * Turn every deferred page reference into a real one.
 *
 * A slug that matches no page becomes `#` rather than shipping a href nothing
 * can resolve — a template that names a page it does not have should produce an
 * inert link, not a broken one.
 *
 * Worth knowing when reading a template: that laundering means a mistyped
 * `pageRef` cannot be told apart afterwards from a link that was always going
 * nowhere. The check that catches it has to run against the *template*, which
 * is why the static suite builds all eight and looks for `#`.
 *
 * A fragment rides along untouched, so `pageRef('pricing') + '#faq'` reaches
 * the FAQ on the pricing page.
 */
export function resolvePageRefs(doc: Cre8Document): void {
  const bySlug = new Map(doc.pages.map((page) => [page.slug, page.id]));
  for (const node of Object.values(doc.nodes)) {
    const href = node.props.href;
    if (typeof href !== 'string' || !href.startsWith(PAGE_REF)) continue;
    const [target, fragment] = splitFragment(href);
    const id = bySlug.get(target.slice(PAGE_REF.length));
    node.props.href = id ? `page:${id}${fragment}` : '#';
  }
}

export function createPage(
  name: string,
  slug: string,
  nodes: NodeMap,
  order: number,
  isHome = false
): Page {
  const root = createNode('page', { name: name || 'Page' });
  nodes[root.id] = root;
  return {
    id: uid(),
    name,
    slug,
    rootNodeId: root.id,
    order,
    isHome,
    // Left empty on purpose so the published <title> falls back to the
    // page name and site name rather than freezing a copy of it here.
    meta: {},
  };
}

export function createAsset(input: Omit<Asset, 'id' | 'createdAt'>): Asset {
  return { ...input, id: uid(), createdAt: Date.now() };
}

/* --------------------------------------------------------------------------
 * Documents
 * ----------------------------------------------------------------------- */

export function createEmptyDocument(name = 'Untitled project'): Cre8Document {
  const nodes: NodeMap = {};
  const home = createPage('Home', '', nodes, 0, true);
  const now = Date.now();

  return {
    version: DOCUMENT_VERSION,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    pages: [home],
    nodes,
    assets: [],
    components: [],
    theme: createDefaultTheme(),
    settings: { siteName: name, language: 'en' },
  };
}

/**
 * Normalise anything loaded from storage or a template so the rest of the app
 * can rely on required fields existing. Cheap insurance against hand-edited
 * JSON and older documents.
 */
export function hydrateDocument(input: Partial<Cre8Document> & { nodes?: NodeMap }): Cre8Document {
  const base = createEmptyDocument(input.name ?? 'Untitled project');
  const doc: Cre8Document = {
    ...base,
    ...input,
    // Whatever version came in is kept until `migrateDocument` below has
    // earned the new one. Stamping it here — which this used to do — made the
    // field a decoration: every document claimed to be current the moment it
    // was read, whatever shape it was actually in.
    version: input.version ?? 1,
    theme: { ...base.theme, ...(input.theme ?? {}) },
    settings: { ...base.settings, ...(input.settings ?? {}) },
    nodes: input.nodes ?? base.nodes,
    pages: input.pages?.length ? input.pages : base.pages,
    assets: input.assets ?? [],
    components: input.components ?? [],
    // Absent on every document written before collections existed, and on
    // every document that never uses one — so it stays optional rather than
    // adding an empty array to a hundred stored projects.
    ...(input.collections?.length ? { collections: input.collections } : {}),
  };

  for (const node of Object.values(doc.nodes)) {
    node.children ??= [];
    node.props ??= {};
    node.styles ??= {};
    node.meta ??= {};
    if (node.parentId === undefined) node.parentId = null;
    /*
     * `rules` was the one field a corrupt document could carry through
     * hydration and into a thrown render.
     *
     * The four above have been normalised here since the beginning, so a node
     * arriving with `children: null` or `props: null` is repaired and draws.
     * A node arriving with `rules` as a string, or holding a null, was not —
     * `variantsOf` reaches straight for `rule.when` and the whole editor went
     * white. Found while proving the error boundary had something to catch.
     *
     * Repaired rather than refused: half a document on screen is worth more
     * than an explanation of why there is none, and every rule that survives
     * is one the renderer can read.
     */
    if (node.rules !== undefined) {
      const rules = Array.isArray(node.rules) ? node.rules : [];
      const usable = rules.filter(
        (rule): rule is (typeof rules)[number] =>
          Boolean(rule) && typeof rule === 'object' && Array.isArray(rule.when)
      );
      if (usable.length) node.rules = usable;
      else delete node.rules;
    }
    // Same reasoning one field along: `scopeForInstance` iterates it, and a
    // string or an array here would take the page down rather than lose a
    // customisation nobody could see any more anyway.
    if (node.overrides !== undefined) {
      const values = node.overrides;
      if (!values || typeof values !== 'object' || Array.isArray(values)) delete node.overrides;
    }
  }

  /*
   * A component whose properties are unreadable draws its master and nothing
   * else, which is exactly what it did before properties existed. Dropping the
   * list is therefore the safe repair — the instances keep their values, and
   * re-exposing the prop is one click.
   */
  for (const component of doc.components) {
    if (component.properties === undefined) continue;
    const usable = (Array.isArray(component.properties) ? component.properties : []).filter(
      (property) =>
        Boolean(property) &&
        typeof property === 'object' &&
        typeof property.id === 'string' &&
        Array.isArray(property.nodeIds) &&
        property.nodeIds.length > 0
    );
    if (usable.length) component.properties = usable;
    else delete component.properties;
  }

  // Re-derive parent links from children arrays; children are the source of
  // truth because that is what ordering depends on.
  for (const node of Object.values(doc.nodes)) {
    for (const childId of node.children) {
      const child = doc.nodes[childId];
      if (child) child.parentId = node.id;
    }
  }

  // Drop children that point at nodes which no longer exist.
  for (const node of Object.values(doc.nodes)) {
    node.children = node.children.filter((id) => Boolean(doc.nodes[id]));
  }

  if (!doc.pages.some((p) => p.isHome) && doc.pages[0]) doc.pages[0].isHome = true;
  doc.pages.forEach((page, index) => {
    page.order ??= index;
    page.meta ??= {};
  });

  // Last, because a migration is entitled to assume the fields above exist.
  // This is the only place a document is upgraded: everything that loads one —
  // the editor, the collaboration client, the API, the publisher — comes
  // through here, so there is one answer to "has this been migrated yet".
  return migrateDocument(doc);
}
