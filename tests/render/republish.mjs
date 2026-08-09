/**
 * D6's gate, both halves, against a running Worker:
 *
 *   > Editing a record updates the live site with no manual publish, and
 *   > republishing an unchanged collection writes nothing.
 *
 * Neither half can be checked anywhere else. The first is a claim about a
 * Durable Object alarm firing on its own — nothing in a static suite can wait
 * for that. The second is a claim about what reached R2, and the only honest
 * way to ask is to publish, publish again, and look at what the second one
 * did.
 *
 * ## The traps this is written around
 *
 * **"Writes nothing" is trivially satisfiable by writing nothing at all**, so
 * every no-op check is paired with a read of the live site. A publish that
 * quietly stopped working would otherwise pass the more interesting-looking
 * half of the gate.
 *
 * **Deletion is the half that hides.** A record removed from a collection has
 * a page on the internet, and nothing in the editor will ever mention it
 * again. So the suite deletes one and asks the site for it, rather than
 * asking the API what it thinks it did.
 *
 * **Two things must *not* republish**, and both are checked by waiting out the
 * window and finding nothing changed: a design edit (which needs a person to
 * press Publish, because a half-finished layout is not content), and any edit
 * at all on a project nobody has ever published (which has no site, and a
 * record write is not consent to put one on the internet).
 */

import {
  APP,
  createReport,
  getDocument,
  launch,
  node,
  openProject,
  publish,
  PUBLISH_TIMEOUT,
  READY_TIMEOUT,
  saveDocument,
  signUp,
} from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/**
 * How long to give a republish that nobody asked for.
 *
 * The room waits five seconds for the edits to stop, then renders and stores.
 * This is that plus enough room for a `wrangler dev` writing D1 and R2 to one
 * thread on its fifteenth suite of the run.
 */
const REPUBLISH_TIMEOUT = Number(process.env.CRE8_REPUBLISH_TIMEOUT ?? 60_000);

/** Long enough that a republish would certainly have happened, if one were coming. */
const PAST_THE_WINDOW = 20_000;

/** Poll until `check` is happy, or give up and return what it last saw. */
async function until(check, timeout = REPUBLISH_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await check().catch((error) => ({ ok: false, detail: String(error) }));
    if (last?.ok || Date.now() > deadline) return { ...last, waited: true };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** A published file, read the way a visitor would — no cache buster. */
async function site(id, path = '') {
  const response = await fetch(`${APP}/s/${id}/${path}`);
  return { status: response.status, html: await response.text() };
}

try {
  await signUp(page, 'Nell Okafor', 'republish');
  const id = await openProject(page, 'Blank');

  /** Same-origin from the page, so the session cookie and CSRF header come free. */
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

  const addRecord = (project, slug, title, position) =>
    call(`/api/projects/${project}/records`, {
      method: 'POST',
      body: JSON.stringify({
        collectionId: 'posts',
        slug,
        position,
        published: true,
        data: { title, body: `The body of ${title}` },
      }),
    });

  /** Publish through the API rather than the button, because this suite reads the counts. */
  const publishNow = (project = id) =>
    call(`/api/projects/${project}/publish`, { method: 'POST' });

  /* ----------------------------------------------------- 1. a blog to watch */

  const seeded = [
    await addRecord(id, 'first-light', 'First light', 0),
    await addRecord(id, 'second-wind', 'Second wind', 1),
    await addRecord(id, 'third-rail', 'Third rail', 2),
  ];
  report.check(
    'three records go into the store',
    seeded.every((r) => r.status === 200),
    seeded.map((r) => r.status).join(' ')
  );

  /*
   * An index and a detail page over the same collection — the shape D4
   * publishes as one file plus one per record. Both are needed here: the index
   * is what an edit changes, and the detail pages are what a deletion has to
   * take away.
   */
  const doc = await getDocument(page, id);
  {
    const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
    const root = doc.nodes[home.rootNodeId];

    doc.collections = [
      {
        id: 'posts',
        name: 'Posts',
        slugField: 'title',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'body', label: 'Body', type: 'text' },
        ],
      },
    ];

    Object.assign(doc.nodes, {
      rpt0listaa: node('rpt0listaa', 'stack', 'Post list', {
        parentId: root.id,
        children: ['lnk0listbb'],
        repeat: { collection: 'posts' },
        styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '40px' } },
      }),
      lnk0listbb: node('lnk0listbb', 'link', 'Card', {
        parentId: 'rpt0listaa',
        props: { text: 'A post', href: 'page:pg-post' },
        bind: { text: 'title' },
        styles: { desktop: { fontSize: '20px', color: '#f8fafc' } },
      }),
      // The detail page's tree.
      det0pageaa: node('det0pageaa', 'frame', 'Post body', {
        children: ['det0pagebb'],
        styles: { desktop: { display: 'flex', flexDirection: 'column', padding: '40px' } },
      }),
      det0pagebb: node('det0pagebb', 'heading', 'Post title', {
        parentId: 'det0pageaa',
        props: { text: 'A title', level: 1 },
        bind: { text: 'title' },
        styles: { desktop: { fontSize: '32px', color: '#f8fafc' } },
      }),
    });
    root.children.push('rpt0listaa');

    doc.pages.push({
      id: 'pg-post',
      name: 'Post',
      slug: 'blog',
      rootNodeId: 'det0pageaa',
      order: 1,
      meta: {},
      dynamic: { collection: 'posts' },
    });
  }
  const wired = await saveDocument(page, doc);
  if (!report.check('the blog document is accepted', wired === 200, `HTTP ${wired}`)) {
    throw new Error(`could not seed the blog (HTTP ${wired})`);
  }

  /* -------------------------------------------- 2. the first publish writes */

  const first = await publishNow();
  report.check(
    'the first publish writes the whole site and finds nothing already there',
    first.status === 200 && first.body.written > 4 && first.body.unchanged === 0,
    `written=${first.body.written} unchanged=${first.body.unchanged} removed=${first.body.removed}`
  );

  const home = await site(id);
  report.check(
    'and the site says what the records say',
    home.status === 200 && ['First light', 'Second wind', 'Third rail'].every((t) => home.html.includes(t)),
    home.status === 200 ? 'all three listed' : `HTTP ${home.status}`
  );
  report.check(
    'with a page of its own for each record',
    (await site(id, 'blog/first-light/')).status === 200 &&
      (await site(id, 'blog/third-rail/')).status === 200,
    'both reachable'
  );

  /* ------------------------------------ 3. publishing again writes nothing */

  /* Half the gate, and the half that is trivially satisfiable by breaking
     publishing altogether — so the site is read again straight afterwards. */
  const again = await publishNow();
  report.check(
    'republishing an unchanged collection writes nothing',
    again.status === 200 && again.body.written === 0 && again.body.removed === 0,
    `written=${again.body.written} removed=${again.body.removed} unchanged=${again.body.unchanged}`
  );
  report.check(
    'and it left the same number of files behind that it found',
    again.body.unchanged === first.body.written,
    `${again.body.unchanged} unchanged against ${first.body.written} written`
  );
  const stillThere = await site(id);
  report.check(
    'and the site is still there, which is the other way to write nothing',
    stillThere.status === 200 && stillThere.html.includes('Second wind'),
    stillThere.status === 200 ? 'intact' : `HTTP ${stillThere.status}`
  );

  /*
   * A quiet interval before the interesting part, and it is not padding.
   *
   * Seeding this project wrote three records, and each of those armed the
   * room's timer. Those alarms are harmless — they fire, find the project
   * unpublished or already current, and write nothing — but one of them
   * landing a few seconds *after* the edit below would republish the edit and
   * make the next check pass without the edit's own trigger existing at all.
   *
   * That is not hypothetical: it is what happened the first time this suite
   * was used to falsify the trigger, which passed with the trigger removed.
   * So the window is waited out and the site is confirmed settled, and
   * everything after this point is attributable to what caused it.
   */
  await new Promise((resolve) => setTimeout(resolve, PAST_THE_WINDOW));
  const settled = await publishNow();
  report.check(
    'and nothing republished on its own while nothing was happening',
    settled.body.written === 0 && settled.body.removed === 0,
    `written=${settled.body.written} removed=${settled.body.removed}`
  );

  /* ------------------------------- 4. editing a record, with no publish at all */

  const listed = await call(`/api/projects/${id}/records?collection=posts`);
  const second = listed.body.records?.find((r) => r.slug === 'second-wind');
  report.check('the record to edit is findable', Boolean(second), second?.id ?? 'not found');

  await call(`/api/projects/${id}/records/${second.id}`, {
    method: 'PUT',
    body: JSON.stringify({ data: { title: 'Second wind, rewritten', body: 'Changed' } }),
  });

  const edited = await until(async () => {
    const { html, status } = await site(id);
    return { ok: status === 200 && html.includes('Second wind, rewritten'), detail: `HTTP ${status}` };
  });
  report.check(
    'editing a record updates the live site with no manual publish',
    edited.ok,
    edited.ok ? 'the index followed within the window' : `never appeared — ${edited.detail}`
  );

  const detail = await until(async () => {
    const { html, status } = await site(id, 'blog/second-wind/');
    return { ok: status === 200 && html.includes('Second wind, rewritten'), detail: `HTTP ${status}` };
  });
  report.check(
    'and so does the record’s own page',
    detail.ok,
    detail.ok ? 'the detail page followed too' : `never appeared — ${detail.detail}`
  );

  /*
   * The republish did the writing, not the poll's good luck. If the alarm had
   * done nothing and the site were somehow current by other means, a publish
   * now would have work to do.
   */
  const afterEdit = await publishNow();
  report.check(
    'and by the time anyone presses Publish, there is nothing left to write',
    afterEdit.body.written === 0 && afterEdit.body.removed === 0,
    `written=${afterEdit.body.written} removed=${afterEdit.body.removed}`
  );

  /* ------------------------------------- 5. deleting one takes its page away */

  const third = listed.body.records?.find((r) => r.slug === 'third-rail');
  await call(`/api/projects/${id}/records/${third.id}`, { method: 'DELETE' });

  const gone = await until(async () => {
    const { status } = await site(id, 'blog/third-rail/');
    return { ok: status === 404, detail: `HTTP ${status}` };
  });
  report.check(
    'deleting a record takes its page off the site',
    gone.ok,
    gone.ok ? '404, as it should be' : `still being served — ${gone.detail}`
  );

  const withoutThird = await site(id);
  report.check(
    'and takes it out of the index it was listed in',
    !withoutThird.html.includes('Third rail'),
    withoutThird.html.includes('Third rail') ? 'still listed' : 'delisted'
  );

  /* ------------------------------------------- 6. and adding one puts it up */

  await addRecord(id, 'fourth-wall', 'Fourth wall', 3);
  const added = await until(async () => {
    const { status, html } = await site(id, 'blog/fourth-wall/');
    return { ok: status === 200 && html.includes('Fourth wall'), detail: `HTTP ${status}` };
  });
  report.check(
    'adding a record puts a new page on the site, unasked',
    added.ok,
    added.ok ? 'published on its own' : `never appeared — ${added.detail}`
  );

  /* --------------------------------------- 7. what must *not* republish */

  /*
   * Two negatives, waited out together because each costs the whole window.
   *
   * A design change is not content: a half-moved section should not reach the
   * internet because somebody let go of the mouse. And a project nobody has
   * published has no site at all — a record write must not create one, which
   * is the difference between a feature and a surprise.
   */
  const other = await page.evaluate(async () => {
    const teams = await fetch('/api/teams', {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    }).then((r) => r.json());
    const id = `proj-quiet-${Date.now()}`;
    const status = await fetch('/api/projects', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        name: 'Never published',
        teamId: teams.teams?.[0]?.id,
        pages: [{ id: 'p1', name: 'Home', slug: '', rootNodeId: 'r1', order: 0, isHome: true, meta: {} }],
        nodes: {},
        collections: [],
      }),
    }).then((r) => r.status);
    return { id, status };
  });
  report.check('a second project exists and has never been published', other.status === 200, `HTTP ${other.status}`);

  await addRecord(other.id, 'quiet', 'Quiet one', 0);

  // A design edit on the published project: change the heading the detail
  // pages are built from. Content is untouched.
  const design = await getDocument(page, id);
  design.nodes.det0pagebb.styles.desktop.fontSize = '48px';
  const designSaved = await saveDocument(page, design);
  report.check('a design change is saved', designSaved === 200, `HTTP ${designSaved}`);

  await new Promise((resolve) => setTimeout(resolve, PAST_THE_WINDOW));

  const quiet = await site(other.id);
  report.check(
    'a record on a project nobody published does not put one on the internet',
    quiet.status === 404,
    quiet.status === 404 ? 'nothing served' : `HTTP ${quiet.status} — a site appeared`
  );

  const unchangedByDesign = await site(id, 'blog/first-light/');
  report.check(
    'and a design change waits for a person to press Publish',
    !unchangedByDesign.html.includes('48px'),
    unchangedByDesign.html.includes('48px') ? 'the layout went live on its own' : 'still the published design'
  );

  /* ------------------------------------------ 8. and then it does publish */

  /*
   * Six files by now: the index, three record pages (three seeded, one
   * deleted, one added), the sitemap and robots. The design change was to the
   * *detail* template's heading, so it belongs to the three record pages and
   * to nothing else — which is the same diff arithmetic as a content edit,
   * arrived at from the other direction.
   */
  const withDesign = await publishNow();
  report.check(
    'pressing Publish ships the design change, to the three pages it is on and no others',
    withDesign.body.written === 3 && withDesign.body.unchanged === 3,
    `written=${withDesign.body.written} unchanged=${withDesign.body.unchanged}`
  );
  const shipped = await site(id, 'blog/first-light/');
  report.check(
    'and the live page has it now',
    shipped.html.includes('48px'),
    shipped.html.includes('48px') ? 'shipped' : 'still missing'
  );

  /* ------------------------------------------------ 9. and the dialog says so */

  /*
   * The counts above are read from the API. What a person sees is the dialog,
   * and a publish that reports nothing at all reads as a failure — so the
   * no-op has to say what it is out loud.
   */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: PUBLISH_TIMEOUT });
  const said = (await page.locator('text=/Already up to date/').count()) > 0;
  report.check(
    'and a publish with nothing to do says so rather than looking broken',
    said,
    said ? 'the dialog explains itself' : 'no explanation offered'
  );
} catch (error) {
  report.check('the suite ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
}

report.finish();
