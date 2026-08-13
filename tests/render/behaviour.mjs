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

import {
  APP,
  getDocument,
  launch,
  node,
  openInspectorSection,
  openProject,
  publish,
  saveDocument,
  signUp,
  unbalanced,
} from './harness.mjs';
import { createReport } from '../report.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/**
 * Every generated selector that tests a state, from a published page.
 *
 * Read out of the stylesheet, not out of the document, and that is the whole
 * of the fix this once needed. It used to scan the file line by line for one
 * ending in `{` — which worked on a pretty-printed stylesheet and found
 * *nothing at all* on a published page, because a published page is one line.
 * `.every()` over an empty list is true, so the check below reported a pass
 * for as long as it existed and would have kept doing so.
 *
 * It surfaced when publishing moved to the Worker: the inlined runtime carries
 * newlines, the first of them lands mid-document, and the pattern suddenly
 * matched a "selector" that was the whole page. A check that only starts
 * failing when something unrelated changes was never checking anything.
 */
const conditionalSelectors = (html) => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  // Each rule's selector is what sits between the previous `}` (or the start,
  // or an at-rule's `{`) and this rule's `{`.
  return [...css.matchAll(/(?:^|[{}])\s*([^{}]*\[data-cre8-switch[^{}]*?)\s*\{/g)].map((m) => m[1]);
};

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
  const group = root.querySelector('[data-cre8-switch]');
  const value = group?.getAttribute('data-cre8-value') ?? '';

  const shown = [];
  for (const el of root.querySelectorAll('[data-cre8-case]')) {
    if (el.getBoundingClientRect().height === 0) continue;
    // An element answering to "isn't annual" is on screen for whatever the
    // state actually holds, so that is the case it is showing. Without this
    // the base half of an expanded pair would report the value it is *not*.
    shown.push(el.hasAttribute('data-cre8-not') ? value : el.getAttribute('data-cre8-case'));
  }
  return {
    value,
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

  /*
   * What the runtime is allowed to cost, as a number rather than a feeling.
   *
   * Raised twice, and both arguments are kept because the number only means
   * something if raising it costs something.
   *
   * From 3000, when copying to the clipboard arrived — the one action in the
   * set with no element behind it, and therefore the only one that can only be
   * done here.
   *
   * From 3200, when a node whose content varies turned out to publish as more
   * than one element. The mark went on the element that was pressed, its
   * sibling's rule said "hide unless *I* am marked", and the control vanished
   * on click. Marking every element of the node is the fix and it costs a class
   * lookup and a loop. It went to 3308 first; collapsing two functions into one
   * brought it to 3233, and the rest is structural — string literals and a
   * `querySelectorAll` — so this is what the correct version weighs.
   *
   * From 3250, when a control learned to say *which* state it sets and to set
   * more than one. This is the biggest of the three and the argument is the
   * plainest: without it a setter drives whatever `[data-cre8-switch]` is
   * nearest, and there is no way at all to reach past it — so a link inside a
   * mobile nav cannot close the nav, which is the most ordinary interaction a
   * phone has. It went to 3744 with the grammar read in two places; folding
   * those into one reader brought it to 3653, and what is left is the parse,
   * the ancestor-then-page lookup, and the loop that keeps `aria-pressed`
   * honest for a control that touches two states.
   *
   * The number still sits just above that, deliberately, so the next thing to
   * grow it trips this immediately and has to make the same argument.
   *
   * The published copy is minified, which is worth knowing before trying to fix
   * a failure here by deleting comments or shortening names — neither saves
   * anything at all.
   */
  const RUNTIME_BUDGET = 3680;
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  report.check(
    'and it is small enough to be read in one sitting',
    source.length > 0 && source.length < RUNTIME_BUDGET,
    `${source.length} bytes of ${RUNTIME_BUDGET}`
  );
  report.check(
    'it is inline, so there is no second request and nothing to cache-bust',
    !/<script[^>]*\ssrc=/i.test(html)
  );

  /* ----------------------------------- 3. both prices are in the file, always */

  /*
   * The stage-2 gate, stated as the property rather than the mechanism.
   *
   * One price node per tier now, saying something different when the state
   * moves — `set` on a rule rather than two nodes with opposite cases. What
   * has to survive that is exactly what the duplication bought: every string
   * in the file, so a crawler indexes both, a printout is right, and a reader
   * with no JavaScript sees prices rather than a gap.
   */
  const priced = (value) => new RegExp(`>\\${value}<`).test(html);
  report.check(
    'both prices are in the markup — the hidden one is styled away, not dropped',
    priced('$19') && priced('$15') && priced('$49') && priced('$39'),
    [
      ['$19', '$15', '$49', '$39'].filter(priced).join(' '),
      'of $19 $15 $49 $39',
    ].join(' ')
  );
  report.check(
    'and so is the cadence that goes with each',
    html.includes('/month, billed yearly') && /,?>\/month</.test(html),
    'both cadences'
  );
  report.check(
    'one node per price, not one per price per state — the duplication is at render',
    (html.match(/data-cre8-case="annual"/g) ?? []).length === 13,
    `${(html.match(/data-cre8-case="annual"/g) ?? []).length} conditional elements`
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
  /*
   * One class, and nothing else.
   *
   * `-v0` is part of it: a node whose rules change its content renders as one
   * element per alternative, and each carries `c-<id>-v<n>` alongside the node
   * class. That is still a single class and still weighs (0,1,0) — the point
   * of the whole `:where()` discipline — so it belongs here. It was missing
   * until the check above started running, which is what a vacuous check
   * costs: the pattern had quietly been wrong since variants shipped.
   *
   * Merged rules name several elements at once, so each part is judged on its
   * own — one compound out of ten carrying stray specificity is still the bug.
   */
  const ONE_CLASS = /^\s*\.c-[a-z0-9]+(-v[0-9]+)?(::[a-z-]+)?\s*$/;
  const bare = (selector) => withoutWhere(selector).split(',').every((part) => ONE_CLASS.test(part));

  const conditional = conditionalSelectors(html);
  report.check(
    'there are conditional selectors to weigh in the first place',
    conditional.length >= 4,
    `${conditional.length} found`
  );
  report.check(
    'and each weighs no more than the element’s own styles, so order is precedence',
    conditional.length > 0 && conditional.every(bare),
    conditional.map(withoutWhere).find((rest) => !bare(rest)) ?? 'all padded'
  );
  // The rules that keep the one above honest: it has to accept what it should
  // and reject what it should, and neither is obvious from reading it.
  report.check(
    'a variant class counts as one class, because it is one',
    bare(':where([data-cre8-switch="billing"]) .c-abc123-v1'),
    'accepted'
  );
  report.check(
    'a selector carrying real specificity would be caught',
    !bare(':where([data-cre8-switch="billing"]) .c-abc123[data-cre8-value~="annual"]') &&
      !bare(':where([data-cre8-switch="billing"]) .c-abc123, .c-def456 span'),
    'the check can fail'
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

  report.check('the group offers a switch panel', await openInspectorSection(page, 'Switch'));
  await page.locator('button:text-is("annual")').last().click();
  await page.waitForTimeout(700);

  const afterSwitch = await page.evaluate(VISIBLE_PRICES);
  report.check(
    'choosing the other case on the canvas reveals it for editing',
    afterSwitch.cases === 'annual',
    afterSwitch.cases
  );

  /*
   * A price is one node that renders as two elements, and only one of them has
   * a box. The editor has to attach to that one — the id it selects by and the
   * ref it measures from — or clicking the price on screen would select
   * nothing and the outline would be drawn around a collapsed box.
   */
  const attached = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing') ?? document.body;
    const isVariant = (el) => /\bc-[a-z0-9]+-v[0-9]+\b/.test(el.className);
    const all = [...frame.querySelectorAll('[class*="-v"]')].filter(isVariant);
    const marked = all.filter((el) => el.hasAttribute('data-cre8-id'));
    return {
      elements: all.length,
      marked: marked.length,
      hidden: marked.filter((el) => el.getBoundingClientRect().height === 0).length,
      text: marked.map((el) => el.textContent).join(' '),
    };
  });
  // Three tiers, an amount and a cadence each: six nodes, twelve elements,
  // and exactly six of them — one per node — carrying an id.
  report.check(
    'exactly one element of each expanded pair answers to the editor',
    attached.elements === 12 && attached.marked === 6 && attached.hidden === 0,
    `${attached.marked} of ${attached.elements} attached, ${attached.hidden} with no box`
  );
  report.check(
    'and it is the copy the designer can actually see',
    attached.text.includes('$15') && !attached.text.includes('$19'),
    attached.text.trim().slice(0, 60)
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

  report.check('and offers a switch panel', await openInspectorSection(page, 'Switch'));
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

  /* ------------------------------------------------------------------------
   * A value that is a number
   *
   * Everything above is a state machine over names. This is the one thing it
   * could not hold, and the two promises it has to keep are the same: the page
   * looks right before any script runs, and CSS does the drawing.
   * --------------------------------------------------------------------- */

  await insert('Before and after');
  await publish(page);

  /*
   * The number, and what it is doing.
   *
   * `clip` is found by *asking every element* which one is clipped rather than
   * by guessing which it is — the comparison stacks two identical images and
   * the rule lands on the upper one through its class, so a selector picking
   * "the image" picks the wrong one half the time. It did, on the first run,
   * and reported the feature broken while it was working.
   */
  const readSplit = (target, selector) =>
    target.evaluate((sel) => {
      const group = document.querySelector(sel);
      if (!group) return null;
      let clip = '';
      for (const el of group.querySelectorAll('*')) {
        const value = getComputedStyle(el).clipPath;
        if (value && value !== 'none') clip = value;
      }
      return { held: getComputedStyle(group).getPropertyValue('--cre8-split').trim(), clip };
    }, selector);

  const live = await ctx.newPage();
  await live.setViewportSize({ width: 1200, height: 900 });
  await live.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  await live.waitForTimeout(300);

  const start = await readSplit(live, '[data-cre8-range="split"]');
  report.check(
    'the published page holds the number before anything is touched',
    start?.held === '50',
    `--cre8-split: ${start?.held ?? 'absent'}`
  );
  report.check(
    'and something on screen is actually using it',
    /inset\(/.test(start?.clip ?? ''),
    start?.clip || 'nothing clipped'
  );

  // Driven by the keyboard rather than a synthetic drag: the arrow keys are a
  // real interaction, they fire the same `input` event a pointer does, and
  // they are the half a hand-rolled drag handler would have got wrong.
  const slider = live.locator('[data-cre8-drive="split"]');
  await slider.focus();
  for (let i = 0; i < 10; i++) await slider.press('ArrowRight');
  await live.waitForTimeout(200);

  const moved = await readSplit(live, '[data-cre8-range="split"]');
  report.check(
    'the keyboard moves it, because the control is the platform’s own',
    moved?.held === '60',
    `--cre8-split: ${moved?.held ?? 'absent'}`
  );
  report.check(
    'and what is on screen moved with it',
    moved?.clip !== start?.clip && /inset\(/.test(moved?.clip ?? ''),
    `${start?.clip} → ${moved?.clip}`
  );
  report.check(
    'the slider says what it is, since the handle is the divider',
    ((await slider.getAttribute('aria-label')) ?? '').length > 8,
    (await slider.getAttribute('aria-label')) ?? 'unlabelled'
  );
  await live.close();

  /*
   * And with nothing running at all. Not a degraded mode to apologise for —
   * the number is in the markup, so a comparison opened from a ZIP is one
   * frozen at the split the designer chose, with the handle sitting on it.
   */
  const dead = await ctx.newPage({ javaScriptEnabled: false });
  await dead.setViewportSize({ width: 1200, height: 900 });
  await dead.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  const still = await readSplit(dead, '[data-cre8-range="split"]');
  report.check(
    'with scripting off the comparison still shows, at the chosen split',
    still?.held === '50' && /inset\(/.test(still?.clip ?? ''),
    `--cre8-split: ${still?.held ?? 'absent'}, ${still?.clip || 'nothing clipped'}`
  );
  report.check(
    'and the handle sits on it rather than at one end',
    (await dead.locator('[data-cre8-drive="split"]').inputValue()) === '50',
    `slider at ${await dead.locator('[data-cre8-drive="split"]').inputValue()}`
  );
  await dead.close();

  // The canvas holds the same number, from the same markup. Nothing here
  // drives it — a drag on the canvas is somebody reaching for the element —
  // but what is drawn has to match what will ship.
  const onCanvas = await readSplit(page, '.cre8-frame.cre8-editing [data-cre8-range="split"]');
  report.check(
    'and the canvas draws the same split the file does',
    onCanvas?.held === '50' && onCanvas?.clip === still?.clip,
    `canvas ${onCanvas?.clip} / file ${still?.clip}`
  );

  /* ------------------------------------ 8. a state decided by what is typed */

  /*
   * The runtime half of phase B, which is the first thing on this page that
   * the browser has to *evaluate* rather than relay. Everything else here is a
   * state machine over named values; this reads a form control and compares.
   *
   * So the three questions are the ones the design makes claims about: does it
   * answer while somebody types, does it fall back to what the file shipped
   * when nothing is running, and does the canvas agree with the file about the
   * state before anybody has typed anything.
   */
  {
    const doc = await getDocument(page, id);
    const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
    const root = doc.nodes[home.rootNodeId];

    Object.assign(doc.nodes, {
      frm0testaa: node('frm0testaa', 'frame', 'Signup', {
        parentId: root.id,
        children: ['inp0testbb', 'msg0testcc'],
        // The rule lives on the container, and the control it reads is inside
        // it. That is the scoping the interaction model gives: a rule
        // evaluates against its own node and descendants react to the state.
        props: { switchKey: 'signup', switchDefault: 'waiting' },
        assign: [
          {
            id: 'asg0test01',
            when: { kind: 'compare', left: { kind: 'input', name: 'email' }, op: 'notEmpty' },
            value: 'ready',
          },
        ],
        styles: { desktop: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '24px' } },
      }),
      inp0testbb: node('inp0testbb', 'input', 'Email', {
        parentId: 'frm0testaa',
        props: { name: 'email', placeholder: 'you@example.com' },
        styles: { desktop: { padding: '8px' } },
      }),
      msg0testcc: node('msg0testcc', 'paragraph', 'Prompt', {
        parentId: 'frm0testaa',
        props: { text: 'Type your email' },
        rules: [
          {
            id: 'rul0test01',
            when: [{ kind: 'state', key: 'signup', op: 'is', values: ['ready'] }],
            apply: { color: 'rgb(0, 128, 0)' },
          },
        ],
        styles: { desktop: { color: 'rgb(100, 100, 100)' } },
      }),
    });
    root.children.push('frm0testaa');

    const seeded = await saveDocument(page, doc);
    if (report.check('the document with a typed Test is accepted', seeded === 200, `HTTP ${seeded}`)) {
      await publish(page);
      const typedHtml = await (await fetch(`${APP}/s/${id}/`)).text();

      report.check(
        'the file ships the fallback state, not an answer it could not have',
        /data-cre8-switch="signup"[^>]*data-cre8-value="waiting"/.test(typedHtml),
        /data-cre8-value="waiting"/.test(typedHtml) ? 'waiting' : 'something else shipped'
      );
      report.check(
        'and the rule travels with it',
        typedHtml.includes('data-cre8-test') && typedHtml.includes('"kind":"compare"'),
        'the Test is in the page'
      );

      const typing = await ctx.newPage();
      await typing.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
      const group = typing.locator('[data-cre8-switch="signup"]');
      report.check(
        'before anything is typed the state is the one that shipped',
        (await group.getAttribute('data-cre8-value')) === 'waiting',
        (await group.getAttribute('data-cre8-value')) ?? 'absent'
      );

      await typing.locator('input[name="email"]').fill('someone@example.com');
      await typing.waitForFunction(
        () =>
          document.querySelector('[data-cre8-switch="signup"]')?.getAttribute('data-cre8-value') ===
          'ready',
        null,
        { timeout: 5000 }
      ).catch(() => {});
      report.check(
        'typing moves it',
        (await group.getAttribute('data-cre8-value')) === 'ready',
        (await group.getAttribute('data-cre8-value')) ?? 'absent'
      );
      // The state is only half of it. What a visitor sees is the CSS the state
      // drives, and that rule was written in the ordinary inspector.
      report.check(
        'and the ordinary style rule follows the state',
        (await typing
          .locator('[data-cre8-switch="signup"] p')
          .evaluate((el) => getComputedStyle(el).color)) === 'rgb(0, 128, 0)',
        await typing.locator('[data-cre8-switch="signup"] p').evaluate((el) => getComputedStyle(el).color)
      );

      await typing.locator('input[name="email"]').fill('');
      await typing.waitForFunction(
        () =>
          document.querySelector('[data-cre8-switch="signup"]')?.getAttribute('data-cre8-value') ===
          'waiting',
        null,
        { timeout: 5000 }
      ).catch(() => {});
      report.check(
        'and clearing it puts the state back where the file had it',
        (await group.getAttribute('data-cre8-value')) === 'waiting',
        (await group.getAttribute('data-cre8-value')) ?? 'absent'
      );
      await typing.close();

      const noScript = await ctx.newPage({ javaScriptEnabled: false });
      await noScript.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
      report.check(
        'with scripting off the fallback is what a visitor gets, and keeps',
        (await noScript
          .locator('[data-cre8-switch="signup"]')
          .getAttribute('data-cre8-value')) === 'waiting',
        'the declared Otherwise, which is why the editor requires one'
      );
      report.check(
        'and the page is still usable rather than broken',
        await noScript.locator('input[name="email"]').isVisible(),
        'the form is there; only the flourish is missing'
      );
      await noScript.close();
    }
  }

  /*
   * A control that names the state it drives, and one that drives two.
   *
   * The two things a prop could not express, and between them the reason a
   * link inside a mobile nav could not close the nav: a setter drove whatever
   * `[data-cre8-switch]` was nearest, and there was nowhere to say which one
   * was meant. Proved by clicking, because "the attribute is in the file" is a
   * claim about the generator and this is a claim about the runtime.
   */
  {
    const doc = await getDocument(page, id);
    const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
    const root = doc.nodes[home.rootNodeId];

    Object.assign(doc.nodes, {
      // The outer group: a nav that is open or shut.
      nav0acts01: node('nav0acts01', 'frame', 'Nav', {
        parentId: root.id,
        children: ['pan0acts02'],
        props: { switchKey: 'nav', switchDefault: 'open' },
        styles: { desktop: { display: 'flex', flexDirection: 'column', padding: '20px' } },
      }),
      // The inner one, nested inside it, which is what `closest()` would find.
      pan0acts02: node('pan0acts02', 'frame', 'Panel', {
        parentId: 'nav0acts01',
        children: ['btn0acts03', 'btn0acts04', 'btn0acts05'],
        props: { switchKey: 'pane', switchDefault: 'one' },
        styles: { desktop: { display: 'flex', gap: '8px' } },
      }),
      // Reaches past the group it is inside, to the one it names.
      btn0acts03: node('btn0acts03', 'button', 'Close', {
        parentId: 'pan0acts02',
        props: { label: 'Shut the nav' },
        events: [
          { event: 'onClick', actions: [{ type: 'setState', state: 'nav', value: 'shut' }] },
        ],
      }),
      // Two states in one press, one named and one nearest.
      btn0acts04: node('btn0acts04', 'button', 'Go', {
        parentId: 'pan0acts02',
        props: { label: 'Go to two and close' },
        events: [
          {
            event: 'onClick',
            actions: [
              { type: 'setState', state: 'nav', value: 'shut' },
              { type: 'setState', value: 'two' },
            ],
          },
        ],
      }),
      // The unchanged spelling, beside them, so the common case is measured on
      // the same page rather than assumed from the other checks.
      btn0acts05: node('btn0acts05', 'button', 'Show pane one', {
        parentId: 'pan0acts02',
        props: { label: 'Show pane one', switchSet: 'one' },
      }),
    });
    root.children.push('nav0acts01');

    const saved = await saveDocument(page, doc);
    if (report.check('the document with named actions is accepted', saved === 200, `HTTP ${saved}`)) {
      await publish(page);
      const actHtml = await (await fetch(`${APP}/s/${id}/`)).text();

      report.check(
        'a named assignment reaches the file as one',
        /data-cre8-set="nav:shut"/.test(actHtml) && /data-cre8-set="nav:shut two"/.test(actHtml),
        [...actHtml.matchAll(/data-cre8-set="([^"]*)"/g)].map((m) => m[1]).join(' | ') || 'none',
      );
      report.check(
        'and the shorthand beside it is still the bare value it always was',
        /data-cre8-set="one"/.test(actHtml),
        /data-cre8-set="one"/.test(actHtml) ? 'one' : 'the plain setter changed spelling'
      );

      const acting = await ctx.newPage();
      await acting.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
      const nav = acting.locator('[data-cre8-switch="nav"]');
      // Scoped to the group, because the page already carries an inserted
      // pricing block and a bare role query reaches its buttons too.
      const inNav = (name) => nav.getByRole('button', { name });
      const pane = acting.locator('[data-cre8-switch="pane"]');

      report.check(
        'both groups start where the file put them',
        (await nav.getAttribute('data-cre8-value')) === 'open' &&
          (await pane.getAttribute('data-cre8-value')) === 'one',
        `nav=${await nav.getAttribute('data-cre8-value')} pane=${await pane.getAttribute('data-cre8-value')}`
      );

      await inNav('Shut the nav').click();
      await acting.waitForTimeout(120);
      report.check(
        'a control inside the inner group can close the outer one it names',
        (await nav.getAttribute('data-cre8-value')) === 'shut' &&
          (await pane.getAttribute('data-cre8-value')) === 'one',
        // The whole point: `closest()` would have found `pane`, and before the
        // axis existed that was the only group a control could reach.
        `nav=${await nav.getAttribute('data-cre8-value')} (the named one) ` +
          `pane=${await pane.getAttribute('data-cre8-value')} (the nearest, untouched)`
      );

      // Put it back, so the next click is measured from a known place rather
      // than from whatever the last one left.
      await inNav('Show pane one').click();
      await acting.evaluate(() => {
        document.querySelector('[data-cre8-switch="nav"]').setAttribute('data-cre8-value', 'open');
      });
      await inNav('Go to two and close').click();
      await acting.waitForTimeout(120);
      report.check(
        'and one press can move two states at once',
        (await nav.getAttribute('data-cre8-value')) === 'shut' &&
          (await pane.getAttribute('data-cre8-value')) === 'two',
        `nav=${await nav.getAttribute('data-cre8-value')} pane=${await pane.getAttribute('data-cre8-value')}`
      );

      report.check(
        'the control that touches two states is still announced against its own',
        // `aria-pressed` describes the button, and the only state it can
        // sensibly describe is the one it sits in. A setter whose assignment
        // for *this* group matches the current value reads as pressed.
        (await acting
          .getByRole('button', { name: 'Go to two and close' })
          .getAttribute('aria-pressed')) === 'true',
        `aria-pressed=${await inNav('Go to two and close').getAttribute('aria-pressed')}` +
          `, pane=${await pane.getAttribute('data-cre8-value')}`
      );
      report.check(
        'and the plain setter beside it is announced as not pressed',
        (await inNav('Show pane one').getAttribute('aria-pressed')) ===
          'false',
        // Otherwise the check above proves only that the attribute exists.
        `aria-pressed=${await inNav('Show pane one').getAttribute('aria-pressed')}`
      );

      const closeBtn = inNav('Shut the nav');
      report.check(
        'a control that only reaches outward claims no pressed state at all',
        (await closeBtn.getAttribute('aria-pressed')) === null,
        // It has no on state, only an errand — and "Close, toggle button, not
        // pressed" describes something the button is not.
        `aria-pressed=${String(await closeBtn.getAttribute('aria-pressed'))}`
      );
      await acting.close();

      const stillWorks = await ctx.newPage({ javaScriptEnabled: false });
      await stillWorks.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
      report.check(
        'with scripting off both groups are simply what the file said',
        (await stillWorks
          .locator('[data-cre8-switch="nav"]')
          .getAttribute('data-cre8-value')) === 'open' &&
          (await stillWorks
            .locator('[data-cre8-switch="pane"]')
            .getAttribute('data-cre8-value')) === 'one',
        'the defaults ship in the markup, so a page with no script is a page at rest'
      );
      await stillWorks.close();
    }
  }
} catch (error) {
  report.check('behaviour suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
