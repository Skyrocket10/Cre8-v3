# Expressions — design

**Status: phase A is built. B, C and D are design.** This file was written
before any of the code, so the constraints existed first, and it is being
converted section by section as each phase lands. Everything marked *design* is
an agreement rather than a description — assume nothing in those sections is
true of the running product yet.

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

### A — Binding *(built)*

```
Record → Value → Format → prop
```

```
{{ product.name }}
{{ product.price }}
{{ product.price | format: currency }}
```

Publish-time. No runtime. `bind` was `Record<string, string>` — a prop to a
field name — and is now a prop to a `Binding`: a `Value`, and optionally a
`Format`.

**The format is not part of the value, and that is the whole design.** The rule
the interaction model states — *comparisons always use raw values, `format` is
forbidden inside a comparison operand* — is not written down anywhere and
checked for. It is arranged so it cannot be said. `Format` hangs off `Binding`,
one level above `Value`, and every expression that compares anything takes a
`Value`. A formatted operand is not refused; it cannot be spelled.

Six formats, and every one of them is longhand:

| | |
|---|---|
| `number` | decimals, thousands grouping |
| `currency` | symbol, side, decimals, grouping |
| `percent` | appends `%`; does not multiply, because scaling is arithmetic and arithmetic is D |
| `date` | five patterns, English month names |
| `case` | upper, lower, capitalise |
| `truncate` | cut at a word, then an ellipsis |

No `Intl`, no `toLocaleString`, no local time zone, no locale data of any kind.
This is not stylistic. Formatting runs on the canvas *and* inside the Worker,
and D3's gate is that the two produce identical bytes — `Intl` renders the same
currency with U+00A0 on one ICU version and U+202F on the next, so a page
published by the Worker and the same page drawn on the canvas would differ by a
character nobody can see and every diff would show. Dates are taken apart with
a regular expression rather than handed to `Date` for the same reason: the
canvas runs in the designer's time zone and the Worker runs in UTC, so anything
zone-sensitive disagrees for several hours a day, and only for records written
late in the evening.

The cost is real and worth naming: dates read in English, and a currency is a
symbol somebody types rather than a code looked up in a table. Locales are a
model, and a model is worth having properly rather than faking with whichever
ICU build happened to be linked in.

What is offered where is a table rather than a judgement — a number can be
currency, a date cannot, `richtext` gets nothing because every transform would
cut a tag in half, and `src` and `href` get nothing because there is no reading
of "the image URL in title case" that is not a broken image.

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

## Execution model

```
Test is always the same semantic rule.

At publish time we inspect its dependencies:

  All dependencies known at publish   → fold the Test
  Any runtime dependency              → publish the runtime Test + required fallback
  Record changes                      → republish / re-fold affected Tests
  User or input changes               → runtime subscription evaluates the Test
  Two Tests on one state key          → deterministic rule order
```

Scheduling is derived from dependencies. It is not an author-selected mode.

### Folding

A Test whose inputs are all known at publish time is evaluated once and its
resulting state emitted directly. No interpreter ships, no values are published,
and the output is identical to what runtime evaluation would have produced.

This is an optimisation of *execution*, not a second kind of rule. It does not
change what a Test is, which is the distinction that matters: the earlier
proposal — inferring from an expression's inputs whether it was content or
behaviour — was rejected because it changed the *kind* of the thing. This does
not. Same rule, same state, same CSS, same result.

It is safe against staleness because a record write already republishes.

Three consequences worth stating, because each is a way to get it wrong:

**Folding must be pure and stable.** Same inputs, same bytes, every time.
Publishing is diffed — a second publish with no change writes nothing — and a
fold that varied would make every republish rewrite every page. The `republish`
suite already asserts the no-op case, so this is checked by something that
exists.

**Folding runs on the canvas too.** The canvas has no publish step; it draws
against the design record. A records-only Test must therefore be folded live in
the editor, by the same function the publisher calls. One evaluator, three
surfaces — the same rule as the renderer.

**Folding is per instance; the resulting CSS is shared.** In a repeater the fold
runs per row and yields a state attribute per row. The generated rule is one
rule for all of them. That is the repeater constraint restated, and it is where
this design fails if it is going to.

### Mixed dependencies

A Test that reads both a record field and an input value has a runtime
dependency, so it is published rather than folded. The record operand is
published as a raw data attribute on the instance and the Test is serialised
once, shared by every row.

The alternative — substituting the record operand into the Test as a literal —
was considered and rejected: it duplicates the Test per row, which is the size
failure the repeater rule exists to prevent. It discloses the same value either
way, so there is nothing to choose between them but bytes.

### What an unfolded Test publishes

Raw values, never formatted, on the element that owns the rule, per repeated
instance, and only the fields a Test actually reads.

That dependency is part of the published contract. If the source carries
`data-price="750000"`, the price is public. Choosing between hiding a sold house
and greying it out is a choice about what the published application exposes, and
the editor must show it rather than treat it as an implementation detail.

### Scripting off

Required, not optional. A Test with any runtime dependency cannot execute with
scripting disabled, so the author must declare the state the output falls back
to — the same `Ships as` concept the data conditions already use for "what a
visitor sees before the page resolves it, and for ever with no scripting".

Folded Tests need nothing: their answer is already in the file.

An interaction with no answer for a scripting-off visitor is an interaction that
has not been finished, and the editor should refuse to consider it complete.

### The write key

A Test assigns a value to a named state key. The key is the identity of the
target state, not of the Test — two Tests may legitimately target one key.

**Conflicting writes are resolved by deterministic rule order. The editor warns
about provable overlap rather than prohibiting it.** Later Tests win. This is
how `node.rules` already works — "a list rather than a record because two rules
can both match and both set `background`, and the only precedence a designer can
predict is the order" — and an interaction writing a state key is the same
situation, so it gets the same answer.

Mutual exclusion was the alternative, and it is what the static suite already
does for `set`. It works there because it operates over *named values*, where
overlap is trivially decidable. Ordered comparisons are not: `price > 500000`
and `status = "sold"` read different fields and can obviously both hold, so a
strict exclusion rule would refuse a reasonable pair. Refusing what cannot be
proven unsafe would block more valid designs than it saved.

So overlap is a warning, and it is a warning with a burden of proof on the
editor. It fires only where overlap can be *shown* — the same field, comparable
operands, ranges that intersect — and it says which Test wins rather than asking
the author to resolve it. Where overlap cannot be decided, the editor says
nothing: a warning that fires on every pair of Tests is a warning nobody reads.

## Checks that would hold this up

Each of these is falsifiable, which is the bar the rest of the suite is held to.

- ~~**`format` never appears inside a comparison operand.**~~ Not written: it
  would be vacuous, and a vacuous check is worse than none. `Format` is not
  reachable from a `Value`, so there is no document that could fail it. What is
  checked instead is the structure that makes it true — that `formatValue` has
  exactly one caller, the function that writes a record into a prop, and that
  the record itself is unchanged afterwards. The day a Test formats an operand,
  those are what notice.
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
- **Two Tests on one key resolve in order.** Author an overlapping pair, assert
  the later one wins, then swap them and assert the state flips. A check that
  only ever sees one ordering cannot tell order from luck.
- **The overlap warning fires, and stays quiet.** Both directions, because a
  warning that always fires and a warning that never fires both look like a
  passing test: a provable pair must produce it, and a pair on different fields
  must not.

---

## Migration

`bind: Record<string, string>` → `Record<string, Binding>`; a bare string
becomes `{ value: { kind: 'field', key } }`. *(Done.)* One level deeper than
this file originally said, because the format needed somewhere to live that a
`Value` could not reach.

`when: Condition[]` → `Test`; a list becomes an `every` of the existing kinds.
*(Not done.)*

Both are mechanical, and `migrateDocument` already recognises documents by shape
rather than by a version field, and is checked for being safe to run twice.

The bare string also survives as authoring shorthand — `bind: { text: 'title' }`
in a `NodeSpec` still means what it did — so the factory and the migration go
through one function that knows both spellings. `boundProps` calls it too, which
is not defensiveness: reading `.value.key` off a string is a thrown TypeError
rather than a wrong pixel, and it takes down the canvas, the page or a publish.
That was found by a check that crashed rather than failed.
