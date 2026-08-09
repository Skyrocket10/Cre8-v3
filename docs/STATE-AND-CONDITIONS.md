# Cre8 — state and conditions

A design for one mechanism where there are currently four, written to be
argued against before any of it is built.

---

## 1. The duplication that already exists

Four features in the codebase today compile to the same shape and are
implemented separately:

| Stored as | Compiles to |
|---|---|
| `states.hover` | `.c-id:hover { … }` |
| `states.backdrop` | `.c-id::backdrop { … }` |
| `states.pressed` | `[data-cre8-switch="k"][data-cre8-value~="v"] .c-id { … }` |
| `readVisibility()` | `[data-cre8-switch="k"]:not([data-cre8-value~="v"]) .c-id { display: none }` |

The bottom two are the same sentence — *when a state holds a value, apply
these declarations* — written twice, once with the declarations open and once
with them hard-coded to `display: none`. `pressed` was not designed as a
general mechanism; it fell out of needing a selected tab to look selected, and
it is a general mechanism anyway.

So this document is not proposing a new layer on top of a working design. It
is proposing to notice that the design is already there, name it, and delete
the special cases. Done properly it should be a **net reduction** in
`css.ts`, `element-model.ts` and the inspector.

The reason to do it now rather than later is that the storage migration is the
risky part, and it is far cheaper before there are documents in the wild than
after.

---

## 2. The model

One primitive: **when this is true, apply that.**

```ts
/** Something that has to hold for a rule to apply. */
export type Condition =
  /** Evaluated by the browser, free: :hover, :active, :focus-visible. */
  | { kind: 'pointer'; pseudo: 'hover' | 'active' | 'focus' | 'focus-visible' }
  /** Also pseudo-classes, but about a control's own state. */
  | { kind: 'control'; pseudo: 'checked' | 'disabled' | 'invalid' | 'placeholder-shown' }
  /** A named state on this node or an ancestor. `key` empty = the nearest. */
  | { kind: 'state'; key: string; op: 'is' | 'isNot'; values: string[] }
  /** An attribute on the element itself — aria-selected, aria-expanded. */
  | { kind: 'attr'; name: string; op: 'is' | 'isNot'; values: string[] }
  /** RESERVED for stage 3. Resolved by the runtime into a `state`. */
  | { kind: 'data'; source: string; op: DataOp; value: string };

/** Which box the declarations land on. Absent = the element itself. */
export type Part = 'backdrop' | 'placeholder' | 'marker' | 'selection';

export interface StyleRule {
  id: string;
  /** All must hold. Empty means unconditional — see §4 on why that is legal. */
  when: Condition[];
  part?: Part;
  /** Style overrides. */
  apply?: StyleDecl;
  /** Prop overrides — text, src, href, alt. Stage 2; see §5. */
  set?: NodeProps;
  /** Scope to one breakpoint. Absent = every breakpoint. */
  breakpoint?: Breakpoint;
}
```

On the node:

```ts
interface SceneNode {
  styles: ResponsiveStyles;   // unchanged — the base layer
  rules?: StyleRule[];        // replaces `states`
  …
}
```

### Why `part` is separate from `when`

`::backdrop` is not a condition. It does not say *when* the declarations
apply, it says *which box they land on* — and the two compose: `:hover` on the
backdrop of an open dialog is `.c-id:hover::backdrop`. Folding a pseudo-element
into the condition list, which is what `states.backdrop` does today, makes that
combination unrepresentable and makes the generator branch on a member of a
union that means something different from its siblings.

### Why the list is ordered

Two rules can both match and both set `background`. Something has to decide,
and the only answer a designer can predict is **the order they are in**. A
record keyed by state name — which is what `states` is — cannot express order,
which is why this is a list and why every rule carries an `id`.

---

## 3. What becomes what

| Today | Becomes |
|---|---|
| `states.hover` | `{ when: [{ kind: 'pointer', pseudo: 'hover' }], apply }` |
| `states.active`, `states.focus` | same, different `pseudo` |
| `states.backdrop` | `{ when: [], part: 'backdrop', apply }` |
| `states.pressed` on a node with `switchSet: v` | `{ when: [{ kind: 'state', key: '', op: 'is', values: [v] }], apply }` |
| `whenIs` / `whenState` / `whenNot` | `{ when: [{ kind: 'state', key, op: inverted, values }], apply: { display: 'none' } }` |
| `hideMode: 'keep'` | the same, with `apply: { visibility: 'hidden' }` |
| `switchCase` (legacy) | via `readVisibility()`, as above |

Note the inversion on the last three. Today the stored form is the *intent*
("shown when annual") and the generator negates it. In the new model the
stored form is the *literal* ("when not annual, display none") and the
inspector presents the intent. One storage shape, no ambiguity in the
generator, and a rule whose only declaration is `display: none` renders in the
panel as **Hidden** rather than as a raw declaration.

### What stays a prop

State *declaration* is structural, not presentational, so it stays where it
is: `switchKey`, `switchDefault`, `switchDesign`, `switchRole` on the owner,
`switchSet` and `switchQuiet` on a control. Renaming those is cosmetic churn
and this document does not propose it.

---

## 4. Generating the CSS

Each rule becomes one selector plus its declarations. The three parts:

```
<state conditions>  <element> <pseudo-classes> <part>
```

- **state / data conditions** are ancestor matches, so they prefix:
  `[data-cre8-switch="k"][data-cre8-value~="v"] ` — or, when the state's owner
  *is* this node, they join the compound instead, which is what makes a
  dismissible banner possible;
- **pointer, control and attr conditions** join the element's compound:
  `.c-id:hover`, `.c-id[aria-selected="true"]`;
- **`part`** appends: `::backdrop`.

`isNot` on a state is `:is([…],[…])`; `is` is a chain of `:not()`. `:is()`
takes the highest specificity of its arguments, so both forms weigh the same
and neither can out-rank the other by accident.

### Specificity, and the bug in the current design

Today a visibility rule lands at (0,3,0) and a hover rule at (0,2,0), so a
state rule silently beats a hover rule whatever order they are written in.
Nobody has hit it because the two rarely collide, and they will collide
constantly once both live in the same panel and look like peers.

The fix is to make every rule weigh the same and let order decide:

```css
.c-id:where(:hover) { … }
:where([data-cre8-switch="k"][data-cre8-value~="v"]) .c-id { … }
```

`:where()` contributes nothing, so both are (0,1,0) — the same as the node's
base rule. Emission order then becomes the whole of precedence:

```
base  →  responsive (@media / @container)  →  rules, in authored order
```

Which means a rule beats a breakpoint override. That is a choice rather than a
law, and it is defensible: *later wins, and the panel shows you the order.* A
rule that should only apply at one width carries `breakpoint` and is emitted
inside that block, after the unscoped ones.

### The one thing not settled

`@layer` would express all of this directly — `@layer base, responsive, rules`
— and is universally supported now. The reason this document does not simply
specify it: the canvas renders inside the editor app, whose Tailwind preflight
lives in `@layer base`, and **unlayered rules beat layered ones regardless of
specificity**. Moving document rules into layers means either moving the
document reset in with them or having the reset out-rank everything. Both are
knowable in an afternoon and neither is guesswork worth doing in prose.

**Recommendation: build stage 1 with the `:where()` padding**, which is what
works today made uniform, and measure `@layer` separately. Do not block the
refactor on it.

---

## 5. Content, and where the architecture forks

This is the part of the proposal that is not like the others, and it deserves
a decision rather than an implementation.

Style overrides compile to CSS. **Content overrides cannot.** `content:` works
only on pseudo-elements: not selectable, not reliably in the accessibility
tree, not indexed. So conditional text has exactly two implementations:

**Two elements with opposite conditions.** What the pricing block does today —
both prices in the markup, a rule hides one. No script, indexed, correct when
printed, no flash.

**Runtime text swapping.** The alternatives live in a data blob and a script
writes `textContent`. A crawler sees the default only, and the page stops
being honest without JavaScript.

The rule this document proposes:

> **Alternatives known at publish time expand into elements.**
> **Values not known until runtime are written by the runtime.**

Which maps exactly onto the static/dynamic split the product already has, and
keeps every property the no-JavaScript test asserts.

The designer never sees the duplication. The document holds one node with
`set` on its rules; **the publisher expands it** into one element per rule plus
the base, each carrying the matching condition.

### The combinatorial cost, and the constraint that removes it

If two `set` rules can match at once, the expansion needs "show element *i*
when rule *i* matches and no later `set` rule does", and the number of
generated conditions grows with the square of the rules.

Proposed constraint: **`set` rules on one node must be mutually exclusive** —
in practice, conditions on the same state with disjoint values. A static check
enforces it, the expansion stays linear, and the escape hatch for the rare
genuine case is to nest an element and put the second condition there.

Varying one string by two independent states at once is rare enough that
paying for it everywhere is the wrong trade.

### Attributes

`set` is `NodeProps`, so `href`, `src`, `alt` and `label` need no new
vocabulary — they are the props the renderer already reads. Same expansion,
same constraint.

---

## 6. Data conditions

Stage 3, and the reason the layering above is worth getting right.

```
condition  →  state  →  CSS / DOM effect
```

A data condition does not get its own rendering path. It resolves — in the
runtime, or at the edge — to a value written into a state attribute, and from
there it is indistinguishable from a switch. `user.isLoggedIn` becomes
`data-cre8-value="yes"` on the page root; every selector, every rule and every
line of the generator stays exactly as it was.

If stage 1 is built correctly, **stage 3 requires no change to the state
engine at all**. That is the test of whether the layering is right, and it is
worth stating now so it can be checked later.

### The problem it introduces

Today there is no flash of wrong state, because the state is baked into the
HTML — that is what the scripting-disabled test asserts. A data condition
resolved on the client breaks that: the page paints with the default and
corrects itself.

Three answers, none free:

- **resolve at the edge** — the Worker fills the attribute before the HTML is
  sent, which keeps the property and gives up full-page CDN caching;
- **accept the flash** for chrome that is genuinely per-user (a "Welcome back"
  line), and forbid it for layout;
- **render both and let CSS choose**, which works for booleans and not for
  values.

This document does not pick one. It records that the choice exists, belongs
with the data layer, and must not be made by accident.

### Variables in text

`"Welcome, {user.name}"` is templating, and templating is substitution, not
CSS. Same rule as content: substituted at publish when the value is known
then (a CMS record), by the runtime when it is not (the signed-in user).

---

## 7. The editor

The panel becomes one list, and the mental model is one sentence the user
already has — *when hovered, change the background* — extended to states they
name themselves.

```
Styles
  Base
    Layout · Typography · Appearance · …

  States & conditions            [+ Add]
    ▸ Hover                       Background, Transform
    ▸ When plan is Pro            Background, Text
    ▸ When menu is Open           Hidden
```

Adding a rule asks two things: **when**, then **what changes** — Style, Text,
Image, Link, Hidden, Attributes. Rules drag to reorder, because order is
precedence and precedence should be something you can see.

Two consequences worth designing for rather than discovering:

- **Selecting a rule changes what the whole inspector edits.** Picking "When
  plan is Pro" and then typing in the Background field writes to that rule.
  That is how the breakpoint and state switchers already work, so it is a
  familiar mode rather than a new one — but with an arbitrary number of modes
  it needs to be much louder about which one is active than the current tinted
  strip.
- **A rule whose condition cannot be satisfied on the canvas hides its own
  contents**, which is the problem the switch already hit. Reveal-on-select
  and the `All` view generalise to any state; the "Editing" control becomes
  per-state and belongs next to the state's declaration rather than in the
  rule list.

---

## 8. What this deletes

Worth listing, because a refactor that only adds is usually the wrong one.

- `StyleState`, `StateStyles`, `PSEUDO_ELEMENT_STATES`, `SWITCH_STATES` — one
  union and two exception lists, replaced by one condition type;
- the `pressed` branch in `switchRules`, and the `SWITCH_STATES` skip in
  `rulesFor`;
- `whenState` / `whenIs` / `whenNot` / `hideMode` as props, and
  `readVisibility` with them — after migration it survives only as the
  document-version upgrade, renamed `readLegacyVisibility` so that being its
  second caller has to be a decision;
- the `styleState` field on the store and its two sticky-state guards, which
  become "which rule is selected";
- `VisibilitySection` and the state switcher in the inspector header, replaced
  by one list. What is left of the section is the "Switches to" control, which
  survives because putting a state into a value is not a style change and does
  not belong in a list of them.

---

## 9. Staging

| Stage | Scope | Gate | |
|---|---|---|---|
| **1** | The rule model, the generator, migration at document load, the panel. Everything above except `set`. | Every existing block renders byte-identically, and the whole render suite passes untouched. | **landed** |
| **2** | `set` — content and attributes — with publish-time expansion and the mutual-exclusion check. | A block that varies its text by state publishes both strings, indexed, with no script. | |
| **3** | Data conditions and `{variables}`, with the data layer. | The state engine is not modified. | |

Stage 1 is about the size of the switch itself. Its gate is deliberately
strict: a refactor that changes output is a rewrite wearing a refactor's
clothes, and the block sweep already compares 512 rendered checks against the
canvas, so "byte-identical" is measurable rather than aspirational.

### What the gate actually held to

Rendering is byte-identical and the suite passes — but four assertions in
`tests/render/behaviour.mjs` had to be rewritten, and it is worth being
precise about which, because "the tests needed changing" is how a regression
gets waved through.

All four asserted on the **text of a generated selector**, and the selector
text changed on purpose: `:where()` padding is the whole point of §4, and
`:not(:is(a,b))` replaces chained `:not(a):not(b)` because chained negations
each add specificity — a card answering to two values would have out-ranked
one answering to a single value, for no reason a designer could see. Every
assertion about *what a visitor sees* passed untouched, including the two that
compare the canvas against the published page.

One assertion was added rather than changed, and it is the one that now holds
the property the other three used to imply by accident: strip the `:where()`
groups out of every conditional selector on a published page, and what is left
must be the node's class alone. That fails the moment a condition is emitted
unpadded, which is the regression that would quietly make order stop being
precedence.

### Migration

`DOCUMENT_VERSION` is currently written into every document and never read.
Stage 1 needs it read: bump to `2`, add `migrateDocument(doc)` called on load
in one place, and have it fold `states` and the `when*` props into `rules`.
Documents at version 2 skip it. The blocks are code and migrate at source.

---

## 10. Deliberately not doing

**OR between conditions.** Multiple conditions compound for free in CSS
(`[a][b] .c`). OR is two rules, and `:is()` is there if something ever
justifies it. Shipping AND only keeps both the model and the panel honest.

**Rules that reach down and restyle descendants.** "When plan is Pro, restyle
these six things" would be one rule instead of six, and would make every
element's appearance depend on rules stored somewhere else in the tree. Six
rules is more typing and vastly more debuggable, and it is what keeps selector
generation a single line.

**Renaming the switch props.** `switchKey` and friends describe state
declaration, which this document does not change. Renaming them would put
churn in the same commit as a behaviour change, and the two should be
separable when something goes wrong.

---

## 11. Open questions

1. **`@layer` or `:where()` padding** (§4). Recommendation is to ship the
   padding and measure layers separately, because the interaction with the
   editor's Tailwind preflight is the unknown.
2. **Does a rule beat a breakpoint override?** This document says yes, on
   source order. The alternative — breakpoints outrank states — is arguable
   and would need the panel to say so.
3. **How loud does the "editing a rule" mode need to be?** The current tinted
   strip is adequate for two modes and probably not for eight.
4. **Where does the per-state "Editing" control live** once states are no
   longer synonymous with switches? Next to the declaration is the answer this
   document assumes, but it has not been drawn.
