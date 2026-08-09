# Cre8 — the data layer

Phase D. A design for the thing eighteen blocks are already shaped like and
none of them can do, written to be argued against before any of it is built.

The same format as [STATE-AND-CONDITIONS.md](STATE-AND-CONDITIONS.md), and for
the same reason: the risky parts here are decisions, not code, and a decision
made in prose can be reversed for nothing.

---

## 1. What is actually missing

Three things in the codebase are already shaped for this and do nothing:

| Declared | In | Status |
|---|---|---|
| `NodeDataBinding { target, source }` | `document/types.ts` | reserved, unimplemented |
| `Page.dynamic { collection, param }` | `document/types.ts` | reserved, unimplemented |
| `form_submissions.payload` as JSON | `workers/schema.sql` | shipped — the precedent for how records should be stored |

And eighteen of the seventy-five blocks are list-shaped — Post grid, Product
grid, Team grid, Testimonials, Case studies, Related posts, Open roles, Data
table, Members, File list, Logo cloud and the rest. Every one of them is a
hard-coded array in a `NodeSpec` today. That is the payoff, stated plainly:
**D does not add eighteen blocks, it makes eighteen existing blocks real.**

What is *not* missing: a place to put records. D1 is already there, already
per-project, already access-checked.

---

## 2. The model

Three nouns, and the split between the first two is the one that matters.

```ts
/** The shape. Lives in the document, because it is design. */
export interface Collection {
  id: string;
  name: string;          // "Posts"
  slugField?: string;    // which field names the URL
  fields: Field[];
}

export interface Field {
  key: string;           // "title"
  label: string;
  type: FieldType;
  required?: boolean;
  /** For `reference`: which collection. For `select`: the options. */
  of?: string;
  options?: string[];
}

export type FieldType =
  | 'text' | 'richtext' | 'number' | 'boolean'
  | 'date' | 'image' | 'select' | 'reference';
```

**The schema lives in the document. The records live in D1.** That division is
load-bearing:

- A schema is a design decision — it belongs in the thing that is versioned,
  undone, collaborated on and exported. Putting it in D1 would mean the layer
  tree and the inspector reading the shape of a page over the network.
- Records are content. They change without the design changing, they can run
  to thousands, and they must not bloat a document that has to fit in
  IndexedDB and travel through a Durable Object on every keystroke.

Eight field types, and the list is short on purpose. `reference` and `image`
are the two that earn their complexity: a post needs an author and a cover, and
without them every collection is a flat spreadsheet.

---

## 3. Where records live

One table, records as JSON, exactly as `form_submissions` already does:

```sql
CREATE TABLE IF NOT EXISTS records (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,
  slug          TEXT,                -- extracted, because routes are built from it
  position      INTEGER NOT NULL,    -- manual ordering, which every CMS eventually needs
  published     INTEGER NOT NULL DEFAULT 1,
  data          TEXT NOT NULL,       -- the fields, as JSON
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

**Not a table per collection.** The alternative — real columns, real types,
real indexes — is better at everything except the thing that actually happens,
which is a designer adding a field on a Tuesday afternoon. Per-collection
tables mean per-project migrations, and per-project migrations mean a schema
migration system inside a website builder. SQLite's JSON functions handle
filtering and sorting well enough at the sizes §9 permits, and `slug`,
`position` and `published` are lifted out as real columns precisely because
those three are what every query touches.

The API routes are the ones that already exist for assets, with the same
`requireProjectAccess` check, the same project-prefix discipline, and the same
rule that a client-supplied id is validated against the project before it is
read. Nothing new is invented for authorisation.

---

## 4. The repeater, and how it composes

A repeater is a node that renders its subtree once per record.

```ts
interface SceneNode {
  /** Renders `children` once per matching record. */
  repeat?: {
    collection: string;
    filter?: { field: string; op: 'is' | 'isNot' | 'has'; value: string }[];
    sort?: { field: string; direction: 'asc' | 'desc' };
    limit?: number;
  };
  /** Reads a field of the record in scope into a prop. */
  bind?: Record<string, string>;   // { text: 'title', src: 'cover' }
}
```

That is the whole model addition. Everything else is plumbing, and most of the
plumbing already exists:

**The renderer already knows how to make one node into many elements.** Stage 2
did that for `set`: `variantsOf(node)` returns a list and both renderers loop
over it. A repeater is the same idea one level up — repeat the *subtree* rather
than the element — and it needs one thing stage 2 did not: a **record in
scope**, threaded down. A React context on one surface, a parameter on the
other; both cheap, and both already have the shape (`RenderEngine` is exactly
this kind of seam).

**The CSS does not grow.** This is worth saying because it is the thing that
would kill the idea if it were false. Every copy of a repeated subtree carries
the same node classes, because it *is* the same node — so one hundred products
generate one hundred DOM subtrees and zero extra rules. Contrast variants,
which needed a class each because each could be styled differently. Repeats
cannot: that is what makes them repeats.

**Resolution order is base → bind → set.** The node's own props first, then the
record's field, then any `set` from a condition. `set` wins because it is a
deliberate exception — "when out of stock, say Sold out" has to beat the bound
price — and because that is the order a designer reading the panel top to
bottom would predict.

**Stage 3 gets more honest, not more complicated.** A condition inside a
repeater can test a field of the record in scope, and because the record is
known at publish time, that resolves to the *static* expansion stage 2 already
does. It needs no new rendering path, which is the same claim stage 3 made and
is worth re-checking here rather than assuming.

---

## 5. The fork: when does repetition happen

This is the decision that has to be made deliberately rather than drifted into,
and it is the same shape as stage 3's flash question.

**At publish.** Records are read when the site is published, the repeater
expands into real elements, and every page is static HTML on a CDN. Keeps
everything the project has been built around: no script, indexed, correct when
printed, correct with scripting off, correct opened from a ZIP on someone's
desktop. Costs: content changes need a republish, and the file count grows with
the collection.

**At the edge.** The Worker renders the page per request from D1. Content is
always live. Costs: gives up full-page CDN caching, adds a D1 read to every
request, and breaks both the ZIP export and the works-from-disk property.

**On the client.** The page fetches JSON and renders rows. Cheapest to build
and the worst of the three: a crawler sees an empty list, the page is blank
without JavaScript, and it reintroduces exactly the flash stage 3 refused.

> **Recommendation: publish-time, and say so out loud in the product.** Every
> other decision in this project has been made the same way, and the properties
> it protects are the ones users notice. Staleness is a real cost, and §10
> handles it with automatic republish rather than by moving rendering.
>
> Edge rendering is the documented upgrade for genuinely per-request data — a
> signed-in visitor's own record — and it is *not* part of D. Stage 3 already
> drew that line and should not be redrawn quietly here.

---

## 6. The constraint nobody notices until it bites

**Publishing currently runs entirely in the browser.** `publishProject` builds
every file in the editor and POSTs the finished bytes; the Worker only stores
them. That is a good design for what it does today, and it is the single
biggest thing standing between D and any collection worth having:

- to expand a repeater, the browser needs the records — so **every publish
  downloads the whole collection**;
- a blog of fifty posts is fine, five thousand products is five megabytes on
  every publish;
- and automatic republish-on-record-change is impossible, because nothing on
  the server can render.

So D needs publishing to move — not duplicate — into the Worker. The renderer
is already framework-free TypeScript (`renderNodeToHtml`, `generateStylesheet`,
`variantsOf`) with no React and no DOM, so the same modules run there
unchanged. That matters: it is one implementation running in two places, which
is a different thing from the second implementation §1 of `ARCHITECTURE.md`
forbids.

The no-backend path keeps publishing in the browser, because it has no Worker
to move to and no collections either. The two paths share `generateSite`.

**Where it lands in the sequence is a judgement call.** It is not needed to
prove the model — a repeater over ten records is provable with the pipeline as
it stands — and it is needed before dynamic routes turn one page into two
hundred files. So: after the repeater works, before the routes multiply.

---

## 7. Dynamic routes

`Page.dynamic` is already reserved. Implemented, it means: one file per record,
with the collection's `slugField` naming the path.

```
/blog/            index, built from a repeater
/blog/hello-world/    from the record whose slug is "hello-world"
```

Two things fall out and both need deciding rather than discovering:

**Pagination is static too.** A collection of two hundred posts should not
publish one page with two hundred entries. `/blog/`, `/blog/2/`, `/blog/3/` —
generated at publish, each a real file, each indexable. This is the reason not
to reach for client-side pagination, which would give a crawler page one and
nothing else.

**The sitemap has to know.** It is generated from `doc.pages` today, which will
no longer be the list of pages that exist. It becomes the list of pages that
were *generated*, which is a fact the publisher has and the document does not.

---

## 8. The editor

The largest single chunk of work, and the least architecturally risky:

- a **Collections** panel beside Pages and Assets;
- a field editor — add, reorder, retype, with the retype path honest about what
  it cannot convert;
- a record table with search, ordering and a published toggle;
- a record form generated from the field list;
- **binding in the inspector**: inside a repeater, the content fields offer the
  collection's fields instead of a text input;
- and a **record to design against** — the exact pattern `switchDesign` and the
  data-source "Designing" control already use, for the same reason. A repeater
  showing nothing because the collection is empty is a canvas a designer cannot
  work on, so an empty collection renders placeholder rows.

---

## 9. Limits, stated as errors

Every one of these is a number that will be hit, and a builder that degrades
quietly at the limit is worse than one that refuses:

| | Limit | What happens past it |
|---|---|---|
| Collections per project | 25 | Refuse to create |
| Fields per collection | 40 | Refuse to add |
| Records per collection | 5,000 | Refuse to create; the UI says so before the button is pressed |
| Records feeding one repeater | 500 | `limit` is clamped, and the panel shows the clamp |
| Pages generated by one dynamic route | 1,000 | Publish fails with the count, rather than writing 4,000 files |
| Record JSON | 64 KB | Refuse to save |

The numbers are arguable. Having them, and surfacing them in the editor rather
than in a Worker log, is not.

---

## 10. Staging

| Stage | Scope | Gate |
|---|---|---|
| **D1** | Collections and records, headless. Schema on the document, records in D1, CRUD routes with the existing access checks. | Records survive a round-trip, and a hostile client cannot read or write another project's — proven in `security.mjs`, next to the checks that already prove it for assets. **landed** |
| **D2** | The repeater and binding. `repeat`, `bind`, record-in-scope in both renderers, expansion at publish. | A bound list renders identically on canvas and published, with no script, and the stylesheet does not grow by a single rule as records are added. |
| **D3** | Publishing moves to the Worker for the hosted path. | The same document publishes byte-identical output from the Worker as from the browser. That is a strong gate and the right one: it is the whole claim. |
| **D4** | Dynamic routes and static pagination. | A blog of thirty posts publishes thirty files plus a paginated index, every one reachable and every one in the sitemap. |
| **D5** | The editor: collections panel, field editor, record table and form, binding in the inspector. | Someone creates a collection, adds a record and sees it on the canvas without leaving the editor or reading this document. |
| **D6** | Republish on change. | Editing a record updates the live site with no manual publish, and republishing an unchanged collection writes nothing. |

### What D1 held to

Seventeen checks in `security.mjs`, and the ones that matter are the four
where B — a real account, signed in, with a project of their own — points it
at A's records. The sharpest is the last: **a record must not be reachable by
id through a project the caller does own**. Without `AND project_id = ?` on
every statement, an account holder could read the whole table by guessing ids,
and the access check would pass every time because the project named in the
URL really is theirs. It is the same rule the publish route applies to asset
keys, and it is checked the same way — by trying it.

Two decisions worth recording because they are not obvious from the code:

**The Worker does not know what a collection is.** A `collectionId` is an
opaque string scoped to the project, exactly as an asset key is. Validating it
against the document would mean parsing somebody's whole design on the path of
every record write, to buy a check the editor makes for free. The consequence
is that the limits split: the two the server can count in one query — records
per collection, bytes per record — are enforced there, and the rest (25
collections, 40 fields) are the editor's.

**A slug collision is a 409 with a sentence.** It is the single most likely
thing to go wrong here, and the person it happens to is a designer naming a
second post "About". A unique index turns it into a SQLite error message;
catching that one constraint by name turns it back into an answer.

D3 before D4 is the ordering §6 argues for. D5 last is deliberate and slightly
uncomfortable: it means D1–D4 are tested through fixtures rather than through
the UI, which is exactly how stage 2 and stage 3 were built and is the reason
they landed working. D6 is the one that can slip without blocking anything.

---

## 11. Deliberately not doing

**A query language.** Filter, sort, limit. Anything past that is a report
builder, and the escape hatch — a second repeater inside the first — covers
the cases that matter.

**Relations beyond a single reference.** One record pointing at another is
enough for a post's author and a product's category. Many-to-many wants a join
table, a picker UI and a cascade story, and it should wait for a case that
cannot be done with a `select`.

**Draft/publish workflow beyond a boolean.** `published` is a flag. Scheduled
publishing, revisions and approval chains are a product on their own.

**Importing from anything.** No CSV, no Notion, no Contentful. Each one is a
mapping UI and a support burden, and none of them is the reason a builder
either works or does not.

**User-generated content.** Records are authored in the editor. A published
site that *writes* records is a different security model — public write access
to D1 — and `form_submissions` already covers the case that actually comes up.

---

## 12. Open questions

1. **Does the schema really belong in the document?** §2 argues yes. The
   counter-argument is that two collaborators editing a field list is a merge
   problem the record store would have solved, and the Durable Object already
   carries the document.
2. **What happens to a bound node when its field is deleted?** Falling back to
   the node's own prop is the quiet answer and probably the wrong one; the
   layer tree should say something.
3. **Should `reference` resolve one level or many?** One level covers a post's
   author. Many invites a cycle, and the renderer has no depth budget for it.
4. **Is 5,000 records the right ceiling for a client-side editor?** The record
   table has to page against D1 rather than hold them all, which is a different
   panel from the one Assets uses.
