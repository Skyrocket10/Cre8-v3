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
`fieldset` added in B) and 67 blocks across nine categories, held to that bar
by 906 static checks and 14 browser suites. `◐` marks something that ships and
is partly gated — the dialog is a real `<dialog>`, announced as one, but not
modal until there is a runtime to call `showModal()`.

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
decision that has to be made deliberately, not drifted into.

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
| Navbar — mega menu | B | | a |
| Navbar — mobile drawer | B | ✅ | |
| Announcement / promo bar | B | | |
| Breadcrumbs | B | | |
| Docs sidebar nav | B | | |
| Footer — link columns | B | ✅ | |
| Footer — minimal + social | B | | |
| Back-to-top | B | | |

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
| Hero — centred | B | | |
| Hero — media background | B | | |
| Hero — with inline email capture | B | | form target |
| Hero — device / browser frame | B | | |
| Hero — video | B | | |

`productShotSpec()` already builds a convincing browser frame. Promote it from a
private helper to a reusable piece rather than rebuilding it per hero.

### 4.3 Social proof

| Component | Tier | Status | Needs |
|---|---|---|---|
| Logo cloud | B | ✅ | |
| Logo marquee | B | | |
| Stats / metrics band | B | | |
| Testimonial grid | B | ✅ | |
| Testimonial — single large quote | B | | |
| Testimonial — video card | B | | |
| Case study card row | B | | |
| Rating / review badges | B | | |

### 4.4 Features and explanation

| Component | Tier | Status | Needs |
|---|---|---|---|
| Feature grid — three column | B | ✅ | |
| Feature — alternating rows | B | | |
| Bento grid | B | | |
| Icon checklist | B | | |
| Process steps — numbered | B | | |
| Timeline / roadmap | B | | |
| Comparison table — vs competitors | B | | table primitives |
| Integrations directory | B | | |
| Feature — tabbed showcase | B | | b |

### 4.5 Conversion

| Component | Tier | Status | Needs |
|---|---|---|---|
| Pricing — three tier | B | ✅ | |
| Pricing — monthly/annual toggle | B | | b |
| Pricing — comparison matrix | B | | table primitives |
| CTA panel | B | ✅ | |
| CTA — split with image | B | | |
| Newsletter capture | B | | form target |
| Contact — form + details | B | | form target |
| Demo / booking request | B | | form target |

### 4.6 Trust, information and media

| Component | Tier | Status | Needs |
|---|---|---|---|
| FAQ — two column | B | ✅ | |
| FAQ — accordion | B | | a |
| Team grid | B | | |
| Open roles list | B | | |
| Legal / long-form prose layout | B | | |
| Gallery grid | B | | |
| Masonry gallery | B | | |
| Lightbox | B | | a |
| Carousel | B | | b |
| Before / after slider | B | | b |

### 4.7 Editorial

| Component | Tier | Status | Needs |
|---|---|---|---|
| Post card grid | B | | c for real data |
| Featured post | B | | |
| Article layout + table of contents | B | | |
| Author byline | B | | |
| Related posts row | B | | |
| Tag / category chips | B | | |
| Pagination | B | | |

### 4.8 Commerce

| Component | Tier | Status | Needs |
|---|---|---|---|
| Product card grid | B | | c for real data |
| Product detail — gallery + buy box | B | | |
| Cart summary / drawer | B | | b, c |
| Checkout form layout | B | | form target |
| Collection header + filters | B | | b |
| Shipping / trust strip | B | | |

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
| Switch | B | | a |
| Segmented control | B | | a |
| Search field | B | ✅ | |
| Form layouts — one/two column, inline | B | | |
| Sign in / sign up / reset | B | | form target |
| Settings section | B | | |

### 5.3 Data display

| Component | Tier | Status | Needs |
|---|---|---|---|
| Table family — `table`/`tr`/`td`/`th` | P | ✅ | |
| Repeater / collection list | P | | c |
| Data table — sortable, filterable | B | | b, c |
| Description list | P | ✅ | |
| Stat card | B | | |
| Badge / tag / pill | B | | |
| Avatar + avatar group | B | | |
| Empty state | B | | |
| Skeleton loader | B | | |

Charts are deliberately excluded — see §9.

### 5.4 Overlays

| Component | Tier | Status | Needs |
|---|---|---|---|
| Modal / dialog | P | ◐ | b for modality |
| Drawer / sheet | B | | a |
| Popover | P | ✅ | |
| Dropdown menu | B | ✅ | |
| Tooltip | B | | a |
| Toast | B | | b |
| Command palette | B | | b |

Every one of these except toast and the command palette is native platform
behaviour now. Building them on `<dialog>` and `popover` instead of on a
JavaScript overlay manager is the single biggest quality-per-effort win in the
application set: focus trapping, escape-to-close, the top layer and inert
backgrounds all come from the browser, correct on the first try.

### 5.5 Navigation and disclosure

| Component | Tier | Status | Needs |
|---|---|---|---|
| Accordion | P | | a |
| Tabs | B | | b |
| Stepper / wizard | B | | b |
| Pagination | B | | |
| App shell — sidebar + topbar | B | | |
| User menu | B | | a |

### 5.6 Feedback

| Component | Tier | Status | Needs |
|---|---|---|---|
| Alert / inline banner | B | | |
| Spinner | B | | |
| Progress bar | B | | a |
| Notification list | B | | |

**Application total: 45 components — 18 primitives, of which 4 ship today, and
27 blocks.**

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
   only when a page actually binds an event.

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
| **B** | Native primitives: form controls, table family, `<details>`, `<dialog>`, popover, `tag` prop on container/section | a | All native. Each one is a schema row plus a renderer branch, and behaves identically on all three surfaces. Landed so far: `details`, `select`, `checkbox`, `radio`, semantic tags, `popover`, `table`/`tableRow`/`tableCell`. `<dialog>` deferred — see below |
| **B′** | The ~25 blocks those primitives unlock: accordion, overlays, form composition, comparison tables | a | Composition only, once B lands |
| **C** | Behaviour runtime, design-time state, behavioural fidelity harness | b | The gated one. §6 |
| **C′** | Tabs, carousel, toast, pricing toggle, stepper, command palette | b | |
| **D** | Data bindings + repeater | c | Unlocks real tables, blog indexes, product grids, CMS |
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
