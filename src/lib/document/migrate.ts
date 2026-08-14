/**
 * Document upgrades, run once on load.
 *
 * `DOCUMENT_VERSION` was written into every document from the beginning and
 * read by nothing, so the first migration cannot trust it: a document saved
 * last week says `1` and one saved before the field was taken seriously says
 * `1` too. Every step below therefore recognises the *shape* it converts and
 * is safe to run twice.
 */

import { clickBinding } from './actions';
import { uid } from './id';
import { readLegacyVisibility, slug } from './schema';
import {
  DOCUMENT_VERSION,
  type Binding,
  type Condition,
  type Cre8Document,
  type NodeAction,
  type NodeProps,
  type SceneNode,
  type StateStyles,
  type StyleDecl,
  type StyleRule,
} from './types';

/** Which pseudo-class each of the old state names meant. */
const POINTER: Record<string, Condition> = {
  hover: { kind: 'pointer', pseudo: 'hover' },
  active: { kind: 'pointer', pseudo: 'active' },
  focus: { kind: 'pointer', pseudo: 'focus' },
};

/**
 * Turn the old `states` record and the old visibility props into rules.
 *
 * Exported because the factory needs it too: `NodeSpec.states` and
 * `ElementDefinition.defaultStates` survive as authoring shorthands, and this
 * is the one place that knows what they mean.
 */
export function rulesFromLegacy(
  states: StateStyles | undefined,
  props: NodeProps
): StyleRule[] {
  const out: StyleRule[] = [];

  for (const [name, declarations] of Object.entries(states ?? {})) {
    if (!declarations || Object.keys(declarations).length === 0) continue;
    const apply = declarations as StyleDecl;

    if (POINTER[name]) {
      out.push({ id: uid(), when: POINTER[name]!, apply });
      continue;
    }
    if (name === 'backdrop') {
      out.push({ id: uid(), part: 'backdrop', apply });
      continue;
    }
    if (name === 'pressed') {
      // `pressed` meant "while the state this control sets holds its value",
      // which only ever made sense next to a `switchSet`. Without one there
      // is nothing to condition on, and dropping it is better than inventing
      // a condition the author never wrote.
      const value = slug(props.switchSet);
      if (!value) continue;
      out.push({
        id: uid(),
        when: { kind: 'state', key: '', op: 'is', values: [value] },
        apply,
      });
      continue;
    }
    // An unknown name: keep the declarations rather than lose them, with no
    // condition, so they behave as part of the base layer.
    out.push({ id: uid(), apply });
  }

  // "Shown when X" was stored as the intent and negated by the generator.
  // A rule stores the literal, so the operator flips here.
  const when = readLegacyVisibility(props);
  if (when) {
    out.push({
      id: uid(),
      when: {
        kind: 'state',
        key: when.state,
        op: when.negated ? 'is' : 'isNot',
        values: when.values,
      },
      apply: when.keepSpace ? { visibility: 'hidden' } : { display: 'none' },
    });
  }

  return out;
}

/**
 * A binding, from either spelling of one.
 *
 * `bind` was a prop to a field name. It is now a prop to a `Binding`, so a
 * format has somewhere to live that is not inside the value. The bare string
 * survives as authoring shorthand — `bind: { text: 'title' }` in a `NodeSpec`
 * still means what it did — which is why this is exported rather than private
 * to the migration: the factory reads specs people write, and only one function
 * should know what the short spelling means.
 *
 * Recognises the shape, so it is safe on a document that has already been
 * through it.
 */
export function bindingFrom(entry: string | Binding): Binding {
  return typeof entry === 'string' ? { value: { kind: 'field', key: entry } } : entry;
}

function migrateBindings(node: SceneNode): void {
  const bind = node.bind as Record<string, string | Binding> | undefined;
  if (!bind) return;
  for (const [prop, entry] of Object.entries(bind)) {
    if (typeof entry === 'string') bind[prop] = bindingFrom(entry);
  }
}

/** The props the visibility condition used to live in. */
const RETIRED_PROPS = ['switchCase', 'whenIs', 'whenState', 'whenNot', 'hideMode'] as const;

/**
 * `props.popoverTarget` becomes `refs.popover`.
 *
 * Recognised by shape, like everything else here: the prop existing is the
 * whole signal, because `version` was written from the beginning and read by
 * nothing. Idempotent by construction — the prop is deleted, so a second run
 * finds nothing to do.
 *
 * A reference already in `refs` wins. A document could be part-way through if
 * it was open in one tab while another wrote it, and the newer spelling is the
 * one somebody chose most recently.
 */
function migrateRefs(node: SceneNode): void {
  const target = node.props.popoverTarget;
  if (typeof target !== 'string') return;
  if (target && !node.refs?.popover) {
    node.refs = { ...node.refs, popover: { node: target } };
  }
  delete node.props.popoverTarget;
}

/**
 * Declarations written under a name `StyleDecl` does not have.
 *
 * One entry, and it is a repair rather than a format change: the effect picker
 * offered `textDecorationLine` for a while, which the generator happily
 * kebab-cased into working CSS — so the pages are right and the *documents*
 * carry a key outside the closed set that `resolveValue`, the override badge
 * and the row menu all key on. Left alone, those rules would open in the panel
 * with no matching option and read as unset.
 *
 * By shape, like everything here, and idempotent: the old key is deleted, so a
 * second pass finds nothing. A value already under the right name wins — it is
 * the one somebody chose most recently.
 */
const RENAMED_DECLARATIONS: [from: string, to: keyof StyleDecl][] = [
  ['textDecorationLine', 'textDecoration'],
];

function migrateDeclarations(node: SceneNode): void {
  const layers: (StyleDecl | undefined)[] = [
    ...Object.values(node.styles ?? {}),
    ...(node.rules ?? []).map((rule) => rule.apply),
  ];
  for (const layer of layers) {
    if (!layer) continue;
    const loose = layer as Record<string, string | undefined>;
    for (const [from, to] of RENAMED_DECLARATIONS) {
      if (loose[from] === undefined) continue;
      if (loose[to] === undefined) loose[to] = loose[from];
      delete loose[from];
    }
  }
}

/**
 * `props.switchSet` and `props.copyText` become `events`.
 *
 * What a control *does* was a scalar on the node for three releases, and the
 * two things a scalar cannot express turned out to be the two things a page
 * needs: which state it drives, and doing more than one thing. `node.events`
 * holds a list, so both are sayable — see `lib/document/actions.ts`.
 *
 * Exported because the factory needs it too, on the same reasoning as
 * `rulesFromLegacy` above: the props survive as an *authoring shorthand* that
 * every block in the library is written in, and this is the one place that
 * knows what they mean. A second implementation in the factory is how the two
 * spellings would come to disagree about `quiet`.
 *
 * By shape, like everything here, and idempotent because the props are
 * deleted. Actions already on the node win: a document open in two tabs can be
 * written by the newer build while the older one still holds the props, and
 * the list is the spelling somebody chose most recently.
 *
 * The migrated assignment has **no `state`**, which is the faithful reading
 * rather than a shortcut. `switchSet` always meant the nearest enclosing
 * group, so naming one here would change what an existing page does the first
 * time somebody nests it.
 */
export function migrateActions(node: SceneNode): void {
  const value = slug(node.props.switchSet);
  const copy = typeof node.props.copyText === 'string' ? node.props.copyText : '';
  if (node.props.switchSet === undefined && node.props.copyText === undefined) return;

  if (!node.events?.length) {
    const actions: NodeAction[] = [];
    if (value) {
      actions.push({
        type: 'setState',
        value,
        ...(node.props.switchQuiet ? { quiet: true } : {}),
      });
    }
    if (copy) actions.push({ type: 'copy', text: copy });
    const binding = clickBinding(actions);
    if (binding) node.events = binding;
  }

  delete node.props.switchSet;
  delete node.props.switchQuiet;
  delete node.props.copyText;
}

function migrateNode(node: SceneNode): void {
  migrateBindings(node);
  migrateRefs(node);
  migrateDeclarations(node);

  const legacy = (node as SceneNode & { states?: StateStyles }).states;
  const hasRetired = RETIRED_PROPS.some((key) => node.props[key] !== undefined);
  if (legacy || hasRetired) {
    const converted = rulesFromLegacy(legacy, node.props);
    // Appended rather than replacing: a document part-way through the change
    // could carry both, and the converted ones are the older intent, so they
    // belong first.
    node.rules = converted.concat(node.rules ?? []);

    delete (node as SceneNode & { states?: StateStyles }).states;
    for (const key of RETIRED_PROPS) delete node.props[key];
  }

  // Last, and that is load-bearing: `rulesFromLegacy` reads `props.switchSet`
  // to know what a `pressed` style was conditioned on, so retiring the prop
  // before it runs would turn every legacy pressed style into a rule with no
  // condition — a hover state that is simply always on.
  migrateActions(node);
}

/**
 * Upgrade a document in place.
 *
 * In place deliberately, and worth saying out loud: every migration here is a
 * repair — a prop deleted and re-expressed, a binding rewritten — and doing
 * that to a copy would mean deciding, per field, what to carry over. The
 * caller owns the copy. `hydrateDocument` makes one before it gets here, which
 * is what lets this stay simple; hand it a frozen document directly and it
 * will throw, as it should.
 */
export function migrateDocument(doc: Cre8Document): Cre8Document {
  for (const node of Object.values(doc.nodes)) migrateNode(node);
  doc.version = DOCUMENT_VERSION;
  return doc;
}
