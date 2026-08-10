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
every instance, everywhere. Expose a property and each instance can say
something different: its own text, its own picture, its own link, or nothing at
all where another shows a badge. Properties change what an element says, never
how it is drawn, so a page of customised instances costs no extra CSS — and
when a different *look* is what you want, a variant gives the component a
second tree to wear, with its own styles, chosen per instance. Design
tokens for colour, type, spacing, radius, shadow and width that compile to CSS
custom properties.

**Overlays**  Popovers and dialogs are the browser's own — `[popover]` and
`<dialog>`, so the published page ships nothing for them. Double-click one on
the canvas to edit *inside* it: insertion, selection and the layer tree all
narrow to the overlay until you leave, so nothing lands on the page behind it.
Backdrops are a control on the overlay rather than a rule to go and build.

**Interaction**  Switches, tabs, filters and steppers, all of them a named
value plus a generated CSS rule — the published page ships about 2 KB for the
lot, and works with scripting off. Plus continuous values: a number a box holds
as a CSS variable, moved by a native slider, for a before/after comparison or
anything else that is a position rather than a choice.

**Content**  Collections with typed fields, a record table and form in the
editor, repeaters that draw one copy per record, and pages that become one
published file per record with a paginated index beside them. Editing a record
updates the live site on its own — no publish, and only the files that moved.

**History**  Every publish is kept, with who made it and what it changed. The
ones you made by hand keep the design they shipped, so you can put one back —
on the canvas and on the site — without touching the content that has been
written since.

**Ship**  Chrome-free preview at any device size, one-click publish to static
HTML with sitemap and robots.txt, a site address of its own, and a ZIP export —
images and all — that works dropped on any host or opened straight from disk.

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
    panels/                 layers, insert, pages, assets, components, theme,
                            collections
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
  src/routes/               auth, teams, projects, records, forms
  src/room.ts               ProjectRoom Durable Object — and the republish alarm
  src/lib/                  crypto, db access, HTTP plumbing, site rendering,
                            the diffed publish, hostnames
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

**Upgrading an existing database?** `npm run db:init` will not do it. Every
statement in `schema.sql` is guarded, but `CREATE TABLE IF NOT EXISTS` does
nothing to a table that already exists, and SQLite has no `ADD COLUMN IF NOT
EXISTS` — so a column added to a shipped table cannot be in that file at all.

Ask the deployment instead. It reads its own schema and adds only what it is
missing:

```bash
# what is missing
curl -b cookies.txt https://<your-worker>/api/admin/schema

# add it
curl -b cookies.txt -X POST -H 'x-cre8-csrf: 1' https://<your-worker>/api/admin/schema
```

A signed-in account is the whole bar, on purpose. Idempotent, additive, and it
touches no rows: it issues `ALTER TABLE … ADD COLUMN` for a fixed list in
`workers/src/lib/schema.ts` and nothing else, and every column on that list is
one the running code already expects. The
static suite checks that list against `schema.sql` in a real SQLite database on
every commit, so a column added to one and forgotten in the other fails
`npm run verify` rather than a deploy. Doing it by hand with
`npx wrangler d1 execute cre8 --remote --command "ALTER TABLE …"` still works
and is equivalent.

A deploy that outran its database says so rather than returning `Internal
error`: the failing request comes back `Database is behind this deployment`
with the missing column named and this endpoint quoted.

`site_manifest` is what lets a publish write only the files that changed and
remove the ones a deleted record left behind. Without the column the publish
route fails outright, which is deliberate: a manifest that silently never
persisted would mean every republish rewriting the whole site for ever, with
nothing to show for it.

`deployments.document` is the design each publish shipped, which is what makes
publish history restorable, and `changed` is what that publish did to the
bucket. Publishing writes both, so the route fails until they exist too.

**Run it all locally:**

```bash
echo 'AUTH_PEPPER = "local-dev-pepper"' > .dev.vars
npm run db:init:local
npm run preview          # editor + API on :8787
npm run preview:sites    # published sites on :8788
```

Add `--local` to the `ALTER` commands above (and `--persist-to .wrangler/state`)
if your local database predates them.

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
sites, workflows, server actions, payments, and AI generation.

The content layer is built, and its edges are drawn on purpose: filter, sort
and limit rather than a query language; one reference between records rather
than many-to-many; a `published` flag rather than a revision and approval
system; and no importing from anywhere. The reasoning for each is in
[docs/DATA-LAYER.md](docs/DATA-LAYER.md).

The document model reserves typed, unused slots for the three axes those need —
behaviour, data and logic — so they can be added without a migration or a
rewrite of the editor. See the last section of
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

What the component library grows into from the current 22 primitives and 9
blocks — the marketing and application sets, and which capability gates each of
them — is planned in
[docs/COMPONENT-LIBRARY.md](docs/COMPONENT-LIBRARY.md). The build order for the
49 components that need no new capability is in
[docs/COMPONENT-BUILD-PLAN.md](docs/COMPONENT-BUILD-PLAN.md).
