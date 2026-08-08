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
  app/                      routes: dashboard, editor, published site
  components/
    canvas/                 canvas, overlays, spacing, rulers, drag controller
    inspector/              layout, typography, fill, border, effects, box model
    panels/                 layers, insert, pages, assets, components, theme
    chrome/                 top bar, status bar, toasts, publish dialog
    preview/                preview mode, published-site viewer
    ui/                     buttons, inputs, colour picker, popovers
  lib/
    document/               node model, element registry, operations, tokens
    renderer/               element model, CSS generation, React renderer
    history/                patch-based transactional undo
    editor/                 store, registry, shortcuts, autosave
    canvas/                 drop targeting, snapping
    publishing/             static HTML generation, ZIP export
    templates/              block builders and the template registry
    api/                    storage adapters (IndexedDB, Cloudflare)
workers/                    Cloudflare API Worker, D1 schema, wrangler config
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

### API worker (optional)

**You do not need this.** With no backend the editor stores projects in the
browser, works offline, and costs nothing. Add the Worker when you want
projects to follow you between machines, or published sites on your own domain.

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

**2. Configure it** — in `workers/wrangler.toml`:

- `ALLOWED_ORIGINS` must include your editor's origin, or the browser blocks
  every request. This is the most common reason a correctly-deployed Worker
  appears dead.
- `ALLOW_ANONYMOUS` — read the warning below before setting this.

**3. Deploy and point the editor at it**

```bash
npm run deploy:api
```

Then set `NEXT_PUBLIC_CRE8_API_URL` in your Pages/Workers environment variables
and rebuild. It is read at build time, so a redeploy is required — the
dashboard badge flips from "This browser" to "Cloud" once it takes effect.

```
NEXT_PUBLIC_CRE8_API_URL = https://cre8-api.<subdomain>.workers.dev
```

Nothing else changes: the editor talks to a `StorageAdapter` and has no idea
which one is behind it. Uploads start going to R2 instead of being inlined in
the document, which is what keeps hosted projects small.

> ### ⚠️ There is no authentication yet
>
> `ownerFrom()` in `workers/src/index.ts` is the seam an auth provider plugs
> into, and nothing is plugged in. With `ALLOW_ANONYMOUS = "true"` every
> request is the same owner, so **anyone who can reach the API can read, edit
> and delete every project on it.**
>
> That is fine for a personal instance on a URL you don't share. It is a data
> leak on anything public. The Worker refuses requests without an identity
> unless you switch that flag on deliberately, so this can't happen by
> accident — but the flag is the whole protection. Wire in Cloudflare Access,
> Supabase or Auth.js before putting real users on it.

Then point the editor at it by swapping the storage adapter at boot:

```ts
import { setStorage } from '@/lib/api/storage';
import { CloudflareAdapter } from '@/lib/api/cloudflare';

setStorage(new CloudflareAdapter({ baseUrl: 'https://cre8-api.example.workers.dev' }));
```

Nothing else changes — the editor never knew where documents lived.

Published pages are finished HTML written to R2 at publish time, so serving one
is a cache hit or an object read. No rendering happens on the request path.

---

## Scripts

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `node scripts/gen-icons.mjs` | Regenerate the icon set from Lucide |

---

## Not built yet

Deliberately out of scope for this release: end-user databases, authentication
for published sites, workflows, server actions, payments, a CMS, realtime
collaboration and AI generation.

The document model reserves typed, unused slots for the three axes those need —
behaviour, data and logic — so they can be added without a migration or a
rewrite of the editor. See the last section of
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
