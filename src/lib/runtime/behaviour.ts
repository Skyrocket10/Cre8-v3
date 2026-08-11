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
 * That discipline is not only about what is written here. A bundler will
 * *insert* module-scope references given the chance: esbuild's name-keeping
 * rewrites `function own() {}` into that plus `__name(own, "own")`, and
 * `__name` exists only inside the bundle. It shipped that way for exactly one
 * afternoon — see `keep_names` in `wrangler.jsonc`, and the three checks in
 * `tests/render/worker-publish.mjs` that now refuse it.
 *
 * The constants below exist for the *rest of the codebase* to import. They are
 * deliberately not used inside `behaviourRuntime`, and the render suite drives
 * a real published page so that a mistake here fails a test rather than a
 * visitor.
 *
 * ## Why it declares its own DOM types
 *
 * The publisher that embeds this string also runs in a Cloudflare Worker,
 * where there is no DOM lib — and where the ambient name `Element` is already
 * taken by `HTMLRewriter`, which is a different thing with different members.
 * Borrowing ambient names would make this file mean two different things on
 * two platforms, and the alternative — giving the Worker the DOM lib — is
 * worse than it sounds: it wins over `@cloudflare/workers-types`, so the
 * Worker's own `Request`, `Response` and `FormData` would silently become the
 * browser's.
 *
 * So the runtime names the handful of members it actually touches. Real DOM
 * nodes satisfy these structurally, so every call site still passes a
 * `Document` or an `HTMLElement` and gets checked.
 */

/** The DOM this runtime touches, named so it means the same thing everywhere. */
interface Tagged {
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelector(selectors: string): Tagged | null;
  querySelectorAll(selectors: string): ArrayLike<Tagged>;
  closest(selectors: string): Tagged | null;
  readonly parentElement: Tagged | null;
  focus?(): void;
  /** Present on the form controls that drive a continuous value. */
  readonly value?: string;
  /** Where a continuous value is written. Absent on anything that is not an element. */
  readonly style?: { setProperty(name: string, value: string): void };
}

/** What the runtime is mounted on: the page, or the editor's frame. */
interface Host {
  querySelectorAll(selectors: string): ArrayLike<Tagged>;
  addEventListener(type: string, handler: (event: Fired) => void): void;
  removeEventListener(type: string, handler: (event: Fired) => void): void;
}

/** The two events it listens for, and the only members it reads off them. */
interface Fired {
  readonly target: unknown;
  readonly key?: string;
  preventDefault(): void;
}

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
 * A value that is a *number* rather than a name.
 *
 * The switch is a state machine over named values, and it is the right shape
 * for almost everything a page does — a pricing toggle, a tab set, a filter.
 * It has nothing to hold a divider dragged across a photograph, and no amount
 * of composing named states produces one: a hundred positions would be a
 * hundred cases and a hundred rules.
 *
 * So: one more attribute, and the same discipline. The group carries the
 * number as a **custom property written into the markup**, which means the
 * page has a position before any script runs — a before/after comparison with
 * scripting off is simply one frozen at whatever split the designer chose,
 * rather than broken. CSS reads it with `var()` and does all of the drawing;
 * the runtime's whole job is to write a new number when the control moves.
 *
 * The control is a native `<input type="range">`, and that is the point rather
 * than a shortcut. Keyboard, touch, screen-reader announcement, `step`, and
 * the value surviving a form submission all come from the platform, for free,
 * and correctly. A bespoke pointer-drag would be a hundred lines here to
 * reimplement four of those badly. Same reasoning as `[popover]`, `<dialog>`
 * and `role="switch"` elsewhere in the library.
 *
 * The number is written **unscaled**. A slider with `min=0 max=100` gives a
 * percentage; one with `min=0 max=20` gives a blur radius. Normalising here
 * would throw away the second and buy nothing for the first — the designer's
 * `min` and `max` already say what the number means.
 */
export const RANGE_ATTR = 'data-cre8-range';
/** The control that moves it. Names the group it belongs to. */
export const DRIVE_ATTR = 'data-cre8-drive';
/** The custom property a continuous value lands in: `--cre8-<key>`. */
export const RANGE_VAR_PREFIX = '--cre8-';

/**
 * Which entry of the shared Test table this element's rules are.
 *
 * The node id, so every row of a repeater points at one entry. Putting the
 * rules on the element instead would copy the Test per row, which is the size
 * failure the repeater constraint exists to prevent.
 */
export const TEST_ATTR = 'data-cre8-test';
/**
 * The record values this instance's Tests read. Raw, never formatted.
 *
 * Per instance, and only the fields a Test actually reads — which means they
 * are public. That is part of the published contract rather than an
 * implementation detail, and the inspector says so before anybody ships it.
 */
export const VALUES_ATTR = 'data-cre8-vals';
/**
 * What the state is when no Test holds.
 *
 * Also what is in `data-cre8-value` when the file is written, so a visitor
 * with no scripting sees it and keeps it. The runtime needs it as well as the
 * live attribute, because once it writes the first answer the original is gone.
 */
export const ELSE_ATTR = 'data-cre8-else';

/* --------------------------------------------------------------------------
 * The Test shapes, named here so this file still compiles alone
 *
 * Structurally the document's own `Test`, `TestLiteral` and `StateRule`. Named
 * again rather than imported for the reason the DOM is: this function is
 * serialised with `toString()` and must reference nothing outside itself.
 * Types are erased, so these cost nothing at runtime — and the static suite
 * drives the real function against the real evaluator, which is what actually
 * holds the two in step.
 * ----------------------------------------------------------------------- */

/** A value a record field or a form control can hold. */
type TestRaw = string | number | boolean | null | undefined;
/** The record values one element publishes, keyed by field. */
type TestValues = Record<string, TestRaw>;
type TestOperand = { kind: string; key?: string; name?: string };
interface TestNode {
  kind: string;
  tests?: TestNode[];
  left?: TestOperand;
  op?: string;
  right?: { type: string; value: string | number | boolean };
}
/** One assignment: when this holds, the state becomes that. */
export interface RuntimeRule {
  when: TestNode;
  value: string;
}
/** Every node's rules, keyed by the node they belong to. Shared across rows. */
export type TestTable = Record<string, RuntimeRule[]>;

/* --------------------------------------------------------------------------
 * Tests, and why the comparison exists twice
 *
 * The one piece of this runtime that evaluates rather than relays. Phase B
 * folds a Test whose operands are all record fields, so nothing arrives here
 * unless something on the page can change after it was published — today, what
 * somebody has typed into a form control.
 *
 * Three things keep it small. The Tests are the same AST the editor stores,
 * serialised verbatim, so there is no compile step to get wrong on one side.
 * The table is shared, keyed by the node the rules belong to, so a hundred
 * repeated cards reference one entry and carry only their own values. And the
 * answer is a state, so everything downstream is the switch machinery that was
 * already here.
 *
 * There is a second implementation of the comparison in `renderer/test.ts` and
 * there has to be: this function is serialised with `toString()` and can import
 * nothing. That is a real drift risk, so the static suite drives this exact
 * function over a matrix of held values, operators and operands and asserts it
 * agrees with the other one case for case — including fractions, which were
 * missing the first time and let a runtime that rounded its operand agree with
 * the publisher on nine hundred comparisons.
 *
 * Everything inside the function is terse on purpose. `toString()` keeps
 * comments, so prose written in there is bytes on every visitor’s page.
 * ----------------------------------------------------------------------- */

/**
 * @param root  Document on a published page, the frame element in the editor.
 * @param live  False on the canvas: state is chosen in the inspector, and a
 *              click there is someone trying to select the element, not
 *              trying to use it.
 * @returns A disposer, for surfaces that unmount.
 */
export function behaviourRuntime(root: Host, live: boolean): () => void {
  /** Descendants belonging to this group rather than to one nested inside. */
  function own(group: Tagged, selector: string): Tagged[] {
    const found = group.querySelectorAll(selector);
    const mine: Tagged[] = [];
    for (let i = 0; i < found.length; i++) {
      if (found[i]!.closest('[data-cre8-switch]') === group) mine.push(found[i]!);
    }
    return mine;
  }

  /** Roles and pairing: fixed for the life of the page, so done once. */
  function upgrade(group: Tagged): void {
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
  }

  /** Everything that changes when the value does. */
  function sync(group: Tagged): void {
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
  }

  /**
   * Push a continuous control's number onto the group it drives.
   *
   * The group already carries the number as an inline custom property — the
   * renderer put it there, which is what makes the page look right before any
   * of this runs. This is only what keeps it true afterwards.
   */
  function drive(control: Tagged): void {
    const key = control.getAttribute('data-cre8-drive') || '';
    if (!key) return;
    // Built from a value read out of the DOM, which is safe for exactly the
    // reason the tab pairing above is: `slug()` narrowed it to letters,
    // digits, `_` and `-` before it was ever written.
    const group = control.closest('[data-cre8-range="' + key + '"]');
    if (!group || !group.style) return;
    group.style.setProperty('--cre8-' + key, control.value || '0');
  }

  const groups = root.querySelectorAll('[data-cre8-switch]');
  for (let g = 0; g < groups.length; g++) {
    upgrade(groups[g]!);
    sync(groups[g]!);
  }

  // Run in both modes, and before the `live` gate. A browser restores form
  // control values on a back-navigation without telling anybody, so a slider
  // can arrive already moved while the group still says what was published.
  const controls = root.querySelectorAll('[data-cre8-drive]');
  for (let c = 0; c < controls.length; c++) drive(controls[c]!);

  if (!live) return function () {};

  function onInput(event: Fired): void {
    const target = event.target as Tagged | null;
    if (!target || !target.closest) return;
    const control = target.closest('[data-cre8-drive]');
    if (control) drive(control);
  }

  function choose(group: Tagged, setter: Tagged): void {
    group.setAttribute('data-cre8-value', setter.getAttribute('data-cre8-set') || '');
    sync(group);
  }

  function onClick(event: Fired): void {
    const target = event.target as Tagged | null;
    if (!target || !target.closest) return;
    const setter = target.closest('[data-cre8-set]');
    if (!setter) return;
    const group = setter.closest('[data-cre8-switch]');
    if (!group) return;
    // A setter is a `<button>`, so this is only belt and braces — but a
    // designer can put one inside a form, where the default is a submit.
    event.preventDefault();
    choose(group, setter);
  }

  function onKeyDown(event: Fired): void {
    const key = event.key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    const target = event.target as Tagged | null;
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
    tabs[next]!.focus?.();
  }

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  // `input` rather than `change`: a range fires `change` when the drag ends,
  // and a comparison slider that only moves on release is not a comparison
  // slider. Arrow keys fire both, so this covers the keyboard too.
  root.addEventListener('input', onInput);
  return function () {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('input', onInput);
  };
}

/**
 * @param root  Document on a published page, the frame element in the editor.
 * @param live  Whether to keep answering as somebody types. False on the
 *              canvas, where nothing is typed and the first answer is the
 *              shipped one.
 * @param tests Every unfolded rule on the page, keyed by node.
 * @returns A disposer, for surfaces that unmount.
 */
export function testRuntime(root: Host, live: boolean, tests: TestTable): () => void {
  function operand(left: TestOperand, holder: Tagged, values: TestValues): TestRaw {
    const key = left.key || '';
    if (left.kind === 'field') return key in values ? values[key] : undefined;
    if (left.kind !== 'input') return undefined;
    const control = holder.querySelector('[name="' + left.name + '"]');
    if (!control) return undefined;
    return control.value === undefined ? '' : control.value;
  }

  function holds(test: TestNode, holder: Tagged, values: TestValues): boolean | null {
    const kind = test.kind;
    if (kind === 'every' || kind === 'some') {
      const list = test.tests || [];
      let unknown = false;
      for (let i = 0; i < list.length; i++) {
        const verdict = holds(list[i]!, holder, values);
        if (kind === 'every' && verdict === false) return false;
        if (kind === 'some' && verdict === true) return true;
        if (verdict === null) unknown = true;
      }
      return unknown ? null : kind === 'every';
    }
    if (kind !== 'compare' || !test.left || !test.op) return null;

    const raw = operand(test.left, holder, values);
    const op = test.op;
    // A control that is not there is not an empty one.
    if (test.left.kind === 'input' && raw === undefined) return null;
    const absent = raw === null || raw === undefined || raw === '';
    if (op === 'empty') return absent;
    if (op === 'notEmpty') return !absent;
    if (raw === undefined) return null;

    const right = test.right;
    if (!right) return null;
    if (right.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return null;
      const to = right.value as number;
      if (op === 'eq') return n === to;
      if (op === 'neq') return n !== to;
      if (op === 'gt') return n > to;
      if (op === 'gte') return n >= to;
      if (op === 'lt') return n < to;
      if (op === 'lte') return n <= to;
      return null;
    }
    if (right.type === 'boolean') {
      if (typeof raw !== 'boolean') return null;
      if (op === 'eq') return raw === right.value;
      if (op === 'neq') return raw !== right.value;
      return null;
    }
    const text = absent ? '' : String(raw);
    const want = String(right.value);
    if (op === 'eq') return text === want;
    if (op === 'neq') return text !== want;
    if (op === 'contains') return text.toLowerCase().indexOf(want.toLowerCase()) >= 0;
    return null;
  }

  function resolve(): void {
    if (!tests) return;
    const holders = root.querySelectorAll('[data-cre8-test]');
    for (let i = 0; i < holders.length; i++) {
      const holder = holders[i]!;
      const rules = tests[holder.getAttribute('data-cre8-test') || ''];
      if (!rules) continue;

      let values: TestValues = {};
      const packed = holder.getAttribute('data-cre8-vals');
      if (packed) {
        try {
          values = JSON.parse(packed) as TestValues;
        } catch (error) {
          values = {};
        }
      }

      let chosen: string | null = null;
      for (let r = 0; r < rules.length; r++) {
        if (holds(rules[r]!.when, holder, values) === true) chosen = rules[r]!.value;
      }
      const settled = chosen === null ? holder.getAttribute('data-cre8-else') || '' : chosen;
      // No `sync` here. That keeps `aria-pressed` honest on the controls that
      // *set* a state, and a state decided by a Test has none — nothing clicks
      // it, so there is nothing to announce as pressed.
      holder.setAttribute('data-cre8-value', settled);
    }
  }

  resolve();
  if (!live) return function () {};

  function onChanged(): void {
    resolve();
  }

  root.addEventListener('input', onChanged);
  root.addEventListener('change', onChanged);
  return function () {
    root.removeEventListener('input', onChanged);
    root.removeEventListener('change', onChanged);
  };
}

/** The Test runtime as a string, with this page's rules baked into the call. */
export function testRuntimeSource(tests: TestTable): string {
  return `(${testRuntime.toString()})(document,true,${serialise(tests)})`;
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

/**
 * JSON that is safe between `<script>` tags.
 *
 * `</script>` inside a string ends the element wherever the parser finds it,
 * including in the middle of a quoted value — so the `<` is escaped. The other
 * two are line separators, which are valid in JSON strings and not in
 * JavaScript ones, and would be a syntax error on somebody's live site.
 */
function serialise(tests: TestTable): string {
  return JSON.stringify(tests)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
