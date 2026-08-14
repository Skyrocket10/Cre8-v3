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

| | Bubble | Cre8 today |
|---|---|---|
| Style on hover | conditional row | ✔ |
| Style a checked checkbox | conditional row | ✘ impossible in the panel |
| Style a disabled or invalid control | conditional row | ✘ impossible in the panel |
| Style when a field is over a number | conditional row | 5 steps, 2 panels, an invented name |
| Hover **and** a tab is selected | conditional row | ✘ impossible in the panel |
| Either of two conditions | conditional row | ✘ not in the model |
| Press → close a menu **and** navigate | one workflow, ordered | 2 panels, no order |
| Press → but only when signed in | "Only when" on the action | ✘ not in the model |
| On submit → do something | workflow on the event | declared, unread |

---

## 2. What must survive

Everything below is a constraint the current design earned, usually by getting
it wrong once first. Any plan that breaks one of these is not a better plan.

1. **No script where CSS can do the work.** The behaviour runtime is thirty
   lines and inlined only into pages that need it (`behaviour.ts`). Whether a
   thing runs at publish time or in the browser is *derived* from what it
   reads — `foldable` (`test.ts:266`) — never chosen by a designer and never
   chosen by a panel.
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
| **X1** | Reach the seven unreachable condition shapes | nothing — ship first |
| **X2** | `StyleRule.when` becomes a `Test`; the planner; byte-identical output | — |
| **X3** | OR compiles to a selector list | X2 |
| **X4** | A comparison in a style rule mints its own state | X2 |
| **X5** | States are declared, not scraped | — |
| **X6** | Events become a registry; actions grow verbs | X5 |
| **X7** | `only` on an action | X6 |
| **X8** | One "When pressed" list, absorbing Link / Relative-to / Form | X6 |
| **X9** | Prove it in a browser; rewrite both docs | all |

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
