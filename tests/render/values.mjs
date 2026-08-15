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

  /* ------------------------------------- 4. E3: following a reference */

  /*
   * `VALUES.md` §1.3: a post has an author and a page could not say the
   * author's name, because `Field.type: 'reference'` was declarable and
   * unreadable. Every content site is two collections and a pointer between
   * them, so this is the row that decided whether somebody could build one.
   *
   * The reference is *authored* here — pick the field, then pick what to read
   * off the record it names — and then the author record is deleted, which is
   * the falsification §5 asks for: the binding has to fall back rather than
   * print an id.
   */
  const authors = await call(`/api/projects/${projectId}/records`, {
    method: 'POST',
    body: JSON.stringify({
      collectionId: 'writers',
      slug: 'ada',
      position: 0,
      published: true,
      data: { name: 'Ada Lovelace' },
    }),
  });
  const authorId = authors.body?.record?.id ?? authors.body?.id;
  report.check(
    'an author to point at',
    authors.status === 200 && Boolean(authorId),
    `${authors.status} · ${authorId ?? 'no id'}`
  );

  {
    const d = await getDocument(page, projectId);
    d.collections = [
      ...d.collections,
      {
        id: 'writers',
        name: 'Writers',
        slugField: 'name',
        fields: [{ key: 'name', label: 'Name', type: 'text' }],
      },
    ];
    const listings = d.collections.find((one) => one.id === 'listings');
    listings.fields = [
      ...listings.fields,
      { key: 'agent', label: 'Agent', type: 'reference', of: 'writers' },
    ];
    // A second element on the card, so the byline is its own binding rather
    // than a change to the title's.
    d.nodes.bylval0004 = node('bylval0004', 'paragraph', 'Byline', {
      parentId: 'crdval0002',
      props: { text: 'By somebody' },
      styles: { desktop: { fontSize: '13px' } },
    });
    d.nodes.crdval0002.children.push('bylval0004');
    await saveDocument(page, d);
  }
  /*
   * The two rows now point at the author. Written through the records API
   * rather than into the document, because that is where a record lives — and
   * asserted, because a check further down that reads "By somebody" cannot
   * tell a resolver that did not follow from a link that was never made.
   */
  const linked = [];
  for (const slug of ['over', 'under']) {
    const list = await call(`/api/projects/${projectId}/records?collection=listings`);
    const row = (list.body?.records ?? []).find((one) => one.slug === slug);
    if (!row) {
      linked.push(`${slug}: not found among ${(list.body?.records ?? []).length}`);
      continue;
    }
    const put = await call(`/api/projects/${projectId}/records/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify({ data: { ...row.data, agent: authorId } }),
    });
    linked.push(`${slug}: ${put.status} agent=${put.body?.record?.data?.agent ?? 'unset'}`);
  }
  report.check(
    'both listings point at the author',
    linked.every((one) => one.includes(`agent=${authorId}`)),
    linked.join(' · ')
  );

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('[data-layer-row]:has-text("Byline")').first().click();
  await page.waitForTimeout(500);
  await openInspectorSection(page, 'Content');
  await page.waitForTimeout(400);

  const contentPanel = page.locator('aside').last();
  const textRow = contentPanel.locator('[data-sentence]:has-text("Text reads")').first();
  const fieldChip = textRow.getByRole('button').first();
  report.check(
    'the Content panel offers the record’s fields for this element’s text',
    (await fieldChip.count()) === 1,
    `${await fieldChip.count()} field chip(s)`
  );
  if (await fieldChip.count()) {
    await fieldChip.click();
    await page.waitForTimeout(300);
    // By accessible name: `:text-is` matches the smallest element holding the
    // text, which inside a `Select` option is the span rather than the button.
    await page.getByRole('button', { name: 'Agent', exact: true }).last().click();
    await page.waitForTimeout(600);
  }

  /*
   * And now the chip that did not exist before E3. A reference on its own
   * prints nothing — it is a record, not a name — so the sentence has to offer
   * the step that turns it into one.
   */
  const arrow = contentPanel.locator('[data-sentence]:has-text("Text reads")').first();
  const followChip = arrow.getByRole('button').nth(1);
  report.check(
    'and picking a reference offers what to read off the record it names',
    (await followChip.count()) === 1 &&
      (await arrow.innerText()).includes('→'),
    JSON.stringify((await arrow.innerText()).replace(/\n/g, ' · '))
  );
  if (await followChip.count()) {
    await followChip.click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Name', exact: true }).last().click();
    await page.waitForTimeout(600);
  }

  const chained = await getDocument(page, projectId);
  const value = chained.nodes.bylval0004.bind?.text?.value;
  report.check(
    'the binding is a chain: the reference, followed, then a field of it',
    value?.kind === 'field' &&
      value?.key === 'agent' &&
      value?.steps?.length === 2 &&
      value.steps[0].op === 'follow' &&
      value.steps[1].op === 'field' &&
      value.steps[1].key === 'name',
    JSON.stringify(value ?? null)
  );

  const canvasByline = await page.evaluate(() => {
    const card = document.querySelector('.cre8-frame.cre8-editing .c-bylval0004');
    return card ? (card.textContent ?? '').trim() : 'no byline';
  });
  report.check(
    'the canvas prints the name off the record the reference names',
    canvasByline === 'Ada Lovelace',
    canvasByline
  );

  await publish(page);
  const withAuthor = await ctx.newPage();
  await withAuthor.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await withAuthor.waitForTimeout(600);
  const bylines = await withAuthor.evaluate(() =>
    [...document.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim())
  );
  report.check(
    'and so does the published file, on every row',
    bylines.filter((text) => text === 'Ada Lovelace').length === 2,
    bylines.join(' · ') || 'no paragraphs'
  );
  await withAuthor.close();

  /*
   * The falsification. Delete the author and the byline has nothing to say —
   * so it says what the designer typed, not a record id. An id in the markup
   * would be the failure this whole shape exists to avoid: a page that looks
   * broken to a reader and fine to a crawler.
   */
  const gone = await call(`/api/projects/${projectId}/records/${authorId}`, { method: 'DELETE' });
  report.check('the author is deleted', gone.status === 200 || gone.status === 204, `${gone.status}`);

  await publish(page);
  const without = await ctx.newPage();
  await without.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await without.waitForTimeout(600);
  const after = await without.evaluate(() =>
    [...document.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim())
  );
  const markup = await without.content();
  report.check(
    'with the author gone the byline falls back rather than printing an id',
    after.every((text) => text === 'By somebody') && after.length === 2,
    after.join(' · ') || 'no paragraphs'
  );
  report.check(
    'and the id is nowhere in the file',
    !markup.includes(authorId),
    authorId ? `looked for ${authorId}` : 'no id to look for'
  );
  await without.close();

  /* ------------------------------------------ 5. E4: a value that is a list */

  /*
   * "How many Writers, in total" — a count of a collection nothing repeats.
   *
   * The empty case is the falsification `VALUES.md` §5 names, and it is
   * checked in the order it actually breaks: the author was deleted a moment
   * ago, so the collection is *already* empty, and a count that treated "no
   * rows" like every other step's "nothing here" would leave the designer's
   * placeholder on the page. Then a writer is added back and the same binding
   * has to say 1.
   */
  {
    const d = await getDocument(page, projectId);
    d.nodes.cntval0005 = node('cntval0005', 'paragraph', 'How many', {
      parentId: 'crdval0002',
      props: { text: 'some writers' },
      styles: { desktop: { fontSize: '12px' } },
    });
    d.nodes.crdval0002.children.push('cntval0005');
    await saveDocument(page, d);
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('[data-layer-row]:has-text("How many")').first().click();
  await page.waitForTimeout(500);
  await openInspectorSection(page, 'Content');
  await page.waitForTimeout(400);

  const countPanel = page.locator('aside').last();
  const countRow = countPanel.locator('[data-sentence]:has-text("Text reads")').first();
  await countRow.getByRole('button').first().click();
  await page.waitForTimeout(300);
  const howMany = page.getByRole('button', { name: 'How many Writers', exact: true });
  report.check(
    'a collection can be counted',
    (await howMany.count()) === 1,
    `${await howMany.count()} entry`
  );
  if (await howMany.count()) {
    await howMany.last().click();
    await page.waitForTimeout(600);
  }
  /*
   * "In total" — the words that stop this reading as "how many writers on this
   * listing". They were in the menu label until E6 gave the sentence a way to
   * say the other thing, and a label cannot be taken back: "How many Writers,
   * in total, only when Featured is ticked" contradicts itself in the middle.
   * So the claim moved into the sentence, where it can end.
   */
  const totalWording = await countPanel
    .locator('[data-sentence]:has-text("Text reads")')
    .first()
    .innerText();
  report.check(
    'and the sentence says it is the whole of the collection',
    totalWording.includes('in total'),
    totalWording.replace(/\s+/g, ' ').trim()
  );

  const counted = await getDocument(page, projectId);
  const countValue = counted.nodes.cntval0005.bind?.text?.value;
  report.check(
    'the binding is a list head with a count on it',
    countValue?.kind === 'records' &&
      countValue?.collection === 'writers' &&
      countValue?.steps?.length === 1 &&
      countValue.steps[0].op === 'count',
    JSON.stringify(countValue ?? null)
  );

  /*
   * The empty case first, because the collection is empty right now — the
   * author was deleted two checks ago. A count that answered "nothing here"
   * would leave "some writers" on the page.
   */
  const zeroOnCanvas = await page.evaluate(() => {
    const el = document.querySelector('.cre8-frame.cre8-editing .c-cntval0005');
    return el ? (el.textContent ?? '').trim() : 'no element';
  });
  report.check(
    'an empty collection counts as 0 rather than falling back to the placeholder',
    zeroOnCanvas === '0',
    zeroOnCanvas
  );

  await publish(page);
  const zeroSite = await ctx.newPage();
  await zeroSite.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await zeroSite.waitForTimeout(600);
  const zeroPublished = await zeroSite.evaluate(() =>
    [...document.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim())
  );
  await zeroSite.close();
  report.check(
    'and the published file says 0 too, on every row',
    zeroPublished.filter((text) => text === '0').length === 2,
    zeroPublished.join(' · ') || 'no paragraphs'
  );

  // And a writer back, so the check above is measuring a count rather than a
  // constant: the same binding, a different number.
  const added = await call(`/api/projects/${projectId}/records`, {
    method: 'POST',
    body: JSON.stringify({
      collectionId: 'writers',
      slug: 'grace',
      position: 0,
      published: true,
      data: { name: 'Grace Hopper' },
    }),
  });
  report.check('a writer is added back', added.status === 200, `${added.status}`);

  await publish(page);
  const oneSite = await ctx.newPage();
  await oneSite.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await oneSite.waitForTimeout(600);
  const onePublished = await oneSite.evaluate(() =>
    [...document.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim())
  );
  const countMarkup = await oneSite.content();
  await oneSite.close();
  report.check(
    'and the count follows the collection rather than staying where it was',
    onePublished.filter((text) => text === '1').length === 2 &&
      !onePublished.includes('0'),
    onePublished.join(' · ') || 'no paragraphs'
  );
  report.check(
    'with no runtime shipped to work any of it out',
    !countMarkup.includes('data-cre8-test') && !countMarkup.includes('data-cre8-vals'),
    `test attributes ${(countMarkup.match(/data-cre8-test/g) ?? []).length}`
  );

  /* ------------------------------------------------ 6. E5: the arithmetic */

  /*
   * `VALUES.md` §5: "the same sum on the canvas and in the file, and a
   * comparison against a typed number answered in the browser."
   *
   * Both halves, because they are different claims. The sum over a record
   * folds and is checked as bytes in a file; the comparison against something
   * typed is the first thing in this whole arc that the *runtime* has to work
   * out, and it is measured by typing into the box.
   */
  {
    const d = await getDocument(page, projectId);
    const listings = d.collections.find((one) => one.id === 'listings');
    listings.fields = [...listings.fields, { key: 'rooms', label: 'Rooms', type: 'number' }];
    d.nodes.totval0006 = node('totval0006', 'paragraph', 'Per room', {
      parentId: 'crdval0002',
      props: { text: 'a rate' },
      styles: { desktop: { fontSize: '12px' } },
    });
    d.nodes.crdval0002.children.push('totval0006');
    await saveDocument(page, d);
  }
  for (const [slug, rooms] of [['over', 4], ['under', 5]]) {
    const list = await call(`/api/projects/${projectId}/records?collection=listings`);
    const row = (list.body?.records ?? []).find((one) => one.slug === slug);
    if (row) {
      await call(`/api/projects/${projectId}/records/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { ...row.data, rooms } }),
      });
    }
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('[data-layer-row]:has-text("Per room")').first().click();
  await page.waitForTimeout(500);
  await openInspectorSection(page, 'Content');
  await page.waitForTimeout(400);

  const mathsPanel = page.locator('aside').last();
  const mathsRow = mathsPanel.locator('[data-sentence]:has-text("Text reads")').first();
  await mathsRow.getByRole('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Price', exact: true }).last().click();
  await page.waitForTimeout(600);

  // By its visible text: a button with content takes its accessible name from
  // that content, and the `title` is only a fallback for one with none. The
  // same trap X10 hit when a remover moved to an `IconButton`.
  const addMaths = mathsPanel.getByRole('button', { name: '+ maths' }).first();
  report.check(
    'a number offers somewhere to do arithmetic to it',
    (await addMaths.count()) === 1,
    `${await addMaths.count()} offer(s)`
  );
  if (await addMaths.count()) {
    await addMaths.click();
    await page.waitForTimeout(500);
    // The seeded step is `× 1`; point it at Rooms and make it a division.
    const opChip = mathsPanel.getByRole('button', { name: '×', exact: true }).first();
    await opChip.click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '÷', exact: true }).last().click();
    await page.waitForTimeout(500);
    const byChip = mathsPanel
      .getByRole('button', { name: 'Use a number from the record' })
      .first();
    if (await byChip.count()) {
      await byChip.click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Rooms', exact: true }).last().click();
      await page.waitForTimeout(600);
    }
  }

  const divided = await getDocument(page, projectId);
  const mathsValue = divided.nodes.totval0006.bind?.text?.value;
  report.check(
    'the binding is a chain with an arithmetic step in it',
    mathsValue?.kind === 'field' &&
      mathsValue?.key === 'price' &&
      mathsValue?.steps?.length === 1 &&
      mathsValue.steps[0].op === 'over' &&
      mathsValue.steps[0].by?.kind === 'field' &&
      mathsValue.steps[0].by?.key === 'rooms',
    JSON.stringify(mathsValue ?? null)
  );

  const perRoomCanvas = await page.evaluate(() => {
    const el = document.querySelector('.cre8-frame.cre8-editing .c-totval0006');
    return el ? (el.textContent ?? '').trim() : 'no element';
  });
  report.check(
    'the canvas does the sum',
    perRoomCanvas === '225000',
    `900000 ÷ 4 → ${perRoomCanvas}`
  );

  await publish(page);
  const mathsSite = await ctx.newPage();
  await mathsSite.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await mathsSite.waitForTimeout(600);
  const sums = await mathsSite.evaluate(() =>
    [...document.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim())
  );
  await mathsSite.close();
  report.check(
    'and the file has the same sum, once per row, with the rows differing',
    sums.includes('225000') && sums.includes('180000'),
    sums.join(' · ')
  );

  /* --------------------------------- 7. E6: narrowing and ordering a list */

  /*
   * `VALUES.md` §5: "a filtered count that differs from the unfiltered one, on
   * the same page."
   *
   * Taken at its strongest reading, because the weak one is easy and proves
   * little. Two counts of *one* collection sit on the card: one of all the
   * viewings, one of the viewings on *this* listing. So the page carries three
   * numbers from two bindings — 3, 3 for the unfiltered one and 2, 1 for the
   * narrowed one — and no constant, no separate collection and no second
   * binding can produce that pattern.
   *
   * It is also the relational case, which is what `where` was actually for: a
   * reference on the row pointing back at the record the card is drawn for.
   * The comparison is authored the way a designer would author it — pick the
   * row's field from the clause's own menu — and the operand it lands on is
   * `this Listing` rather than a record id nobody could type.
   */
  {
    const d = await getDocument(page, projectId);
    d.collections = [
      ...d.collections,
      {
        id: 'viewings',
        name: 'Viewings',
        slugField: 'who',
        fields: [
          // `who` first, so the seeded clause is *not* the relational one and
          // the check has to drive the row's source menu to get there.
          { key: 'who', label: 'Who', type: 'text' },
          { key: 'listing', label: 'Listing', type: 'reference', of: 'listings' },
        ],
      },
    ];
    for (const [id, name, text] of [
      ['allval0007', 'All viewings', 'some viewings'],
      ['minval0008', 'Its viewings', 'some of them'],
      ['ordval0009', 'Latest viewer', 'somebody'],
    ]) {
      d.nodes[id] = node(id, 'paragraph', name, {
        parentId: 'crdval0002',
        props: { text },
        styles: { desktop: { fontSize: '12px' } },
      });
      d.nodes.crdval0002.children.push(id);
    }
    await saveDocument(page, d);
  }

  const listingIds = {};
  {
    const list = await call(`/api/projects/${projectId}/records?collection=listings`);
    for (const row of list.body?.records ?? []) listingIds[row.slug] = row.id;
  }
  const madeViewings = [];
  for (const [who, slug, at] of [
    ['Ada', 'over', 0],
    ['Grace', 'over', 1],
    ['Alan', 'under', 2],
  ]) {
    const made = await call(`/api/projects/${projectId}/records`, {
      method: 'POST',
      body: JSON.stringify({
        collectionId: 'viewings',
        slug: who.toLowerCase(),
        position: at,
        published: true,
        data: { who, listing: listingIds[slug] },
      }),
    });
    madeViewings.push(`${who}→${slug}:${made.status}`);
  }
  report.check(
    'three viewings, two on one listing and one on the other',
    madeViewings.every((one) => one.endsWith(':200')) && Object.keys(listingIds).length === 2,
    madeViewings.join(' · ')
  );

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }

  /** Select a layer by name and open the section holding its content. */
  const openContent = async (layer) => {
    await page.locator(`[data-layer-row]:has-text("${layer}")`).first().click();
    await page.waitForTimeout(500);
    await openInspectorSection(page, 'Content');
    await page.waitForTimeout(400);
    return page.locator('aside').last();
  };

  // The control: every viewing on the site, on the same card.
  {
    const panel = await openContent('All viewings');
    await panel.locator('[data-sentence]:has-text("Text reads")').first().getByRole('button').first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'How many Viewings', exact: true }).last().click();
    await page.waitForTimeout(600);
  }

  // And the narrowed one, authored clause by clause.
  const minePanel = await openContent('Its viewings');
  await minePanel.locator('[data-sentence]:has-text("Text reads")').first().getByRole('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'How many Viewings', exact: true }).last().click();
  await page.waitForTimeout(600);

  const addWhere = minePanel.getByRole('button', { name: '+ only when' }).first();
  report.check(
    'a counted list offers somewhere to narrow it',
    (await addWhere.count()) === 1,
    `${await addWhere.count()} offer(s)`
  );
  if (await addWhere.count()) {
    await addWhere.click();
    await page.waitForTimeout(500);
    /*
     * The clause's own source menu, which offers the *row's* fields and
     * nothing else. Asserted before picking, because the whole reason `row` is
     * its own head is that a filter reads the candidate rather than the record
     * in scope — and a menu offering both would be the panel saying they are
     * the same thing.
     */
    const clause = minePanel.locator('[data-sentence] [data-sentence]').first();
    await clause.getByRole('button').first().click();
    await page.waitForTimeout(300);
    // The open menu, which is a portalled panel rather than a dialog: scoped
    // to it because the assertion below is about what is *not* offered, and
    // the whole page is full of buttons named after fields.
    const offered = await page.locator('.anim-pop').last().innerText().catch(() => '');
    report.check(
      'the filter reads the row’s own fields, not the record the card is drawn for',
      offered.includes('Listing') && offered.includes('Who') && !offered.includes('Price'),
      offered.replace(/\s+/g, ' ').trim() || 'nothing offered'
    );
    await page.getByRole('button', { name: 'Listing', exact: true }).last().click();
    await page.waitForTimeout(600);
  }

  const narrowed = await getDocument(page, projectId);
  const mineValue = narrowed.nodes.minval0008.bind?.text?.value;
  report.check(
    'the binding narrows the list to the rows pointing at this record',
    mineValue?.kind === 'records' &&
      mineValue?.collection === 'viewings' &&
      mineValue?.steps?.length === 2 &&
      mineValue.steps[0].op === 'where' &&
      mineValue.steps[0].test?.left?.kind === 'row' &&
      mineValue.steps[0].test?.left?.key === 'listing' &&
      mineValue.steps[0].test?.right?.kind === 'self' &&
      mineValue.steps[1].op === 'count',
    JSON.stringify(mineValue ?? null)
  );
  /*
   * And the sentence stops claiming the whole collection the moment it stops
   * counting the whole collection.
   */
  const narrowedWording = await minePanel
    .locator('[data-sentence]:has-text("Text reads")')
    .first()
    .innerText();
  report.check(
    'and "in total" is gone, because it is no longer true',
    !narrowedWording.includes('in total') && narrowedWording.includes('only when'),
    narrowedWording.replace(/\s+/g, ' ').trim()
  );

  /* The order, on the same list: the last viewer alphabetically. */
  const orderPanel = await openContent('Latest viewer');
  await orderPanel.locator('[data-sentence]:has-text("Text reads")').first().getByRole('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'The first viewing', exact: true }).last().click();
  await page.waitForTimeout(600);
  await orderPanel.getByRole('button', { name: 'the viewing itself', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Who', exact: true }).last().click();
  await page.waitForTimeout(600);

  const addOrder = orderPanel.getByRole('button', { name: '+ in order of' }).first();
  report.check(
    'and the end of a list offers a say in which end that is',
    (await addOrder.count()) === 1,
    `${await addOrder.count()} offer(s)`
  );
  if (await addOrder.count()) {
    await addOrder.click();
    await page.waitForTimeout(500);
    await orderPanel.getByRole('button', { name: 'A → Z', exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Z → A', exact: true }).last().click();
    await page.waitForTimeout(600);
  }

  const ordered = await getDocument(page, projectId);
  const orderValue = ordered.nodes.ordval0009.bind?.text?.value;
  report.check(
    'the binding sorts before it takes the first row',
    orderValue?.steps?.[0]?.op === 'sortedBy' &&
      orderValue.steps[0].field === 'who' &&
      orderValue.steps[0].desc === true &&
      orderValue.steps[1]?.op === 'first' &&
      orderValue.steps[2]?.op === 'field',
    JSON.stringify(orderValue ?? null)
  );

  /*
   * And what the two surfaces make of all of it. The canvas draws the first
   * card against the first listing — sorted by title, so `Over`, which has two
   * viewings of the three.
   */
  const narrowedCanvas = await page.evaluate(() => {
    const card = document.querySelector('.cre8-frame.cre8-editing .c-crdval0002');
    const read = (cls) => (card?.querySelector(cls)?.textContent ?? '').trim();
    return { all: read('.c-allval0007'), mine: read('.c-minval0008'), who: read('.c-ordval0009') };
  });
  report.check(
    'the canvas counts the whole collection and this record’s share of it, differently',
    narrowedCanvas.all === '3' && narrowedCanvas.mine === '2' && narrowedCanvas.who === 'Grace',
    `all ${narrowedCanvas.all} · this listing ${narrowedCanvas.mine} · latest ${narrowedCanvas.who}`
  );

  await publish(page);
  const whereSite = await ctx.newPage();
  await whereSite.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await whereSite.waitForTimeout(600);
  const cards = await whereSite.evaluate(() =>
    // By the heading each card has, not by class: `shortenIds` rewrites every
    // published class, so `c-minval0008` exists on the canvas and nowhere in
    // the file. The paragraphs are in the order they were added to the card.
    [...document.querySelectorAll('h3')].map((heading) => {
      const said = [...(heading.parentElement?.querySelectorAll('p') ?? [])].map((one) =>
        (one.textContent ?? '').trim()
      );
      return { all: said[3], mine: said[4], who: said[5], said: said.length };
    })
  );
  const whereMarkup = await whereSite.content();
  await whereSite.close();
  /*
   * The falsification itself. Two cards, one binding each: the unfiltered
   * count is the same number on both because it is a fact about the
   * collection, and the narrowed one is not because it is a fact about the
   * row. A `where` that passed everything through would print 3 twice.
   */
  report.check(
    'the published file: one count is the same on both rows and the other is not',
    cards.length === 2 &&
      cards.every((one) => one.said === 6) &&
      cards[0].all === '3' &&
      cards[1].all === '3' &&
      cards[0].mine === '2' &&
      cards[1].mine === '1',
    cards.map((one, at) => `card ${at + 1}: ${one.said} lines, all ${one.all}, this ${one.mine}`).join(' · ')
  );
  /*
   * The sorted chain is not narrowed, so it says the same thing on both rows —
   * and what it says is a name no other arrangement produces. The rows were
   * written Ada, Grace, Alan in that order, so unsorted `first` is Ada and
   * `sortedBy who` ascending is Ada as well. Only the direction chip makes it
   * Grace, which is what stops this passing against a sort that never ran.
   */
  report.check(
    'and the sorted chain names the last viewer alphabetically, which no other order does',
    cards.length === 2 && cards.every((one) => one.who === 'Grace'),
    cards.map((one) => one.who).join(' · ')
  );
  report.check(
    'with nothing shipped to the browser to work any of it out',
    !whereMarkup.includes('data-cre8-test') && !whereMarkup.includes('data-cre8-vals'),
    `test attributes ${(whereMarkup.match(/data-cre8-test/g) ?? []).length}`
  );

  /* ------------------------------------------------- 8. E7: the text steps */

  /*
   * `First & " " & Last` — the row `VALUES.md` §1.5 lists as the last thing
   * Bubble said that this could not.
   *
   * Three steps, because three is what makes it a *chain* rather than one more
   * operator: a typed separator, a second field, and a case applied to the
   * whole thing. Each is authored the way a designer would author it, and the
   * assertion is on two rows of a published file, which is the only place the
   * claim is really settled.
   */
  {
    const d = await getDocument(page, projectId);
    const listings = d.collections.find((one) => one.id === 'listings');
    listings.fields = [...listings.fields, { key: 'area', label: 'Area', type: 'text' }];
    d.nodes.jonval0010 = node('jonval0010', 'paragraph', 'Where', {
      parentId: 'crdval0002',
      props: { text: 'somewhere' },
      styles: { desktop: { fontSize: '12px' } },
    });
    d.nodes.crdval0002.children.push('jonval0010');
    await saveDocument(page, d);
  }
  for (const [slug, area] of [['over', 'Hove'], ['under', 'Lewes']]) {
    const list = await call(`/api/projects/${projectId}/records?collection=listings`);
    const row = (list.body?.records ?? []).find((one) => one.slug === slug);
    if (row) {
      await call(`/api/projects/${projectId}/records/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { ...row.data, area } }),
      });
    }
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }

  const textPanel = await openContent('Where');
  const joinRow = textPanel.locator('[data-sentence]:has-text("Text reads")').first();
  await joinRow.getByRole('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Title', exact: true }).last().click();
  await page.waitForTimeout(600);

  const addText = textPanel.getByRole('button', { name: '+ text' }).first();
  report.check(
    'text is offered somewhere to be joined and cased, as a number is offered arithmetic',
    (await addText.count()) === 1,
    `${await addText.count()} offer(s)`
  );
  /*
   * And the two families do not bleed into each other: a number's menu has no
   * `joined with` in it, and this one has no `×`. That is §3.5's rule — offer
   * only what the value can do — and it is the reason the menu is a parameter
   * rather than one list for everything.
   */
  if (await addText.count()) {
    await addText.click();
    await page.waitForTimeout(500);
    await textPanel.getByRole('button', { name: 'joined with', exact: true }).first().click();
    await page.waitForTimeout(300);
    const offeredOps = (await page.locator('.anim-pop').last().innerText().catch(() => ''))
      .split('\n')
      .map((one) => one.trim())
      .filter(Boolean);
    report.check(
      'the step menu offers what text can do and nothing a number can',
      offeredOps.includes('joined with') &&
        offeredOps.includes('UPPERCASE') &&
        !offeredOps.includes('×') &&
        !offeredOps.includes('rounded to'),
      offeredOps.join(' · ') || 'nothing offered'
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    /*
     * The separator, typed into the operand box the step arrived with — and
     * committed with Enter rather than left to the next click to blur.
     *
     * `TextInput` writes on blur or Enter, not per keystroke, so filling and
     * then clicking `+ text` is two edits racing: the blur commits the
     * separator while the click adds a step computed from the value it saw
     * before. Written the first way, the separator vanished and the chain came
     * out one step short — which is a check catching a check, not a bug.
     */
    await joinRow.locator('input').first().fill(', ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    report.check(
      'a typed separator lands in the step it was typed into',
      (await getDocument(page, projectId)).nodes.jonval0010.bind?.text?.value?.steps?.[0]?.with
        ?.value === ', ',
      JSON.stringify(
        (await getDocument(page, projectId)).nodes.jonval0010.bind?.text?.value?.steps ?? null
      )
    );

    // A second join, pointed at the other field through the chevron.
    await textPanel.getByRole('button', { name: '+ text' }).first().click();
    await page.waitForTimeout(500);
    await textPanel.getByRole('button', { name: 'Use text from the record' }).last().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Area', exact: true }).last().click();
    await page.waitForTimeout(600);

    // And a case, applied to everything before it.
    await textPanel.getByRole('button', { name: '+ text' }).first().click();
    await page.waitForTimeout(500);
    await textPanel.getByRole('button', { name: 'joined with', exact: true }).last().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'UPPERCASE', exact: true }).last().click();
    await page.waitForTimeout(600);
  }

  const joined = await getDocument(page, projectId);
  const joinValue = joined.nodes.jonval0010.bind?.text?.value;
  report.check(
    'the binding is a chain of three text steps',
    joinValue?.kind === 'field' &&
      joinValue?.key === 'title' &&
      joinValue?.steps?.length === 3 &&
      joinValue.steps[0].op === 'join' &&
      joinValue.steps[0].with?.kind === 'literal' &&
      joinValue.steps[0].with?.value === ', ' &&
      joinValue.steps[1].op === 'join' &&
      joinValue.steps[1].with?.kind === 'field' &&
      joinValue.steps[1].with?.key === 'area' &&
      joinValue.steps[2].op === 'upper',
    JSON.stringify(joinValue ?? null)
  );

  const joinedCanvas = await page.evaluate(() => {
    const el = document.querySelector('.cre8-frame.cre8-editing .c-jonval0010');
    return el ? (el.textContent ?? '').trim() : 'no element';
  });
  report.check(
    'the canvas reads the two fields as one shouted line',
    joinedCanvas === 'OVER, HOVE',
    joinedCanvas
  );

  await publish(page);
  const joinSite = await ctx.newPage();
  await joinSite.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await joinSite.waitForTimeout(600);
  const lines = await joinSite.evaluate(() =>
    [...document.querySelectorAll('h3')].map((heading) => {
      const said = [...(heading.parentElement?.querySelectorAll('p') ?? [])].map((one) =>
        (one.textContent ?? '').trim()
      );
      return said[said.length - 1];
    })
  );
  const joinMarkup = await joinSite.content();
  await joinSite.close();
  report.check(
    'and the published file has it on both rows, saying something different on each',
    lines.length === 2 && lines[0] === 'OVER, HOVE' && lines[1] === 'UNDER, LEWES',
    lines.join(' · ')
  );
  report.check(
    'with no runtime shipped for any of it',
    !joinMarkup.includes('data-cre8-test') && !joinMarkup.includes('data-cre8-vals'),
    `test attributes ${(joinMarkup.match(/data-cre8-test/g) ?? []).length}`
  );
  /* ------------------------------- 9. E8: the menu, and what it makes sayable */

  /*
   * §5's falsification for this stage is "offer a step the head cannot do and
   * watch it never resolve", which is a negative — and the static checks take
   * it as one. What a browser adds is the positive half, and it is the whole
   * reason the stage exists:
   *
   *   > When ⟨code — what is typed⟩ ⟨lowercase⟩ is ⟨yes⟩
   *
   * Text `eq` is exact, so *is `yes`* fails on `YES`, and there is no
   * case-insensitive equality anywhere in the operator set. E7 put `lower` in
   * both evaluators and nothing could reach it: the chain editor lived in the
   * Data panel, which authors bindings, and a binding never travels. This is
   * that runtime branch being paid for.
   *
   * Seeded: the form, and a rule comparing the control against nothing, with a
   * colour to make the answer visible. Driven: the step, its operator, and the
   * value — which is exactly the claim.
   */
  {
    const d = await getDocument(page, projectId);
    const home = d.pages.find((one) => one.isHome) ?? d.pages[0];
    const pageRoot = d.nodes[home.rootNodeId];
    Object.assign(d.nodes, {
      /*
       * The rule lives on the frame, not on the paragraph, and that is the
       * model rather than a convenience: a named control is looked up *inside*
       * the node that owns the rule, so a rule on the paragraph would be
       * hunting for a box that is its sibling. Colour inherits, so what the
       * frame is told the paragraph shows.
       */
      frmval0011: node('frmval0011', 'frame', 'Code box', {
        parentId: pageRoot.id,
        children: ['inpval0012', 'msgval0013'],
        rules: [
          {
            id: 'rulval0001',
            when: {
              kind: 'compare',
              left: { kind: 'input', name: 'code' },
              op: 'eq',
              right: { kind: 'literal', type: 'text', value: '' },
            },
            apply: { color: 'rgb(0, 128, 0)' },
          },
        ],
        styles: {
          desktop: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '24px',
            color: 'rgb(100, 100, 100)',
          },
        },
      }),
      inpval0012: node('inpval0012', 'input', 'Code', {
        parentId: 'frmval0011',
        props: { name: 'code', placeholder: 'yes or no' },
        styles: { desktop: { padding: '8px' } },
      }),
      msgval0013: node('msgval0013', 'paragraph', 'Verdict', {
        parentId: 'frmval0011',
        props: { text: 'Say yes' },
        styles: { desktop: {} },
      }),
    });
    pageRoot.children.push('frmval0011');
    await saveDocument(page, d);
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('[data-layer-row]:has-text("Code box")').first().click();
  await page.waitForTimeout(500);
  await openInspectorSection(page, 'States & conditions');
  await page.waitForTimeout(400);

  const rulePanel = page.locator('aside').last();
  // The row is the heading; the sentence with chips in it is what the row
  // expands to. Opened by its own handle rather than by counting buttons.
  await rulePanel.locator('[data-rule-row]').first().click();
  await page.waitForTimeout(500);
  const growText = rulePanel.getByRole('button', { name: '+ text' }).first();
  report.check(
    'a comparison offers to do something to the value before comparing it',
    (await growText.count()) === 1,
    `${await growText.count()} offer(s) — this is the affordance E5 and E7 shipped a runtime for`
  );
  if (await growText.count()) {
    await growText.click();
    await page.waitForTimeout(500);
    await rulePanel.getByRole('button', { name: 'joined with', exact: true }).first().click();
    await page.waitForTimeout(300);
    /*
     * What a control's value can be asked to do, which is words and not sums.
     * A control reads as text, so the arithmetic half of the vocabulary is
     * absent — and it is absent because the table says so rather than because
     * this panel was written to leave it out.
     */
    const menu = (await page.locator('.anim-pop').last().innerText().catch(() => ''))
      .split('\n')
      .map((one) => one.trim())
      .filter(Boolean);
    report.check(
      'and the menu on something typed is the words half, generated from its type',
      menu.includes('lowercase') && menu.includes('UPPERCASE') && !menu.includes('×'),
      menu.join(' · ') || 'nothing offered'
    );
    await page.getByRole('button', { name: 'lowercase', exact: true }).last().click();
    await page.waitForTimeout(600);

    const valueBox = rulePanel.locator('[data-sentence] input').last();
    await valueBox.fill('yes');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
  }

  const lowered = await getDocument(page, projectId);
  const loweredWhen = lowered.nodes.frmval0011.rules?.[0]?.when;
  report.check(
    'the rule reads the box, lowercases it, and compares that',
    loweredWhen?.left?.kind === 'input' &&
      loweredWhen?.left?.name === 'code' &&
      loweredWhen?.left?.steps?.length === 1 &&
      loweredWhen.left.steps[0].op === 'lower' &&
      loweredWhen?.right?.value === 'yes',
    JSON.stringify(loweredWhen ?? null)
  );

  await publish(page);
  const typing = await ctx.newPage();
  await typing.goto(`${APP}/s/${projectId}/`, { waitUntil: 'load' });
  await typing.waitForTimeout(600);
  const verdict = typing.locator('p:has-text("Say yes")').first();
  const colourOf = () =>
    verdict.evaluate((el) => getComputedStyle(el).color).catch(() => 'unreadable');
  report.check(
    'before anything is typed the page shows what it shipped',
    (await colourOf()) === 'rgb(100, 100, 100)',
    await colourOf()
  );
  /*
   * `YES`, shouted. This is the case the whole stage is for: without the step
   * the comparison is exact and this does nothing, and the file is the same
   * file either way — the difference is one chip somebody could not reach
   * until now.
   */
  await typing.locator('input[name="code"]').fill('YES');
  await typing
    .waitForFunction(
      () => {
        const p = [...document.querySelectorAll('p')].find((one) =>
          (one.textContent ?? '').includes('Say yes')
        );
        return p ? getComputedStyle(p).color === 'rgb(0, 128, 0)' : false;
      },
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  report.check(
    'typing YES answers yes, which an exact comparison could not',
    (await colourOf()) === 'rgb(0, 128, 0)',
    await colourOf()
  );
  await typing.locator('input[name="code"]').fill('no');
  await typing.waitForTimeout(600);
  report.check(
    'and it is still a comparison rather than anything that is typed',
    (await colourOf()) === 'rgb(100, 100, 100)',
    await colourOf()
  );
  const liveMarkup = await typing.content();
  await typing.close();
  report.check(
    'the step travelled with the rule, because a control is not known at publish',
    liveMarkup.includes('data-cre8-test') && liveMarkup.includes('"op":"lower"'),
    liveMarkup.includes('"op":"lower"') ? 'the step is in the page' : 'the step did not travel'
  );
  /* ------------------------------- 10. E9: format, then put words after it */

  /*
   * `£900,000.00 per month`.
   *
   * Not a stage the plan named — it stops at E8 — but the one E7 found by
   * hitting it and E8's §5.7 named as what would close it. A `Format` is
   * applied on the way to the DOM, so anything after it is unsayable: the
   * suffix has to land on the *formatted* number, and until `written as` was a
   * step there was nowhere for it to go.
   */
  {
    const d = await getDocument(page, projectId);
    d.nodes.fmtval0014 = node('fmtval0014', 'paragraph', 'Per month', {
      parentId: 'crdval0002',
      props: { text: 'a rate' },
      styles: { desktop: { fontSize: '12px' } },
    });
    d.nodes.crdval0002.children.push('fmtval0014');
    await saveDocument(page, d);
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }

  const moneyPanel = await openContent('Per month');
  const moneyRow = moneyPanel.locator('[data-sentence]:has-text("Text reads")').first();
  await moneyRow.getByRole('button').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Price', exact: true }).last().click();
  await page.waitForTimeout(600);

  await moneyPanel.getByRole('button', { name: '+ maths' }).first().click();
  await page.waitForTimeout(500);
  await moneyPanel.getByRole('button', { name: '×', exact: true }).first().click();
  await page.waitForTimeout(300);
  const writtenAs = page.getByRole('button', { name: 'written as', exact: true });
  report.check(
    'a number can be asked to read the way a page would show it, mid-chain',
    (await writtenAs.count()) >= 1,
    `${await writtenAs.count()} entry in the step menu`
  );
  if (await writtenAs.count()) {
    await writtenAs.last().click();
    await page.waitForTimeout(600);
    // The format's own chips, at this point in the sentence rather than at the
    // end of it — the same builder the binding's tail uses.
    await moneyPanel.getByRole('button', { name: 'number', exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'currency', exact: true }).last().click();
    await page.waitForTimeout(600);
    await moneyRow.locator('input').first().fill('£');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    // And then the words, which is the whole point: they land after the money.
    await moneyPanel.getByRole('button', { name: '+ text' }).first().click();
    await page.waitForTimeout(500);
    await moneyRow.locator('input').last().fill(' per month');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
  }

  const formatted = await getDocument(page, projectId);
  const moneyValue = formatted.nodes.fmtval0014.bind?.text?.value;
  report.check(
    'the binding formats the number and then joins onto the result',
    moneyValue?.steps?.length === 2 &&
      moneyValue.steps[0].op === 'formatted' &&
      moneyValue.steps[0].as?.kind === 'currency' &&
      moneyValue.steps[0].as?.symbol === '£' &&
      moneyValue.steps[1].op === 'join' &&
      moneyValue.steps[1].with?.value === ' per month',
    JSON.stringify(moneyValue ?? null)
  );

  const moneyCanvas = await page.evaluate(() => {
    const el = document.querySelector('.cre8-frame.cre8-editing .c-fmtval0014');
    return el ? (el.textContent ?? '').trim() : 'no element';
  });
  report.check(
    'the canvas puts the words after the money, which a terminal format cannot',
    moneyCanvas === '£900,000.00 per month',
    moneyCanvas
  );

  await publish(page);
  const moneySite = await ctx.newPage();
  await moneySite.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await moneySite.waitForTimeout(600);
  const rates = await moneySite.evaluate(() =>
    [...document.querySelectorAll('h3')].map((heading) => {
      const said = [...(heading.parentElement?.querySelectorAll('p') ?? [])].map((one) =>
        (one.textContent ?? '').trim()
      );
      return said[said.length - 1];
    })
  );
  const moneyMarkup = await moneySite.content();
  await moneySite.close();
  report.check(
    'and the published file says it on every row',
    rates.length === 2 && rates.every((one) => one === '£900,000.00 per month'),
    rates.join(' · ')
  );
  /*
   * And the formatter stayed in the publisher.
   *
   * The precise claim, not "no runtime on the page" — this page carries E8's
   * live guard and rightly ships a test table for it. What must not be here is
   * the *formatted* step: it cannot travel, nothing offers it over a control,
   * and a page that carried one would be a page that had shipped the whole
   * formatter to answer a question nobody asks.
   */
  report.check(
    'with the formatter left in the publisher, where it costs a page nothing',
    !moneyMarkup.includes('"op":"formatted"') && !moneyMarkup.includes('£900,000.00 per month"'),
    moneyMarkup.includes('"op":"formatted"')
      ? 'a formatted step travelled'
      : `${(moneyMarkup.match(/data-cre8-test/g) ?? []).length} test attributes, none of them this`
  );
  /* ----------------------- 11. E10: every place a Value lives can say one */

  /*
   * §3.4 said every consumer of `Value` gets the whole vocabulary by doing
   * nothing. For a `ValueVar` that was false twice over: the panel was a
   * `Select` over number fields, and `varsFor` read `record.data[key]`
   * directly. Nine stages of vocabulary reached neither.
   *
   * So: `⟨Price⟩ ⟨÷ ⟨Rooms⟩⟩` mapped onto an opacity, authored in the panel,
   * with two rows coming out at different numbers — 900000÷4 and 900000÷5
   * against the same scale. A bare field could not separate them, because both
   * rows have the same price.
   */
  {
    const d = await getDocument(page, projectId);
    await saveDocument(page, d);
  }

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[data-layer-row]').first().isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('[data-layer-row]:has-text("Listing card")').first().click();
  await page.waitForTimeout(500);
  await openInspectorSection(page, 'Data');
  await page.waitForTimeout(400);

  const scalePanel = page.locator('aside').last();
  await scalePanel.getByRole('button', { name: '+ Value' }).first().click();
  await page.waitForTimeout(600);

  /*
   * The scale's own sentence, which is the same builder a binding uses — and
   * the menu it offers is narrowed by what a scale can *use*: a number, so no
   * `joined with` and no `written as`, both of which would compile here and
   * never resolve.
   */
  const scaleRow = scalePanel.locator('[data-sentence]').last();
  await scaleRow.getByRole('button', { name: '+ maths' }).first().click();
  await page.waitForTimeout(500);
  await scaleRow.getByRole('button', { name: '×', exact: true }).first().click();
  await page.waitForTimeout(300);
  const scaleMenu = (await page.locator('.anim-pop').last().innerText().catch(() => ''))
    .split('\n')
    .map((one) => one.trim())
    .filter(Boolean);
  report.check(
    'a scale offers the steps that leave it a number, and not the ones that do not',
    scaleMenu.includes('×') &&
      scaleMenu.includes('rounded to') &&
      !scaleMenu.includes('joined with') &&
      !scaleMenu.includes('written as'),
    scaleMenu.join(' · ') || 'nothing offered'
  );
  await page.getByRole('button', { name: '÷', exact: true }).last().click();
  await page.waitForTimeout(500);
  await scaleRow.getByRole('button', { name: 'Use a number from the record' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Rooms', exact: true }).last().click();
  await page.waitForTimeout(600);

  const withScale = await getDocument(page, projectId);
  const spec = Object.values(withScale.nodes.crdval0002.vars ?? {})[0];
  report.check(
    'the scale reads a chain, which its picker could never write before',
    spec?.value?.kind === 'field' &&
      spec.value.key === 'price' &&
      spec.value.steps?.[0]?.op === 'over' &&
      spec.value.steps[0].by?.key === 'rooms',
    JSON.stringify(spec?.value ?? null)
  );

  /*
   * `from` defaults to [0, 100], which every row overshoots — so the scale is
   * pointed at the span the data actually covers before anything is measured.
   * Written straight to the document: the two number pairs are ordinary
   * inputs that predate this stage and are not what is under test.
   */
  let scaleKey = '';
  {
    const d = await getDocument(page, projectId);
    scaleKey = Object.keys(d.nodes.crdval0002.vars ?? {})[0] ?? '';
    if (scaleKey) d.nodes.crdval0002.vars[scaleKey].from = [0, 300000];
    // The card styles itself with whatever the panel named the property —
    // read out rather than assumed, because `+ Value` names it after the
    // field and a check that guessed would be checking its own guess.
    d.nodes.crdval0002.styles.desktop = {
      ...d.nodes.crdval0002.styles.desktop,
      opacity: `var(--cre8-${scaleKey})`,
    };
    await saveDocument(page, d);
  }

  await publish(page);
  const fadeSite = await ctx.newPage();
  await fadeSite.goto(`${APP}/s/${projectId}/`, { waitUntil: 'domcontentloaded' });
  await fadeSite.waitForTimeout(600);
  const fades = await fadeSite.evaluate(
    (key) =>
      [...document.querySelectorAll('h3')].map(
        (heading) =>
          (heading.parentElement?.getAttribute('style') ?? '').match(
            new RegExp(`--cre8-${key}:\\s*([\\d.]+)`)
          )?.[1]
      ),
    scaleKey
  );
  await fadeSite.close();
  report.check(
    'and the two rows come out at different numbers, which the same price could not do',
    fades.length === 2 && fades[0] === '0.75' && fades[1] === '0.6',
    fades.join(' · ') || 'no custom property on either row'
  );
} catch (error) {
  report.check('values suite completed', false, String(error?.message ?? error));
} finally {
  await browser.close();
}

report.finish();
