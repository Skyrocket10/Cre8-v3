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
 *
 * Section 7 is a different claim about the same panel — not "does the write
 * land" but "is what it says about the element true". A rule reading an element
 * that has since been deleted keeps working the only way it can, which is not
 * at all, and the panel has to say so rather than render the rule as if it were
 * fine. Nothing outside a browser can check that: the warning is derived at
 * render time from the document, so the document alone does not contain it.
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

/**
 * A repeater holding two state rules that differ in one way.
 *
 * Both read an element rather than a record field, both carry the same key and
 * the same Otherwise; one names a node that is in the document and the other
 * names one that never was. That is the state a deletion leaves behind —
 * cleanup clears reference *slots* and leaves expressions alone on purpose, so
 * the rule survives its element and answers "don't know" forever.
 *
 * The repeater is not decoration: a state rule reads the record in scope, and
 * the panel that shows it does not appear at all for an element with no record
 * above it.
 */
function brokenRule(doc) {
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];
  doc.collections = [
    { id: 'signups', name: 'Signups', fields: [{ key: 'email', label: 'Email', type: 'text' }] },
  ];
  const badge = (id, name, reads) =>
    node(id, 'text', name, {
      parentId: 'signuplist',
      props: { text: 'Ready', switchKey: 'form', switchDefault: 'idle' },
      assign: [
        {
          id: `rule-${id}`,
          when: { kind: 'compare', left: { kind: 'element', ref: { node: reads } }, op: 'notEmpty' },
          value: 'ready',
        },
      ],
    });
  Object.assign(doc.nodes, {
    emailbox: node('emailbox', 'input', 'Email box', {
      parentId: home.rootNodeId,
      props: { name: 'email', placeholder: 'you@example.com' },
    }),
    signuplist: node('signuplist', 'section', 'Signup list', {
      parentId: home.rootNodeId,
      children: ['brokenbadge', 'workingbadge', 'nestedbadge'],
      repeat: { collection: 'signups' },
    }),
    brokenbadge: badge('brokenbadge', 'Status badge', 'no-such-node'),
    workingbadge: badge('workingbadge', 'Working badge', 'emailbox'),
    /*
     * The third case, and the one that decides whether "cannot be named" and
     * "is not there" are the same question. This rule reads a control *inside*
     * the element that owns it — reachable by picking one from the page and
     * then dragging it in — which works at runtime and which the source picker
     * deliberately does not offer, because a control inside the node is offered
     * by name instead. Answer the label from the offer list alone and this rule
     * is accused of reading something deleted while the warning stays silent.
     */
    nestedbadge: {
      ...badge('nestedbadge', 'Nested badge', 'nestedinput'),
      type: 'section',
      children: ['nestedinput'],
    },
    nestedinput: node('nestedinput', 'input', 'Nested input', {
      parentId: 'nestedbadge',
      props: { name: 'nested' },
    }),
  });
  root.children = [...root.children, 'emailbox', 'signuplist'];
  return doc;
}

/**
 * A one-cell table, for the `only` gate.
 *
 * Small on purpose: the claim is about which rows the inspector offers, not
 * about tables, and the smallest thing with both a table and a cell in it is
 * the honest fixture for that.
 */
function aTable(doc) {
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];
  Object.assign(doc.nodes, {
    pricetable: node('pricetable', 'table', 'Price table', {
      parentId: home.rootNodeId,
      children: ['pricerow'],
    }),
    pricerow: node('pricerow', 'tableRow', 'First row', {
      parentId: 'pricetable',
      children: ['pricecell'],
    }),
    pricecell: node('pricecell', 'tableCell', 'First cell', {
      parentId: 'pricerow',
      props: { text: 'Free' },
    }),
  });
  root.children = [...root.children, 'pricetable'];
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
  /* --------------------------- 6. an overlay is a place you can be in ---- */

  /*
   * A popover sits over the page it belongs to, so "which of these two did you
   * mean" is a question the editor had no way to answer: an element inserted
   * while a panel was open landed on the page behind it.
   */
  await page.locator('button[aria-label="Insert"]').first().click();
  const popoverCard = page.locator('button:has(span:text-is("Mega menu"))').first();
  await popoverCard.waitFor({ state: 'visible', timeout: 8000 });
  await popoverCard.click();
  await page.waitForTimeout(1400);

  const overlayId = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    const { document: doc } = await r.json();
    return Object.values(doc.nodes).find((n) => n.type === 'popover')?.id ?? null;
  }, id);
  report.check('a block with a popover in it is on the page', Boolean(overlayId), overlayId ?? 'none');

  if (overlayId) {
    // In through the canvas, the same double-click that goes into a component.
    await clickOnCanvas(overlayId);
    await page.mouse.dblclick(
      ...(await page.evaluate((nid) => {
        const el = document.querySelector(`.cre8-frame.cre8-editing [data-cre8-id="${nid}"]`);
        const r = el.getBoundingClientRect();
        return [r.left + 8, r.top + 8];
      }, overlayId))
    );
    await page.waitForTimeout(700);

    const scoped = await page.evaluate(() =>
      Boolean(document.querySelector('button[aria-label="Stop editing this overlay"]'))
    );
    report.check('double-clicking it enters its editing context', scoped, scoped ? 'breadcrumb shown' : 'no breadcrumb');

    // The claim: what gets inserted lands inside the overlay, not on the page.
    const before = await page.evaluate(async (pid) => {
      const r = await fetch(`/api/projects/${pid}`, { credentials: 'include', headers: { 'x-cre8-csrf': '1' } });
      const { document: doc } = await r.json();
      return Object.keys(doc.nodes).length;
    }, id);

    // The `h` shortcut rather than the Insert panel's element list: it goes
    // through the same `insertElement` the panel does, and it does not depend
    // on how the panel happens to render its rows.
    await page.locator('.cre8-frame.cre8-editing').click({ position: { x: 4, y: 4 }, force: true });
    await page.waitForTimeout(200);
    await page.keyboard.press('h');
    await page.waitForTimeout(1100);

    const placed = await page.evaluate(
      async ([pid, oid, was]) => {
        const r = await fetch(`/api/projects/${pid}`, { credentials: 'include', headers: { 'x-cre8-csrf': '1' } });
        const { document: doc } = await r.json();
        const added = Object.keys(doc.nodes).length - was;
        // Walk up from every new-looking heading and see which tree it is in.
        const inside = Object.values(doc.nodes).filter((n) => {
          if (n.type !== 'heading') return false;
          let cur = n.parentId;
          for (let i = 0; cur && i < 200; i++) {
            if (cur === oid) return true;
            cur = doc.nodes[cur]?.parentId ?? null;
          }
          return false;
        }).length;
        return { added, inside };
      },
      [id, overlayId, before]
    );
    report.check(
      'and an element inserted while it is open lands inside it',
      placed.added > 0 && placed.inside > 0,
      `${placed.added} nodes added, ${placed.inside} heading(s) inside the overlay`
    );

    // Out again, and the page is reachable once more.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const stillScoped = await page.evaluate(() =>
      Boolean(document.querySelector('button[aria-label="Stop editing this overlay"]'))
    );
    report.check('and Escape unwinds back out to the page', !stillScoped, stillScoped ? 'still scoped' : 'back on the page');
  }

  /* ------------------------- 7. the panel says a rule is broken ----------- */

  /*
   * Seeded rather than built through the panel, and that is a limit worth
   * naming: what this proves is that the editor *reports* a rule reading an
   * element that is not in the document, not that deleting an element in the
   * editor produces one. The second is the static suite's — it drives the real
   * `removeNodes` and asserts the rule survives and is reported. Between them
   * the route is covered end to end; neither half covers it alone.
   *
   * The rule needs a record in scope to be shown at all, so the fixture is a
   * repeater with one element inside it, and the element reads a node id that
   * was never in the document. That is the same state a deletion leaves behind
   * — `pruneRefs` clears slots and deliberately leaves expressions alone.
   */
  const broken = await saveDocument(page, brokenRule(await getDocument(page, id)));
  report.check('the broken rule seeded', broken === 200, `HTTP ${broken}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  /*
   * The Data section alone, not the whole inspector: Content and Style hold
   * sentences of their own, and a check reading the column would be matching
   * words it never meant to look at.
   */
  const dataSection = async (layer) => {
    await selectLayer(layer);
    const section = page
      .locator('aside')
      .last()
      .locator('section:has(> div .panel-title:text-is("Data"))');
    return (await section.innerText().catch(() => '')).replace(/\s+/g, ' ');
  };

  const said = await dataSection('Status badge');
  report.check(
    'a rule whose element is gone is reported, not drawn as if it worked',
    /element this reads is gone/i.test(said),
    said.slice(0, 260) || 'no Data section on screen'
  );
  report.check(
    'and it says what the element falls back to instead',
    /stays idle/i.test(said),
    // The fixture's Otherwise. A warning that stops at "this is broken" leaves
    // the designer to work out what the page is doing now instead.
    /stays [a-z ]+/i.exec(said)?.[0] ?? 'no fallback named'
  );
  report.check(
    'and the sentence above it reads as broken rather than as unset',
    said.includes('a deleted element') && !said.includes('When a field'),
    // The chip falls through to its placeholder when no option matches its
    // value, so the sentence used to say "When ⟨a field⟩ is not empty" — a rule
    // nobody has finished, printed beside a warning that one is broken. Two
    // diagnoses of one rule, in one panel, and only one of them true.
    /When [^\n]{0,40}/.exec(said)?.[0] ?? 'no sentence'
  );

  /* Each of the above, handed something it must reject. */
  const working = await dataSection('Working badge');
  report.check(
    'a rule whose element is there draws no warning',
    // Same panel, same shape of rule, one difference: the element exists. Every
    // check above would pass against a panel that warned about every rule it
    // was ever shown, and this is what says it does not.
    working.includes('State from the record') && !/element this reads is gone/i.test(working),
    working.slice(0, 200) || 'no Data section on screen'
  );
  report.check(
    'and names it, so the two sentences differ by more than the warning',
    working.includes('Email box') && !working.includes('a deleted element'),
    /When [^\n]{0,40}/.exec(working)?.[0] ?? 'no sentence'
  );

  const nested = await dataSection('Nested badge');
  report.check(
    'a rule reading a control the picker does not offer is named, not accused',
    nested.includes('Nested input') && !nested.includes('a deleted element'),
    // "Cannot be offered" and "is not there" are different questions, and the
    // panel answers the label from the first while the warning answers from the
    // second. Conflate them and this working rule reads as broken.
    /When [^\n]{0,40}/.exec(nested)?.[0] ?? 'no sentence'
  );
  report.check(
    'and draws no warning either',
    !/element this reads is gone/i.test(nested),
    'the two halves agree about the same rule'
  );

  /*
   * And the join: delete the element here, in the editor, and watch the rule
   * that read it change its mind. Everything above is seeded, which proves the
   * panel reports the state and says nothing about how a person arrives at it —
   * and "I deleted the box, why did my form stop working?" is the whole reason
   * the warning exists. No reload: the panel derives this from the store, so if
   * it needed one that would be the bug.
   */
  await selectLayer('Email box');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(800);
  const afterDelete = await dataSection('Working badge');
  report.check(
    'deleting the element in the editor turns the rule that read it broken, there and then',
    /element this reads is gone/i.test(afterDelete) && afterDelete.includes('a deleted element'),
    afterDelete.slice(0, 240) || 'no Data section on screen'
  );
  /* ------------------- 8. a row that nobody wrote by hand ---------------- */

  /*
   * The vocabulary's claim, at the only place it can be tested: the screen.
   *
   * A property with a table entry is supposed to become a working row — one
   * that reads the effective value, writes the document, and resets. Nothing in
   * the static suite can say whether that happened; it can only say a section
   * renders `<StyleFields>`. So this drives three of them, chosen because they
   * are three different control kinds and all three were unreachable before:
   * a switch (italic), a menu (blend), and the grid span that made every
   * template's grid uniform.
   */
  await selectLayer('Second');
  await page.waitForTimeout(300);

  const styleOf = async (nodeId) =>
    page.evaluate(
      async ([pid, nid]) => {
        const r = await fetch(`/api/projects/${pid}`, {
          credentials: 'include',
          headers: { 'x-cre8-csrf': '1' },
        });
        const { document: doc } = await r.json();
        return doc.nodes[nid]?.styles?.desktop ?? {};
      },
      [id, nodeId]
    );

  const rowFor = (label) =>
    page.locator('aside').last().locator(`label:text-is("${label}")`).locator('xpath=../..');

  // Italic — a `switch`, where off is the absence of the declaration rather
  // than `normal`, because writing `normal` in a narrow breakpoint would pin
  // the property and stop the base layer ever reaching it again.
  const italic = rowFor('Italic').locator('button[role="switch"]');
  report.check(
    'a property with only a table entry still gets a row',
    (await italic.count()) === 1,
    // Typography had no italic at all before the table: not a decision, just a
    // row nobody had written.
    `${await italic.count()} Italic switch(es) in the inspector`
  );

  if (await italic.count()) {
    await italic.first().click();
    await page.waitForTimeout(700);
    report.check(
      'and the row writes the document',
      (await styleOf('headingtwo')).fontStyle === 'italic',
      JSON.stringify((await styleOf('headingtwo')).fontStyle ?? null)
    );

    await italic.first().click();
    await page.waitForTimeout(700);
    report.check(
      'and turning it off removes the declaration rather than writing the other value',
      (await styleOf('headingtwo')).fontStyle === undefined,
      // `normal` would pin the property. Absent is the only spelling of "off"
      // that a wider breakpoint can still speak through.
      JSON.stringify((await styleOf('headingtwo')).fontStyle ?? null)
    );
  }

  // Spans across — the control the whole grid gap comes down to. A number on
  // screen, `span 2` in the document.
  await page.locator('aside').last().locator('button:has-text("In parent")').first().click();
  await page.waitForTimeout(400);
  const span = rowFor('Spans across').locator('input').first();
  report.check(
    'the grid span control is a count, not a CSS phrase',
    (await span.count()) === 1 && (await span.inputValue()) === '1',
    // Every grid in all eight templates is a uniform `repeat(n, 1fr)`, because
    // until this row a child could not be told to cover two cells.
    `${await span.count()} field(s), showing “${await span.inputValue().catch(() => '')}”`
  );

  if (await span.count()) {
    await span.fill('2');
    await span.press('Enter');
    await page.waitForTimeout(700);
    report.check(
      'and it writes the phrase CSS actually wants',
      (await styleOf('headingtwo')).gridColumn === 'span 2',
      JSON.stringify((await styleOf('headingtwo')).gridColumn ?? null)
    );
  }

  /* Each of the above, handed something it must reject. */

  /*
   * The `only` gate, tested where it actually does work.
   *
   * The first version of this asserted that a heading has no "Focal point" row
   * and passed with the gate switched off — a heading never renders that
   * section at all, so nothing was ever gated. Vacuous, and it took a
   * deliberate break to find out.
   *
   * A table is the one place the gate carries weight: the Table section and the
   * Cell section make the *same* `<StyleFields section="table" />` call, and
   * which rows appear is decided by `only` alone.
   */
  const withTable = await saveDocument(page, aTable(await getDocument(page, id)));
  report.check('a table seeded', withTable === 200, `HTTP ${withTable}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  await selectLayer('Price table');
  const onTable = {
    widths: await rowFor('Widths').count(),
    vertically: await rowFor('Vertically').count(),
  };
  await selectLayer('First cell');
  const onCell = {
    widths: await rowFor('Widths').count(),
    vertically: await rowFor('Vertically').count(),
  };

  report.check(
    'one call to the table renders different rows on a table and on a cell',
    onTable.widths === 1 && onTable.vertically === 0 &&
      onCell.widths === 0 && onCell.vertically === 1,
    // Without the gate every element carries every row, which is the panel the
    // table exists to avoid — and the same call site would have to be four
    // hand-written ones again.
    `table: ${JSON.stringify(onTable)} · cell: ${JSON.stringify(onCell)}`
  );
} catch (error) {
  report.check('inspector suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
