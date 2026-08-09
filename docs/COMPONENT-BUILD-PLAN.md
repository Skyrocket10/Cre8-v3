# Cre8 — component build plan (Phases A–C)

`COMPONENT-LIBRARY.md` says *what* to build and *why*. This says *how*, in what
order, and what has to exist before the bulk of it starts.

Scope: the **49 components that need no new capability** — 37 marketing blocks
and 12 application blocks — plus the form submit target that unblocks 6 more.
Nothing here waits on the behaviour runtime or the data layer.

---

## 0. The problem with just writing 49 more blocks

`blocks.ts` is 1,305 lines for 9 blocks — about 145 lines each. Straight-lining
another 49 puts ~8,000 lines in one file, and most of it would be the same grid,
the same card, the same type scale, retyped. The library would be finished and
unmaintainable on the same day.

And there is a second, quieter problem: **the verification lives outside the
repo.** The nine Playwright harnesses that caught the unclosed `<div>`, the
reset specificity bug and this week's border divergence are in a scratchpad
directory. `package.json` has no test script at all. Adding 49 components to a
codebase with no checked-in tests is how the quality bar quietly drops.

So A0 and A1 come first. They are perhaps three days of work and they decide
whether the other six weeks produce something good.

---

## A0 — The authoring layer

### A0.1 Split the file

```
lib/templates/blocks/
  kit.ts        helpers, type scale, layout constants
  chrome.ts     navbar, footers, announcement, breadcrumbs, sidebar
  hero.ts       hero variants
  proof.ts      logos, stats, testimonials, case studies
  features.ts   feature grids, bento, steps, timeline
  convert.ts    pricing, CTA, forms
  trust.ts      FAQ, team, roles, prose, gallery
  editorial.ts  posts, article, byline, pagination
  commerce.ts   product, cart, checkout
  index.ts      the BLOCKS registry
```

`lib/templates/blocks.ts` becomes a re-export so nothing downstream moves in the
same commit as the split.

### A0.2 Grow the kit

The existing helpers — `pad`, `radius`, `border`, `section`, `container`,
`stack`, `heading`, `paragraph`, `label`, `button`, `icon` — cover about half of
what the current blocks actually do. The rest is hand-rolled per block and would
be retyped 49 times. Add:

| Helper | Why |
|---|---|
| `grid(name, columns, children, gap?)` | Features, pricing and testimonials each hand-roll this today |
| `card(name, children, styles?)` | Surface + border + radius + padding, used in most blocks |
| `media(ratio, alt)` | Placeholder-aware image with an aspect ratio |
| `avatar(size)` | Testimonials, team, byline, user menu |
| `badge(text, tone?)` | Pricing, tags, status |
| `chip(text)` | Categories, filters, integrations |
| `bullets(items)` | Icon checklists, pricing features |
| `step(n, title, body)` | Process blocks |
| `divider()` | Currently inlined |

Promote `sectionHeaderSpec()` from private to exported — it is already the right
abstraction and every new section wants it.

Extend the type scale so sizes stop being ad hoc. `EYEBROW`, `DISPLAY`, `TITLE`
exist; add `SUBTITLE` (24px), `BODY` (17px), `SMALL` (14px), `CAPTION` (12px),
each with its responsive pair.

**Test of whether A0.2 worked:** a new block should be roughly 40–60 lines, not
145.

### A0.3 Categories on the registry

```ts
export interface BlockDefinition {
  id: string;
  name: string;
  description: string;
  category: BlockCategory;   // new
  keywords?: string[];       // new — search hits that aren't in the name
  build: () => NodeSpec;
}
```

Categories: `chrome`, `hero`, `proof`, `features`, `convert`, `trust`,
`editorial`, `commerce`, `app`.

---

## A1 — Guardrails, checked in

### A1.1 Static checks — fast, no browser

Everything below is readable straight off the `NodeSpec` tree by walking
`build()` output. Runs in a second; belongs in `npm run lint`.

| Check | Fails when |
|---|---|
| Token discipline | A style value contains a raw hex, `rgb(`, or a hard-coded font stack |
| Responsive coverage | A block has no `tablet` or no `mobile` layer on any node that sets a layout property |
| Heading order | A block's heading levels skip a step internally |
| Alt text | An `image` has no `alt` prop, or one that does not read as an instruction |
| Interactive states | A `button` or `link` has no `hover` state |

This is the enforcement `COMPONENT-LIBRARY.md` §7 asks for. Good intentions held
at 9 blocks; they will not hold at 58.

### A1.2 Render sweep — browser, per batch

Move the nine scratchpad harnesses into `tests/` and add one more that sweeps
every block: insert into a blank page, publish, then assert

- markup is balanced (the check that caught the unclosed `<div>`),
- canvas ≡ published computed styles (the check that caught the border reset),
- no horizontal scroll at 390 / 768 / 1440,
- no element overflows its section at any of the three widths.

### A1.3 Scripts

```jsonc
"test":         "node tests/static/run.mjs",           // A1.1, seconds
"test:render":  "node tests/render/run.mjs",           // A1.2, needs wrangler dev
"test:blocks":  "node tests/render/blocks.mjs",        // the per-block sweep
"verify":       "npm run typecheck && npm run test"
```

Getting the existing harnesses into the repo is worth doing on its own merits,
independent of the component work.

---

## A2 — Insert panel at scale

Two things break at 58 blocks.

**The flat list.** Blocks render as one ungrouped column. Elements already have
category grouping and search; blocks have search only. Give blocks the same
`PanelGroup` treatment keyed on the new `category`, plus a recents row.

**`BlockGlyph`.** It is a hand-drawn map of bar geometry keyed by block id. It
will not survive 58 entries, and every hand-drawn wireframe is a small lie that
drifts from the block it depicts.

Replace it with a **live hover preview**: render the block's own `NodeSpec`
through the real renderer into a scaled-down frame. Zero drift by construction —
the preview cannot disagree with the block, because it *is* the block. This is
the same principle as one renderer, applied to the insert panel, and it is
cheaper than a build-time thumbnail pipeline because the renderer already exists
and already runs in this process.

Keep a generic per-category glyph as the resting state so the list stays fast;
render the real thing on hover.

---

## A3 — The blocks, in batches

Batched by family so the kit grows once per family rather than once per block.
Ordered so the pieces that everything else reuses get built first.

| # | Batch | Count | Components |
|---|---|---|---|
| 1 | Features | 6 | Alternating rows · Bento grid · Icon checklist · Process steps · Timeline · Integrations directory |
| 2 | Hero + CTA | 5 | Centred · Media background · Device frame · Video · CTA split with image |
| 3 | Proof | 6 | Logo marquee · Stats band · Single quote · Video testimonial · Case study cards · Rating badges |
| 4 | Chrome | 5 | Announcement bar · Breadcrumbs · Docs sidebar nav · Minimal footer · Back-to-top |
| 5 | Trust & media | 5 | Team grid · Open roles · Prose layout · Gallery grid · Masonry gallery |
| 6 | Editorial | 7 | Post card grid · Featured post · Article + TOC · Byline · Related posts · Tag chips · Pagination |
| 7 | Commerce | 3 | Product card grid · Product detail · Shipping/trust strip |
| 8 | Application | 12 | Field · Search field · Form layouts · Settings section · Stat card · Badge · Avatar group · Empty state · Skeleton · Alert · Spinner · Notification list |

**Batch 1 is first on purpose.** Feature layouts exercise `grid`, `card`,
`bullets` and `step` — the kit pieces batches 2–8 all lean on. Building it first
means the kit is proven by real use before 43 more blocks depend on it.

Post card grid and product card grid ship with static content in Phase A and
become collection-driven when the data layer lands. They are useful immediately
either way; a designer laying out a blog index does not need real posts.

---

## A′ — The form submit target

Five conversion blocks — hero email capture, newsletter, contact, demo request,
checkout layout — are decoration until a form has somewhere to POST. One
application block (auth screens) is in the same position.

Small and self-contained:

- `POST /api/f/:projectId/:formId` on the published-sites Worker
- a `submissions` table in D1 — project, form, payload JSON, timestamp, IP hash
- spam control: a honeypot field plus a per-IP rate limit
- a Submissions view in the editor
- `form` gains `action` and `successMessage` props

Build it after batch 2, so the conversion blocks land with working forms rather
than being revisited.

---

## Definition of done, per block

1. Every colour, space, radius and font comes from a theme token.
2. Tablet and mobile layers on every node that sets layout.
3. Hover states on everything interactive.
4. Correct landmark element and heading level for where the block sits.
5. Alt text placeholders that read as instructions to the designer, not `""`.
6. Passes the static checks and the render sweep at all three widths.
7. Appears under the right category, findable by search, with a working preview.
8. Copy that is plausible for a real site — placeholder text is what users judge
   the library by, and half of them will ship it unchanged.

---

## Sequence and rough shape

| Step | Work | Gate |
|---|---|---|
| A0 | Split the file, grow the kit, add categories | A new block is ≤60 lines |
| A1 | Static checks, harnesses into `tests/`, block sweep | `npm run verify` green |
| A2 | Insert panel categories + live hover preview | 58 blocks browsable without scrolling past everything |
| A3.1 | Batch 1 — Features | Kit proven by six real blocks |
| A3.2 | Batch 2 — Hero + CTA | |
| A′ | Form submit target | Conversion blocks actually convert |
| A3.3–A3.7 | Batches 3–7 — marketing | 46 marketing blocks total |
| A3.8 | Batch 8 — Application | |
| — | Two new templates exercising the new blocks | Blocks proven in composition, not just in isolation |

The last row matters more than it looks. A block that works alone and clashes
with its neighbours is not finished, and the only way to find that out is to
build real pages from them.

---

## Deliberately not in Phase A

Anything gated on a capability: the accordion and overlays wait for the native
primitives (Phase B), tabs and carousels for the behaviour runtime (Phase C),
collection-driven anything for the data layer (Phase D). Those are planned in
`COMPONENT-LIBRARY.md` §8 and should not be started early — pulling one forward
means faking it, and a faked interaction on the canvas is exactly the second
renderer this project exists to avoid.

---

## Phase B — native primitives (in progress)

Each of these is a schema row, a `describeElement` branch, an icon and an
inspector section. No runtime, and the same markup on all three surfaces.

| Primitive | Renders | Landed |
|---|---|---|
| `details` | `<details>` + owned `<summary>` | ✅ |
| `select` | `<select>` with options from a textarea | ✅ |
| `checkbox` / `radio` | `<label>` wrapping the input | ✅ |
| semantic tags | `tag` prop on the five layout boxes | ✅ |
| `popover` | `<div popover>` + `popovertarget` on a button | ✅ |
| `table` / `tableRow` / `tableCell` | `<table><tbody><tr><td\|th>` | ✅ |
| `range` | `<input type="range">`, themed with `accent-color` | ✅ |
| `file` | `<input type="file">` | ✅ |
| `progress` | `<progress>`, track and fill as ordinary node styles | ✅ |
| `fieldset` | `<fieldset>` + owned `<legend>` | ✅ |
| date / time | `inputType` on the existing `input`, not a new type | ✅ |
| `dialog` | `<dialog popover>` + `::backdrop` — see the limit below | ✅ |

### Two things B added beyond the primitives

**Containment.** `ElementDefinition` gained `allowedChildren` / `allowedParents`
and `schema.ts` gained `canContain()`. Drop targeting on the canvas, the layer
tree, the Insert panel and paste all resolve through it, so no gesture in the
editor can build a tree the HTML parser would rearrange. The reason it has to
be enforced rather than trusted: the canvas builds its DOM with React, which
puts elements exactly where it is told, while publishing writes a string that
the browser re-parses — and the parser moves a `<div>` out of a `<table>` and
discards a `<td>` with no row. Both silently. Blocks are written in code and
skip the editor entirely, so the same rule runs as a static check over every
block in the registry.

**`ElementModel.wrapChildren`.** `<table>` emits its own `<tbody>` rather than
leaving it to the parser, so the DOM React builds and the DOM the browser
parses are the same tree.

### Live controls on a canvas

Two of these act on the click that was meant to select them: a slider jumps to
wherever it is pressed, and a file field opens the operating system's picker
over the editor. Both are held back in edit mode by an attribute that cancels
the default and nothing else, so the event still reaches the canvas and does
the selecting. The guards are set only in edit mode, so they never reach a
published file — a check asserts that, because an inline handler in the output
would be both a bug and a CSP problem.

### The reset is a parity list

The slider found the second instance of a bug the border reset found the
first: **the canvas has Tailwind's preflight and a published page has
nothing.** Preflight sets `background-color: transparent` on every form
control, so on the canvas the slider had none and in production it had the
user agent's white — a white bar behind the track, invisible on a white page
and obvious on a dark one.

The reset's form-control block is now written as parity with preflight rather
than as a set of choices: placeholder colour and opacity, search decoration,
number spinners, `summary { display: list-item }`, and the control
background/radius/letter-spacing. Anything preflight does that the reset does
not is a difference between the two surfaces waiting to be found.

This class of bug is invisible to the block sweep, which compares elements —
a placeholder is a pseudo-element and no selector in the document can name it.
`tests/render/native.mjs` now compares those parts directly, and refuses to
pass when it finds nothing to measure.

### Design-time divergence, in one place and one shape

`<details>` is forced open on the canvas, and `[popover]` — which is both the
popover and the dialog — renders without the attribute. Both so their contents
can be reached and edited. These are the only places in the product where
design time and published differ on purpose,
each is one line in `describeElement`, each says so in the inspector, and each
is asserted in both directions by `tests/render/native.mjs`. The block sweep
skips closed popovers when it compares surfaces, and names them as the single
exemption rather than filtering silently.

### `<dialog>`, and the one thing it does not do

A dialog is opened by `popovertarget`, exactly as a popover is, so the page
still ships no script. `<dialog popover>` is valid and works: it opens, Escape
closes it, focus returns to the button, and it gets a `::backdrop`.

What it buys over a `<div popover>` is one thing, and that thing is the whole
reason it is a separate primitive: **it is announced as a dialog, by name.**
The accessibility tree reads `dialog "Delete this project?"` where the div
reads nothing at all. That is the same argument the table family makes — use
the element that means what you mean — and it is checked with an aria
snapshot rather than asserted.

**It is not modal.** `showModal()` is the only thing that makes the page
behind inert and traps the keyboard, and there is no attribute for it. So a
keyboard user can still tab out of this dialog into the page underneath. Three
ways that could have gone:

1. Ship a small inline script that calls `showModal()`. That breaks the
   zero-script property every render suite asserts, and — worse — it is
   precisely the "hand-written script beside a React canvas" that
   `ARCHITECTURE.md` §1 names as how a second renderer starts.
2. Fake modality in CSS. `:has()` plus `pointer-events: none` blocks the
   mouse and not the keyboard: a modal that looks complete and is not, which
   is worse than one that is honestly partial.
3. Ship the honest version and say so.

This is 3. The limitation is written in the inspector where a designer will
read it, and the native suite asserts the page behind is still reachable —
so the day the runtime lands and that check starts failing is the day the
dialog became modal.

### Backdrop styling, and where it lives

`::backdrop` is a pseudo-element hung off the node, which is mechanically the
same thing `:hover` is — one more selector on the node's class. So it went
into `states` rather than into a new field: one more path through the
generator, the inspector and the patch stream, to say the same sentence, is
not worth a cleaner label. The generator knows which keys take `::` instead
of `:`; `:backdrop` matches nothing, so getting that wrong would have meant
the page behind a dialog silently never dimming.

`ElementDefinition` also gained `defaultStates`, deep-copied on insert, so a
dialog arrives with its backdrop already on. A dialog that does not dim the
page is a box floating over a document that still looks live, and "add a
backdrop" is not a step anyone should have to know to take.

### B′ — the blocks these unlock

Landed with B: **Navbar with menu**, **Command menu**, **Data table**,
**Comparison table** rebuilt on real table markup, **Filter panel** (three
fieldsets, a slider, checkboxes, radios and a select), **Upload** (a real file
input with per-file progress) and **Confirm dialog**. The rest — drawer,
accordion variants, richer form layouts — is composition work with no
capability behind it.

Phase B is complete. What remains gated is modality, focus management and
anchor positioning — all of which want the runtime, not another primitive.


---

## Phase C — behaviour

The gated one. `COMPONENT-LIBRARY.md` §6 names the failure mode: behaviour is
where a second renderer grows, because the obvious shape is React state on the
canvas and a hand-written script in the output, and from then on tabs behave
differently in the editor than in production.

The plan there was "write exactly one runtime module and import it on all
three surfaces". What landed is a step further, and smaller.

### CSS does the work

A **switch** is three things:

- a **group** — `switchKey` on any container, holding a current value;
- **setters** — `switchSet` on a button, which set that value;
- **cases** — `switchCase` on anything, which exist only while the value
  matches.

The generator writes one rule per case:

```css
[data-cre8-switch="billing"]:not([data-cre8-value="annual"]) .c-abc { display: none; }
```

Specificity is the trick — `(0,3,0)` against the node's own `(0,1,0)`, so
hiding wins over whatever `display` the designer set, at every breakpoint,
with no `!important` anywhere. Changing state is then **one attribute write**,
and nothing has to agree about anything else: the canvas, preview and the
published page run identical rules over identical markup because there is one
mechanism, not one per surface.

That leaves the script with two jobs — write the attribute on click, and keep
`aria-pressed` honest. **725 bytes**, inlined only into pages that contain a
switch.

Consequences worth stating, because they are the argument for the design:

- **It works with JavaScript off.** The default case is styled correctly and
  both prices are in the markup. A crawler, a reader mode and a printed page
  all get something true. Checked with a scripting-disabled browser context.
- **No flash of the wrong state.** The selected pill is a generated rule keyed
  on the group's value, not something the script paints on after first paint.
  That is why `pressed` is not an ordinary interaction state — see below.
- **The hidden case is present, not absent.** Nothing is conditionally
  rendered away, so nothing has to be re-rendered to come back.

### The invariant that changed

"A published page ships no script" stopped being true, and pretending
otherwise would be worse than useless. What is asserted now is the narrower,
honest version, and it is checked in both directions: **a page with no
behaviour on it still ships nothing to execute**, and a page with a switch
carries exactly one inline script.

### Design-time state

An accordion is open or closed; a switch is on one case. Whichever case is not
showing is invisible, therefore unselectable, therefore unstylable — and the
obvious workaround, flipping the default to look at the other one, changes
what visitors see.

So there are two values. `switchDefault` ships. `switchDesign` is which case
the canvas is showing and never reaches a published file — asserted, because
"it does not leak" is exactly the kind of claim that quietly stops being true.

### `pressed` is not an interaction state

`StyleState` gained two members that are not pseudo-classes, and both are
handled apart from the generic `selector:state` path:

- `backdrop` → `::backdrop`, a pseudo-element (Phase B).
- `pressed` → **a rule on the group**, `[data-cre8-switch="k"][data-cre8-value="v"] .c-id`.

The second could have been `[aria-pressed="true"]`, which is simpler and
wrong: `aria-pressed` is set by the script, so the correct option would look
unselected until the script ran.

### Serialising the runtime

The published page gets the runtime through `Function.prototype.toString()`,
so the editor runs the same source it ships rather than maintaining a copy in
a template literal — which would be the second implementation this phase
exists to avoid.

The cost is a real constraint: the function must be **completely
self-contained**, every attribute name a literal, no references to anything
outside its own body. A bundler renames module-scope bindings, and a renamed
binding inside a serialised function is a `ReferenceError` on somebody's live
site. It is stated at the top of the file, and the render suite drives a real
published page built by the production minifier so a mistake there fails a
test rather than a visitor.

### Tabs

The state half of a tab set is the switch, unchanged. What `switchRole: 'tabs'`
adds is the half that makes it a tab set rather than buttons that hide things,
and all of it is applied by the runtime:

- `role="tablist"` / `role="tab"` / `role="tabpanel"`;
- each tab paired to its panel by `aria-controls`, and the panel back by
  `aria-labelledby`, with ids minted from the switch key and the case value so
  nothing has to be threaded through the renderer;
- `aria-selected` rather than `aria-pressed` — a tab is selected, and claiming
  both is worse than claiming one;
- **roving `tabindex`**, so the whole set is one tab stop instead of three;
- Left / Right / Home / End, activating on arrival, because showing a panel
  costs a class flip and making someone press twice buys nothing;
- `tabindex="0"` on a panel only when it contains nothing focusable, so a
  panel of prose is reachable and a panel with a link does not gain a stop.

**Why the roles are applied by the script rather than written into the
markup.** They announce an interaction, and the script is what makes that
interaction exist — with scripting off, a page that called itself a tab list
would be promising something it cannot do. Applying them at runtime also keeps
the renderer free of ancestor context: a setter would otherwise have to know
what kind of group encloses it, and the only ways to tell it are to walk the
tree in the renderer or to denormalise the fact onto every member.

The one thing that can still be wired wrong is two panels sharing a case
value, which would mint one id twice. A static check refuses it, along with a
panel that has no tab.

### C′ — what this unlocks

**Pricing with switch** and **Tabbed features** landed as the proof of each
half. Steppers, filter-by-category and segmented content are the same
mechanism with different labels. A carousel is not — it wants transforms and
gestures, and it should wait until there is a reason to build it rather than
a slot in a table.
