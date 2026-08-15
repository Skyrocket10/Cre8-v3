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

### 1.3 A reference is declared and cannot be followed — closed by E3

`Field` had `type: 'reference'` and a `collection` naming what it points at.
Nothing read it. A post had an author; a page could not say the author's name,
because there was no step that turned *a reference* into *the record it names*
and no step that then took a field of it.

This is the one that decides whether a person can build a real site. Every
content site is two collections and a pointer between them. §5.2 records what
it cost, including the two things that were wrong after the model was right.

### 1.4 There are no lists — closed by E4 and E6

A repeater drew rows and `RecordFilter` narrowed which. But a *value* was never
a list, so nothing could say how many there are, take the first, or read a
field off it.

E4 gives it a list head and three steps, so "3 comments" and "the latest post's
title" are sayable. E6 gives it `where` and `sortedBy`, which is the half that
matters in practice: "the comments **on this post**" is the shape of every
content site, and until a list could be narrowed the only honest thing the
panel could say was "in total".

### 1.5 What Bubble does that this cannot, as tasks

| | Bubble | Cre8 today |
|---|---|---|
| Show a field | `Current cell's Post's Title` | ✔ |
| Format it | `:formatted as 1,000.00` | ✔ |
| Compare a field to a number | conditional | ✔ |
| Compare two fields | `Price > Budget` | ✔ **E1** |
| Follow a reference | `Post's Author's Name` | ✔ **E3** |
| Arithmetic | `Price × Quantity` | ✔ **E5** |
| Round, then use it | `:rounded to 0` | ✔ **E5** |
| Count a list | `:count` | ✔ **E4** |
| First / last of a list | `:first item` | ✔ **E4** |
| **Filter a list inline** | `:filtered` | ✔ **E6** |
| **Sort a list inline** | `:sorted by` | ✔ **E6** |
| **Join text** | `First & " " & Last` | ✔ **E7** |
| **Change case, shorten** | `:uppercase`, `:truncated` | ✔ **E7** — mid-chain, not only as a format |
| **Format, then use it** | `:formatted as` inside an expression | ✔ **E9** |
| Current User | `Current User's Email` | ✘ **and stays ✘** — see §4 |

Nine of eleven were missing when this was written, and eight of the nine were
the same missing idea: a value could not be made out of another value. E1 to E7
closed all eight, one member of one type at a time, and the row that is still
✘ is the one that is a fact about the hosting model rather than a gap in the
expression model — see §4.

The two rows added since are the two that were being counted as one. "Filter a
list" and "sort a list" are separate steps and separate sentences, and so are
"join" and "change case": listing them together was how E6 and E7 each looked
like one row's worth of work and turned out to be two.

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
type Value = Head & { steps?: Step[] };
```

Written `{ head: Head; steps?: Step[] }` when this was planned, and built flat.
Same model — a head, then what happens to it — with one difference that turned
out to be the whole of stage E2: an existing `Value` is *already* a chain of
length zero, so nothing stored has to be rewritten. See §5.2.

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
  | { kind: 'records'; collection: string }    // E4 — a list
  | { kind: 'row'; key: string }               // E6 — the row a `where` is asking about
  | { kind: 'self' };                          // E6 — this record, as its id
```

The last two arrived with E6 and were not in this plan. `where` evaluates its
test once per candidate row, so *something* has to name that row — and the
alternative was to let `field` mean the row inside a `where` and the record in
scope everywhere else. That is one word doing two jobs, and it costs the
comparison the whole step exists for: `⟨the comment's Post⟩ is ⟨this Post⟩`
names two different records in one sentence, and cannot be written at all if
both sides spell them the same way. `self` is the other half of it, because a
reference holds an *id* and a record's id is not in its `data` — every field of
the record was sayable and the record itself was not.

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
is a step over it. Not built — it is E4, and §6 settles what it may assume.

### 3.3 The steps, and which ones are free

```ts
type Step =
  // record → record, record → value          — E3, built
  | { op: 'follow' }                            // an id → the record it names
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

One correction, from building E6. A `where` takes a *`Test`*, and a Test can
read a form control — "the products under ⟨what is typed⟩" — so `where` is the
second step whose operand can reach the runtime, alongside arithmetic. It is
not an exception to the rule above; it is the rule applied one level down, and
`foldableValue` asks `foldable(step.test)` exactly as it asks
`foldableValue(step.by)`. Such a chain does not fold and the runtime refuses
it, so both surfaces answer *undecidable* and the binding keeps its
design-time text. Nothing is shipped and nothing is guessed.

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

**That was false for one of them until E10, in two places at once.** A
`ValueVar`'s panel was a `Select` over number fields, and `varsFor` read
`record.data[key]` and skipped anything that was not a bare field. Nine stages
of vocabulary reached neither, and nothing noticed because the two halves
agreed: the panel could not write a chain, so the renderer never met one. See
§5.9 — "gets it by doing nothing" is a claim about a *type*, and it is worth
being clear that a type cannot make a panel offer anything.

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
| **E2** ✔ | `Value` gains `steps`, `foldable` and both evaluators walk it — **zero steps defined** | Publish all ten templates: byte-identical. The migration is the whole of it |
| **E3** ✔ | `follow` and `field`: a reference is readable | A post's author's name on the page. Falsified by deleting the author record and seeing the binding fall back rather than print an id |
| **E4** ✔ | The list head and `count`, `first`, `last` | "3 comments" from a real collection, and 0 when there are none — the empty case is the one that reads as broken |
| **E5** ✔ | Arithmetic and `round`, in both evaluators | The same sum on the canvas and in the file, and a comparison against a typed number answered in the browser |
| **E6** ✔ | `where` and `sortedBy` | A filtered count that differs from the unfiltered one, on the same page |
| **E7** ✔ | Text steps and `join` | And the runtime budget argument for each, stated before the number moves |
| **E8** ✔ | The step menu, generated from the head's type | Offer a step the head cannot do and watch it never resolve |
| **E9** ✔ | `formatted`: format, then use it | `£900,000.00 per month` on the page — a suffix on a formatted number, which a terminal format cannot produce |
| **E10** ✔ | Every place a `Value` lives can say one | Two rows at different opacities from one scale, when both rows have the same price |
| **E11** ✔ | The first page anybody sees says one | The essay index counts its own essays — the digit, not the word somebody typed |

**E9 was not in this table.** The plan stopped at E8, and the stage after it was
chosen from what the work had surfaced rather than from a list: E7 hit the
limit while building `join`, and §5.7 had already written down that reaching a
*formatted* value "is E9". Naming it here after the fact is the honest record —
the plan ran out one stage before the work did.

**E2 was the one to be most careful about, and then it turned out not to
exist.** The plan's `{ head, steps }` rewrites every `Value` in every stored
document; `Head & { steps? }` does not, because an existing `Value` is already
a chain of length zero. Same model, same evaluator, no migration, and
byte-identity by construction rather than by a migration being correct. The
flat form is also what keeps forty call sites reading `value.kind === 'field'`
correct without being touched. See §3.2.

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

### 5.2 What E2 and E3 turned out to cost

Built, and §1.3 is closed: a post can say its author's name. The chain is
authored in the panel — `Text reads ⟨Agent⟩ → ⟨Name⟩` — and
`tests/render/values.mjs` deletes the author record and watches the byline fall
back to what the designer typed, with the record id nowhere in the file.

**E2 evaporated, which was the best available outcome.** See the paragraph
above: the flat shape is the same model without the migration. Ten templates
byte-identical, again, with nothing to be careful about.

**`follow` takes no argument.** The plan had `{ op: 'follow'; field }`, and the
head already names the field the id came out of — so saying it twice would be
two places to keep in step. It needs no target collection either: record ids
are unique across a project, so following one is a lookup rather than a search,
and `Field.of` stays the editor's business.

**A chain is not scalar all the way down.** `Resolved` is `value | record`,
because `⟨Author⟩ → ⟨Name⟩` is a value, then a record, then a value. Saying so
in the type is what stops `follow` from pretending a record is a string, and it
is the shape E4 adds `list` to.

**The bug that took two rounds to find, and the reason it is worth writing
down.** Everything above passed while both surfaces printed the placeholder.
Nothing repeats the authors — a byline is not a list — so the only thing that
had ever asked for a collection's rows was a repeater pointing at it, and the
author's record was never *fetched*. The chain was correct; the data was not
there. `collectionsUsedBy` now takes the closure over reference fields, in the
browser publisher, the Worker and the canvas, from one function.

**And a leak, argued the wrong way round first.** `recordIndex` originally kept
unpublished rows, on the reasoning that a reference is not *showing* a record,
only reading one field of it. That is wrong in the direction that matters: a
profile kept unpublished because it is not ready would have its name published
by any post that pointed at it. Published-only, matching `recordsFor` — and
matching the Worker, which queries `published = 1` and would otherwise have
disagreed with the canvas.

### 5.3 What E4 turned out to cost

Built. A binding can say `How many Writers, in total`, and
`tests/render/values.mjs` checks it against an **empty** collection first —
which is the order it actually breaks in, because every other step answers
`null` for "nothing here" and a binding reads `null` as *leave the design-time
text alone*. A count that did the same would print "some writers" on a page
with none. Zero is an answer, and it is the only step in the vocabulary that
says so.

**§6's instruction, honoured concretely.** The list steps are in
`resolveValue` beside the record steps, and `foldableValue` is the *only* thing
that decides they do not travel — checked by a mutation that flips it and turns
five checks red. When a list is allowed to be live, that function is the one
place that changes; nothing else in the resolver knows.

**A chain is `value | record | list`.** The third member arrived exactly where
§5.2 predicted it would, which is the first time this plan has been ahead of
the code rather than behind it.

**Two more places gated on the wrong thing.** `boundProps` skipped anything
whose head was not a `field` — correct while a field was the only publish-time
head, and silently wrong for every count the day one was not. It asks
`foldableValue` now. And `collectionsUsedBy` grew a second reason to want a
collection: a count names one that nothing repeats, which is the same hole the
reference closure filled one head along, found the same way.

### 5.4 What E5 turned out to cost — 800 source bytes, 483 on a page

The first stage that makes the runtime grow, so the number comes first.
`testRuntime` is **7333 bytes** of source before E5 and **8133 after**: +800,
or +10.9%. That buys the whole travelling half of the arithmetic vocabulary —
four operators, rounding, and operands that are themselves chains.

**Those are source bytes, and E7 found that this section called them shipped
ones.** A page inlines the function out of a *minified* bundle, where the same
change is **2098 → 2581, +483**. Both numbers are real and only one of them is
paid by a visitor. The unit is corrected here rather than the history: the
measurements were right, the word "ships" was not. `wrangler.jsonc` already
made the distinction — "unminified that is about 3.9 KB … minified it is
2.3 KB" — which is exactly the kind of thing two places say differently until
somebody measures.

It was +1068 before the reasoning moved. The two paragraphs explaining *why*
the runtime refuses a step it cannot walk now sit above `testRuntime` rather
than inside it, on the argument that a comment inside a function serialised
with `toString()` is bytes on somebody's page. **That argument is false, and
the corrected unit is what shows it**: both publishers minify — the browser
through Next, the Worker through `"minify": true` — so comments are stripped
before either reads the source, and the 362 bytes were saved from a number
nobody pays. Above the function is still the better place for long prose; it
is a readability decision, not a budget one, and this file should stop
claiming otherwise.

**One spelling of a constant on the wire.** `bare` recurses into a step's
operand, so `⟨Price⟩ × ⟨3⟩` sends `{type,value}` rather than a tagged literal.
That started as a correctness fix and turned out not to be one — the runtime
reads a constant by its `type`, so a tagged one resolves fine — which the
falsification caught: the mutation produced no red. It is a size claim, it is
now checked as one, and the difference is seventeen bytes per operand on every
row of every page that ships a test.

**Rounding is a step, not a format.** §1.5's "round, then use it" was blocked
by `Format` being terminal by construction. `round` produces a number the next
step can read, which is what makes `(price ÷ rooms) rounded, × 12` sayable —
and it is `toFixed` underneath because that is specified to the digit, so the
Worker and the browser cannot disagree.

**Everything that has no answer says nothing.** Dividing by zero, arithmetic on
a word, a field that is not there: each has a plausible wrong answer that would
reach the page — `Infinity`, `NaN`, or the head's value with the step quietly
skipped — and each is `null` instead, so the binding falls back to what the
designer typed. That is four refusals in one check, and the mutation that
removes any of them turns it red.

### 5.5 What E6 turned out to cost — nothing at runtime, two heads at the model

**Zero bytes, and `runtime/behaviour.ts` is untouched** — not "the same size",
byte-for-byte the file E5 left. Neither step travels, and the runtime already
refuses a step it cannot walk, which is the branch E5 wrote for exactly this
reason. So `where` and `sortedBy` arrive answered or not at all. The ten
templates publish byte-identical for the fifth stage running.

**The model grew two heads, not one step's worth of plumbing.** §3.2 records
why: a `where` needs to name the row it is asking about, and the tempting
saving — reuse `field` and let it mean the row inside a filter — costs the
relational comparison the step exists for. `row` and `self` are what make
`⟨the comment's Post⟩ is ⟨this Post⟩` sayable, and everything else about them
falls out for free: both fold, both resolve to nothing where there is no row
and no record, and neither can be reached by accident because nothing binds a
`row` outside a `where`.

**The comparator had to move before `sortedBy` could exist.** A repeater's
order lived in `renderer/repeat.ts`, which already imports `document/schedule.ts`
— so the resolver could not import it back. `document/records.ts` is that order
given a home both can reach. This is not tidying: the two orders have to be the
*same* order, because a hero saying "the latest post" sits over a list sorted
the same way, and a comparator that agrees by coincidence is one with a
maintenance schedule. Checked by driving both paths over the same rows and
comparing both ends of the list, and falsified by a second comparator that
differs only in where it puts a row with the field unset.

**An undecidable row is left out.** `=== true`, not `!== false`. A comment with
no `status` does not pass "status is live" — and the wrong rule here has a
plausible-looking answer, which is why the check counts rows rather than
asserting a boolean.

**Two panel wordings changed, and one of them was a promise being kept.** E4
put "in total" in the *menu label* to stop "How many Comments" from implying a
relationship it could not express. A label cannot be taken back — "How many
Comments, in total, only when Post is this Post" contradicts itself in the
middle — so the words moved into the sentence, where they end the moment a
filter appears. The other: `sortedBy` is offered on `first` and `last` and not
on `count`, because the number is the same whichever way the rows are arranged.
That is §3.5's rule in its cheapest possible instance.

**One mutation produced no red, again, and again it was worth it.**
`collectionsUsedBy` walked a binding's head and not its steps, so a collection
named one level down — `⟨Price⟩ × ⟨How many Add-ons⟩` — would have published as
the placeholder. The panel cannot write one today, which is exactly why no
check caught it: the fix is the walk being right about the *model* rather than
about the one surface that happens to write values, and it now has a check
pointed at that claim rather than at a page nobody can build.

### 5.6 What E7 turned out to cost — 398 bytes, argued before it was measured

This stage's gate is the budget, so the argument comes first and the number
after it. **Predicted: under 400 bytes. Measured: 2581 → 2979, +398, +15.4%**,
on the minified figure §5.4 has just been corrected to use.

The thing to keep in view while reading the four arguments below is that
**the runtime is paid per page, not per use**. `testRuntime` is serialised
whole and inlined into every page carrying an unfoldable test, so a branch is
bought by pages that will never reach it.

- **`lower` and `upper` — worth it, and the one that earns the stage.** Text
  `eq` is exact and there is no case-insensitive equality anywhere in the
  operator set: *only when what is typed is `yes`* fails on `Yes`, and
  `contains` is case-insensitive but means something else. `⟨what is typed⟩
  lowercased is ⟨yes⟩` is the fix. This is a guard people hit, not one they
  might.
- **`capitalize` — worth it at the margin.** Its own travelling use is thin,
  and it sits inside branches the other two already paid for. Excluding it
  would mean offering two of three case options over a control and having to
  explain the gap.
- **`truncate` — worth it, thinly.** Comparing the first N characters of
  something typed is a real if uncommon thing (a postcode prefix, a card BIN).
  The honest reason is the other one: the model allows the step over a
  control, and a step that compiles and can never resolve is the failure §3.5
  names.
- **`join` — the weakest travelling case of the four, and included anyway.**
  "When ⟨area code⟩ joined with ⟨number⟩ is …" is contrived. It is here
  because the branch is a concatenation over recursion that already exists,
  and because `join` is the step somebody is most likely to reach for over a
  control precisely because every other tool has it.

**And the honest part.** *Nothing in the panel can author a text step over a
control today.* The chain editor lives in the Data panel, which authors
bindings, and a binding never travels. So these branches are, right now, dead
weight on pages that carry an unfoldable test — and so is E5's arithmetic,
which bought its 483 bytes on the same terms. **E8 is the stage that makes
them earn it**, because a step menu generated from the head's type is what
puts the chain on a comparison's operand. That is a real cost sitting on real
pages for one stage, stated rather than dressed up.

**One editor for two families.** E5's arithmetic chips and E7's text chips are
the same forty lines with a different menu, so there is one `chainChips` and
the offered ops are a parameter. Which ops a value can do is asked of
`FORMATS_FOR` rather than answered again — `case` is offered on exactly the
types whose value is words, which is the same question — and richtext is
deliberately not one of them: uppercasing markup would uppercase the tags.

**`null` is nothing, not the word.** A D1 column can be NULL and `String(null)`
is four letters that would be uppercased and printed. Both evaluators spell it
the same way, and the check is on a *present* field holding null rather than an
absent one — absent is already refused by `has` and would pass without the rule
being there at all.

**Two mutations found real things.** A `!` on `operandOf(step)` turned a
disagreement between two lists into a thrown TypeError, taking the whole suite
down instead of turning two checks red; it is now asked rather than asserted,
so a hand-written document cannot take a publish down that way. And the
differential's `capitalize` case used `Grace`, which cannot tell a correct
implementation from one that only touches the first letter — it shouts first
now. The harness itself gained the ability to tell a crashed run from a passing
one, which is the misread that cost both rounds.

### 5.7 What E8 turned out to cost — a table, and the stage that pays for E5 and E7

`document/steps.ts` is §3.5 written as data: one row per step, saying what has
to be in hand for it, what it leaves behind, and which value types it may be
offered on. The menu was two hand-written lists and a branch on the field's
type, which is the arrangement every other vocabulary here has already
outgrown.

**Generated, not filtered.** The offer at each position comes from the type in
hand *at that position*, folded through the steps before it. `⟨Price⟩ ⟨× 2⟩
⟨joined with " each"⟩` is text from the join onwards, so nothing after it
offers `×` — and the format chips at the end of the sentence follow the same
fold, which fixed a real thing: a currency format was being offered for a value
that had become a sentence. So do the operators and the operand chip, so
`⟨First⟩ ⟨joined with ⟨Last⟩⟩` is compared with text's operators rather than
with the ones its head started with.

**The one crossing the table allows is `join` on a number.** `⟨Rooms⟩ ⟨joined
with " bedrooms"⟩` is an ordinary sentence and a join is the step that does not
care what it was handed. A date joins as the raw value it holds, which is
honest rather than pretty — reaching the *formatted* one is E9.

**And this is the stage §5.6 said would pay for the other two.** The chain
editor now appears on a comparison's operand, not only on a binding, so
`⟨what is typed⟩ ⟨lowercase⟩ is ⟨yes⟩` is sayable — and text `eq` is exact, so
that guard was unwritable and the runtime branch for it was dead weight.
`tests/render/values.mjs` authors it through the panel, publishes, types `YES`
into the box and watches the answer change. E5's and E7's bytes are earning
their place from this commit and not before it.

**A check that could not fail, found by trying to break it.** The first version
of the coverage check asserted the table was total against the model both ways.
Two mutations refused to *compile*: `STEPS` is `Record<Step['op'], StepKind>`,
so a step in one and not the other is a type error, and one in both but
unhandled by `advance` fails to narrow at the fall-through. The compiler holds
both directions and the check was decoration. What it cannot see is whether a
row's *shape* is true — a row claiming `count` takes a value would offer it on
a number and resolve to nothing on every page — so each value-step is now
driven over a specimen of every type it claims to accept, and both mutations
that break a row's shape turn it red.

**And a check that could not be falsified for a sillier reason.** The
falsification harness recovers a check's name by splitting its output line at
`" — "`, which is the separator between name and detail. Two E8 checks had an
em dash in the *name*, so the harness compared a truncated name against the
full one and reported a working mutation as a failure. The names lost their
dashes. Worth writing down because it is the second harness defect this arc has
surfaced, and both looked exactly like a check that did not earn its place.

### 5.8 What E9 turned out to cost — nothing, and one rule restated

`⟨Price⟩ ⟨written as ⟨currency⟩ in ⟨£⟩⟩ ⟨joined with ⟨" per month"⟩⟩` →
`£900,000.00 per month`. A `Format` is applied on the way to the DOM, so
anything after it had nowhere to go: the suffix has to land on the *formatted*
number, and E7 found that out by building the join that could not reach one.

**Zero runtime bytes, and it is the only step whose reason is a budget rather
than a shape.** Formatting in the browser means shipping the whole of
`document/format.ts` to every page carrying an unfoldable test, to answer "is
what you typed, as currency, £5.00" — which nobody asks. So the vocabulary
keeps `formatted` off anything a control can hold, and that falls out rather
than being enforced: a control's value reads as text, and text's two formats
are `case` and `truncate`, which are already steps of their own. **The one step
that cannot travel is the one step nothing can put over something typed.**

**The formatter moved down a layer.** `renderer/format.ts` is
`document/format.ts` now, the same move `records.ts` made in E6 and for the
same reason — two layers need it, the resolver is the lower one, and the module
already imported nothing but types. Two importers, so the move was cheap.

**And the rule it changes, stated precisely.** `Format`'s docblock said
comparisons see raw values, and enforced it by making a formatted value
*unspellable*: "a formatted operand is not refused; it cannot be spelled." It
can be spelled now. What survives is the narrower claim, and it is the one that
was doing the work all along — the danger was comparing `$1,234.50` to `1000`
**by accident**, and that is still impossible. Doing it on purpose takes a chip
in the sentence that says `written as ⟨currency⟩`. Same trade `round` made in
E5, one type wider.

**The check that noticed was the one written to notice.** `formatValue` had
exactly one caller, and a static check asserted it — its own comment said "the
day a Test formats an operand, this is what notices". It did, on the first run
after the step landed. The claim narrowed rather than the check being widened
to fit: two callers, both named, and `runtime/behaviour.ts` explicitly not one
of them, because a second implementation of `£1,234.50` is how the canvas and
the browser come to disagree about a price.

### 5.9 What E10 turned out to cost — one builder, and a claim made true

Not a capability stage. §3.4 claimed every consumer of `Value` gets the whole
vocabulary by doing nothing, and E10 is that claim being made true rather than
repeated.

**Two halves, both wrong, agreeing with each other.** The scale panel was a
`Select` over number fields that could only ever write `{ kind: 'field' }`, and
`varsFor` read `record.data[spec.value.key]` directly and `continue`d past
anything else — the same line `boundProps` had until E3. Neither was noticed
for nine stages *because they matched*: nothing could author a chain, so
nothing ever arrived to be dropped. Two bugs cancelling out is the shape that
survives longest, and the only thing that finds it is asking the model what it
allows rather than asking the product what it does.

**One builder renders a `Value` now.** `valueSentence` is the source chip, the
list clauses, the `→` chip and the chain; `bindingSentence` is that plus two
words in front and the format behind. So the scale gets the whole sentence by
calling one function, and the next place that holds a `Value` will too.

**And a check that would have caught it.** A `Value` is minted in exactly one
file — the sentence builders — and a source scan says so. It failed on the
first run against a second minting site nobody had thought about: the `+ Value`
button's seed. `blankValue` is that seed now, next to `blankTest`, for the
reason `blankTest` is there.

**`needs` is §3.5 pointed at the place rather than the value.** A scale maps a
*number*, so `joined with` and `written as` are steps that would compile there
and never resolve — offered nowhere near it. Asked of the vocabulary
(`stepsKeeping`) rather than answered in the panel, which is what makes it
checkable at all.

**One thing a scale does differently from a binding, and it is not a
compromise.** A binding that cannot resolve leaves the design-time text alone.
A custom property that is *sometimes absent* makes the whole declaration
invalid at computed-value time on exactly the rows with missing data — a card
that loses its opacity rule is a stranger bug than one that fades to the
declared floor. So a scale always writes something, and an unresolvable chain
lands on the fallback.

### 5.10 What E11 turned out to cost — one node, and the bug ten stages hid

Ten stages of vocabulary and the ten shipped templates used none of it, which
meant the whole of it was demonstrated only in a test. The essay template says
two things now, and both are things the page could not have said before:

> `⟨How many Essays⟩ ⟨joined with " essays so far…"⟩`
> `⟨Minutes⟩ ⟨joined with " min read"⟩`

**Neither is decoration.** The count cannot go stale — six today and twenty
next year, and nobody has to remember to edit the line. And `readingTime` was a
*text* field holding `"12 min"`, so the words were content: changing them meant
editing six records, and the number could not be sorted or compared because it
was not one. It is `minutes: 12` with the label in the design.

**The byte gate moved for the first time in the arc, and by one node.** With
the ids normalised the whole diff is the added paragraph and one grouped-selector
line — the intro node's declarations now share a rule with another node's, which
is the publish-time grouping doing its job. 951,141 → 951,234 bytes, re-baselined
deliberately rather than quietly.

**And then the real finding.** The count published as the *typed* copy, because
`boundProps` began `if (!record || !bind) return base`. That was right for as
long as every binding read the record in scope — and a `records` head does not.
"How many essays" is a fact about a collection, the panel offers it on a page
with no record at all, and a section header sits outside the repeater by
construction. So the early return silently dropped exactly the binding E4
exists for, and **nothing noticed for six stages because no template said one.**

That is the argument for this stage in one sentence. Every check E4 through E10
wrote put a record in scope, because a test that is building a repeater has one
to hand. The first page that asked the question the feature was built for asked
it from the one place the code could not answer. A capability nothing uses is
not a capability that works — it is one nobody has tried.

**Two slots in the kit learned the model, and no more than two.** `Copy` lets a
section header read itself; `Reads` lets a card's meta line be a chain instead
of a field name. Both are `string | …` unions, so every other caller is
untouched. The other text slots stay typed strings, and widening four blocks'
`sectionHeader` for one line would have been the wrong trade — recorded here as
the next thing if templates are to speak the model more widely.

---

## 6. Is a list allowed to be live?

E1 was free and closed the audit's cheapest row, so it was never the
interesting question. The interesting one was whether §3.3 is right that the
list and reference steps never travel.

**Settled: not yet, and yes soon.** Live databases are coming. So the answer is
"no" for E4–E8 and it has an expiry date on it, which is a different
instruction from "no" and worth writing down as one:

- **§3.3 is a statement about today, not an invariant.** Every list and record
  step folds *because a `records` head reads the records the page was published
  with*. That is true, it is what makes E4–E8 cost nothing at runtime, and it
  stops being true the day a list can change after the file is served.
- **So nothing may be built that assumes it for ever.** Concretely: no step may
  be implemented only in the publisher on the grounds that it can never travel.
  Each one gets an evaluator that could be serialised, and the reason the
  runtime does not carry it today is that `foldable` says so — not that the
  code does not exist.
- **The seam that makes this survivable already exists.** E1 split the wire
  format from the document (§5.1): `lowerTest` sends the browser what it needs
  rather than what the document holds. A live list means a reduced chain on the
  wire and a list evaluator beside `holds` — an addition at a seam, rather than
  the rewrite it would have been while the two were one object.
- **What it will cost, stated before it is spent.** A list evaluator in
  `testRuntime` is the first thing that makes the runtime grow with the
  *vocabulary* rather than with the page. §5's stages should each carry their
  byte number so that when live lists arrive the argument is about a measured
  delta rather than a remembered one.

The thing that stays refused whatever happens to lists is in §4, and it is not
the same question: a published Cre8 site is a static file with no session, so
`Current User` remains a promise the file cannot keep. A live *database* is a
request-time read of public data. A live *user* is authentication, and that is
a different product decision.
