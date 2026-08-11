# Tests

Two tiers, split by what they cost.

## Static — `npm run test`

About a second, no browser, no server. Reads straight off the `NodeSpec` trees
that `BLOCKS` produces and checks the things a screenshot of one block at one
width will never show you:

- every colour and font comes from a theme token
- multi-column layouts declare narrow-width behaviour
- heading levels do not skip
- images carry alt text worth reading
- no nesting the HTML parser would rearrange on the way out
- every popover button names a popover that is in the same block
- every state has something depending on it, and every control changes something
- every tab has one panel and every panel has one tab
- buttons and links respond to hover
- no block still says when it shows in props, rather than as a rule
- content varies on one state, exclusively, so the expansion stays linear
- every node is named for the layer tree

The output-size transforms are checked the same way, and both are checked for
the case they must *refuse* as well as the saving they make: a conditional rule
is never merged into the base layer, and three sides of padding never collapse
into a shorthand that would invent the fourth.

It also compiles real conditions through the generator and asserts on the CSS
that comes out — that a condition on the visit lands on the same anchor a state
does, at the same weight, and drives the same expansion into elements. That is
the whole of the stage-3 gate, and it is a claim about output, so it is checked
against output rather than against the code that produces it.

Tests get the same treatment, for the same reason: "the evaluator has three
answers" and "later rules win" are claims about a function. The runtime
evaluator is driven here too, against a fake DOM — it exists twice because the
published copy is serialised with `toString()` and can import nothing, so the
two are compared over a matrix of values rather than read side by side and
declared similar. Undecidability is
checked in every place it could be quietly turned into `false`, ordering is
checked in both directions — a check that only ever sees one ordering cannot
tell order from luck — and the overlap warning is checked for staying quiet as
well as for firing, since a warning on every pair is a warning nobody reads.

An assignment that also writes a rule is checked by *comparison*: the same
design built through the shortcut and built by hand, asserted to be the same
document. What that leaves interesting is everything after — renaming the
state, renaming the key, removing the assignment, and a rule the designer has
since edited, which the shortcut has to stop claiming.

Value formatting is checked here rather than in a browser, because its whole
claim is that two different JavaScript engines agree — which is a claim about a
function, not about a page. So the worked examples sit next to a scan of the
source for the things that would break it quietly: `Intl`, `toLocale…`, a
local-time getter, a clock. Alongside them are the two structural checks that
keep formatting out of comparisons — `formatValue` has exactly one caller, and
the record is unchanged after a binding resolves.

It also runs `migrateDocument()` over a hand-written older document. That
function upgrades every project every time one is opened and rewrites the part
of a node that decides whether the node is visible, so the checks cover the
two properties that are not obvious: it recognises the *shape* rather than
trusting `version` — the field was written from the beginning and read by
nothing, so a document saved last year and one saved last week both claim `1` —
and it is safe to run twice.

Run it on every commit. `npm run verify` is this plus `typecheck`.

The suite ends by handing each rule something it must reject. A lint that
passes on its first run has not been shown to do anything — a regex that
quietly stops matching looks exactly like a clean codebase — so if one of those
self-tests ever passes, that rule has become a no-op.

The block modules are TypeScript, but every import they make outside their own
directory is type-only, so `tsc` transpiles the eight of them alone. No bundler,
no extra dependency, nothing to install beyond what the app already needs.

## Render — `npm run test:render`

Needs a Worker and a browser. Start one in another terminal:

```
npm run preview                    # builds, then serves on :8787
npx serve out -l 3001              # the `local` suite needs this too
npm run test:render                # every suite
npm run test:render nav borders    # or just some
```

The `local` suite is the odd one out: it checks that the same static export
works with no backend at all, so it needs the build served on its own origin
with nothing behind it. Override with `CRE8_LOCAL_URL`. It says so and exits
rather than failing with a connection error if that origin is missing.

Point it elsewhere with `CRE8_TEST_URL=https://…`. Chromium is discovered from
`PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`) or `CRE8_CHROMIUM`,
preferring an installed copy over downloading one.

| Suite | Asks |
|---|---|
| `fidelity` | Does the canvas compute the same styles as the published file, on one template |
| `blocks` | The same question of every block in the registry, alone, at 390 / 768 / 1440 |
| `panel` | The Insert panel at library scale: grouping, search, live previews |
| `nav` | Do page links work inside a published site |
| `native` | Do `<details>`, the form controls, `[popover]` and `<dialog>` behave with no runtime |
| `tables` | Does tabular markup survive the parser, and does the editor refuse to break it |
| `behaviour` | Do switches, tabs, filters and steppers work — with the script, without it, and identically on both surfaces. And does a state decided by what somebody types follow them as they type, put itself back when they clear the field, and land on the declared fallback when nothing is running |
| `data` | Is a condition on the visit resolved before the first paint, and coherent with no scripting at all |
| `repeat` | Does a bound list draw the same rows on the canvas and in the file, with no script and no extra rule as records are added — and does a price stored as `1250000` read as `$1,250,000.00` on both surfaces, formatted by the publisher rather than by a script. And does a record put its own row into its own state — `price > 1000000 → premium` — the same answer on the canvas and in the file, one rule in the stylesheet, no script |
| `worker-publish` | Does the Worker publish the same bytes a local render produces, and do the runtimes it serialises still run |
| `routes` | Does a collection become one page per record plus a paginated index — walked link by link, and matched against the sitemap |
| `collections` | Can somebody make a collection, write a record and see it on the canvas — every step a click, no fixtures |
| `republish` | Does the live site follow its records with nobody pressing Publish, does a second publish write nothing, and do the two things that must *not* republish stay put |
| `history` | Is every publish kept and honestly labelled, can a design be put back on the canvas and the site, and does the content written since survive it |
| `inspector` | Does an inspector edit reach the element it was showing rather than the one selected next, does inline text survive a click elsewhere, and does an open overlay actually scope what gets inserted. Every check involves two elements, because one cannot see this class of bug |
| `menus` | Right-click: does the menu open where the pointer is, stay on screen — submenus included — keep a multi-selection, close without selecting what it closed over. Does Duplicate from the menu do exactly what ⌘D does, down to the undo step. And is it about the *thing* you clicked everywhere else: reset that padding, duplicate that page, delete that variant rather than its component, that field rather than the first one, place that asset, copy that token's reference, duplicate that record as a draft and see it in the list — which the editor could not do, because it only ever asked the server for published rows |
| `components` | Three instances of one component: two saying different things and pixel-identical, one wearing a variant and visibly not. Same classes where they should be shared, canvas and file agreeing element by element, and controls somebody can actually reach |
| `schema` | Can a deployment read its own schema and add the columns it is missing — the one thing `node:sqlite` cannot answer for D1, which is whether a pragma comes back with rows |
| `editor-perf` | What one edit costs on a 761-node document — open time, selection, long tasks during a burst of style writes, layer-tree windowing. A probe: it prints the numbers and fails only on what would be a bug at any speed. `CRE8_PERF_SECTIONS` scales the fixture so the curve can be read rather than a single point |
| `forms` | Do published forms reach the submissions endpoint, and what does it refuse |
| `assets` | Do images survive publish and ZIP export — re-encoded, carrying their intrinsic size, offered at four widths, and eager where it matters |
| `bodyreset` | Does the published page start at the viewport edge |
| `borders` | Per-side border widths, canvas to published |
| `e2e` | Accounts, teams, roles, publishing |
| `security` | Does authorisation hold against a hostile client |
| `origin` | Can a published site reach the editor session (it must not) |
| `local` | Does the same build work with no backend at all |

Suites run in sequence, not in parallel: they each sign up, publish, and hit the
same D1 and R2, and racing them turns a real failure into something nobody can
reproduce.

### Why the block sweep matters

It is `fidelity` generalised from one template to the whole registry. Every bug
these caught so far was invisible in the editor and only wrong once published:

- a divider emitted as an unclosed `<div>`, nesting half the page inside itself
- a reset rule outranking node classes, repainting every primary button
- a border side with no width computing to `0` on the canvas and `3px` live
- the page root inheriting the editor's 12px chrome font instead of 16px
- a popover's own `display` beating the browser's rule for hiding a closed one,
  so the panel that should wait for a button was simply always on the page
- a slider transparent on the canvas and white in production, because the
  editor has Tailwind's preflight and a published page has nothing

None of those would survive the sweep now. That is the point: the library can
grow to a hundred blocks without the quality bar drifting, because drift fails
the build.
