# Cre8 — component library plan

What to build, in what order, and — the part that actually decides the shape of
this — which things cannot be built until a capability exists that does not
exist yet.

**108 components: 63 marketing, 45 application.** 13 ship today. 49 of the rest
need no new capability at all and can start immediately; 6 need only a form
submit target; the remaining 40 are gated on the three capabilities in §3.

The build order for those first 49 is in
[COMPONENT-BUILD-PLAN.md](COMPONENT-BUILD-PLAN.md).

Read `ARCHITECTURE.md` first. Section 1 ("One renderer") is the constraint every
decision below is measured against.

---

## 1. Where we are

> Written when the library was 9 blocks and 22 primitives. Statuses are kept
> current; the reasoning is left as it was argued.

**22 primitives** — the element types the renderer knows:

```
page  section  container  frame  stack  grid  spacer  divider
heading  paragraph  text  richtext  link  button
image  video  icon  navigation
form  input  textarea  instance
```

**9 blocks** — `NodeSpec` trees in `lib/templates/blocks.ts`:

```
navbar  hero  logos  features  pricing  testimonials  faq  cta  footer
```

**8 templates** — `blank  saas  startup  agency  portfolio  restaurant
ecommerce  blog`.

The 9 blocks are good work and set the quality bar: 116 token references, 25
responsive style layers, 9 interaction-state layers. Everything below has to
meet that bar or it drags the product down rather than filling it out.

**Since:** 35 primitives (`details`, `select`, `checkbox`, `radio`, `popover`,
`dialog`, `table`, `tableRow`, `tableCell`, `range`, `file`, `progress`,
`fieldset` added in B) and 93 blocks across nine categories, held to that bar
by 2,818 static checks and 23 browser suites.

**The status column below was six months out of date and is now not.** It
said 52 of 109 rows built while 86 blocks shipped, because a row was ticked
when somebody remembered to and the names in the tables are not the names in
the registry — `Docs sidebar nav` is `Docs layout`, `Icon checklist` is
`Checklist`, `Legal / long-form prose layout` is `Prose page`. A plan that
stale is worse than none: it sends the next person to build Breadcrumbs a
second time. Every ✅ now names the block that answers it in the **Needs**
column, so the two can be reconciled by reading rather than by remembering,
and the six rows that turned out to be genuinely missing were built — five of
them forms, unblocked by A′ and never gone back for.

Two marks in the tables below mean something other than done-or-not-yet. `◐`
is something that ships and is partly gated — the dialog is a real `<dialog>`,
announced as one, but not modal until there is a runtime to call
`showModal()`. `✗` is a row that was **scoped wrong when this was written**:
the capability named in its **Needs** column cannot deliver it, whatever gets
built. Both are called out where they appear, because "not yet" invites
somebody to try and these two would waste their afternoon.

`✗` says *not with the capability this row named* — it has never meant "never".
One of the two was later built by adding the thing its own diagnosis asked for;
see §5.7, where the original note is kept and answered rather than rewritten.

---

## 2. Three tiers, and the rule for choosing between them

"Component" means three different things in this codebase, and conflating them
is how a library like this goes wrong.

| Tier | What it is | Where it lives | What it costs |
|---|---|---|---|
| **Primitive** | An element type the renderer knows | `document/schema.ts` + `renderer/element-model.ts` | Permanent surface area across schema, renderer, inspector, layer tree, drop targeting, publisher, a11y |
| **Block** | A `NodeSpec` tree inserted into the document | `templates/blocks.ts` | Data in an array. No runtime cost, and fully editable the moment it lands |
| **Pattern** | A page or multi-page arrangement of blocks | `templates/index.ts` | Data |

> **Rule: default to Block. Add a Primitive only when the DOM shape or the
> behaviour genuinely cannot be composed from the primitives we have.**

A primitive can never be removed without breaking documents already saved in
D1, and it has to be understood by six subsystems forever. A block is a value
in an array — wrong ones get deleted in a commit. Roughly 90% of what a
component library needs is composition, not new element types.

There is also a **cheap middle path** that avoids several primitives outright.
`resolveTag()` in `document/schema.ts` already picks a tag from props for
headings (`h1`–`h6`) and for links (`a` vs `button`). Extending that to a `tag`
prop on `container` and `section` — `article`, `aside`, `main`, `header`,
`footer`, `ul`, `ol`, `li`, `figure` — buys correct document semantics and
landmark structure for about a dozen lines plus one inspector select. No new
element types, no new renderer branches. Do this before adding any primitive
whose only job is a different tag name.

---

## 3. What actually gates the application set

Marketing components are layout, type, colour and imagery. They are composable
from the 22 primitives today. Nothing blocks them.

Application components are *stateful* — something opens, something is selected,
something sorts, something dismisses. And right now:

- published pages ship **zero JavaScript** (`lib/publishing/html.ts` emits no
  `<script>` at all);
- `NodeEventBinding` and `NodeDataBinding` exist in `document/types.ts` as
  **reserved extension points that are declared and not implemented**;
- `states` covers `:hover` / `:active` / `:focus` and nothing else.

So the application set is gated on capability, not on drawing more boxes. Three
ways to close the gap, cheapest first:

**(a) Native HTML.** `<details>`/`<summary>`, `<dialog>`, the `popover`
attribute, `<select>`, `<input type="date">`, `<progress>`. Zero JavaScript,
accessible and keyboard-operable by default, and — the part that matters most
here — behaves identically on the canvas and in the published file, so the
fidelity guarantee holds *for free*. This covers accordion, modal, drawer,
dropdown, tooltip and nearly every form control.

**(b) A behaviour runtime.** Implement `events` as declarative actions and emit
a small script only into pages that use one. Needed for tabs, carousels,
toasts, the monthly/annual pricing toggle, the mobile nav. See §6 — this is the
decision that has to be made deliberately, not drifted into. **Built**, and
deliberately: one module, ~3.6 KB minified, inlined only into pages that carry
a control. An action is a record that compiles to an attribute rather than a
script — see `lib/document/actions.ts` — so a control can name the state it
drives and run several assignments in one press without the runtime learning
what a CSS property is.

**(c) A data layer.** Implement `bindings` plus a repeater node. Needed for
anything driven by a collection: tables with real rows, blog indexes, product
grids, a CMS.

A fourth, smaller gap worth naming now: the `form` primitive exists but has
**no submit target**. Every contact, newsletter and demo-request block below is
decoration until a form has somewhere to POST. That is a Worker route plus a
submissions table, and it is small — but it should land with the conversion
blocks, not after them.

In the tables that follow, the **Needs** column refers to these letters.

---

## 4. Marketing

### 4.1 Chrome and navigation

| Component | Tier | Status | Needs |
|---|---|---|---|
| Navbar — links + CTA | B | ✅ | |
| Navbar — mega menu | B | ✅ | |
| Navbar — mobile drawer | B | ✅ | |
| Announcement / promo bar | B  | ✅ | Announcement bar |
| Breadcrumbs | B  | ✅ | Breadcrumbs |
| Docs sidebar nav | B  | ✅ | Docs layout |
| Footer — link columns | B | ✅ | |
| Footer — minimal + social | B  | ✅ | Minimal footer |
| Back-to-top | B  | ✅ | in Minimal footer |

The original navbar had no mobile behaviour — at narrow widths the link row
simply disappeared. "Navbar with menu" is the same bar with a `[popover]`
sheet behind the menu button: the browser handles the top layer, Escape, the
click outside and returning focus, and the published page still ships no
script. That was the most visible hole in the set, and it is the first thing
(a) bought.

### 4.2 Hero

| Component | Tier | Status | Needs |
|---|---|---|---|
| Hero — split copy + product shot | B | ✅ | |
| Hero — centred | B  | ✅ | Hero |
| Hero — media background | B  | ✅ | Photo hero |
| Hero — with inline email capture | B  | ✅ | Signup hero |
| Hero — device / browser frame | B  | ✅ | Device hero |
| Hero — video | B  | ✅ | Video hero |

`productShotSpec()` already builds a convincing browser frame. Promote it from a
private helper to a reusable piece rather than rebuilding it per hero.

### 4.3 Social proof

| Component | Tier | Status | Needs |
|---|---|---|---|
| Logo cloud | B | ✅ | |
| Logo marquee | B | ✗ | §9 — a keyframe timeline |
| Stats / metrics band | B  | ✅ | Stats band |
| Testimonial grid | B | ✅ | |
| Testimonial — single large quote | B  | ✅ | Pull quote |
| Testimonial — video card | B  | ✅ | Video testimonial |
| Case study card row | B  | ✅ | Case studies |
| Rating / review badges | B  | ✅ | Rating badges |

**The marquee is the third `✗`,** and it is ruled out by this document's own
§9 rather than by a missing capability. A row of logos scrolling for ever is a
continuous keyframe animation, and §9 says entrance and scroll effects are a
separate feature with their own model — `appear` is that model, it is one-shot
and driven by the scrollport, and it cannot express "never stop". Bolting a
`@keyframes` block onto a single block to get one would be the second styling
path §9 exists to refuse. `Logo cloud` and `Logo grid` cover the job the
marquee was wanted for, without asking a visitor's laptop to animate for as
long as the tab is open.

### 4.4 Features and explanation

| Component | Tier | Status | Needs |
|---|---|---|---|
| Feature grid — three column | B | ✅ | |
| Feature — alternating rows | B  | ✅ | Alternating rows |
| Bento grid | B | ✅ | |
| Icon checklist | B  | ✅ | Checklist |
| Process steps — numbered | B  | ✅ | Process steps |
| Timeline / roadmap | B  | ✅ | Timeline |
| Comparison table — vs competitors | B  | ✅ | Comparison table |
| Integrations directory | B  | ✅ | Integrations |
| Feature — tabbed showcase | B | ✅ | |

### 4.5 Conversion

| Component | Tier | Status | Needs |
|---|---|---|---|
| Pricing — three tier | B | ✅ | |
| Pricing — monthly/annual toggle | B | ✅ | |
| Pricing — comparison matrix | B  | ✅ | Comparison table |
| CTA panel | B | ✅ | |
| CTA — split with image | B  | ✅ | CTA with image |
| Newsletter capture | B  | ✅ | Newsletter |
| Contact — form + details | B  | ✅ | Contact |
| Demo / booking request | B  | ✅ | Demo request |

### 4.6 Trust, information and media

| Component | Tier | Status | Needs |
|---|---|---|---|
| FAQ — two column | B | ✅ | |
| FAQ — accordion | B | ✅ | |
| Team grid | B  | ✅ | Team grid |
| Open roles list | B  | ✅ | Open roles |
| Legal / long-form prose layout | B  | ✅ | Prose page |
| Gallery grid | B  | ✅ | Gallery |
| Masonry gallery | B  | ✅ | Masonry gallery |
| Lightbox | B | ✅ | |
| Carousel | B | ✅ | |
| Before / after slider | B | ✅ | see §5.7 |

### 4.7 Editorial

| Component | Tier | Status | Needs |
|---|---|---|---|
| Post card grid | B  | ✅ | Post grid |
| Featured post | B  | ✅ | Featured post |
| Article layout + table of contents | B  | ✅ | Article |
| Author byline | B  | ✅ | Author card |
| Related posts row | B  | ✅ | Related posts |
| Tag / category chips | B  | ✅ | in Blog header |
| Index that filters itself | B | ✅ | Filtered index |
| Pagination | B  | ✅ | Pagination |

### 4.8 Commerce

| Component | Tier | Status | Needs |
|---|---|---|---|
| Product card grid | B  | ✅ | Product grid |
| Product detail — gallery + buy box | B  | ✅ | Product detail |
| Cart summary / drawer | B | ✅ | |
| Checkout form layout | B  | ✅ | Checkout |
| Collection header + filters | B | ✅ | |
| Shipping / trust strip | B  | ✅ | Shipping strip |

**Marketing total: 63 blocks, of which 9 ship today.** Of the 54 remaining, 37
are pure composition over primitives that already exist, 5 need only the form
submit target, and 12 wait on a new capability.

Two of those 37 — the post and product card grids — are marked **c** above
because they get much better with a data layer. They do not wait for it: static
cards are useful the day they land, and a designer laying out a blog index does
not need real posts.

---

## 5. Application

### 5.1 Form controls

These are the honest primitives — real form semantics cannot be faked with a
`div`, and getting them wrong breaks keyboard users and autofill.

| Component | Tier | Status | Needs |
|---|---|---|---|
| Text input | P | ✅ | |
| Textarea | P | ✅ | |
| Form | P | ✅ | form target |
| Button | P | ✅ | |
| Select | P | ✅ | |
| Checkbox | P | ✅ | |
| Radio | P | ✅ | |
| Range slider | P | ✅ | |
| File upload | P | ✅ | |
| Date / time | P | ✅ | |
| Progress | P | ✅ | |
| Fieldset + legend | P | ✅ | |

### 5.2 Form composition

| Component | Tier | Status | Needs |
|---|---|---|---|
| Field — label + help + error | B | ✅ | |
| Switch | B | ✅ | |
| Segmented control | B | ✅ | |
| Search field | B | ✅ | |
| Form layouts — one/two column, inline | B  | ✅ | Form |
| Sign in / sign up / reset | B  | ✅ | Sign in |
| Settings section | B  | ✅ | Settings list |

### 5.3 Data display

| Component | Tier | Status | Needs |
|---|---|---|---|
| Table family — `table`/`tr`/`td`/`th` | P | ✅ | |
| Repeater / collection list | P | ✅ | shipped as a property, not a primitive — see §5.7 |
| Data table — filterable | B | ✅ | |
| Data table — sortable | B | ✗ | see §5.7 |
| Description list | P | ✅ | |
| Stat card | B  | ✅ | Stat cards |
| Badge / tag / pill | B  | ✅ | Badges |
| Avatar + avatar group | B  | ✅ | Members |
| Empty state | B  | ✅ | Empty state |
| Skeleton loader | B  | ✅ | Skeleton |

Charts are deliberately excluded — see §9.

### 5.4 Overlays

| Component | Tier | Status | Needs |
|---|---|---|---|
| Modal / dialog | P | ◐ | b for modality |
| Drawer / sheet | B | ✅ | |
| Popover | P | ✅ | |
| Dropdown menu | B | ✅ | |
| Tooltip | B | ✅ | |
| Toast | B | ✅ | |
| Command palette | B | ✅ | |

All of these ship. Every one except the toast is native platform behaviour —
the toast is a switch, because dismissing is a state and the runtime already
holds states. Building the rest on `<dialog>` and `popover` instead of on a
JavaScript overlay manager was the single biggest quality-per-effort win in
the application set: focus trapping, escape-to-close, the top layer and inert
backgrounds all come from the browser, correct on the first try.

The tooltip is the one to look at if you are wondering how far the native
route goes. It opens on click rather than hover — a hover-only tooltip is
unreachable by keyboard and unreachable on a phone — and the trigger stays a
button so it is in the tab order. That is not a compromise forced by the
platform; it is the behaviour the platform makes easy and the right one
anyway.

### 5.5 Navigation and disclosure

| Component | Tier | Status | Needs |
|---|---|---|---|
| Accordion | P | ✅ | |
| Tabs | B | ✅ | |
| Stepper / wizard | B | ✅ | |
| Pagination | B  | ✅ | Pagination |
| App shell — sidebar + topbar | B  | ✅ | App shell |
| User menu | B | ✅ | |

### 5.6 Feedback

| Component | Tier | Status | Needs |
|---|---|---|---|
| Alert / inline banner | B  | ✅ | Alerts |
| Spinner | B | ✗ | nothing to wait for |
| Progress bar | B | ✅ | |
| Notification list | B  | ✅ | Notifications |

**The spinner is the fourth `✗`,** and the reason is the same one that made
`Skeleton` worth building. A published Cre8 page is a file: by the time a
visitor sees it there is nothing still arriving that a spinner could be
spinning for. Every honest use of one is a placeholder for work the page is
not doing, and a component that exists to imply latency is a component that
lies about the product. `Skeleton` covers the case a designer actually reaches
for — showing the shape of content before it is there — and does it without
animating.

**Application total: 45 components — 18 primitives, of which 4 ship today, and
27 blocks.**

### 5.7 Three rows this document got wrong

Every other row in this document is either built or waiting on a capability
that is now named and understood. Three were not, in two different ways, and
both mistakes were made *here* rather than in the implementation.

Two rows promised a component to a capability that could not deliver it. They
were marked `✗`, meaning *not buildable as described* — a different thing from
*not built yet*, and worth its own mark because the second invites somebody to
spend an afternoon finding out. **One of the two has since been built**, by
adding the capability the row's own diagnosis called for; the note below is
kept as written and then answered, because a planning document that quietly
edits its wrong predictions is one nobody can calibrate against.

The third shipped, in a shape this document did not predict. That is the
quieter failure: nothing looks wrong, the row simply stays blank while the
thing it describes has been working for weeks.

**Before / after slider — not (b).** The behaviour runtime is a state machine
over named values: something holds `monthly`, a control sets `yearly`, a
generated CSS rule decides what is on screen. A divider dragged across a
photograph produces a *continuous* value, and there is nothing in that model
to hold one. What it would actually need is either a new kind of action —
pointer position written to a custom property — or a native control whose
value CSS can read, which the platform does not have.

A two-state *before / after toggle* is buildable today with the switch, and
would be a good block. It is not this block, and shipping it under this name
would be the near-duplicate problem §7 warns about, so it is left unbuilt
rather than quietly substituted.

> **Built, and the diagnosis above is why it could be.** The row asked for one
> of two things and got both halves of the first: a *continuous value* — a
> number a box holds as a custom property, written into the markup so the page
> has a position before any script runs — driven by a native
> `<input type="range">`. The second option, "a native control whose value CSS
> can read", is still not a thing the platform offers; what closed the gap is
> that the script writing one custom property is about six lines, and
> everything visible is still a rule the designer wrote.
>
> The paragraph was right about the model and right that composition would not
> get there. It was wrong only in treating "the runtime is a state machine over
> names" as fixed rather than as a thing that could grow one more kind of
> state. Worth recording: the reason this row sat unbuilt for as long as it did
> was a correct analysis of the *current* design read as a statement about the
> *possible* one.

**Repeater — built, but not as the row describes.** Listed here as a
primitive, an element type you insert. It shipped as `repeat` on the node
model: a *property* any container can carry, which turns that container into
one copy per record. Same capability, different shape, and the different
shape is better — a card, a table row and a whole section can each repeat
without three element types that differ only in what they wrap. Recorded
because the row reads as pending and is not, and because "we predicted an
element and built a property" is the sort of drift that quietly makes a
planning document untrustworthy.

**Data table, sortable — still not (b, c).** Unchanged by the continuous
value above, and worth saying plainly because the two rows were marked with the
same symbol: a sort order is not a number a slider moves, it is a different
arrangement of the same rows.

**The original note.** The filterable half is done and
now marked as such: a filter is exactly a named value, which is what the
switch is for. Sorting is not. Expressing it with switches means emitting one
`<tbody>` per sort order, which multiplies the markup by the number of
sortable columns and breaks the property the whole model is built on — that
content varies on *one* state, exclusively, so the expansion stays linear.
There is a static rule enforcing that, and it would rightly refuse this.

Real sorting wants one of two things, and the second is more interesting.
Either an action in the runtime that reorders DOM — a genuine extension, not
composition — or **edge rendering**, which `DATA-LAYER.md` §5 already names as
the documented upgrade for per-request data. A sort order is a query
parameter, a sorted table is a page rendered for that parameter, and it stays
indexable and works with scripting off. That is an architecture decision, not
a block, and it belongs in a stage of its own.

---

## 6. The runtime decision

Everything marked **b** depends on one choice, and it is the choice most likely
to damage the architecture if made carelessly.

The failure mode is written down in `ARCHITECTURE.md` §1: two renderers. A
behaviour runtime is exactly where a second one grows — the canvas fakes the
interaction with React state, the published page gets a hand-written script,
and from then on tabs behave differently in the editor than in production. That
is the same class of bug as the border reset fixed this week, except behavioural
and much harder to see in a screenshot.

> **Landed differently, and better — see COMPONENT-BUILD-PLAN.md, Phase C.**
> Step 1 happened as written. Step 2 did not need a module on three surfaces:
> a generated CSS rule per case does the showing and hiding, so the script is
> 725 bytes that write one attribute, and there is nothing for the surfaces to
> disagree about. Steps 3 and 4 landed as `switchDesign` and
> `tests/render/behaviour.mjs`.

**Recommendation — native first, then one shared module.**

1. **Take everything (a) will give.** Accordion, modal, drawer, dropdown,
   tooltip, lightbox, mobile nav, every form control. No runtime, no fidelity
   risk, better accessibility than we would write ourselves. This is most of the
   application set.

2. **When a runtime is unavoidable, write exactly one.** A single module —
   `lib/runtime/behaviour.ts` — that reads declarative `events` off
   `data-cre8-*` attributes. The canvas and preview import it; the publisher
   inlines the same source into pages that use it. One implementation, three
   surfaces, same rule as `element-model.ts` and `css.ts`. Budget ~3 KB, emitted
   only when a page actually binds an event. *(Done. The budget is a number in
   `tests/render/behaviour.mjs` and has been raised three times, each with its
   argument kept beside it, because a budget only means something if raising it
   costs something.)*

3. **Make design-time state authorable.** An accordion is open or closed; a tab
   set has one panel showing. The inspector needs a state selector that sets
   which one the canvas renders, without that choice leaking into the published
   file as a hard-coded default. Without this, stateful components cannot be
   designed — only guessed at.

4. **Extend the fidelity harness to behaviour.** It currently compares computed
   styles across 207 shared nodes. It should also drive the interaction on both
   surfaces and compare the result, so "the canvas behaves like production" is
   measured rather than asserted.

Cost estimate: (a) is small and incremental. (b) is roughly a week and should
not begin until the marketing set is done, because the marketing set proves the
block pipeline at scale first.

---

## 7. What a library this size needs that nine blocks did not

Going from 9 blocks to ~100 breaks things that currently work by being small.

**Insert panel scale.** `BLOCKS` renders as a flat list. Elements already have
categories and search; blocks have search only. At 64 marketing blocks a flat
list is unusable — blocks need the same category grouping, plus recents.

**Thumbnails.** A wall of text titles is not a component library. Every block
needs a preview image. Generate them from the renderer at build time rather than
drawing them by hand, or they will drift from the blocks the moment either
changes.

**Token discipline, enforced.** Blocks must be built from theme tokens
(`var(--c-primary)`, `var(--s-lg)`, `var(--r-md)`) so an inserted block adopts
the project's brand instead of importing a second one. The current blocks do
this well — 116 references. At 100 blocks it needs a lint rule, not good
intentions: fail the build on a raw hex or a hard-coded font stack inside
`blocks.ts`.

**Responsive by default.** Every block ships tablet and mobile style layers.
A block that only works at 1440 is a bug the user discovers after publishing.

**Accessibility by default.** Correct landmarks, one `h1` per page, heading
order that does not skip, alt text placeholders that read as instructions, and
visible focus states.

**A block regression harness.** The generalisation of what already exists: for
every block, insert it into a blank page, publish, and assert balanced markup,
canvas ≡ published computed styles, no horizontal scroll at 390 / 768 / 1440,
and no contrast failures. This is the harness that caught the unclosed `<div>`
and the reset specificity bug — pointed at the whole library it becomes the
thing that lets the library grow without rotting. **Build it during Phase A,
not after.**

---

## 8. Sequence

| Phase | Content | Capability needed | Why here |
|---|---|---|---|
| **A** | 37 marketing + 12 application blocks; block categories + previews; the block harness; the token lint | none | Largest visible gain, zero architectural risk. Proves the pipeline before it carries weight. Broken down in [COMPONENT-BUILD-PLAN.md](COMPONENT-BUILD-PLAN.md) |
| **A′** | Form submit target — Worker route + submissions table | small | Unblocks 6 blocks already built in A |
| **B** | Native primitives: form controls, table family, `<details>`, `<dialog>`, popover, `tag` prop on container/section | a | All native. Each one is a schema row plus a renderer branch, and behaves identically on all three surfaces. All landed, `<dialog>` included |
| **B′** | The ~25 blocks those primitives unlock: accordion, overlays, form composition, comparison tables | a | Composition only, once B lands |
| **C** | Behaviour runtime, design-time state, behavioural fidelity harness | b | The gated one. §6 |
| **C′** | Tabs ✅, pricing toggle ✅, stepper ✅, filter ✅, install tabs ✅, command palette ✅ (native), toasts ✅, carousel ✅ | b | Complete. The carousel chooses a slide by CSS rule rather than animating between them — see the build plan |
| **D** | Data bindings + repeater | c | Unlocks real tables, blog indexes, product grids, CMS. Scoped in [DATA-LAYER.md](DATA-LAYER.md) — it makes eighteen existing blocks real rather than adding new ones |
| **E** | Patterns: dashboard, settings, auth flow, docs site, changelog, store, help centre | — | Multi-page arrangements of everything above |

### Where the popover stops short

`[popover]` gives the top layer, light dismiss, Escape and focus return for
nothing. What it does not give, without CSS anchor positioning, is a panel
that sits *under the button that opened it*: a top-layer box with no anchor
resolves against the viewport, so `top: 100%` means 100% of the screen. The
primitive is therefore shipped as what it natively is — a centred or
edge-anchored sheet — which covers command menus, mobile nav, cookie notices
and filter panels, and does not pretend to cover an inline dropdown.

Closing that gap properly means modelling the anchor as a relationship
between two nodes and generating `anchor-name` / `position-anchor` from node
ids, because a hand-written anchor name collides the moment a block is used
twice on one page. That is a small feature in its own right, not a block
detail, and it belongs with B′.

Phase A is done. B is in progress and needs no decisions that have not already
been made.

---

## 9. Deliberately not in scope

**Charts.** A charting engine is a product, not a component. Embed instead.

**A rich animation timeline.** Scroll and entrance effects are a separate
feature with their own model; bolting keyframes onto blocks would create a
second styling path.

**Third-party embeds as first-class components.** One `embed` primitive with a
URL beats twenty branded wrappers that rot as the vendors change.

**Per-framework code export.** Publishing writes HTML and CSS. React or Vue
output would be a second renderer, which §1 forbids.
