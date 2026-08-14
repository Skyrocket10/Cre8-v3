/**
 * Both sides of a comparison, in a browser.
 *
 * E1's falsification, verbatim from `docs/VALUES.md` §5:
 *
 *   > Compare two fields of one record and see the rule apply on one row and
 *   > not another. A literal-only model cannot express the rule at all.
 *
 * Which is a claim about two things a static check cannot answer together:
 * that somebody can *say* it in the panel, and that a published file *does* it.
 *
 * ## Driven, not seeded
 *
 * The document is never handed a `right: { kind: 'field' }`. The rule is built
 * the way a designer builds one — pick the field from the condition menu, then
 * point its operand at another field through the chip — and what is asserted
 * is what came back out of the store. A seeded rule would prove the evaluator
 * works and say nothing about whether the sentence can be written, and E1's
 * whole content is that it can.
 *
 * ## Two rows, one rule
 *
 * The two listings have the *same price* and different budgets. That is the
 * shape that makes this about the operand: no constant separates them, because
 * a constant cannot see a budget. If the panel silently dropped the field and
 * left a `0` behind, both cards would come out the same and the last check
 * would fail — which is the point of measuring the pair rather than the one.
 */

import {
  APP,
  createReport,
  getDocument,
  launch,
  node,
  openInspectorSection,
  openProject,
  publish,
  READY_TIMEOUT,
  saveDocument,
  signUp,
} from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const OVER = 'rgb(190, 40, 40)';

try {
  await signUp(page, 'Val Sharma', `values${Date.now()}`);
  const projectId = await openProject(page, 'Blank');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });

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

  /* --------------------------------------------- 1. two rows and one card */

  const doc = await getDocument(page, projectId);
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];

  doc.collections = [
    {
      id: 'listings',
      name: 'Listings',
      slugField: 'title',
      fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'price', label: 'Price', type: 'number' },
        { key: 'budget', label: 'Budget', type: 'number' },
      ],
    },
  ];

  Object.assign(doc.nodes, {
    rptval0001: node('rptval0001', 'stack', 'Listings', {
      parentId: root.id,
      children: ['crdval0002'],
      repeat: { collection: 'listings', sort: { field: 'title', direction: 'asc' } },
      styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '32px' } },
    }),
    crdval0002: node('crdval0002', 'frame', 'Listing card', {
      parentId: 'rptval0001',
      children: ['ttlval0003'],
      styles: {
        desktop: {
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '20px',
          backgroundColor: '#0f172a',
          color: '#e2e8f0',
        },
      },
    }),
    ttlval0003: node('ttlval0003', 'heading', 'Title', {
      parentId: 'crdval0002',
      props: { text: 'A listing', level: 3 },
      bind: { text: 'title' },
      styles: { desktop: { fontSize: '20px' } },
    }),
  });
  root.children.push('rptval0001');
  const saved = await saveDocument(page, doc);
  report.check('the page has a repeater over two number fields', saved === 200, `save ${saved}`);

  /*
   * The same price on both rows. Sorted by title, so `Over` is the first card
   * and `Under` the second whatever order they were written in.
   */
  const rows = [
    await call(`/api/projects/${projectId}/records`, {
      method: 'POST',
      body: JSON.stringify({
        collectionId: 'listings',
        slug: 'over',
        position: 0,
        published: true,
        data: { title: 'Over', price: 900000, budget: 750000 },
      }),
    }),
    await call(`/api/projects/${projectId}/records`, {
      method: 'POST',
      body: JSON.stringify({
        collectionId: 'listings',
        slug: 'under',
        position: 1,
        published: true,
        data: { title: 'Under', price: 900000, budget: 950000 },
      }),
    }),
  ];
  report.check(
    'two rows with the same price and different budgets',
    rows.every((r) => r.status === 200),
    rows.map((r) => r.status).join(' ')
  );

  /* ------------------------------------------- 2. build the rule by hand */

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  // Through the layer tree, because clicking the card on the canvas is
  // clicking whichever row happens to be under the pointer.
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('[data-layer-row]:has-text("Listing card")').first().click();
  await page.waitForTimeout(500);
  await openInspectorSection(page, 'States & conditions');
  await page.waitForTimeout(400);

  const panel = page.locator('aside').last();
  const add = panel.getByRole('button', { name: 'When…' }).first();
  const addCount = await add.count();
  if (!addCount) {
    const alt = panel.locator('button:has-text("condition")');
    report.check(
      'the panel offers somewhere to add a condition',
      false,
      `no "When…" — buttons: ${(await alt.allInnerTexts()).join(' / ') || 'none'}`
    );
  } else {
    await add.click();
    await page.waitForTimeout(400);
    const priceOffer = page.locator('[role="dialog"], [data-popover]').locator('button:has-text("Price")').first();
    const menu = (await priceOffer.count())
      ? priceOffer
      : page.locator('button:has-text("Price")').last();
    report.check(
      'the record’s own fields are offered as conditions',
      (await menu.count()) >= 1,
      `${await menu.count()} entry for Price`
    );
    await menu.click();
    await page.waitForTimeout(600);
  }

  const seededDoc = await getDocument(page, projectId);
  const seededRule = seededDoc.nodes.crdval0002.rules?.[0];
  report.check(
    'picking a field writes a comparison against a constant, as it always has',
    seededRule?.when?.kind === 'compare' &&
      seededRule?.when?.left?.key === 'price' &&
      seededRule?.when?.right?.kind === 'literal',
    JSON.stringify(seededRule?.when ?? null)
  );

  /*
   * The operator, because the menu seeds the first one a number can answer and
   * that is `is`. Driven through the chip for the same reason everything else
   * here is: a sentence somebody cannot finish in the panel is not a sentence
   * the product can say.
   */
  // By accessible name rather than by `:text-is`, which matches the smallest
  // element holding the text — that is the `<span>` inside the chip, not the
  // button, and clicking a span that happens to be inside a button is a
  // different gesture from pressing the control.
  const opChip = panel.getByRole('button', { name: 'is', exact: true }).first();
  report.check(
    'the operator is a chip in the sentence rather than a fixed word',
    (await opChip.count()) === 1,
    `${await opChip.count()} operator chip(s)`
  );
  if (await opChip.count()) {
    await opChip.click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("is over")').last().click();
    await page.waitForTimeout(500);
  }

  /*
   * And then the operand becomes a field, through the affordance that exists
   * for it: the chevron inside the value chip. Named rather than found by
   * shape, because a bare chevron beside a box is not a control anybody can
   * describe.
   */
  const swap = panel.getByRole('button', { name: 'Compare against something else' }).first();
  report.check(
    'the value chip offers to compare against something else',
    (await swap.count()) === 1,
    `${await swap.count()} chevron(s) in the sentence`
  );
  if ((await swap.count()) === 1) {
    await swap.click();
    await page.waitForTimeout(300);
    const budget = page.locator('button:text-is("Budget")').last();
    report.check(
      'and the menu offers the other number field, by its label',
      (await budget.count()) === 1,
      `${await budget.count()} entry for Budget`
    );
    if (await budget.count()) {
      await budget.click();
      await page.waitForTimeout(600);
    }
  }

  const built = await getDocument(page, projectId);
  const rule = built.nodes.crdval0002.rules?.[0];
  report.check(
    'the rule now compares two fields of the row',
    rule?.when?.left?.kind === 'field' &&
      rule?.when?.left?.key === 'price' &&
      rule?.when?.op === 'gt' &&
      rule?.when?.right?.kind === 'field' &&
      rule?.when?.right?.key === 'budget',
    JSON.stringify(rule?.when ?? null)
  );
  report.check(
    'and the sentence says so in words rather than showing an empty box',
    (await panel.locator('[data-sentence]').last().innerText().catch(() => '')).includes('Budget'),
    (await panel.locator('[data-sentence]').last().innerText().catch(() => '')) || 'no sentence'
  );

  /*
   * And the row above the sentence says the same thing.
   *
   * `ruleSentence` was handed no fields at all, so a rule conditioned on the
   * record summarised as `a field …` — the chip's placeholder for *nothing
   * chosen* — directly above a sentence that named both fields correctly. Two
   * descriptions of one rule disagreeing is what `describeRule` exists to
   * prevent, so it is checked where they sit next to each other.
   */
  const rowText = await panel.locator('[data-rule-row]').first().innerText().catch(() => '');
  report.check(
    'the rule’s row names the two fields rather than saying “a field”',
    rowText.includes('Price') && rowText.includes('Budget') && !rowText.includes('a field'),
    JSON.stringify(rowText)
  );

  /* ------------------------------------------------- 3. what it paints */

  {
    const withPaint = await getDocument(page, projectId);
    const styled = withPaint.nodes.crdval0002.rules?.[0];
    if (styled) styled.apply = { backgroundColor: OVER };
    await saveDocument(page, withPaint);
    await page.waitForTimeout(600);
  }

  /*
   * The canvas first, which draws the first row. `evaluate` is the same
   * function on both surfaces, so a disagreement here would be a disagreement
   * about the record in scope rather than about the comparison — and that is
   * worth telling apart, which is why both are measured.
   */
  const onCanvas = await page.evaluate(() => {
    const card = document.querySelector('.cre8-frame.cre8-editing .c-crdval0002');
    return card ? getComputedStyle(card).backgroundColor : 'no card';
  });
  report.check(
    'the canvas paints the row the rule holds for',
    onCanvas === OVER,
    `first card is ${onCanvas}`
  );

  await publish(page);
  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(600);

  /*
   * Both cards, by the colour they ended up. Read off the rendered page rather
   * than out of the markup: the class the rule compiles to is shortened at
   * publish, so a regex over attributes would be measuring the compiler's
   * naming and this is measuring what somebody sees.
   */
  const painted = await site.evaluate(() =>
    [...document.querySelectorAll('h3')].map((h) => ({
      title: (h.textContent ?? '').trim(),
      background: getComputedStyle(h.parentElement).backgroundColor,
    }))
  );
  const over = painted.find((one) => one.title === 'Over');
  const under = painted.find((one) => one.title === 'Under');

  report.check(
    'the published file has both rows',
    painted.length === 2 && over && under,
    painted.map((one) => `${one.title} ${one.background}`).join(' · ')
  );
  /*
   * One row painted and one not, which is the whole of the falsification: the
   * same rule, the same price, a different answer, decided by a field on the
   * *right* of the operator. Both halves asserted — a rule so broad it painted
   * everything would pass the first on its own.
   */
  report.check(
    'and only the row whose price is over its budget is painted',
    over?.background === OVER && under?.background !== OVER,
    `Over ${over?.background} · Under ${under?.background}`
  );
  /*
   * And it cost nothing to run. A comparison between two fields folds, so the
   * answer is in the markup and there is no table, no published values and no
   * script — which is the affordability argument in `VALUES.md` §3.3, checked
   * against a file rather than asserted.
   */
  const html = await site.content();
  report.check(
    'and the file ships no runtime to work it out',
    !html.includes('data-cre8-test') && !html.includes('data-cre8-vals'),
    `test attributes ${(html.match(/data-cre8-test/g) ?? []).length} · ` +
      `value attributes ${(html.match(/data-cre8-vals/g) ?? []).length}`
  );
  await site.close();
} catch (error) {
  report.check('values suite completed', false, String(error?.message ?? error));
} finally {
  await browser.close();
}

report.finish();
