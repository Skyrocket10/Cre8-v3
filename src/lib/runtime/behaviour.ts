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
 * Marks a group as a tab set.
 *
 * The state machine is the same one a pricing toggle uses. What this adds is
 * the half that makes tabs *tabs* rather than buttons that hide things: the
 * roles, the tab-to-panel pairing, one tab stop for the whole set, and arrow
 * keys. Applied by the runtime rather than written into the markup, which is
 * the honest place for it — the roles announce an interaction, and the script
 * is what makes that interaction exist.
 */
export const TABS_ATTR = 'data-cre8-tabs';
/** A setter that changes the value without being a toggle: Back, Next. */
export const QUIET_ATTR = 'data-cre8-quiet';
/**
 * The condition is `isn't` rather than `is`.
 *
 * The only companion `data-cre8-case` needs. Which state, and whether hiding
 * keeps the element's space, are both settled in the stylesheet — they were
 * written here for a while and read by nothing.
 */
export const NOT_ATTR = 'data-cre8-not';

/**
 * @param root  Document on a published page, the frame element in the editor.
 * @param live  False on the canvas: state is chosen in the inspector, and a
 *              click there is someone trying to select the element, not
 *              trying to use it.
 * @returns A disposer, for surfaces that unmount.
 */
export function behaviourRuntime(root: Document | HTMLElement, live: boolean): () => void {
  /** Descendants belonging to this group rather than to one nested inside. */
  const own = function (group: Element, selector: string): Element[] {
    const found = group.querySelectorAll(selector);
    const mine: Element[] = [];
    for (let i = 0; i < found.length; i++) {
      if (found[i]!.closest('[data-cre8-switch]') === group) mine.push(found[i]!);
    }
    return mine;
  };

  /** Roles and pairing: fixed for the life of the page, so done once. */
  const upgrade = function (group: Element): void {
    if (!group.hasAttribute('data-cre8-tabs')) return;
    const key = group.getAttribute('data-cre8-switch') || '';
    // Quiet setters are excluded here rather than skipped inside the loop:
    // one of them landing first would make its parent the tab list.
    const tabs = own(group, '[data-cre8-set]:not([data-cre8-quiet])');
    if (!tabs.length) return;

    const list = tabs[0]!.parentElement;
    if (list) list.setAttribute('role', 'tablist');

    const paired: Record<string, boolean> = {};
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i]!;
      const value = tab.getAttribute('data-cre8-set') || '';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('id', 'cre8t-' + key + '-' + value);
      // A tab is selected, not pressed, and saying both is worse than saying
      // one — so the toggle's attribute comes off.
      tab.removeAttribute('aria-pressed');

      // The first case holding this value is its panel. Later ones are
      // ordinary content that happens to share the case, as a price does.
      //
      // Building a selector from a value read out of the DOM is only safe
      // because `slug()` narrowed it to letters, digits, `_` and `-` before it
      // was ever written — the same guarantee that lets the generator put it
      // in a stylesheet.
      // `:not([data-cre8-not])` because an "isn't" condition answers to this
      // value by *hiding*, which makes it the opposite of the panel.
      const panels = own(group, '[data-cre8-case~="' + value + '"]:not([data-cre8-not])');
      const panel = paired[value] ? null : panels[0];
      if (!panel) continue;
      paired[value] = true;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('id', 'cre8p-' + key + '-' + value);
      panel.setAttribute('aria-labelledby', 'cre8t-' + key + '-' + value);
      tab.setAttribute('aria-controls', 'cre8p-' + key + '-' + value);
      // A panel with nothing focusable inside it is unreachable by keyboard,
      // so it becomes the stop itself. One with a link already has one.
      if (!panel.querySelector('a[href], button, input, select, textarea, [tabindex]')) {
        panel.setAttribute('tabindex', '0');
      }
    }
  };

  /** Everything that changes when the value does. */
  const sync = function (group: Element): void {
    const value = group.getAttribute('data-cre8-value') || '';
    const isTabs = group.hasAttribute('data-cre8-tabs');
    const setters = own(group, '[data-cre8-set]');
    for (let i = 0; i < setters.length; i++) {
      const setter = setters[i]!;
      if (setter.hasAttribute('data-cre8-quiet')) continue;
      const on = setter.getAttribute('data-cre8-set') === value;
      if (isTabs) {
        setter.setAttribute('aria-selected', on ? 'true' : 'false');
        // Roving tabindex: a tab set is one stop, and the arrow keys move
        // within it. Without this, Tab walks through every tab in turn.
        setter.setAttribute('tabindex', on ? '0' : '-1');
      } else {
        setter.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  };

  const groups = root.querySelectorAll('[data-cre8-switch]');
  for (let g = 0; g < groups.length; g++) {
    upgrade(groups[g]!);
    sync(groups[g]!);
  }

  if (!live) return function () {};

  const choose = function (group: Element, setter: Element): void {
    group.setAttribute('data-cre8-value', setter.getAttribute('data-cre8-set') || '');
    sync(group);
  };

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
    choose(group, setter);
  };

  const onKeyDown = function (event: Event): void {
    const key = (event as KeyboardEvent).key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    const target = event.target as Element | null;
    if (!target || !target.closest) return;
    const setter = target.closest('[data-cre8-set]');
    if (!setter) return;
    const group = setter.closest('[data-cre8-switch]');
    if (!group || !group.hasAttribute('data-cre8-tabs')) return;

    const tabs = own(group, '[data-cre8-set]:not([data-cre8-quiet])');
    const at = tabs.indexOf(setter);
    if (at < 0) return;
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? tabs.length - 1
          : (at + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;

    event.preventDefault();
    // Activated on arrival rather than on Enter. Showing a panel here costs a
    // class flip, so making someone press twice buys nothing.
    choose(group, tabs[next]!);
    (tabs[next] as HTMLElement).focus();
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  return function () {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
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
