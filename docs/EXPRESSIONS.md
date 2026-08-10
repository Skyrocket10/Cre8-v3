# Expressions — design

**Status: design, not built.** Nothing in this file describes how Cre8 behaves
today. It is the agreed shape for data binding and interactions, written down
before the code so the constraints exist first. Everything else in `docs/` is
descriptive; this one is not.

---

## Two concepts, deliberately separate

**Data binding** resolves a record into a value when the page is rendered.
**Interaction** evaluates values in the browser and produces state.

They share a grammar and nothing else. The separation is the point: if one
system spanned both, the renderer would have to decide, per value, whether it
was looking at static content or at behaviour — and the two renderers could
answer differently. That is the failure the single-renderer rule exists to
prevent.

Which one you are authoring is decided by *where you author it*, never inferred
from what it references. A binding cannot reach a visitor source, because the
picker does not offer one.

| | Data binding | Interaction |
|---|---|---|
| Environment | record in scope, page params, site settings | declared values, input values, switch state, visitor sources |
| Resolved by | the renderer, on all three surfaces | the runtime, in the browser |
| Costs | nothing | bytes |
| Fails as | wrong text in the file | wrong behaviour on the page |

---

## Phases

### A — Binding

```
Record → Value
```

```
{{ product.name }}
{{ product.price }}
{{ product.price | format: currency }}
```

Publish-time. No runtime. Extends `bind`, which today is
`Record<string, string>` — a prop to a field name, with no transform step.

### B — Tests

```
Value → Test → State
```

```
price > 500000
price <= 500000

input.value = "yes"
input.value != ""

status = "sold"
```

B is the foundation. It establishes typed operands, raw values, comparison
operators, input values, field dependencies, repeater scoping, state
generation, and the ban on `format` inside comparisons.

**B is completely usable without dynamic CSS values**, which is why it goes
first:

```
WHEN price > 500000
→ state = expensive
```

The designer then styles the `expensive` state with the ordinary inspector, on
machinery that already exists.

### C — Dynamic assignment

```
WHEN price > 500000
→ opacity = 1
```

and eventually

```
WHEN price > 500000
→ opacity = someValue
```

C does not mean arbitrary JavaScript. It means:

```
Test
 ↓
State
 ↓
CSS declaration
```

where the right-hand side resolves to a permitted `Value`. The CSS compilation
model stays intact.

### D — Continuous values

```
price
 ↓
normalize
 ↓
--cre8-opacity
 ↓
opacity: var(--cre8-opacity)
```

Actual arithmetic and mapping. Deliberately separate from B and C.

---

## The interaction model

```
A rule consists of:

WHEN [Test]
DO   [Assignment]

Test:
    Evaluates typed values and produces a state.

Assignment:
    Applies a CSS property or assigns a state.

Runtime responsibility:
    - Read declared raw values
    - Evaluate Tests
    - Set state attributes

Runtime does NOT:
    - Know CSS properties
    - Calculate styles
    - Generate CSS
    - Execute arbitrary JavaScript
    - Target arbitrary elements

CSS responsibility:
    - Convert states into presentation
    - Apply CSS declarations
    - Handle all supported style properties

SCOPING:
    A rule evaluates against the node that owns it.
    Descendants may react to the resulting state.
    Arbitrary element targeting is deferred.

REPEATERS:
    Values and states are per repeated instance.
    Generated CSS is shared.
    CSS generation MUST NOT scale with row count.

VALUES:
    Comparisons always use raw values.
    Types are declared, never inferred.
    Formatted values are presentation-only.
    `format` is forbidden inside comparison operands.

CANVAS:
    Uses the same state/CSS machinery as published output.
    `switchDesign` selects the state shown in the canvas.
```

---

## What this maps onto

The rule shape already exists:

```ts
StyleRule { id, when: Condition[], part?, apply: StyleDecl, set?: NodeProps, breakpoint? }
```

`when` is the test, `apply` is property assignment, `set` is state assignment.
Two changes turn it into the model above:

- `when: Condition[]` → `when: Test`
- `apply: StyleDecl` gains `Value` on the right-hand side (phase C)

`Condition` becomes the CSS-compilable subset of `Test` — its five kinds keep
compiling to attribute selectors exactly as they do now, which is what resolves
them before first paint with no flash.

Hide and Show are not special actions. `display` and `visibility` are already
`StyleProp`s, so hiding is `apply: { display: 'none' }` under a generated rule:
a preset over the same assignment, with nothing new underneath it.

---

## Open points

Five things the model above does not yet answer. Each is written as the
question, then the recommendation.

### 1. May a Test that depends only on records be folded at publish?

`price > 500000` on a generated page has a known answer when the file is
written. Folding it means emitting the resulting state attribute directly and
shipping no interpreter, no `data-price`, and no bytes.

This is *not* the stage inference that was rejected earlier. That changed what
kind of thing a rule was; this changes only whether the interpreter has to run.
The rule is still an interaction, the state is still a state, the CSS is
identical, and the observable result is the same. It is the same class of move
as compiling a condition to a selector instead of evaluating it.

It holds because a record write already republishes the site, so a folded
answer cannot go stale.

**Recommendation: yes, and say so in the inspector** — a rule that folds should
be marked as costing nothing, because that is information the author wants.
A rule that cannot fold should say what makes it dynamic.

There is a second reason to want it: an unfolded Test publishes the values it
references into the HTML. A folded one publishes nothing.

### 2. What does an unfolded Test put in the page?

Raw values, never formatted ones, on the element that owns the rule — per
repeated instance. Only fields that a Test actually references.

**This must be visible in the editor.** Referencing a field in an interaction
makes that field's value readable in the published source. An author choosing
between "hide sold houses" and "grey out sold houses" is also choosing whether
the sold status is public, and should be told so plainly.

### 3. When do input-driven Tests run?

`input.value != ""` is not answerable at load; it is answerable on every input
event. The behaviour runtime already listens for `input` for continuous values,
so the hook exists — but it means B has two scheduling modes: evaluate once at
load, and evaluate on change.

**Recommendation: derive it from the sources, and only the sources.** Record
fields fold. Visitor sources evaluate once, before paint, as they already do.
Input values subscribe. No user-facing choice; it is a property of what the
Test reads.

### 4. What happens with no scripting?

The defining constraint, and the model above does not state its answer.

- Folded Tests: work perfectly. Nothing to run.
- Visitor-source Tests: already resolved in the head before paint.
- Input-driven Tests: cannot run. They need a **declared fallback state** —
  the same `Ships as` concept the data conditions already use for "what a
  visitor sees before the page resolves it, and for ever with no scripting".

**Recommendation: a fallback state is required, not optional**, for any rule
that cannot fold. An interaction with no answer for a scripting-off visitor is
an interaction that has not been finished.

### 5. Which state key does a Test write?

`state = expensive` assigns a value to a *named key*. Two Tests writing the same
key must be mutually exclusive or ordered, or the last one silently wins.

The static suite already checks mutual exclusion for `set`. **Recommendation:
Tests reuse that check**, and the editor refuses two rules on one key whose
conditions can both be true, in the same way.

Also undefined: what a Test does when it cannot be evaluated at all — a missing
field, a value that is not the declared type. **Recommendation: fall back to
the declared fallback state.** Never throw, never leave the attribute unset.

---

## Checks that would hold this up

Each of these is falsifiable, which is the bar the rest of the suite is held to.

- **`format` never appears inside a comparison operand.** A static walk of every
  Test in a document. Plant one and it must fail.
- **Comparison operands share a declared type.** `price > "sold"` is refused in
  the editor and refused by the document check.
- **Generated CSS does not scale with row count.** Publish a collection at 10
  and at 1000 records with one interaction on the card, and assert the
  stylesheet is byte-identical.
- **A folded rule ships no runtime and no data attribute.** Publish a page whose
  only interaction folds, and assert the behaviour script is absent.
- **Canvas, preview and published agree per state.** The same fixture rendered
  with the state true and false, compared element by element — the sweep the
  `fidelity` and `blocks` suites already do for everything else.
- **Scripting off lands on the fallback state.** The `behaviour` suite already
  runs every case with the script disabled; interactions join it.

---

## Migration

`bind: Record<string, string>` → `Record<string, Value>`; a bare string becomes
`{ kind: 'field', key }`. `when: Condition[]` → `Test`; a list becomes an
`every` of the existing kinds.

Both are mechanical, and `migrateDocument` already recognises documents by shape
rather than by a version field, and is checked for being safe to run twice.
