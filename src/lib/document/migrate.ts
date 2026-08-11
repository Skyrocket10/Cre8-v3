/**
 * Document upgrades, run once on load.
 *
 * `DOCUMENT_VERSION` was written into every document from the beginning and
 * read by nothing, so the first migration cannot trust it: a document saved
 * last week says `1` and one saved before the field was taken seriously says
 * `1` too. Every step below therefore recognises the *shape* it converts and
 * is safe to run twice.
 */

import { uid } from './id';
import { readLegacyVisibility, slug } from './schema';
import {
  DOCUMENT_VERSION,
  type Binding,
  type Condition,
  type Cre8Document,
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
      out.push({ id: uid(), when: [POINTER[name]!], apply });
      continue;
    }
    if (name === 'backdrop') {
      out.push({ id: uid(), when: [], part: 'backdrop', apply });
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
        when: [{ kind: 'state', key: '', op: 'is', values: [value] }],
        apply,
      });
      continue;
    }
    // An unknown name: keep the declarations rather than lose them, with no
    // condition, so they behave as part of the base layer.
    out.push({ id: uid(), when: [], apply });
  }

  // "Shown when X" was stored as the intent and negated by the generator.
  // A rule stores the literal, so the operator flips here.
  const when = readLegacyVisibility(props);
  if (when) {
    out.push({
      id: uid(),
      when: [
        {
          kind: 'state',
          key: when.state,
          op: when.negated ? 'is' : 'isNot',
          values: when.values,
        },
      ],
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

function migrateNode(node: SceneNode): void {
  migrateBindings(node);
  migrateRefs(node);

  const legacy = (node as SceneNode & { states?: StateStyles }).states;
  const hasRetired = RETIRED_PROPS.some((key) => node.props[key] !== undefined);
  if (!legacy && !hasRetired) return;

  const converted = rulesFromLegacy(legacy, node.props);
  // Appended rather than replacing: a document part-way through the change
  // could carry both, and the converted ones are the older intent, so they
  // belong first.
  node.rules = converted.concat(node.rules ?? []);

  delete (node as SceneNode & { states?: StateStyles }).states;
  for (const key of RETIRED_PROPS) delete node.props[key];
}

export function migrateDocument(doc: Cre8Document): Cre8Document {
  for (const node of Object.values(doc.nodes)) migrateNode(node);
  doc.version = DOCUMENT_VERSION;
  return doc;
}
