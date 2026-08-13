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
├── events?        what it does when pressed — a list of actions
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

**A template's photography is the one exception, and it is a URL.** Everything
above describes an image somebody uploaded into a project. A template has no
project yet — it is code that runs before the storage exists — so it cannot
reference an upload, which is why every template shipped gradient panels and no
`<img>` at all. The options were seeding R2 at create time, with real bytes and
a real storage bill for pictures every user is expected to replace, or pointing
at a placeholder service. It points at a service, from a single constant in the
authoring kit, and a static check holds every stand-in to one origin so moving
to a CDN we own stays a one-line change.

What that costs is worth naming: a published site that keeps the placeholders
depends on a third party staying up and hands it the visitor's IP address.
Acceptable for a stand-in, not for a finished site — which is the message the
Assets panel exists to answer. The images carry intrinsic sizes and sit on a
surface-coloured background for the same reason, so one that is slow, blocked
or replaced by a broken URL reads as a panel in the page's palette rather than
as a hole in the layout.

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

Templates use it now, and did not for a long time: the four-page SaaS template
shipped four copies of its navbar and four of its footer, so a template that
looked finished came apart the first time anybody changed a nav link. The
builder makes a component out of any section that appears on more than one
page and leaves instances behind, which took that template from 490 nodes to
371 and produced byte-identical markup.

"Appears on more than one page" is decided by fingerprint, not by name — two
pages may reasonably carry navbars that differ, and silently replacing the
second with the first would be a template changing a design nobody asked it to
change. The fingerprint has to normalise everything minted, which is more than
node ids: a rule carries one, a state assignment carries one, and a popover
invoker holds the id of the panel it opens, resolved per subtree. Miss any of
the three and nothing ever matches anything, which is how this first shipped —
doing nothing, with every check still green.

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

### References are a thing, not a prop

Elements have pointed at each other since the first popover, and every time it
was spelled differently: a node id in `props.popoverTarget`, a `popover@Name`
awaiting its own resolution pass, a `componentId`, a list of node ids inside a
component property. Two of those had a resolver and only one had cleanup —
which is why deleting a panel left every button that opened it holding an id no
longer in the document. Nothing reported it, because a `popovertarget` naming
nothing renders perfectly and does nothing.

A `Ref` is now a node-level `refs` map keyed by slot, beside `bind` and
`repeat`. `NodeProps` is primitives only, so it could never have lived in props
anyway — but the reason that matters is enumerability. One walk services every
reference: `resolveRefs` turns authored names into ids once, `pruneRefs` runs
on delete, and `rewireInternalRefs` re-points them inside a copy. Each of those
used to name `popoverTarget` explicitly, so a second kind of reference would
have been silently wrong in all three.

Two slots today, pointing in opposite directions. `popover` is a button naming
the panel it opens. `anchorFor` is an element naming the panel positioned
against it — stored backwards from how anybody says it, because the element
that must carry `anchor-name` is the button, and the canvas renderer is handed
an empty document and memoised per node. It can only emit what the node it is
drawing already holds. The inspector does the one scan needed to show it the
right way round, and says **Relative to**, because that is the sentence
somebody means. Nobody types an anchor name.

Resolution is scoped per slot, and that is not a detail. Indexing every node by
name wired the command menu's buttons to a *wrapper* sharing the panel's layer
name: the published page carried an id and a `popovertarget` that did not
match, and the menu could not be opened. The static rule at the time asked
whether the name existed, which it did. There is now one that asks what it
resolves to.

### An expression can read an element, not just a field

`Value` had two arms: a field of the record in scope, and a form control *by
name inside the node owning the rule*. The second carried a documented
restriction — arbitrary element targeting deferred — which in practice meant
"enable Submit when the email box has something in it" had to be written on a
common ancestor of the button and the box, not on the button.

A third arm holds a `Ref`, and the whole of the lift is one line in the
runtime: `root.querySelector` instead of `holder.querySelector`. A reference
rather than a name, because a control's `name` is a submission concern, two
forms on a page may share one, and renaming a field should not silently break
a rule reading it — the reference survives the rename, and `everyRef` finds it
when the element is deleted.

Controls carry `data-cre8-el` with their node id, on every control whether or
not anything reads one. That is bytes on every published form, chosen over the
alternative: emitting it only where the document says it is needed, when the
document is exactly what the canvas renderer does not have. A marker present in
the file and absent in the editor is a rule that answers on one surface and not
the other.

Only a *control*, and only live. Reading an ordinary element's text would have
to resolve where the document is known, and the canvas renderer is deliberately
handed an empty one and memoised per node — the two surfaces would disagree.
That case needs dependency tracking in the canvas memo and is a different piece
of work.

References inside expressions are enumerated by the same walk as the ones in
`refs`, and reported rather than pruned: throwing away a rule somebody wrote
because the control it reads was deleted is a bigger decision than cleanup gets
to make. The node falls back to its declared Otherwise, and `danglingReads` is
what lets the editor say why.

It says it **beside the rule**, not at the foot of the panel — which is why the
report carries the rule id and not only the node. The fix is a chip in one
sentence, and a panel-level "something here is wrong" over a list of four rules
leaves the reader to work out which. What it says is the whole consequence, in
order: the element is gone, so the rule can never hold, so the state stays at
its Otherwise.

The sentence above the warning had to be made honest first. A picker takes its
text from the option matching its value, so a reference to a deleted element
fell through to the placeholder and read `When ⟨a field⟩ is not empty` — a rule
nobody had finished, printed directly above a warning that one was broken. Two
diagnoses of one rule in one panel, and only the second true.

Which makes *"cannot be named"* and *"is not there"* two questions rather than
one. The source picker deliberately withholds controls inside the node owning
the rule — those are offered by name instead — so a control picked from the page
and then dragged in is a working reference the offer list cannot label. The
panel adds back what the rules already read before asking the sentence to name
it; after that, the only reference left unnameable is one whose node is
genuinely gone, which is exactly what `danglingReads` reports. The two halves
then agree about every rule instead of about most of them.

### A menu is a popover that knows where it is

The popover element centres itself: `inset: 0` with four auto margins, which is
how a top-layer box sits in the middle and exactly right for a dialog. Every
menu in the library was inheriting it, so the account menu opened in the middle
of the viewport — a fact none of the popover checks could see, because it was a
real popover, correctly wired, on top, and dismissing properly the whole time.

The fix is **CSS anchor positioning**, and the reason it is worth the newness is
what the alternative costs. An absolutely positioned panel inside a
`position: relative` nav item leaves the top layer, and with it the light
dismiss, the Escape key and the immunity from clipping — a navbar with
`backdrop-filter` is a containing block, so the menu gets cut off by the header
it hangs from. Positioning with a script contradicts the property this whole
section exists to preserve.

The split is the same one the rest of the app makes. The **names** are
machinery: `anchor-name` on the button, `position-anchor` on the panel, both
minted from the *panel's* node id so neither element has to look the other up —
which matters because the canvas renderer is handed an empty document and
memoised per node, so a lookup would work in the publisher and return nothing
in the editor. The **placement** is design: `position-area` in the node's own
styles, editable, and written by one inspector control alongside the prop the
renderer reads. `position-try-fallbacks: flip-block, flip-inline` is not
polish — without it a menu in the top-right corner hangs off the page.

Browsers that cannot anchor get the one rule that has to outrank a node class.
`position-area` is dropped on parse there, leaving a fixed box with no insets
that lands at its static position — the top-left corner, over the logo — so
`@supports not` turns those panels into the same full-width sheet under the top
edge that the mobile menu already uses. A menu rather than an accident.

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

That split is also why a template has two halves. Its collection *shapes* are
in the document `build()` returns; its opening *rows* are a separate `seed`
list, written by the dashboard through the adapter once the project exists —
the one moment the two halves are put together. Records cannot be in the
document without collapsing the seam that the rest of this section is about.

The consequence is worth stating rather than discovering: `createRecords` is
optional on the adapter, like `listRecords` and `uploadAsset`, so with no
backend the Blog template arrives shaped and empty. Its index draws the
repeater's template row on the canvas and publishes nothing, and the
Collections panel is where somebody fills it in. A hosted project gets six
essays, a paginated index and a page each.

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

### A link into the middle of a page

A section can carry an `anchor`, which becomes an `id` in the markup and the
`#work` in a URL. Nothing else is needed to make it work: the browser does the
scrolling, so a one-page site's navigation runs with no script at all, which
is what most sites people build actually are. Three details are load-bearing.

The id is written in `describeBase`, beside the class, rather than in the arm
for any particular element type — "somewhere to scroll to" is not a property of
being a `section`, and a one-pager's nav points at whatever holds the content.
Two elements given the same anchor collide, and the renderer cannot see the
other one; the editor can, so the warning lives in the Semantics panel.

`page:<id>#faq` is one href with two answers in it, and three resolvers had to
learn the same trick — the template resolver, the canvas one and the
publisher's. They share `splitFragment`, and the publisher adds one rule of its
own: a link into the page it is already on is written as the bare fragment,
because the relative path to yourself is a real path and following it reloads
the document instead of scrolling.

`scroll-margin-top` is in the shared reset, keyed on `[id]` — the only ids a
document emits are an anchor's and a popover's, and a popover is fixed rather
than scrolled to. Without it the browser puts the section's first line exactly
under the sticky navbar: the page moves and the visitor still cannot see what
they clicked. Smooth scrolling is in the *published* reset only, since the
editor's scrolling element is a pane of the app, and it is turned off outright
under `prefers-reduced-motion` — a full-page slide is one of the movements that
genuinely makes people ill, and unlike a decorative animation you cannot look
away from it.

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
| Behaviour | What does it do? | `node.events` — **built** |
| Data | What does it store? | `doc.collections` — reserved |
| Logic | How do things interact? | `doc.actions` — reserved |

Concretely, a button looks like this, and nothing above it changed when it did:

```
Button
├── styles          ← today
├── props           ← today
├── events
│   └── onClick → [ { setState: billing = annual },
│                   { setState: nav = shut } ]
└── bindings
    └── label ← collection.products.title
```

Behaviour arrived before this field did, as props: `switchSet` put the nearest
state into a value and `copyText` put a string on the clipboard. Both worked,
and both stayed because they are still how the library writes the ordinary
case — they are folded into `events` by the factory, exactly as `states` is
folded into `rules`.

What a prop could not do was hold two of anything or name what it was aimed at,
and those are the same limitation seen from two sides. A control drove whatever
`[data-cre8-switch]` was nearest, so a link inside a mobile nav could not close
the nav; and "close this and go to Pricing" is two assignments, which two props
have no order and no shared identity for.

An action is still not a script. Both members of the union compile to
attributes — `data-cre8-set="nav:shut annual"`, `data-cre8-copy="…"` — and the
runtime's whole job is still to write an attribute and let CSS draw. That is
what keeps one implementation across three surfaces, and it is why the union is
short and will stay short: an action that could not be expressed that way would
need a second mechanism on each of them.

The Logic and Data axes now have an agreed shape, written down before the code:
[docs/EXPRESSIONS.md](EXPRESSIONS.md), and all four phases of it are built. A
binding is a `Value` and, optionally, a `Format`, so a price stored as
`1250000` prints as `$1,250,000.00` on all three surfaces. A Test over that
record decides what *state* an element is in — `WHEN price > 500000 →
expensive` — which the designer then styles with the ordinary inspector, or
with a one-line shortcut that writes the same rule. And a number mapped onto a
scale becomes a custom property on the row. Three things worth knowing from
here.

First, it is **two systems, not one**. Data binding resolves a record into a
value when the page is rendered; an interaction evaluates values in the browser
and produces state. They share a grammar and nothing else, and which one you are
authoring is decided by where you author it — never inferred from what it
references. An expression system that spanned both would make the renderer
decide, per value, whether it was looking at content or at behaviour, and the
two renderers could answer differently. That is the failure §1 exists to prevent.

Second, the rule shape is already here. `StyleRule` is `when` / `apply` / `set`
— a test, a property assignment and a state assignment. The interaction model is
that shape with a richer `when`, which means the runtime's whole job is to
evaluate tests and set state attributes. It never learns what a CSS property is,
so it does not grow when the inspector does.

That is why phase B needed no generator change at all. A state is
`data-cre8-switch` / `data-cre8-value`, which is what a pricing toggle has
always been, so a Test resolving to a state writes an attribute the stylesheet
already knows how to read. A hundred cards in a hundred different states share
one rule. `Condition` is now a member of `Test` rather than a parallel idea, so
"the CSS-compilable subset" is true by construction.

And a number that differs per row — a price mapped onto an opacity — is the
one value that cannot be a rule at all, so it is written into the element's own
`style` as a custom property and read back by one shared `var()`. One rule, a
hundred numbers, a stylesheet that does not grow.

Writing `→ hide this element` in the assignment row is a shortcut for the rule
a designer would otherwise write in Conditions, and the generated document is
compared against the hand-built one to keep it honest. The link between an
assignment and its rule is by shape — the rule whose only condition is that
state — so a rule the designer edits afterwards stops being the assignment's.

A Test whose operands are all record fields is answered when the page is
published and ships as an attribute. One that reads a form control cannot be,
so its rules travel — as the same AST the editor stores, keyed by node so a
repeater shares one entry — and a second small runtime evaluates them. That
runtime is separate from the switch one on purpose: most pages have no use for
it, and folding it in made every page with a toggle carry an evaluator it never
called.

Third, **formatting is presentation, and the type system is what says so**.
Comparisons must see raw values — `$9.99` sorts before `$100.00` and `1234.5`
does not — and rather than write that rule down and lint for it, `Format` hangs
off `Binding` where a `Value` cannot reach it. A formatted operand is not
refused; it cannot be spelled. The formatter itself is longhand, with no `Intl`
and no time zone anywhere in it, because it runs on the canvas and in the Worker
and §7's gate is that those two produce the same bytes.

Duplicating a component is the one entry that needed a document operation
written for it rather than lifted from a panel, and the reason is worth
keeping: a component is not a subtree. It is a master tree, a tree per
variant, and properties naming nodes inside all of them — so every tree is
cloned through *one* id map. A map per tree could only remap the one it was
built for, and the copy's property would reach its own master and the
original's variants at the same time.

### Expressions are written as sentences, not forms

A labelled row per property is right for `padding` and `font-size` — that is
what those are. An expression is a *clause*, and four labelled rows make the
reader reassemble it in their head every time they look at it. So the
expression surfaces render one line of prose with the choices as chips in the
flow: `When Price is over 500000, this is expensive and it hides.`

Two decisions make that more than a skin. A **builder turns the AST into
`Part[]`**, and the same builder serves the editor and anywhere that only needs
to *say* what a rule does — with handlers the parts are chips, without them
they are prose, so a tooltip and the panel cannot describe a Test differently.
And a **chip is `Select` and `TextInput` wearing a different shape**, not a new
control: both are already keyboard-reachable and already know the editor's
focus ring, and a bespoke chip would reimplement those badly in the place a
designer moves fastest.

A group is a clause under the clause that governs it, rendered recursively —
`all of these hold` with its members indented, and `all`/`any` as one chip so
turning AND into OR is a click rather than a rebuild. The model always allowed
`every` and `some`; the panel could only say "all of 2 conditions hold" about
them. Deleting back down to one condition unwraps the group, because a group
with one member in it is invisible to the evaluator and visible everywhere
else.

It unified four grammars that were four different arrangements of rows. A
Test, a repeater filter and a condition are all field · operator · value; a
binding is prop · source · format. Nothing in the old panels gave a designer
any reason to notice, and the read-only summaries were written separately from
the controls they sat above — `describeRule` was a switch over condition kinds
maintained next to the panel that edited them, which is exactly how a heading
saying "Hovered" ends up over a control saying "hover". It is
`partsToText(ruleSentence(rule))` now: the same parts, joined.

### The style vocabulary, and why coverage had to become a type

An audit of the inspector against the style model found the same thing three
ways: **the engine is general and the editor is hand-carved.**
`declarationsToCss` kebab-cases anything and both surfaces render it
identically, so a property costs one line in `StyleDecl` — while every control
was written out by hand, one row at a time. Thirty-five of a hundred properties
had no control anywhere. Not decisions: rows nobody got to. No italic. No image
focal point. No way to make a grid child span anything, which is roughly why
every grid in all eight templates was a uniform `repeat(n, 1fr)` — the
limitation was visible in the shipped output, and looked enough like a house
style that nobody had read it as one. "Roughly", because a block author writes
TypeScript and could always reach past the panel; see *Building something with
it* below for what that turned out to mean.

Nothing said so, and that is the real finding. Answering "is this property
reachable?" meant grepping the panel for the name, and a word-boundary grep
cannot tell a CSS property from a local variable or a Tailwind class: the first
pass reported `columnCount` covered because a local of that name parses a
column template, and `cursor` covered because of `cursor-pointer`. Archaeology,
and wrong by four.

So the vocabulary is declared — `Record<StyleProp, StyleEntry>`, one entry per
property, giving each a word, a section and a control. The `Record` is the
point: adding a property to the model without a home is now a compile error.
Coverage stopped being something to measure and became something the type
system holds.

`StyleField` renders an entry, and that is where the leverage is. A property
named in the table gets a labelled row that reads the effective value, writes
the right layer, shows the override dot, resets, and answers the right-click
menu — five behaviours that were re-typed per row before, which is exactly why
thirty-five properties had none of them. Two gates keep the panel from becoming
a hundred rows: `only` restricts a row to element types, and `when` shows it
only while a sibling declaration holds a value, so the grid properties appear
on grids.

What stays hand-written is what earns it. The box model is a diagram, sizing is
Fill/Hug/Fixed rather than a length, a colour is a swatch with the theme behind
it. Those are declared `bespoke` — still in the table, because the *words* are
shared even when the control is not, and because a promise to defer to a
hand-written row is checkable: one that defers to nothing is a property with no
control at all.

The compiler cannot see whether an entry is *reached*, so the static suite
checks that every section with a tabled property is rendered and every
`bespoke` property is named somewhere in the panel. When it was written that
last rule reported exactly one gap, `transition`, and reporting it was the
design: the model had the property, the block library authored it in
TypeScript, and the panel had never offered it — so a designer's own element
could not animate and a shipped block's timing could not be changed. It reports
none now, because a failing check with a name on it is a piece of work rather
than a complaint.

Three things only a browser could catch, and it did. `NumberField` appends its
default unit, so a count field wrote `2px` into `column-count` — valid CSS to
the generator, meaningless to a browser, invisible to the compiler and the
static suite. A second `Repeat` label collided with the Data section's, in a
panel 280px wide. And the first version of the `only` check was vacuous: it
asserted a heading has no focal-point row, and passed with the gate switched
off, because a heading never renders that section at all.

### The two composite declarations

`transition` and `transform` were the last properties with no real control, and
for the same reason: both are *composites* — a list of properties with a
duration and a curve, a stack of functions — and a composite cannot be a
labelled row without something to take it apart and put it back together. So
`transform` shipped as a field reading "Any CSS transform, e.g. rotate(-2deg)",
and `transition` shipped as nothing at all. The block library authored it in
TypeScript, which meant a card Cre8 ships eased its hover and a card somebody
built themselves snapped, with no row anywhere to explain the difference or
change either.

The parsers live in `renderer/motion.ts` rather than in the panel, because they
are the risky half and a function is checkable in a way a component is not.
Every one is written to **round-trip**: every `transition` string the library
authors comes back out byte-identical, which matters more than it sounds —
a control that rewrote `cubic-bezier(0.34, 1.56, 0.64, 1)` as `ease` the first
time somebody opened the panel would silently retime every card in every
template. Splitting on commas is not a one-liner for the same reason: that
curve holds three commas that are not entry separators, so the parser walks
bracket depth.

**Anything the fields cannot hold is refused, not approximated.**
`parseTransform` returns `null` for a value containing a function it has no
field for, and the panel keeps the raw text box for exactly those. Reading the
recognised calls out of `perspective(400px) rotateX(20deg)` and reporting an
identity transform would turn "I do not understand this" into "it does
nothing" — and the panel would then write that nothing back over a 3D transform
somebody wrote, purely because they opened the section.

Output order is fixed — translate, scale, rotate — because transform functions
do not commute: rotate-then-translate moves along the rotated axes, so a
control whose output depended on which field you touched last would make the
element jump for no visible reason. Identity parts are omitted, since
`scale(1) rotate(0deg)` on every element is bytes on every page and a stacking
context nobody asked for.

A related harness fix came out of this. `blocks.mjs` compares canvas against
published for every block in the registry, and one block — "Opening hours" — is
keyed on the visitor's clock, where the canvas deliberately shows the value the
site *ships*. The sweep already preferred the on-screen copy for content
variants; it could not do that for an element a rule *hides*, because there is
no second copy. So it passed in the morning and failed after nine at night. The
clock is pinned now rather than the element skipped: skipping would weaken the
comparison for every other block, and a check whose verdict depends on when it
ran is worse than no check.

### Arriving as you scroll to it

The one visual effect that needs more than a declaration, and the last piece of
what a Framer user expects. It is a named effect on the style layer — `appear:
'rise'` — which the generator expands into an animation, a timeline and a range,
because the question a designer has is "does this fade up?" and the answer in
CSS is four declarations and a `@keyframes` block.

Scroll-driven, so there is nothing to execute: `animation-timeline: view()` ties
progress to the element's position in the scrollport. That keeps the rule this
codebase has held since Phase C — CSS does the work — and it means a page with a
reveal on it ships exactly as many scripts as one without.

Three cases had to be answered, and each is checked rather than described.
Where scroll-driven animation is unsupported the timeline declaration is
dropped and the same animation runs once on load, which is a weaker effect
rather than a broken page. Under `prefers-reduced-motion` the keyframes are
**redefined inside the media query** — same names, animating nothing — so the
rules referencing them are untouched and no override has to out-specify
anything; a blanket `animation: none` would have had to reach every element on
the page to catch five. And on a page too short to scroll, the timeline is
inactive and the effect is not applied, so the element simply appears — the one
arrangement where backwards fill could have hidden content for good, and the
one that would look identical to a working page on the machine it was designed
on.

The keyframes ship only on pages that use one, which is why they are a function
of the document rather than part of the reset.

### A negation that matched everything

Found while verifying the above, and it had shipped: the negative half of a data
condition compiled to `:where(:not(:is([data-cre8-data~="time:night"])))` as an
**ancestor prefix**. A prefix matches if *any* ancestor satisfies it, and
`<body>` satisfies that one, as does every wrapper `div` — so the rule matched
always. The night copy of a data variant was hidden at night *and* at every
other hour, and the "Opening hours" strip showed nothing at all between nine in
the evening and midnight.

The fix is to require the attribute — `[data-cre8-data]:not(:is(…))` — which
narrows the ancestor to the one element that can carry a value, and is what the
positive side gets for free by naming it. Specificity is unchanged: `:where()`
weighs nothing either way.

Two things about how it survived are worth keeping. The static check that
existed asserted the *broken spelling* — a defect written down as a
requirement, which is the failure mode of a check derived from the code it is
checking rather than from what the code is for. And the browser check that
would have caught it ran at whatever hour the suite happened to run at; it was
green every afternoon for months. Both ends of the condition are now pinned
with a fixed clock, and the same pinning went into the block sweep, which had
the same shape of hole.

### What a press does

Everything a control can do on a press is a thing the platform already has an
element for, with exactly one exception. A link goes somewhere, `popovertarget`
opens a panel, a submit button submits, the switch attribute moves a state — so
the page ships nothing to execute for any of them, works with scripting off, and
the editor's job is to say it in words rather than to build a mechanism.

**Jumping to a section** was the one that read as an editor asking for
homework. The picker offered only elements that *already had* an anchor, so
linking to a band meant selecting it, finding Semantics, typing a name, and
coming back — and a page with nothing named showed a paragraph explaining that.
Naming the target is now part of making the reference: `setScrollTarget` writes
the anchor if the target has none, taking it from the layer name, which is what
somebody would have typed.

It is a `Ref` rather than a fragment, and that is the same argument as
`popover`: a fragment is a *name*, and a name goes stale the moment somebody
renames the section — silently, into a link that scrolls nowhere. A reference
survives the rename and is cleared by `pruneRefs` when the target is deleted.
What reaches the markup is still an ordinary `href`; the reference is spelled
`node:<id>` on the way there and resolved by the same hook that turns `page:<id>`
into a path.

That hook is where this went wrong first. **There are three href resolvers** —
the default in `element-model`, the publisher's, and the canvas's — and the
first version taught one. The published button came out as
`href="node:h1rburoayr"`, a link to a page by that name, while the static suite
passed because it used the default and the publisher uses its own. One exported
function answers it now and all three ask; a structural check names all three,
because a fourth is a thing somebody adds and it will be wrong the same way.

**Copying** is the exception: no element does it, so it is the one action that
costs a visitor a script, and the page still ships nothing unless something on
it copies. Feedback is an attribute — `data-cre8-copied`, set for a moment and
removed — rather than a string the runtime decides. An attribute condition is
something the rules panel has expressed since stage 2, so "say Copied for a
second" is a rule the designer writes and styles like any other state.

What was deliberately not here for three milestones: making an arbitrary
container clickable. The reason given each time was right — it needs the
renderer to change an element's tag, and the no-nested-interactive rule enforced
as it does — and it is done now; see *Making a container clickable* below for
what that turned out to cost, including the half of the rule that was already
broken without the feature.

### A value cannot leave its own rule

Found while looking for somewhere to put a custom-CSS field, which is the sort
of thing that should be built on a foundation rather than into one.
Declarations were written into the `<style>` block verbatim, so a style value of
`red</style><script>…</script>` left the stylesheet, left the style *element*,
and ran. `red } body { display: none` was the quieter version: no script, but
every element on the page restyled.

The reach is wider than the published page. There is one generator, so the same
string runs in the **editor canvas** — meaning anybody with edit rights on a
shared project could have it execute in a collaborator's authenticated session,
on the app's own origin. Editing rights on a shared project are not meant to be
rights over a teammate's account.

The interesting part is how it lasted. This codebase *did* think about
injection: everything that reaches a **selector** goes through `slug()` or
`anchorId()`, which whitelist to letters, digits, `_` and `-`, and three
separate comments in the runtime and the generator say so. Values were the other
half — the half a person types into — and nothing narrowed them. A guard applied
thoroughly to one input path and not at all to its neighbour is harder to notice
than no guard at all, because the file reads as though the question was
answered.

`<`, `>`, `{`, `}` and `;` are dropped, not stripped — the same choice already
made for an unknown reveal effect and for a condition naming a state nothing
declares. A mangled version of a value nobody wrote is worse than no value.
Dropping is only safe if nothing real needs those characters, so the whole block
library is swept for them rather than argued about, and that sweep is a check:
the rule cannot start quietly deleting design from a template.

### A way through when the panel has none

Every table of controls needs a way to admit it does not cover something.
Without one, the coverage it claims is only true of the list it wrote itself,
and the first property nobody thought of is a wall — the audit that started this
work found thirty-five of those and no way through any of them.

So: **declarations, not a block.** No selectors, no at-rules. What somebody
writes lands in that element's own rule, which means it cascades, responds to
breakpoints, and works inside a state exactly like every control above it. A raw
CSS block would let rules exist that the editor cannot see, undo, or reason
about, and the whole design rests on there being one description of what an
element looks like.

It could not have been built before the emitter was fixed. This field is the one
place a person is *invited* to type CSS, so it is the shortest path to every
hole the generator has — and it is safe now for a structural reason rather than
a filtering one: the text never becomes CSS. It becomes pairs, and each pair
goes through the same guard as every other declaration. Property names are
whitelisted as identifiers rather than filtered, for the reason selectors always
have been.

The count beside it is not decoration. An escape hatch exists because the panel
had nothing for what somebody wanted, so "it did nothing and said nothing" is
the one outcome that leaves them with no move at all. The first version counted
only fragments containing a colon, which meant a line like `nonsense` was
dropped *and* uncounted — the panel said "1 declaration" and stayed silent about
the line it had just thrown away. It counts everything non-empty now; trimming
is what keeps the trailing semicolon everybody writes from being reported as a
mistake.

### Building something with it

A panel full of new rows is a claim, not evidence, so the SaaS template's
feature band was rebuilt as a real **bento**: a 2×2 opener, two small cards
stacked in the third column beside it, one full-width card underneath. Nine
cells over a 3×3, every one filled by auto-placement with no item naming a line,
so dragging a card into a different order produces a different bento rather than
a broken one.

The first version of this write-up claimed the library had never been able to do
any of it. That was wrong, and the correction is the more interesting finding.
A **column** span was always reachable — a block author writes TypeScript, and
one block, the bento, already used it. What no code anywhere had ever written
was a **row** span. So the honest statement is narrower and worse: the library
could vary a card's width and did, could vary its height and never did, and
every grid in all eight *templates* was uniform regardless — the capability
existed in the one place a user never looks.

That is what "the editor shapes the output" means concretely. A bento that
varies only by width is a row of wide and narrow cards, which is a fair
description of what shipped. Nobody decided that; it is just where a library
settles when the second axis has no control behind it.

Two bugs came out of building it, and both are the argument for building rather
than asserting.

**A switch could not say "off" anywhere but the base layer.** Off was
implemented as clearing the declaration, with a comment explaining that writing
`font-style: normal` would pin the property. True of the base layer, exactly
backwards everywhere else: at a narrower breakpoint absence means *whatever the
wider layer said*, so unticking the box left the element italic and the panel
insisting it was not. The same hole sat in the new span control — a card
spanning two columns on desktop could not stop on mobile, and a span wider than
the grid makes the browser invent the missing column, so the phone gets a
sideways scrollbar instead of a stack. Seven switches gained an `off` value and
the span control writes `auto`. Three milestones of checks did not find this;
trying to un-span one card found it in a minute.

**The static suite already knew, for one axis.** `checkColumnSpans` was sitting
in `tests/static/run.mjs` with a docblock describing that precise hazard —
written to guard the one hand-authored bento, and looking only at `gridColumn`,
because at the time nothing in the codebase had ever set a `gridRow` and no
panel row offered one. The rule was not wrong; it was as wide as the problem was
when somebody wrote it. A row span left unreleased is the quieter half — nothing
spills sideways, the card is simply twice as tall as the phone needs — which is
how it would have shipped. Both axes now, a rejection fixture for each, and the
failure message names the axis, since both spell themselves `span 2`.

**And the fix for the first bug shipped a worse one.** "Is this the base layer?"
was written as one expression:

```ts
const base = useEditor((s) => s.breakpoint) === 'desktop' && !useEditor((s) => s.activeRuleId);
```

`&&` short-circuits. On Desktop both hooks run; anywhere else the first operand
is false and the second `useEditor` is never called, so the hook count changes
between renders, React's hook list goes out of step, and **the entire inspector
came down through its error boundary the moment anybody switched to Tablet**.
It type-checks. It renders perfectly on the layer everything is designed on.
Every existing browser check drove that layer, so all of them stayed green over
a panel that no longer worked.

The rule is now a static check, because the mistake has a shape even though the
real analysis needs a parser: a hook call to the right of `&&`, `||`, `??` or
`?:` is greppable, and `?.` has to be excluded or the rule eats every optional
chain in the tree. It scans 121 files, asserts it read them, and is checked
against five spellings it must catch and three lookalikes it must not.

That the bug was found at all is the whole argument for the second breakpoint.
The check written to catch the *first* bug is what fell over, in the run that
was meant to confirm the fix. Both bugs live in the same blind spot — one
breakpoint, the widest one, the one a developer never leaves.

Two of the new checks were themselves wrong first, in opposite ways worth
keeping apart. One read a block spec's shape against *document* nodes, where
base declarations are keyed by breakpoint under `styles.desktop` — it reported
zero and failed loudly, which is the harmless version, because it was looking
for something that was there. The other tested four conditions and then built
its failure message from one of them, so deleting the tablet reset produced a
failing check whose detail read `4 cards restate both axes`. A check that fails
while reporting success is worse than one that never fires: the summary line
says look here, and the line under it says nothing is wrong.

### The actions, used

Jumping and copying had worked for months and no template used either. Putting
them in the SaaS page took three fixes, and each one was a different way of
failing quietly.

**A reference could not leave its own section.** A block names what it points
at — `refs: { scrollTo: 'Bento features' }` — and `buildTree` turns the name
into an id once the nodes exist. But a page is built one section at a time, and
each `buildTree` call resolved names against *its own section only*, so a name
naming anything else matched nothing. A name matching nothing is **deleted**,
by design and for good reasons in a block. The effect at template scale was
that a hero could not point at the features band, and got no error saying so.
Resolution now happens once per page, in `finishTree`, which `buildTree` calls
for the single-block case and `makeDocument` calls after all the sections are
built. Not a missing feature — a scope one level too narrow, and silent.

**A copy button shipped as a link to nowhere.** A button's `defaultProps`
include `href: '#'`, and `resolveTag` reads any href at all as "this goes
somewhere" and emits an `<a>`. Every button in the library had a real
destination, so nothing had ever exercised the case; the copy control is the
first thing in the codebase that genuinely goes nowhere. Omitting the key does
not help — the default fills it back in — so it sets `href: ''` explicitly.

**And the word could not change** — at the time. The first version keyed a rule
on the copied attribute and gave it `set: { label: 'Copied' }`, which should
render the node once per condition and let CSS choose. `variantsOf` expanded
content along a **state** or **data** axis only, so the `set` was skipped:
skipped, not rejected, so it read as working and did nothing. That is fixed
now — see *An axis has to be visible to every variant*, which is also where the
reason recorded here turned out to be the wrong one.

That last one is the interesting failure, because **the rule against it already
existed**: `checkContentRules` has refused exactly this since stage 2. It runs
over the *block library*. Templates were never passed through it, so a rule
blocks are forbidden to ship could ship from a template instead. Same shape as
`checkColumnSpans` guarding one axis, and as the browser suite driving one
breakpoint: a guard as wide as the road that existed when it was written.

### The jump that only works on one page

A jump lives in a section, and a section can appear on four pages. Put one in
the navbar and it points at something the home page has and the other three do
not. That looked like the next hole worth closing, and it is worth writing down
that **it was already closed** — the guess was wrong and checking took a minute.
Adding a jump to the shared navbar makes the suite name all three pages:
`saas pricing/index.html: #features — nothing on that page answers to it`. The
other half is covered too: where the reference is dropped rather than resolved,
the control falls back to `#` and the dead-link rule catches it by page.

One variant genuinely was not covered, and it is the quiet one. A node carrying
**both** a `scrollTo` reference and a real `href` renders as the jump — the
renderer prefers the reference — so the href is invisible dead weight right up
until the reference stops resolving, at which point the control silently
navigates somewhere instead of scrolling. It still works. It still passes the
dead-link rule, because the href is real, and the fragment rule, because there
is no fragment. Nothing would ever have reported it.

`setScrollTarget` has always deleted the href, and that was checked — but the
check tests the *editor operation*, and an author writing a spec by hand never
goes through it. So the rule is now structural and in both places for the reason
this file keeps relearning: over block specs, where `linkButton` should have
made it impossible, and over what templates actually build, where a composed
node need never have come from the library at all.

`#` is exempt and has to be — a button's `defaultProps` supply one, so every
jump button in a document carries a vestigial `href="#"` under a working jump.

### Three checks that never ran

The copy checks in `press.mjs` went nine runs across as many sessions without
producing a line anybody read. Not failing — **hanging**, which is why. Three
separate faults were stacked, and each one hid the next.

`navigator.clipboard.readText()` requires the document focused and does not
reject when it is not: it never settles. So `evaluate` waited forever and the
suite sat there until something killed it. No output, no failure, nothing to
read. A deadline on the read turned the hang into a failure, and the failure
turned out to be informative immediately.

Underneath it, **the attribute was read five seconds after a mark that lasts
1.4**. The runtime removes `data-cre8-copied` after 1400ms; the check for it ran
after the clipboard read. Even with a working clipboard that check could never
have passed — and "and stops saying so" was passing all along by asking whether
a mark that never arrived had gone away. Reading the mark first fixed one and
made the other honest: it now requires the mark to have existed.

Underneath *that*, the read genuinely cannot be made to work in this
arrangement. Focus is true before the click and false after, through
`bringToFront`, a real mouse gesture, closing the editor page, and giving the
acting page a browser of its own. The same read works against the SaaS template
in a one-context probe, so it is the harness rather than the product.

So the read was demoted to a logged value and the assertion moved to what is
actually observable. That is not a consolation prize: the runtime sets the mark
**inside `writeText().then()`**, so the mark is the platform confirming the
write resolved. The one thing it does not prove — that the string written is the
string advertised — is pinned in the static suite instead, against the source:
the value handed to `writeText` is `getAttribute('data-cre8-copy')` with nothing
in between. Put a `.trim()` there and it fails, quoting the line.

Worth naming the pattern separately, because it showed up **four times** in this
work: a check whose detail is a fixed string reports success while failing. The
summary line says look here and the line under it says nothing is wrong. Every
detail in the new checks is computed from the same values the assertion tests.

### Making a container clickable

Under *deliberately not done* for three milestones, and the reason given each
time was right: it needs the renderer to change an element's tag, and it needs
the no-nested-interactive rule enforced as it does. What that entry did not say
is that **the second half was already broken without the feature**.

`canContain` has refused a button directly inside a link since Fix 1, with a
comment explaining that the parser lifts the button out rather than rejecting
it. It could never do more — it compares two *types* and is called mid-drag,
with no tree to consult. So `link > frame > button` was allowed: every step
legal, nothing looking at the chain, the same invalid markup at the end. Nothing
anywhere enforced interactive nesting past one level.

So the order was: fix that first, then the feature.

**One question, one place.** `isInteractive(node)` takes a node rather than a
type, and that is the whole design. A layout box given somewhere to go renders
as an `<a>` while its type stays `frame`, so anything reasoning about types goes
blind at exactly the moment the element becomes interactive. It answers for both
spellings of a destination — an `href`, and a `scrollTo` reference, which
carries no href at all until the renderer resolves one. The first version
checked `props.href` only and would have waved a button straight into a card
that jumps.

**Three gates, because there are three questions.** `canReparent` governs the
move and has ids, so it walks the dragged subtree — dropping a button into a
link is the case people picture, and dragging a *card containing* a button is
the same markup and the easier mistake. `findContainer` governs canvas drop
targeting and has only payload *types*, because a payload from the insert panel
does not exist yet. The layer tree was previewing with `canContain` and would
have drawn an "inside" indicator over a target the drop then refused — which its
own comment, three lines up, warns against.

**The control is not a new one.** The destination rows were lifted out of
`LinkContent` into a shared `Destination`, and lifted rather than copied for the
reason this codebase already has written down: "where does this go" had three
answers in the renderer and the fix was one function all three ask. A second
copy in the panel would be the same mistake one layer up. A button, a link and a
clickable card now get identical rows, and a card has no label field because its
words are the elements inside it.

One thing that looked like a bug and was not. Driving the new control in a
browser showed the canvas rendering `<a href="#">` where the published page had
the real URL. That is `canvas/engine.ts` resolving every href to `#` on purpose,
so a click in the editor does not navigate away from it — true of links and
buttons since Phase 3, and inherited here by going through the same resolver
hook. The check was wrong, not the code.

### Forty-six fragments

The SaaS rebuild had established the pattern, so the other six templates were
surveyed before being touched. The survey is the finding:

| | grids | spans | reveals | jumps | copies |
|---|---|---|---|---|---|
| six templates | 17 | 0 | 0 | 0 | 0 |

And the navigation, which is the part that mattered: **forty-six hand-typed
`href: '#work'` fragments**. Every one worked. That is why they lasted — a
fragment is a *name*, so it breaks silently on rename, into a link that scrolls
nowhere, and nothing had renamed anything yet. The reference machinery built for
exactly this had been unused since M3.

**Why it was unused: "a label and somewhere to go" was declared three times.**
`BlockLink` in the kit, `LinkSpec` in `compose`, `ButtonSpec` beside it. `jumpTo`
was added to the first, so `navBlock` and `button()` could only ever type a
fragment — the capability existed and two of the three doors to it did not open.
`LinkSpec` is an alias now, `ButtonSpec` extends it, and one `goesTo()` answers
for the nav row, the nav's call to action, the footer and every button. The
footer was a *fourth* caller, found only because a converted link there fell
back to `#` while the identical nav entry above it worked.

**A reference could resolve to the node making it.** Names resolve first-wins,
and the natural name for a nav entry is the name of the section it points at — a
link called "Work" above a section called "Work". The nav comes first, so the
link took its own id, resolved to an element with no anchor, and published as a
link to nowhere while looking in the document exactly like a working reference.

The first fix was half of one: skip self, drop the reference. That converts a
silent wrong into a visible wrong rather than into a working link. The index
keeps every candidate per name in document order now and takes the first that is
not the referrer. First-wins is unchanged otherwise, for its original reason —
last-wins would rewire a block the moment somebody duplicated something below it.

That fix nearly went untested. Naming the nav links "Work link" *also* fixes the
templates, so with both in place, undoing the resolver clause broke nothing
visible and the falsification came back green. The collision is built
deliberately in a fixture and kept.

**What was not done, and why.** A clickable card had no honest home in these
templates: the blog's post card is already a `link` element, and the other three
galleries sit on single-page sites with nowhere for a card to go. Inventing a
destination to demonstrate a feature would be the same mistake as the uniform
grid, arrived at from the other direction. The galleries got reveals and an
optional wide card instead — on galleries and not on every card in the library,
which is a judgement worth stating: a reveal reads as intent on something with
visual weight arriving in a rhythm, and as noise on a dense list of lines. Twelve
menu prices fading up one after another is motion for its own sake, so
`listBlock` — menus, FAQs, changelogs — was left alone.

The agency's work grid became a bento, which needed a *seventh* piece of work: two wide plus five ordinary is nine cells in
three columns and lands exactly, where one wide would be seven and leave two
empty at the end. Measured at 740/360, 360/360/360, 740/360 across three rows,
no overflow at any width.

One environmental note worth writing down: the photo-bearing templates cannot be
opened through `openProject` in a sandbox with no route to the placeholder
photography host — the requests never settle and `load` never fires. It predates
this work and is not a product fault. Geometry for those is measured by
generating the published file and opening it over `file://`, which is what was
being measured anyway.

### An axis has to be visible to every variant

The restriction that stopped a copy button saying "Copied" was recorded as
mutual exclusion: each variant needs one condition, the base needs one more,
and only a state or a data source guarantees it. That reasoning does not
survive contact with an attribute. An attribute equals one of a set of values
or it does not — the same two-sided split — so the expansion stays linear.
`attr` was excluded because attributes arrived after the list was written and
nobody revisited it.

So the axis was widened, both static rules that mirrored the restriction were
widened with it, and the markup came out right immediately: two elements, one
saying `Copy` and one saying `Copied`, chosen by
`:where(:is([data-cre8-copied=""]))` with **no ancestor prefix** — the one shape
that cannot repeat the data-condition bug, because an attribute condition tests
the element itself.

Then pressing the button made it disappear.

**The real requirement is a different one, and only a browser showed it.** An
axis has to be *legible to every element the expansion produces*. A state lives
on an ancestor and a data value on the document element, so every variant can
read them. The copy runtime set the mark on the element that was clicked — and
its sibling is a different element, so the sibling's rule, which says "hide
unless *I* am marked", kept it hidden. Both halves hidden, no button.

The fix says the thing that was always true and had never needed saying: **the
mark belongs to the node, and a node may render as more than one element.** The
runtime now marks every element sharing the node's class, through its own
`root` rather than the document, so mounting on the editor's canvas frame does
not reach into the app's chrome. For a control with no variants that is the
clicked element and nothing else.

Worth keeping the shape of the mistake. The argument for widening was sound and
the thing it proved was not the thing that mattered — linearity was never at
risk, and observability was never considered. A check derived from that argument
would have been green on a button that vanished when pressed.

### A panel as long as what the element uses

Every milestone above added rows to the inspector and none of them changed its
shape. It ended as one scroll of fifteen accordions in import order — a
reasonable order for a stylesheet and a poor one for a person, with *where this
box sits* eleven sections below *what colour it is*.

The first attempt at that was four tabs: Content, Style, Rules, Actions. It was
the wrong cut, and the suite said so in numbers before anyone had to argue
about it — **Style held ten sections and the other three held one apiece.** A
navigation control where three of four destinations are nearly empty, charging
a click on every edit to reach the ten. What was actually wrong with the old
panel was never that it was one scroll. It was that it showed everything at
full weight whether or not the element used any of it.

So: one scroll again, and **a section is on screen for exactly three reasons**.

  1. It is *essential* to this kind of element.
  2. The element *holds something* in it.
  3. Somebody just asked for it.

Everything else is behind one **Add** button, grouped in the same plain words
the headings used — Arrangement, Appearance, Motion, Behaviour, Advanced — with
a sentence each. A heading arrives with Content and Typography. A frame arrives
with Layout, Size and Spacing. The SaaS template's hero section, which has been
designed, arrives with five sections and fourteen rows.

This is not a new idea in this panel; it is the old one finished. Layout has
always been hidden on a heading and Data outside a repeater, because neither
can do anything there. **"Cannot apply" and "is not used" are the same argument
at different strengths**, and the panel only ever made the first.

**The essentials are the part worth arguing about**, because a panel that opens
to nothing is honest and useless — a designer needs something to push against
before they know what they want. Containers get Layout and Spacing, because
arranging what is inside is why the thing exists. Anything with words gets
Typography. Everything except pure text gets Size: a heading is sized by its
words, and a width set by hand on one is rare enough to be worth a press. A
button is a container with text, so it gets all four, which is right — it is
also the element people restyle most.

`sections.ts` holds the whole thing as data, and that split does more work than
it looks. Three questions — what is showing, what can Add offer, what does
Remove take away — have to be three readings of one list. Answered where each
happened to be convenient, they would disagree within a month. The `props` come
from `STYLE_VOCABULARY` rather than a second list, so the table that made
coverage a compile error is also the table that decides when a section appears.

**Removing a section removes what it held**, in every breakpoint and every rule,
in one undoable step. The alternative — hide it, keep the declarations — leaves
an element styled by rows nobody can see, which is precisely the failure a panel
that hides things must not have. Clearing only the layer on screen would be
worse than either: the section would still be in use, so it would stay, and the
button would read as broken.

Two things fell out of building it that the drawing could not have shown.

**Four passengers.** Every container was showing Link, Semantics, Switch and
Continuous value, because `ContentSection` rendered them for anything that
could hold children. Four accordions per frame, asking every box whether it is
a link, on a panel whose whole problem was length. They are sections now: a box
that is not a link does not have a Link row, and the Add menu offers it.

**A section holding a warning is in use by definition.** The panel reports a
rule reading an element that is no longer there, and it reports it inside Data.
Hide Data because nothing is bound, and the warning goes with it — the rule
still cannot work, and now nothing anywhere says so. `used` asks about dangling
reads as well as about bindings.

And one that only the browser could show. The multi-selection subscription
mapped the selection to nodes *inside* the store selector, so it built a fresh
array on every call, the identity check never settled, and React error #185 —
maximum update depth — was thrown on the second click. The inspector's error
boundary caught it and unmounted the panel, which from the outside looks
exactly like the inspector deciding not to appear. Nothing was logged to the
page; the suite saw an `<aside>` count of zero and said so.

### Ctrl+Z changed the document in one browser and nowhere else

Found while chasing the check above, and much worse than what it interrupted.

`transact` emits the patches it produced to the collaboration client, which
sends them to the room. `undo` and `redo` did not. They applied the inverse
patches locally, set `saveStatus: 'dirty'`, and stopped.

Which would be survivable if autosave picked it up — except **autosave is
deliberately suspended while a room is live**, and the room is live in every
session, because the socket connects when the editor opens. The room persists
every patch, so a whole-document PUT on top of that would bump the version and
force everyone into a resync; suspending it is correct. The consequence was
that pressing Ctrl+Z changed the canvas in front of you and nothing else. The
room kept the un-undone document, every collaborator kept it, D1 kept it, and a
reload brought the undone edit back.

The fix is that all three paths call one `emitPatches`, because for a long time
there was one copy of that loop and the two that were missing were exactly the
two nobody had written it into. The patches were already there — `inverse` on
the transaction for undo, `patches` for redo.

Worth recording how it surfaced, because it is the third time in this document
that the same shape has: a check written for one thing read a value it did not
expect. The inspector check asked the *API* whether a removed border came back
after an undo, saw that it had not, and the panel in front of it said it had.

### A room that woke up not knowing which project it was

Found from the outside, by a browser suite, while it was doing something else
entirely: a live editing session started answering **"Project not found"** for a
project sitting intact in D1.

`ProjectRoom` is addressed by `idFromName(projectId)`, and there is no way back
from a Durable Object id to the name it was derived from. The alarm path already
knew that — it writes the project id into storage, with a comment saying why.
The socket path did not. A room that hibernates and is woken by a message on a
hibernated socket comes back with *no request behind it*: no URL, no query
string, `projectId` an empty string. `ensureLoaded` then asked D1 for a project
called `""`, found nothing, and set `loaded = true` anyway.

From that moment the object was certain a document that existed did not:

- every read returned `document: null`, and the route turned that into a 404
  for a project the caller owns;
- every patch went to `applyPatches(this.doc ?? {}, …)` — an *invented* empty
  document. Most throw, and the room answered the throw with `resync` carrying
  `doc: null`, which the client accepts as "you are up to date". The ones that
  don't throw are worse: `persist()` would have written the invented object
  straight over the real one.

Three changes, and the third is the one worth keeping in mind. The id goes to
storage the first time a request carries it, and comes back from storage when
the field is empty — the same fix the alarm has had all along. A load that found
no row is no longer remembered as a load: `loaded` is what stops the retry, so
setting it on a miss is what made one unlucky wake permanent. And **a patch is
refused outright when there is no document** — the client is told to reload
rather than handed a null and encouraged to keep typing into it.

The general shape: a cache flag that means "we tried" is not the same as one
that means "we have it", and hibernation turns that distinction into data loss.

### A normaliser that scribbled on the thing it was normalising

Reported as *"a frozen document in the Durable Object throws on republish"*, with
one line of evidence: `Cannot assign to read only property 'rules'`.

`hydrateDocument` repairs a document in place. It filters `children` that point
at nothing, re-derives `parentId` from the children arrays, turns a retired prop
into a rule, deletes the prop. Fifteen or so writes, all onto the object it was
handed — which is fine when the caller is `JSON.parse` and fatal exactly once.

Immer deep-freezes what it produces, so a room that has applied a single patch
holds a frozen tree. Every other route into publishing crosses an HTTP boundary
and re-parses on the way — `liveDocument` reads the room over `fetch` and gets a
fresh object — so the alarm is the only caller in the system holding the live
one. And the alarm is reached only by the sequence a person performs every day
and no suite ever had: edit a published project **in the editor**, where
autosave is deliberately suspended and patches are the only route, then write a
record.

So: `const source = structuredClone(input)`, and the repairs run on the copy.
`structuredClone` rather than a hand-written walk because the two levels a copy
could plausibly miss — a rule's `apply`, a style layer — are exactly the levels
the repairs reach into. Measured at 2.6ms on a 364-node template and 5.5ms at
1,456 nodes, on paths that run when a document is opened, resynced or published
rather than as somebody types.

**It healed itself, which is why it survived everything.** The alarm classifies
what it catches, cannot classify a `TypeError`, and rethrows for the platform to
retry — and the rethrow logged nothing. Retries eventually hit a reset room that
had reloaded from D1, where the document is parsed and unfrozen, and the publish
went through. A browser check driving the whole route passed with the bug in
place. The only outward difference was the clock: **39 seconds against 5**, on
the same machine, minutes apart.

Which is now the check. `republish` makes the edit in the editor, writes a
record, and asserts twice — that the site follows the record at all, and that it
does so inside 20 seconds rather than after a retry storm. Two checks because
they fail for different reasons and only one of them is about a slow machine.
The transient branch also says what it is retrying after, which it never did: an
error nobody records is an error nobody can find, and this one hid behind its
own recovery for as long as it existed.

The static half is the exact one: deep-freeze a real template, hydrate it, and
assert it comes back repaired. A fourth check went in beside it and came
straight back out — "and the frozen document is unchanged" cannot fail, because
`Object.freeze` already guarantees it. Every attempt to break the fix left it
green. The claim it was reaching for is made against an *unfrozen* document
instead, where the rule has to be kept rather than imposed — which is also the
one that catches the tempting shortcut of copying only what is frozen.

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
