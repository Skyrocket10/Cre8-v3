/**
 * Does an edit reach the element it was made on, and does it survive?
 *
 * Three bugs, one theme: the editor decided *what to write to* at the moment
 * the write happened rather than at the moment the value was shown, and by
 * then the answer had changed.
 *
 *   • An inspector field commits on blur. Clicking another element changes the
 *     selection first and blurs the field second, so a half-typed value landed
 *     on an element nobody had touched.
 *   • The same field, on the way back: the element you *were* editing kept its
 *     old value, so the control looked like it had done nothing.
 *   • Inline text on the canvas is a `contentEditable` that commits on blur —
 *     and clicking elsewhere unmounts it, which fires no blur at all. Enter
 *     was the only way to keep an edit.
 *
 * All three are invisible to a check that edits one element in isolation, so
 * every check here involves two: one to edit, one to move to.
 */

import {
  APP,
  createReport,
  getDocument,
  launch,
  node,
  READY_TIMEOUT,
  saveDocument,
  signUp,
} from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** Two headings, so every check has somewhere wrong to land. */
function seed(doc) {
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];
  Object.assign(doc.nodes, {
    headingone: node('headingone', 'heading', 'First', {
      parentId: home.rootNodeId,
      props: { text: 'First heading', level: 2 },
      styles: { desktop: { color: '#111827', fontSize: '28px' } },
    }),
    headingtwo: node('headingtwo', 'heading', 'Second', {
      parentId: home.rootNodeId,
      props: { text: 'Second heading', level: 2 },
      styles: { desktop: { color: '#111827', fontSize: '28px' } },
    }),
  });
  root.children = ['headingone', 'headingtwo'];
  return doc;
}

const propsOf = (id) =>
  page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    const { document: doc } = await r.json();
    // `name` is a field on the node, not a prop — a distinction this reader
    // got wrong first time and reported as a failing fix.
    return {
      one: { ...doc.nodes.headingone?.props, name: doc.nodes.headingone?.name },
      two: { ...doc.nodes.headingtwo?.props, name: doc.nodes.headingtwo?.name },
      oneStyles: doc.nodes.headingone?.styles?.desktop ?? {},
      twoStyles: doc.nodes.headingtwo?.styles?.desktop ?? {},
    };
  }, id);

/**
 * Select by name in the layer tree — the canvas overlay eats direct clicks.
 *
 * The tab is only clicked when the tree is *not* already showing. Layers is the
 * panel that opens by default, so clicking its tab unconditionally closes it,
 * and then nothing is selectable at all. Cost an afternoon once already in
 * `editor-perf`.
 */
const showLayers = async () => {
  if (await page.locator('[data-layer-row]').first().isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Layers"]').first().click();
  await page.waitForTimeout(300);
};

const selectLayer = async (name) => {
  await showLayers();
  await page.locator(`[data-layer-row]:has-text("${name}")`).first().click();
  await page.waitForTimeout(350);
};

/**
 * Click an element **on the canvas**, at its centre, with the real mouse.
 *
 * This distinction is the whole suite. A layer row selects on `click`, which
 * the browser fires *after* it has already blurred whatever had focus — so the
 * inspector's write happens while the old element is still selected and
 * everything looks fine. The canvas selects on `pointerdown`, which fires
 * *before* the blur. That ordering is the bug, and a check that moves between
 * elements through the layer tree cannot see it: this suite passed against the
 * unfixed editor until these gestures were changed.
 *
 * `page.mouse` rather than `locator.click()` because the selection overlay sits
 * over the canvas and Playwright's actionability check refuses to click
 * through it. A person's pointer has no such scruples.
 */
const clickOnCanvas = async (nodeId) => {
  const at = await page.evaluate((id) => {
    const el = document.querySelector(`.cre8-frame.cre8-editing [data-cre8-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, nodeId);
  if (!at) throw new Error(`no canvas element for ${nodeId}`);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(700);
};

try {
  await signUp(page, 'Ida Inspector', 'insp');
  await page.locator('button:has-text("Blank")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1200);

  const saved = await saveDocument(page, seed(await getDocument(page, id)));
  if (!report.check('the two headings seeded', saved === 200, `HTTP ${saved}`)) {
    throw new Error(`could not seed (HTTP ${saved})`);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1200);

  /* ------------------------------------------------ 1. a field does apply -- */

  /*
   * The Content section's Text field, deliberately — not the name field at the
   * top of the inspector, which already passed its element's id explicitly and
   * was never affected. Two checks written against it looked like they were
   * testing the fix and were testing the one control that never had the bug.
   */
  // The Content section's textarea. It has no label — it *is* the section —
  // and it commits on blur through `useNodeProp`, which is the path the bug
  // lived on.
  const textField = () => page.locator('aside textarea').first();

  await selectLayer('First');
  await textField().click();
  await textField().fill('Applied straight away');
  await textField().press('Tab');
  await page.waitForTimeout(700);

  /*
   * A guard rather than a demonstration, and worth marking as one: this path
   * commits before the canvas handler runs on the current build, so it passed
   * against the unfixed editor too. The style check below is the one that
   * reproduces the ordering. Kept because the two paths are one line apart in
   * `use-style.ts` and there is no reason for only one of them to be right.
   */
  report.check(
    'an inspector field applies to the element it is showing',
    (await propsOf(id)).one.text === 'Applied straight away',
    `first heading says “${(await propsOf(id)).one.text}”`
  );

  /* ------------------------------- 2. and does not follow the selection --- */

  /*
   * The bug, reproduced exactly: type into a field, then click another element
   * *without leaving the field first*. The click changes the selection and
   * then blurs the field, and a writer that asks "what is selected?" at that
   * moment writes to the wrong element.
   */
  await selectLayer('First');
  const before = await propsOf(id);

  const heading = textField();
  await heading.click();
  await heading.fill('Typed on the first');
  // No blur, no Tab — straight to the other element on the canvas, which is
  // what a person does and what the old code got wrong.
  await clickOnCanvas('headingtwo');

  const after = await propsOf(id);
  report.check(
    'a pending edit lands on the element it was typed on',
    after.one.text === 'Typed on the first',
    `first heading says “${after.one.text}” (was “${before.one.text}”)`
  );
  report.check(
    'and the element selected afterwards is left alone',
    after.two.text === 'Second heading',
    `second heading says “${after.two.text}”`
  );

  /* --------------------------------- 3. a style write is targeted too ----- */

  await selectLayer('Second');
  const fontField = page
    .locator('aside')
    .locator('label:text-is("Size")')
    .locator('xpath=following::input[1]')
    .first();
  if (await fontField.count()) {
    await fontField.click();
    await fontField.fill('44');
    await clickOnCanvas('headingone');

    const styled = await propsOf(id);
    report.check(
      'a style typed on one element does not land on the next one selected',
      styled.oneStyles.fontSize === '28px',
      `first heading is ${styled.oneStyles.fontSize}, second is ${styled.twoStyles.fontSize}`
    );
  } else {
    report.check('a size field is reachable to test', false, 'no Size input found');
  }

  /* ----------------------------- 4. inline text survives a click away ----- */

  await selectLayer('Second');
  await page.waitForTimeout(300);

  // Enter opens the caret on the selected element, which is the documented way
  // in and avoids fighting the canvas overlay for a double-click.
  await page.locator('.cre8-frame.cre8-editing').click({ position: { x: 5, y: 5 } });
  await selectLayer('Second');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  const editing = await page.locator('[data-cre8-editing="true"]').count();
  report.check('pressing Enter opens the caret on the canvas', editing === 1, `${editing} editors`);

  if (editing === 1) {
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Clicked away, not lost');
    await page.waitForTimeout(200);

    /*
     * Click another element rather than pressing Enter.
     *
     * Also a guard rather than a demonstration: on this build the caret's blur
     * beats the unmount and the edit survives either way. What the unmount
     * commit closes is the set of routes that fire *no* blur at all — the node
     * being deleted, the page changing, the element's variant moving out from
     * under it — and this at least holds the ordinary route still.
     */
    await clickOnCanvas('headingone');

    const committed = await propsOf(id);
    report.check(
      'clicking another element commits the text instead of dropping it',
      committed.two.text === 'Clicked away, not lost',
      `second heading says “${committed.two.text}”`
    );
    report.check(
      'and it commits onto the element that was being edited',
      committed.one.text !== 'Clicked away, not lost',
      `first heading says “${committed.one.text}”`
    );
  }

  /* ------------------------------- 5. a component outlives the session ---- */

  /*
   * Reported as broken and not reproducible, so pinned rather than fixed. A
   * component is part of the document, the document is what gets saved, and
   * this is the check that says so on every run.
   */
  await selectLayer('First');
  await page.locator('button[aria-label="Components"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Create")').first().click();
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1800);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  const survived = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    const { document: doc } = await r.json();
    return (doc.components ?? []).map((c) => ({
      name: c.name,
      master: Boolean(doc.nodes[c.rootNodeId]),
      instances: Object.values(doc.nodes).filter(
        (n) => n.type === 'instance' && n.props.componentId === c.id
      ).length,
    }));
  }, id);

  report.check(
    'a component made in one session is still there in the next',
    survived.length === 1 && survived[0].master && survived[0].instances === 1,
    JSON.stringify(survived)
  );

  await page.locator('button[aria-label="Components"]').first().click();
  await page.waitForTimeout(500);
  // Scoped to the panel by its region label rather than to "an aside", which
  // on this screen is just as likely to be the inspector.
  const panel = page.locator('[role="region"][aria-label="Components panel"]');
  const listed = (await panel.innerText().catch(() => '')).replace(/\s+/g, ' ');
  report.check(
    'and the panel lists it when the project opens',
    listed.includes(survived[0]?.name ?? 'no-such-component'),
    listed.slice(0, 120) || 'no components panel on screen'
  );
} catch (error) {
  report.check('inspector suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
