# Cre8 — interactions

An audit of the state / condition / event system as it stands, and a plan for
the one that replaces it. Written the way `STATE-AND-CONDITIONS.md` was
written: to be argued against before any of it is built.

The finding that shapes the whole plan, up front: **the compiler is a long way
ahead of the panel.** Most of what a designer cannot do here, the generator
already knows how to do — carefully, with the edge cases handled and comments
explaining why. Seven of the eleven condition shapes `css.ts` compiles have no
control anywhere in the inspector. Conditional styling on a checked checkbox is
one `:has()` selector that already ships (`css.ts:615`), used by exactly one
hand-written block and reachable by nobody.

So this is not mostly a proposal to build machinery. It is a proposal to reach
what is there, unify two languages that are already one type, and add the two
things that are genuinely missing.

---

## 1. The audit

### 1.1 There are two condition languages, and one is a subset of the other

| | `Condition` | `Test` |
|---|---|---|
| Shape | flat list, ANDed | tree: `every` / `some` |
| Can compare | no | yes — `field > 500000` |
| Reads | pointer, control, state, attr, visit | all of those, plus record fields, form controls, other elements |
| Runs | in the stylesheet | at publish time, or in the browser |
| Held by | `StyleRule.when: Condition[]` | `StateRule.when: Test` |
| Does | changes styles and content | sets a state name |

They are already one type — `Test = Condition | compare | every | some`
(`types.ts`). The union exists. What is narrow is the *field*: a style rule
can only hold the CSS-compilable half.

The cost falls on the designer, and it is the single worst thing about the
system today. To make a card red when its price is over half a million:

1. Open the rules section. Realise there is no way to say it.
2. Go to the data section. Add an assignment: *when Price is over 500000, set
   the state to `premium`*. Invent the word `premium`; nothing suggests it.
3. Give the node a state name so the assignment has somewhere to write.
4. Go back to the rules section. Add a state rule: *when state is `premium`*.
5. Style it.

Five steps, two panels, and an invented intermediate variable, for a sentence
the designer could say in one breath. In Bubble this is one conditional row.

The intermediate variable is not the problem — it is a real and good mechanism,
it is how the runtime stays small, and the plan below keeps it. The problem is
that **the designer types it.** A compiler should mint it.

### 1.2 Seven of eleven condition shapes are unreachable

Everything `conditionParts` (`css.ts:606`) compiles:

| Shape | Compiles | Offered in the panel |
|---|---|---|
| `pointer: hover` | ✔ | ✔ Hover |
| `pointer: focus-visible` | ✔ | ✔ Focus |
| `pointer: active` | ✔ | ✘ |
| `pointer: focus` | ✔ | ✘ |
| `control: checked` | ✔ (with the `:has()` fix for wrapped inputs) | ✘ |
| `control: disabled` | ✔ | ✘ |
| `control: invalid` | ✔ | ✘ |
| `control: placeholder-shown` | ✔ | ✘ |
| `state` | ✔ | ✔ State… |
| `attr` | ✔ (and expands content, `variants.ts:154`) | ✘ |
| `data` | ✔ | ✔ Visit… |

Four of eleven. The two unreachable *kinds* exist in the wild only because the
block kit hand-writes them: `kit.ts:1250` plants a `control: checked` on a
toggle, `kit.ts:568` plants an `attr` on the copy button so it can say
"Copied". A designer can drop those blocks, cannot make another one, and
cannot meaningfully edit the ones they have — `RuleRow` has no editor for
either, so `conditionSentence` falls through to prose and prints *"the control
is checked"* as an unclickable phrase (`sentences.tsx:703`).

Styling a checked checkbox, a disabled button, or an invalid field is table
stakes. All three work. None can be asked for.

### 1.3 AND is in the model, in the compiler and in the sentence — and cannot be typed

`StyleRule.when` is an array. `ruleSelector` concatenates every condition's
fragments (`css.ts:713`). `ruleSentence` joins them with the word "and"
(`sentences.tsx:713`). The whole path is built for several conditions.

Every call site passes exactly one: `addRule([{kind:'pointer',pseudo:'hover'}])`
and its three siblings (`section-rules.tsx:204–243`), and `RuleRow` edits
`rule.when.find(c => c.kind === 'state')` — it reaches past the array to the
one element it expects.

So *"hovered **and** the annual tab is selected"* — a hover treatment that
only applies in one tab — is expressible in the document, compiles correctly,
renders correctly, and describes itself correctly in the panel heading. There
is no way to author it.

### 1.4 OR exists on one axis and not the other

`state`, `attr` and `data` all carry `values: string[]`, which is an OR over
the values of one key, compiled with `:is()` (`css.ts:684`). `Test` has
`some`. `Condition[]` has no OR at all, deliberately —
`STATE-AND-CONDITIONS.md` §10 argued it out.

The result is that the same designer, in the same panel, gets *"any of these
hold"* when writing an assignment and cannot get it when writing a style. Two
grammars for one idea, one section apart.

That decision is worth revisiting rather than defending, because the cost has
changed: a selector list is how a stylesheet has always spelled OR, and
`:where()` keeps every branch at the same weight. See §2.3.

### 1.5 Events: one event, two verbs, and no "only when"

- **Events declared** by the element registry: `onClick` on `button` and
  `link` (`schema.ts:446`, `:470`), `onSubmit` on `form` (`:548`).
- **Events read** by anything: `onClick`. `actionsFor` defaults to it and no
  caller passes another (`actions.ts:50`). `onSubmit` is declared, typed,
  documented as unread — and unread.
- **Verbs**: `setState` and `copy`. Two.
- **Conditions on an action**: none. The model has no place to put one.

### 1.6 "What happens when this is pressed" lives in five places

| What it does | Where it is stored | Which panel edits it |
|---|---|---|
| Set a state | `node.events[].actions` | When pressed |
| Copy text | `node.events[].actions` | Content |
| Go somewhere | `node.props.href` | Link |
| Open a panel | `node.refs.popover` | Relative to |
| Scroll to a section | `node.refs.scrollTo` | Link |
| Submit | `node.props.action` | Form |

Six behaviours, three storage shapes, four panels, and no ordering between
them — because there is no list they are all in. "Close the menu **and** go to
Pricing" is a `setState` and an `href` that happen to be on the same node and
have no relationship to each other.

The section already knows what it should be. Its title is *"When pressed"* and
its hint reads *"Set a switch, copy something, open a panel, go somewhere"*
(`sections.ts:322`). The hint promises four things. The section delivers one.

### 1.7 A state has no declaration

A switch group is three loose props — `switchKey`, `switchDefault`,
`switchDesign` — and its **values are not declared anywhere**. They are
recovered by scraping the controls that set them (`valuesSetting`,
`actions.ts:125`), whose own docblock admits the imprecision: a control in a
nested group is attributed to the outer group as well.

Three consequences:

- A value cannot exist before something sets it, so the empty state of a
  filter, or the error state of a form, cannot be designed until the button
  that reaches it is wired.
- Renaming a value means finding every control that mentions it.
- There is no type. Every state is a string enum discovered by search.

Bubble declares custom states with a name, a type and a default, on the
element. That is strictly better and costs one interface.

### 1.8 Summary of the gap, as tasks a designer would try

The right-hand column is the audit as written, before X1. The one after it is
where each row landed, re-checked by driving the panel rather than by reading
the code — which is how the last two were found still open. Each ✔ names the
suite that presses the buttons.

| | Bubble | Cre8 at the audit | Now |
|---|---|---|---|
| Style on hover | conditional row | ✔ | ✔ |
| Style a checked checkbox | conditional row | ✘ impossible in the panel | ✔ X1 · `conditions.mjs` |
| Style a disabled or invalid control | conditional row | ✘ impossible in the panel | ✔ X1 · `conditions.mjs` |
| Style when a field is over a number | conditional row | 5 steps, 2 panels, an invented name | ✔ X4 · one line in the When… menu |
| Hover **and** a tab is selected | conditional row | ✘ impossible in the panel | ✔ X11 · one press |
| Either of two conditions | conditional row | ✘ not in the model | ✔ X11 · one press |
| Press → close a menu **and** navigate | one workflow, ordered | 2 panels, no order | ✔ X8, ordered by X10 |
| Press → but only when signed in | "Only when" on the action | ✘ not in the model | ✔ X7, on screen in X10 |
| On submit → do something | workflow on the event | declared, unread | **withdrawn** — see §5.1 |

The last row is the only one left, and what happened to it is not "deferred".
The audit's complaint was that `ElementDefinition.events` *promised* `onSubmit`
on every form while nothing read it, and X6 answered that by **withdrawing the
promise** — a table entry earns its place by being delivered. So the row is
closed as a lie and open as a feature, which are different things. §5.1 says
what building it would actually cost.

---

## 2. What must survive

Everything below is a constraint the current design earned, usually by getting
it wrong once first. Any plan that breaks one of these is not a better plan.

1. **No script where CSS can do the work.** The behaviour runtime is thirty
   lines and inlined only into pages that need it (`behaviour.ts`). Whether a
   thing runs at publish time or in the browser is *derived* from what it
   reads — `foldable`, in `document/schedule.ts`, which is where it moved when
   an action's guard started asking the same question a style rule does —
   never chosen by a designer and never chosen by a panel.
2. **The runtime is serialised with `toString()`** and may not reference
   module scope. Every attribute name inside it is a literal. This shipped
   broken for one afternoon when a bundler inserted `__name`.
3. **CSS must not scale with repeater rows.** A hundred cards are a hundred
   attribute values and one stylesheet (`test.ts:10`).
4. **Every rule weighs (0,1,0)**, so source order is the whole of precedence
   (`css.ts:698`). Every condition goes through `:where()`. A new shape that
   forgets this re-introduces the bug where a state silently beat a hover.
5. **Content variants need mutual exclusion on one axis**, or expansion goes
   quadratic (`variants.ts:206`). A rule that does not fit is skipped, not
   approximated.
6. **Three answers, not two.** `evaluate` returns `true`, `false`, or `null`
   for *cannot decide here* (`test.ts:69`). A guess would make a typo look
   like a design decision.
7. **A runtime dependency makes the scripting-off fallback required**, and the
   editor says so in a sentence (`unfinished`, `test.ts:321`).

---

## 3. The plan

One sentence: **the designer writes one condition in one place, and the
compiler decides where it runs.**

### 3.1 The model changes

```ts
StyleRule.when : Condition[]  →  Test          // one language
NodeAction                     →  + verbs, + only?: Test
NodeEventBinding.event         →  a declared registry, not a free string
switchKey/Default/Design       →  node.states?: StateDecl[]
```

```ts
interface StateDecl {
  key: string;
  values: string[];   // declared, not scraped
  initial: string;
  design?: string;    // what the canvas shows; never published
}
```

Nothing is removed from `Test`. `Condition` stays exactly what it is: the name
for *the subset that compiles to a selector*. That distinction is the load
bearing one, and it already has two functions guarding it —
`conditionParts` returning `null`, and `foldable`.

### 3.2 One planner in front of the generator

```
plan(test) → { css: Condition[][] | null, mint: StateRule | null }
```

Three cases, and the first is by far the most common:

- **All conditions, ANDed** → today's path exactly. The output must be
  byte-identical; that is how this change is verified.
- **Contains a comparison** → the planner mints the intermediate state. It
  hoists the `compare` subtree into a `StateRule` on the node with a generated
  key, and rewrites that branch of the style rule as
  `{kind:'state', key:'<minted>', op:'is', values:['on']}`. The assignment
  then travels the road it already travels: folded at publish time if every
  operand is a record field, or shipped in the test table and evaluated by
  `testRuntime` if not. **The five manual steps in §1.1 become one sentence,
  and the machinery underneath is unchanged.**
- **Contains `some`** → a selector list. See below.

The minted key must be stable across publishes — derived from the rule id, not
a counter — or every edit churns the stylesheet and D6's write-only-what-changed
publishing stops being able to tell.

### 3.3 OR compiles to a selector list

`ruleSelector` returns a `string`. It becomes `string[]`, and the emitter
joins with `,` — which is how a stylesheet has spelled OR since the beginning.

`:where()` wraps every fragment already, so each branch weighs (0,1,0) and
source order still governs. Constraint 4 survives untouched.

The one real risk is the cross product: `some` of `every` of `some`
multiplies. Two bounds, both derived rather than chosen:

- The panel authors one level of grouping. `sentences.tsx:190` already stops
  at `depth < 1` for exactly this reason.
- The planner counts the branches it would emit and, past a ceiling, falls
  back to minting a state instead — the same escape hatch as a comparison, and
  the same reasoning as `foldable`: *fold when it is cheap, subscribe when it
  is not.*

### 3.4 Reach the seven

Pure UI over a compiler that already works. The `+ when` menu offers every
shape: hovered, pressed, focused, checked, disabled, invalid, empty, a field,
what is typed, another element, a state, a visit, an attribute.

This is the cheapest large win in the plan and **it does not depend on
anything else in it.** It should ship first.

### 3.5 Events become a registry, and actions grow verbs

Events, declared per element the way `events: ['onClick']` already is:

| Event | Native? |
|---|---|
| `onClick` | yes |
| `onSubmit` | yes — declared today, finally read |
| `onChange` | yes, on form controls |
| `onVisible` | no — needs script, so it needs a fallback |
| `onLoad` | no — needs script, so it needs a fallback |
| `onKey` (escape) | no — needs script |

The last three fall under constraint 7: they cannot work with scripting off, so
the editor demands a fallback before it will call them finished, exactly as
`unfinished()` already does for a runtime test.

Verbs, absorbing what are currently props and refs:

`setState` · `toggleState` · `copy` · `navigate` · `openPanel` · `closePanel` ·
`scrollTo` · `submit` · `focus`

Deliberately **not**: create a thing, make an API call, send an email. Those
are Bubble's server half. This codebase's data layer is D1 plus a publish
pipeline, not a live application runtime, and pretending otherwise would put a
half-working backend in a website builder.

**The compiled output must not change.** A link whose only action is a
`navigate` with no `only` still publishes as `<a href="…">` with no script.
This is the same discipline as the fold/subscribe split, applied to verbs: the
authored shape is uniform, the compiled shape is whatever is most native. If
absorbing `href` into an action costs a published page one byte of JavaScript,
the absorption is wrong.

### 3.6 `only` on an action

```ts
{ type: 'navigate', to: …, only?: Test }
```

Evaluated by the evaluator the runtime already ships. This is the one genuinely
new script surface in the plan, and it is small because `testRuntime` exists.

### 3.7 The UX

One section in the one-scroll inspector, reached from the same `+` menu as
everything else — the shape settled on in the previous round.

```
When  ⟨hovered⟩                        → 3 style changes  ▸
When  ⟨Price⟩ ⟨is over⟩ ⟨500000⟩        → 2 style changes  ▸
When  ⟨all of these⟩ hold
        ⟨hovered⟩
    and ⟨plan⟩ ⟨is⟩ ⟨annual⟩            → 1 style change   ▸
  + when

When pressed
  1. ⟨Close⟩ ⟨the menu⟩
  2. ⟨Go to⟩ ⟨Pricing⟩    only when ⟨signed in⟩ ⟨is⟩ ⟨yes⟩
  + action
```

Both halves are `testSentence` (`sentences.tsx:64`) — which already renders
chips, groups, and/or, add and remove, and already knows how to say every one
of these. **The unification is mostly deletion**: once `StyleRule.when` is a
`Test`, `conditionSentence` and `ruleSentence` collapse into it, and the panel
gets more expressive by losing code.

That is the test of whether this plan is right. `STATE-AND-CONDITIONS.md`
opened by claiming its own change should be a net reduction in `css.ts`,
`element-model.ts` and the inspector. This one makes the same claim about
`sentences.tsx` and `section-rules.tsx`.

---

## 4. Stages

Each is independently shippable and independently falsifiable.

| | | Depends on |
|---|---|---|
| **X1** | ~~Reach the seven unreachable condition shapes~~ — **shipped** | nothing — shipped first |
| **X2** | ~~`StyleRule.when` becomes a `Test`; the planner; byte-identical output~~ — **shipped** | — |
| **X3** | ~~OR compiles to a selector list~~ — **shipped** | X2 |
| **X4** | ~~A comparison in a style rule mints its own answer~~ — **shipped**, as an attribute rather than a state | X2 |
| **X5** | ~~States are declared, not scraped~~ — **shipped**; it also found the collaboration bug below | — |
| **X6** | ~~Events become a registry; actions grow verbs~~ — **shipped**; the model and the compiler, not the panel | X5 |
| **X7** | ~~`only` on an action~~ — **shipped**; it also found five vacuous no-script checks | X6 |
| **X8** | ~~One "When pressed" list, absorbing Relative-to / Form and *naming* Link~~ — **shipped**. See §4.0.7 | X6 |
| **X9** | ~~Prove it in a browser; correct both docs~~ — **shipped** | all |
| **X10** | ~~"Only when" on screen~~ — **shipped**; it also found the write path below | X7, X8 |
| **X11** | ~~Re-drive §1.8 through the panel~~ — **shipped**; two rows were still open | all |
| **X12** | ~~Declare which props are content~~ — **shipped**; the third hand-listed vocabulary | X11 |
| **X13** | ~~Close §1.8's last row honestly~~ — **shipped**; `onSubmit` was withdrawn, and the model still said otherwise | X6 |
| **X14** | ~~Look at the panel~~ — **shipped**; the row had been overflowing by 123px | X8, X10, X11 |
| **X15** | ~~Sweep every section for the same fault~~ — **shipped**; the press list was the only one | X14 |
| **X16** | ~~Look at the one thing left unseen~~ — **shipped**; “+ or” wrote *pointed at or pointed at* | X11, X14 |
| **X17** | ~~A condition on the visit can be about something other than the time~~ — **shipped**; and it is how a form says thank you | X1 |
| **X18** | ~~Check the claim X17 broke, not a proxy for it~~ — **shipped**; five kinds, no frozen operands | X17 |
| **X19** | ~~Look at the canvas, not the panel~~ — **shipped**; panning had no bottom | — |

How each is falsified — the check that must fail against the unfixed code:

- **X1** — for each of the seven, drive a real browser into that state and read
  the computed style. Falsified by removing the condition and seeing the style
  not apply.
- **X2** — publish all eight templates before and after and diff the
  stylesheets. Any difference is a regression, not a feature.
- **X3** — a rule only an OR can express: assert it applies on both branches
  **and not on a third case**. A check that only tests the branches would pass
  against a selector that matched everything.
- **X4** — author the same design by hand (state rule + style rule) and by
  comparison, publish both, diff. Different bytes mean the planner is not
  minting what a person would write.
- **X5** — add a value nothing sets, style it, and see it on the canvas.
  Impossible today by construction.
- **X6** — a link with one navigate action publishes `<a href>` and **zero
  bytes of script**. Assert the byte count, not the presence of the tag.
- **X7** — with scripting disabled, an action carrying an `only` does the
  declared fallback. Assert what the visitor gets, not that the runtime is
  absent.
- **X8** — extend U3's reachability sweep: every prop reachable before is
  reachable after.
- **X10** — author a guard from the panel and publish: the folded one decides
  at publish and leaves no trace in the file, the live one mints an attribute.
  Falsified by offering a condition neither evaluator answers and seeing the
  gesture stop working.

### 4.0.9 The guard is a comparison, and it is one per gesture

Written before starting X10, and both halves of the title are conclusions
rather than choices — the code decides them and the panel has to agree.

#### Why not the whole condition vocabulary

`only` is a `Test`, and a `Test` is a superset: every `Condition` is one. So
the obvious panel is the one the rules section already has — the When… menu,
eleven shapes, *only when hovered*. It is also unshippable, and the two
evaluators say so in the same line of code.

`schedule.ts:evaluate` answers `compare`, `every`, `some`, and returns `null`
for everything else — a `Condition` "is answered by the browser rather than by
the publisher". `behaviour.ts:testRuntime.holds` has the same three cases and
the same default. Put those together for a `Condition` guard:

- `foldable()` is false, so it is not decided at publish. It travels.
- `holds()` answers `null`, so `testRuntime` **removes** the guard attribute.
- `behaviourRuntime` finds the attribute absent and does nothing.

Every press, for ever. And it is worse than one dead action: an unfoldable
guard is the element's guard, so `planActions` refuses every *other* action
that does not carry the same one. A single pick from a menu of eleven would
silently stop the whole control.

So the guard menu offers exactly what the two evaluators can answer, which is
a comparison over the three operand kinds that exist:

| operand | schedule | answered by |
|---|---|---|
| `field` — the record | folds | `evaluate`, at publish |
| `input` — a named control inside | travels | `testRuntime` |
| `element` — a control anywhere on the page | travels | `testRuntime` |

That is `testSentence`'s *assignment* grammar, already built, already used by
the state-from-record panel. The guard row is that builder with a different
opening word. Nothing new is authored, which is the point: a second grammar
for the same question is how the two would drift.

#### Why one guard for the gesture, not one per row

`only` is per action in the model and stays that way. The panel authors one,
and the reason is `planActions`:

```ts
const gated = actions.find((a) => a.only && !foldable(a.only))?.only;
… else if (!sameGuard(action.only, gated)) refused.push(action)
… else if (gated) refused.push(action)      // unguarded, on a gated element
```

An unfoldable guard becomes one attribute on one element, so the element has
one. Guard the first of two rows and the second is refused — not dropped,
*refused*, which is the compiler being honest about a design a page cannot
express. A per-row editor would make that the natural second click.

A per-row editor is only fully meaningful for the *foldable* half, where two
actions genuinely can carry two different record conditions. That design — one
button whose copy is gated on one field and whose panel is gated on another —
is not one anybody has asked for, and it is still expressible in the model, in
a block, and by anything that writes a document. The panel writes the shape
that is correct on both schedules: **the same guard on every action**, so a
refusal is not reachable from here.

What the panel must still do is *read* the other shapes, because a block can
write them. Mismatched guards are reported rather than redrawn — one line
naming what the compiler will drop, which is the first time `plan.refused` has
been on screen at all.

#### And the order, which was a claim the panel could not honour

*"They run in this order, top to bottom"* is what the add row has said since
X8, under a list nobody could rearrange. The order decides two things —
`planActions` gives a contested carrier to the **first** claim, and the runtime
performs the rest in sequence — so a designer who wrote the jump before the
link had no way to say they meant it the other way except to delete both and
start again.

One chevron per row, "Run this sooner", disabled on the first and hidden
entirely below two actions. Sooner-only rather than a pair, and that is the
width rather than a principle: the verb picker is a fixed 104px in a 288px
panel and an operand can be two more pickers, so the row has about twenty
pixels spare and not forty. Every arrangement is still reachable, because
moving A below B is moving B above A. `RuleRow` offers both directions because
a rules list runs long; a press list is two or three things.

What the order *means* is checked in the static suite, where `planActions` is
handed the same two verbs in both orders. What a browser has to answer is
whether the panel can produce the other one, read back out of the document —
rows re-sorting on screen while the document keeps its old order is precisely
the failure a screenshot cannot tell from success.

#### And the sentence that is not a warning about the panel

`unfinished()` has said since X7 that a live guard is not a lock: the guard is
answered in the browser, so a visitor with no scripting still follows the link,
because the `href` is in the file and nothing is there to stop it. That
sentence renders in the Data section, which needs a collection in scope. The
guard is authored here and this section always exists, so it belongs here —
same function, so there is still one wording.

### 4.0.7 X8 is asymmetric, and `href` is the reason

Written before starting X8, because the first thing the code says when you go
to move `props.href` onto a `navigate` verb is *don't*.

`href` is in `SETTABLE` (`variants.ts:79`) and in `BINDABLE`
(`section-data.tsx:52`). A destination can therefore **vary by rule** — the
same button pointing somewhere else in the annual case — and it can be **bound
to a record**, which is how every card in a repeater links to its own post.
Neither is hypothetical; both are what those two lists are for.

`refs.popover`, `refs.scrollTo` and `props.submit` are none of those things, and
that is deliberate rather than incidental. `isSettable`'s docblock says why:
structure "would make the variants different *elements* rather than the same
element saying something else, and two of them would then fight over one DOM
id."

So §1.6's five places do not collapse the same way:

| What it does | Today | X8 |
|---|---|---|
| Set a state | `events[].actions` | unchanged |
| Copy text | `events[].actions` | unchanged |
| Open a panel | `refs.popover` | → `openPanel` |
| Scroll to a section | `refs.scrollTo` | → `scrollTo` |
| Submit | `props.submit` | → `submit` |
| Go somewhere | `props.href` | **stays a prop; the verb names it** |

A `navigate` with no `to` means *go where this element's `href` says*. The
action list then holds every behaviour, in order, each with its own `only` —
which is the whole point of the stage — while the destination itself stays
content that a rule can vary and a binding can fill. The renderer already reads
it that way: X6's `pressed()` takes the verb's `to` when there is one and the
prop when there is not, so this needs no new reconciliation, only the decision
not to write `to` during the migration.

**Shipped, including the list.** The section is one row per action, in the
order the document holds them, which is the order they run in. Both the menu
and each row's word come from `VERBS`, so the panel cannot fall behind what the
compiler understands — the same arrangement `conditionOffers` gave the When…
menu in X1.

What it replaces is worth stating plainly: the old section showed `setState`
and nothing else, and *returned nothing at all* when the page had no switch on
it. So a button that opened a panel and went somewhere had two behaviours,
four panels between them, and an empty "When pressed". A verb with no operand
to ask about — `navigate`, `submit` — says where its answer comes from rather
than showing a blank control.

`migratePress` folds the three at both doors — `migrateDocument`
for a stored document and `finishTree` for a block — and `setPressAction` is
what the panel writes through, so the Relative-to control, `setJumpTarget` and
the section registry's "in use" test all go to the action list. Published
output is byte-identical: `pressed()` reads verbs first and props second, so
nothing about the file changed. What remains of X8 is the *presentation* half —
one list, in order, with an "only when" row per action.

It cost two bugs, both mine and both older than this stage. `rewireInternalRefs`
walked `node.refs` rather than `everyRef`, so a copied button whose jump was a
verb kept pointing at the original section (landed separately as `a753bc4`).
And `pressed()` read `node.props` rather than the *variant's* props, so a rule
setting `href` published the base destination on every copy — which is exactly
the thing this section says `href` must keep being able to do, caught by the
check written to defend it.

The falsification the plan names is unchanged and is now sharper: extend U3's
reachability sweep, *and* assert that a rule setting `href` still varies the
destination of a node whose press is authored as a verb. A migration that
folded the prop away would pass the first and fail the second.

### 4.0.5 X7 — a guard, and the checks that were not checking

`only` is a `Test`, on an action, and it costs almost nothing because X4
already built the hard half. Two schedules, as everywhere else:

- **It folds.** Every operand is publish-time data, so the publisher answers
  it. A true guard vanishes and the action is as if it had never been
  conditional; a false one takes the action with it. No attribute, no entry in
  any table, no script — and in a repeater each row gets the answer for its own
  record.
- **It does not fold.** The guard mints an attribute exactly as a comparison in
  a style rule does, `testRuntime` turns it on and off, and the behaviour
  runtime checks for it before doing anything. Ninety-nine bytes, because the
  evaluator, the table, the published values and the folding were all built
  for style rules and are reused whole. A second copy of `holds` in the
  behaviour closure would have cost about a kilobyte and been the second
  implementation ARCHITECTURE §1 exists to have one of.

One limit, stated rather than discovered: an unfoldable guard becomes **one
attribute on one element**, so it gates the whole gesture. A binding whose
actions disagree about their guard — two different conditions, or a guarded
action beside an unguarded one — has the odd ones out refused, the same bargain
two verbs wanting one `href` strike. A guard that *folds* has no such limit: it
is answered per action, per row.

And what a visitor with no scripting gets differs by verb, because a static
file cannot conditionally have an `href`. A verb the runtime performs does
nothing, which is what it does unguarded. A verb the markup carries *runs*.
`unfinished()` says so on the node where it matters — "only when" reads like a
lock and is not one.

**What X7 found.** `javaScriptEnabled` is a Playwright **context** option, and
it is ignored on `newPage` — silently, with no warning. Five checks in the
behaviour suite asked for a script-free page that way and got an ordinary
scripted one. All five passed, because each asserted a value the page happens
to have either way. The first check whose expected value *differs* with and
without the runtime — a guarded action, which must not run without scripting
and does run with it — is what surfaced it.

So the project's no-script guarantee, which is load-bearing in the execution
model and named in three docs, had been checked for months by pages that had
scripting. It is checked by contexts now, through one helper, because the wrong
spelling is one keystroke away and reads identically.

**And what the helper was hiding, found in X10.** That same fixture's last
click carried `{ force: true }`, with a comment guessing that "something above
the button fails the hit test". Measured rather than guessed: nothing is above
the button. `css.ts` ships `html { scroll-behavior: smooth }` on every
published page, Playwright scrolls an element into view and then waits for it to
be *stable*, and on a fixture five thousand pixels tall it re-measures
mid-animation, scrolls again, and spends the whole timeout landing a few pixels
short — `element is not stable`, thirty seconds, every run.

The fix is the preference, not the bypass: the context asks for reduced motion,
the page's own `@media (prefers-reduced-motion: reduce)` turns the smooth
scrolling off, and the ordinary click lands. That matters beyond tidiness,
because `force` skips the hit test — so for as long as it was there, the check
could not tell a reachable button from one behind an overlay, on the no-script
page, which is precisely where an element that should have been hidden would
still be showing.

> **A workaround with a guess in its comment is an unfinished measurement.**
> Removing it and reading the actual error took one run.

### 4.0 What X6 shipped, and what it deliberately did not

The table in §3.5 lists six events and nine verbs. What shipped is **one event
and eight verbs**, and both cuts are worth writing down because neither is a
compromise about the design — they are the same rule applied twice.

**The rule.** A table entry earns its place by being *delivered*. The thing
this stage exists to fix is `ElementDefinition.events`, which promised
`onSubmit` on every form and `onClick` on buttons and links while `actionsFor`
defaulted to `onClick` and no caller ever passed anything else: one entry was a
lie and two were decoration. Replacing that with a longer list of entries
nothing reads would be the same defect at three times the size.

**So `onChange` and `onSubmit` wait for X7.** Both are wanted and both cost the
same two things: a listener in a runtime that is serialised into every
interactive page, and a declared answer for the visitor with scripting off. The
second is not optional — the execution model makes the no-script fallback a
required declaration, which is why `unfinished()` refuses to call an assignment
complete without one — and the machinery for demanding it of an *action* is
X7's. `onVisible`, `onLoad` and `onKey` are the same argument with no native
gesture behind them at all.

**And `focus` was cut from the verbs.** It needs an attribute of its own and a
DOM lookup — roughly 300 bytes of runtime on every interactive page — for a
verb nothing can author until X8. The other eight are all reachable: four
compile to markup and cost nothing, three were already implemented, and
`toggleState` is the one addition.

**What did ship is the part that matters.** Every verb has exactly one answer
to "what markup carries this", `planActions` is the one place that answer is
applied, and the renderer, the tag decision and the publisher's script gate are
three readings of it rather than three functions that have to agree. Four verbs
— `navigate`, `scrollTo`, `openPanel`, `closePanel`, `submit` — compile to
`href`, `popovertarget` and `type="submit"`, so a link authored as a verb
publishes the same bytes as a link authored as a prop and **no script at all**.

`toggleState` costs 113 bytes of runtime, and only that much because a flip
rides the assignment grammar as `a|b` rather than getting an attribute of its
own: the group lookup, `sync`, the tab pairing and the row-local group in a
repeater are all unchanged code.

The panel is untouched. X8 is where the verbs become authorable and where
`props.href`, `refs.popover`, `refs.scrollTo` and `props.submit` migrate onto
them — which is why the compiler reads verbs first and the older spellings
second, and why every existing document still publishes byte-for-byte what it
published before.

### 4.1.25 And what looking at the canvas turned up — panning had no bottom

Nine stages of this arc were spent in the inspector, and the first standing
constraint of the project is that *the canvas is the product*. So: open a real
template, scroll, and look.

Two seconds of momentum scrolling put the page out of sight. Measured rather
than eyeballed, because "I scrolled past the end" and "the frame stopped
rendering" look identical:

| | frame top |
|---|---|
| at rest | 84 |
| after 12,000px | −11,916 |
| after 112,000px | −111,916 |

Exactly the distance scrolled, every time — no bound at all. And no scrolling
ancestor: `scrollTop` and `scrollHeight` come back `null`, because the canvas
pans by **transform**. That is the whole of it. A scroll container stops at the
end of its content and shows a scrollbar saying where you are; a transform does
neither, and `setPan` took whatever it was handed. A designer who flicks a
trackpad ends up in an empty grid with no page, no scrollbar, and nothing
indicating which way is back.

The bound is a strip rather than the frame's edges — 96px — because a page is
taller than the viewport and the bottom of it has to be reachable. Fit-to-view
is deliberately not clamped: it computes a position rather than accepting one,
and it is the way back.

Checked in `editor-perf`, which is the suite that "fails only on what would be
a bug at any speed", on the tallest document there is — so the legitimate range
is at its widest and a clamp that was too tight shows up there first. All four
directions, because the failure is not *that* it stops but *where*: a clamp
that pinned the frame in place would satisfy a check that only scrolled one
way.

Falsified by removing the clamp: `down -143916..-128360`.

> **Nine stages in a 288px panel is nine stages not spent on the thing the
> panel is for.** This took one screenshot and one measurement.

### 4.1.23 And the check that should have caught X17

The static suite has said, for every condition kind, *"a '<kind>' condition can
be edited, not only described"* — and it was green while a data condition's
source was a word. What it tests is a **regex over the source**:

```js
new RegExp(`condition\\.kind === '${kind}' && onChange`).test(sentence)
```

The branch existed. Whether anything *inside* it was a control was never asked,
and that is the whole of X17. A proxy for a claim is not the claim.

So the claim is tested where it is made: the rule is rendered, every `button`,
`input` and `select` inside its sentence has its text subtracted from the
sentence's own, and what is left has to be connective tissue — *when*, *and*,
*hold*, *is*. Anything else is an operand somebody cannot change. Run over all
five kinds, and the count of kinds measured is asserted alongside, so a sweep
that stopped finding sentences reads as a failure rather than as five clean
ones.

No per-kind operand counts, deliberately: a list of expected numbers is the
thing that drifts, and the point of this check is to not be the kind of check
that drifts.

Falsified by restoring the word: `data: form was just sent`.

**And a self-inflicted one worth keeping.** The first run reported
`attr: the canvas did not come back`, which read like a shape that crashes the
editor. It was the fixture: the model spells an attribute condition
`{ kind, name, op, values: [] }` and it had been written `{ kind, name, value }`.
The finding is about the check rather than the product — it survived a
malformed input by reporting which shape failed and carrying on, instead of
taking the suite down with a timeout, which is why the real cause was one run
away rather than one bisect away.

### 4.1.21 And the condition on a visit that could only ever be about the time

Reading the code for `onSubmit` turned up something better than `onSubmit`.

`DATA_SOURCES` declares two facts about a visit, `describeSource` mints one per
URL parameter, the resolver writes `referrer:…` and `query.<name>:…` into
`data-cre8-data` before the first paint, and the generator compiles every one of
them to a selector. `conditionSentence` rendered the source as:

```ts
{ kind: 'word', text: source?.label ?? condition.source, key: k('source') }
```

A **word**. Unclickable. So the source was whatever the When… menu seeded and
stayed there for ever, and the menu seeds `DATA_SOURCES[0]`. *Time of day* was
the only thing anybody could ask about a visit; `referrer` and every URL
parameter compiled, shipped, resolved before paint and could not be authored.

That is X1's finding — seven condition shapes the compiler knew and the panel
could not reach — on the axis X1 did not sweep.

**And `query.sent` is the one that mattered.** The form round trip is complete
on both sides and was reachable from neither: a published form posts to
`…?r=<path>`, the endpoint answers 303 back to that path with `sent=1`, and a
rule on it is how a page says thank you. Three pieces of server behaviour that
a designer would have had to already know. Naming it — "A form was just sent",
with `1` as its value and a hint saying where the parameter comes from — turns
folklore into a menu entry, and `offerableSources()` is what the panel offers.

Falsified by putting the word back: the picker's options collapse to
`is · is not` and the rule stays on `time`.

One more instance of the build trap, on the same falsification: `npm run build`
failed on an unused constant, `wrangler` kept serving the previous bundle, and
the suite reported 58/58 against code the mutation had not replaced. Caught by
reading the exit code, which `tests/README.md` had been told to say two commits
earlier.

### 4.1.19 And the last thing nobody had looked at — a rule that says itself twice

X14's sweep measures whether the rules sentence *fits*. It does not read it.
The `+ or` X11 added was the one thing this arc built that had never been seen
rendered, and the first press of it produced:

> **any of these hold — pointed at or pointed at**

The seed was a constant: `newLeaf: () => ({ kind: 'pointer', pseudo: 'hover' })`
from the rules panel, `blankTest(fields[0])` from an assignment. Growing a
condition therefore offered back the condition most likely already there, and
the result compiles to a selector list with two identical branches saying
exactly what the one branch said.

That is `blankTest`'s own standard failing one step along. Its docblock asks for
a sentence "grammatical from the moment it appears" so that a new rule is not a
form to fill in. A duplicate leaf clears that bar and still says nothing — and
it is worse than a blank, because a blank looks unfinished and this does not.
`unusedLeaf` picks the first thing the test does not already hold, in the order
the When… menu offers them, so the second condition is the one somebody would
most likely have reached for next.

**And the two checks written for `+ or` in X11 could not have caught it.** They
assert the leaves differ — correctly — over fixtures that grow from *ticked*
and *focused*, so a constant `hover` differed from both by luck. Restoring the
constant left them green. The case that catches it is the obvious one nobody
writes: grow the very condition the constant is.

> **A check over inputs that cannot produce the fault is not a check, however
> exactly it states the rule.** The fixture has to be able to fail.

One more thing this turned up, about running the checks rather than the code:
the falsification's first `npm run build` **failed** — `unusedLeaf` was imported
and unused — and `wrangler` happily kept serving the previous `out/`, so the
suite passed against the code the mutation was supposed to have replaced.
`npm run build | tail -1` hid it. Read the exit code.

### 4.1.17 And the sweep that generalises it — six kinds, every section, 1207 boxes

X14 found one row overflowing because somebody thought to look at that row. The
same fault could be in any section of any element type, and nothing would have
said so — the panel has no horizontal scrollbar to notice, because the content
simply draws past the edge.

So the measurement is a sweep now, in the panel suite: six element types, every
section opened, every rule expanded, and every box in every section compared
against the section's own right edge. It reports what it measured — **1207
boxes, closest to the edge 0px** — because a sweep that stopped finding
elements has to read as a suspicious zero rather than as a clean panel.

The answer is that the press list was the only one. That is worth having as a
result rather than as an assumption: the rest of the inspector has been
laid out correctly all along, and now stays that way.

Two mistakes in writing it, both of which produced a green sweep over a broken
panel, and both worth keeping because they are the general shape of a
measurement that does not measure:

- **Reading the wrong node.** A row's own last child is `StyleRow`'s wrapper,
  which carries `min-w-0` and can never overflow. Ask the whole subtree for its
  furthest-right edge instead — that cannot pick the wrong element.
- **An exclusion that excluded everything.** Skipping boxes inside a horizontal
  scroller is right; walking to `body` to find one is not. The panel scrolls
  vertically, and a computed `overflow-y: auto` turns a `visible` overflow-x
  into `auto` — so every descendant of the inspector looked exempt and the
  sweep passed having skipped all 457 boxes it had just measured. It was
  reporting `closest to the edge: -9999`, which is what caught it.

Falsified by restoring the one-line row: `When pressed +123px`, plus four
smaller spills in the same section.

### 4.1.15 And what looking turned up — a row 123px wider than the panel

Everything X8, X10 and X11 put in the press list was verified by reading the
DOM. For a 288px column that is half a check, and the half that was missing is
the one that decides whether any of it is usable.

The arithmetic, which had been done on paper and done wrong: the section's
content is 263px, the label column takes 62 and its gap 8, so a row has **215**.
The verb picker is a fixed 104. Two icon buttons and three gaps are 56. The
operand had **37px** — and no `min-w-0` on the row's inner flex container, so it
did not even shrink into them. Measured against the panel:

| | overhang |
|---|---|
| `Set a state` + a value picker | **16px** |
| `Copy text` + its field | **123px** |

The remove button on the second row was drawn past the edge of the panel.
`setState` with two states in scope put two pickers in those 37px and dropped
one off the end entirely; `navigate`'s "Uses the URL in Link" wrapped to four
lines and made the row four times as tall as its neighbour. X10's own note that
the row "has about twenty pixels to spare, not forty" was the wrong number
about the wrong thing.

The verb and its buttons keep the first line; the operand takes its own, which
is `w-full` inside a wrapping row — so a verb that needs no operand is still
one line and nothing is spent on it. The operand now has the full 215.

Three more things only a screenshot showed:

- **A picker whose value is not among its options renders as unset.** An
  `openPanel` on a page whose last popover was deleted read as *"Select…"* —
  a row that is set, drawn as a row that is not. That is the failure
  `DELETED_ELEMENT` exists to prevent in `testSentence`, in two more places:
  the verb picker, and a guard naming a control that is not a descendant,
  which fell through to *"a field"*. Both name what they hold now.
- **The refusal had no exit.** The guard editor only renders when the actions
  agree, so a list that disagreed showed the report and offered nothing to act
  on — the only repair was deleting the rows. One press now writes the first
  condition onto all of them.
- **The remover wrapped onto the sentence's last line**, landing beside
  "+ or" and reading as deleting that. A sentence grows and a box does not, so
  it belongs to the box.

**And the check that keeps it looked at failed to look, twice.** First it read
the row's own last child — which is `StyleRow`'s wrapper, and that carries
`min-w-0`, so it can never overflow: green against a row hanging 123px into the
void. Rewritten to ask the whole subtree for its furthest-right edge, it failed
at `overhang 28px, 135px` and passes at `0px, 0px`.

> **A layout claim needs a number, and the number has to come off the deepest
> thing in the box.** Three checks in this session passed while measuring
> nothing; each one was found by mutating the code it was written for.

### 4.1.13 And the third hand-listed vocabulary — two prop lists, drifted both ways

X10 found a write path filtering against a list of two verbs. X11 found an
affordance behind a `return`. Both are the same defect — a hand-written list
that stopped matching what it describes — so the next thing worth doing was to
look for another one rather than wait for it.

There were two, and they were the same question asked twice: `SETTABLE` in
`renderer/variants.ts` decided what a *rule* may vary, and a near-copy
`BINDABLE` array in the Data panel decided what a *record* may fill. The panel
intersected them at its only use — `BINDABLE.filter(isSettable)` — so the
second was the first plus one unwritten exception.

They had drifted in both directions.

**Three props short.** `summary` is the clickable line of a `<details>` — the
*question* in every FAQ anyone would build from a collection. `legend` is a
fieldset's caption. `poster` is a video's still image, sitting beside an `src`
and an `alt` that were both bindable. All three are content by the rule
`isSettable` states — the same element saying something else — and all three
were in neither list. And this was not a panel that would not offer the
control: `boundProps` gates on `isSettable` too, so a hand-written document
could not bind them either.

**One prop too many.** `title` was in both lists while being declared by no
element and read by no renderer. It cost more than a dead entry: `setsContent`
is true for any settable key, and one block wrote `set: { title: 'Closed' }` on
an 8px dot — under a comment reading *"the dot changes colour rather than
words, so its rule carries `apply` instead of `set`"*. The comment was right
and the code was not, and the dot published as **two** divs with a
`display:none` pair between them to vary a prop that never reached the markup.

So the answer is declared once in `document/content-props.ts` and derived
twice, with two lists — content and structure — that between them must cover
every prop an element ships with and every prop the panel writes. A prop in
neither fails the suite rather than defaulting to structure, which is the same
inversion `emptyAction` needed.

**The byte gate moved, for the first time in this arc.** Publishing is 227
bytes smaller and one duplicated element lighter on every page carrying an
opening-hours block. That is the difference being read rather than accepted:
the gate exists to make a change like this impossible to land unnoticed, and
what it caught was a page that had been publishing a hidden duplicate of a dot
since the block was written.

**And the check that catches it next time caught itself first.** Written as
`walk(spec, (node) => …)` over `Object.entries(BLOCKS)`, it reported
*"93 blocks, every set lands"* — while iterating nothing, because `walk` is a
generator and `BLOCKS` holds builders rather than trees. It passed against the
bug it was written for. What turned the second attempt's silence into a
failure was counting what it had looked at and asserting the count is not zero.

> **A check that reports how much it examined cannot pass by examining
> nothing.** Both halves of that sentence were needed here: the first draft
> failed silently, and the second failed loudly with `0 set keys`.

### 4.1.11 And what re-driving §1.8 turned up — AND and OR behind a `return`

X10 emptied the backlog, so the next thing worth doing was to take §1.8's table
— the audit's own definition of done — and try each row *in the panel* rather
than tick it off from the commit that closed it. Two of the nine were still
open, and they were the two the whole condition arc was for.

`testSentence` renders a leaf one of two ways. A comparison it draws itself; a
browser condition it hands to `conditionSentence` — and then **returns**:

```ts
if (test.kind !== 'compare') {
  parts.push(...conditionSentence({ … }));
  return parts;                                  // ← here
}
…
if (onChange && depth === 0 && seed) { …“+ and”… }   // ← never reached
```

So the affordance that turns one condition into two only ever appeared on a
comparison, and a comparison needs a record in scope. On a page with no
collection — most pages — adding *Pointed at* produced a sentence with nothing
to grow it by. X1 made the shapes reachable, X2 widened `when` to a `Test`, X3
taught the generator to compile an OR into a selector list, and the one button
that lets a designer write either of them sat below a `return`.

Nothing failed and nothing warned, for the usual reason: every check on AND and
OR seeded the document. The group grammar was proved, the compiler was proved,
the three-reading OR fixture was proved. What was never asked is whether the
panel can *write* one — the same question X10's write path failed, one file
along.

The second half was smaller and in the same place: there was no `+ or`. X3 put
OR in the model, in the generator and in this builder's group mode, and left
the only route to *either of these* running through *both of these* and then
the chip that changes it — three steps, the first of which writes a rule that
means the opposite. Both words are offered now, and each is one press.

> **Closing a gap in the model is not closing it in the product.** The audit
> table is the checklist, and the only honest way to tick a row is to do the
> thing a designer would do.

### 4.1.9 And what X10 turned up — a panel writing into a two-verb allowlist

X10 is a row on the press list, so the first thing to read is what the press
list writes through. It is `ops.setActions`, and it said:

```ts
const kept = actions.filter(
  (a) => (a.type === 'setState' && slug(a.value)) || (a.type === 'copy' && a.text)
);
```

Which was a complete description of the vocabulary on the day it was written.
X6 grew six more verbs and X8 put all eight in a menu, and this kept two of
them. **Every `toggleState`, `navigate`, `submit`, `openPanel`, `closePanel`
and `scrollTo` added from the panel was discarded on its way to the document.**
Not stored and ignored — discarded, so the row never appeared at all: the store
updates, the section re-reads the document, and the action is not in it.

Two things about how it survived X8 and X9 are worth keeping.

The first is that the panel *looked* right, and looked right in the way that is
hardest to catch: the menu is generated from the verb table, so it offered
exactly the eight verbs the compiler knows, and the static suite proved that
agreement. Both tables were correct. What was wrong was the pipe between them,
and no check went through it.

The second is that X9 chose, with a stated reason, not to drive the add menu:
*"driving the add menu would be driving `Select`, this app's own component
rather than a native one, and what that measures is the component."* That is
right about the widget and wrong about the coverage. The reason to click a menu
is not to test the menu; it is that the click is the only thing that runs the
write path. Seeding the document over HTTP tests the compiler and the renderer
against a shape the editor cannot actually produce.

> **A check that seeds the document tests everything downstream of the store,
> which is not the same as testing the editor.** If nothing exercises the write
> path, the panel and the model can agree perfectly and still not be connected.

The fix is the filter's *default*. It was an allowlist — a list of what to keep,
so anything unlisted was dropped — and it now names only what is empty:
`setState` with no value and `copy` with no text, the two that would make the
runtime do something wrong rather than nothing. Everything else is kept,
including an action whose reference names nothing, because `pruneRefs` empties
a reference rather than deleting the verb on purpose and a filter that dropped
it would undo that the next time any other row was edited.

The write path is now driven one verb at a time, by `ops.setActions` itself, so
a failure names the verb rather than reporting a count.

### 4.1.7 And what X9 turned up — a field X8 moved but did not remove

X9's check on the copy row read *two* fields where it expected one, and the
first version of it recorded that in its detail rather than asserting it away.
The reading was right: X8 moved the clipboard text out of `props.copyText` and
into a `copy` action, taught the press list to edit it, and left Content's
"Copies" row standing on top of the new storage.

Two text inputs holding the same string is bad on its own. What made it a bug
rather than a redundancy is that they did not write the same way. The row edits
the action **at its index** — `at(index, { ...action, text })`. Content's field
rebuilt the whole list:

```ts
setActions([...actions.filter((a) => a.type !== 'copy'), { type: 'copy', text }]);
```

So typing one character into the second field moved the copy to the **end** of
the ordered gesture and collapsed any two copies into one — silently, from a
panel whose subject is content, on a list whose entire point is that order is
authored. The two surfaces disagreed about the thing X8 exists to establish.

It is gone, and the check that found it now asserts `fields === 1` across the
whole inspector rather than `>= 1` in the row. The failure it guards against
was never a missing field; it was a second one. Falsified by putting Content's
row back: it fails, reading `2 field(s) hold it`.

> **A migration that moves storage is not finished until the old surface is
> gone.** Two editors over one value will drift, and the one that rebuilds
> loses what the one that patches was keeping.

### 4.1.5 And what X6 turned up — a reference no walk could see

Two of X6's own checks failed on the first run, and one passed for the wrong
reason. All three were the same defect.

`everyRef` is the function whose whole argument is that references are
*enumerable*: "deleting a panel used to leave every button that opened it
pointing at an id no longer in the document, because nothing enumerated the
references." It walked `node.refs` and expressions. It did not walk actions —
so the moment a verb could hold a reference, a block writing
`{ type: 'scrollTo', ref: namedRef('Features') }` got a name that nothing ever
resolved into an id, and published `href="#"`: a jump to the top of the page,
on an element that looks correctly wired from every angle except the file.

Worse, `resolveRefs` was reading `node.refs` for itself rather than going
through `everyRef`, so the one walk was not one walk at all. It is now, and
`pruneRefs` empties an action's reference rather than deleting the verb —
the same bargain expressions strike, so a designer whose panel was deleted sees
an Open button that names nothing rather than an Open button that vanished.

The check that *passed* is the more interesting half. It read
`/<a[^>]*href="#/`, which an unresolved jump satisfies perfectly — the exact
bug the verb exists to prevent, sailing through the check written to catch it.
It reads the target's own `id` out of the same file now, and compares the
anchor against the same design authored as a reference.

### 4.1 What X5 turned up on the way — a migration the room could not see

X5's browser check went green in every direction except one: the value it added
appeared in the panel, and was gone from storage. The reason is not in anything
X5 touched.

`hydrateDocument`'s docblock claims to be the one gate every document passes
through — "the editor, the collaboration client, the API, the publisher". The
room was not on that list. It held whatever JSON was in D1 and patched *that*,
while every client patched a migrated copy of the same bytes.

For years the difference was invisible, because every migration until X5
rewrote fields that already existed: `replace nodes/x/props/y` applies to
either shape. X5 is the first that **creates a nested object**, so the editor
sends `replace nodes/x/state/values` — a path with no parent in the room's
copy. `applyPatches` throws, the room answers `resync`, and the client
obediently discards its own edit and re-derives the old declaration from the
props it still has. Every subsequent edit does the same. Nothing errors,
nothing logs, nothing saves: the Switch section stops responding, permanently,
and only for documents written before the migration.

The fix is one function in `room.ts` — both doors a document arrives through, a
load from D1 and a whole-document write, now go through `hydrateDocument`. The
write path matters as much as the load: restoring a version writes an *old*
document by definition, so a restore into a live room reproduced this exactly.

Worth stating as a rule, because X6 is another migration:

> **A migration that creates a field the editor will patch into is not finished
> until the room runs it too.** The client-side upgrade is not enough, and its
> failure mode is silence.

---

## 5. What this deliberately does not do

- **No expression editor.** Bubble's modal expression composer is the worst
  part of Bubble. Everything here stays a sentence made of chips.
- **No server-side workflows.** No "create a thing", no API calls. The line is
  drawn at what a static file plus thirty lines of runtime can honestly do.
- **No unlimited nesting.** One level of grouping in the panel; the model
  holds deeper and renders deeper, and nothing authors it.
- **No new runtime for the common case.** If this plan makes a page that
  publishes no script today publish script tomorrow, it has failed, whatever
  else it achieved.

### 5.1 And `onSubmit`, which is a feature rather than a gap

§1.8's last row is the one thing the audit named and this arc did not build. It
is worth being exact about why, because "deferred" has been the answer for long
enough to look like an oversight.

**The lie is gone.** The audit's complaint was that `ElementDefinition.events`
promised `onSubmit` on every form while `actionsFor` defaulted to `onClick` and
no caller passed anything else. X6 withdrew the promise rather than half-build
it, which is the rule that stage set for itself. `EVENTS` holds one entry, and
a document that still carries an `onSubmit` binding — from a block, from a
hand edit, from an older release — publishes no attribute and ships no script,
and keeps the binding rather than having it silently deleted. Both halves are
checked, against `EVENTS` rather than against the string `onClick`, so the
guarantee cannot rot into a claim.

**What building it costs is not a listener.** Every action a form could
usefully run on submit — *show the thank-you, close the dialog* — is only
meaningful if the page does not navigate away, and a form submit is a
navigation. So there are three options and two of them are wrong:

- *Run the actions and let it navigate.* The state change is invisible: the
  page is replaced a moment later.
- *Run the actions and `preventDefault()`.* The form stops submitting. A
  designer who adds "show thank you" has silently broken their contact form
  and nothing on screen says so. This is the trap, and it is the easy
  implementation.
- *Run the actions and submit in the background.* Correct, and it is a new
  capability rather than a new listener: the published page makes a network
  request, which needs a pending state, an error state, a decision about where
  it is allowed to post, and a runtime budget argument. It also splits the
  scripted and unscripted visitor for the first time — same outcome, different
  page behaviour, which is what progressive enhancement means and is fine, but
  it has to be *said* rather than discovered.

That is a stage of its own, roughly the size of X6–X8 together, and none of it
is unblocked by more panel work. Recorded here so the next person reads a
decision instead of a silence.

**And then X17 found the thing that makes most of it unnecessary.** The reason
to want `onSubmit` at all is "say thank you once the form is sent", and that
round trip was already built, end to end, in both halves of the product:

- the publisher writes `?r=<path>` into the form's action, with a comment
  saying why — the sandboxed `/s/` origin sends no Referer, so without it the
  visitor lands on a bare page;
- the endpoint answers `303` back to that path with **`sent=1`** appended;
- the resolver turns that into `query.sent:1` on `<html>` before the first
  paint, and the generator compiles a condition on it to an ordinary selector.

So the thank-you is a *style rule on a visit*, with no event, no listener, no
interception and nothing for a visitor with scripting off to miss — the
redirect is the server's. What was missing was one chip: the sentence rendered
a data condition's source as an unclickable **word**, so whatever the When…
menu seeded is what it stayed, and the menu seeds `DATA_SOURCES[0]`.

`onSubmit` remains a real feature — a form that must *not* navigate, a pending
state, an error state. It is no longer the only way to do the common thing.
