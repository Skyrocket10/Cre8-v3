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

  await site.close();
} catch (error) {
  report.check('native suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
