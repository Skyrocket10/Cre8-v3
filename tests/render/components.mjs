/**
 * Two instances of one component, saying different things, drawn by one
 * renderer.
 *
 * The static suite already proves what the publisher emits. What only a
 * browser can answer is the claim the whole design rests on: that an instance
 * filling in a property changes what an element *says* and nothing about how
 * it is drawn. Both cards must carry the same class, compute the same styles,
 * and match the published file — and the page must contain the words each
 * instance chose rather than the ones the master was drawn with.
 *
 * The last part is the inspector, kept short on purpose. A property nobody can
 * set is a data structure, not a feature; thirty clicks to prove it is a suite
 * that breaks on a layout tweak. Three will do.
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
 * A card component, two instances, and a difference between them.
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
  });

  root.children = ['inst000001', 'inst000002'];
  doc.components = [
    {
      id: 'cmp1',
      name: 'Card',
      rootNodeId: 'cardroot01',
      createdAt: 1,
      properties: [
        {
          id: TITLE,
          name: 'Title',
          type: 'text',
          nodeId: 'cardtitle1',
          prop: 'text',
          defaultValue: 'Master title',
        },
        { id: BADGE, name: 'Show badge', type: 'visible', nodeId: 'cardbadge1', defaultValue: true },
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
    canvasText.join('|') === 'First card|Second card',
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
    `${canvasBadges} of 2 instances show the badge`
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
    'both cards are drawn from one node, so they carry one class',
    titleClasses.length === 1 && titleClasses[0] !== '?',
    titleClasses.join(', ')
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
      !published.includes('Master title'),
    published.includes('Master title') ? 'the master text is in the file' : 'both, master gone'
  );
  check(
    'and drops the hidden node from the file rather than hiding it with a rule',
    (published.match(/Badge text/g) ?? []).length === 1,
    `${(published.match(/Badge text/g) ?? []).length} badges in the markup`
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
    afterEdit.join('|') === 'First card|Typed in the inspector',
    afterEdit.join(' / ')
  );
} finally {
  await browser.close();
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
