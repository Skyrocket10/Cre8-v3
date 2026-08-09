/**
 * D4's gate, in a browser:
 *
 *   > A blog of thirty posts publishes thirty files plus a paginated index,
 *   > every one reachable and every one in the sitemap.
 *
 * The arithmetic — which files, which slice, which relative link — is checked
 * against generated output in `tests/static/run.mjs`, which is faster and
 * finds off-by-ones better than a browser can. Two things are left that only a
 * browser can answer, and they are the words "publishes" and "reachable".
 *
 * *Publishes*, because a path that a planner is happy with still has to be a
 * key R2 accepts and the site Worker resolves. `/blog/hello/` is served from
 * `blog/hello/index.html` after a redirect that has never had to cope with two
 * levels before.
 *
 * *Reachable*, and this is the one worth paying a browser for: it is checked
 * by **walking the site**. Start at the home page, follow every internal link,
 * and keep going until nothing new turns up. What that crawl finds is compared
 * with what the sitemap claims and with what was actually written. A link that
 * resolves one directory short is invisible to every check that reads the
 * markup and obvious to one that clicks it.
 */

import {
  APP,
  createReport,
  getDocument,
  launch,
  node,
  openProject,
  publish,
  READY_TIMEOUT,
  saveDocument,
  signUp,
} from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const POSTS = 30;
const PER_PAGE = 10;

try {
  await signUp(page, 'Ruth Palmer', 'routes');
  const id = await openProject(page, 'Blank');
  const ROOT = `${APP}/s/${id}/`;

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

  /* ------------------------------------------------------------ 1. content */

  const made = [];
  for (let i = 1; i <= POSTS; i++) {
    made.push(
      await call(`/api/projects/${id}/records`, {
        method: 'POST',
        body: JSON.stringify({
          collectionId: 'posts',
          slug: `post-${i}`,
          position: i,
          data: { title: `Post ${i}`, blurb: `The ${i}th thing we wrote.` },
        }),
      })
    );
  }
  report.check(
    `${POSTS} posts go into the store`,
    made.every((r) => r.status === 200),
    `${made.filter((r) => r.status === 200).length}/${POSTS} created`
  );

  /* --------------------------------------------- 2. an index and a detail page */

  const doc = await getDocument(page, id);
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];

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
  ];

  Object.assign(doc.nodes, {
    /* The index: ten at a time, each card linking to its own post. */
    fed0routea: node('fed0routea', 'stack', 'Feed', {
      parentId: root.id,
      children: ['crd0routeb'],
      repeat: { collection: 'posts', paginate: PER_PAGE },
      styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '32px' } },
    }),
    crd0routeb: node('crd0routeb', 'link', 'Card', {
      parentId: 'fed0routea',
      props: { text: 'A post', href: 'page:pg-post' },
      bind: { text: 'title' },
      styles: { desktop: { fontSize: '18px', color: '#2563eb' } },
    }),

    /* The pager, which is the only way a person reaches page two. */
    pgr0routec: node('pgr0routec', 'stack', 'Pager', {
      parentId: root.id,
      children: ['nxt0routed', 'prv0routee'],
      styles: { desktop: { display: 'flex', gap: '16px', padding: '0 32px 48px' } },
    }),
    nxt0routed: node('nxt0routed', 'link', 'Older', {
      parentId: 'pgr0routec',
      props: { text: 'Older posts', href: 'series:next' },
    }),
    prv0routee: node('prv0routee', 'link', 'Newer', {
      parentId: 'pgr0routec',
      props: { text: 'Newer posts', href: 'series:prev' },
    }),

    /* The detail page: one file per record, sharing the index's directory. */
    pst0routef: node('pst0routef', 'page', 'Post', {
      children: ['pth0routeg', 'bck0routeh'],
      styles: { desktop: { padding: '48px' } },
    }),
    pth0routeg: node('pth0routeg', 'heading', 'Title', {
      parentId: 'pst0routef',
      props: { text: 'A post title', level: 1 },
      bind: { text: 'title' },
    }),
    bck0routeh: node('bck0routeh', 'link', 'Back', {
      parentId: 'pst0routef',
      props: { text: 'All posts', href: `page:${home.id}` },
    }),
  });
  root.children.push('fed0routea', 'pgr0routec');
  doc.pages.push({
    id: 'pg-post',
    name: 'Post',
    slug: 'blog',
    rootNodeId: 'pst0routef',
    order: 1,
    meta: {},
    dynamic: { collection: 'posts' },
  });

  const seeded = await saveDocument(page, doc);
  if (!report.check('the blog document is accepted', seeded === 200, `HTTP ${seeded}`)) {
    throw new Error(`could not seed the blog (HTTP ${seeded})`);
  }

  await page
    .waitForFunction(() => document.body.textContent?.includes('Post 1') ?? false, null, {
      timeout: READY_TIMEOUT,
    })
    .catch(() => {});

  /* ------------------------------------------------------------ 3. publish */

  await publish(page);

  /* --------------------------------------------------------- 4. the sitemap */

  const sitemap = await (await fetch(`${ROOT}sitemap.xml`)).text();
  const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  report.check(
    'the sitemap names every generated page',
    listed.length === POSTS + POSTS / PER_PAGE,
    `${listed.length} urls, expected ${POSTS + POSTS / PER_PAGE}`
  );
  report.check(
    'including the last post and the last slice of the index',
    listed.includes(`/blog/post-${POSTS}/`) && listed.includes('/3/'),
    listed.filter((l) => l === '/3/' || l.endsWith(`post-${POSTS}/`)).join(' ') || 'missing'
  );

  /* ------------------------------------------- 5. reachable, by walking there */

  /*
   * The crawl. Every internal link followed from the home page, transitively,
   * with the set of URLs that actually answered compared against the set the
   * sitemap promises. Nothing here reads the markup for a path it expects —
   * the whole point is to find the link that is one `../` short, which looks
   * perfectly fine in a string comparison and 404s in a browser.
   */
  const seen = new Map();
  const queue = [ROOT];
  while (queue.length && seen.size < 200) {
    const url = queue.shift();
    if (seen.has(url)) continue;

    const response = await fetch(url);
    const body = response.ok ? await response.text() : '';
    seen.set(url, response.status);
    if (!response.ok) continue;

    for (const [, href] of body.matchAll(/<a[^>]*\shref="([^"#][^"]*)"/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // mailto:, https://…
      const next = new URL(href, url).href;
      if (next.startsWith(ROOT) && !seen.has(next)) queue.push(next);
    }
  }

  const broken = [...seen].filter(([, status]) => status !== 200).map(([url]) => url);
  report.check(
    'every link followed from the home page answers',
    broken.length === 0,
    broken.join(', ') || `${seen.size} urls walked, all 200`
  );

  const reached = new Set([...seen.keys()].map((url) => url.slice(APP.length + `/s/${id}`.length)));
  const missed = listed.filter((loc) => !reached.has(loc));
  report.check(
    'and the walk finds every page the sitemap promises',
    missed.length === 0,
    missed.length ? `unreachable: ${missed.slice(0, 4).join(', ')}` : `${reached.size} reached`
  );

  /* ------------------------------------------------ 6. the pages are the pages */

  const first = await (await fetch(ROOT)).text();
  const second = await (await fetch(`${ROOT}2/`)).text();
  const detail = await (await fetch(`${ROOT}blog/post-17/`)).text();

  const titles = (html) => [...html.matchAll(/>Post (\d+)</g)].map((m) => Number(m[1]));
  report.check(
    'the index shows its own ten and page two shows the next ten',
    titles(first).length === PER_PAGE && titles(second)[0] === PER_PAGE + 1,
    `${titles(first).join(',')} then ${titles(second).slice(0, 3).join(',')}…`
  );
  report.check(
    'a record page is that record, bound from the document',
    /<h1[^>]*>Post 17<\/h1>/.test(detail),
    /<h1[^>]*>[^<]*<\/h1>/.exec(detail)?.[0] ?? 'no heading'
  );
  report.check(
    'and it carries no trace of the template it was rendered from',
    !detail.includes('A post title'),
    detail.includes('A post title') ? 'design-time copy shipped' : 'record only'
  );

  /* -------------------------------------------- 7. clicking, not just fetching */

  await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
  await page.locator('a', { hasText: 'Older posts' }).first().click();
  await page.waitForLoadState('domcontentloaded');
  report.check(
    'the pager takes a visitor to page two',
    page.url().replace(/\/$/, '') === `${ROOT}2`.replace(/\/$/, ''),
    page.url()
  );

  await page.locator('a', { hasText: 'Post 11' }).first().click();
  await page.waitForLoadState('domcontentloaded');
  report.check(
    'a card on page two opens that post',
    page.url().includes('/blog/post-11/') &&
      (await page.locator('h1').first().textContent()) === 'Post 11',
    page.url()
  );

  await page.locator('a', { hasText: 'All posts' }).first().click();
  await page.waitForLoadState('domcontentloaded');
  report.check(
    'and the way back from a post lands on the index, not outside the site',
    page.url().replace(/\/$/, '') === ROOT.replace(/\/$/, '') &&
      (await page.locator('a', { hasText: 'Post 1' }).count()) > 0,
    page.url()
  );
} catch (error) {
  report.check('the suite ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
}

report.finish();
