/**
 * D3's gate, and it is the whole claim:
 *
 *   > The same document publishes byte-identical output from the Worker as
 *   > from the browser.
 *
 * Publishing used to happen entirely in the browser — the editor generated
 * every byte and POSTed them, and the Worker was a filing cabinet. That is
 * what forced a publish to download whole collections before it could expand a
 * repeater, and what made republish-on-change impossible: nothing on the
 * server could render.
 *
 * So the Worker now runs the same modules. Not a port and not a copy — the
 * same files, bundled twice. The only honest way to check that is to render
 * the document here in Node, ask the Worker to publish it, and compare the
 * bytes. Anything less proves that both produce *a* page.
 *
 * ## What the comparison covers, and the one thing it cannot
 *
 * Everything the renderer *produces* is compared byte for byte: markup,
 * stylesheet, sitemap, robots, the lot.
 *
 * The two inline `<script>` blocks are not renderer output. They are the
 * source text of two functions, obtained with `Function.prototype.toString()`,
 * and that text is whatever compiled them — here tsc, in the Worker esbuild.
 * They disagree about quote style, comments and pure-annotations while
 * agreeing entirely about the program. Requiring those bytes to match would be
 * requiring two compilers to agree, which is not a claim worth defending.
 *
 * They are held to three things instead, and the third is the one that counts:
 * the same functions are inlined and invoked the same way; nothing in them
 * names a binding the bundler kept to itself; and they are loaded in a real
 * browser off the real published page and made to do their job. That last
 * check exists because this suite found the failure it describes.
 *
 * The fixture is deliberately awkward. Every branch of the generator that
 * could plausibly differ between two runtimes is on it: a repeater over real
 * records, a switch (so the behaviour runtime is serialised and inlined), a
 * data condition (so the resolver goes in the head and content expands into
 * two elements), a form (whose action is absolute and origin-dependent), an
 * image, a second page (so relative links and the sitemap have work to do),
 * and a `customHead`. A comparison over a blank page would pass for ever.
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
import { loadBlocks } from '../static/load-blocks.mjs';

const report = createReport();
const { hydrateDocument, generateSite } = loadBlocks();

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/**
 * The inline runtimes, lifted out so the rest can be compared byte for byte.
 *
 * They are the one thing in a published page that is *not* renderer output:
 * they are the source text of two functions, and that text is whatever
 * compiled them. The Worker's bundle and the browser's are different builds by
 * different tools, so their whitespace, comments and pure-annotations differ
 * while the program does not. Requiring them to match to the byte would be
 * requiring two bundlers to agree, which is not the claim D3 makes.
 *
 * What *is* required of them is checked below, separately and more sharply.
 */
function splitScripts(html) {
  const scripts = [];
  const rest = html.replace(/<script>([\s\S]*?)<\/script>/g, (_, body) => {
    scripts.push(body);
    return '<script></script>';
  });
  return { rest, scripts };
}

/**
 * Block comments gone, so an annotation is not mistaken for a reference.
 *
 * esbuild annotates side-effect-free calls with a block comment naming
 * `@__PURE__`. That reads exactly like the helper reference this file exists
 * to catch, and is the opposite of one — it is a note to a later minifier,
 * inside a comment.
 */
const uncommented = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');

/** Where the first difference is, with enough either side to recognise it. */
function firstDifference(a, b) {
  const limit = Math.min(a.length, b.length);
  let at = 0;
  while (at < limit && a[at] === b[at]) at++;
  if (at === limit && a.length === b.length) return null;
  const from = Math.max(0, at - 60);
  return {
    at,
    here: a.slice(from, at + 60),
    there: b.slice(from, at + 60),
  };
}

try {
  await signUp(page, 'Wendy Parker', 'wpub');
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

  /* ------------------------------------------------------ 1. something to publish */

  for (const [slug, data, position] of [
    ['aurora', { title: 'Aurora', blurb: 'Lights in the north' }, 0],
    ['tundra', { title: 'Tundra', blurb: 'Flat and cold' }, 1],
    ['fjord', { title: 'Fjord', blurb: 'Deep and narrow' }, 2],
  ]) {
    await call(`/api/projects/${id}/records`, {
      method: 'POST',
      body: JSON.stringify({ collectionId: 'places', slug, position, data }),
    });
  }

  const doc = await getDocument(page, id);
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];

  doc.settings.customHead = '<meta name="generator" content="Cre8">';
  doc.collections = [
    {
      id: 'places',
      name: 'Places',
      slugField: 'title',
      fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'blurb', label: 'Blurb', type: 'text' },
      ],
    },
  ];

  // A second page, so `relativeHref`, `pageFilename` and the sitemap all have
  // more than one thing to say.
  doc.pages.push({
    id: 'pg-about',
    name: 'About',
    slug: 'about',
    rootNodeId: 'abt0root00',
    order: 1,
    meta: { title: 'About us', description: 'Who we are' },
  });

  Object.assign(doc.nodes, {
    /* --- The repeater, with binding ------------------------------------- */
    rpt0placea: node('rpt0placea', 'stack', 'Places', {
      parentId: root.id,
      children: ['crd0placeb'],
      repeat: { collection: 'places', sort: { field: 'title', direction: 'asc' } },
      styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '20px' } },
    }),
    crd0placeb: node('crd0placeb', 'frame', 'Card', {
      parentId: 'rpt0placea',
      children: ['ttl0placec'],
      styles: { desktop: { padding: '18px', backgroundColor: '#0b1220' } },
    }),
    ttl0placec: node('ttl0placec', 'heading', 'Title', {
      parentId: 'crd0placeb',
      props: { text: 'A place', level: 3 },
      bind: { text: 'title' },
      styles: { desktop: { fontSize: '20px', color: '#e2e8f0' } },
    }),

    /* --- A switch, so the behaviour runtime is inlined ------------------- */
    swt0groupd: node('swt0groupd', 'frame', 'Plans', {
      parentId: root.id,
      children: ['btn0protoe', 'pnl0prosf0'],
      props: { switchKey: 'plan', switchDefault: 'free', switchRole: 'tabs' },
      styles: { desktop: { display: 'flex', gap: '10px' } },
    }),
    btn0protoe: node('btn0protoe', 'button', 'Pro', {
      parentId: 'swt0groupd',
      props: { label: 'Pro', switchSet: 'pro' },
    }),
    pnl0prosf0: node('pnl0prosf0', 'paragraph', 'Pro panel', {
      parentId: 'swt0groupd',
      props: { text: 'Everything, plus support' },
      rules: [
        {
          id: 'plan-pro',
          when: [{ kind: 'state', key: 'plan', op: 'isNot', values: ['pro'] }],
          apply: { display: 'none' },
        },
      ],
    }),

    /* --- A data condition, so the resolver goes in the head -------------- */
    hrs0openg0: node('hrs0openg0', 'paragraph', 'Hours', {
      parentId: root.id,
      props: { text: 'Open until five' },
      rules: [
        {
          id: 'after-dark',
          when: [{ kind: 'data', source: 'time', op: 'is', values: ['night'] }],
          apply: {},
          set: { text: 'Closed for the night' },
        },
      ],
    }),

    /* --- An image, so srcset and sizes are exercised --------------------- */
    img0coverh0: node('img0coverh0', 'image', 'Cover', {
      parentId: root.id,
      props: {
        src: '/placeholder.webp',
        alt: 'A wide landscape',
        width: 1200,
        height: 630,
        srcset: '/placeholder-480.webp 480w, /placeholder-960.webp 960w',
      },
      styles: { desktop: { width: '480px' } },
    }),

    /* --- A form, whose action is absolute and origin-dependent ----------- */
    frm0signi00: node('frm0signi00', 'form', 'Signup', {
      parentId: root.id,
      children: ['inp0emailj'],
      props: { formId: 'signup', method: 'post' },
    }),
    inp0emailj: node('inp0emailj', 'input', 'Email', {
      parentId: 'frm0signi00',
      props: { inputType: 'email', name: 'email', placeholder: 'you@example.com', required: true },
    }),

    /* --- The second page ------------------------------------------------- */
    abt0root00: node('abt0root00', 'page', 'About', {
      children: ['abt0copyk0'],
      styles: { desktop: { padding: '40px' } },
    }),
    abt0copyk0: node('abt0copyk0', 'paragraph', 'Copy', {
      parentId: 'abt0root00',
      props: { text: 'We make things.' },
    }),
    lnk0homel0: node('lnk0homel0', 'link', 'Home', {
      parentId: 'abt0root00',
      props: { text: 'Home', href: `page:${home.id}` },
    }),
  });
  doc.nodes.abt0root00.children.push('lnk0homel0');
  root.children.push('rpt0placea', 'swt0groupd', 'hrs0openg0', 'img0coverh0', 'frm0signi00');

  const seeded = await saveDocument(page, doc);
  if (!report.check('the fixture document is accepted', seeded === 200, `HTTP ${seeded}`)) {
    throw new Error(`could not seed the fixture (HTTP ${seeded})`);
  }

  // Wait for the content rather than a duration: the resync has to land, and
  // the records have to arrive, before Publish means anything.
  await page
    .waitForFunction(() => document.body.textContent?.includes('Aurora') ?? false, null, {
      timeout: READY_TIMEOUT,
    })
    .catch(() => {});

  /* ------------------------------------------------- 2. the Worker publishes it */

  await publish(page);

  /* ------------------------------- 3. the same document, rendered here in Node */

  /*
   * Read back afterwards, so what is compared is what was published rather
   * than what was sent — an autosave landing in between would otherwise look
   * exactly like a renderer that disagrees with itself.
   *
   * The records come through the API, which is the source the *browser*
   * publisher used. The Worker read them straight out of D1. Comparing the two
   * results is therefore also a check that those two queries agree.
   */
  const published = await getDocument(page, id);
  const rows = await call(`/api/projects/${id}/records?collection=places&limit=500&published=true`);
  const local = generateSite(hydrateDocument(published), {
    apiOrigin: APP,
    projectId: id,
    records: { places: rows.body?.records ?? [] },
  });

  report.check(
    'the local render has something in it',
    local.files.length >= 4 && local.totalBytes > 2000,
    `${local.files.length} files, ${local.totalBytes} bytes`
  );

  /* ------------------------------------------------------- 4. byte for byte */

  for (const file of local.files) {
    const url =
      file.path === 'index.html'
        ? `${APP}/s/${id}/`
        : file.path.endsWith('/index.html')
          ? `${APP}/s/${id}/${file.path.slice(0, -'/index.html'.length)}/`
          : `${APP}/s/${id}/${file.path}`;

    const response = await fetch(url);
    const served = await response.text();
    const worker = splitScripts(served);
    const local = splitScripts(file.contents);

    const diff = firstDifference(worker.rest, local.rest);
    report.check(
      `${file.path} is byte-identical`,
      response.ok && diff === null,
      diff === null
        ? `${worker.rest.length} bytes`
        : `HTTP ${response.status}, differs at ${diff.at} of ${worker.rest.length}/${local.rest.length}\n` +
          `      worker  …${diff.here}…\n` +
          `      browser …${diff.there}…`
    );

    /*
     * The runtimes are compared by *which* they are and how they are called,
     * not by their text.
     *
     * Two bundlers compiled them. esbuild prefers double quotes, tsc keeps
     * single; one strips comments, the other does not; both add annotations
     * the other does not. Normalising all of that away is a game with no end,
     * and winning it would prove something nobody needs — that two compilers
     * agree. What has to be true is that the same two functions are inlined,
     * invoked the same way, and that the Worker's copies actually run. The
     * first is here; the last is checked further down by driving them.
     */
    /*
     * Identified by how it is invoked, not by what it is called. The Worker's
     * bundle is minified, so `behaviourRuntime` is called `yo` in it — a name
     * is not an invariant under minification and pretending otherwise would
     * make this fail for a reason nobody should care about. The arguments are
     * ours, appended by `behaviourRuntimeSource`, and they tell the two
     * runtimes apart: one takes the document and a live flag, the other takes
     * the document element.
     */
    const entry = (source) => {
      /*
       * `[\w$]` rather than `\w`, and the difference cost a green run.
       *
       * The comment above says a name is not an invariant under minification —
       * and then the pattern assumed one anyway, because every name esbuild
       * had happened to pick so far was letters. An unrelated edit to the
       * runtime shifted the mangler onto `$i`, `\w` does not match `$`, and a
       * check written specifically not to care about the name failed on it.
       */
      const call = /^\(function [\w$]*\([\s\S]*\)\((.*?)\)\s*$/.exec(source.trim());
      return call ? `(${call[1].replace(/["']/g, '')})` : `unrecognised: ${source.slice(0, 40)}`;
    };
    if (worker.scripts.length || local.scripts.length) {
      const there = worker.scripts.map(entry).join(' ');
      const here = local.scripts.map(entry).join(' ');
      report.check(
        `${file.path} inlines the same runtimes, invoked the same way`,
        worker.scripts.length === local.scripts.length && there === here,
        there === here ? there || '(none)' : `worker: ${there}\n      browser: ${here}`
      );
    }
  }

  /* ---------------------------------- 5. the fixture really did exercise it all */

  const index = await (await fetch(`${APP}/s/${id}/`)).text();

  /*
   * The failure that made this suite worth writing, and the reason the two
   * runtimes get their own check rather than a pass.
   *
   * `Function.prototype.toString()` returns whatever the bundler emitted, and
   * esbuild's name-keeping had been rewriting `function own() {}` into that
   * plus `__name(own, "own")` — where `__name` is a helper defined at *module
   * scope in the Worker bundle*. Serialised into a page, it is a
   * `ReferenceError` on the script's first statement, and every switch on
   * every published site would silently stop working.
   *
   * So: the shipped runtimes may not name anything they do not define. The
   * pattern catches every helper esbuild and tsc inject, which are all
   * double-underscored, rather than only the one that bit.
   */
  const helpers = [
    ...uncommented(splitScripts(index).scripts.join('\n')).matchAll(/\b__\w+/g),
  ].map((m) => m[0]);
  report.check(
    'the inlined runtimes reference no helper the bundler kept to itself',
    helpers.length === 0,
    helpers.length ? `${[...new Set(helpers)].join(', ')} — undefined on a published page` : 'self-contained'
  );

  /*
   * And the decisive one: run them. A serialised runtime is the only code in
   * this project whose text is produced by a bundler and executed somewhere
   * the bundler knows nothing about, so the only honest test is a real
   * published page in a real browser, pressing a real button.
   */
  const site = await ctx.newPage();
  const thrown = [];
  site.on('pageerror', (e) => thrown.push(e.message));
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(400);

  report.check(
    'they run on the published page without throwing',
    thrown.length === 0,
    thrown.join(' | ') || 'no page errors'
  );
  report.check(
    'the resolver wrote the visit onto the document element before the body',
    /\btime:(morning|afternoon|evening|night)\b/.test(
      (await site.locator('html').getAttribute('data-cre8-data')) ?? ''
    ),
    (await site.locator('html').getAttribute('data-cre8-data')) ?? 'no attribute'
  );

  const panel = site.locator('p', { hasText: 'Everything, plus support' }).first();
  const hiddenBefore = (await panel.boundingBox()) === null;
  await site.locator('button', { hasText: 'Pro' }).first().click();
  await site.waitForTimeout(200);
  report.check(
    'and pressing a switch on it still works',
    hiddenBefore && (await panel.boundingBox()) !== null,
    `${hiddenBefore ? 'hidden' : 'already visible'} → ${(await panel.boundingBox()) ? 'shown' : 'still hidden'}`
  );
  await site.close();

  const exercised = [
    ['a repeater expanded into rows', (index.match(/>Aurora</g) ?? []).length === 1 && index.includes('Fjord')],
    ['the behaviour runtime was inlined', index.includes('data-cre8-switch') && index.includes('<script')],
    ['the data resolver went into the head', index.includes('data-cre8-data')],
    ['a form got an absolute action', index.includes(`action="${APP}/api/f/`)],
    ['an image kept its ladder', index.includes('srcset=')],
    ['the custom head survived', index.includes('name="generator"')],
  ];
  for (const [what, ok] of exercised) report.check(`fixture: ${what}`, ok);

  /* -------------------------------------- 6. nothing the client sends matters */

  /*
   * The other half of "publishing moved". If a hostile body could still steer
   * the output, the work would only have been duplicated rather than moved,
   * and the byte comparison above would be checking a path nobody takes.
   */
  const spoofed = await call(`/api/projects/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({
      files: [{ path: 'index.html', contents: '<!doctype html><html><body>pwned</body></html>' }],
      assets: [{ key: 'someone-else/secret.png', path: '_assets/secret.png' }],
    }),
  });
  const after = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'a publish carrying finished files is accepted and ignores them',
    spoofed.status === 200 && !after.includes('pwned') && after.includes('Aurora'),
    spoofed.status === 200 ? (after.includes('pwned') ? 'the body was used' : 'rendered from the document') : `HTTP ${spoofed.status}`
  );
} catch (error) {
  report.check('the suite ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
}

report.finish();
