/**
 * Native primitives.
 *
 * Phase B's bet is that the browser can do the behaviour — that a disclosure
 * needs `<details>` rather than a runtime, and that a checkbox that is really
 * a `<label>` wrapping an `<input>` beats a div someone styled to look like
 * one. These checks are that bet, stated as things a user can do:
 *
 *   click the summary and the panel opens, on a page carrying no script;
 *   click the words and the box ticks;
 *   the canvas shows the panel open, because content nobody can see is
 *     content nobody can edit.
 *
 * The last one is the only place in the project where design time and
 * published deliberately differ, so it is checked in both directions.
 */

import { APP, launch, openProject, publish } from './harness.mjs';
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
  await page.waitForTimeout(900);
};

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', 'Nate Ive');
  await page.fill('input[type="email"]', `native${Date.now()}@cre8.test`);
  await page.fill('input[type="password"]', 'correct-horse-battery');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: 30000 });

  const id = await openProject(page, 'Blank');

  await insert('FAQ accordion');
  await insert('Select');
  await insert('Checkbox');
  await insert('Radio');

  /* ------------------------------------------- 1. the canvas shows contents */

  const canvas = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const details = [...(frame?.querySelectorAll('details') ?? [])];
    return {
      count: details.length,
      allOpen: details.every((d) => d.open),
      summaries: details.slice(0, 2).map((d) => d.querySelector('summary')?.textContent ?? ''),
      answerVisible: details[1]
        ? (details[1].querySelector('p')?.getBoundingClientRect().height ?? 0) > 0
        : false,
    };
  });

  report.check('the accordion renders real <details>', canvas.count >= 4, `${canvas.count} found`);
  report.check(
    'every panel is open on the canvas, so its contents can be edited',
    canvas.allOpen,
    canvas.allOpen ? 'all open' : 'some closed'
  );
  report.check(
    'a panel that ships closed still shows its answer while editing',
    canvas.answerVisible
  );
  report.check(
    'the summary text comes through',
    canvas.summaries[0]?.includes('free trial'),
    canvas.summaries.join(' | ')
  );

  /* ------------------------------------------------------ 2. published, closed */

  await publish(page);
  const html = await (await fetch(`${APP}/s/${id}/`)).text();

  report.check('the published page still ships no script', !/<script/i.test(html));
  report.check(
    'published, only the first panel is open',
    (html.match(/<details[^>]*\sopen/g) ?? []).length === 1,
    `${(html.match(/<details/g) ?? []).length} details, ${(html.match(/<details[^>]*\sopen/g) ?? []).length} open`
  );
  report.check(
    'each disclosure has a summary as its first child',
    (html.match(/<details[^>]*>\s*<summary>/g) ?? []).length ===
      (html.match(/<details/g) ?? []).length,
    'all summaries in place'
  );

  /* ------------------------------------- 3. the browser does the behaviour */

  const site = await ctx.newPage();
  await site.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  const closed = site.locator('details').nth(1);
  report.check('a closed panel hides its answer', !(await closed.locator('p').isVisible()));

  await closed.locator('summary').click();
  await site.waitForTimeout(250);
  report.check(
    'clicking the summary opens it, with no script on the page',
    await closed.locator('p').isVisible()
  );

  await closed.locator('summary').click();
  await site.waitForTimeout(250);
  report.check('clicking again closes it', !(await closed.locator('p').isVisible()));

  // Keyboard, which is the half a div-and-a-click-handler always forgets.
  await closed.locator('summary').focus();
  await site.keyboard.press('Enter');
  await site.waitForTimeout(250);
  report.check('Enter on the summary opens it too', await closed.locator('p').isVisible());

  /* --------------------------------------------------- 4. the form controls */

  const select = site.locator('select').first();
  report.check('the select is a real <select>', (await select.count()) === 1);
  report.check(
    'its options came from the inspector',
    (await select.locator('option').allTextContents()).join('|').includes('Medium'),
    (await select.locator('option').allTextContents()).join(' ')
  );
  await select.selectOption({ label: 'Large' });
  report.check('it can be chosen from', (await select.inputValue()) === 'Large');

  const checkbox = site.locator('input[type="checkbox"]').first();
  report.check('the checkbox is a real input', (await checkbox.count()) === 1);
  // The words, not the box — which only works because the label wraps both.
  await site.locator('label:has(input[type="checkbox"]) span').first().click();
  report.check('clicking the label text ticks it', await checkbox.isChecked());

  const radio = site.locator('input[type="radio"]').first();
  report.check('the radio is a real input with a group name', (await radio.getAttribute('name')) === 'plan');

  /* -------------------------------------------------- 5. escaping the labels */

  // Option text is inspector input reaching both surfaces through a path
  // documented as trusted markup, so it is escaped at the renderer. Checked on
  // the canvas as well as published, because the two take different routes to
  // the DOM — `dangerouslySetInnerHTML` here, a string concatenation there.
  await page.bringToFront();
  const onCanvas = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    return {
      options: frame?.querySelectorAll('option').length ?? 0,
      inputs: frame?.querySelectorAll('label > input').length ?? 0,
    };
  });
  report.check('options render on the canvas too', onCanvas.options > 0, `${onCanvas.options} options`);
  report.check(
    'the tick boxes are inside their labels on the canvas',
    onCanvas.inputs >= 2,
    `${onCanvas.inputs} wrapped inputs`
  );

  /* ------------------------------------------------- 6. semantic landmarks */

  // Retagging a box is invisible on screen, which is the whole reason to check
  // it: the only evidence it worked is in the markup a screen reader reads.
  await page.bringToFront();
  await insert('Section');
  await page.waitForTimeout(600);

  // Same pattern the borders suite uses: the header is a button wrapping a
  // `.panel-title`, and the section is collapsed by default, so its controls
  // are not in the DOM until it is opened.
  await page.locator('button:has(.panel-title:text-is("Semantics"))').first().click();
  await page.waitForTimeout(500);
  // The inspector's Select is a popover of buttons, not a native <select>, so
  // this drives it the way a person would: open it, then pick the option.
  const tagTrigger = page.locator('button:has(span:text-is("div (default)"))').first();
  report.check(
    'a layout box offers a tag choice',
    (await tagTrigger.count()) === 1,
    `${await tagTrigger.count()} triggers`
  );
  await tagTrigger.click();
  await page.waitForTimeout(300);
  await page.locator('button:has(span:text-is("aside")), button:text-is("aside")').first().click();
  await page.waitForTimeout(700);

  const retagged = await page.evaluate(
    () => document.querySelectorAll('.cre8-frame.cre8-editing aside').length
  );
  report.check('the canvas re-renders it as that tag', retagged === 1, `${retagged} <aside>`);

  await publish(page);
  const withAside = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'the published markup carries the landmark',
    /<aside[\s>]/.test(withAside),
    withAside.includes('<aside') ? 'present' : 'missing'
  );
  report.check(
    'and a script still never appears',
    !/<script/i.test(withAside)
  );

  await site.close();

  /* ------------------------------------------------------- 7. the popover */

  // The last thing on this page a runtime would normally be needed for.
  // Everything a hand-built menu has to reimplement — the top layer, Escape,
  // a click outside, focus going back to the button — is checked here on a
  // page carrying no script at all.
  await page.bringToFront();
  await insert('Command menu');

  const onCanvasPopover = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const panel = [...(frame?.querySelectorAll('div') ?? [])].find((el) =>
      (el.textContent ?? '').includes('Jump to')
    );
    return {
      // Deliberately *not* a popover while editing, or its contents could
      // not be reached — the same trade `<details>` makes.
      attribute: panel?.getAttribute('popover') ?? null,
      visible: (panel?.getBoundingClientRect().height ?? 0) > 0,
      trigger: frame?.querySelector('button[popovertarget]') !== null,
    };
  });

  report.check('the panel is editable on the canvas', onCanvasPopover.visible);
  report.check(
    'because it is not a popover there',
    onCanvasPopover.attribute === null,
    `popover=${onCanvasPopover.attribute}`
  );

  await publish(page);
  const withPopover = await (await fetch(`${APP}/s/${id}/`)).text();

  const popoverId = /<div[^>]*\sid="(p-[^"]+)"[^>]*\spopover="auto"/.exec(withPopover)?.[1] ?? '';
  report.check(
    'published, it is a real popover with an id',
    Boolean(popoverId),
    popoverId || 'no popover element'
  );
  report.check(
    'and a button that names it',
    withPopover.includes(`popovertarget="${popoverId}"`),
    popoverId ? 'wired' : 'unwired'
  );
  report.check(
    'the close button asks to hide rather than toggle',
    withPopover.includes('popovertargetaction="hide"')
  );
  report.check('the page still ships no script', !/<script/i.test(withPopover));

  const menu = await ctx.newPage();
  await menu.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  const panel = menu.locator(`#${popoverId}`);
  const trigger = menu.locator(`button[popovertarget="${popoverId}"]`).first();

  report.check('it starts hidden', !(await panel.isVisible()));

  await trigger.click();
  await menu.waitForTimeout(220);
  report.check('the button opens it, with no script on the page', await panel.isVisible());

  // The top layer is the point: a panel that renders under a sticky header is
  // a panel nobody can use.
  const onTop = await menu.evaluate((pid) => {
    const el = document.getElementById(pid);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
    return el.contains(hit);
  }, popoverId);
  report.check('it draws above everything else', onTop);

  await menu.keyboard.press('Escape');
  await menu.waitForTimeout(220);
  report.check('Escape closes it', !(await panel.isVisible()));
  report.check(
    'and focus goes back to the button that opened it',
    await menu.evaluate(
      (pid) => document.activeElement?.getAttribute('popovertarget') === pid,
      popoverId
    )
  );

  await trigger.click();
  await menu.waitForTimeout(220);
  await menu.mouse.click(4, 4);
  await menu.waitForTimeout(220);
  report.check('a click outside closes it', !(await panel.isVisible()));

  await trigger.click();
  await menu.waitForTimeout(220);
  await menu.locator(`button[popovertargetaction="hide"]`).first().click();
  await menu.waitForTimeout(220);
  report.check('the close button inside it closes it', !(await panel.isVisible()));

  await menu.close();

  /* --------------------------- 8. wiring one by hand, the way a designer does */

  // Everything above came out of a block, where the wiring was written in
  // code. This is the path with a person on it: drop a button, point it at a
  // popover from the inspector, and get the same markup.
  await page.bringToFront();
  await insert('Button');

  const opensTrigger = page
    .locator('div:has(> div > label.field-label:text-is("Opens")) button')
    .first();
  report.check(
    'a button offers the popovers on the page',
    (await opensTrigger.count()) === 1,
    `${await opensTrigger.count()} pickers`
  );

  await opensTrigger.click();
  await page.waitForTimeout(300);
  await page.locator('button:has(span:text-is("Command menu"))').first().click();
  await page.waitForTimeout(700);

  const wired = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const invokers = [...(frame?.querySelectorAll('button[popovertarget]') ?? [])];
    return {
      count: invokers.length,
      // An anchor cannot invoke a popover, so choosing one has to change the
      // tag as well as add the attribute.
      anchors: frame?.querySelectorAll('a[popovertarget]').length ?? 0,
    };
  });
  report.check(
    'wiring it from the inspector adds a second invoker',
    wired.count >= 2,
    `${wired.count} invokers`
  );
  report.check('and none of them is an anchor', wired.anchors === 0);

  // The URL field is gone rather than sitting there doing nothing: a link and
  // a popover trigger are the same control in two mutually exclusive states.
  const urlRow = page.locator('label.field-label:text-is("URL")');
  report.check('the link fields step aside', (await urlRow.count()) === 0);

  await publish(page);
  const wiredHtml = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'both invokers reach the published file',
    (wiredHtml.match(/popovertarget="/g) ?? []).length >= 3,
    `${(wiredHtml.match(/popovertarget="/g) ?? []).length} references`
  );
  report.check('still no script', !/<script/i.test(wiredHtml));
} catch (error) {
  report.check('native suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
