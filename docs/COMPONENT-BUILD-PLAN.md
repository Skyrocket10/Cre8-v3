# Cre8 — component build plan (Phases A and B)

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
| `dialog` | `<dialog>` — deferred, see below | |

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

### Design-time divergence, now twice

`<details>` is forced open on the canvas and `[popover]` renders without the
attribute, both so their contents can be reached and edited. These are the only
two places in the product where design time and published differ on purpose,
each is one line in `describeElement`, each says so in the inspector, and each
is asserted in both directions by `tests/render/native.mjs`. The block sweep
skips closed popovers when it compares surfaces, and names them as the single
exemption rather than filtering silently.

### Deferred: `<dialog>`

A modal is a popover that traps focus and blocks the page behind it. Everything
about authoring it — showing it open on the canvas, the backdrop, the close
affordance — is the popover work again, and `showModal()` needs a script where
`popovertarget` does not. It waits for Phase C so the trigger is one mechanism
rather than two.

### B′ — the blocks these unlock

Landed with B: **Navbar with menu**, **Command menu**, **Data table**,
**Comparison table** rebuilt on real table markup, **Filter panel** (three
fieldsets, a slider, checkboxes, radios and a select) and **Upload** (a real
file input with per-file progress). The rest — drawer, accordion variants,
richer form layouts — is composition work with no capability behind it.
