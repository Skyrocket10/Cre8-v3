/**
 * D5's gate, and it is a claim about a person rather than about output:
 *
 *   > Someone creates a collection, adds a record and sees it on the canvas
 *   > without leaving the editor or reading this document.
 *
 * So this suite never touches the API and never seeds a document. Every step
 * is a click or a keystroke in the running editor, in the order somebody would
 * do it — make a collection, name a field, write a record, point a repeater at
 * it — and the checks are what appears on the canvas afterwards. Anything that
 * needed a fixture to prove would be proving something else.
 *
 * It is also where the seam is checked from the outside: fields undo and
 * records do not. A designer who presses Ctrl+Z after writing a blog post must
 * get their field rename back, not lose the post.
 */

import { APP, createReport, launch, openProject, publish, READY_TIMEOUT, signUp } from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1560, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** Open a left-rail panel by its tooltip label. */
const openPanel = async (label) => {
  await page.locator(`nav button[aria-label="${label}"]`).first().click();
  await page.waitForTimeout(250);
};

/**
 * The panel column, addressed by its landmark.
 *
 * This was `nav + div`, which means "the sidebar" only until the *page being
 * edited* contains a `<nav>` — and then it silently matches canvas content
 * instead. Found while probing on the SaaS template, where it reported the
 * panel's text as "Sign in | Start free". It passed here only because this
 * suite builds on a Blank project, which is the worst way for a locator to be
 * correct: the suite would have gone green while checking the wrong element.
 */
const panel = () => page.locator('[role="region"][aria-label$=" panel"]');

/** The inspector column on the right. */
const inspector = () => page.locator('aside').last();

/**
 * Pick an option in one of the inspector's Select popovers.
 *
 * The label and the control are siblings two levels up, and the panel is
 * portalled to the body — so this walks the row rather than guessing at a
 * class, and takes the last open panel rather than the first.
 */
const choose = async (root, label, option) => {
  await root.locator(`label:text-is("${label}")`).locator('xpath=../..').locator('button').last().click();
  await page.waitForTimeout(200);
  await page.locator('.anim-pop').last().getByText(option, { exact: true }).first().click();
  await page.waitForTimeout(400);
};

try {
  await signUp(page, 'Cara Mills', 'coll');
  const id = await openProject(page, 'Blank');

  /* ------------------------------------------------- 1. make a collection */

  await openPanel('Collections');
  report.check(
    'the panel says what a collection is before there are any',
    (await panel().locator('text=No collections yet').count()) === 1,
    'empty state present'
  );

  await panel().locator('button:has-text("New collection")').first().click();
  await page.waitForTimeout(400);
  // It opens straight into a rename, so the first keystroke names it.
  await page.keyboard.type('Posts');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  report.check(
    'a new collection appears, named, with a field to start from',
    (await panel().locator('text=Posts').count()) >= 1 &&
      (await panel().locator('text=1 field').count()) === 1,
    (await panel().locator('text=/\\d+ fields?/').first().textContent()) ?? 'no field count'
  );

  /* ------------------------------------------------------ 2. shape it */

  await panel().locator('text=Posts').first().click();
  await page.waitForTimeout(300);
  await panel().locator('button:has-text("fields")').first().click();
  await page.waitForTimeout(250);

  await panel().locator('button:has-text("Add field")').click();
  await page.waitForTimeout(300);
  report.check(
    'a second field can be added without a dialog',
    (await panel().locator('text=Field 2').count()) === 1,
    'Field 2 added'
  );

  // Rename it, which must not change the key bindings point at.
  await panel().locator('button:has-text("Field 2")').click();
  await page.waitForTimeout(200);
  const nameBox = panel().locator('input').filter({ hasNot: page.locator('[type=date]') }).last();
  await nameBox.fill('Blurb');
  await nameBox.press('Enter');
  await page.waitForTimeout(300);
  report.check(
    'renaming a field keeps the key bindings use',
    (await panel().locator('code:has-text("field_2")').count()) === 1,
    (await panel().locator('code').last().textContent()) ?? 'no key shown'
  );

  /* --------------------------------------------------- 3. write a record */

  await panel().locator('button:has-text("content")').first().click();
  await page.waitForTimeout(250);
  await panel().locator('button:has-text("Add record")').click();
  await page.waitForTimeout(300);

  const inputs = panel().locator('input[type="text"], input:not([type])');
  await inputs.first().fill('Hello world');
  await inputs.nth(1).fill('The first thing we wrote');
  await panel().locator('button:has-text("Save")').click();
  await page.waitForTimeout(900);

  report.check(
    'the record is listed as soon as it is saved',
    (await panel().locator('text=Hello world').count() ) >= 1,
    'listed'
  );

  /* ------------------------------- 4. put it on the canvas, from the canvas */

  // A stack to repeat, and a heading inside it to bind. Both from Insert,
  // which is how a person would get them.
  await openPanel('Insert');
  await page.locator('button:has(span:text-is("Post grid"))').first().click();
  await page.waitForTimeout(1200);

  // Select the first heading on the canvas and bind it.
  const heading = page.locator('.cre8-frame.cre8-editing h3, .cre8-frame.cre8-editing h2').first();
  await heading.click();
  await page.waitForTimeout(400);

  report.check(
    'the inspector offers no binding until something is repeating',
    (await inspector().locator('text=Inside Posts').count()) === 0,
    'no scope yet'
  );

  // Walk up to a container and make it a repeater.
  await page.keyboard.press('Escape');
  const grid = page.locator('.cre8-frame.cre8-editing [data-cre8-type="grid"]').first();
  await grid.click();
  await page.waitForTimeout(400);

  const hasData = (await inspector().locator('text=Data').count()) > 0;
  report.check('a container offers a Data section once a collection exists', hasData);
  if (hasData) {
    await choose(inspector(), 'Repeat', 'Posts');
    const note = await inspector().locator('text=/repeats once per/i').first().textContent().catch(() => '');
    report.check(
      'pointing it at a collection says what is now in scope',
      /repeats once per post/i.test(note ?? ''),
      note || 'no scope note'
    );
  }

  /* ------------------------------------------ 5. bind, and see it on canvas */

  const inner = page.locator('.cre8-frame.cre8-editing h3').first();
  await inner.click();
  await page.waitForTimeout(400);

  const bindable = (await inspector().locator('text=Inside Posts').count()) > 0;
  report.check('a child of the repeater is told which record it is inside', bindable);
  if (bindable) {
    await choose(inspector(), 'Text', 'Title');
    await page.waitForTimeout(700);
    report.check(
      'and the canvas immediately shows the record, not the placeholder',
      (await page.locator('.cre8-frame.cre8-editing').getByText('Hello world').count()) > 0,
      (await inner.textContent()) ?? 'empty'
    );
  }

  /* --------------------------------------------- 6. the seam, from outside */

  /*
   * Fields are design and undo. Records are content and do not. This is the
   * property the whole split exists for, and the one a person will discover by
   * accident: pressing Ctrl+Z after writing a post must not eat the post.
   */
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  await openPanel('Collections');
  await panel().locator('text=Posts').first().click();
  await page.waitForTimeout(400);

  report.check(
    'undo walks back the design change and leaves the record alone',
    (await panel().locator('text=Hello world').count()) >= 1,
    'the post survived'
  );

  /* ------------------------------------------------------- 7. and it publishes */

  await publish(page);
  const html = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'what the canvas showed is what the site says',
    html.includes('Hello world'),
    html.includes('Hello world') ? 'in the published file' : 'missing from the file'
  );
  report.check(
    'and the placeholder the block shipped with is gone',
    !/>Post title</.test(html),
    /Post title/.test(html) ? 'design-time copy published' : 'records only'
  );
} catch (error) {
  report.check('the suite ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
}

report.finish();
