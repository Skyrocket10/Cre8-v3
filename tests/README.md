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
- every node is named for the layer tree

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
| `behaviour` | Do switches, tabs, filters and steppers work — with the script, without it, and identically on both surfaces |
| `forms` | Do published forms reach the submissions endpoint, and what does it refuse |
| `assets` | Do images survive publish and ZIP export |
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
