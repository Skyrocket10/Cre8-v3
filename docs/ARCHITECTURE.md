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

`variants` and `properties` are declared on `ComponentDefinition` and unused, so
adding them is additive.

---

## 6. Storage

```ts
interface StorageAdapter {
  listProjects(); loadProject(id); saveProject(doc); deleteProject(id);
  savePublished(projectId, site); loadPublished(projectId);
}
```

Two implementations ship: `IndexedDbAdapter` (default — zero infrastructure,
works offline, no account) and `CloudflareAdapter` (D1 for documents, R2 for
assets and published files, behind accounts and teams). Which one is active is
decided by a single build-time variable, `NEXT_PUBLIC_CRE8_API_URL`, read once
in `getStorage()`. The editor has no idea which is behind it.

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

---

## 7. Cloudflare shape

```
Cloudflare Pages   →  the editor (static)
Cloudflare Worker  →  API + published-site origin
Durable Objects    →  one live room per project
D1                 →  accounts, teams, project documents, deployments, assets
R2                 →  uploaded assets, generated site files
Cache              →  everything a visitor loads
```

Publishing uploads finished HTML. Serving a published page is a cache hit or an
R2 read — the Worker never renders. That is the whole cost argument: a site on
Cre8 should cost approximately nothing to run, and Worker invocations should
scale with editing, not with traffic.

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

Sessions are opaque random tokens, stored hashed, in `HttpOnly; Secure;
SameSite=None` cookies. `SameSite=None` is forced by the editor and API being on
different origins, which gives up the browser's built-in CSRF protection — the
replacement is `x-cre8-csrf`, a non-safelisted header that forces a preflight
only an allowlisted origin can pass.

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
