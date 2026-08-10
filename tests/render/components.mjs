/**
 * Three instances of one component — two saying different things, one wearing
 * a different look — drawn by one renderer.
 *
 * The static suite already proves what the publisher emits. What only a
 * browser can answer is the pair of claims the design rests on, which are
 * opposites and both have to hold:
 *
 *   a **property** changes what an element says and *nothing* about how it is
 *   drawn, because two instances share one set of nodes;
 *
 *   a **variant** changes how it is drawn, because it is a different set of
 *   nodes with classes of its own.
 *
 * So cards one and two must be pixel-identical apart from their words, card
 * three must not be, all three must match the published file element for
 * element, and the page must contain what each instance chose rather than what
 * the master was drawn with.
 *
 * The last part is the inspector, kept short on purpose. A property nobody can
 * set is a data structure, not a feature; thirty clicks to prove it is a suite
 * that breaks on a layout tweak. Four will do.
 */

import {
  APP,
  getDocument,
  launch,
  node,
  PUBLISH_TIMEOUT,
  READY_TIMEOUT,
  saveDocument,
  toCanvasKeys,
  unbalanced,
} from './harness.mjs';

const results = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const TITLE = 'p-title';
const BADGE = 'p-badge';

/**
 * A card component, two instances of its default tree, one of its variant.
 *
 * Written into the document directly rather than clicked together. The path
 * from "select a box" to "component with an exposed property" is a dozen
 * interactions that the static suite already drives through the real
 * operations — repeating them here would buy nothing and break on a button
 * moving.
 */
function seed(doc) {
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];

  const master = { componentId: 'cmp1' };
  Object.assign(doc.nodes, {
    cardroot01: node('cardroot01', 'stack', 'Card', {
      children: ['cardtitle1', 'cardbadge1'],
      meta: master,
      styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' } },
    }),
    cardtitle1: node('cardtitle1', 'heading', 'Title', {
      parentId: 'cardroot01',
      props: { text: 'Master title', level: 3 },
      meta: master,
      styles: { desktop: { color: '#7c3aed', fontSize: '22px', fontWeight: 600 } },
    }),
    cardbadge1: node('cardbadge1', 'text', 'Badge', {
      parentId: 'cardroot01',
      props: { text: 'Badge text' },
      meta: master,
      styles: { desktop: { color: '#0f766e' } },
    }),
    inst000001: node('inst000001', 'instance', 'Card', {
      parentId: home.rootNodeId,
      props: { componentId: 'cmp1' },
      overrides: { [TITLE]: 'First card' },
    }),
    inst000002: node('inst000002', 'instance', 'Card', {
      parentId: home.rootNodeId,
      props: { componentId: 'cmp1' },
      overrides: { [TITLE]: 'Second card', [BADGE]: false },
    }),

    /*
     * The variant, in the shape `addVariant` produces: a whole second tree
     * with ids of its own, so it can look different — which is the thing a
     * property cannot do and the reason variants exist.
     */
    varroot001: node('varroot001', 'stack', 'Card — Loud', {
      children: ['vartitle01', 'varbadge01'],
      meta: master,
      styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' } },
    }),
    vartitle01: node('vartitle01', 'heading', 'Title', {
      parentId: 'varroot001',
      props: { text: 'Master title', level: 3 },
      meta: master,
      styles: { desktop: { color: '#b91c1c', fontSize: '30px', fontWeight: 800 } },
    }),
    varbadge01: node('varbadge01', 'text', 'Badge', {
      parentId: 'varroot001',
      props: { text: 'Badge text' },
      meta: master,
      styles: { desktop: { color: '#0f766e' } },
    }),
    inst000003: node('inst000003', 'instance', 'Card', {
      parentId: home.rootNodeId,
      props: { componentId: 'cmp1', variantId: 'var1' },
      overrides: { [TITLE]: 'Third card', [BADGE]: false },
    }),
  });

  root.children = ['inst000001', 'inst000002', 'inst000003'];
  doc.components = [
    {
      id: 'cmp1',
      name: 'Card',
      rootNodeId: 'cardroot01',
      createdAt: 1,
      variants: [{ id: 'var1', name: 'Loud', rootNodeId: 'varroot001' }],
      properties: [
        {
          id: TITLE,
          name: 'Title',
          type: 'text',
          nodeIds: ['cardtitle1', 'vartitle01'],
          prop: 'text',
          defaultValue: 'Master title',
        },
        {
          id: BADGE,
          name: 'Show badge',
          type: 'visible',
          nodeIds: ['cardbadge1', 'varbadge01'],
          defaultValue: true,
        },
      ],
    },
  ];
  return doc;
}

/** Computed styles keyed by the generated class, which both surfaces share. */
const measure = (target, rootSelector) =>
  target.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return {};
    const out = {};
    for (const el of root.querySelectorAll('[class]')) {
      const cls = [...el.classList].find((c) => c.startsWith('c-'));
      if (!cls || out[cls]) continue;
      const cs = getComputedStyle(el);
      out[cls] = [cs.display, cs.color, cs.fontSize, cs.fontWeight, cs.flexDirection, cs.gap].join(
        '|'
      );
    }
    return out;
  }, rootSelector);

const stamp = Date.now();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', 'Cass Component');
  await page.fill('input[type="email"]', `cmp${stamp}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: READY_TIMEOUT });

  await page.locator('button:has-text("Blank")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  const status = await saveDocument(page, seed(await getDocument(page, id)));
  check('the seeded document saved', status === 200, `HTTP ${status}`);
  // Fatal, and deliberately so. Every check below reads the canvas, and a
  // document that never arrived makes all of them fail for one reason while
  // reporting eight — which is worse than reporting nothing.
  if (status !== 200) throw new Error(`could not seed the document (HTTP ${status})`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  /* --------------------------------------------------- 1. on the canvas --- */

  const canvasText = await page.evaluate(() =>
    [...document.querySelectorAll('.cre8-frame.cre8-editing h3')].map((el) => el.textContent)
  );
  check(
    'the canvas draws each instance saying its own thing',
    canvasText.join('|') === 'First card|Second card|Third card',
    canvasText.join(' / ') || 'no headings'
  );

  const canvasBadges = await page.evaluate(
    () =>
      [...document.querySelectorAll('.cre8-frame.cre8-editing *')].filter(
        (el) => el.children.length === 0 && el.textContent.trim() === 'Badge text'
      ).length
  );
  check(
    'and does not draw a node an instance hid',
    canvasBadges === 1,
    `${canvasBadges} of 3 instances show the badge`
  );

  // The claim, on the canvas: two cards, one class. If an override ever
  // reached a style this is the check that would go first.
  const titleClasses = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('.cre8-frame.cre8-editing h3')].map(
        (el) => [...el.classList].find((c) => c.startsWith('c-')) ?? '?'
      )
    ),
  ]);
  check(
    'two instances of one tree carry one class, and the variant carries another',
    titleClasses.length === 2 && !titleClasses.includes('?'),
    titleClasses.join(', ')
  );

  /*
   * The two halves, side by side. Cards one and two differ only in what they
   * say and are pixel-identical otherwise; card three is a different tree and
   * looks it. If an override ever reached a style, the first of these goes.
   */
  const titleLooks = await page.evaluate(() =>
    [...document.querySelectorAll('.cre8-frame.cre8-editing h3')].map((el) => {
      const cs = getComputedStyle(el);
      return `${cs.color}|${cs.fontSize}|${cs.fontWeight}`;
    })
  );
  check(
    'an override changes what a card says and nothing about how it looks',
    titleLooks[0] === titleLooks[1],
    `${titleLooks[0]} vs ${titleLooks[1]}`
  );
  check(
    'and a variant changes how it looks, which is the thing a property cannot',
    titleLooks[2] !== undefined && titleLooks[2] !== titleLooks[0],
    `default ${titleLooks[0]} / variant ${titleLooks[2]}`
  );

  /* ------------------------------------------------- 2. and in the file --- */

  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: PUBLISH_TIMEOUT });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  const published = await (await fetch(`${APP}/s/${id}/`)).text();

  const bad = unbalanced(published);
  check(
    'the published page is well-formed',
    bad.length === 0,
    bad.map(([tag, n]) => `${tag}:${n}`).join(' ') || 'all closed'
  );
  check(
    'and says what each instance said, not what the master says',
    published.includes('First card') &&
      published.includes('Second card') &&
      published.includes('Third card') &&
      !published.includes('Master title'),
    published.includes('Master title') ? 'the master text is in the file' : 'both, master gone'
  );
  check(
    'and drops the hidden node from the file rather than hiding it with a rule',
    (published.match(/Badge text/g) ?? []).length === 1,
    `${(published.match(/Badge text/g) ?? []).length} of 3 badges in the markup`
  );

  /* ---------------------------------------- 3. and the two agree exactly --- */

  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.cre8-frame{transform:none!important}';
    document.head.appendChild(style);
  });
  const canvas = await measure(page, '.cre8-frame.cre8-editing');

  const site = await ctx.newPage();
  await site.setViewportSize({ width: 1440, height: 1000 });
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  await site.waitForTimeout(400);
  const live = toCanvasKeys(await measure(site, 'body'), canvas);

  const shared = Object.keys(live);
  const differing = shared.filter((cls) => canvas[cls] !== live[cls]);
  check(
    'every element inside an instance computes the same styles on both surfaces',
    shared.length >= 2 && differing.length === 0,
    differing.length
      ? `${differing[0]}: canvas ${canvas[differing[0]]} / live ${live[differing[0]]}`
      : `${shared.length} elements compared`
  );
  await site.close();

  /* ------------------------------------------------- 4. and it is usable -- */

  await page.click('.cre8-frame.cre8-editing h3 >> nth=1');
  await page.waitForTimeout(400);

  const shownName = await page
    .locator('aside label:text-is("Title")')
    .first()
    .isVisible()
    .catch(() => false);
  check(
    'selecting an instance shows the properties it may change, by name',
    shownName,
    shownName ? 'the Title control is on screen' : 'no control named Title'
  );

  const field = page.locator('aside label:text-is("Title")').locator('..').locator('..').locator('input');
  await field.first().fill('Typed in the inspector');
  await field.first().press('Tab');
  await page.waitForTimeout(600);

  const afterEdit = await page.evaluate(() =>
    [...document.querySelectorAll('.cre8-frame.cre8-editing h3')].map((el) => el.textContent)
  );
  check(
    'and typing into one changes that instance and no other',
    afterEdit.join('|') === 'First card|Typed in the inspector|Third card',
    afterEdit.join(' / ')
  );

  // The variant select only exists once a component has one, so its presence
  // is itself the check that the panel noticed.
  await page.click('.cre8-frame.cre8-editing h3 >> nth=2');
  await page.waitForTimeout(400);
  const variantShown = await page
    .locator('aside label:text-is("Variant")')
    .first()
    .isVisible()
    .catch(() => false);
  check(
    'and an instance wearing a variant says which one',
    variantShown,
    variantShown ? 'the Variant control is on screen' : 'no control named Variant'
  );
} finally {
  await browser.close();
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
