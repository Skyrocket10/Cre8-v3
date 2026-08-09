/**
 * The behaviour runtime, and the property it was designed around.
 *
 * Phase C is the point where a published page can contain a script, and the
 * risk `ARCHITECTURE.md` §1 names is that behaviour becomes the place a second
 * renderer grows: React state on the canvas, a hand-written script in the
 * output, and tabs that behave differently in the editor than in production.
 *
 * The design that avoids it is that **CSS does the work** — a generated rule
 * per case, keyed on one attribute — so these checks are mostly about proving
 * that rather than proving the script. Hence the odd-looking ones: the page
 * with JavaScript switched off, and the two surfaces measured against each
 * other rather than against a fixture.
 *
 * The other half is the invariant that changed. "A published page ships no
 * script" is no longer true and pretending otherwise would be worse than
 * useless, so what is asserted now is the narrower, honest version: a page
 * with no behaviour on it still ships nothing to execute.
 */

import { APP, launch, openProject, publish, signUp, unbalanced } from './harness.mjs';
import { createReport } from '../report.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** Every generated selector that tests a state, from a published page. */
const conditionalSelectors = (html) =>
  [...html.matchAll(/^(.*data-cre8-switch=.*?)\s*\{$/gm)].map((m) => m[1]);

/**
 * A selector with its `:where()` groups removed.
 *
 * Balanced rather than a regex, because the groups nest — `:where(:not(:is(…
 * )))` — and a non-greedy `\)` stops at the wrong bracket.
 */
const withoutWhere = (selector) => {
  let out = '';
  for (let i = 0; i < selector.length; i++) {
    if (!selector.startsWith(':where(', i)) {
      out += selector[i];
      continue;
    }
    let depth = 0;
    for (i += 6; i < selector.length; i++) {
      if (selector[i] === '(') depth++;
      else if (selector[i] === ')' && --depth === 0) break;
    }
  }
  return out;
};

/**
 * A row in the layer tree, scrolled to.
 *
 * The list is virtualised, so a row far down does not exist in the DOM until
 * it is near the viewport — which is also true for the person looking for it.
 */
const layerRow = async (name) => {
  const row = page.locator(`[data-layer-row]:has-text("${name}")`).first();
  await page.evaluate(() => {
    const list = document.querySelector('[data-layers-scroll]');
    if (list) list.scrollTop = 0;
  });
  await page.waitForTimeout(150);
  for (let i = 0; i < 60; i++) {
    if (await row.count()) return row;
    const moved = await page.evaluate(() => {
      const list = document.querySelector('[data-layers-scroll]');
      if (!list) return false;
      const before = list.scrollTop;
      list.scrollTop += 240;
      return list.scrollTop !== before;
    });
    await page.waitForTimeout(110);
    if (!moved) break;
  }
  // Null rather than a locator that will time out on click: a check reading
  // `Boolean(locator)` is always true and proves nothing.
  return (await row.count()) ? row : null;
};

const insert = async (name) => {
  const card = page.locator(`button:has(span:text-is("${name}"))`).first();
  if (!(await card.isVisible().catch(() => false))) {
    await page.locator('button[aria-label="Insert"]').first().click();
    await card.waitFor({ state: 'visible', timeout: 8000 });
  }
  await card.click();
  await page.waitForTimeout(1100);
};

/** Which prices are actually on screen, on whichever surface is asked. */
const VISIBLE_PRICES = () => {
  const root = document.querySelector('.cre8-frame.cre8-editing') ?? document.body;
  const shown = [];
  for (const el of root.querySelectorAll('[data-cre8-case]')) {
    if (el.getBoundingClientRect().height > 0) shown.push(el.getAttribute('data-cre8-case'));
  }
  const group = root.querySelector('[data-cre8-switch]');
  return {
    value: group?.getAttribute('data-cre8-value') ?? '',
    cases: [...new Set(shown)].sort().join(','),
    // Every case in the markup, shown or not — the point being that the
    // hidden one is still *there*, not conditionally rendered away.
    present: root.querySelectorAll('[data-cre8-case]').length,
  };
};

try {
  await signUp(page, 'Case Sweeney', 'switch');
  const id = await openProject(page, 'Blank');

  /* ------------------------- 1. a page with no behaviour still has no script */

  await insert('Section');
  await publish(page);
  const plain = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'a page with nothing to do ships nothing to execute',
    !/<script/i.test(plain),
    'no script'
  );

  /* --------------------------------------------- 2. and one with a switch does */

  await insert('Pricing with switch');
  await publish(page);
  const html = await (await fetch(`${APP}/s/${id}/`)).text();

  const scripts = html.match(/<script[^>]*>/g) ?? [];
  report.check('a page with a switch carries exactly one', scripts.length === 1, `${scripts.length}`);
  report.check('the published markup is still balanced', unbalanced(html).length === 0);

  const source = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  report.check(
    'and it is small enough to be read in one sitting',
    source.length > 0 && source.length < 3000,
    `${source.length} bytes`
  );
  report.check(
    'it is inline, so there is no second request and nothing to cache-bust',
    !/<script[^>]*\ssrc=/i.test(html)
  );

  /* ----------------------------------- 3. both prices are in the file, always */

  report.check(
    'both prices are in the markup — the hidden one is styled away, not dropped',
    html.includes('data-cre8-case="monthly"') && html.includes('data-cre8-case="annual"')
  );
  report.check(
    'the group states which case it ships on',
    /data-cre8-switch="billing"[^>]*data-cre8-value="monthly"/.test(html) ||
      /data-cre8-value="monthly"[^>]*data-cre8-switch="billing"/.test(html),
    'ships monthly'
  );
  report.check(
    'the hiding is a stylesheet rule, not a script decision',
    html.includes(
      ':where([data-cre8-switch="billing"]):where(:not(:is([data-cre8-value~="annual"])))'
    ),
    'rule present'
  );
  // Everything a condition contributes goes through `:where()`, which scores
  // nothing — so a conditional rule weighs exactly what the node's base rule
  // weighs and the cascade falls back to source order. That is what makes the
  // rule list in the inspector mean what it says. Strip the `:where()` groups
  // out of every conditional selector and what is left must be the class
  // alone; anything else is specificity nobody asked for.
  report.check(
    'and it weighs no more than the element’s own styles, so order is precedence',
    conditionalSelectors(html).every((selector) =>
      /^\s*\.c-[a-z0-9]+(::[a-z-]+)?$/.test(withoutWhere(selector))
    ),
    conditionalSelectors(html)
      .map(withoutWhere)
      .find((rest) => !/^\s*\.c-[a-z0-9]+(::[a-z-]+)?$/.test(rest)) ?? 'all padded'
  );

  /* --------------------------------- 4. it works, and it works without the script */

  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  let state = await site.evaluate(VISIBLE_PRICES);
  report.check('it opens on the monthly price', state.cases === 'monthly', state.cases);
  report.check('with the yearly one present but hidden', state.present >= 7, `${state.present} cases`);

  await site.locator('button:text-is("Yearly")').click();
  await site.waitForTimeout(220);
  state = await site.evaluate(VISIBLE_PRICES);
  report.check('clicking Yearly swaps every price at once', state.cases === 'annual', state.cases);
  report.check('and the group records it', state.value === 'annual', state.value);

  await site.locator('button:text-is("Monthly")').click();
  await site.waitForTimeout(220);
  state = await site.evaluate(VISIBLE_PRICES);
  report.check('and back', state.cases === 'monthly', state.cases);

  report.check(
    'the option a visitor is on is announced, not just coloured',
    (await site.locator('button:text-is("Monthly")').getAttribute('aria-pressed')) === 'true' &&
      (await site.locator('button:text-is("Yearly")').getAttribute('aria-pressed')) === 'false',
    'aria-pressed set both ways'
  );

  // The selected pill is a generated rule keyed on the group's value, not
  // something the script paints on. If it were the latter there would be a
  // frame of every page load with the wrong option looking selected.
  const pill = await site.evaluate(() => {
    const el = [...document.querySelectorAll('[data-cre8-set]')].find(
      (b) => b.getAttribute('data-cre8-set') === 'monthly'
    );
    const other = [...document.querySelectorAll('[data-cre8-set]')].find(
      (b) => b.getAttribute('data-cre8-set') === 'annual'
    );
    return {
      on: el ? getComputedStyle(el).backgroundColor : '',
      off: other ? getComputedStyle(other).backgroundColor : '',
    };
  });
  report.check(
    'the selected option looks different from the other one',
    pill.on !== pill.off && pill.on !== '',
    `${pill.on} vs ${pill.off}`
  );
  await site.close();

  // With scripting off the page is not interactive — but it is not broken
  // either. The default case is styled correctly and both prices are readable
  // in the source, which is what a crawler and a reader-mode see.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  const quiet = await noJs.newPage();
  await quiet.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  const withoutJs = await quiet.evaluate(VISIBLE_PRICES);
  report.check(
    'with scripting off it still shows the right prices',
    withoutJs.cases === 'monthly',
    withoutJs.cases
  );
  const quietPill = await quiet.evaluate(() => {
    const el = [...document.querySelectorAll('[data-cre8-set]')].find(
      (b) => b.getAttribute('data-cre8-set') === 'monthly'
    );
    return el ? getComputedStyle(el).backgroundColor : '';
  });
  report.check(
    'and the selected option still looks selected',
    quietPill === pill.on,
    `${quietPill} vs ${pill.on}`
  );
  await noJs.close();

  /* ------------------------------- 5. the canvas agrees, and does not leak */

  await page.bringToFront();
  const beforeSwitch = await page.evaluate(VISIBLE_PRICES);
  report.check(
    'the canvas shows the same case as a visitor would',
    beforeSwitch.cases === 'monthly',
    beforeSwitch.cases
  );

  // Design-time state: pick the other case to work on it. The whole reason
  // this exists is that the annual price is otherwise unreachable — hidden,
  // therefore unselectable, therefore unstylable.
  await page.locator('button[aria-label="Layers"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-layer-row]:has-text("billing switch")').first().click();
  await page.waitForTimeout(500);

  const editing = page.locator('button:has(.panel-title:text-is("Switch"))').first();
  report.check('the group offers a switch panel', (await editing.count()) === 1);
  await page.locator('button:text-is("annual")').last().click();
  await page.waitForTimeout(700);

  const afterSwitch = await page.evaluate(VISIBLE_PRICES);
  report.check(
    'choosing the other case on the canvas reveals it for editing',
    afterSwitch.cases === 'annual',
    afterSwitch.cases
  );

  await publish(page);
  const republished = await (await fetch(`${APP}/s/${id}/`)).text();
  // Read off the element, not off the whole file: `[data-cre8-value="annual"]`
  // is all over the stylesheet by design, and matching that would report a
  // leak on a page that has none.
  const shipped = /<[^>]*data-cre8-switch="billing"[^>]*>/.exec(republished)?.[0] ?? '';
  report.check(
    'and that choice never reaches the published file',
    /data-cre8-value="monthly"/.test(shipped),
    shipped ? (/data-cre8-value="([^"]*)"/.exec(shipped)?.[1] ?? 'no value') : 'no group found'
  );
  report.check(
    'nor does the editor-only prop itself',
    !republished.includes('switchDesign')
  );

  /* -------------------------------------- 6. a key cannot escape its selector */

  // Switch keys and case values reach a CSS selector and an HTML attribute,
  // both from a text field. `slug` is the whole defence, so this drives the
  // field a designer would actually type into.
  await page.locator('input[placeholder="plan"]').first().fill('a" ] { color: red } [x="');
  await page.locator('input[placeholder="plan"]').first().blur();
  await page.waitForTimeout(700);

  await publish(page);
  const hostile = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'a key full of CSS punctuation comes out as a plain identifier',
    /data-cre8-switch="[A-Za-z0-9_-]*"/.test(hostile) &&
      !hostile.includes('color: red') &&
      !hostile.includes('color:red'),
    /data-cre8-switch="([^"]*)"/.exec(hostile)?.[1] ?? 'none'
  );
  report.check('and the page is still balanced markup', unbalanced(hostile).length === 0);

  /* --------------------------------------------------------------- 7. tabs */

  // A tab set is the same state machine wearing the semantics that make it
  // one. The state half is already covered above, so these are about the
  // half that is invisible on screen: what a screen reader is told, and what
  // the keyboard can reach.
  await insert('Tabbed features');
  await publish(page);
  const tabbed = await (await fetch(`${APP}/s/${id}/`)).text();

  report.check(
    'all three panels are in the file, not just the open one',
    (tabbed.match(/data-cre8-case="(design|build|ship)"/g) ?? []).length === 3,
    `${(tabbed.match(/data-cre8-case="/g) ?? []).length} cases`
  );
  report.check(
    'so the copy in the closed ones is still readable by a crawler',
    tabbed.includes('Components that stay in step') && tabbed.includes('Static files, on the edge')
  );
  report.check(
    'the roles are not in the markup, because the script is what makes them true',
    !tabbed.includes('role="tab"'),
    'applied at runtime'
  );

  const tabPage = await ctx.newPage();
  await tabPage.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  await tabPage.waitForTimeout(300);

  const wired = await tabPage.evaluate(() => {
    const list = document.querySelector('[role="tablist"]');
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    return {
      lists: document.querySelectorAll('[role="tablist"]').length,
      tabs: tabs.length,
      panels: panels.length,
      inList: list ? tabs.every((t) => list.contains(t)) : false,
      // Every tab points at a panel that exists, and that panel points back.
      paired: tabs.every((t) => {
        const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
        return panel?.getAttribute('aria-labelledby') === t.id;
      }),
      // One stop for the whole set, not one per tab.
      stops: tabs.filter((t) => t.getAttribute('tabindex') === '0').length,
      selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
      // A tab is selected, never pressed — saying both is worse than one.
      pressed: tabs.filter((t) => t.hasAttribute('aria-pressed')).length,
    };
  });

  report.check('the row of tabs is announced as a tab list', wired.lists === 1, `${wired.lists}`);
  report.check('with three tabs inside it', wired.tabs === 3 && wired.inList, `${wired.tabs} tabs`);
  report.check('and three panels', wired.panels === 3, `${wired.panels}`);
  report.check('each tab names its panel, and the panel names it back', wired.paired);
  report.check('exactly one is selected', wired.selected === 1, `${wired.selected}`);
  report.check(
    'the whole set is one tab stop, not three',
    wired.stops === 1,
    `${wired.stops} tabbable`
  );
  report.check('and none of them claims to be pressed as well', wired.pressed === 0);

  // The keyboard half. A tab set that only answers to a mouse is a row of
  // buttons with extra words attached.
  await tabPage.locator('[role="tab"][aria-selected="true"]').focus();
  await tabPage.keyboard.press('ArrowRight');
  await tabPage.waitForTimeout(220);
  const afterRight = await tabPage.evaluate(() => ({
    selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '',
    focused: document.activeElement?.textContent ?? '',
    // Scoped to the tab set: the pricing block further up the page has cases
    // of its own, and counting those would make this assert nothing.
    shown: [...(document.querySelector('[data-cre8-tabs]')?.querySelectorAll('[data-cre8-case]') ?? [])]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.getAttribute('data-cre8-case'))
      .join(','),
  }));
  report.check('the right arrow moves to the next tab', afterRight.selected === 'Build', afterRight.selected);
  report.check('focus follows it', afterRight.focused === 'Build', afterRight.focused);
  report.check('and the panel comes with it', afterRight.shown === 'build', afterRight.shown);

  await tabPage.keyboard.press('ArrowLeft');
  await tabPage.keyboard.press('ArrowLeft');
  await tabPage.waitForTimeout(220);
  report.check(
    'left wraps round to the last one',
    (await tabPage.evaluate(
      () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    )) === 'Ship'
  );

  await tabPage.keyboard.press('Home');
  await tabPage.waitForTimeout(220);
  report.check(
    'Home returns to the first',
    (await tabPage.evaluate(
      () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    )) === 'Design'
  );

  // Tab out of the set: the next stop must be inside the open panel or past
  // it, never one of the other tabs.
  await tabPage.keyboard.press('Tab');
  const leftTheSet = await tabPage.evaluate(
    () => document.activeElement?.getAttribute('role') !== 'tab'
  );
  report.check('Tab leaves the set rather than walking through it', leftTheSet);

  await tabPage.close();

  /* ------------------------------------------- 8. the same set, on the canvas */

  await page.bringToFront();
  const canvasTabs = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    return {
      tabs: frame?.querySelectorAll('[role="tab"]').length ?? 0,
      panels: frame?.querySelectorAll('[role="tabpanel"]').length ?? 0,
      shown: [...(frame?.querySelector('[data-cre8-tabs]')?.querySelectorAll('[data-cre8-case]') ?? [])]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => el.getAttribute('data-cre8-case'))
        .join(','),
    };
  });
  report.check(
    'the canvas builds the same tab set, from the same runtime',
    canvasTabs.tabs === 3 && canvasTabs.panels === 3,
    `${canvasTabs.tabs} tabs, ${canvasTabs.panels} panels`
  );
  report.check(
    'and shows the panel a visitor would see first',
    canvasTabs.shown === 'design',
    canvasTabs.shown
  );

  /* ------------------------------- 9. a filter, whose catch-all means it */

  // The reason a case can name more than one value. Each card is tagged
  // `all brand`, so it answers to its own filter and to the one that shows
  // everything — no special case anywhere in the mechanism.
  await insert('Filterable work');
  await publish(page);
  const filtered = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'a card belongs to its own category and to the catch-all',
    /data-cre8-case="all brand"/.test(filtered),
    /data-cre8-case="all [a-z]+"/.exec(filtered)?.[0] ?? 'no multi-value case'
  );
  // One `:not(:is(a,b))` rather than `:not(a):not(b)`. Chained negations each
  // add specificity, so a card answering to two values would have out-ranked
  // one answering to a single value for no reason a designer could see;
  // `:is()` takes the highest of its arguments, so every case weighs the same.
  report.check(
    'and the rule tests every value it answers to, at one weight',
    filtered.includes(
      ':where(:not(:is([data-cre8-value~="all"],[data-cre8-value~="brand"])))'
    ),
    'one :is'
  );

  const grid = await ctx.newPage();
  await grid.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  // Positive conditions only: the "clear the filter" link is in this group
  // too, and it answers to the *absence* of a category rather than to one.
  const count = () =>
    grid.evaluate(
      () =>
        [
          ...(document
            .querySelector('[data-cre8-switch="kind"]')
            ?.querySelectorAll('[data-cre8-case]:not([data-cre8-not])') ?? []),
        ].filter((el) => el.getBoundingClientRect().height > 0).length
    );

  report.check('it opens showing everything', (await count()) === 6, `${await count()} cards`);
  await grid.locator('button:text-is("Brand")').click();
  await grid.waitForTimeout(220);
  report.check('a category narrows it', (await count()) === 2, `${await count()} cards`);
  await grid.locator('button:text-is("Editorial")').click();
  await grid.waitForTimeout(220);
  report.check('and another swaps it', (await count()) === 2, `${await count()} cards`);
  await grid.locator('button:text-is("Everything")').click();
  await grid.waitForTimeout(220);
  report.check('“Everything” brings them all back', (await count()) === 6, `${await count()} cards`);
  report.check(
    'the chips are pressed, not selected — the grid is a list, not a panel',
    (await grid.locator('button:text-is("Everything")').getAttribute('aria-pressed')) === 'true' &&
      (await grid.locator('button:text-is("Brand")').getAttribute('role')) !== 'tab',
    'filter chips'
  );
  await grid.close();

  /* -------------------------------------- 10. a stepper, whose Next is not a toggle */

  await page.bringToFront();
  await insert('Stepper');
  await publish(page);

  const flow = await ctx.newPage();
  await flow.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  await flow.waitForTimeout(300);

  const step = () =>
    flow.evaluate(
      () => document.querySelector('[data-cre8-switch="step"]')?.getAttribute('data-cre8-value') ?? ''
    );

  report.check('it opens on the first step', (await step()) === 'account', await step());
  report.check(
    'Continue moves the flow on without claiming to be a toggle',
    (await flow.locator('button:text-is("Continue")').first().getAttribute('aria-pressed')) === null,
    'no aria-pressed'
  );
  report.check(
    'while the numbered markers are toggles, because they are',
    (await flow.locator('button:text-is("1. Account")').getAttribute('aria-pressed')) === 'true'
  );

  await flow.locator('button:text-is("Continue")').first().click();
  await flow.waitForTimeout(220);
  report.check('Continue advances', (await step()) === 'workspace', await step());
  await flow.locator('button:text-is("Back")').first().click();
  await flow.waitForTimeout(220);
  report.check('Back returns', (await step()) === 'account', await step());
  await flow.locator('button:text-is("3. Invite")').click();
  await flow.waitForTimeout(220);
  report.check('and a marker jumps straight there', (await step()) === 'invite', await step());

  report.check(
    'every step’s fields are in the page the whole time, so the form posts once',
    (await flow.locator('form input').count()) === 5,
    `${await flow.locator('form input').count()} inputs`
  );
  await flow.close();

  /* --------------------------- 11. reaching a case that is not on screen */

  // The editing problem the switch creates. A case that is not current is
  // `display: none`, so it has no box — selecting it from the layer tree used
  // to outline nothing, and the eye in the tree looked broken because dimming
  // something already invisible changes nothing. Selection drives the switch
  // now, in both directions.
  await page.bringToFront();
  await page.locator('button[aria-label="Layers"]').first().click();
  await page.waitForTimeout(600);

  const boxOf = (name) =>
    page.evaluate((layerName) => {
      const frame = document.querySelector('.cre8-frame.cre8-editing');
      const match = [...(frame?.querySelectorAll('[data-cre8-case]') ?? [])].find((el) =>
        (el.textContent ?? '').includes(layerName)
      );
      return match ? match.getBoundingClientRect().height : -1;
    }, name);

  report.check(
    'the third step is off screen to begin with',
    (await boxOf('Bring the team in')) === 0,
    `height ${await boxOf('Bring the team in')}`
  );

  // Reached through the tree, which is the path that used to dead-end. The
  // list is virtualised, so the row does not exist in the DOM until it is
  // scrolled near — the same reason a person has to scroll to it.
  const inviteRow = await layerRow('Invite step');
  if (!report.check('the tree can be scrolled to a case that is not on screen', inviteRow !== null))
    throw new Error('layer row "Invite step" never appeared');
  await inviteRow.click();
  await page.waitForTimeout(700);
  report.check(
    'selecting it in the layer tree brings it forward',
    (await boxOf('Bring the team in')) > 0,
    `height ${await boxOf('Bring the team in')}`
  );

  const outlined = await page.evaluate(() => {
    const sel = document.querySelector('[data-cre8-selection]');
    return sel ? sel.getBoundingClientRect().height : -1;
  });
  report.check(
    'so the selection outline lands on something rather than nothing',
    outlined > 0,
    `outline ${outlined}px tall`
  );

  // The other direction: clicking a tab shows its panel, which is what a
  // designer expects from clicking a tab.
  const buildTab = page.locator('.cre8-frame.cre8-editing button:text-is("Build")').first();
  await buildTab.click();
  await page.waitForTimeout(700);
  const tabShown = await page.evaluate(
    () =>
      document
        .querySelector('.cre8-frame.cre8-editing [data-cre8-tabs], .cre8-frame.cre8-editing [data-cre8-switch-all]')
        ?.getAttribute('data-cre8-value') ?? ''
  );
  report.check('selecting a tab on the canvas shows its panel', tabShown === 'build', tabShown);

  /* ------------------------------------------- 12. all cases, side by side */

  // The x-ray. Done by renaming the group's attribute rather than overriding
  // `display`, so each case keeps its own layout — an override would have had
  // to guess what to put back.
  // Clicking the tab selected the tab, not the set, so the switch panel needs
  // the group — which is what the layer tree is for.
  const groupRow = await layerRow('stage tabs');
  if (!report.check('the tab set is reachable in the tree', groupRow !== null))
    throw new Error('layer row "stage tabs" never appeared');
  await groupRow.click();
  await page.waitForTimeout(600);

  report.check(
    'and offers a switch panel',
    (await page.locator('button:has(.panel-title:text-is("Switch"))').count()) === 1
  );
  await page.locator('button:text-is("All")').last().click();
  await page.waitForTimeout(700);

  const all = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const group = frame?.querySelector('[data-cre8-switch-all]');
    const cases = [...(group?.querySelectorAll('[data-cre8-case]') ?? [])];
    return {
      renamed: Boolean(group) && !group.hasAttribute('data-cre8-switch'),
      visible: cases.filter((el) => el.getBoundingClientRect().height > 0).length,
      total: cases.length,
      // Each panel keeps the display its own rule gave it, which is the whole
      // reason for renaming rather than overriding.
      displays: [...new Set(cases.map((el) => getComputedStyle(el).display))].join(','),
    };
  });
  report.check(
    'every case is laid out at once',
    all.visible === all.total && all.total === 3,
    `${all.visible} of ${all.total}`
  );
  report.check('the group stops being a switch rather than being overridden', all.renamed);
  report.check(
    'and no case had its own display trampled to get there',
    !all.displays.includes('block') || all.displays === 'grid',
    all.displays
  );

  await publish(page);
  const xray = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'the working view never reaches a published file',
    !xray.includes('data-cre8-switch-all') && xray.includes('data-cre8-switch="stage"'),
    xray.includes('data-cre8-switch-all') ? 'leaked' : 'edit-only'
  );

  /* --------------------------------------------- 13. “isn’t”, and hiding itself */

  // Two things a case could not say. `isn't` is the bigger one: written as
  // `is`, "clear the filter" would have to list the three categories and be
  // kept in step with them for ever.
  const clear = await ctx.newPage();
  await clear.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  const clearLink = clear.locator('a:text-is("Clear the filter")');

  report.check('the negated rule keys on the value rather than against it',
    xray.includes(
      ':where([data-cre8-switch="kind"]):where(:is([data-cre8-value~="all"]))'
    ),
    'isn’t compiled'
  );
  report.check('“clear the filter” is absent while showing everything',
    !(await clearLink.isVisible()),
    'hidden on all'
  );
  await clear.locator('button:text-is("Brand")').click();
  await clear.waitForTimeout(220);
  report.check('and appears for every category that is not it', await clearLink.isVisible());
  await clear.locator('button:text-is("Editorial")').click();
  await clear.waitForTimeout(220);
  report.check('including the next one, with nothing listing them', await clearLink.isVisible());
  await clear.locator('button:text-is("Everything")').click();
  await clear.waitForTimeout(220);
  report.check('and goes again on the way back', !(await clearLink.isVisible()));
  await clear.close();

  // A bar that closes itself. The state is on the bar, so the rule is one
  // compound selector rather than a descendant one — an element is not
  // inside itself, and this was simply impossible before.
  await page.bringToFront();
  await insert('Dismissible notice');
  await publish(page);
  const withNotice = await (await fetch(`${APP}/s/${id}/`)).text();

  report.check(
    'a self-hiding bar compiles to a compound selector, not a descendant one',
    /\.c-[a-z0-9]+:where\(\[data-cre8-switch="notice"\]\):where\(:not\(:is\(\[data-cre8-value~="shown"\]\)\)\) ?\{/.test(
      withNotice
    ),
    'no space before the class'
  );

  const notice = await ctx.newPage();
  await notice.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });
  const bar = notice.locator('[data-cre8-switch="notice"]');
  report.check('it starts on screen', await bar.isVisible());
  await notice.locator('[data-cre8-switch="notice"] button').click();
  await notice.waitForTimeout(220);
  report.check('and closes itself', !(await bar.isVisible()));
  report.check(
    'the close button is not announced as a toggle',
    (await notice.locator('[data-cre8-switch="notice"] button').getAttribute('aria-pressed')) ===
      null
  );
  await notice.close();
} catch (error) {
  report.check('behaviour suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
