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

### API and published sites (optional)

Only needed if you want hosted projects and published sites on your own domain;
the editor works with no backend at all.

```bash
cd workers
wrangler d1 create cre8                       # put the id in wrangler.toml
wrangler d1 execute cre8 --file=./schema.sql
wrangler r2 bucket create cre8-assets
wrangler r2 bucket create cre8-sites
wrangler deploy
```

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
