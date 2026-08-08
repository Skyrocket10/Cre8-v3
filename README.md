# Cre8

A visual website builder for designers. The canvas renders the real page — the
same engine draws what you edit, what you preview, and what gets published.

```
npm install
npm run dev          # http://localhost:3000
```

Open the app, pick a template, and you are designing. Projects are stored in
the browser (IndexedDB), so there is nothing to configure and it works offline.

---

## What it does today

**Design**  Canvas with zoom, pan, multi-select, resize handles, snapping,
drag-and-drop insertion, on-canvas padding and gap dragging, rulers, and a
contextual toolbar that changes with the selection.

**Responsive**  Desktop / tablet / mobile breakpoints with per-breakpoint
overrides. The inspector tells you whether a value is set here or inherited from
a wider screen, and one click drops back to inherited.

**Structure**  Windowed layer tree with drag reordering, nesting, rename, lock,
hide and component badges. Multiple pages with slugs and SEO metadata.

**Reuse**  Components with live instances — editing the main component updates
every instance, everywhere. Design tokens for colour, type, spacing, radius,
shadow and width that compile to CSS custom properties.

**Ship**  Chrome-free preview at any device size, one-click publish to static
HTML with sitemap and robots.txt, and a ZIP export you can drop on any host.

**Together** *(optional backend)*  Accounts, shared workspaces with roles, link
invites, and realtime co-editing with live cursors and selections.

**Templates**  Eight, including a four-page SaaS landing site. A template is
just a document, so anything you build could become one.

---

## The one idea that matters

There is a single renderer.

`src/lib/renderer/element-model.ts` decides what HTML a node becomes.
`src/lib/renderer/css.ts` decides what CSS it gets. The React renderer (canvas,
preview) and the string renderer (published files) both consume those two
modules and nothing else, so the three surfaces cannot drift apart.

Responsive rules are the interesting case. In the editor they compile to
`@container` queries evaluated against the page frame; in published output, to
`@media` queries evaluated against the viewport. Same rules, same cascade, same
breakpoints — which is why a 390px frame in the canvas behaves exactly like a
390px phone, and why the mobile heading measures 34px in both.

---

## Layout

Routes carry the project id in the query string (`/editor?p=…`) rather than the
path, because a static export can't enumerate project ids at build time. All URL
construction goes through `src/lib/routes.ts`.

```
src/
  app/                      routes: dashboard, editor, auth, invite, site
  components/
    canvas/                 canvas, overlays, spacing, rulers, drag, presence
    inspector/              layout, typography, fill, border, effects, box model
    panels/                 layers, insert, pages, assets, components, theme
    chrome/                 top bar, status bar, toasts, publish dialog
    preview/                preview mode, published-site viewer
    auth/                   sign-in form, account menu, team members, guard
    ui/                     buttons, inputs, colour picker, popovers
  lib/
    document/               node model, element registry, operations, tokens
    renderer/               element model, CSS generation, React renderer
    history/                patch-based transactional undo
    editor/                 store, registry, shortcuts, autosave
    canvas/                 drop targeting, snapping
    publishing/             static HTML generation, ZIP export
    templates/              block builders and the template registry
    api/                    storage adapters (IndexedDB, Cloudflare), API client
    auth/                   key derivation, session context
    collab/                 socket client, presence hook
workers/
  src/routes/               auth, teams, projects
  src/room.ts               ProjectRoom Durable Object
  src/lib/                  crypto, db access, HTTP plumbing
  schema.sql                D1 schema
```

Full reasoning in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Keyboard

| | |
|---|---|
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘C` `⌘X` `⌘V` `⌘D` | Copy, cut, paste, duplicate |
| `⌘G` / `⇧⌘G` | Group / ungroup |
| `⌘E` | Create component from selection |
| `Esc` | Select parent |
| `Enter` | Edit text, or go deeper |
| `Tab` | Next sibling |
| `Space` + drag | Pan |
| `⌘` + scroll | Zoom |
| `1` `2` `3` | Desktop / tablet / mobile |
| `⇧1` | Fit to screen |
| `S C F K G H P T B M` | Insert section, container, frame, stack, grid, heading, paragraph, text, button, image |

The full list is in the editor — the keyboard icon, bottom right.

---

## Deploying

`npm run build` produces a fully static site in `out/` — no server, no runtime,
nothing to pay for per request. It drops onto any CDN.

### Cloudflare Workers (recommended)

`wrangler.jsonc` declares an assets-only Worker pointing at `out/`. There is no
`main`, so there is no handler: Cloudflare serves the files from the edge and
asset requests cost no Worker invocations.

| | |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Or from your own machine:

```bash
npm run build && npx wrangler deploy
```

> **Don't let wrangler auto-configure this project.** On a repo with no
> `wrangler` config, `wrangler deploy` detects "Framework: Next.js" and runs
> `@opennextjs/cloudflare migrate`, which rewrites `next.config.ts` and then
> fails — OpenNext bundles a *server* build (`.next/standalone`) and a static
> export doesn't produce one. The committed `wrangler.jsonc` prevents that. If
> you ever do want the full Next server on Workers, remove `output: 'export'`
> from `next.config.ts` first; nothing in Cre8 needs it.

### Cloudflare Pages

| | |
|---|---|
| Build command | `npm run build` |
| Build output directory | `out` |

Pages uploads the output directory itself — do **not** add
`wrangler pages deploy` to the build command, or it will fail asking for a
`CLOUDFLARE_API_TOKEN` it doesn't have.

### API Worker — accounts, teams and collaboration (optional)

**You do not need this.** With no backend the editor stores projects in the
browser, works offline, requires no sign-in, and costs nothing. Deploy the
Worker when you want accounts, shared workspaces, live co-editing, or published
sites on your own domain.

Adding it turns on, in one step: sign-up and sign-in, workspaces with roles,
link invites, projects in D1, assets in R2, and realtime collaboration.

There are two wrangler configs in this repo — the site at the root and the API
in `workers/`. Use the scripts rather than bare `wrangler deploy`, which from
`workers/` picks up the *root* config and would deploy the site under the API
Worker's name:

```bash
npm run deploy       # the editor  (root wrangler.jsonc → out/)
npm run deploy:api   # the API     (workers/wrangler.toml)
```

**1. Create the resources**

```bash
npx wrangler d1 create cre8        # put the id in workers/wrangler.toml
npx wrangler r2 bucket create cre8-assets
npx wrangler r2 bucket create cre8-sites
npm run db:init                    # applies workers/schema.sql
```

**2. Set the password pepper**

```bash
npx wrangler secret put AUTH_PEPPER --config workers/wrangler.toml
```

Required — the Worker refuses every API request until it is set, rather than
storing weaker credentials. Use a long random string and never rotate it
casually: it is mixed into every stored verifier, so changing it invalidates
all existing passwords.

**3. Configure it** — in `workers/wrangler.toml`:

- `ALLOWED_ORIGINS` must include your editor's origin, or the browser blocks
  every request. This is the most common reason a correctly-deployed Worker
  appears dead.
- `ALLOW_SIGNUP` — set to `"false"` once your team has accounts. Invites keep
  working; open registration stops.

**4. Deploy the API**

```bash
npm run deploy:api
```

**5. Point the editor at it**

```
NEXT_PUBLIC_CRE8_API_URL = https://cre8-api.<subdomain>.workers.dev
```

> **This is a *build* variable, not a runtime one.** Next inlines every
> `NEXT_PUBLIC_*` value into the JavaScript bundle when it compiles, so it has
> to exist wherever `npm run build` runs. It is never read at runtime.
>
> Setting it under the editor Worker's **Variables and Secrets** will fail with
> *"Variables cannot be added to a Worker that only has static assets"* — and
> correctly so. `wrangler.jsonc` has no `main`, so that Worker has no handler,
> no runtime, and nothing that could read a variable. Even on a Worker that did
> have one, a runtime variable would have no effect here.

Set it in whichever place builds the app:

| How you deploy | Where it goes |
|---|---|
| Workers Builds (git-connected) | Settings → **Build** → build variables |
| Cloudflare Pages | Settings → **Environment variables** (applied to builds) |
| From your own machine | `NEXT_PUBLIC_CRE8_API_URL=https://… npm run deploy` |

The last row always works and needs no dashboard at all:

```bash
NEXT_PUBLIC_CRE8_API_URL=https://cre8-api.<subdomain>.workers.dev npm run deploy
```

Because the value is compiled in, changing it means a **rebuild**, not a
restart. The dashboard badge flips from "This browser" to "Cloud" once the new
build is live — that badge is the quickest way to tell whether it took.

Finally, add the editor's origin to `ALLOWED_ORIGINS` in
`workers/wrangler.toml` and redeploy the API. Without it the browser blocks
every call and the editor looks signed-out no matter what.

Nothing else changes: the editor talks to a `StorageAdapter` and has no idea
which one is behind it. Uploads start going to R2 instead of being inlined in
the document, which is what keeps hosted projects small.

Published pages are finished HTML written to R2 at publish time, so serving one
is a cache hit or an object read. No rendering happens on the request path.

---

## Accounts, workspaces and collaboration

Only in hosted mode. Local builds never show any of it.

**Accounts**  Email and password. The password never leaves the browser: it is
stretched with 600k rounds of PBKDF2-SHA256 client-side and only the derived key
crosses the wire, where the Worker HMACs it with `AUTH_PEPPER` before storing.
That split exists because a Worker gets 10ms of CPU — a server-side KDF strong
enough to matter would not fit. Sessions are opaque tokens in `HttpOnly; Secure;
SameSite=None` cookies; every mutating call must carry `x-cre8-csrf`, which
forces a CORS preflight that only an allowlisted origin can pass.

**Workspaces**  Every account gets a personal one at signup. Projects belong to
a workspace, and everyone in it can open them. Roles are `owner`, `admin`,
`editor`, `viewer` — an admin cannot promote past themselves or touch the owner.

**Invites**  Links, not emails, because this instance has no mail provider. The
API mints a single-use token and only stores its hash, so the link is shown
exactly once when you create it. Swapping in a mail provider later is one call
inside `handleCreateInvite`.

**Collaboration**  One Durable Object per project holds the live document and
fans out presence. Each client sends the version its patches were made against:
if the room has moved on, the patch is refused and that client is resynced
rather than merged. Not a CRDT — deliberately. Version fencing is small and
obviously correct, and its failure mode is a visible resync instead of silent
divergence. Sockets use hibernation, so an idle room costs nothing.

Cursors are broadcast in **document space**, so a collaborator's pointer lands
on the same element for everyone regardless of zoom. View-only access is
enforced by the room, not by hiding buttons: a viewer's patches are refused
server-side, and the editor gates `transact` so they see an honest read-only
editor instead of edits that vanish.

While a room is live the top bar reads **Live** — the room persists every patch,
so the debounced HTTP autosave stands down entirely.

---

## Scripts

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | App and Worker |
| `npm run deploy` | Build and deploy the editor |
| `npm run deploy:api` | Deploy the API Worker |
| `npm run db:init` | Apply `workers/schema.sql` to D1 |
| `node scripts/gen-icons.mjs` | Regenerate the icon set from Lucide |

---

## Not built yet

Deliberately out of scope: end-user databases, authentication for *published*
sites, workflows, server actions, payments, a CMS, and AI generation.

The document model reserves typed, unused slots for the three axes those need —
behaviour, data and logic — so they can be added without a migration or a
rewrite of the editor. See the last section of
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
