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

import {
  APP,
  createReport,
  launch,
  openInspectorSection,
  openProject,
  publish,
  READY_TIMEOUT,
  signUp,
} from './harness.mjs';

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

/**
 * Pick an option from a chip inside one of the inspector's sentences.
 *
 * Expressions are not rows any more, so there is no `<label>` to walk up from
 * — the sentence *is* the label. Addressed by the words it opens with, which
 * is how a person finds it too.
 */
const chooseInSentence = async (opening, current, option) => {
  const sentence = inspector().locator('[data-sentence]').filter({ hasText: opening }).first();
  await sentence.locator('button').filter({ hasText: current }).first().click();
  await page.waitForTimeout(250);
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

  /*
   * The element's own Text field is the evidence that the panel is populated
   * at all. An absence read off an empty panel is green whatever the editor
   * does — the same trap the link-fields check in `native` fell into.
   */
  const populated = (await inspector().locator('textarea').count()) > 0;
  report.check(
    'the inspector offers no binding until something is repeating',
    populated && (await inspector().locator('text=Inside Posts').count()) === 0,
    populated ? 'no scope yet' : 'the panel is showing nothing to read an absence from'
  );

  // Walk up to a container and make it a repeater.
  await page.keyboard.press('Escape');
  const grid = page.locator('.cre8-frame.cre8-editing [data-cre8-type="grid"]').first();
  await grid.click();
  await page.waitForTimeout(400);

  // A container can always start repeating, so Data is offered rather than
  // shown until it does — `openInspectorSection` adds it either way.
  const hasData = await openInspectorSection(page, 'Data');
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

  /*
   * A2's falsification, and nothing is opened to reach it.
   *
   * `docs/INSPECTOR.md` Rule 2 — content is part of Appearance — and this is
   * the whole of the claim: a heading is selected, and the sentence that fills
   * its words is already on screen, in the accordion holding the words
   * somebody typed there first. Content is essential on every element that has
   * any, so selecting it is the entire ceremony.
   *
   * Until A2 this read `openInspectorSection(page, 'Data')`, which is the same
   * check written when the answer was "somewhere else, and you have to know
   * where".
   */
  const contentBox = inspector().locator('section:has(> div .panel-title:text-is("Content"))');
  const bindable = (await contentBox.locator('text=Inside Posts').count()) > 0;
  report.check(
    'a heading is told which record it is inside, where its words are',
    bindable,
    (await contentBox.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140) ||
      'no Content section on screen'
  );
  /*
   * And the section it used to be in is not on screen at all — which is the
   * half that makes the first check mean something. A binding reachable from
   * Content *and* from Data would satisfy "bind a heading from Content" while
   * leaving Rule 2 exactly as false as it was.
   */
  report.check(
    'and nothing named after the database is on screen to reach it from',
    (await inspector().locator('.panel-title:text-is("Data")').count()) === 0,
    `${await inspector().locator('.panel-title:text-is("Data")').count()} Data section(s)`
  );
  if (bindable) {
    await chooseInSentence(/^Text reads/, /what is typed here/, 'Title');
    await page.waitForTimeout(700);
    report.check(
      'the binding reads as a sentence too',
      /^Text reads Title/.test(
        (
          (await inspector()
            .locator('[data-sentence]')
            .filter({ hasText: /^Text reads/ })
            .first()
            .textContent()
            .catch(() => '')) ?? ''
        )
          .replace(/\s+/g, ' ')
          .trim()
      ),
      (await inspector().locator('[data-sentence]').filter({ hasText: /^Text reads/ }).first().textContent()) ?? ''
    );
    report.check(
      'and the canvas immediately shows the record, not the placeholder',
      (await page.locator('.cre8-frame.cre8-editing').getByText('Hello world').count()) > 0,
      (await inner.textContent()) ?? 'empty'
    );
  }

  /* ------------------------------------ 5b. and the rule reads as a sentence */

  /*
   * The expression UI is chips in a line of prose rather than a stack of
   * labelled rows, which is a claim about legibility and therefore easy to
   * assert nothing about. So this asserts the two things that would actually
   * be broken if it went wrong: the sentence is *there* as one line of text
   * with the words in the right order, and picking a different operator from a
   * chip changes it.
   *
   * The inspector is about 280px wide, so the sentence wraps. Reading
   * `textContent` rather than looking at layout is deliberate — where the line
   * breaks is a design decision that will change, and a check pinned to it
   * would fail on a wording tweak while telling nobody anything.
   */
  if (bindable) {
    /*
     * Asked for, now that binding no longer brings it.
     *
     * Turning what a record says into a *state* is the other half of Data, and
     * it is still Data — it is what this element declares for the things
     * inside it, not what it looks like. Before A2 the section was already
     * open because the binding was in it, so this walked straight in; the
     * first run after the move skipped all five checks below on a silent
     * `if (count)` and took the undo check's meaning with it, because the last
     * thing on the stack was then the binding rather than a rule.
     */
    await openInspectorSection(page, 'Data');
    const addRule = inspector().locator('button:text-is("+ Rule")').first();
    report.check(
      'a record can put this element in a state, from the section it declares in',
      (await addRule.count()) === 1,
      `${await addRule.count()} offer(s) in Data`
    );
    if (await addRule.count()) {
      await addRule.click();
      await page.waitForTimeout(500);

      // The rule's sentence, not the binding's. There are several on the panel
      // now — which is the design working, and a reason for a check to say
      // which one it means.
      const rule = () => inspector().locator('[data-sentence]').filter({ hasText: /^When/ }).first();
      const sentence = async () =>
        (await rule().textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim() ?? '';

      const opened = await sentence();
      report.check(
        'a new rule arrives as a readable sentence rather than empty fields',
        /^When \S/.test(opened) && /\bthis is\b/.test(opened) && /\band it\b/.test(opened),
        opened || 'no sentence found'
      );

      // The operator chip. Found by the word it currently shows, which is the
      // whole point of the design — the control is the word.
      const opChip = rule().locator('button').filter({ hasText: /^is$/ }).first();
      if (await opChip.count()) {
        await opChip.click();
        await page.waitForTimeout(300);
        const option = page.locator('button').filter({ hasText: /^contains$/ }).last();
        if (await option.count()) {
          await option.click();
          await page.waitForTimeout(500);
        }
      }
      const changed = await sentence();
      report.check(
        'and a chip in it can be changed by picking the word you want',
        changed !== opened && /contains/.test(changed),
        `${opened} → ${changed}`
      );

      /*
       * Nesting. The model has always allowed `every` and `some`; the panel
       * could only say "all of 2 conditions hold" about them. The half worth
       * checking hardest is the way back — deleting down to one condition has
       * to leave that condition rather than a group with one member in it,
       * which is invisible in the evaluator and visible everywhere else.
       */
      const grow = rule().locator('button').filter({ hasText: '+ and' }).first();
      if (await grow.count()) {
        await grow.click();
        await page.waitForTimeout(500);
        const grouped = await sentence();
        report.check(
          'one condition can become two, under a group that says which it needs',
          /all of these hold/.test(grouped) && /\band\b/.test(grouped),
          grouped
        );

        const mode = rule().locator('button').filter({ hasText: 'all of these' }).first();
        if (await mode.count()) {
          await mode.click();
          await page.waitForTimeout(250);
          await page.locator('.anim-pop').last().getByText('any of these', { exact: true }).first().click();
          await page.waitForTimeout(450);
        }
        const anyOf = await sentence();
        report.check(
          'and all becomes any with one chip, not a rebuild',
          /any of these hold/.test(anyOf) && /\bor\b/.test(anyOf),
          anyOf
        );

        // Delete the second condition. It must unwrap, not leave a group of one.
        const drop = rule().locator('button[title="Remove this condition"]').last();
        if (await drop.count()) {
          await drop.click();
          await page.waitForTimeout(500);
        }
        const back = await sentence();
        report.check(
          'and deleting one back down leaves the condition, not a group of one',
          !/of these hold/.test(back) && /^When \S/.test(back),
          back
        );
      }
    }
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
  /* --------------------------------- 8. a template that arrives with content */

  /*
   * The other direction: not "can somebody write a record" but "does the
   * template already have some".
   *
   * A template ships fields in its document and rows through the create path,
   * and only the second half touches D1 — so this is the one check that can
   * tell a seeded blog from a blog-shaped empty collection. Everything static
   * can say is that the rows exist in the source.
   */
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  // The template grid is the first-run screen. With a project already made it
  // lives behind New project, which is where a second one gets started.
  await page.locator('button:has-text("New project")').first().click();
  await page.waitForTimeout(500);
  const blogId = await openProject(page, 'Blog');

  await openPanel('Collections');
  await page.waitForTimeout(500);
  report.check(
    'the Blog template arrives with a collection already shaped',
    (await panel().locator('text=Essays').count()) >= 1,
    (await panel().locator('text=/\\d+ fields?/').first().textContent()) ?? 'no field count'
  );
  // Rows are behind the collection, the same as anywhere else in this panel.
  await panel().locator('text=Essays').first().click();
  await page.waitForTimeout(700);
  // All six, not "at least one": a seeding path that wrote the first row and
  // then threw would look identical to a working one from a single title.
  const titles = [
    'The city as an interface',
    'Everything is a queue',
    'In praise of the boring stack',
    'Attention is not a resource',
    'Notes on writing in public',
    'The second system, revisited',
  ];
  const listed = [];
  for (const title of titles) {
    if ((await panel().locator(`text=${title}`).count()) >= 1) listed.push(title);
  }
  report.check(
    'and with all six of its essays already written',
    listed.length === titles.length,
    `${listed.length} of ${titles.length} listed`
  );

  await publish(page);
  const index = await (await fetch(`${APP}/s/${blogId}/`)).text();
  report.check(
    'the index lists them',
    index.includes('The city as an interface') && index.includes('Everything is a queue'),
    'two of six on page one'
  );
  const essay = await fetch(`${APP}/s/${blogId}/essays/the-city-as-an-interface/`);
  const essayHtml = await essay.text();
  report.check(
    'and each one has a page of its own, at its own address',
    essay.ok && /<h1[^>]*>The city as an interface</.test(essayHtml),
    `HTTP ${essay.status}`
  );
  /*
   * And the value model, on the first page anybody sees.
   *
   * Nine stages of vocabulary and the templates used none of it, which meant
   * the whole of it was demonstrated only in a test. Two sentences in the
   * essay template say it now, and both are things the page could not have
   * said before:
   *
   *   `⟨How many Essays⟩ ⟨joined with " essays so far…"⟩`
   *   `⟨Minutes⟩ ⟨joined with " min read"⟩`
   *
   * The first is checked against the *typed* copy as much as against the
   * computed one: the design-time line says "Six essays so far" in words, so a
   * count that failed to resolve would leave a sentence that reads perfectly
   * and is a constant. Finding the digit and not the word is what says the
   * chain ran.
   */
  report.check(
    'the index counts its own essays rather than saying a number somebody typed',
    index.includes('6 essays so far') && !index.includes('Six essays so far'),
    index.includes('6 essays so far')
      ? 'the count resolved'
      : 'the typed copy published — the chain did not resolve'
  );
  /*
   * And the label that used to be content. `readingTime` was a *text* field
   * holding "12 min", so the words lived in six records: changing them meant
   * editing every essay, and the number could not be sorted or compared
   * because it was not one. It is `minutes: 12` now, with " min read" in the
   * design.
   */
  report.check(
    'a card reads the number and puts the words on in the design',
    index.includes('12 min read') && index.includes('9 min read'),
    // Two numbers, not one: the design-time copy on the card is also
    // "12 min read", so finding that alone proves nothing. A chain that did
    // not resolve prints the same placeholder on all six cards and never
    // reaches 9 — which is exactly what the mutation that breaks it does.
    [12, 9, 7, 14].filter((n) => index.includes(`${n} min read`)).join(', ') || 'none of them'
  );

  report.check(
    'with the essay itself on it, not the design-time placeholder',
    essayHtml.includes('Shinjuku') && !essayHtml.includes('The essay title'),
    essayHtml.includes('Shinjuku') ? 'the record’s body' : 'placeholder copy published'
  );

  // The same sentence on the essay's own page, because the two pages read one
  // chain rather than two spellings of it.
  report.check(
    'and the same reading time, from the same chain, on the essay’s own page',
    essayHtml.includes('12 min read'),
    essayHtml.includes('12 min read') ? 'joined here too' : 'the detail page says something else'
  );
} catch (error) {
  report.check('the suite ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
}

report.finish();
