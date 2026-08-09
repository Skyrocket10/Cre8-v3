/**
 * Publish history, and putting a design back.
 *
 * The claim being checked is narrower than "versioning" usually means, and the
 * narrowness is the design rather than a shortfall:
 *
 *   > A version is a design somebody published. Restoring one re-publishes
 *   > that design against today's records — the site's content does not move.
 *
 * So the sharpest check here is a negative. A project with a blog gets a
 * design change, then a new post, then a restore of the earlier design — and
 * the post has to still be there afterwards. Anything that rolled the content
 * back with the layout would be a data-loss bug wearing the clothes of a
 * feature, and it is the one mistake this whole split exists to prevent.
 *
 * The rest is about the log being honest: an automatic republish appears in it
 * (the site did change) and cannot be restored (the design did not), a restore
 * is itself a publish and appears as one, and the canvas moves with the site
 * because a restore that changed the files and left the editor showing the
 * replaced design would be undone by the next ordinary save.
 */

import {
  APP,
  createReport,
  getDocument,
  launch,
  node,
  openProject,
  READY_TIMEOUT,
  saveDocument,
  signUp,
} from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** Long enough that a republish would certainly have happened, if one were coming. */
const PAST_THE_WINDOW = 20_000;

async function until(check, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await check().catch((error) => ({ ok: false, detail: String(error) }));
    if (last?.ok || Date.now() > deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const site = async (id, path = '') => {
  const response = await fetch(`${APP}/s/${id}/${path}`);
  return { status: response.status, html: await response.text() };
};

try {
  await signUp(page, 'Ida Brandt', 'history');
  const id = await openProject(page, 'Blank');

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

  const publishNow = () => call(`/api/projects/${id}/publish`, { method: 'POST' });
  const historyOf = async () => (await call(`/api/projects/${id}/deployments`)).body.deployments ?? [];

  /* ------------------------------------------------- 1. a site with content */

  await call(`/api/projects/${id}/records`, {
    method: 'POST',
    body: JSON.stringify({
      collectionId: 'posts',
      slug: 'first-post',
      position: 0,
      published: true,
      data: { title: 'The first post' },
    }),
  });

  const doc = await getDocument(page, id);
  {
    const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
    const root = doc.nodes[home.rootNodeId];
    doc.collections = [
      { id: 'posts', name: 'Posts', slugField: 'title', fields: [{ key: 'title', label: 'Title', type: 'text' }] },
    ];
    Object.assign(doc.nodes, {
      hdr0verone: node('hdr0verone', 'heading', 'Masthead', {
        parentId: root.id,
        props: { text: 'Version one', level: 1 },
        styles: { desktop: { fontSize: '40px', color: '#f8fafc' } },
      }),
      rpt0verlst: node('rpt0verlst', 'stack', 'Posts', {
        parentId: root.id,
        children: ['itm0verlst'],
        repeat: { collection: 'posts' },
        styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px' } },
      }),
      itm0verlst: node('itm0verlst', 'paragraph', 'Post', {
        parentId: 'rpt0verlst',
        props: { text: 'A post' },
        bind: { text: 'title' },
        styles: { desktop: { fontSize: '16px', color: '#cbd5f5' } },
      }),
    });
    root.children.push('hdr0verone', 'rpt0verlst');
  }
  const seeded = await saveDocument(page, doc);
  if (!report.check('the first design is accepted', seeded === 200, `HTTP ${seeded}`)) {
    throw new Error(`could not seed the document (HTTP ${seeded})`);
  }

  const first = await publishNow();
  report.check('and it publishes', first.status === 200, `HTTP ${first.status}`);

  /* ---------------------------------------------------- 2. the log exists */

  const afterFirst = await historyOf();
  report.check(
    'a publish appears in the history, credited to the person who made it',
    afterFirst.length === 1 && afterFirst[0]?.publishedBy?.name === 'Ida Brandt',
    `${afterFirst.length} entries, by ${afterFirst[0]?.publishedBy?.name ?? 'nobody'}`
  );
  report.check(
    'and says what it wrote',
    (afterFirst[0]?.changed?.written ?? 0) > 0,
    JSON.stringify(afterFirst[0]?.changed ?? null)
  );
  report.check(
    'and carries the design, so it can be put back',
    afterFirst[0]?.restorable === true,
    afterFirst[0]?.restorable ? 'restorable' : 'nothing stored'
  );

  /* ------------------------------------------- 3. a second, different design */

  const v2 = await getDocument(page, id);
  v2.nodes.hdr0verone.props.text = 'Version two';
  await saveDocument(page, v2);
  const second = await publishNow();
  report.check(
    'a design change publishes as its own version',
    second.status === 200 && (await historyOf()).length === 2,
    `${(await historyOf()).length} entries`
  );

  const liveV2 = await site(id);
  report.check(
    'and the site says the new one',
    liveV2.html.includes('Version two') && !liveV2.html.includes('Version one'),
    liveV2.html.includes('Version two') ? 'version two is live' : 'the old design is still up'
  );

  /* ----------------------------- 4. content moves on its own, and is logged */

  await call(`/api/projects/${id}/records`, {
    method: 'POST',
    body: JSON.stringify({
      collectionId: 'posts',
      slug: 'written-later',
      position: 1,
      published: true,
      data: { title: 'Written after version two' },
    }),
  });

  const followed = await until(async () => {
    const { html } = await site(id);
    return { ok: html.includes('Written after version two') };
  });
  report.check(
    'a new post reaches the site with no publish',
    followed.ok,
    followed.ok ? 'the site followed' : 'never appeared'
  );

  const withAuto = await historyOf();
  const automatic = withAuto.find((entry) => entry.publishedBy === null);
  report.check(
    'the automatic republish is in the history too — the site did change',
    Boolean(automatic),
    `${withAuto.length} entries, ${withAuto.filter((e) => !e.publishedBy).length} automatic`
  );
  report.check(
    'but it is not a version, because the design did not move',
    automatic?.restorable === false,
    automatic?.restorable ? 'offered as restorable' : 'logged, not restorable'
  );

  const refused = await call(`/api/projects/${id}/deployments/${automatic?.id}/restore`, {
    method: 'POST',
  });
  report.check(
    'and asking to restore it is refused with a sentence, not a stack trace',
    refused.status === 400 && /nothing to put back/i.test(refused.body.error ?? ''),
    `HTTP ${refused.status} — ${refused.body.error ?? refused.body.detail ?? 'no message'}`
  );

  /* -------------------------------------------- 5. put the first design back */

  const versionOne = [...withAuto].reverse().find((entry) => entry.restorable);
  const restored = await call(`/api/projects/${id}/deployments/${versionOne?.id}/restore`, {
    method: 'POST',
  });
  report.check(
    'restoring an earlier design succeeds',
    restored.status === 200,
    `HTTP ${restored.status} — ${restored.body.error ?? 'ok'}`
  );
  report.check(
    'and writes only the files the design actually changed',
    restored.body.written > 0 && restored.body.written <= 2,
    `written=${restored.body.written} unchanged=${restored.body.unchanged}`
  );

  const back = await site(id);
  report.check(
    'the live site is serving the old design again',
    back.html.includes('Version one') && !back.html.includes('Version two'),
    back.html.includes('Version one') ? 'version one is live' : 'the restore did not reach the site'
  );

  /*
   * The check this suite exists for. Restoring a design from before the post
   * was written must not take the post down — content is live, and rolling a
   * layout back is not a reason to unpublish a week of writing.
   */
  const survivors = ['The first post', 'Written after version two'].filter((post) =>
    back.html.includes(post)
  );
  report.check(
    'and today’s content is still on it — a restore moves the design, not the posts',
    survivors.length === 2,
    // Counted from the same expression the condition uses. The first version
    // of this reported on half of an `&&`, so a failing check could print
    // "both posts survived" — which is the one thing a failure must never say.
    survivors.length === 2 ? 'both posts survived' : `only ${survivors.length}: ${survivors.join(', ') || 'none'}`
  );

  /* ------------------------------------------ 6. and the canvas moved with it */

  /*
   * A restore writes through the room, so an open editor resyncs. Without
   * that the files would say one thing and the canvas another, and the next
   * ordinary save would quietly undo the restore.
   */
  const canvas = await page
    .waitForFunction(
      () => document.querySelector('.cre8-frame.cre8-editing')?.textContent?.includes('Version one') ?? false,
      null,
      { timeout: READY_TIMEOUT }
    )
    .then(() => true)
    .catch(() => false);
  report.check(
    'the canvas is showing the restored design without a reload',
    canvas,
    canvas ? 'resynced' : 'the editor is still on the design that was replaced'
  );

  /* ------------------------------------------- 7. the restore is itself a publish */

  const afterRestore = await historyOf();
  report.check(
    'the restore appears in the history as a publish somebody made',
    afterRestore.length === withAuto.length + 1 &&
      afterRestore[0]?.publishedBy?.name === 'Ida Brandt' &&
      afterRestore[0]?.restorable === true,
    `${afterRestore.length} entries, newest by ${afterRestore[0]?.publishedBy?.name ?? 'nobody'}`
  );

  /*
   * Which means changing your mind is the same operation again, rather than a
   * separate one — the entry that was live a minute ago is still there.
   */
  // The newest *restorable* entry as of before the restore — `withAuto[0]` is
  // the automatic republish, which is exactly the thing that is not a version.
  const versionTwo = withAuto.find((entry) => entry.restorable) ?? null;
  const rolledForward = versionTwo
    ? await call(`/api/projects/${id}/deployments/${versionTwo.id}/restore`, { method: 'POST' })
    : { status: 0, body: {} };
  const forward = await site(id);
  report.check(
    'and going back the other way is the same operation',
    rolledForward.status === 200 && forward.html.includes('Version two'),
    rolledForward.status === 200
      ? forward.html.includes('Version two')
        ? 'version two is live again'
        : 'restored but not serving'
      : `HTTP ${rolledForward.status}`
  );

  /* --------------------------------------- 8. nothing republishes on its own */

  await new Promise((resolve) => setTimeout(resolve, PAST_THE_WINDOW));
  const settled = await publishNow();
  report.check(
    'and nothing kept republishing after the restores settled',
    settled.body.written === 0 && settled.body.removed === 0,
    `written=${settled.body.written} removed=${settled.body.removed}`
  );

  /* ------------------------------------------------- 9. and a person can see it */

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.locator('header button[aria-label="Publish history"]').click();
  await page.waitForSelector('text=Publish history', { timeout: 15_000 });
  await page.waitForTimeout(1200);

  const dialog = page.locator('[role="dialog"][aria-label="Publish history"]');
  // `span:text-is` rather than `text=live`, which also matches "Records are
  // live" in the caveat at the bottom and made this count two.
  const liveBadges = await dialog.locator('span:text-is("live")').count();
  report.check(
    'the dialog lists the publishes, and marks exactly one of them live',
    liveBadges === 1 && (await dialog.getByText('Ida Brandt').count()) >= 2,
    `${liveBadges} live badge(s), ${await dialog.getByText('Ida Brandt').count()} by name`
  );
  report.check(
    'and names the automatic ones as what they are',
    (await dialog.locator('text=Followed a content change').count()) >= 1,
    'the content-driven republish is labelled'
  );
  report.check(
    'and warns that content does not come back with the design',
    (await dialog.locator('text=/today.s content stays/i').count()) === 1,
    'the caveat is on screen before anybody clicks'
  );
  report.check(
    'and asks before replacing the live site',
    await (async () => {
      await dialog.locator('button:has-text("Restore")').first().click();
      await page.waitForTimeout(300);
      return (await dialog.locator('text=Replace the live site with this design?').count()) === 1;
    })(),
    'one click arms it, a second does it'
  );
} catch (error) {
  report.check('the suite ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
}

report.finish();
