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

## What the stress template found

`templates/stress.ts` is the document that is not trying to look good. Five
pages, one per family of primitives, each given the content that breaks
layouts: a URL with no spaces, a seventy-four-character word, seven table
columns on a phone, an empty string, nine hundred words, and every value of
every enumerated property side by side. It exists to answer a question the
gallery cannot — *what can the element model not say?*

Seven gaps. **Five are now closed**, by twelve properties the vocabulary did
not have; two are still open, and one of those is much larger than the other
five put together.

Everything below is measured rather than argued. `tests/render/stress.mjs`
generates the site and reads it back through a browser, so each finding has the
same number behind it that it had as a gap, with the opposite expected value —
which is worth strictly more than asserting that a declaration reached the
stylesheet. It needs no Worker:

    node tests/render/stress.mjs        19/19

### Closed, with the measurement

**1. A string with no break opportunity could not be made to wrap.**
`overflowWrap`, `wordBreak` and `hyphens` are now *Long words*, *Breaking* and
*Hyphenate* in the Typography section.

The text page carries the before and the after side by side, because a fix is
only legible beside the thing it fixed: two 180px boxes holding the same
seventy-four-character word. The one with nothing set puts **348px of the word
outside its box**. The one set to *Break it* puts **0px** outside and grows from
39px tall to 102px, because the letters had to go somewhere.

The original diagnosis is worth keeping, because the obvious culprit was
innocent. A long *URL* mostly behaves — browsers take a break opportunity after
`/` and `?`, so it wraps unaided. The 732px of sideways scroll measured at 390px
was a single punctuation-free **word**: a product code, a hash, a German
compound, a database identifier dropped into a heading.

And the value that matters is `anywhere` rather than `break-word`, which is why
the menu offers it first. Both wrap the letters; only `anywhere` shrinks the
element's min-content width, which is what puts a blown-out grid column back.
`break-word` leaves the box asking for the whole word, so the text looks fixed
and the layout stays broken.

**2. No line clamping.** `lineClamp` is a row called *Cut off after*, and it is
the property the generator most has to translate rather than pass through: a
clamp is `display: -webkit-box`, a vertical box orientation, both spellings of
the line count and a hidden overflow, and any four of those five without the
fifth does nothing at all.

Three cards holding 40, 300 and 120 characters, clamped to two lines, measure
**38px each**; the same three strings unclamped measure **38, 244 and 94**. That
difference is the raggedness `workGridBlock` and `galleryBlock` had to solve
with alignment because the property for it did not exist. The clamped cards hide
**0, 206 and 56px** of content respectively, which is how the suite knows the
text is being cut rather than merely carrying a declaration.

`none` is a value rather than an absence, so a narrower breakpoint can lift a
clamp — clearing the row would inherit the wider layer's instead. `textOverflow`
sits beside it for the case a clamp cannot take: a table cell, whose `display`
is what makes it a cell. The trimmed cell fits **993px of text into 260px** on
one line.

**3. `scroll-margin-top` was a constant nobody could change.** It still defaults
to 96px for everything with an id, which is what makes a jump land below the
navbars this app produces — but it is a default now rather than the answer.
`scrollMarginTop` is *Jump stops at* in the Position section.

The layout page has two jumps: one to a section asking for 220px, one to a
section asking for nothing. The first lands **220px** down; the second computes
**96px**, from the reset, in the same stylesheet. The pair is the demonstration,
because one number on its own says nothing about whether it was chosen.

**4. No `order`, `justify-self` or `justify-items`.** Reordering on a phone no
longer means building both arrangements and hiding one. Five boxes sit in the
tree as 1–5 and the fifth carries an order of −1; the browser draws them
**5 1 2 3 4**.

One caveat worth writing down, because the first version of the demonstration
hit it: a frame's default width is 100%, so `justify-self` on one changes
nothing until it also stops asking for the full width. Placement has something
to place only when the item is not already filling its track — set both, and the
box measures **34px in a stretching grid**.

**5. No individual `rotate`, `scale` or `translate`.** `transform` is a list, so
a hover rule that lifts a card two pixels has to restate whatever scale the base
layer set, and a rule that forgets silently undoes it. These are three separate
properties that compose through the cascade: a rule writes the one axis it cares
about and the other two survive.

### Still open

**6. Nothing for internationalisation.** No `direction`, no logical properties
(`padding-inline`, `margin-block`). Every spacing decision in the library is
physical, so a right-to-left site would need every one of them mirrored by hand.
This is the largest gap by effort and the least likely to be noticed — and it is
what the other five were cheap in comparison to. The properties are a day; the
ninety-three blocks written in the physical ones are not.

One piece of it landed anyway, for a different reason. `hyphens: auto`
hyphenates by the nearest declared language, and only one of the three surfaces
has an `<html>` of its own — the canvas and preview draw inside the editor,
whose root says `en` because the editor is in English. So a German document was
hyphenated as English while being designed and as German once published. Each
surface now declares the document's language on the frame it already draws.

**7. Four primitives nothing exercises**, now covered by the stress template:
`richtext` (no block uses it at all), `spacer`, and `page`/`instance`, which are
structural. `dialog`, `file` and `range` appear exactly once each in ninety-three
blocks. Props nothing sets anywhere: `video.src`/`autoplay`/`loop`/`muted`,
`form.action`/`method`, `button.target`, `link.target`, `richtext.html`.

### What closing them turned up on the way

**A bug of the same shape in a property that shipped months ago.**
`textGradient` has always expanded to `color: transparent`, and `color` is a row
in the same panel — so a gradient set *before* a text colour lost to it, a
gradient set after won, and nothing anywhere said which had happened. The winner
was insertion order in the style object: whichever property was touched last.

`lineClamp` writes `display`, and `placeItems` is a shorthand over two rows
beside it, so three properties now have this shape and it wanted a rule rather
than three fixes. Expansions are ordered deliberately: a shorthand first, so a
longhand refines it, and the ones that are inert if they lose — a clamp with no
`display`, a gradient under a real colour — last. One declaration per property
survives, so the stylesheet no longer says a thing and then unsays it.

**Every table cell in the stress template was empty.** A cell holds *children*,
not a `text` prop — deliberately, so the words in it can be selected and edited
like words anywhere else — and the page's own helper wrote the prop. So the case
that exists to prove a seven-column table will not fit a phone was proving it
about a table with nothing in it, and had been since the page was written. The
markup was valid and the layout was plausible; the sideways-scroll measurement
passed for a reason that had nothing to do with the table. Found by asking a
browser how wide the text in one cell was and being told zero.

**The canvas renderer is handed an empty document, and it means it.** The
obvious way to give both surfaces the same language was `lang` on the page
node — one renderer, said once. `render.tsx` passes that renderer `{ pages: [] }`
cast into shape, deliberately, so it can memoise per node without depending on
the document; reading `doc.settings` through it threw on every page node and
took the editor down through its error boundary. The static suite stayed green
throughout, because it renders strings from real documents. Two comments in
`element-model.ts` say this and I read past both. It is a frame-level attribute
now, which `lang` being inherited makes free.

**An anchor is a prop, not a consequence of having a name.** A jump reference
resolves through `props.anchor`; a section with a name and no anchor is not a
place a link can point at, and the renderer *hides* the link rather than
pointing it at `#`. That is right — a Next button that does nothing is worse
than no button — and it looks exactly like a link that failed to render.

**A browser cannot scroll past the end of a document to satisfy a margin.** The
deep anchor was the last thing on its page and landed 231px down against 220
asked for, which reads as a broken property and is a short page. The group below
it is the runway, and the suite now reports whether the page was scrolled to its
end so the two can be told apart.

### The same audit, on the other half of the model

The stress template asks what the *style* vocabulary cannot say. Running the
question at element **props** instead found the shape of gap that produced
`STYLE_VOCABULARY` in the first place, still open on the side that never got a
table: 61 props across 35 element types, and three of them had no control
anywhere in the editor.

**A form could not say where it posts.** `action` and `method` are read by the
renderer — whose comment says "an action the designer typed always wins" — and
a form had no Content section at all, so there was nowhere to type one. Every
form this app has ever built posts to the project's own submissions endpoint,
because that was the only possibility. A site wanting Mailchimp, or its own
handler, or a `get` so a search result can be linked to, could not have one.

**A textarea could not say how tall it starts.** `rows` is the attribute a
textarea is sized by before any CSS touches it, which also makes it what the
box falls back to while the stylesheet is still loading.

Both are rows now, and the audit is a check rather than an afternoon of
grepping: every prop an element ships with must be reachable from the panel,
with one named exception — `instance.componentId`, which is deliberately read
and never written, because you do not retarget a component instance by typing
an id at it.

Two things about the check are worth keeping, because the first version of it
had both wrong. It tests *how the panel edits a prop* — `useNodeProp('x')` or
`setNodeProps({ x: … })` — rather than whether the word appears somewhere: a
bare-name search found `action` immediately, in `kind: 'action'`, which is an
expression effect and nothing to do with a form, and would have declared the
gap closed while it was open. And the exemption list is itself checked against
the model, because an exemption for a prop that no longer exists is one that
could be hiding a different prop with the same name.

### Checked and *not* gaps

- **Jump links do not land behind the sticky header.** The obvious guess, and
  wrong: the generator's global `scroll-margin-top` already handles it, and the
  headings measure visible on every jump in the startup template. The gap was
  the missing *control*, which is finding 3.
- **A wide table does not break the page.** Both the comparison table and the
  data table exceed 390px and both scroll inside their own `overflow-x: auto`
  container, with `documentElement.scrollWidth` equal to `clientWidth`. Every
  page of the stress template now measures 0px of sideways scroll at 390, 768
  and 1440.
- **The library composes without collisions.** Ninety-three blocks in one
  document: no duplicate DOM ids, no switch key declared twice on a page, no
  reference with more than one candidate in its own slot.
- **The clamp is not in the box model you would expect, and works anyway.**
  Chromium reimplemented `-webkit-line-clamp` on block layout and reports
  `display: flow-root` for an element the stylesheet gives `-webkit-box`. The
  first version of that check asserted the mechanism and went red against a page
  that was clamping correctly. It asks about the effect now — content taller
  than its box — which is what was meant.

---

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
