/**
 * The behaviour runtime.
 *
 * Phase C's one script, and the decision `ARCHITECTURE.md` §1 warns about:
 * the moment a page needs behaviour, the tempting shape is React state on the
 * canvas and a hand-written script in the published file — two implementations
 * of the same interaction, drifting apart from the first commit.
 *
 * What is here instead is smaller than either. **CSS does the work.** A switch
 * group carries its current value in an attribute, and the generator writes a
 * rule per case that hides the ones that do not match. Changing state is then
 * one attribute write, and *nothing else has to agree about anything* — the
 * canvas, preview and the published page run the same rules over the same
 * markup because there is only one mechanism, not one mechanism per surface.
 *
 * That leaves this file with two jobs: write the attribute when something is
 * clicked, and keep `aria-pressed` honest. Roughly thirty lines, inlined only
 * into pages that actually contain a switch.
 *
 * ## Why this function is written the way it is
 *
 * The published page gets it through `Function.prototype.toString()`, so it
 * has to be **completely self-contained**: every attribute name is a literal,
 * there are no references to anything outside the function body, and nothing
 * here may be extracted into a shared constant however much it repeats. A
 * bundler renames module-scope bindings; a renamed binding inside a serialised
 * function is a `ReferenceError` on somebody's live site.
 *
 * The constants below exist for the *rest of the codebase* to import. They are
 * deliberately not used inside `behaviourRuntime`, and the render suite drives
 * a real published page so that a mistake here fails a test rather than a
 * visitor.
 */

/** The group: names the switch and carries its current value. */
export const SWITCH_ATTR = 'data-cre8-switch';
export const VALUE_ATTR = 'data-cre8-value';
/** A control that sets the enclosing group to a value. */
export const SET_ATTR = 'data-cre8-set';
/** Something shown only while the enclosing group holds a value. */
export const CASE_ATTR = 'data-cre8-case';

/**
 * @param root  Document on a published page, the frame element in the editor.
 * @param live  False on the canvas: state is chosen in the inspector, and a
 *              click there is someone trying to select the element, not
 *              trying to use it.
 * @returns A disposer, for surfaces that unmount.
 */
export function behaviourRuntime(root: Document | HTMLElement, live: boolean): () => void {
  const sync = function (group: Element): void {
    const value = group.getAttribute('data-cre8-value') || '';
    const setters = group.querySelectorAll('[data-cre8-set]');
    for (let i = 0; i < setters.length; i++) {
      const setter = setters[i]!;
      // A nested group owns its own setters; without this the outer group
      // would keep overwriting the inner one's aria on every click.
      if (setter.closest('[data-cre8-switch]') !== group) continue;
      setter.setAttribute(
        'aria-pressed',
        setter.getAttribute('data-cre8-set') === value ? 'true' : 'false'
      );
    }
  };

  const groups = root.querySelectorAll('[data-cre8-switch]');
  for (let g = 0; g < groups.length; g++) sync(groups[g]!);

  if (!live) return function () {};

  const onClick = function (event: Event): void {
    const target = event.target as Element | null;
    if (!target || !target.closest) return;
    const setter = target.closest('[data-cre8-set]');
    if (!setter) return;
    const group = setter.closest('[data-cre8-switch]');
    if (!group) return;
    // A setter is a `<button>`, so this is only belt and braces — but a
    // designer can put one inside a form, where the default is a submit.
    event.preventDefault();
    group.setAttribute('data-cre8-value', setter.getAttribute('data-cre8-set') || '');
    sync(group);
  };

  root.addEventListener('click', onClick);
  return function () {
    root.removeEventListener('click', onClick);
  };
}

/**
 * The runtime as a string, for the publisher to inline.
 *
 * Serialised rather than kept as a string literal so the thing that ships is
 * the same source the editor runs, type-checked and linted like the rest of
 * the codebase — a hand-maintained copy in a template literal is exactly the
 * second implementation this phase exists to avoid.
 */
export function behaviourRuntimeSource(): string {
  return `(${behaviourRuntime.toString()})(document,true)`;
}
