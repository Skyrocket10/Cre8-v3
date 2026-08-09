/**
 * The repeater, in a browser.
 *
 * D2's gate, verbatim from `docs/DATA-LAYER.md`:
 *
 *   > A bound list renders identically on canvas and published, with no
 *   > script, and the stylesheet does not grow by a single rule as records are
 *   > added.
 *
 * All three halves are here, and each is measured rather than described. The
 * first by comparing computed styles per class across the two surfaces, the
 * way `blocks.mjs` and `fidelity.mjs` already do. The second by looking at the
 * file. The third by publishing twice — once with two records and once with
 * five — and comparing the two stylesheets byte for byte. That last one is the
 * claim that would kill the idea if it were false, so it is worth paying a
 * second publish to check it against a real published file rather than
 * against a generator called in isolation.
 *
 * There is no inspector for `repeat` yet — that is D5 — so the document is
 * seeded through the API, which broadcasts a resync to the open editor. That
 * is not a workaround: it is the same path a collaborator's whole-document
 * replacement takes, and it exercises the canvas the way a user eventually
 * will.
 *
 * One divergence between the surfaces is deliberate and checked as such: a
 * repeater over an empty collection draws its subtree once on the canvas, and
 * publishes nothing. A card you cannot see is a card you cannot lay out, and
 * an invented row in a file somebody serves would be a lie.
 */

import {
  APP,
  createReport,
  launch,
  openProject,
  publish,
  READY_TIMEOUT,
  signUp,
  toCanvasKeys,
  unbalanced,
} from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** Computed styles keyed by the generated class, which both surfaces share. */
const COLLECT = () => {
  const root = document.querySelector('.cre8-frame.cre8-editing') ?? document.body;
  const out = {};
  for (const el of root.querySelectorAll('[class*="c-"]')) {
    const cls = [...el.classList].find((c) => /^c-[a-z0-9]/.test(c));
    if (!cls || out[cls]) continue;
    const cs = getComputedStyle(el);
    out[cls] = [
      cs.display, cs.color, cs.backgroundColor, cs.flexDirection,
      cs.gap, cs.fontSize, cs.fontWeight, cs.paddingTop,
    ].join('|');
  }
  return out;
};

/** The text of every card title on whichever surface is asked. */
const TITLES = (selector) => {
  const root = document.querySelector(selector) ?? document.body;
  return [...root.querySelectorAll('h3')].map((el) => (el.textContent ?? '').trim());
};

const styleOf = (html) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

try {
  await signUp(page, 'Rita Peters', 'repeat');
  const id = await openProject(page, 'Blank');

  /** Same-origin, from the page, so the session cookie and CSRF header come free. */
  const call = (path, init = {}) =>
    page.evaluate(
      async ({ path, init }) => {
        const r = await fetch(path, {
          ...init,
          credentials: 'include',
          headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      },
      { path, init }
    );

  const addRecord = (slug, data, position, published = true) =>
    call(`/api/projects/${id}/records`, {
      method: 'POST',
      body: JSON.stringify({ collectionId: 'posts', slug, position, published, data }),
    });

  /* ------------------------------------------------------- 1. some content */

  const seeded = [
    await addRecord('orbit', { title: 'Orbital mechanics', blurb: 'Round and round' }, 0),
    await addRecord('reentry', { title: 'Coming back down', blurb: 'The hard part' }, 1),
    await addRecord('unfinished', { title: 'Not ready yet', blurb: 'A draft' }, 2, false),
  ];
  report.check(
    'three records go into the store',
    seeded.every((r) => r.status === 200),
    seeded.map((r) => r.status).join(' ')
  );

  /* ------------------------------------ 2. a repeater, seeded as a document */

  /*
   * Two repeaters: one over `posts`, which has rows, and one over `empty`,
   * which does not. The second is the only reason the divergence below can be
   * checked at all — an assertion about the empty case needs an empty case.
   */
  const wired = await page.evaluate(async ({ id }) => {
    const got = await fetch(`/api/projects/${id}`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    const { document: doc } = await got.json();
    const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
    const root = doc.nodes[home.rootNodeId];

    const node = (nodeId, type, name, extra) => ({
      id: nodeId,
      type,
      name,
      parentId: null,
      children: [],
      props: {},
      styles: {},
      meta: {},
      ...extra,
    });

    doc.collections = [
      {
        id: 'posts',
        name: 'Posts',
        slugField: 'title',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'blurb', label: 'Blurb', type: 'text' },
        ],
      },
      { id: 'empty', name: 'Nothing yet', fields: [{ key: 'title', label: 'Title', type: 'text' }] },
    ];

    Object.assign(doc.nodes, {
      rpt0feedaa: node('rpt0feedaa', 'stack', 'Post feed', {
        parentId: root.id,
        children: ['crd0feedbb'],
        repeat: { collection: 'posts', sort: { field: 'title', direction: 'asc' } },
        styles: {
          desktop: { display: 'flex', flexDirection: 'column', gap: '24px', padding: '48px' },
        },
      }),
      crd0feedbb: node('crd0feedbb', 'frame', 'Card', {
        parentId: 'rpt0feedaa',
        children: ['ttl0feedcc', 'blb0feeddd'],
        styles: {
          desktop: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '24px',
            backgroundColor: '#101828',
            borderRadius: '12px',
          },
        },
      }),
      ttl0feedcc: node('ttl0feedcc', 'heading', 'Title', {
        parentId: 'crd0feedbb',
        props: { text: 'A post title', level: 3 },
        bind: { text: 'title' },
        styles: { desktop: { fontSize: '22px', fontWeight: '600', color: '#f8fafc' } },
      }),
      blb0feeddd: node('blb0feeddd', 'paragraph', 'Blurb', {
        parentId: 'crd0feedbb',
        props: { text: 'What the post is about' },
        bind: { text: 'blurb' },
        styles: { desktop: { fontSize: '15px', color: '#94a3b8' } },
      }),
      rpt0nonexx: node('rpt0nonexx', 'stack', 'Empty feed', {
        parentId: root.id,
        children: ['ttl0noneyy'],
        repeat: { collection: 'empty' },
        styles: { desktop: { display: 'flex', flexDirection: 'column', padding: '16px' } },
      }),
      ttl0noneyy: node('ttl0noneyy', 'paragraph', 'Placeholder', {
        parentId: 'rpt0nonexx',
        props: { text: 'Nothing here yet' },
        bind: { text: 'title' },
        styles: { desktop: { fontSize: '14px', color: '#64748b' } },
      }),
    });
    root.children.push('rpt0feedaa', 'rpt0nonexx');

    // The same route the editor's own autosave uses. For a project that
    // already exists it goes through the room, which broadcasts a resync — so
    // the open canvas picks the repeater up without a reload, exactly as it
    // would if a collaborator had made the change.
    const saved = await fetch(`/api/projects`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    return saved.status;
  }, { id });

  // Everything below measures a page with a repeater on it. If the seeding
  // failed there is no such page, and carrying on would report a screenful of
  // checks passing over an empty document — which is worse than one failure,
  // because it reads as proof.
  if (!report.check('the document with the repeater is accepted', wired === 200, `HTTP ${wired}`)) {
    throw new Error(`could not seed the repeater document (HTTP ${wired})`);
  }

  // The room broadcasts a resync, so the canvas redraws on its own. Waiting
  // for the *content* rather than for a duration: the records are fetched
  // after the document lands, and a fixed pause would race that.
  await page
    .waitForFunction(() => document.body.textContent?.includes('Orbital mechanics') ?? false, null, {
      timeout: READY_TIMEOUT,
    })
    .catch(() => {});

  /* ----------------------------------------------------- 3. what the canvas draws */

  const canvasTitles = await page.evaluate(TITLES, '.cre8-frame.cre8-editing');
  report.check(
    'the canvas draws one card per published record, in sorted order',
    canvasTitles.join(' › ') === 'Coming back down › Orbital mechanics',
    canvasTitles.join(' › ') || 'nothing drawn'
  );
  report.check(
    'and the draft is not among them',
    !canvasTitles.includes('Not ready yet'),
    canvasTitles.includes('Not ready yet') ? 'a draft is on the canvas' : 'left out'
  );

  /*
   * Every row is the same node, so exactly one of them may answer to its id.
   * Without that the registry holds two elements under one key, the selection
   * outline is measured from whichever was written last, and a double-click to
   * edit text opens a caret in every card at once.
   */
  const attachments = await page.evaluate(
    () => document.querySelectorAll('[data-cre8-id="ttl0feedcc"]').length
  );
  report.check(
    'only the first row is the one the editor is attached to',
    attachments === 1,
    `${attachments} elements answer to the title node`
  );

  const templateRow = await page.evaluate(
    () => document.body.textContent?.includes('Nothing here yet') ?? false
  );
  report.check(
    'a repeater over an empty collection still draws something to design',
    templateRow,
    templateRow ? 'template row on the canvas' : 'an empty box'
  );

  const canvas = await page.evaluate(COLLECT);

  /* --------------------------------------------------- 4. what gets published */

  await publish(page);
  const html = await (await fetch(`${APP}/s/${id}/`)).text();

  report.check('the published markup is balanced', unbalanced(html).length === 0);
  report.check(
    'the rows are elements in the file, not a script that will fetch them',
    !/<script/i.test(html),
    /<script/i.test(html) ? 'a script was shipped' : 'HTML and CSS only'
  );
  report.check(
    'and the records themselves are nowhere in it',
    !html.includes('collectionId') && !html.includes('"published"'),
    'no record JSON in the file'
  );
  report.check(
    'both records are in the published markup',
    html.includes('Orbital mechanics') && html.includes('Coming back down'),
    'both titles present'
  );
  report.check(
    'the draft is not, and neither is the design-time placeholder it replaced',
    !html.includes('Not ready yet') && !html.includes('A post title'),
    html.includes('A post title') ? 'placeholder copy shipped' : 'records only'
  );
  report.check(
    'and the empty collection publishes nothing rather than its template row',
    !html.includes('Nothing here yet'),
    html.includes('Nothing here yet') ? 'an invented row was published' : 'left out'
  );

  const site = await ctx.newPage();
  await site.setViewportSize({ width: 1440, height: 1000 });
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(500);

  const siteTitles = await site.evaluate(TITLES, 'body');
  report.check(
    'the published page draws the same rows in the same order',
    siteTitles.length === 2 && siteTitles.join(' › ') === canvasTitles.join(' › '),
    `${siteTitles.join(' › ') || '(none)'} vs ${canvasTitles.join(' › ') || '(none)'}`
  );

  /*
   * The floor is there so this cannot pass on an empty intersection. The four
   * nodes of the card are the ones that matter — a repeated subtree is styled
   * by classes it shares with its template, and if the two surfaces disagreed
   * about any of them the whole "one renderer" claim would be false inside a
   * repeater even though it holds everywhere else.
   */
  const published = await site.evaluate(COLLECT);
  const matched = toCanvasKeys(published, canvas);
  const shared = Object.keys(matched);
  const diffs = shared.filter((c) => canvas[c] !== matched[c]);
  report.check(
    'and every shared class computes to the same styles on both surfaces',
    shared.length >= 4 && diffs.length === 0,
    `${shared.length} shared, ${diffs.length} differ` +
      (diffs.length
        ? ` — ${diffs[0]}:\n      canvas    ${canvas[diffs[0]]}\n      published ${matched[diffs[0]]}`
        : '')
  );

  /* ------------------------------------------ 5. the claim about the stylesheet */

  /*
   * The half of the gate that would kill the idea if it were false, checked
   * end to end: three more records, published again, and the stylesheet has to
   * be the same bytes. Every copy of a repeated subtree carries the classes
   * the node already had, because it *is* the same node — so the rules cannot
   * multiply with the rows, and if they ever start to, a collection of any
   * size becomes a stylesheet of that size.
   */
  const before = styleOf(html);
  const rowsBefore = (html.match(/<h3/g) ?? []).length;

  await addRecord('tether', { title: 'Space tethers', blurb: 'Long ones' }, 3);
  await addRecord('shield', { title: 'Heat shields', blurb: 'Hot ones' }, 4);
  await addRecord('dock', { title: 'Docking', blurb: 'Slow ones' }, 5);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await page.waitForFunction(
    () => document.body.textContent?.includes('Space tethers') ?? false,
    null,
    { timeout: READY_TIMEOUT }
  );
  await publish(page);

  const grown = await (await fetch(`${APP}/s/${id}/`)).text();
  const after = styleOf(grown);
  const rowsAfter = (grown.match(/<h3/g) ?? []).length;

  report.check(
    'adding three records adds three rows to the file',
    rowsBefore === 2 && rowsAfter === 5,
    `${rowsBefore} → ${rowsAfter} rows`
  );
  report.check(
    'and not one rule to the stylesheet',
    before.length > 0 && before === after,
    before === after ? `${before.length} bytes either way` : `${before.length} → ${after.length} bytes`
  );

  await site.close();
} catch (error) {
  report.check('the suite ran to the end', false, String(error?.message ?? error));
} finally {
  await browser.close();
}

report.finish();
