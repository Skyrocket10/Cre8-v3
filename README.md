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
HTML with sitemap and robots.txt, a site address of its own, and a ZIP export
you can drop on any host.

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
  sites/                    the published-sites Worker: R2 + KV, nothing else
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

Two shapes, and the difference is whether you want accounts.

### Static only — no backend

`npm run build` produces a fully static site in `out/`. Drop it on any CDN.
Projects live in the visitor's browser, there is no sign-in, and it costs
nothing to run. Nothing to configure.

### Two Workers — the whole product

```bash
npm run deploy         # editor + API
npm run deploy:sites   # published sites
```

| Worker | Serves | Bindings |
|---|---|---|
| `cre8` | the editor, `/api/*`, and `/s/<id>/` as a fallback | D1, R2 ×2, KV, Durable Objects |
| `cre8-sites` | published sites on `*.cre8.app` | R2 (read), KV (read) |

**The editor and the API share one origin.** That is what removes the
configuration that used to go wrong:

- **No API URL to set.** The API is at `/api/*` on whatever host served the
  page. There is no `NEXT_PUBLIC_CRE8_API_URL` to bake into the build, and so
  no "Variables cannot be added to a Worker that only has static assets" —
  that error came from trying to set a build-time value as a runtime one.
- **No CORS allowlist.** Same-origin requests never touch CORS.
- **`SameSite=Lax` cookies**, so the browser itself blocks cross-site request
  forgery instead of us having to.

The editor is still free to serve: Cloudflare's asset router answers anything
matching a file in `out/` without invoking the Worker, so the handler only runs
for `/api/*`, `/s/*` and genuine 404s.

**Published sites get their own domain**, and that is a security boundary, not
a cosmetic one. A published page contains author-supplied HTML — `customHead`
and rich text both pass through verbatim — so it can carry `<script>`. On the
editor's origin that script would run with a signed-in visitor's session
attached. On `*.cre8.app` it can reach nothing, and in exchange published sites
get to be ordinary websites with working storage and service workers.

Whether a backend exists is discovered at boot rather than compiled in: the
editor asks `/api/auth/me` once, and if nothing answers it runs in local mode.
The *same build* works both ways.

> **Don't let wrangler auto-configure this project.** On a repo with no
> `wrangler` config, `wrangler deploy` detects "Framework: Next.js" and runs
> `@opennextjs/cloudflare migrate`, which rewrites `next.config.ts` and then
> fails — OpenNext bundles a *server* build (`.next/standalone`) and a static
> export doesn't produce one. The committed `wrangler.jsonc` prevents that.

**Set it up once:**

```bash
npx wrangler d1 create cre8                  # id → wrangler.jsonc
npx wrangler kv namespace create SITE_ROUTES # id → both configs
npx wrangler r2 bucket create cre8-assets
npx wrangler r2 bucket create cre8-sites
npm run db:init                              # applies workers/schema.sql
npx wrangler secret put AUTH_PEPPER          # required; see below
npm run deploy && npm run deploy:sites
```

Then set your domain in **two places, and only two**:

| File | Field |
|---|---|
| `wrangler.jsonc` | `vars.PUBLIC_SITE_DOMAIN` |
| `workers/sites/wrangler.jsonc` | the wildcard `route` and its `zone_name` |

Both must be a zone on your Cloudflare account — a wildcard route cannot run on
`workers.dev`. Leave `PUBLIC_SITE_DOMAIN` empty and the second Worker is not
needed at all: sites stay on the main Worker at `/s/<projectId>/`, sandboxed.

`AUTH_PEPPER` is not optional — the Worker refuses every API request until it
is set, rather than storing weaker credentials. Use a long random string and
never rotate it casually: it is mixed into every stored verifier, so changing
it invalidates all existing passwords.

`ALLOW_SIGNUP` closes open registration when set to `"false"`. Invites keep
working.

**Upgrading a database created before site addresses existed?** SQLite has no
`ALTER TABLE ... IF NOT EXISTS`, so this one runs by hand, once:

```bash
npx wrangler d1 execute cre8 --remote --command "ALTER TABLE projects ADD COLUMN subdomain TEXT"
npm run db:init
```

**Run it all locally:**

```bash
echo 'AUTH_PEPPER = "local-dev-pepper"' > .dev.vars
npm run db:init:local
npm run preview          # editor + API on :8787
npm run preview:sites    # published sites on :8788
```

Two caveats local dev has and production does not. Both Workers must share one
state directory or the sites Worker reads an empty KV — hence the
`--persist-to` in those scripts, which resolves relative to each *config file*.
And `wrangler dev` rewrites the request host to a configured route's zone, so
hostname routing can only be exercised against a copy of the sites config with
`routes` removed.

### Cloudflare Pages, or any other host

Pages cannot run the API — it has no Durable Objects. Deploying `out/` there
gives you the static, browser-only editor, which is a perfectly good way to use
Cre8 and needs no configuration at all.

| | |
|---|---|
| Build command | `npm run build` |
| Build output directory | `out` |

Pages uploads the output directory itself — do **not** add
`wrangler pages deploy` to the build command, or it will fail asking for a
`CLOUDFLARE_API_TOKEN` it doesn't have.

### Split deployment (editor and API on different hosts)

Still supported, and the only case that needs configuration. Set
`NEXT_PUBLIC_CRE8_API_URL` where the build runs — it is compiled into the
bundle, so it belongs in build variables, never in a Worker's runtime
Variables and Secrets — and list the editor's origin in `ALLOWED_ORIGINS`.
Setting `ALLOWED_ORIGINS` is also what switches the session cookie to
`SameSite=None`, which a cross-origin editor requires.

```bash
NEXT_PUBLIC_CRE8_API_URL=https://cre8-api.example.workers.dev npm run build
```

---

## Accounts, workspaces and collaboration

Only in hosted mode. Local builds never show any of it.

**Accounts**  Email and password. The password never leaves the browser: it is
stretched with 600k rounds of PBKDF2-SHA256 client-side and only the derived key
crosses the wire, where the Worker HMACs it with `AUTH_PEPPER` before storing.
That split exists because a Worker gets 10ms of CPU — a server-side KDF strong
enough to matter would not fit. Sessions are opaque tokens in `HttpOnly; Secure;
SameSite=Lax` cookies — one origin means the browser blocks cross-site use
itself. Every mutating call also carries `x-cre8-csrf`, which a cross-site form
cannot forge.

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

**Published sites** get an address of their own on first publish —
`<name>.cre8.app`, slugified from the project name and editable in the publish
dialog. Renaming frees the old hostname immediately. A separate Worker serves
them from R2 through a KV hostname map, so the highest-volume path in the
system touches no database and no session.

With no site domain configured they fall back to `/s/<projectId>/` on the main
Worker, where they share an origin with the editor and are served with a
sandbox CSP to keep author-supplied `<script>` away from the session.

---

## Scripts

| | |
|---|---|
| `npm run dev` | Next dev server, editor only (no API) |
| `npm run build` | Static build into `out/` |
| `npm run preview` | Build, then run the editor + API locally on `:8787` |
| `npm run preview:sites` | Run the published-sites Worker on `:8788` |
| `npm run typecheck` | App and Worker |
| `npm run deploy` | Build and deploy the editor + API |
| `npm run deploy:sites` | Deploy the published-sites Worker |
| `npm run db:init` | Apply `workers/schema.sql` to D1 |
| `npm run db:init:local` | Same, against the local dev database |
| `node scripts/gen-icons.mjs` | Regenerate the icon set from Lucide |

---

## Not built yet

Deliberately out of scope: end-user databases, authentication for *published*
sites, workflows, server actions, payments, a CMS, and AI generation.

The document model reserves typed, unused slots for the three axes those need —
behaviour, data and logic — so they can be added without a migration or a
rewrite of the editor. See the last section of
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
