/**
 * Which props are content, and which are structure.
 *
 * One question, asked in two places for years and answered by two hand-written
 * lists: `SETTABLE` in `renderer/variants.ts` decided what a rule may vary, and
 * a `BINDABLE` array in the Data panel decided what a record may fill. They
 * were nearly the same list, they were kept in step by nobody, and the panel
 * intersected them anyway — `BINDABLE.filter(isSettable)` — so the second was
 * the first plus an unwritten exception.
 *
 * Both had drifted, in both directions. Three props the renderer turns into
 * visible content were in neither, so no rule could vary them and no record
 * could fill them: `summary` — the clickable line of a `<details>`, which is
 * the *question* in every FAQ anyone would build from a collection — `legend`
 * on a fieldset, and `poster`, a video's still image, sitting beside an `src`
 * and an `alt` that were both bindable. And `title` was in both lists while
 * being declared by no element and read by no renderer.
 *
 * So it is declared once here and derived twice, and the static suite requires
 * every prop an element ships with to appear in one of the two lists below.
 * A prop in neither is a failure rather than a silent structure — which is the
 * whole point, because silence is how three of them got here. See §4.1.13.
 */

/**
 * The rule both lists are drawn on, and it is not "is this a string".
 *
 * A prop is content when varying it leaves **the same element saying something
 * else**. `level` on a heading, `inputType` on an input and `popoverMode` on a
 * dialog all fail that: they make the variants *different elements*, and two of
 * those would then fight over one DOM id. `options` fails it for the same
 * reason one step out — it expands to a different number of children, so a
 * variant is a different subtree rather than a different sentence.
 *
 * Ordered as the Content panel shows them, because the Data panel lists a
 * binding per prop and a list in a third order is a list somebody has to read
 * twice.
 */
export const CONTENT_PROPS = [
  'text',
  'html',
  'label',
  'summary',
  'legend',
  'caption',
  'alt',
  'src',
  'poster',
  'href',
  'placeholder',
  'value',
  'name',
] as const;

/**
 * Content a record may not fill, and why.
 *
 * `name` is how a form field is submitted and how everything else on the page
 * finds it: `testRuntime` looks a control up with `[name="…"]`, the expression
 * editor offers named controls inside the node, and a style rule can compare
 * against one. All of those are written against a name that is known when the
 * page is designed. A bound name is not — it is whatever the record says, once
 * per row — so binding it would quietly break every reference to it while the
 * panel still showed them.
 *
 * A *rule* may still vary it, which is the narrower and safe half: the values a
 * rule can set are written down in the document, so the references can be
 * resolved against them.
 */
export const NOT_BINDABLE = new Set<string>(['name']);

/**
 * Props that are structure, named so the check can tell them from an omission.
 *
 * Grouped by why rather than annotated one by one, because the reason is what
 * repeats: each group is a different way of failing the same-element test.
 */
export const STRUCTURAL_PROPS = new Set<string>([
  // A different element, or a different subtree. `isSettable`'s original rule.
  'level',
  'tag',
  'inputType',
  'popoverMode',
  'options',
  'rows',
  'scope',
  'header',
  'colSpan',
  'rowSpan',
  'multiple',
  'accept',
  // Wiring: what this element is joined to, resolved when the page is designed.
  'anchor',
  'anchorTo',
  'switchRole',
  'drives',
  'rangeKey',
  'rangeValue',
  'target',
  'submit',
  // Where a form posts. Deliberately not content *yet*: it is the form's
  // `href`, and §4.0.7's argument for `href` applies to it word for word — but
  // a rule or a record silently redirecting where somebody's data is sent is a
  // decision worth taking on purpose rather than by consistency.
  'action',
  'method',
  // Numbers and switches a visitor operates or a browser reads. Varying one is
  // not the element saying something else, it is the element behaving
  // differently, which is what a rule's `apply` and an action are for.
  'checked',
  'open',
  'required',
  'min',
  'max',
  'step',
  'indeterminate',
  'autoplay',
  'controls',
  'loop',
  'muted',
  'showWhileEditing',
  // Derived from another prop, so varying it independently desynchronises the
  // pair. `srcset` is generated at upload from `src`; `width` and `height` are
  // read off the asset.
  'srcset',
  'width',
  'height',
  'priority',
  'strokeWidth',
  // Identity, not content. You do not retarget an instance by typing an id at
  // it — the panel offers Edit and Detach instead.
  'componentId',
]);

/** Whether a rule may vary this prop: the same element saying something else. */
export function isContentProp(prop: string): boolean {
  return (CONTENT_PROPS as readonly string[]).includes(prop);
}

/** Whether a record may fill it. Content, minus the ones named above. */
export function isBindableProp(prop: string): boolean {
  return isContentProp(prop) && !NOT_BINDABLE.has(prop);
}

/** Those, in the order the Content panel shows them. */
export function bindableProps(): string[] {
  return (CONTENT_PROPS as readonly string[]).filter((prop) => !NOT_BINDABLE.has(prop));
}
