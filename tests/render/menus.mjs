/**
 * Right-click, and does the thing that happens match every other way of asking?
 *
 * The requirement this suite exists for is not "there is a menu". It is that
 * the menu holds no actions of its own — that Duplicate from the menu and ⌘D
 * from the keyboard are the same command reaching the same store. A menu that
 * quietly reimplements Duplicate looks identical until the day the two
 * definitions disagree, so the checks here compare the *results* of the two
 * routes rather than trusting that they share a module.
 *
 * The rest is the behaviour a menu has to get right to be usable at all:
 * it opens where the pointer is, stays on screen, does not steal a
 * multi-selection, closes on Escape and on a press outside without also
 * selecting whatever was under that press, and can be driven from the keyboard.
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

/**
 * A frame holding three boxes, and a popover elsewhere on the page.
 *
 * Three rather than two: Distribute needs a middle one to move, and Arrange
 * needs somewhere for a block to move *to* that is not simply the other end.
 */
function seed(doc) {
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];
  Object.assign(doc.nodes, {
    holder: node('holder', 'frame', 'Holder', {
      parentId: home.rootNodeId,
      children: ['boxa', 'boxb', 'boxc'],
      // Longhands, because that is what the editor writes and what the box
      // model reads. A shorthand here would make the padding row's Reset
      // correctly unavailable and the check unhelpfully mysterious.
      styles: {
        desktop: {
          position: 'relative',
          height: '320px',
          paddingTop: '20px',
          paddingRight: '20px',
          paddingBottom: '20px',
          paddingLeft: '20px',
        },
      },
    }),
    boxa: node('boxa', 'heading', 'Box A', {
      parentId: 'holder',
      props: { text: 'Box A', level: 3 },
      styles: { desktop: { position: 'absolute', left: '20px', top: '30px' } },
    }),
    boxb: node('boxb', 'heading', 'Box B', {
      parentId: 'holder',
      props: { text: 'Box B', level: 3 },
      styles: { desktop: { position: 'absolute', left: '160px', top: '90px' } },
    }),
    boxc: node('boxc', 'heading', 'Box C', {
      parentId: 'holder',
      props: { text: 'Box C', level: 3 },
      styles: { desktop: { position: 'absolute', left: '380px', top: '160px' } },
    }),
    tail: node('tail', 'paragraph', 'Tail', {
      parentId: home.rootNodeId,
      props: { text: 'Ordinary paragraph in the flow' },
    }),
  });
  root.children = ['holder', 'tail'];
  return doc;
}

/**
 * What the layer tree says is selected, by name.
 *
 * Read from the DOM rather than from a test hook on the store: the claims here
 * are about what the person can see, and a hook would also be a way for the
 * suite to reach past the interface it is supposed to be exercising.
 */
const selectedNames = () =>
  page.$$eval('[data-layer-row][data-selected]', (rows) =>
    rows.map((r) => r.textContent?.trim().split('\n')[0] ?? '')
  );

/**
 * What the canvas is actually drawing, which is the only copy that is current.
 *
 * `/api/projects/:id` is behind a debounce and, in a live room, behind the
 * Durable Object's flush as well. Reading it straight after a keystroke gets
 * an older document and reports it as a failed action — which is exactly what
 * it did here, twice, before these two helpers replaced it.
 */
const childOrder = (parentId) =>
  page.$$eval(
    `.cre8-frame.cre8-editing [data-cre8-id="${parentId}"] > [data-cre8-id]`,
    (nodes) => nodes.map((n) => n.getAttribute('data-cre8-id'))
  );

/**
 * How many elements the canvas is drawing, read once it has stopped changing.
 *
 * A fixed sleep is not enough and the difference is not academic: with a menu
 * deliberately firing Duplicate twice, a single read 700ms after the click saw
 * only the first one and the parity check passed against a menu that was
 * demonstrably doing the wrong thing. Two agreeing reads, or the number is
 * still in motion and this is not the moment to judge it.
 */
const drawnCount = async () => {
  let previous = -1;
  for (let i = 0; i < 20; i++) {
    const now = await page.locator('.cre8-frame.cre8-editing [data-cre8-id]').count();
    if (now === previous) return now;
    previous = now;
    await page.waitForTimeout(150);
  }
  return previous;
};

const paddingOf = (nodeId) =>
  page.evaluate((id) => {
    const el = document.querySelector(`.cre8-frame.cre8-editing [data-cre8-id="${id}"]`);
    return el ? getComputedStyle(el).paddingTop : null;
  }, nodeId);

const showLayers = async () => {
  if (await page.locator('[data-layer-row]').first().isVisible().catch(() => false)) return;
  await page.locator('button[aria-label="Layers"]').first().click();
  await page.waitForTimeout(300);
};

const selectLayer = async (name, modifier) => {
  await showLayers();
  const row = page.locator(`[data-layer-row]:has-text("${name}")`).first();
  await row.click(modifier ? { modifiers: [modifier] } : undefined);
  await page.waitForTimeout(300);
};

const centreOf = (nodeId) =>
  page.evaluate((id) => {
    const el = document.querySelector(`.cre8-frame.cre8-editing [data-cre8-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, nodeId);

/** Right-click an element on the canvas, the way a person does. */
const rightClick = async (nodeId) => {
  const at = await centreOf(nodeId);
  if (!at) throw new Error(`no canvas element for ${nodeId}`);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await page.waitForTimeout(150);
  return at;
};

// `[data-menu-item]` rather than `[role="menuitem"]`: a row that reports a
// setting is a `menuitemcheckbox`, which is the correct role and not that one.
const menuLabels = () =>
  page.$$eval('[role="menu"] [data-menu-item]', (nodes) =>
    nodes.map((n) => n.getAttribute('data-menu-item') ?? '')
  );

const clickItem = async (label) => {
  const row = page.locator(`[data-menu-item="${label}"]`).first();
  // Say so plainly rather than spending thirty seconds finding out: a disabled
  // row has `pointer-events: none`, so clicking it just times out.
  if (await row.isDisabled()) throw new Error(`menu item "${label}" is disabled`);
  await row.click();
  await page.waitForTimeout(700);
};

const closeMenu = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
};

try {
  await signUp(page, 'Mona Menu', 'menu');
  await page.locator('button:has-text("Blank")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1200);

  const saved = await saveDocument(page, seed(await getDocument(page, id)));
  if (!report.check('the fixture seeded', saved === 200, `HTTP ${saved}`)) {
    throw new Error(`could not seed (HTTP ${saved})`);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1400);

  /* ------------------------------------------------ 1. it opens, and where -- */

  const at = await rightClick('boxa');
  const box = await page.evaluate(() => {
    const el = document.querySelector('[role="menu"]');
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  report.check(
    'the menu opens at the pointer',
    Math.abs(box.x - at.x) < 24 && Math.abs(box.y - at.y) < 24,
    `menu at ${Math.round(box.x)},${Math.round(box.y)} for a click at ${at.x},${at.y}`
  );

  const labels = await menuLabels();
  report.check(
    'and it is about the element that was clicked',
    labels.includes('Duplicate') && labels.includes('Delete') && labels.includes('Edit text'),
    `${labels.length} items: ${labels.slice(0, 6).join(', ')}…`
  );
  report.check(
    'with the shortcut printed beside the action it runs',
    await page.evaluate(() => {
      const row = document.querySelector('[data-menu-item="Duplicate"]');
      return /[⌘]D|Ctrl\+D/.test(row?.textContent ?? '');
    }),
    'Duplicate shows its chord'
  );

  const separated = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const kids = [...menu.children];
    const del = kids.findIndex((k) => k.getAttribute?.('data-menu-item') === 'Delete');
    return del > 0 && kids[del - 1]?.getAttribute('role') === 'separator';
  });
  report.check('and Delete kept apart from what sits above it', separated, 'separator before Delete');

  await closeMenu();
  report.check(
    'Escape closes it',
    (await page.locator('[role="menu"]').count()) === 0,
    'no menu in the DOM'
  );

  /* ----------------------------------- 2. the same command, two ways in --- */

  /*
   * The architecture requirement, checked by result rather than by reading the
   * imports: duplicate once with the keyboard and once with the menu, and the
   * document must gain the same thing both times.
   */
  await selectLayer('Box A');
  const before = await drawnCount();

  await page.keyboard.press('Control+d');
  await page.waitForTimeout(700);
  const afterKeyboard = await drawnCount();

  await selectLayer('Box A');
  await rightClick('boxa');
  await clickItem('Duplicate');
  const afterMenu = await drawnCount();

  report.check(
    'Duplicate from the keyboard and from the menu do the same thing',
    afterKeyboard - before > 0 && afterKeyboard - before === afterMenu - afterKeyboard,
    `keyboard added ${afterKeyboard - before}, menu added ${afterMenu - afterKeyboard}`
  );

  /*
   * And one undo step each, which is the part that goes wrong when a surface
   * writes its own transaction: two `set` calls where the shared action makes
   * one, and Ctrl+Z stops matching what happened.
   */
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const undoneOnce = await drawnCount();
  report.check(
    'and one undo walks back exactly one of them',
    undoneOnce === afterKeyboard,
    `${afterMenu} → ${undoneOnce}, expected ${afterKeyboard}`
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  report.check(
    'and a second undo walks back the other',
    (await drawnCount()) === before,
    `back to ${await drawnCount()}, started at ${before}`
  );

  /* ---------------------------------------- 3. it does not steal selection -- */

  await selectLayer('Box A');
  await selectLayer('Box B', 'Shift');
  const multi = await selectedNames();
  await rightClick('boxb');
  const afterRight = await selectedNames();
  report.check(
    'right-clicking inside a multi-selection keeps all of it',
    multi.length === 2 && afterRight.length === 2,
    `${multi.length} selected before, ${afterRight.length} after`
  );
  report.check(
    'and the menu says so',
    (await menuLabels()).includes('Group'),
    'Group offered for two elements'
  );
  await closeMenu();

  await rightClick('boxc');
  const afterOutside = await selectedNames();
  report.check(
    'right-clicking outside it selects what was clicked',
    afterOutside.length === 1 && afterOutside[0]?.includes('Box C'),
    afterOutside.join(', ') || 'nothing selected'
  );
  await closeMenu();

  /* ------------------------------------------- 4. dismissing costs nothing -- */

  await selectLayer('Box A');
  const held = await selectedNames();
  await rightClick('boxa');
  // A press on the sheet, over a different element. Closing the menu must not
  // also select what the press landed on.
  const elsewhere = await centreOf('tail');
  await page.mouse.click(elsewhere.x, elsewhere.y);
  await page.waitForTimeout(400);
  const afterDismiss = await selectedNames();
  report.check(
    'a press outside closes the menu without selecting what it landed on',
    (await page.locator('[role="menu"]').count()) === 0 &&
      afterDismiss.join() === held.join(),
    `selection ${afterDismiss.join(', ') || 'empty'}`
  );

  /* ------------------------------------------------ 5. keyboard navigation -- */

  await rightClick('boxa');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  const first = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const active = menu?.getAttribute('aria-activedescendant');
    return document.getElementById(active ?? '')?.getAttribute('data-menu-item') ?? null;
  });
  report.check(
    'the first arrow lands on a real item',
    Boolean(first),
    first ?? 'nothing highlighted'
  );

  // Walk to Duplicate and press it. Nothing about this uses the mouse.
  let hops = 0;
  let landed = first;
  while (landed !== 'Duplicate' && hops < 30) {
    await page.keyboard.press('ArrowDown');
    hops++;
    landed = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]');
      const active = menu?.getAttribute('aria-activedescendant');
      return document.getElementById(active ?? '')?.getAttribute('data-menu-item') ?? null;
    });
  }
  const countBefore = await drawnCount();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const countAfter = await drawnCount();
  report.check(
    'and Enter runs the highlighted one',
    landed === 'Duplicate' && countAfter > countBefore,
    `${landed}: ${countBefore} → ${countAfter} nodes`
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);

  /* ------------------------------------------------------- 6. submenus ----- */

  await selectLayer('Box A');
  await rightClick('boxa');
  await page.locator('[data-menu-item="Arrange"]').first().hover();
  await page.waitForTimeout(300);
  const panels = await page.locator('[role="menu"]').count();
  const arrangeItems = await menuLabels();
  report.check(
    'a submenu opens on hover',
    panels === 2 && arrangeItems.includes('Bring to front'),
    `${panels} panels; ${arrangeItems.filter((l) => l.startsWith('Bring') || l.startsWith('Send')).join(', ')}`
  );

  /*
   * Where it opens, not merely that it did. A submenu nested inside its parent
   * inherits the parent's transform and resolves `position: fixed` against it,
   * which put this one at 868,1578 in a 1500x950 window — open, populated, and
   * completely off the screen. Counting panels saw nothing wrong.
   */
  const submenuPlaced = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('[role="menu"]')];
    const sub = panels[panels.length - 1].getBoundingClientRect();
    const parent = panels[0].getBoundingClientRect();
    return {
      inside: sub.right <= innerWidth && sub.bottom <= innerHeight && sub.top >= 0 && sub.left >= 0,
      beside: Math.abs(sub.left - parent.right) < 40,
      at: `${Math.round(sub.left)},${Math.round(sub.top)}`,
      window: `${innerWidth}x${innerHeight}`,
    };
  });
  report.check(
    'and it opens beside its parent, on the screen',
    submenuPlaced.inside && submenuPlaced.beside,
    `submenu at ${submenuPlaced.at} in ${submenuPlaced.window}`
  );

  const orderBefore = (await childOrder('holder')).join(',');
  await clickItem('Bring to front');
  const orderAfter = (await childOrder('holder')).join(',');
  report.check(
    'and choosing from it reorders the element',
    orderBefore !== orderAfter && orderAfter.endsWith('boxa'),
    `${orderBefore} → ${orderAfter}`
  );
  report.check(
    'and closes the whole menu, not just itself',
    (await page.locator('[role="menu"]').count()) === 0,
    'dismissed'
  );

  /* ---------------------------------------------- 7. only what applies ----- */

  /*
   * Align is offered for the three positioned boxes and withheld from the
   * paragraph in the flow, where writing `left` would do nothing you could
   * see. The pair is the check: either half alone would pass on a menu that
   * always showed it or never did.
   */
  await selectLayer('Box A');
  await selectLayer('Box B', 'Shift');
  await rightClick('boxb');
  const withPositioned = await menuLabels();
  await closeMenu();

  await selectLayer('Tail');
  await rightClick('tail');
  const withFlow = await menuLabels();
  const flowHasAlign = await page.locator('[data-menu-item="Align"]').count();
  await closeMenu();

  report.check(
    'Align is offered where it means something and withheld where it does not',
    withPositioned.includes('Align') && flowHasAlign === 0,
    `positioned: ${withPositioned.includes('Align')}, in flow: ${flowHasAlign > 0}`
  );
  report.check(
    'and the flow element still gets the ordinary actions',
    withFlow.includes('Duplicate') && withFlow.includes('Delete'),
    `${withFlow.length} items`
  );

  /* --- Align actually aligns ---------------------------------------------- */

  await selectLayer('Box A');
  await selectLayer('Box B', 'Shift');
  await selectLayer('Box C', 'Shift');
  await rightClick('boxb');
  await page.locator('[data-menu-item="Align"]').first().hover();
  await page.waitForTimeout(300);
  await clickItem('Align left');
  const lefts = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    const { document: doc } = await r.json();
    return ['boxa', 'boxb', 'boxc'].map((k) => doc.nodes[k]?.styles?.desktop?.left);
  }, id);
  report.check(
    'Align left puts them on one edge',
    new Set(lefts).size === 1,
    lefts.join(' / ')
  );

  /* -------------------------------------------- 8. an empty canvas menu ---- */

  /*
   * Empty workspace, which is not the same as "somewhere on the left". The
   * first version of this clicked at x=120, which is inside the sidebar — no
   * canvas handler there, so the browser's own menu came up and the check
   * waited four seconds for one that was never going to appear.
   */
  const gutter = await page.evaluate(() => {
    const r = document.querySelector('.canvas-surface').getBoundingClientRect();
    return { x: Math.round(r.left + 16), y: Math.round(r.bottom - 24) };
  });
  await page.mouse.click(gutter.x, gutter.y);
  await page.waitForTimeout(300);
  await page.mouse.click(gutter.x, gutter.y, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  const empty = await menuLabels();
  report.check(
    'with nothing selected the menu offers what applies to nothing',
    empty.includes('Paste') && empty.includes('Select all') && !empty.includes('Delete'),
    empty.join(', ')
  );
  await closeMenu();

  /* ------------------------------------------------ 9. it stays on screen -- */

  await selectLayer('Box A');
  const corner = await page.evaluate(() => {
    const r = document.querySelector('.canvas-surface').getBoundingClientRect();
    return { x: Math.round(r.right - 8), y: Math.round(r.bottom - 8) };
  });
  await page.mouse.click(corner.x, corner.y, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await page.waitForTimeout(200);
  const clamped = await page.evaluate(() => {
    const r = document.querySelector('[role="menu"]').getBoundingClientRect();
    return {
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      w: window.innerWidth,
      h: window.innerHeight,
    };
  });
  report.check(
    'opened against a corner it stays inside the window',
    clamped.right <= clamped.w && clamped.bottom <= clamped.h && clamped.bottom > 0,
    `menu ends at ${clamped.right},${clamped.bottom} in ${clamped.w}×${clamped.h}`
  );
  await closeMenu();

  /* ------------------------------------------- 10. scoped to the overlay --- */

  /*
   * The menu has to obey the editing context for the same reason everything
   * else does — and the way out has to be *in* the menu, because the menu is
   * where somebody who has never met Escape will look for it.
   *
   * Made and entered through the interface: a block with a popover in it from
   * the Insert panel, then the double-click that goes in. Reaching into the
   * store to set the context would prove the menu reads a field, not that the
   * gesture a person makes puts them somewhere the menu understands.
   */
  await page.locator('button[aria-label="Insert"]').first().click();
  const popoverCard = page.locator('button:has(span:text-is("Mega menu"))').first();
  await popoverCard.waitFor({ state: 'visible', timeout: 8000 });
  await popoverCard.click();
  await page.waitForTimeout(1500);

  const overlayId = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}`, {
      credentials: 'include',
      headers: { 'x-cre8-csrf': '1' },
    });
    const { document: doc } = await r.json();
    return Object.values(doc.nodes).find((n) => n.type === 'popover')?.id ?? null;
  }, id);

  if (report.check('a popover is on the page', Boolean(overlayId), overlayId ?? 'none')) {
    const corner = await page.evaluate((nid) => {
      const el = document.querySelector(`.cre8-frame.cre8-editing [data-cre8-id="${nid}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.left + 8), Math.round(r.top + 8)];
    }, overlayId);

    if (corner) {
      await page.mouse.click(corner[0], corner[1]);
      await page.waitForTimeout(300);
      await page.mouse.dblclick(corner[0], corner[1]);
      await page.waitForTimeout(800);
    }

    const scoped = await page.evaluate(() =>
      Boolean(document.querySelector('button[aria-label="Stop editing this overlay"]'))
    );

    if (report.check('and double-clicking it enters its context', scoped, scoped ? 'breadcrumb shown' : 'no breadcrumb')) {
      await page.mouse.click(corner[0] + 40, corner[1] + 30, { button: 'right' });
      await page.waitForSelector('[role="menu"]', { timeout: 4000 });
      const inOverlay = await menuLabels();
      report.check(
        'the menu offers the way out of the overlay',
        inOverlay.includes('Finish editing overlay'),
        inOverlay.slice(0, 4).join(', ')
      );

      await clickItem('Finish editing overlay');
      const stillScoped = await page.evaluate(() =>
        Boolean(document.querySelector('button[aria-label="Stop editing this overlay"]'))
      );
      report.check('and choosing it leaves', !stillScoped, stillScoped ? 'still scoped' : 'back on the page');
    }
  }

  /* ------------------------------------------ 11. the inspector's menu ---- */

  /*
   * A right-click on a style control is not a question about the element. It
   * is a question about that property, and the menu has to be able to tell the
   * difference — otherwise the only Reset on offer is the one that empties
   * every declaration the element has.
   */
  await selectLayer('Holder');
  await page.waitForTimeout(400);

  const padding = page.locator('[data-style-props][data-style-label="Padding"]').first();
  await padding.waitFor({ state: 'visible', timeout: 6000 });
  const at2 = await padding.boundingBox();
  await page.mouse.click(at2.x + 6, at2.y + 6, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });

  const headings = await page.$$eval('[data-menu-heading]', (nodes) =>
    nodes.map((n) => n.getAttribute('data-menu-heading'))
  );
  const styleLabels = await menuLabels();
  report.check(
    'right-clicking padding gives a menu about padding',
    headings.includes('Padding') && styleLabels.includes('Reset padding'),
    `${headings.join(' / ')} — ${styleLabels.slice(0, 4).join(', ')}`
  );
  report.check(
    'and the element-wide style actions are still within reach',
    styleLabels.includes('Copy styles') && styleLabels.includes('Reset styles'),
    styleLabels.join(', ')
  );
  report.check(
    'but nothing that belongs to the canvas menu',
    !styleLabels.includes('Duplicate') && !styleLabels.includes('Bring to front'),
    'no element actions on a property menu'
  );

  const paddingBefore = await paddingOf('holder');
  await clickItem('Reset padding');
  const paddingAfter = await paddingOf('holder');
  report.check(
    'and Reset padding removes exactly that',
    paddingBefore !== '0px' && paddingAfter === '0px',
    `${paddingBefore} → ${paddingAfter}`
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(700);

  /* --- Copy one value, not the whole element ------------------------------ */

  await selectLayer('Holder');
  const gapRow = page.locator('[data-style-props][data-style-label="Padding"]').first();
  const box2 = await gapRow.boundingBox();
  await page.mouse.click(box2.x + 6, box2.y + 6, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await clickItem('Copy padding');

  await selectLayer('Box A');
  await page.waitForTimeout(400);
  const target = page.locator('[data-style-props][data-style-label="Padding"]').first();
  const box3 = await target.boundingBox();
  await page.mouse.click(box3.x + 6, box3.y + 6, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  const pasteLabels = await menuLabels();
  report.check(
    'the value clipboard says what it is holding',
    pasteLabels.includes('Paste padding'),
    pasteLabels.slice(0, 5).join(', ')
  );
  await clickItem('Paste padding');
  const carried = await paddingOf('boxa');
  report.check(
    'and pasting it carries the padding across',
    carried === paddingBefore,
    `${carried}, copied from ${paddingBefore}`
  );
  report.check(
    'without dragging the rest of the element with it',
    (await page.evaluate(() => {
      const el = document.querySelector('.cre8-frame.cre8-editing [data-cre8-id="boxa"]');
      return getComputedStyle(el).position;
    })) === 'absolute',
    'Box A is still positioned as it was'
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(700);

  /* --- A field keeps the browser's menu ----------------------------------- */

  await selectLayer('Box A');
  const field = page.locator('aside input[type="text"], aside input:not([type])').first();
  if (await field.count()) {
    const fbox = await field.boundingBox();
    if (fbox) {
      await page.mouse.click(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2, { button: 'right' });
      await page.waitForTimeout(400);
      report.check(
        'a text field in the inspector keeps the browser’s own menu',
        (await page.locator('[role="menu"]').count()) === 0,
        'ours stayed out of the way'
      );
    }
  }

  /* --- A setting the menu reports back ------------------------------------ */

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const rulersBefore = await page.locator('[data-cre8-rulers]').count();
  const gutter2 = await page.evaluate(() => {
    const r = document.querySelector('.canvas-surface').getBoundingClientRect();
    return { x: Math.round(r.left + 16), y: Math.round(r.bottom - 24) };
  });
  await page.mouse.click(gutter2.x, gutter2.y);
  await page.waitForTimeout(250);
  await page.mouse.click(gutter2.x, gutter2.y, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await page.locator('[data-menu-item="View"]').first().hover();
  await page.waitForTimeout(300);
  const ticked = await page.evaluate(() => {
    const row = document.querySelector('[role="menuitemcheckbox"][data-menu-item="Rulers"]');
    return row?.getAttribute('aria-checked');
  });
  report.check(
    'a setting in the menu shows its current state',
    ticked === String(rulersBefore > 0),
    `Rulers ticked=${ticked}, drawn=${rulersBefore > 0}`
  );
  await clickItem('Rulers');
  report.check(
    'and choosing it changes the canvas',
    (await page.locator('[data-cre8-rulers]').count()) !== rulersBefore,
    'rulers toggled'
  );
} catch (error) {
  report.check('menus suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
