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
  openInspectorSection,
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

/**
 * Right-click something in a panel, having first made sure it is on screen.
 *
 * The Insert panel scrolls a long way: the element cards sit at y=5295 in a
 * 950px window, and `boundingBox()` hands back page coordinates without
 * complaint. Clicking there hits nothing at all, which looks exactly like a
 * menu that failed to open.
 */
const rightClickIn = async (locator, dx = 20, dy = 10) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  if (!box) throw new Error('nothing to right-click');
  await page.mouse.click(box.x + dx, box.y + dy, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await page.waitForTimeout(120);
  return box;
};

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

/** Right-click something and choose an item from the menu it opens. */
const useMenuOn = async (locator, label, dx = 30, dy = 10) => {
  await rightClickIn(locator, dx, dy);
  await clickItem(label);
};

const closeMenu = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
};

/** Dismiss anything still open, so the next right-click lands on the panel. */
const dismissMenu = async () => {
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
  /*
   * Spacing is one of a container's essentials, so this is a no-op here — and
   * it is written anyway, because the same row is reached on a heading below
   * where it is not, and a gesture that only works on half the elements it is
   * used on is a gesture waiting to be debugged.
   */
  await openInspectorSection(page, 'Spacing');

  const padding = page.locator('[data-style-props][data-style-label="Padding"]').first();
  await padding.waitFor({ state: 'visible', timeout: 6000 });
  /*
   * Through the locator, so it is scrolled to before it is clicked.
   *
   * `boundingBox()` plus `mouse.click` reads a position and then clicks the
   * screen, and the inspector is a scrolling column: with enough panels above
   * it the padding widget is *visible* by Playwright's definition — it has a
   * box and is not hidden — while sitting below the fold, and the click lands
   * on whatever is actually at those coordinates. The offset is kept because
   * the point of the check is the corner label rather than the middle, which
   * is a different control.
   */
  await padding.click({ button: 'right', position: { x: 6, y: 6 } });
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
  await openInspectorSection(page, 'Spacing');
  const gapRow = page.locator('[data-style-props][data-style-label="Padding"]').first();
  const box2 = await gapRow.boundingBox();
  await page.mouse.click(box2.x + 6, box2.y + 6, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await clickItem('Copy padding');

  await selectLayer('Box A');
  await page.waitForTimeout(400);
  // A heading with no padding, so Spacing is not on screen until it is asked
  // for — which is the panel working, not a missing row.
  await openInspectorSection(page, 'Spacing');
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
    // Through the locator so it is scrolled to first. Right-clicking screen
    // coordinates read from a `boundingBox()` hit whatever is at that point,
    // and in a scrolled inspector that was a style row — which opens our menu,
    // and made this check report that ours had not stayed out of the way when
    // it had never been asked.
    await field.click({ button: 'right' });
    await page.waitForTimeout(400);
    const ours = await page.locator('[role="menu"]').count();
    report.check(
      'a text field in the inspector keeps the browser’s own menu',
      ours === 0,
      // Computed, not asserted: a detail line reading "stayed out of the way"
      // beside a red cross is worse than no detail at all.
      ours === 0 ? 'ours stayed out of the way' : `${ours} of our menus opened over it`
    );
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
  /* ------------------------------------------- 12. the library panels ----- */

  /*
   * Pages, Components and Assets. Each row now answers for itself, and each of
   * these actions used to be a transaction the panel wrote by hand — which is
   * how the inspector and the toolbar came to detach instances differently.
   */
  /*
   * Clicking the tab of the panel already showing *collapses* it — the same
   * trap `showLayers` exists for. So: click, and click again if the rows did
   * not appear.
   */
  const openPanel = async (label, rowSelector) => {
    if (await page.locator(rowSelector).first().isVisible().catch(() => false)) return;
    await page.locator(`button[aria-label="${label}"]`).first().click();
    await page.waitForTimeout(450);
    if (await page.locator(rowSelector).first().isVisible().catch(() => false)) return;
    await page.locator(`button[aria-label="${label}"]`).first().click();
    await page.waitForTimeout(450);
  };

  /* --- Pages ------------------------------------------------------------- */

  await openPanel('Pages', '[data-page-row]');
  const pageRow = page.locator('[data-page-row]').first();
  await pageRow.waitFor({ state: 'visible', timeout: 6000 });
  const pagesBefore = await page.locator('[data-page-row]').count();

  const pbox = await pageRow.boundingBox();
  await page.mouse.click(pbox.x + 40, pbox.y + pbox.height / 2, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  const pageItems = await menuLabels();
  report.check(
    'a page row has a menu about that page',
    pageItems.includes('Duplicate page') && pageItems.includes('New page'),
    pageItems.join(', ')
  );
  report.check(
    'and the last page cannot be deleted from it',
    await page.locator('[data-menu-item="Delete page"]').first().isDisabled(),
    pagesBefore === 1 ? 'one page, Delete greyed' : `${pagesBefore} pages`
  );

  await clickItem('Duplicate page');
  await page.waitForTimeout(600);
  const pagesAfter = await page.locator('[data-page-row]').count();
  report.check(
    'Duplicate page adds one',
    pagesAfter === pagesBefore + 1,
    `${pagesBefore} → ${pagesAfter}`
  );

  // And now Delete is available, because there is more than one.
  const secondRow = page.locator('[data-page-row]').nth(1);
  const sbox = await secondRow.boundingBox();
  await page.mouse.click(sbox.x + 40, sbox.y + sbox.height / 2, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await clickItem('Delete page');
  await page.waitForTimeout(600);
  report.check(
    'and Delete takes it away again once there is a spare',
    (await page.locator('[data-page-row]').count()) === pagesBefore,
    `back to ${await page.locator('[data-page-row]').count()}`
  );

  /* --- Components -------------------------------------------------------- */

  await selectLayer('Box A');
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(900);
  await openPanel('Components', '[data-component-row]');
  const componentRow = page.locator('[data-component-row]').first();
  await componentRow.waitFor({ state: 'visible', timeout: 6000 });

  const cbox = await componentRow.boundingBox();
  await page.mouse.click(cbox.x + 40, cbox.y + cbox.height / 2, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  const componentItems = await menuLabels();
  report.check(
    'a component row has a menu about that component',
    componentItems.includes('Edit main component') && componentItems.includes('Add a variant'),
    componentItems.join(', ')
  );
  report.check(
    'and Delete says how many instances would be affected',
    componentItems.some((l) => /^Delete component \(\d+ in use\)$/.test(l)),
    componentItems.find((l) => l.startsWith('Delete component')) ?? 'no delete row'
  );

  await clickItem('Add a variant');
  await page.waitForTimeout(700);
  const variantRow = page.locator('[data-variant-row]').first();
  report.check(
    'Add a variant makes one',
    (await variantRow.count()) > 0,
    `${await page.locator('[data-variant-row]').count()} variants`
  );

  const vbox = await variantRow.boundingBox();
  await page.mouse.click(vbox.x + 30, vbox.y + vbox.height / 2, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  const variantItems = await menuLabels();
  report.check(
    'and a variant row has its own menu, not the component’s',
    variantItems.includes('Delete variant') && !variantItems.includes('Delete component'),
    variantItems.join(', ')
  );
  /*
   * Duplicate, with the variant still there — which is the case worth taking
   * the menu through. A component is a master tree, a tree per variant and
   * properties naming nodes in all of them, so a duplicate that only cloned
   * the master would leave the two sharing variants: edit the copy's and the
   * original changes with it.
   */
  const cbox2 = await componentRow.boundingBox();
  await page.mouse.click(cbox2.x + 40, cbox2.y + cbox2.height / 2, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  report.check(
    'a component can be duplicated from its own menu',
    (await menuLabels()).includes('Duplicate component'),
    (await menuLabels()).join(', ')
  );
  await clickItem('Duplicate component');
  await page.waitForTimeout(800);

  const componentNames = await page
    .locator('[data-component-row]')
    .allTextContents()
    .then((all) => all.map((one) => one.replace(/\s+/g, ' ').trim()));
  report.check(
    'which makes a second one, named apart from the first',
    componentNames.length === 2 && new Set(componentNames).size === 2,
    componentNames.join(' / ')
  );
  report.check(
    'and the copy brought the variant with it rather than sharing one',
    (await page.locator('[data-variant-row]').count()) >= 1,
    `${await page.locator('[data-variant-row]').count()} variant rows across both`
  );

  await dismissMenu();
  const vbox2 = await page.locator('[data-variant-row]').first().boundingBox();
  await page.mouse.click(vbox2.x + 30, vbox2.y + vbox2.height / 2, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await clickItem('Delete variant');
  await page.waitForTimeout(700);
  report.check(
    'which deletes the variant and leaves the component',
    (await page.locator('[data-component-row]').count()) === 2,
    'variant gone, both components stay'
  );

  /* --- Assets ------------------------------------------------------------ */

  /*
   * Seeded through the document rather than uploaded: this suite is about the
   * menu, and a real file upload is the `assets` suite's question.
   */
  const withAsset = await getDocument(page, id);
  withAsset.assets = [
    {
      id: 'seedasset',
      name: 'Seed picture',
      type: 'image',
      url: 'https://example.invalid/seed.webp',
      width: 800,
      height: 600,
      createdAt: 1,
    },
  ];
  const assetSaved = await saveDocument(page, withAsset);
  report.check('an asset is in the library', assetSaved === 200, `HTTP ${assetSaved}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1400);

  await openPanel('Assets', '[data-asset-row]');
  const assetTile = page.locator('[data-asset-row]').first();
  await assetTile.waitFor({ state: 'visible', timeout: 6000 });
  const abox = await assetTile.boundingBox();
  await page.mouse.click(abox.x + 20, abox.y + 20, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  const assetItems = await menuLabels();
  report.check(
    'an asset has a menu about that asset',
    assetItems.includes('Place image') && assetItems.includes('Copy address'),
    assetItems.join(', ')
  );

  const imagesBefore = await page.locator('.cre8-frame.cre8-editing img').count();
  await clickItem('Place image');
  await page.waitForTimeout(900);
  const placed = await page.evaluate(() => {
    const img = [...document.querySelectorAll('.cre8-frame.cre8-editing img')].pop();
    return img ? { src: img.getAttribute('src'), alt: img.getAttribute('alt') } : null;
  });
  report.check(
    'Place image puts it on the canvas with its name as the alt text',
    (await page.locator('.cre8-frame.cre8-editing img').count()) === imagesBefore + 1 &&
      placed?.src === 'https://example.invalid/seed.webp' &&
      placed?.alt === 'Seed picture',
    JSON.stringify(placed)
  );
  /* -------------------------- 13. collections, theme and insert ---------- */

  /* --- A token, and the reference nobody can guess ------------------------ */

  await openPanel('Theme', '[data-token-row]');
  const tokenRow = page.locator('[data-token-row]').first();
  await tokenRow.waitFor({ state: 'visible', timeout: 6000 });
  const tokenId = await tokenRow.getAttribute('data-token-row');
  const tbox = await tokenRow.boundingBox();
  // Away from the name field, which keeps the browser's own menu.
  await page.mouse.click(tbox.x + 6, tbox.y + tbox.height / 2, { button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  const tokenItems = await menuLabels();
  report.check(
    'a token offers the reference an advanced field wants',
    tokenItems.some((l) => l === `Copy var(--c-${tokenId})`),
    tokenItems.join(', ')
  );
  report.check(
    'and says how many declarations would break if it went',
    tokenItems.some((l) => /^Delete token/.test(l)),
    tokenItems.find((l) => l.startsWith('Delete token')) ?? 'no delete row'
  );
  await closeMenu();

  const nameField = page.locator(`[data-token-name="${tokenId}"]`).first();
  const nbox = await nameField.boundingBox();
  await page.mouse.click(nbox.x + nbox.width / 2, nbox.y + nbox.height / 2, { button: 'right' });
  await page.waitForTimeout(400);
  report.check(
    'and a token’s name field keeps the browser’s own menu',
    (await page.locator('[role="menu"]').count()) === 0,
    'ours stayed out of the way'
  );

  /* --- A collection and its fields ---------------------------------------- */

  await page.locator('button[aria-label="Collections"]').first().click();
  await page.waitForTimeout(500);
  const newCollection = page.locator('button[aria-label="New collection"]').first();
  if (await newCollection.count()) {
    await newCollection.click();
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  const collectionRow = page.locator('[data-collection-row]').first();
  if (report.check('a collection exists', (await collectionRow.count()) > 0, 'one made')) {
    await rightClickIn(collectionRow, 30, 14);
    const colItems = await menuLabels();
    report.check(
      'a collection row has a menu about that collection',
      colItems.includes('Add field') && colItems.some((l) => l.startsWith('Delete collection')),
      colItems.join(', ')
    );
    await clickItem('Add field');
    await page.waitForTimeout(700);

    /*
     * Fields live in the collection's detail view, which a click on the row
     * opens — but the row may still be in rename mode from being created, and
     * its input stops the click from reaching the row. So: out of rename
     * first, then click the icon at the left edge rather than the middle.
     */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (!(await page.locator('[data-field-row]').count())) {
      const openBox = await page.locator('[data-collection-row]').first().boundingBox();
      await page.mouse.click(openBox.x + 8, openBox.y + openBox.height / 2);
      await page.waitForTimeout(700);
      /*
       * The detail view opens on Content; fields are the other tab. Its label
       * is the literal string "fields" capitalised by CSS, so match the text
       * that is actually in the DOM rather than the text on the screen.
       */
      await page.locator('button:text-is("fields")').first().click();
      await page.waitForTimeout(600);
    }
    const fieldRow = page.locator('[data-field-row]').first();
    const fieldCount = await fieldRow.count();
    if (
      report.check(
        'and a field to right-click',
        fieldCount > 0,
        fieldCount > 0
          ? 'field present'
          : `no field rows; panel shows: ${(await page
              .locator('[role="region"][aria-label="Collections panel"]')
              .innerText()
              .catch(() => '?'))
              .replace(/\s+/g, ' ')
              .slice(0, 90)}`
      )
    ) {
      await rightClickIn(fieldRow, 30);
      const fieldItems = await menuLabels();
      report.check(
        'a field row has its own menu, not the collection’s',
        fieldItems.includes('Delete field') && !fieldItems.some((l) => l.startsWith('Delete collection')),
        fieldItems.join(', ')
      );

      const requiredBefore = await page.evaluate(() =>
        document
          .querySelector('[data-menu-item="Required"]')
          ?.getAttribute('aria-checked')
      );
      await clickItem('Required');
      await page.waitForTimeout(600);
      await rightClickIn(fieldRow, 30);
      const requiredAfter = await page.evaluate(() =>
        document
          .querySelector('[data-menu-item="Required"]')
          ?.getAttribute('aria-checked')
      );
      report.check(
        'and a checkable row reports the change it just made',
        requiredBefore === 'false' && requiredAfter === 'true',
        `${requiredBefore} → ${requiredAfter}`
      );
      await closeMenu();

      /*
       * Two fields, because one cannot see this: a command that reads
       * `fields[0]` instead of the field that was clicked passes every check
       * a single-field fixture can make. It did, here, until this was added.
       */
      await useMenuOn(fieldRow, 'Add field');
      await page.waitForTimeout(700);
      const fieldKeys = () =>
        page.$$eval('[data-field-row]', (ns) => ns.map((n) => n.getAttribute('data-field-row')));
      const twoFields = await fieldKeys();
      if (report.check('a second field to tell them apart', twoFields.length >= 2, twoFields.join(', '))) {
        const second = page.locator('[data-field-row]').nth(1);
        await useMenuOn(second, 'Delete field');
        await page.waitForTimeout(700);
        const left = await fieldKeys();
        report.check(
          'Delete field takes the one that was right-clicked',
          left.length === twoFields.length - 1 && left[0] === twoFields[0],
          `${twoFields.join(', ')} → ${left.join(', ')}`
        );
      }
    }
  }

  /* --- A record ------------------------------------------------------------ */

  /*
   * Records are content: they live in D1, not in the document, so a command
   * about one resolves it from `store.records` and every action is a request
   * over the network. Which is also why Duplicate makes a *draft* — writing a
   * published record republishes the site on its own.
   */
  const panel = () => page.locator('[role="region"][aria-label="Collections panel"]');
  await panel().locator('button:text-is("content")').first().click();
  await page.waitForTimeout(400);
  const addRecord = panel().locator('button:has-text("Add record")').first();
  if ((await addRecord.count()) > 0) {
    await addRecord.click();
    await page.waitForTimeout(500);
    /*
     * Every text field, not just the first. The form's primary button reads
     * "<Field> needed" until the required ones are filled — and the field
     * checks above have just marked one required — so a form with a blank left
     * in it has no button called Save to click.
     */
    const formInputs = panel().locator('input[type="text"], input:not([type])');
    for (let i = 0; i < (await formInputs.count()); i++) {
      await formInputs.nth(i).fill(i === 0 ? 'First post' : `Value ${i}`);
    }
    await panel().locator('button:has-text("Save")').first().click();
    await page.waitForTimeout(1500);
  }

  const recordRow = page.locator('[data-record-row]').first();
  /*
   * Settled, like `drawnCount`. A record write is a round trip and a reload,
   * and reading the list straight afterwards reported 1 when the server had
   * already returned 2 — which looked exactly like Duplicate doing nothing.
   */
  const recordCount = async () => {
    let previous = -1;
    for (let i = 0; i < 24; i++) {
      const now = await page.locator('[data-record-row]').count();
      if (now === previous) return now;
      previous = now;
      await page.waitForTimeout(200);
    }
    return previous;
  };
  if (report.check('a record exists', (await recordRow.count()) > 0, `${await recordCount()} rows`)) {
    await rightClickIn(recordRow, 40, 14);
    const recordItems = await menuLabels();
    report.check(
      'a record row has a menu about that record',
      recordItems.includes('Edit record') &&
        recordItems.includes('Duplicate as a draft') &&
        recordItems.includes('Delete record'),
      recordItems.join(', ')
    );
    report.check(
      'and it reports whether the record is published',
      (await page.evaluate(() =>
        document.querySelector('[data-menu-item="Published"]')?.getAttribute('aria-checked')
      )) === 'true',
      'the new record is live'
    );

    const before = await recordCount();
    await clickItem('Duplicate as a draft');
    await page.waitForTimeout(1600);
    const after = await recordCount();
    // From the document, not the DOM: the collection list is not rendered
    // while its detail view is open, so there is no row to read an id off.
    report.check('Duplicate adds a row', after === before + 1, `${before} → ${after}`);

    /*
     * And the copy is *not* published, because a record write republishes the
     * site — a duplicate that inherited `published` would put a second copy of
     * somebody's post live the moment they asked for a draft.
     */
    const draft = page.locator('[data-record-row]').nth(after - 1);
    await rightClickIn(draft, 40, 14);
    const draftPublished = await page.evaluate(() =>
      document.querySelector('[data-menu-item="Published"]')?.getAttribute('aria-checked')
    );
    report.check(
      'and the copy is a draft rather than a second live page',
      draftPublished === 'false',
      `published=${draftPublished}`
    );

    await clickItem('Delete record');
    await page.waitForTimeout(1600);
    report.check(
      'Delete takes the one that was right-clicked',
      (await recordCount()) === before,
      `back to ${await recordCount()}`
    );

    await useMenuOn(recordRow, 'Edit record', 40, 14);
    await page.waitForTimeout(700);
    report.check(
      'and Edit opens the form on it',
      await panel()
        .locator('input[type="text"], input:not([type])')
        .first()
        .inputValue()
        .then((v) => v === 'First post')
        .catch(() => false),
      'the form is showing that record'
    );
  }

  /* --- A card in the Insert panel ----------------------------------------- */

  await page.locator('button[aria-label="Insert"]').first().click();
  await page.waitForTimeout(600);
  const elementCard = page.locator('[data-element-card="heading"]').first();
  if (report.check('the Insert panel is showing', (await elementCard.count()) > 0, 'cards visible')) {
    await rightClickIn(elementCard);
    const cardItems = await menuLabels();
    report.check(
      'an element card says where it would go, not the same thing twice',
      cardItems.includes('Add to the page') &&
        cardItems.some((l) => l.startsWith('Add inside')) &&
        new Set(cardItems).size === cardItems.length,
      cardItems.join(', ')
    );

    const headingsBefore = await page.locator('.cre8-frame.cre8-editing h2, .cre8-frame.cre8-editing h3').count();
    await page.locator('[data-menu-item="Add to the page"]').first().click();
    await page.waitForTimeout(900);
    report.check(
      'and choosing one inserts it',
      (await page.locator('.cre8-frame.cre8-editing h2, .cre8-frame.cre8-editing h3').count()) >
        headingsBefore,
      'a heading arrived'
    );
  }

  const blockCard = page.locator('[data-block-card]').first();
  if ((await blockCard.count()) > 0) {
    await rightClickIn(blockCard, 30);
    const blockItems = await menuLabels();
    report.check(
      'and a block card names the block it would add',
      blockItems.length === 1 && blockItems[0].startsWith('Add '),
      blockItems.join(', ')
    );
    const nodesBefore = await drawnCount();
    await clickItem(blockItems[0]);
    report.check(
      'which lands on the page',
      (await drawnCount()) > nodesBefore,
      `${nodesBefore} → ${await drawnCount()}`
    );
  }
} catch (error) {
  report.check('menus suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
