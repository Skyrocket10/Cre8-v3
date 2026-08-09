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
    html.includes('[data-cre8-switch="billing"]:not([data-cre8-value="annual"])'),
    'rule present'
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
} catch (error) {
  report.check('behaviour suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
