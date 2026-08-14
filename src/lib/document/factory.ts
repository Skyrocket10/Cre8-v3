/**
 * Constructors for every document entity.
 *
 * Nothing else in the app builds a node literal by hand — going through here
 * guarantees schema defaults, ids and required fields are always present, which
 * is what lets templates, the insert panel, paste, duplication and (later) AI
 * all produce identical, valid documents.
 */

import { uid } from './id';
import { everyAction, migratePress } from './actions';
import { asTest } from './when';
import { LEGACY_STATE_PROPS, declarationFrom } from './state';
import { bindingFrom, migrateActions, migrateDocument, rulesFromLegacy } from './migrate';
import { getElement, splitFragment } from './schema';
import { createDefaultTheme } from './theme';
import {
  DOCUMENT_VERSION,
  type Asset,
  type Binding,
  type Condition,
  type Cre8Document,
  type ElementType,
  type NodeEventBinding,
  type NodeId,
  type NodeProps,
  type Page,
  type RepeatSpec,
  type ResponsiveStyles,
  type SceneNode,
  type StateDecl,
  type StateRule,
  type StateStyles,
  type StyleDecl,
  type Ref,
  type RefSlot,
  type Test,
  type SceneNode as SceneNodeType,
  type AuthoredRule,
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
  /**
   * The state this element declares.
   *
   * The long spelling. `props.switchKey` and its two siblings remain the short
   * one and are folded by `finishTree`, so a block only reaches for this when
   * it wants to say something the props cannot — which today means naming a
   * value nothing sets.
   */
  state?: StateDecl;
  /**
   * Rules, with `when` in either spelling.
   *
   * A block writes `when: [a, b]` because a list of conditions is what
   * somebody composing one means, and the document holds a `Test`. Folded by
   * `asTest` on the way in, the same arrangement `states` already has with
   * `rules`: authoring keeps the convenient form and nothing downstream ever
   * sees two shapes.
   */
  rules?: AuthoredRule[];
  meta?: SceneNode['meta'];
  /** Render `children` once per record. */
  repeat?: RepeatSpec;
  /**
   * What state the record puts this node in — `WHEN feature is "wide" → wide`.
   *
   * The document model has carried this since stage 3 and the renderer has
   * read it for just as long: `stateFrom` evaluates it against the row and
   * writes the answer into the state attribute, per row, at publish. Nothing
   * could *author* it. `buildSubtree` copied props, styles, rules, meta,
   * repeat, refs and bindings, and silently dropped this — so a block could
   * make a record change what an element *says*, through `bind`, and had no
   * way to make it change what an element *looks like*.
   *
   * That is why a repeater drew one shape. Not a missing feature in the
   * renderer: a field missing from the shape a block is written in.
   */
  assign?: StateRule[];
  /**
   * Read fields of the record in scope into props.
   *
   * A bare field name is the shorthand — `{ text: 'title' }` — and is folded
   * into a `Binding` on the way in by the same function the migration uses.
   */
  bind?: Record<string, string | Binding>;
  /**
   * What this node does when it is pressed.
   *
   * Only needed for what the shorthand cannot say — an assignment naming its
   * state, or more than one action. `props.switchSet`, `props.switchQuiet` and
   * `props.copyText` remain the way the library writes the ordinary case, and
   * are folded into this by the same function that migrates a saved document,
   * exactly as `states` is folded into `rules`. So a block never has to choose
   * a spelling: it writes the short one until it needs the long one.
   */
  events?: NodeEventBinding[];
  /**
   * What this node points at, by the *name* of the node it points at.
   *
   * A spec has no ids, so a block writes `{ popover: 'Menu' }` and `buildTree`
   * turns it into a real reference once every node exists.
   */
  refs?: Partial<Record<RefSlot, string>>;
  children?: NodeSpec[];
}

export function buildTree(
  spec: NodeSpec,
  into: NodeMap = {},
  parentId: NodeId | null = null,
  options: { defer?: boolean } = {}
): { rootId: NodeId; nodes: NodeMap } {
  const rootId = buildSubtree(spec, into, parentId);
  // Only once the whole tree exists do the referenced nodes have ids.
  if (!options.defer) finishTree(into);
  return { rootId, nodes: into };
}

/**
 * Turn authored names into references, and give unanchored panels an anchor.
 *
 * Separate from `buildTree` so a caller can widen the scope a name resolves
 * in. One block is the right scope for a block — a name matching nothing there
 * is a mistake in the block — but a *page* is built one section at a time, and
 * a name resolved per section can only ever point inside the section that
 * wrote it. That is why no template had a jump link: not a missing feature,
 * a resolution scope one level too narrow, and the failure is silent because
 * an unresolved name is dropped.
 *
 * The order matters and is not interchangeable: `defaultAnchors` matches an
 * invoker to its panel by comparing `refs.popover.node` against an *id*, so it
 * has nothing to compare until the names are gone.
 */
export function finishTree(nodes: NodeMap): void {
  resolveRefs(nodes);
  defaultAnchors(nodes);
  foldStates(nodes);
  /*
   * Last, and after `resolveRefs`: a block writes `refs: { popover: 'Menu' }`
   * as a *name*, and the absorption moves a reference — so it has to see the
   * resolved id or it would fold a name that no longer means anything.
   */
  for (const node of Object.values(nodes)) migratePress(node);
}

/**
 * `switchKey` and friends become the node's state declaration.
 *
 * Here rather than in `buildSubtree`, and that is forced: a declaration's
 * values are scraped out of the subtree, and a node being built has no subtree
 * yet — its children arrive after it. `finishTree` is the first moment the
 * whole shape exists, which is the same reason `resolveRefs` runs here.
 *
 * A spec that writes `state` itself wins, exactly as one that writes `events`
 * wins over `switchSet`. The props survive as the authoring shorthand every
 * block in the library is written in; `migrate.ts` does the same fold for a
 * document arriving from disk, and neither has to know about the other.
 */
function foldStates(nodes: NodeMap): void {
  for (const node of Object.values(nodes)) {
    if (!node.state) {
      const decl = declarationFrom(nodes, node);
      if (decl) node.state = decl;
    }
    for (const prop of LEGACY_STATE_PROPS) delete node.props[prop];
  }
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
    const authored = (spec.rules ?? []).map((rule) => {
      const when = asTest(rule.when);
      const out: StyleRule = { ...rule, when };
      if (!when) delete out.when;
      return out;
    });
    node.rules = [...(node.rules ?? []), ...fromStates, ...authored];
  }
  if (spec.state) node.state = structuredCloneCompat(spec.state);
  if (spec.meta) node.meta = { ...node.meta, ...spec.meta };
  if (spec.repeat) node.repeat = structuredCloneCompat(spec.repeat);
  if (spec.assign?.length) node.assign = structuredCloneCompat(spec.assign);
  if (spec.events?.length) node.events = structuredCloneCompat(spec.events);
  // The action shorthand, folded by the function that migrates a saved
  // document — so `switchSet` on a spec and `switchSet` in a file from last
  // month become the same thing, and the props never reach the renderer from
  // either direction. A spec that wrote `events` itself wins, which is what
  // the migration already does for a node that carries both.
  migrateActions(node);
  if (spec.refs) {
    node.refs = Object.fromEntries(
      Object.entries(spec.refs).map(([slot, name]) => [slot, namedRef(name)])
    );
  }
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
 * Point every authored reference at the node it names.
 *
 * A block describes its own wiring — "this button opens the Menu popover" —
 * but a spec has no ids, so the reference travels as a *name* until the nodes
 * exist. This is where that stops: past this point a `Ref` always holds an id,
 * and nothing downstream has to know the two shapes apart.
 *
 * A name matching nothing is dropped rather than left dangling. A
 * `popovertarget` pointing at no element makes the button do nothing at all,
 * which is worse than the button simply not being an invoker — and an anchor
 * naming a missing element silently un-anchors the panel it was placed by.
 */
const NAME_REF = 'name@';

/** How a spec points at a node it cannot yet have the id of. */
export const namedRef = (name: string): Ref => ({ node: `${NAME_REF}${name}` });

/**
 * What each slot may point at.
 *
 * Scoped per slot, not "any node with that name", and the difference is not
 * theoretical: the command menu has a wrapper carrying the same layer name as
 * the panel inside it, so a name index over every node resolved the button to
 * the wrapper. Two buttons then pointed at an element that is not a popover,
 * the published page had an id and a `popovertarget` that did not match, and
 * the menu could not be opened. Nothing static saw it — the *name* existed,
 * which is all the old rule asked.
 */
const REF_SCOPE: Record<RefSlot, (node: SceneNodeType) => boolean> = {
  popover: (node) => node.type === 'popover' || node.type === 'dialog',
  anchorFor: () => true,
  // Anything with a name can be jumped to. What it needs is an id in the
  // markup, and that is arranged when the reference is made rather than
  // required of the target in advance.
  scrollTo: () => true,
};

/**
 * How good a candidate is, when several answer to one name.
 *
 * `scrollTo` accepts any node, which is the right rule and an insufficient one
 * the moment a name is looked up across a whole document. "Contact" in the
 * agency names three things: the page's Contact section, and the frame and
 * label of the footer's Contact column. All three are jumpable in the sense
 * that they could be given an id; only one is what anybody means.
 *
 * A rank rather than a filter, so nothing stops being reachable — a name that
 * matches only a text label still resolves to it. What changes is which wins
 * when there is a choice, and the order is the order of intent: something the
 * author already named as a destination, then a section, then whatever is
 * left. Ties fall back to document order, which is the rule this had before.
 */
function destinationRank(node: SceneNodeType): number {
  if (node.props?.anchor) return 2;
  if (node.type === 'section') return 1;
  return 0;
}

function resolveRefs(nodes: NodeMap, pageOf?: Map<NodeId, string>): void {
  /*
   * Every candidate per name, in document order — not just the first.
   *
   * First still wins, and for the reason it always did: last-wins would change
   * a block's wiring the moment somebody duplicated something below it. What
   * the list adds is somewhere to go when the first candidate is the *referring
   * node itself*, which is not an exotic case. The natural name for a nav entry
   * is the name of the section it points at, and the nav comes first, so a link
   * called "Work" above a section called "Work" claimed its own id — resolved
   * to an element with no anchor, published as a link to nowhere, and looked in
   * the document exactly like a working reference.
   *
   * Skipping self and stopping was the first fix, and it was only half right:
   * the reference was dropped instead of pointing at the section, which turns a
   * silent wrong into a visible one rather than into a working link.
   */
  const byName = new Map<RefSlot, Map<string, NodeId[]>>();
  for (const slot of Object.keys(REF_SCOPE) as RefSlot[]) {
    const index = new Map<string, NodeId[]>();
    for (const node of Object.values(nodes)) {
      if (!REF_SCOPE[slot](node)) continue;
      const list = index.get(node.name);
      if (list) list.push(node.id);
      else index.set(node.name, [node.id]);
    }
    byName.set(slot, index);
  }

  /*
   * Through `everyRef`, so a name in an action resolves by the same rule as a
   * name in a slot.
   *
   * This loop used to read `node.refs` for itself, which was fine while that
   * was the only place a reference lived and stopped being fine the moment a
   * verb could hold one: a block writing `scrollTo` as an action got a
   * reference nothing ever resolved, and published `href="#"` — a jump to the
   * top of the page, on an element that looked correctly wired from every
   * angle except the file.
   *
   * Collected before it is applied. The generator is walking the very objects
   * the resolution deletes from, and mutating a map mid-iteration is how a
   * cleanup skips every other entry.
   */
  const pending = [...everyRef(nodes)].filter(
    // The prefix rather than "is it in `nodes`": an id and a name are both
    // strings, and deciding between them by lookup means a name that happens
    // to match an id resolves to the wrong element. Rare enough never to be
    // found, which is the kind of bug worth spending a sentinel on.
    // `node` is optional-chained because an action's reference is the one a
    // hand-edited document can leave shapeless: `hydrateDocument` repairs
    // `rules` and `overrides` and has never looked inside `events`, so a
    // `{ type: 'scrollTo', ref: {} }` would otherwise take the whole builder
    // down rather than publishing a jump that goes nowhere.
    (found) => found.scope !== null && Boolean(found.ref.node?.startsWith(NAME_REF))
  );

  for (const { node, slot, ref, scope } of pending) {
    // Every candidate that is not the node doing the referring, best first.
    const here = pageOf?.get(node.id);
    const found = (byName.get(scope as RefSlot)?.get(ref.node.slice(NAME_REF.length)) ?? [])
      .filter((id) => id !== node.id)
      .map((id, order) => ({ id, order, node: nodes[id] }))
      .sort((a, b) => {
        if (scope === 'scrollTo') {
          const rank = destinationRank(b.node!) - destinationRank(a.node!);
          if (rank) return rank;
          /*
           * Then the referring node's own page, so widening the search
           * cannot move a link that already worked. Only after the rank,
           * though: a footer column named "Contact" sitting on this page
           * must not beat the Contact *section* on another one, which is
           * exactly the way round the first version of this had it.
           */
          if (here) {
            const mine = Number(pageOf?.get(b.id) === here) - Number(pageOf?.get(a.id) === here);
            if (mine) return mine;
          }
        }
        return a.order - b.order;
      })[0]?.id;

    // An action's reference is edited in place — the verb outlives a name that
    // matched nothing, for the reason `pruneRefs` gives — while a slot's is
    // removed, which is what the rest of the code reads as "no reference".
    if (slot === 'action') {
      ref.node = found ?? '';
      continue;
    }
    if (found) node.refs![slot as RefSlot] = { node: found };
    // A name matching nothing is dropped rather than left dangling.
    else delete node.refs![slot as RefSlot];
  }

  for (const node of Object.values(nodes)) {
    if (node.refs && !Object.keys(node.refs).length) delete node.refs;
  }
}

/**
 * Resolve every name in a document, once, with every page in hand.
 *
 * `finishTree` resolves within one page, which is all a single-page document
 * ever needed — but it also decided, silently, that a link could never name a
 * section on another page: the name matched nothing, the reference was
 * dropped, and the control kept whatever href it had. That is why a two-page
 * template wrote its navigation twice, one copy scrolling and one copy
 * navigating.
 *
 * The page map is what lets the ranking prefer a target on the referring
 * node's own page, so widening the search cannot move a link that already
 * worked. It is built here rather than asked of the caller because only the
 * page roots are known outside, and the ranking needs every node.
 *
 * Written first as two passes — each page against itself, then the leftovers
 * against everything — which looks equivalent and is not. It let a footer
 * column named "Contact" on the referring page beat the Contact *section* on
 * another one, because the first pass could not see that one candidate was a
 * destination and the other was a label. Rank first, page second.
 */
export function finishDocument(pageRoots: Map<NodeId, string>, all: NodeMap): void {
  const pageOf = new Map<NodeId, string>();
  const mark = (id: NodeId, page: string): void => {
    pageOf.set(id, page);
    for (const child of all[id]?.children ?? []) mark(child, page);
  };
  for (const [rootId, pageId] of pageRoots) mark(rootId, pageId);
  resolveRefs(all, pageOf);
  defaultAnchors(all);
  /*
   * And here too, not only in `finishTree`.
   *
   * A template composes its pages with `defer` and finishes the whole document
   * in one pass, so `finishTree` never runs for it — which left every
   * template's switch declared nowhere. The fold is idempotent (a node that
   * already has a declaration is skipped), so both doors can call it and the
   * one a caller happens to use stops mattering.
   */
  foldStates(all);
}

/**
 * A panel that asked to be anchored, and nobody said to what.
 *
 * The answer is almost always "the button that opens it", and making a block
 * say so twice — once on the panel, once on the button — is how one of the two
 * gets forgotten. So the default is derived here, once, at the moment the spec
 * becomes a document. The editor applies the same default through `setAnchor`
 * when somebody turns anchoring on.
 *
 * Only where nothing already claims it: an explicit anchor beats the guess,
 * which is the whole point of being able to point at something else.
 */
function defaultAnchors(nodes: NodeMap): void {
  const claimed = new Set<NodeId>();
  for (const node of Object.values(nodes)) {
    const at = node.refs?.anchorFor?.node;
    if (at) claimed.add(at);
  }
  for (const panel of Object.values(nodes)) {
    if (!panel.props.anchorTo || claimed.has(panel.id)) continue;
    const invoker = Object.values(nodes).find((n) => n.refs?.popover?.node === panel.id);
    if (invoker) invoker.refs = { ...invoker.refs, anchorFor: { node: panel.id } };
  }
}

/**
 * Every reference in a document, so one walk can service all of them.
 *
 * The function that did not exist, and whose absence is the whole argument for
 * a `refs` map: deleting a panel used to leave every button that opened it
 * pointing at an id no longer in the document, because nothing enumerated the
 * references and a prop gives you nothing to enumerate.
 */
export function* everyRef(
  nodes: NodeMap
): Generator<{
  node: SceneNode;
  slot: RefSlot | 'expression' | 'action';
  ref: Ref;
  /**
   * Which pool of names this one is looked up in, or null for a reference
   * that only ever holds an id. A `scrollTo` verb and a `refs.scrollTo` are
   * the same question asked twice, and answering it in two places is how they
   * would come to disagree about what "Contact" means.
   */
  scope: RefSlot | null;
}> {
  for (const node of Object.values(nodes)) {
    for (const [slot, ref] of Object.entries(node.refs ?? {})) {
      if (ref) yield { node, slot: slot as RefSlot, ref, scope: slot as RefSlot };
    }
    /*
     * And the ones inside actions, for the same reason and with the same
     * consequence if they are left out.
     *
     * `scrollTo` and `openPanel` name a node, exactly as `refs.scrollTo` and
     * `refs.popover` do — the verb is a newer spelling of the same reference,
     * not a new kind of thing. A block writes `{ name: 'Features' }` and this
     * walk is what turns it into an id, so leaving actions out did not merely
     * skip the cleanup: it meant the reference was never resolved at all, and
     * a jump verb published `href="#"`.
     *
     * Yielded as `action` rather than as its slot name because it is not
     * removable the way a slot is. Deleting the panel a button opens should
     * not silently delete the action a designer wrote — `pruneRefs` empties
     * the reference and leaves the verb, which the panel can then report, the
     * same bargain `expression` strikes one line down.
     */
    for (const action of everyAction(node)) {
      if (!('ref' in action) || !action.ref) continue;
      yield {
        node,
        slot: 'action',
        ref: action.ref,
        scope: action.type === 'scrollTo' ? 'scrollTo' : 'popover',
      };
    }
    /*
     * And the ones inside expressions, which are references in every sense
     * that matters and live somewhere else entirely: a `Value` reading a
     * control holds one, nested in `assign[].when`. Leaving them out would
     * have re-created the exact bug this map exists to prevent, one layer
     * down — delete the email box and the rule reading it keeps a node id
     * that is no longer in the document.
     *
     * Yielded as `expression` rather than a slot because they are not
     * *removable* the way a slot is: the fix for a rule reading a deleted
     * control is the designer's, not a silent deletion of the rule they
     * wrote. Reporting is what enumerability buys here.
     */
    for (const rule of node.assign ?? []) {
      for (const ref of refsInTest(rule.when)) {
        yield { node, slot: 'expression', ref, scope: null };
      }
    }
  }
}

/** Every element reference in a Test, however deeply grouped. */
function refsInTest(test: Test): Ref[] {
  if (test.kind === 'compare') {
    return test.left.kind === 'element' ? [test.left.ref] : [];
  }
  if (test.kind === 'every' || test.kind === 'some') return test.tests.flatMap(refsInTest);
  return [];
}

/** Drop every reference pointing at a node that is no longer here. */
export function pruneRefs(nodes: NodeMap): void {
  for (const { node, slot, ref } of everyRef(nodes)) {
    // An expression's reference is left where it is. Deleting the rule
    // somebody wrote because the control it reads went away is a bigger
    // decision than cleanup gets to make; the node falls back to its
    // "Otherwise", which is the declared answer for an unanswerable rule.
    //
    // An action's is emptied rather than removed, which is the same bargain
    // seen from the other side: the verb stays, so the panel can show a
    // designer that their Open button no longer names a panel, and the
    // renderer's `?? ''` already means an emptied reference reaches no
    // attribute. Deleting the action outright would take away the thing they
    // would have to write again.
    if (slot === 'expression' || nodes[ref.node]) continue;
    if (slot === 'action') {
      ref.node = '';
      continue;
    }
    delete node.refs?.[slot];
    if (node.refs && !Object.keys(node.refs).length) delete node.refs;
  }
}

/**
 * Rules reading an element the document no longer has.
 *
 * The rule id, not only the node, because that is what makes this reportable
 * in the place somebody can act on it: the warning belongs beside the sentence
 * that is broken, not at the top of a panel listing four rules of which one
 * is.
 */
export function danglingReads(
  nodes: NodeMap
): { node: SceneNode; rule: string; missing: NodeId }[] {
  const out: { node: SceneNode; rule: string; missing: NodeId }[] = [];
  for (const node of Object.values(nodes)) {
    for (const rule of node.assign ?? []) {
      for (const ref of refsInTest(rule.when)) {
        if (!nodes[ref.node]) out.push({ node, rule: rule.id, missing: ref.node });
      }
    }
  }
  return out;
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
 *
 * Every slot, not one named prop. That is the difference the `refs` map makes:
 * this used to rewire `popoverTarget` and nothing else, so any second kind of
 * reference would have been silently wrong in every copy.
 */
function rewireInternalRefs(nodes: NodeMap, remap: Map<NodeId, NodeId>): void {
  /*
   * Through `everyRef`, so a copy points at the copy whichever way the
   * reference is spelled.
   *
   * This walked `node.refs` for itself, which was right while a slot was the
   * only place a reference lived. X6 gave `scrollTo` and `openPanel` a second
   * spelling — an action holding a `Ref` — and taught `everyRef` to yield it,
   * but this was not asking `everyRef`. So a duplicated button whose jump was
   * authored as a verb kept pointing at the *original* section, which is
   * exactly the bug the map exists to prevent, one field along.
   *
   * Edited in place rather than reassigned: the generator hands back the
   * object the document holds, and an action's reference has no slot to
   * assign to.
   */
  const copied = new Set(remap.values());
  for (const { node, ref } of everyRef(nodes)) {
    if (!copied.has(node.id)) continue;
    const moved = remap.get(ref.node);
    if (moved) ref.node = moved;
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
 *
 * **It does not touch what it is given.** Everything below repairs in place —
 * `node.children` is filtered, `node.parentId` is re-derived, a legacy prop is
 * deleted and re-expressed as a rule — and until this copy existed all of that
 * landed on the caller's own object. That is wrong on its own terms: a
 * normaliser is asked "what does this document mean", not handed something to
 * scribble on. It also crashed the one caller that could not survive it.
 *
 * Immer freezes what it produces, so a Durable Object that has applied a
 * single patch holds a deeply frozen tree — and a republish, which hydrates
 * before it renders, died on `Cannot assign to read only property 'rules'`.
 * Not on the first save: on the first save after an edit arrived over a
 * socket. A room that had only ever loaded from D1 held plain parsed JSON and
 * published perfectly, which is why this looked like a long-lived room going
 * bad rather than a function with a side effect.
 *
 * `structuredClone` rather than a hand-written walk: a document is plain data,
 * and the two places a copy could miss a level — a rule's `apply`, a style
 * layer — are exactly the levels the repairs reach into. Measured at 2.6ms for
 * a 364-node template and 5.5ms at 1,456 nodes, on paths that run when a
 * document is opened, resynced or published rather than as somebody types.
 */
export function hydrateDocument(input: Partial<Cre8Document> & { nodes?: NodeMap }): Cre8Document {
  const source = structuredClone(input);
  const base = createEmptyDocument(source.name ?? 'Untitled project');
  const doc: Cre8Document = {
    ...base,
    ...source,
    // Whatever version came in is kept until `migrateDocument` below has
    // earned the new one. Stamping it here — which this used to do — made the
    // field a decoration: every document claimed to be current the moment it
    // was read, whatever shape it was actually in.
    version: source.version ?? 1,
    theme: { ...base.theme, ...(source.theme ?? {}) },
    settings: { ...base.settings, ...(source.settings ?? {}) },
    nodes: source.nodes ?? base.nodes,
    pages: source.pages?.length ? source.pages : base.pages,
    assets: source.assets ?? [],
    components: source.components ?? [],
    // Absent on every document written before collections existed, and on
    // every document that never uses one — so it stays optional rather than
    // adding an empty array to a hundred stored projects.
    ...(source.collections?.length ? { collections: source.collections } : {}),
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
        (rule): rule is (typeof rules)[number] => Boolean(rule) && typeof rule === 'object'
      );
      /*
       * And the upgrade from the list to the tree, which happens here because
       * this is the one gate every document passes through — the editor loads
       * through it and so does the Worker that publishes.
       *
       * The old shape was `when: Condition[]`, an AND of conditions with the
       * empty list meaning *always*. `asTest` is the same reading: a list of
       * one is that condition, a longer list is an `every`, and an empty one
       * is absence.
       *
       * The guard this replaces required `Array.isArray(rule.when)` and
       * dropped anything else, which was right when a list was the only legal
       * shape and would now throw away every rule written since. What makes a
       * rule usable is that it is an object; what `when` holds is normalised
       * rather than judged, and a `when` that is neither a list nor a Test
       * becomes absence — a rule that always applies, which is the reading
       * that loses no declaration the designer wrote.
       */
      for (const rule of usable) {
        const when = (rule as { when?: unknown }).when;
        if (when === undefined) continue;
        if (Array.isArray(when)) {
          const test = asTest(when as Condition[]);
          if (test) rule.when = test;
          else delete rule.when;
        } else if (!when || typeof when !== 'object' || !('kind' in when)) {
          delete rule.when;
        }
      }
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
