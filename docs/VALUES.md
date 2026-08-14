# Cre8 — values

An audit of what a value can be in this system, and a plan for the one that
replaces it. Written the way `INTERACTIONS.md` was: to be argued against before
any of it is built.

The finding that shapes the whole plan, up front: **a value here is a leaf, and
in Bubble it is a chain.** Everything Cre8 cannot say follows from that one
structural fact, and nothing else about the two systems is far apart — the
scheduling, the formatting, the sentence UI and the repeater are all in place
and all of them generalise to a chain without changing shape.

So this is not a proposal to catch up on features. It is a proposal to change
`Value` from a leaf into a list, and to notice that the expensive half of what
that unlocks is free.

---

## 1. The audit

### 1.1 A value is one leaf, and nothing composes

```ts
export type Value =
  | { kind: 'field'; key: string }      // a field of the record in scope
  | { kind: 'input'; name: string }     // a named control inside this node
  | { kind: 'element'; ref: Ref };      // a control anywhere on the page
```

Three leaves. There is no case for *a value derived from another value*, so
there is nowhere to put arithmetic, rounding, text joining, or following a
reference. `Format` looks like it fills the gap and does not: it is a terminal
decoration applied on the way to the DOM, one per binding, never an input to
anything.

### 1.2 A comparison cannot have a value on its right — closed by E1

```ts
| { kind: 'compare'; left: Value; op: CompareOp; right?: TestLiteral }
```

`right` was a **literal**. So "when Price is over 500000" was sayable and

> when **Price** is over **Budget**

was not — two fields of one record could not be compared, at all, anywhere in
the product. The cheapest gap in the document and the most obviously missing:
no new evaluator, no new runtime and no new UI, only the same type on both
sides of the operator. §5.1 records what it actually cost, which was one more
thing than that.

### 1.3 A reference is declared and cannot be followed

`Field` has `type: 'reference'` and a `collection` naming what it points at.
Nothing reads it. A post has an author; a page cannot say the author's name,
because there is no step that turns *a reference* into *the record it names*
and no step that then takes a field of it.

This is the one that decides whether a person can build a real site. Every
content site is two collections and a pointer between them.

### 1.4 There are no lists

A repeater draws rows and `RecordFilter` narrows which. But a *value* is never
a list, so nothing can say how many there are, take the first, or read a field
off it. "3 comments", "Latest post's title", "Posts by this author" — none of
them.

### 1.5 What Bubble does that this cannot, as tasks

| | Bubble | Cre8 today |
|---|---|---|
| Show a field | `Current cell's Post's Title` | ✔ |
| Format it | `:formatted as 1,000.00` | ✔ |
| Compare a field to a number | conditional | ✔ |
| Compare two fields | `Price > Budget` | ✔ **E1** |
| **Follow a reference** | `Post's Author's Name` | ✘ declared, unreadable |
| **Arithmetic** | `Price × Quantity` | ✘ |
| **Round, then use it** | `:rounded to 0` | ✘ formatting is terminal |
| **Count a list** | `:count` | ✘ |
| **First / last of a list** | `:first item` | ✘ |
| **Filter a list inline** | `:filtered` | repeater only, not a value |
| **Join text** | `First & " " & Last` | ✘ |
| Current User | `Current User's Email` | ✘ **and stays ✘** — see §4 |

Nine of eleven when this was written, and eight of the nine were the same
missing idea. E1 closed the first — and closed it by making both operands one
type, which is the same idea, arriving one member at a time.

---

## 2. What must survive

Constraints this design may not break. Each was earned.

1. **Fold or subscribe is derived, never chosen.** `foldable()` decides where a
   thing runs by asking what it reads. No designer picks, and no panel picks.
2. **The runtime is serialised with `toString()`** and may not reference module
   scope. Every branch it grows ships to every page that needs it.
3. **CSS must not scale with rows.** A hundred cards are a hundred attribute
   values and one stylesheet.
4. **Three answers.** `true`, `false`, and `null` for *cannot decide here*.
5. **A sentence of chips, and no modal composer.** `EXPRESSIONS.md` §5 calls
   Bubble's expression editor "the worst part of Bubble". The surface stays a
   line of chips somebody reads left to right.
6. **A published page is a static file.** Whatever this becomes, it resolves at
   publish or in thirty lines of runtime, and it is correct with scripting off.

---

## 3. The plan

One sentence: **a value becomes a head and a list of steps, and the list is
what keeps it a sentence.**

```ts
type Value = { head: Head; steps?: Step[] };
```

### 3.1 Why a list and not a tree

A tree needs brackets. Brackets need a composer, and a composer is the thing
§5 refuses. A **chain** — source, then step, then step — is a list, and a list
of chips read left to right is exactly the sentence this panel already draws:

> ⟨Price⟩ ⟨× ⟨Quantity⟩⟩ ⟨rounded to ⟨0⟩⟩ ⟨as currency⟩

Bubble's expressions are chains for the same reason, and it is the one part of
its expression model that is genuinely good. Nesting appears only where a step
*takes* a value — `× ⟨Quantity⟩` — and that operand is itself a chain, rendered
as a chip that opens one. One level, the same rule the condition tree already
follows.

### 3.2 The head

```ts
type Head =
  | { kind: 'field'; key: string }             // as today
  | { kind: 'input'; name: string }            // as today
  | { kind: 'element'; ref: Ref }              // as today
  | ({ kind: 'literal' } & TestLiteral)        // E1 — a constant
  | { kind: 'records'; collection: string };   // new — a list
```

`literal` is what makes `compare.right` a `Value` rather than a special case:
a constant is a chain of length zero over a literal head. One type on both
sides of every operator, and §1.2 closes without a new mechanism.

Flattened rather than nested — `{ kind, type, value }`, not
`{ kind, value: { type, value } }`, which is what this proposed. The nesting
reads better and is not idempotent: a migration that recognises its own output
by shape has to be able to run twice, and `{ kind: 'literal', value: <the
literal> }` wraps a second time on the second pass. The flat form is
`TestLiteral` with a tag on it, so `right.type` and `right.value` keep meaning
what they meant in both evaluators and the migration is a no-op the second
time by construction.

`records` is the list head. It is the only new *source*, and everything in §1.4
is a step over it.

### 3.3 The steps, and which ones are free

```ts
type Step =
  // record → record, record → value
  | { op: 'follow'; field: string }             // a reference → what it names
  | { op: 'field'; key: string }                // that record's field
  // list → value, list → list
  | { op: 'count' }
  | { op: 'first' | 'last' }
  | { op: 'where'; test: Test }
  | { op: 'sortedBy'; field: string; desc?: boolean }
  // number → number
  | { op: 'plus' | 'minus' | 'times' | 'over'; by: Value }
  | { op: 'round'; places: number }
  // text → text
  | { op: 'upper' | 'lower' | 'capitalize' }
  | { op: 'truncate'; chars: number }
  | { op: 'join'; with: Value };
```

**And here is the argument that makes the whole thing affordable.**

`foldable(value)` generalises with no new idea: a chain folds when its head
folds and every operand of every step folds. `field`, `literal` and `records`
fold; `input` and `element` do not. So:

- A chain over a **record** always folds. It runs in the publisher, costs zero
  bytes, and produces a string in the markup.
- A chain over a **control** travels — and the head of a travelling chain is a
  single scalar from a form field.

Which means **the expensive half of the vocabulary is free by construction.**
`follow`, `field`, `count`, `first`, `where`, `sortedBy` can only ever appear
over a record or a list, and a record is publish-time data. They can never
appear in a travelling chain, so `testRuntime` never needs a branch for any of
them. What the runtime must learn is arithmetic, rounding and the text steps —
the small half — and only because somebody might type into a box and compare
against the result.

That is not a happy accident. It is the same rule that made X4's minted
attributes cheap, applied to a bigger vocabulary, and it is the reason this
plan is affordable at all.

### 3.4 What each surface does with it

Nothing changes shape:

| Surface | Today | After |
|---|---|---|
| `Binding` | `{ value, format }` | unchanged — `value` is richer |
| `Test.compare` | `left: Value, right: TestLiteral` | `right: Value` |
| `ValueVar` | `{ value, from, to }` | unchanged |
| `StateRule.when` | `Test` | unchanged |
| `NodeAction.only` | `Test` | unchanged |

Every consumer of `Value` gets the whole vocabulary by doing nothing, which is
what makes this a change to one type rather than a change to a product.

### 3.5 The sentence

`testSentence` already renders a source chip, an operator chip and an operand.
A chain adds one chip per step and a `+` at the end, exactly as the condition
tree adds `+ and`. A step that takes a value renders its operand as a nested
chip — the same `clause` part the group grammar already uses.

The two things the panel must not do, both learned this month:

- **No frozen operands.** Every part of a chain is a chip. X17 lost the whole
  `referrer` and `query.*` vocabulary to one `kind: 'word'`.
- **Offer only what the head can do.** A `follow` on a text field is a step
  that compiles and can never resolve — the same failure as offering "Ticked"
  on a `div`. The step menu is generated from the head's type.

---

## 4. What this deliberately does not do

- **No Current User.** A published Cre8 site is a static file on a CDN. There
  is no session, so there is no user, and a chip that read `Current User's
  Email` would be a promise the file cannot keep. This is a real limit of the
  hosting model rather than a gap in the value model, and it is worth stating
  plainly rather than half-building.
- **No writes, no server-side workflows.** `INTERACTIONS.md` §5 draws that line
  and this does not move it. Values are read.
- **No searches across the site at runtime.** A `records` head resolves at
  publish, against the records the page was built with. "Do a search for" as a
  *live* query needs a server on the request path, which is the same line.
- **No unlimited nesting.** A step's operand may be a chain; that chain's steps
  may not take chains of their own. One level, as the condition tree does.

---

## 5. Stages

Each independently shippable, each with the check that must fail against the
unfixed code.

| | | Falsified by |
|---|---|---|
| **E1** ✔ | `compare.right` becomes a `Value`; a `literal` head | Compare two fields of one record and see the rule apply on one row and not another. A literal-only model cannot express the rule at all |
| **E2** | `Value` becomes `{ head, steps }`, `foldable` and both evaluators walk it — **zero steps defined** | Publish all ten templates: byte-identical. The migration is the whole of it |
| **E3** | `follow` and `field`: a reference is readable | A post's author's name on the page. Falsified by deleting the author record and seeing the binding fall back rather than print an id |
| **E4** | The list head and `count`, `first`, `last` | "3 comments" from a real collection, and 0 when there are none — the empty case is the one that reads as broken |
| **E5** | Arithmetic and `round`, in both evaluators | The same sum on the canvas and in the file, and a comparison against a typed number answered in the browser |
| **E6** | `where` and `sortedBy` | A filtered count that differs from the unfiltered one, on the same page |
| **E7** | Text steps and `join` | And the runtime budget argument for each, stated before the number moves |
| **E8** | The step menu, generated from the head's type | Offer a step the head cannot do and watch it never resolve |

**E2 is the one that matters and the one to be most careful about.** It changes
the shape of every `Value` in every stored document while changing nothing
about what any of them mean, which is exactly the class of change
`publish-dump.mjs` exists for: ten templates, byte-identical, or the migration
is wrong.

### 5.1 What E1 turned out to cost

Built. `tests/render/values.mjs` drives the panel and reads the published
file: pick the field from the When… menu, change the operator through its
chip, point the value chip at another field through the chevron inside it, and
one of two listings **with the same price** comes out painted. Sixteen static
checks, fourteen of them falsified one mutation at a time.

Four things are worth writing down, because three of them were not in the plan
above and one of them changes E2.

**The wire stopped being the document, and that is the seam E2 needs.**
`testTable` put the stored `Test` straight into the page — the two types
coincided by coincidence, not by design. `kind: 'literal'` is the first thing a
`Value` carries that the browser does not read, so `lowerTest` now takes it
back off on the way out. Ten templates published **byte-identical**, which is
the whole argument: the model got wider and no page got longer. E2 lowers a
`{head, steps}` the same way, and its byte gate means something because this
seam exists.

**Both evaluators grew the same four lines, not two implementations.** The
right operand resolves through the same `operand()` the left has always used,
and the type the comparison is made in comes from the right — declared when
somebody typed the value, and otherwise whatever it turned out to hold. A
differential over 900-odd literal comparisons and 42 field-against-field ones
holds them together.

**Two live controls can be compared, which was not asked for and is nearly
free.** "Confirm matches Password" is the one comparison that genuinely cannot
fold, and it fell out of making `right` a `Value` rather than being built.

**Three walks read `left` alone and all three were wrong the moment `right`
existed** — `fieldsRead` (so `publishedValues` would have shipped a field
short, and the runtime would have answered `null` for ever), `inputsRead`, and
`refsInTest` (so a reference on the right would have been invisible to
integrity). They are now one `operandsIn` derived three ways, which is the
`content-props.ts` move: two lists kept in step by nobody drift, silently.

---

## 6. The first thing to argue about

E1 is free and closes the audit's cheapest row, so it is not the interesting
question. The interesting question is whether §3.3 is right that the list and
reference steps never travel.

They never travel *today*, because a `records` head reads the records the page
was published with. If a later stage ever wants a list that changes after
publish — a search box filtering a client-side list — that assumption breaks,
the runtime grows a list evaluator, and the byte argument in §3.3 goes with it.

So the question to settle before E4 is not "should lists exist" but **"is a
list allowed to be live?"** This plan says no, and says it early, because the
answer decides how much of the vocabulary is free.
