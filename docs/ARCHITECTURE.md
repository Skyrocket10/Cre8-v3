# Cre8 — architecture

This describes the decisions that were hard to reverse, and why they were made
that way. It assumes you have read the README.

---

## 1. One renderer

The most common way a visual builder rots is by growing two renderers: a
design-time approximation and a "real" output path. They diverge, and every
feature then costs twice and looks different in each.

Cre8 has one. Two modules define everything about how a node becomes markup:

| Module | Answers |
|---|---|
| `lib/renderer/element-model.ts` | What tag, what attributes, what content? |
| `lib/renderer/css.ts` | What CSS rules, under what at-rule? |

Three consumers sit on top:

- `lib/renderer/render.tsx` — React, used by the canvas and preview
- `lib/publishing/html.ts` — strings, used to write published files
- the canvas's `<style>` tag and the published `<style>` block, both from
  `generateNodeCss`

Adding an element type means adding a row to `lib/document/schema.ts`. The
renderer, insert panel, layer tree, inspector, drop targeting and publisher all
read from that table.

### The container-query trick

Responsive editing has an awkward physical problem: a page frame inside the
canvas is 390px wide, but `@media (max-width: 640px)` is evaluated against the
*browser window*, which is 1600px. Most editors work around this by resolving
the cascade in JavaScript and writing flattened inline styles — at which point
the canvas is no longer running the CSS that will ship.

Instead, the CSS generator takes a `mode`:

```ts
generateNodeCss(nodes, { mode: 'container' })  // editor + preview
generateNodeCss(nodes, { mode: 'media' })      // published output
```

Container mode emits `@container cre8 (max-width: 640px)`; the page frame
declares `container-type: inline-size; container-name: cre8`. The rules, the
selectors, the cascade order and the breakpoints are byte-identical between
modes — only the at-rule differs. The browser evaluates them, not us.

This is verifiable rather than aspirational: the same heading measures 34px at
mobile in the canvas and 34px in the published page.

---

## 2. The document

One plain object, fully JSON-serialisable, in `lib/document/types.ts`.

```
Cre8Document
├── pages[]        { id, name, slug, rootNodeId, order, meta }
├── nodes{}        normalised across pages *and* component masters
├── assets[]
├── components[]   { id, name, rootNodeId }
├── theme          colours, fonts, text styles, spacing, radii, shadows, widths
└── settings
```

A node:

```
SceneNode
├── id, type, name, parentId, children[]
├── props          text, src, href, level…
├── styles         { desktop, tablet?, mobile? }   ← desktop-first cascade
├── states         { hover?, active?, focus? }
├── meta           locked, hidden, componentId
├── events?        RESERVED — behaviour layer
└── bindings?      RESERVED — data layer
```

**Normalised, not nested.** Children are ids, so changing a deep node produces a
new object only for that node — its ancestors are untouched. That is what lets
every rendered element subscribe to its own node and re-render alone.

**Desktop-first cascade.** `desktop` is the base; narrower breakpoints hold
overrides. It matches how designers think ("on mobile, make it smaller") and
maps directly onto max-width rules with no translation step.

**Tokens are CSS variables.** A token reference is literally
`var(--c-primary)`. There is no resolution pass, tokens survive serialisation
and hand-editing, and retheming a site is one rule change instead of a tree
walk.

---

## 3. Every change is a transaction

`lib/history/history.ts`. Nothing mutates the document directly; everything goes
through `store.transact(label, recipe)`, which runs the recipe under immer's
`produceWithPatches` and records the forward and inverse patches.

```ts
store.transact('Add Section', (draft) => {
  const id = insertElement(draft, 'section', parentId, index);
  return id ? [id] : undefined;   // returned ids become the new selection
});
```

Three things fall out of this that are painful to add later:

- **Exact undo**, including selection and active page restoration.
- **Coalescing.** A `mergeKey` folds consecutive transactions inside a 700ms
  window into one entry, so dragging a slider is a single undo step rather than
  ninety.
- **A description of what changed.** Patches are the natural wire format for a
  future collaboration layer, and the natural output format for an AI that
  edits documents.

The document operations themselves (`lib/document/operations.ts`) are plain
functions over a mutable document. They know nothing about React, selection or
the store, so the same function serves a click, a keyboard shortcut, a drag and
— later — a generated edit.

### 3b. One catalogue of commands

`lib/editor/commands.ts` is the layer above that: one entry per thing the editor
can be asked to do to the selection, and the entry is the whole description of
it — its wording, its chords, when it is available, and what it runs.

```ts
duplicate: {
  id: 'duplicate',
  label: 'Duplicate',
  keys: ['mod+d'],
  enabled: movable,
  run: (ctx) => ctx.store.duplicateSelection(),
},
```

Every `run` is a call into the store, and nothing else. A command that wanted
its own `transact` would be a store action nobody had written yet, which is
exactly how `arrangeSelection`, `alignSelection`, `detachSelection` and
`createComponentFromSelection` arrived — lifted out of the surfaces that had
each grown a private copy. Two of those copies had already drifted: the
inspector's Detach handled one instance, the toolbar's Create component made
its own transaction with a different label.

Three surfaces read from it and none of them has a table of its own:

- The **keyboard layer** hands each event to `dispatchChord` and stops if a
  command claimed it. What is left in `shortcuts.ts` is the editor rather than
  the document: zoom, panels, the breakpoint, saving, publishing.
- The **context menu** is a list of command ids (`lib/editor/menus.ts`). It
  cannot hold an action, only a reference to one, so "the menu does not
  reimplement editor commands" is a property of the type.
- The **help popover** generates its shortcut list from the same bindings, so
  it cannot describe a chord that no longer exists — which the hand-written
  version it replaced had already started to do.

A menu item names a command; it can also name a **subject** — what was
right-clicked, never what to do about it. `{ kind: 'style', props, label }` is
how the inspector says "this was the padding row", which is what lets Reset
mean the padding rather than every declaration the element has. `StyleRow`
stamps the declarations it owns into the DOM and one delegated handler on the
panel root reads the nearest of them, so no control knows anything about menus.
A row that never said falls back to the element's menu, and a text field keeps
the browser's own — cut, paste and spelling are not ours to reimplement.

The same mechanism reaches every panel. A page, a component, one of its
variants, an asset, a collection, one of its fields, a theme token, a block and
an element card are each a subject kind with a menu of its own — which meant
lifting what those panels had been doing inline. Five of the six write no
transactions at all now; the only one left in Assets is the file upload, and
the only `ops.` call left in Collections is `retypeCost`, which is a question
rather than an edit. Two things fell out of that which were not equal before —
creating a component from ⌘E, the canvas menu and the panel's Create button is
now one action that also asks for a rename, and an asset dropped on the canvas
produces the same node as one placed from its menu, because the drop controller
had been building its own.

A record is the one subject that is not in the document at all — content lives
in D1 — so its commands resolve from `store.records` and every one of them is a
round trip. That is also why Duplicate makes a *draft*: writing a published
record republishes the site on its own, so inheriting `published` would put a
second copy of somebody's post live the moment they asked for something to work
from.

Building it surfaced a bug older than the menu. The editor's storage adapter
asked for records with `publishedOnly: true` welded in, so the Collections
panel could not list a draft — including one it had just created, which looked
exactly like Duplicate silently failing. The flag is now the caller's, and the
default is the safe one: the publisher and the ZIP export take it and ship no
drafts, the editor asks for everything explicitly. A static check pins both
halves, because either one alone is a bug — an editor that hides your work, or
a publisher that ships it.

One place the catalogue deliberately holds two entries for one store call:
`insert`/`insertChild` name the element type, because they appear under a
parent row that already says "Add element"; `insertOnPage`/`insertInSelection`
name the *destination*, because on an Insert-panel card the type is what you
right-clicked and where it lands is the only thing left to say. Two rows both
reading "Heading" is a worse menu than none.

The subject travels with the command when it runs. That is worth stating
because getting it wrong is silent: `runCommand` rebuilds the context against
live state, and rebuilding it without the subject left every property command
failing its own availability check and returning. Reset padding looked
perfectly wired and did nothing.

The shortcut a menu prints comes from the chord that runs it, so the two cannot
disagree. That is also why bindings avoid shifted punctuation: `Shift+]` arrives
as `}`, so a binding written as `mod+shift+]` would be printed and never fire.
The editor had exactly one of those — ⇧⌘\ for the inspector — and it had never
worked. A static check now rejects the shape.

---

## 4. Performance

Targets: 1,000+ nodes, no perceptible lag.

**Per-node subscriptions.** The renderer reads nodes through an *engine*
(`RenderEngine.useNode`). The canvas supplies one backed by the store; preview
supplies one backed by a snapshot. Since the node map is normalised, a style
change re-renders exactly one component.

**Memoised CSS.** Per-node rules are cached in a `WeakMap` keyed on the node
object. Immer only allocates a new object for nodes that changed, so
regenerating the stylesheet costs the size of the edit, not the size of the
document.

**Windowed layer tree.** Only rows in view are mounted.

**Overlays outside the transform.** Selection boxes, handles and guides are
drawn in viewport pixels on a layer above the scaled canvas, so strokes stay 1px
at any zoom and overlay updates never touch the document.

**Measured, not modelled.** Geometry comes from `getBoundingClientRect` on real
elements via `lib/editor/registry.ts`, re-measured on a store token, a
`ResizeObserver` and registry changes. A flow-layout editor cannot maintain a
parallel geometry model without eventually disagreeing with the browser.

**Debounced persistence.** 900ms after the last change, plus a flush on
page-hide.

### What a published page weighs

The editor's performance is about the document; a visitor's is about the file.
The SaaS template — four pages, every block type — publishes at **105 KB**,
down from 163 KB, and its home page is **44 KB** with a **24 KB** stylesheet.
Three changes, in descending order of what they are worth *after compression*,
because Cloudflare gzips on the way out and raw bytes are not what a visitor
waits for:

**Node ids cut to four characters, at publish only.** Ten random characters of
`[a-z0-9]` are the highest-entropy bytes on the page and the only ones that
barely compress; they are also paid twice, in the stylesheet and on every
element. Four characters is ample for one page's few hundred nodes, and an id
whose prefix collides keeps its full length. The canvas keeps the full id: its
caches are keyed on node identity, and renumbering on every insert would cost
more than the bytes are worth. A prefix — rather than a rename to `a`, `b`,
`c` — keeps the `c-` namespace that stops a generated class colliding with
`customHead`, and stays reproducible from the id alone, which is how the render
suite maps one surface's class to the other's.

**Rules that say the same thing share a selector.** Only within a phase: in
the base layer and in each breakpoint layer, every node contributes at most one
rule and every selector is a different node's class, so nothing can be
reordered relative to anything it overlaps. The conditional phase has neither
property and is printed as it stands — since §1's rule ordering *is* the
cascade, merging there would change what wins.

**Four-sided longhands collapse.** `padding`, `margin` and `border-radius`,
when all four sides are present and none is multi-valued. Done in
`declarationsToCss`, so every surface emits it and there is no publish-only
transform for the canvas to disagree with.

Two things were measured and dropped: shortening numbers and hex colours won
96 bytes, and pruning unreferenced classes won none — every generated class is
used.

### Images

The stylesheet is the page's second-largest thing. The images are the first,
and all four of the decisions that matter are made in the browser at upload,
because a Worker has no image codecs, the file is already in memory, and the
person who chose it is the one who waits.

**WebP, whatever arrived.** Previously only images with transparency were
re-encoded to WebP and photographs stayed JPEG. Now everything does, behind a
capability probe — `toDataURL` does not throw for a format it cannot encode, it
quietly returns a PNG, and shipping that under a `.webp` name produces a file
whose label and bytes disagree. Two exceptions, neither about size: a GIF loses
its animation on a canvas round-trip, and a WebP already under the ceiling
would be re-encoded from something already lossy.

**A ladder of narrower copies** at 480, 960 and 1440, skipping any rung wider
than the source so nothing is upscaled. Encoded from the same decode as the
original and uploaded alongside it, named for their width — an object in a
bucket outlives the row describing it. Hosted only: with no backend each
variant would be another data URL in a document that has to fit in IndexedDB.

**Intrinsic size and `srcset` recorded on the node** when the image is picked,
not looked up at render time — the canvas renderer is deliberately given no
document, which is what keeps a style change re-rendering one element. The
`width`/`height` attributes are the intrinsic pixels; they do not size
anything, they give the browser the ratio so the space is reserved and the page
stops jumping as images arrive.

**`sizes` derived from the node's own widths.** A `srcset` with no `sizes` is
often *slower* than none at all, because the browser assumes the image fills
the viewport and takes the widest file. A node with fixed pixel widths per
breakpoint is already the media list `sizes` wants, so it is written out
directly; anything the cascade decides gets `auto`, which asks the browser to
use the size it actually laid out.

**And a control for what loads eagerly.** Lazy-loading is the right default and
the wrong universal: the largest image above the fold is usually what a visitor
is waiting for, and deferring that is a measurable regression dressed as an
optimisation. Eager images also get `decoding="sync"` and `fetchpriority="high"`,
because painting the page around the one element it is judged on is the
opposite of what is wanted. Both would have been regex passes over values for no return.

---

## 5. Components

A component master is a real subtree in `doc.nodes`, unparented to any page. An
instance is a lightweight `instance` node holding `componentId`.

When the renderer hits an instance it renders the master subtree but stamps the
*instance's* identity onto the root element, and marks the descendants inert —
no `data-cre8-id`, no ref registration. Clicking anywhere inside selects the
instance; editing the master updates every instance on every page.

The alternative — copying the subtree per instance — is easier and worthless,
because it gives you duplication rather than reuse.

### Properties

Sharing the master's nodes is what makes a component a component, and it is
also the constraint the rest of this section is shaped by: two instances draw
from the same nodes, so they carry the same classes.

A **property** is a named hole in the master — one prop of one node — that each
instance fills for itself. `ComponentProperty` records the node, the prop and a
kind (`text`, `image`, `link`, `visible`); the instance carries an `overrides`
map keyed by property id. Both renderers resolve the same scope from
`scopeForInstance` and apply it in the same place: over the node's props,
*under* any record binding, so inside a repeater the record still wins — every
row is the same instance node, and an override that outranked the binding would
print one row's text in all of them.

> **An override changes props, never styles.** A per-instance style would need a
> per-instance class, and the whole cascade would have to learn what an instance
> is. Text, image, link and visibility change what an element *says* — the
> stylesheet is untouched, and a customised instance adds no bytes to it. A
> check compares the two sheets and says so.

Overriding `src` drops the master's `srcset`, `width` and `height`, exactly as a
record binding does: those three describe one uploaded file, and `srcset`
outranks `src`, so keeping them would show the master's photo whatever the
property said.

Detaching bakes the values into the copies it makes — without that, Detach is
data loss with a friendly label.

### Variants

The other half, and deliberately the opposite of a property. A **variant** is a
whole second master tree — its own nodes, its own ids, its own classes — so it
*can* look different, which is exactly what an override cannot do. The
definition's own `rootNodeId` is the default and is not listed in `variants`,
so every document written before variants existed is already valid; an instance
names one in `props.variantId`, and naming none draws the default.

A variant is created by cloning a tree rather than starting empty, and that is
load-bearing rather than a convenience. `cloneSubtree` returns its id remap, so
every property picks up the counterpart of whatever it was pointing at — which
is why `ComponentProperty.nodeIds` is a list. One property fills the label in
whichever tree is on screen, and an instance switching variant keeps its words.
A property exposed *after* the trees diverged reaches only the tree it was
exposed from; guessing which node in the other one it meant would be worse than
saying so.

Everything that enumerates a component's trees uses `allRoots`: deleting a
component, refusing to delete a root as an ordinary node, and — the one that
bit — collecting the nodes each surface needs rules for. The publisher keys
that collection by *tree* rather than by component, so a page that only ever
draws the secondary look does not ship the default's rules; the canvas and
preview collect every tree, because any instance on screen may be wearing any
of them.

### Continuous values

The behaviour runtime is a state machine over *named* values, and that is the
right shape for almost everything: a pricing toggle, a tab set, a filter. It has
nothing to hold a divider dragged across a photograph, and composition does not
get there — a hundred positions would be a hundred cases and a hundred rules.

So one more kind of state. A box declares `rangeKey`, and the number it holds
is written into the markup as an inline `--cre8-<key>`; rules read it with
`var()`, usually inside `calc()`. A native `<input type="range">` carrying
`drives` moves it, and the runtime's entire contribution is one `setProperty`
per `input` event. Everything visible is still CSS the designer wrote.

Two consequences worth stating, because both are the point rather than side
effects. **The page has a position before any script runs** — a comparison
opened from a ZIP is one frozen at the chosen split, not a broken one. And
**the stylesheet does not grow**: moving the number changes no rule, which is
the same promise the switch makes and is checked the same way.

The control is the platform's, for the reason everything else here is:
keyboard, touch, `step`, screen-reader announcement and form restoration all
arrive correct and free. A pointer-drag handler would be a hundred lines to
reimplement four of them badly.

The number appears twice — the group's custom property and the slider's
`value` — because with scripting off those are two different elements that both
have to be right. Resolving one from the other while rendering was tried and
removed: the canvas hands the element model an empty document on purpose, so
the walk up the tree worked in the published file and returned nothing on the
canvas. They are kept in step by `setRangeValue`, and a static check asserts
they agree across the whole block library.

---

## 5b. Where the editor is pointed

Three editing contexts, and the third is a different shape from the other two.

A **page** and a **component master** are separate trees: opening one is
navigation, and `canvasRootId` says which is drawn. An **overlay** — a popover
or a dialog — is a subtree of whichever of those is already open, so entering
it narrows what the editor will touch rather than going anywhere.

```
Page
├── Header
├── Hero
└── Menu popover   ← editingOverlayId
    ├── Heading
    └── Link
```

The narrowing costs one field and one seam. Every panel already asked
`activeRootId` what it was working in — the layer tree roots there, the Insert
panel drops there, select-all selects there, the status bar counts there — so
answering with the overlay narrows all of them at once, and no panel had to
learn anything.

`canvasRootId` deliberately does *not* narrow. A popover judged without the
page under it is a box floating in grey, and what a designer is looking at is
how it sits over the content. So the page stays drawn and only what the editor
will *touch* changes — which means the canvas needs its own filter: a hit
outside the overlay resolves to nothing, exactly as empty canvas does.

In by double-click, the same gesture that goes into a component master. Out by
the breadcrumb, its close button, or Escape — which unwinds one level at a
time and leaves the overlay once walking up would not move. `selectParent` has
the scope as its ceiling for the same reason: walking out of the overlay on a
keypress people use constantly is the one thing the context exists to prevent.

### Backdrops

`::backdrop` has been styleable since parts landed — a rule with
`part: 'backdrop'` and no condition. The overlay inspector now writes into
exactly that rule rather than expecting somebody to find Conditions → Backdrop
and style an empty rule, and the Conditions panel still shows it. Nothing new
is stored.

Dismissal is the browser's, not ours: `popover=auto` is light dismiss —
Escape, or a click outside — and `manual` means only a button closes it. There
is no script here that watches for backdrop clicks, because the platform
already does it and doing it twice is how the two disagree.

---

## 6. Storage

```ts
interface StorageAdapter {
  listProjects(); loadProject(id); saveProject(doc); deleteProject(id);
  savePublished(projectId, site); loadPublished(projectId);
  publishSite?(projectId);        // a host that renders for itself
  listRecords?(projectId, collectionId);
}
```

Two implementations ship: `IndexedDbAdapter` (default — zero infrastructure,
works offline, no account) and `CloudflareAdapter` (D1 for documents, R2 for
assets and published files, behind accounts and teams). Which one is active is
decided by whether an API answered the boot probe, read once in `getStorage()`.
The editor has no idea which is behind it.

The one thing the interface deliberately does not model is teams, because
nothing in the editor should have to care. The Cloudflare adapter keeps the
active team in module state, pushed by `SessionProvider` — **synchronously**,
not from an effect, because a route's own mount effect flushes before its
parent's and would otherwise list projects against a stale team.

Uploaded images are downscaled to 2200px and re-encoded in the browser before
they enter the document, which keeps projects small enough to live in IndexedDB
and makes published output self-contained. The same pipeline hands bytes to R2
instead of inlining them when the Cloudflare adapter is active — the document
only ever sees a URL.

### Content is not in the document

Collections split in two, and the seam is the point. A collection's **shape** —
its fields, their types, which one names the URL — is in the document, because
a field list is a design decision and belongs with the thing that is versioned,
undone and exported. Its **records** are in D1, because they change without the
design changing, run to thousands of rows, and would otherwise travel through
the collaboration socket every time somebody typed.

Records are JSON in one `records` table rather than a table per collection.
Real columns would be better at almost everything except what actually happens,
which is a designer adding a field on a Tuesday: per-collection tables mean
per-project migrations, and that is a schema migration system living inside a
website builder. `slug`, `position` and `published` are lifted out as real
columns because every query touches them, and `slug` carries a unique index
per collection since it names a URL.

The Worker treats a collection id as opaque, exactly as it treats an asset key
— it never parses a document to validate one. What it does enforce is who may
read and write, that **a record id belongs to the project the caller named**,
and the two limits countable in a single query. That last check is the whole of
record privacy: without it an account holder could read the table by guessing
ids, and the access check would pass every time, because the project in the URL
really would be theirs.

### The repeater

A node carrying `repeat` renders its children once per record; a node carrying
`bind` reads fields of the record in scope into its props. That is the whole
model addition, and both renderers walk it through the same two functions in
`renderer/repeat.ts`, so a bound list has the same shape on the canvas as in
the published file.

It composes with §1 rather than sitting beside it. `variantsOf(node, base)`
takes the bound props as the base a variant is built from, which makes the
resolution order — the node's props, then the record, then a condition's `set`
— fall out of code that already existed. A condition still wins, because "when
out of stock, say Sold out" has to beat the price the record carries.

**The stylesheet does not grow.** Every copy of a repeated subtree carries the
classes the node already had, because it *is* the same node: a hundred products
are a hundred DOM subtrees and zero extra rules. Variants needed a class each
because each could be styled differently; repeats cannot, and that is precisely
what makes them repeats. The published page has no script for this — the rows
are elements in the file, so they are indexed, printed, and correct with
scripting off.

One divergence between the surfaces is deliberate. A repeater over an empty
collection draws its subtree once on the canvas, unbound, because a card you
cannot see is a card you cannot lay out. Preview and publish draw nothing,
because an invented row in a file somebody serves is a lie.

Records are read once before generating, not inside the renderer — that module
is framework-free and has no network, which is what lets the same code run in
a Worker.

### Publishing runs where the data is

With a backend, publishing is one request carrying a project id and nothing
else. The Worker reads the live document from the room, reads the rows its
repeaters point at out of D1, and runs the same generator the editor runs —
the same files, bundled twice, not a port. It writes the result to R2, so
serving a page is still a cache lookup rather than CPU. What moved is where
the bytes are made.

This is what the data layer needed. While the browser generated, expanding a
repeater meant the *browser* needed the records, so every publish downloaded
whole collections; and nothing on the server could render, so republishing
when a record changed was impossible. Both are now questions of what the
Worker does, not of what it can do.

### A publish writes only what moved

Each project stores what is currently on its site — published path → short
content hash, in `projects.site_manifest`. A publish hashes what it generated,
writes the paths whose bytes differ, **deletes the paths that are no longer in
the plan**, and leaves the rest alone. In D1 rather than in the sites bucket,
because everything under a project's prefix there is reachable at
`/s/<projectId>/…`; and written after the objects it describes, so it can only
under-claim.

The deletion half is not the optimisation. Without it a deleted record leaves
its page on the internet permanently: nothing walks the bucket, and nothing
else knows the page ever existed.

That is what makes the site able to follow its content. A record write pings
the project's room, which coalesces the burst on a Durable Object alarm — five
seconds after the last edit, never more than thirty after the first — and
calls the same `publishSite` the button calls, with no session and no request
behind it. Two things deliberately stay manual: a design change, because a
half-moved section is not content, and any project nobody has published,
because a record edit is not consent to put a site on the internet.

### A version is a design you published

Every publish is logged in `deployments`, and the ones a *person* made also
store the document they shipped. That is the whole of versioning here, and the
narrowness is deliberate: because a design change never republishes on its own,
every design the site has ever served reached it through somebody pressing
Publish — so storing the document on manual publishes captures all of them,
and storing it on the automatic ones would capture nothing but copies of the
design you already have.

Restoring re-publishes that document **against today's records**. It does not
roll content back, and it must not: putting last month's layout back is not a
reason to unpublish last week's posts. Design is versioned, content is live —
the same seam the Collections panel is split along, arrived at from the other
end. So a restore lands on a state that never previously existed, and the
dialog says so before anyone clicks.

Mechanically a restore is three steps and the middle one is the load-bearing
one: read the stored design, **write it through the room**, then publish. Skip
the room and the files change while the editor still shows the design that was
replaced — and the next ordinary save silently undoes the restore. It is
otherwise an ordinary publish, so it diffs against the manifest (going back a
month usually rewrites a handful of files) and appears in the history as a
publish somebody made. Changing your mind is therefore the same operation
again rather than a second concept.

Two ceilings, on two different things: the last 20 designs stay restorable,
the last 200 publishes stay in the log. Collapsing them would tie how far back
you can go to how much history you can read, and a busy collection republishes
often enough that the log would swallow the versions.

**How fast "follows" actually is, stated rather than implied.** R2 has the new
bytes within seconds. What a visitor sees is bounded by `s-maxage=60`, and the
purge is a best-effort improvement on that rather than a guarantee:
`caches.default` is per-colo, so a publish clears the colo it ran in and no
other — and a background republish runs wherever the Durable Object lives,
which is usually not where the reader is. On a site's own domain the purge
does not help at all, because the sites Worker caches under that hostname and
the API cannot address it. Sixty seconds is the number to quote.

With no backend there is nowhere to move to, so the browser still generates.
That path and the ZIP export are two callers of `generateSite` that keep the
shared module honest, and the render suite holds all three to producing the
same bytes.

Two consequences worth knowing:

**Nothing a client sends decides what a published page contains.** The publish
route reads no body. Asset keys are scraped from the project's own document
rather than supplied — though the project-prefix check stays, because a
designer can paste another project's asset URL into a style and publishing
must not become a way to lift someone else's uploads.

**One file crosses from the Worker into the app's source**, and the Worker
must never be given the DOM lib: it beats `@cloudflare/workers-types`, so
`Request`, `Response` and `FormData` would silently become the browser's.
The two serialised runtimes therefore declare the DOM members they touch
instead of borrowing ambient names — in a Worker, `Element` already means an
`HTMLRewriter` element. Both facts are checked in `tests/static`.

### A page is not a file

Two things broke that equivalence, and `publishing/routes.ts` is where both are
resolved. A page carrying `dynamic: { collection }` is a **template**: its slug
is a directory and each record's slug names a file inside it, so thirty posts
become thirty files and nothing sits at the directory itself. A repeater
carrying `paginate: n` splits its **page** rather than its list, so an index
becomes `/blog/`, `/blog/2/`, `/blog/3/` — each a real file, each indexable,
which is the reason not to reach for client-side paging that hands a crawler
page one and nothing else.

`plan()` returns every output the site will contain, and the generator, the
sitemap, the link resolver and the publish route all read that one list. The
sitemap in particular stopped being derivable from `doc.pages`: it is the list
of pages that were *generated*, which is a fact the publisher has and the
document does not.

Links keep the syntax they had. `page:<id>` names a page, and where that page
is dynamic the **record in scope** decides which of its files is meant — so a
card inside a repeater points at its own record. `series:prev` and
`series:next` step through a paginated index and resolve to nothing at the
ends, which hides the link rather than pointing it at `#`.

Two ceilings apply and they are not the same number: a repeater shows at most
500 rows because a page holding more is unusable, and a route publishes at
most 1,000 files because a publish writing more is unmanageable. Both refuse
with a sentence rather than degrading, as does a pair of pages that want the
same URL.

### Editing the two halves

The seam is visible in the UI as well as the code, and deliberately so.
**Fields** are edited through `transact`: they undo, they travel with the
document, they are design. **Records** are written straight to D1 through the
API: they do not undo, because Ctrl+Z after writing a blog post must not eat
the post. The Collections panel keeps them in separate tabs for that reason
and no other.

A field's key is generated once from its first label and never moves again.
Bindings point at the key, so renaming "Title" to "Headline" cannot empty every
heading on the site — and the panel shows the key, because a rename that is
safe is only reassuring if you can see why. Retyping a field converts nothing:
the values are in D1, there may be thousands, and the panel says which of them
will stop reading rather than rewriting them on a keystroke.

Three design-time choices now use one pattern — `switchDesign` for a state,
`settings.data.designing` for the visit, and `settings.designRecord` for which
record a template page is drawn against. All three change only what the canvas
shows. Looking at one post is never a way to publish that post.

The data layer's staging, and what each stage was held to, is in
[DATA-LAYER.md](DATA-LAYER.md).

---

## 7. Cloudflare shape

```
cre8              app origin
  ├── /*          the editor, static assets, served without invoking the Worker
  ├── /api/*      accounts, teams, documents, uploads, collaboration
  └── /s/*        published sites — fallback only, sandboxed

cre8-sites        *.cre8.app
  └── /*          published sites, hostname → KV → R2

Durable Objects  →  one live room per project
D1               →  accounts, teams, project documents, deployments, records
KV               →  hostname → project id
R2               →  uploaded assets, generated site files
Cache            →  published pages
```

Two Workers, split along the one seam that is a trust boundary rather than a
naming convention. Everything the editor needs is on one origin; everything a
stranger's browser executes is on another.

Publishing uploads finished HTML. Serving a published page is a cache hit or an
R2 read — the Worker never renders. That is the whole cost argument: a site on
Cre8 should cost approximately nothing to run, and Worker invocations should
scale with editing, not with traffic.

### Why the editor and the API share an origin

They started apart — a static-assets Worker for the editor, a script Worker for
the API — which meant a build-time API URL, a CORS allowlist that had to track
the deployment, and `SameSite=None` cookies. Three pieces of configuration, each
with its own way of being silently wrong. Putting them on one origin deletes all
three: the API is at `/api/*` on whatever host served the page.

That is the opposite of the split below, and deliberately so. Splitting a
service costs configuration and buys isolation; it is worth paying only where
there is a trust boundary to enforce. Between the editor and its own API there
is none — they are the same product, serving the same signed-in person.
Between the editor and a stranger's published JavaScript there very much is.

Two things had to be got right in exchange.

**`not_found_handling: "none"`.** With assets and a handler in the same Worker,
the asset router decides what happens to a path that matches no file. The
`404-page` and `single-page-application` modes let it answer by itself, which
would swallow `/api/*` before the handler ever ran. `"none"` falls through, and
the Worker serves `out/404.html` itself.

**Published pages had to be quarantined.** They are author-supplied HTML —
`settings.customHead` and the rich-text block both pass through verbatim. A
script on a published page served from the editor's origin would run *as the
editor* in the browser of any signed-in Cre8 user who visited it, and could call
`/api/*` with their cookie attached: publishing a site would amount to account
takeover.

The answer is the second Worker (below). While a deployment has no site domain
configured, `/s/*` on the main Worker is the fallback, and there the defence is

```
Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-top-navigation
```

`sandbox` without `allow-same-origin` puts the document in an opaque origin. Its
scripts still run — analytics snippets keep working — but `document.cookie`
throws, storage throws, and its requests are cross-site, so the `SameSite=Lax`
session is never attached. Verified by publishing a page that tries all three
and confirming a signed-in visitor leaks nothing.

### The second Worker

`workers/sites/` serves published sites on `*.cre8.app`. It has no D1, no
Durable Objects, no secrets and no write path. The only two things it can reach
are a KV map of hostname → project id and the bucket the API wrote the files
into, both read-only.

A sandbox is a mitigation; a different registrable domain is the boundary. And
it costs the sites nothing — the sandbox took away storage, service workers and
any future per-site auth, and on their own origin they get all of it back.

**KV, not D1, for the hostname map.** This is the highest-volume lookup in the
system — every request to every published page — and routing it through the
database would put the busiest path on the scarcest resource. KV is
edge-cached, and the API writes the mapping at publish time. It also keeps the
D1-behind-the-API boundary intact: the sites Worker cannot reach the database
even if it wanted to.

The map is keyed on **hostname**, not on subdomain, so pointing a customer's own
domain at a project is one more KV entry and no code change.

A project earns its address on first publish, not at creation — most projects
are never published, and reserving names for them would be squatting. The
unique index on `projects.subdomain` is the real arbiter of collisions rather
than a `SELECT` check, because two people publishing similarly named projects
in the same moment both pass the check and only the write can settle it.

### Whether there is a backend is a runtime question

The same static build is served by the Worker (backend present) or dropped on a
CDN (no backend). It can't be a compile-time constant any more, so
`SessionProvider` asks `/api/auth/me` once on boot: JSON means hosted, anything
else means local. `RequireSession` holds the routes back until that lands, which
is what keeps `getStorage()` from being asked before the answer exists — the
same ordering trap as the active team, and the reason both are set
synchronously rather than from an effect.

---

## 8. Accounts

`requireProjectAccess()` in `workers/src/lib/db.ts` is the single authorization
gate. Every project route goes through it, and it returns 404 for both "does not
exist" and "you cannot see it" — a 403 would confirm the id is real.

### Where the password hashing happens

A Worker on the free tier gets 10ms of CPU per request. A server-side KDF strong
enough to be worth having does not fit in that, and a weak one is worse than
none. So the work moves to the browser:

```
browser   PBKDF2-SHA256, 600k rounds, salt = SHA-256("cre8-auth:" + email)
             ↓  derived key (the password itself never leaves the device)
worker    HMAC-SHA256(derivedKey, AUTH_PEPPER) → stored verifier
```

The client-side stretch is what defends a stolen database; the server-side
pepper is what makes the stored verifier useless on its own, since it lives in a
secret rather than in D1. Unknown emails are compared against a dummy verifier
so a wrong address costs the same as a wrong password.

Sessions are opaque random tokens, stored hashed, in `HttpOnly; Secure` cookies.
`SameSite` follows the deployment: `Lax` on one Worker, where the browser's own
cross-site rule is the CSRF defence, and `None` when `ALLOWED_ORIGINS` is set,
because a cross-origin editor's calls would otherwise arrive cookie-less. The
`x-cre8-csrf` header is kept in both cases — it costs nothing, and it is the
whole defence in the `None` case, being non-safelisted and so only sendable
after a preflight an allowlisted origin can pass.

Invites are links rather than emails because there is no mail provider wired in.
The token is returned exactly once, from the call that creates it; only its hash
is stored.

---

## 9. Collaboration

One Durable Object per project (`workers/src/room.ts`). The room is the single
writer for its document and holds a monotonic version. A client sends the
patches it produced *and the version it produced them against*:

- base version matches → apply, bump, broadcast to everyone
- base version is stale → refuse, and send that client a full resync

Two people editing different elements interleave cleanly, because each change
lands against a version that already includes the other's. Two people editing
the same property within one round trip resolve last-writer-wins, and the loser
is told immediately.

**This is deliberately not a CRDT.** A CRDT would let both edits survive without
a round trip, at the cost of a much larger document model and merge semantics
that are hard to reason about for structural operations like "move this section
into that container". Version fencing is small, obviously correct, and its
failure mode is a visible resync rather than corruption.

Three consequences worth knowing:

- **Remote patches skip local history.** Undo should walk back through *your*
  edits, not silently revert a colleague's. But a colleague can delete the very
  node an inverse patch targets, so `undo()` catches the failure, drops the
  stack and says so, rather than half-applying it.
- **Autosave stands down.** The room persists every patch, so the debounced HTTP
  save is suspended while a socket is live — a whole-document PUT on top of the
  patch stream would bump the version and resync everyone every 900ms. The
  status indicator reads **Live** instead of **Saved**.
- **Read-only is a store gate, not disabled buttons.** `transact` refuses when
  `readOnly` is set, so a panel written tomorrow is read-only on the day it is
  written. The server refuses the patches regardless; the gate exists so a
  viewer sees an honest editor rather than edits that vanish.

Cursors travel in **document space** — `(clientX - frameLeft) / zoom` — so a
pointer lands on the same element for every peer regardless of their zoom and
pan. Sockets use hibernation, so an idle room costs nothing; nothing may live
only in memory, which is why per-connection identity rides on the socket via
`serializeAttachment` and the document reloads from D1 on demand.

---

## 10. Extension points for what comes next

The editor implements **presentation** and **structure**. The remaining axes are
modelled as separate concerns so they can be added without touching the renderer
or migrating documents.

| Axis | Question | Where it lands |
|---|---|---|
| Presentation | What does it look like? | `node.styles`, `theme` — **built** |
| Structure | What does it contain? | `node.children`, `components` — **built** |
| Behaviour | What does it do? | `node.events` — reserved |
| Data | What does it store? | `doc.collections` — reserved |
| Logic | How do things interact? | `doc.actions` — reserved |

Concretely, a future button looks like this, and nothing above it changes:

```
Button
├── styles          ← today
├── props           ← today
├── events
│   └── onClick → { type: 'navigate', params: { … } }
└── bindings
    └── label ← collection.products.title
```

`ElementDefinition.events` already lists which events each element will expose,
so an Interactions tab can be built against the existing registry.

### Why an AI can drive this later

Everything the editor can do is a document operation, and the document is JSON.
A generator does not need a parallel API: it produces or patches the same
structure a human produces, and gets the same validation, the same undo entry
and the same renderer. Templates are the existence proof — `lib/templates/` is
nothing but functions that return documents.

---

## 11. Things deliberately not done

- **Marquee selection on canvas.** In flow layout it selects sets that rarely
  correspond to anything meaningful. Shift-click and the layer tree cover it.
- **Pixel nudging of in-flow elements.** Arrow keys reorder instead; moving a
  flow element by pixels silently produces a layout nobody asked for.
- **A rich-text editing surface.** The rich text block takes HTML. A proper
  inline editor is a project of its own and would have been shallow here.
- **Mobile support for the editor.** Explicitly out of scope; the *sites* are
  responsive, the tool is desktop-first.
