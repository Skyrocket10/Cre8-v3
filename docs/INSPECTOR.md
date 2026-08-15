# The inspector: Appearance, Conditions, Events

The model this panel should be built on, what is already true of it, and what
is not.

> **Every element has Appearance, Conditions and Events. Appearance defines
> what the element is and how it looks. Conditions define conditional changes
> to Appearance. Events trigger Actions. Expressions provide the dynamic
> values and decisions used throughout.**

That is Bubble's model, and it is the part of Bubble worth copying. Not the
chrome — the claim that an element has three things and that anywhere a value
is wanted, a value can be *constructed*.

This document is the audit, the design and the stages. It is written after
`docs/VALUES.md` E1–E11, which built the expression system the whole thing
rests on, and it exists because that system now has three consumers and only
one of them can reach it.

---

## 1. What is already true

Rule by rule, with the evidence. This matters more than the plan: half of the
architecture is built, and a plan that re-proposed it would waste the half that
works and hide the half that does not.

### Rule 7 — one shared expression system ✔

There is one `Value`, one `Test`, one resolver (`document/schedule.ts`), one
runtime evaluator, and one sentence builder. `VALUES.md` §3.4 records the
consumers; E10 made the last of them use it.

### Rule 8 — values are chains ✔

`Value = Head & { steps?: Step[] }`. Seven heads, seventeen steps, and a chain
resolves the same way on the canvas, in the file and in the browser.

### Rule 9 — the type controls the next step ✔

`document/steps.ts`, E8. The offer at each position comes from the type in hand
*at that position*, folded through the steps before it.

### Rule 10 — the sentence UI ✔

`components/ui/sentence.tsx`. Chips in a line, no modal composer.

### Rule 4 — conditions change appearance ◑

`StyleRule` is `when: Test` → `apply: StyleDecl`, which is exactly this, and
X1–X4 made every condition shape reachable. **But there are three mechanisms in
this space, not one**, and the user-visible consequence is real:

| Want | Cre8 today |
|---|---|
| When hovered, background blue | `rules` — one hop |
| When `status = "sold"`, background red | `rules` — one hop |
| When `status = "sold"`, **content** "Sold" | `assign` sets a state, then a **variant** overrides the prop — two hops |
| When `status = "sold"`, **hidden** | the same two hops |

`apply` is a `StyleDecl`. It cannot touch content, and it cannot hide anything
except through `display`. So Rule 4's own examples — *Content → "Sold"*,
*Visibility → visible* — take a state and a variant, which is a mechanism a
designer has to learn in order to say a sentence they can already say for a
colour. **This is the largest structural gap in the document.**

### Rule 5 — events trigger actions ◑

`NodeEventBinding { event, actions }` and a registry (`document/events.ts`).
The architecture is universal and the section is on every element — there is no
`applies` gate on `actions`, so Rule 1 already holds for it. What is missing is
the *table*: `EVENTS` has one entry, `onClick`. `onSubmit` is recorded in
`INTERACTIONS.md` §5.1 and not built. So the shape is right and the vocabulary
is one word long.

### Rule 1 — every element has the same core capabilities ◑

True of the mechanisms, not of the panel. `rules` and `actions` apply to every
element. But the panel's groups are **Appearance, Arrangement, Behaviour,
Motion, Advanced** — five, and none of them is Conditions or Events. A designer
reading it does not learn the model, because the model is not what it says.

### Rule 2 — content is part of Appearance ✘

Content is in **Data**, a section that only appears when the project has
collections and this element is in scope of one. So the sentence that fills a
heading lives in a section named after the database, next to the repeater. Rule
2 says it is an Appearance property, and it is right.

### Rule 3 — appearance properties can be dynamic ◑

The most interesting row, because the answer is *half, and the half that works
is disguised*.

- **Content props** take a `Binding`, which is a `Value` and a `Format`. Text,
  `src`, `href`, `alt` — all dynamic. ✔
- **Style props** do not take a `Value` at all. What exists instead is
  `ValueVar`: a number, mapped from one span onto another, published as a
  custom property that any style field can reference as `var(--cre8-…)`.

`ValueVar` is not a workaround — it is the *only* design that survives §2's
third constraint (below). But it is presented as a section called "Numbers on a
scale" rather than as an affordance on the property, so a designer who wants
`Opacity → ⟨Score⟩` has to know to go somewhere else, name a variable, and
paste a `var()` reference into the opacity field. Every part of that works. No
part of it says what Rule 3 says.

### Rule 6 — action arguments can be dynamic ✘

`NodeAction`'s arguments are strings and refs: `to?: string`, `ref: Ref`,
`text?: string`. `only?: Test` is the one dynamic part (X7). So
`Navigate → ⟨Current Record → slug⟩` cannot be written. Links to a record's own
page work, but through the route resolver rather than through an expression,
which means the capability exists for exactly one argument of exactly one verb.

### Summary

| Rule | | |
|---|---|---|
| 7, 8, 9, 10 | the expression system | ✔ built, E1–E11 |
| 4 | conditions change appearance | ◑ styles in one hop, content and visibility in two |
| 5 | events trigger actions | ◑ shape universal, vocabulary one word |
| 1 | every element the same | ◑ true of the model, not of the panel |
| 2 | content is Appearance | ✘ content is in Data |
| 3 | properties are dynamic | ◑ content yes, style through a named variable |
| 6 | action arguments dynamic | ✘ strings |

---

## 2. What must survive

Constraints this design may not break. Each was paid for.

1. **CSS must not scale with rows.** A hundred cards are a hundred attribute
   values and one stylesheet. This is the constraint that decides Rule 3: a
   style property whose expression resolved per row would be a rule per row.
   `ValueVar`'s custom property is the shape that satisfies both.
2. **Editor ≈ Preview ≈ Published**, through one renderer. Anything the panel
   can say has to say the same thing on all three.
3. **Fold or subscribe is derived, never chosen.** `foldable()` decides where a
   thing runs by asking what it reads.
4. **The runtime is serialised with `toString()`** and is paid for per page,
   not per use. Every branch it grows ships to every page carrying an
   unfoldable test — `VALUES.md` §5.6 states the budget rule.
5. **Nothing runs in the browser that can be answered when the page is
   published.** A visitor with no scripting gets a correct page.
6. **No modal expression composer.** `EXPRESSIONS.md` §5, and E1–E11 held it.

---

## 3. The design

### 3.1 Three groups, and the residue named

The panel's groups become **Appearance**, **Conditions**, **Events**. Every
section declares which of the three it is, and the mapping is:

| Group | Sections |
|---|---|
| **Appearance** | Content, Layout, Size, Spacing, Placement, Typography, Background, Border, Shadow & blur, Animation, Transition, Semantics, Custom CSS |
| **Conditions** | States & conditions, Switch |
| **Events** | When pressed, Link |

Two placements are arguable and are argued here rather than left to look
obvious:

- **Switch is a Condition, not an Appearance.** Declaring the states an element
  can be in is not how it looks; it is the vocabulary its conditions test. A
  designer opening Conditions to ask "what can this be, and how does it look in
  each" should find both halves in one place.
- **Link is an Event.** X8 already made the press list the home for verbs, and
  `href` is the *compiled* form of "go somewhere when pressed" rather than a
  separate idea. That it compiles to markup with no script is an implementation
  triumph, not a second category.

And the residue, which the three groups genuinely do not cover:

- **Data (repeat)** — "there is one of this per record" is not appearance,
  condition or event. It is how many of the element there are.
- **Component** — which properties an instance may change. A contract between
  a master and its instances.
- **Continuous value** — a number a control publishes for its descendants.

These stay, in a fourth group. Three groups is a claim about what an element
*is, looks like and does*; it was never a claim that nothing else exists, and
filing "Repeat over Essays" under Appearance to keep the count at three would
be tidier and untrue.

### 3.2 A property that can read

Rule 3, delivered through the mechanism that already satisfies constraint 1.

The affordance moves to the property. A style field grows the same chevron a
comparison's operand has, and picking from it writes a `ValueVar` and points
the property at it — so the designer sees:

```
Opacity   [ ⟨Score⟩ ÷ ⟨100⟩ ]
```

and the document holds what it holds today: a var on the node, a `var(--…)` in
the declaration, one rule in the stylesheet and a custom property per row. The
panel stops being where the mechanism is explained and becomes where the
sentence is written.

**What this is not.** It is not an expression *evaluated per row into CSS*.
Constraint 1 forbids that and nothing here proposes it.

### 3.3 One condition, not three mechanisms

Rule 4's gap. `StyleRule.apply` is a `StyleDecl`; it should be able to carry
what a variant can carry — content props and visibility — so that

> when `status` is `"sold"` → Content → "Sold"

is one row in Conditions rather than a state plus a variant.

The mechanism underneath does not have to change: a comparison in a style rule
already mints an attribute (X4), and a variant already overrides props. What
changes is that the panel writes both from one sentence, and that the
*condition* is the thing a designer edits rather than the state in between.

This is the largest stage and the one most likely to reveal that the two
mechanisms cannot in fact be joined without a third. It is staged last for that
reason.

### 3.4 The events table earns a second row

Rule 5. `EVENTS` has one entry. `onSubmit` is the next, `INTERACTIONS.md` §5.1
has the design, and the registry was built (X6) so that adding one is a table
entry rather than a mechanism.

### 3.5 Action arguments are expressions

Rule 6. `NodeAction`'s string arguments become `Value`s where a value is
meaningful — a destination, a copied string, a state's new value. The chain
editor already renders on a comparison's operand (E8); an action argument is
the same chip in a different sentence.

---

## 4. What this deliberately does not do

- **No Current User.** A published Cre8 site is a static file on a CDN. There
  is no session, so there is no user, and a chip reading `Current User → Email`
  would be a promise the file cannot keep. `VALUES.md` §4 settles this and this
  document does not reopen it. Every `Current User` example in the brief maps
  to either a record field or a form control, and where it maps to neither it
  is genuinely not available.
- **No expression evaluated per row into a stylesheet.** Constraint 1.
- **No modal composer.** Constraint 6.
- **No second expression system for actions.** Rule 7 is the whole point.

---

## 5. Stages

Each independently shippable, each with the check that must fail against the
unfixed code.

| | | Falsified by |
|---|---|---|
| **A1** ✔ | Three groups, and the residue named | Every element offers Appearance, Conditions and Events; a section with no group is a build error |
| **A2** | Content moves into Appearance | Bind a heading without opening a section named after the database |
| **A3** | A style property can read a value | `Opacity → ⟨Score⟩ ÷ ⟨100⟩` written on the property, one rule in the stylesheet, a different number per row |
| **A4** | Action arguments are expressions | `Navigate → ⟨Record → slug⟩`, published, with no script |
| **A5** | `onSubmit`, and the events table proves it is a table | Two events on one element, each with its own actions |
| **A6** | One condition, not three mechanisms | "When sold → Content: Sold" as one row, and the state-plus-variant spelling still renders |

### 5.1 What A1 turned out to cost — a rename that was not one

Five groups became four: **Appearance, Conditions, Events, Declares**. Cheap in
lines and not cheap in what it settles, because filing every section forced
three placements to be argued rather than assumed.

**The audit was better news than expected on Rule 1.** Neither `rules` nor
`actions` has an `applies` gate — Conditions and Events were already on every
element, and the panel simply never said so. The check pins *that* rather than
the words: an `applies` on either is what breaking the model looks like, and
the mutation that adds one turns it red.

**Two placements are arguments, not filing.** Switch is a Condition because
declaring the states an element can be in is the vocabulary its conditions
test, not how it looks. Link is an Event because X8 already made the press list
the home for verbs and `href` is the compiled form of one — that it needs no
script is an implementation triumph rather than a second category.

**And the residue is named.** A repeat, a component contract and a published
number are none of the three. Three groups is a claim about what an element
*is, looks like and does*; it was never a claim that nothing else exists, and
filing "Repeat over Essays" under Appearance to keep the count at three would
be tidier and untrue. `Declares` is what an element hands to everything else.

Nothing published moved — this is the panel's vocabulary, not the document's.

---

## 6. Open questions

**Does A6 join two mechanisms or add a third?** `StyleRule.apply` and a
variant's prop overrides are different shapes — one is a declaration block, the
other is a props patch — and the honest possibility is that one sentence
writing both produces a third representation that has to be kept in step with
the two. If that is what it turns out to be, the answer is to say so and stop,
not to ship a unification that is a fork.

**Should `ValueVar` survive its own panel?** A3 makes the property the place
where a scale is written. If nothing then needs the section, it should go —
but a var is shared by every property that references it, and a panel is where
a shared thing is named. Answered by building A3 and looking.
