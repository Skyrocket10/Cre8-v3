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

import {
  APP,
  launch,
  openInspectorSection,
  openInspectorTab,
  openProject,
  publish,
  READY_TIMEOUT,
} from './harness.mjs';
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
  await page.waitForURL(`${APP}/`, { timeout: READY_TIMEOUT });

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

  // Collapsed by default, and on the Content tab rather than the one the panel
  // opens to — the helper finds it either way, so this suite stays about
  // markup rather than about where the inspector files things.
  report.check(
    'the Semantics section is reachable',
    await openInspectorSection(page, 'Semantics')
  );
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

  /* ------------------------------------------- 7b. and *where* it opens */

  /*
   * The command palette above is a modal and belongs in the middle. A menu
   * does not, and until this existed every one in the library got the modal
   * centring anyway — the account menu opened in the centre of the viewport,
   * with every check in section 7 passing throughout. It was a real popover,
   * it was wired, it was on top, it dismissed on Escape. None of that is where.
   *
   * "The right CSS was emitted" and "the panel landed in the right place" are
   * different claims, and only a browser settles the second, so this measures
   * two boxes against each other.
   */
  await page.bringToFront();
  await insert('Account menu');
  await publish(page);

  const placed = await ctx.newPage();
  await placed.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  const avatar = placed.locator('button:has-text("Ines García")').first();
  // A window tall enough to leave room beneath the button. The block is the
  // last thing on the page, so in an ordinary viewport the menu correctly
  // opens *upward* — the flip fallback doing its job, which the first version
  // of this check read as a failure.
  await placed.setViewportSize({ width: 1280, height: 1600 });
  await placed.waitForTimeout(200);
  await avatar.click();
  await placed.waitForTimeout(320);

  const boxes = await placed.evaluate(() => {
    const button = [...document.querySelectorAll('button[popovertarget]')].find((b) =>
      (b.textContent ?? '').includes('Ines García')
    );
    const el = button && document.getElementById(button.getAttribute('popovertarget'));
    if (!el) return null;
    const p = el.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    return {
      below: Math.round(p.top - b.bottom),
      above: Math.round(b.top - p.bottom),
      alignedRight: Math.abs(p.right - b.right) < 2,
      centred: Math.abs(p.left + p.width / 2 - window.innerWidth / 2) < 4,
      anchor: getComputedStyle(el).positionAnchor,
    };
  });

  // Touching the button on one side or the other, whichever the browser
  // chose. Insisting on "below" would be insisting the flip never happens,
  // and the flip is the feature that stops an edge menu leaving the page.
  const touching = boxes && [boxes.below, boxes.above].some((d) => d >= 0 && d <= 24);
  report.check(
    'an anchored panel opens against its button, not in the middle of the page',
    Boolean(touching) && !boxes.centred,
    boxes ? `${boxes.below}px below / ${boxes.above}px above, centred=${boxes.centred}` : 'no panel'
  );
  report.check(
    'and below it, given room to be',
    Boolean(boxes) && boxes.below >= 0 && boxes.below <= 24,
    boxes ? `${boxes.below}px below the button` : 'no panel'
  );
  report.check(
    'and lines up with the edge it was told to',
    Boolean(boxes?.alignedRight),
    boxes?.alignedRight ? 'right edges within a pixel' : 'not aligned'
  );
  report.check(
    'the panel names the button through the anchor the renderer minted',
    Boolean(boxes?.anchor?.startsWith('--cre8-a-')),
    boxes?.anchor || 'no position-anchor'
  );
  await placed.close();

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

  const countInvokers = () =>
    page.evaluate(() => {
      const frame = document.querySelector('.cre8-frame.cre8-editing');
      return {
        count: frame?.querySelectorAll('button[popovertarget]').length ?? 0,
        // An anchor cannot invoke a popover, so choosing one has to change the
        // tag as well as add the attribute.
        anchors: frame?.querySelectorAll('a[popovertarget]').length ?? 0,
      };
    });
  const before = await countInvokers();

  await opensTrigger.click();
  await page.waitForTimeout(300);
  /*
   * Scoped to the picker, which it was not.
   *
   * `insert()` leaves the Insert panel open, so a page-wide
   * `button:has(span:text-is("Command menu"))` matches the *insert card* long
   * before it matches the option — and clicking it dropped a second Command
   * menu and moved the selection to that block's root. Every check after this
   * point was then reading a layout box, and the one below reported that a
   * button's URL field had not stepped aside when no button was selected at
   * all. `.anim-pop` is the portalled panel every inspector `Popover` renders
   * into; it is the only thing on screen that is the picker.
   */
  await page.locator('.anim-pop button:has(span:text-is("Command menu"))').first().click();
  await page.waitForTimeout(700);

  const wired = await countInvokers();
  report.check(
    'wiring it from the inspector adds a second invoker',
    // Against the count *before*, not against two. The Command menu block
    // ships several invokers of its own, so `>= 2` was true whether or not
    // the wiring happened — the check could not fail and did not.
    wired.count === before.count + 1,
    `${before.count} invokers before, ${wired.count} after`
  );
  report.check('and none of them is an anchor', wired.anchors === 0);

  /*
   * The URL field is gone rather than sitting there doing nothing: a link and
   * a popover trigger are the same control in two mutually exclusive states.
   *
   * On the Content tab deliberately, and this is the whole point of saying so:
   * the row lives there, and a check for its absence run against any other tab
   * is green whatever the panel does — the strongest kind of vacuous check,
   * because it looks like the control correctly standing down.
   */
  report.check('the panel offers Content to look in', await openInspectorTab(page, 'Content'));
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

  /* ------------------------------------- 9. slider, file, progress, fieldset */

  // The rest of the native controls. Two of these have to be held back on the
  // canvas — a slider jumps to wherever it is pressed, and a file field opens
  // the operating system's picker — so the checks are that they behave live
  // and stay quiet while being designed.
  await page.bringToFront();
  await insert('Filter panel');
  await insert('Upload');
  // A field with a placeholder, for the pseudo-element comparison in 10.
  await insert('Input');

  const controlsOnCanvas = await page.evaluate(() => {
    const frame = document.querySelector('.cre8-frame.cre8-editing');
    const slider = frame?.querySelector('input[type="range"]');
    const bars = [...(frame?.querySelectorAll('progress') ?? [])];
    return {
      sliders: frame?.querySelectorAll('input[type="range"]').length ?? 0,
      files: frame?.querySelectorAll('input[type="file"]').length ?? 0,
      fieldsets: frame?.querySelectorAll('fieldset').length ?? 0,
      // `<legend>` has to be the first child or the browser does not treat it
      // as the group's name.
      legendsFirst: [...(frame?.querySelectorAll('fieldset') ?? [])].every(
        (f) => f.firstElementChild?.tagName === 'LEGEND'
      ),
      legends: [...(frame?.querySelectorAll('legend') ?? [])].map((l) => l.textContent),
      sliderValue: slider ? Number(slider.value) : -1,
      progress: bars.map((p) => (p.hasAttribute('value') ? p.value : 'unknown')),
      // The reset strips the user-agent look so the node's own two colours
      // become the track and the fill.
      barPainted: bars[0] ? getComputedStyle(bars[0]).appearance === 'none' : false,
    };
  });

  report.check('the slider is a real range input', controlsOnCanvas.sliders === 1);
  report.check('the file field is a real file input', controlsOnCanvas.files === 1);
  report.check(
    'the filter groups are fieldsets',
    controlsOnCanvas.fieldsets === 3,
    `${controlsOnCanvas.fieldsets} groups`
  );
  report.check(
    'each one leads with its legend',
    controlsOnCanvas.legendsFirst,
    controlsOnCanvas.legends.join(' | ')
  );
  report.check(
    'the slider starts where the block put it',
    controlsOnCanvas.sliderValue === 220,
    `value ${controlsOnCanvas.sliderValue}`
  );
  report.check(
    'one progress bar is deliberately indeterminate',
    controlsOnCanvas.progress.includes('unknown'),
    controlsOnCanvas.progress.join(' ')
  );
  report.check('the progress bars take the document’s own colours', controlsOnCanvas.barPainted);

  // Dragging the slider on the canvas must not move it: the document never
  // hears about the change, so it would be undone by the next render and the
  // designer would be left wondering which value is real.
  const sliderBox = await page
    .locator('.cre8-frame.cre8-editing input[type="range"]')
    .first()
    .boundingBox();
  if (sliderBox) {
    await page.mouse.move(sliderBox.x + 6, sliderBox.y + sliderBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sliderBox.x + sliderBox.width - 6, sliderBox.y + sliderBox.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  const afterDrag = await page.evaluate(() =>
    Number(
      document.querySelector('.cre8-frame.cre8-editing input[type="range"]')?.value ?? -1
    )
  );
  report.check(
    'dragging it on the canvas does not silently change it',
    afterDrag === 220,
    `value ${afterDrag}`
  );

  await publish(page);
  const controlsHtml = await (await fetch(`${APP}/s/${id}/`)).text();

  report.check(
    'the published slider carries its range',
    /<input[^>]*type="range"[^>]*min="0"[^>]*max="500"/.test(controlsHtml),
    /type="range"/.test(controlsHtml) ? 'present' : 'missing'
  );
  report.check(
    'the file field says what it accepts',
    /<input[^>]*type="file"[^>]*accept="[^"]+"[^>]*multiple/.test(controlsHtml)
  );
  report.check(
    'the canvas-only guards never reach the file',
    !/onclick=|onpointerdown=/.test(controlsHtml),
    'no inline handlers'
  );
  const bars = controlsHtml.match(/<progress[^>]*>/g) ?? [];
  report.check(
    'the indeterminate bar ships with no value at all',
    bars.length >= 3 && bars.some((tag) => !tag.includes('value=')),
    bars.map((tag) => (tag.includes('value=') ? 'value' : 'none')).join(' ')
  );
  report.check('and still no script', !/<script/i.test(controlsHtml));

  const controls = await ctx.newPage();
  await controls.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  const liveSlider = controls.locator('input[type="range"]').first();
  await liveSlider.focus();
  await controls.keyboard.press('ArrowRight');
  await controls.waitForTimeout(150);
  report.check(
    'published, the keyboard moves it by one step',
    Number(await liveSlider.inputValue()) === 230,
    await liveSlider.inputValue()
  );

  const grouped = await controls.evaluate(() => {
    const first = document.querySelector('fieldset');
    const control = first?.querySelector('input');
    // What a screen reader reads before the control: the legend is the group's
    // accessible name, and it only works because the legend is inside.
    return {
      legend: first?.querySelector('legend')?.textContent ?? '',
      contains: Boolean(control && first?.contains(control)),
      // The user-agent `min-width: min-content` on a fieldset is a famous way
      // to make a flex column refuse to shrink.
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  report.check('the legend names its group', grouped.legend.length > 0, grouped.legend);
  report.check('and the controls are inside it', grouped.contains);
  report.check('a fieldset does not stop the page shrinking', grouped.overflow <= 1);

  await controls.setViewportSize({ width: 390, height: 900 });
  await controls.waitForTimeout(250);
  const narrow = await controls.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  report.check('the controls fit a phone', narrow <= 1, `${narrow}px over`);

  /* ------------------------------------------ 10. the parts of a control */

  // Everything the block sweep compares is an element. A control is also made
  // of parts no selector in the document can name — the placeholder, the
  // slider's track — and those come from whichever stylesheet happens to be
  // nearby. That is how a whole class of difference stayed invisible: the
  // editor has Tailwind's preflight and a published page has nothing.
  await controls.setViewportSize({ width: 1440, height: 1000 });
  await controls.waitForTimeout(200);

  const PARTS = () => {
    const root = document.querySelector('.cre8-frame.cre8-editing') ?? document.body;
    const field = root.querySelector('input[placeholder]');
    const slider = root.querySelector('input[type="range"]');
    const read = (el, pseudo) => (el ? getComputedStyle(el, pseudo).color : 'none');
    return {
      placeholder: read(field, '::placeholder'),
      // The element's own background, which preflight zeroes and no user agent
      // does — the difference that showed up as a white bar behind a slider.
      sliderBackground: slider ? getComputedStyle(slider).backgroundColor : 'none',
      fieldBackground: field ? getComputedStyle(field).backgroundColor : 'none',
    };
  };

  const livePartsRemote = await controls.evaluate(PARTS);
  await page.bringToFront();
  const livePartsCanvas = await page.evaluate(PARTS);

  // Both surfaces reporting "none" would agree perfectly and prove nothing,
  // so the probe says up front whether it found anything to measure.
  report.check(
    'there is a field with a placeholder to compare',
    livePartsCanvas.placeholder !== 'none' && livePartsRemote.placeholder !== 'none',
    `canvas ${livePartsCanvas.placeholder}, published ${livePartsRemote.placeholder}`
  );
  report.check(
    'the placeholder is the same colour on both surfaces',
    livePartsCanvas.placeholder === livePartsRemote.placeholder,
    `canvas ${livePartsCanvas.placeholder} vs published ${livePartsRemote.placeholder}`
  );
  report.check(
    'and so is what sits behind a slider',
    livePartsCanvas.sliderBackground !== 'none' &&
      livePartsCanvas.sliderBackground === livePartsRemote.sliderBackground,
    `canvas ${livePartsCanvas.sliderBackground} vs published ${livePartsRemote.sliderBackground}`
  );
  report.check(
    'and behind a text field',
    livePartsCanvas.fieldBackground !== 'none' &&
      livePartsCanvas.fieldBackground === livePartsRemote.fieldBackground,
    `canvas ${livePartsCanvas.fieldBackground} vs published ${livePartsRemote.fieldBackground}`
  );

  await controls.close();

  /* ------------------------------------------------------- 11. the dialog */

  // A dialog differs from the popover above in one thing that matters and is
  // invisible on screen: it is announced as a dialog and read out by its
  // label. So the checks are mostly about the accessibility tree, plus the
  // one limitation stated honestly — this is not modal, and pretending
  // otherwise in a test would be worse than not testing it.
  await page.bringToFront();
  await insert('Confirm dialog');

  await publish(page);
  const dialogHtml = await (await fetch(`${APP}/s/${id}/`)).text();

  const dialogId = /<dialog[^>]*\sid="(p-[^"]+)"/.exec(dialogHtml)?.[1] ?? '';
  report.check('it publishes as a real <dialog>', Boolean(dialogId), dialogId || 'no dialog element');
  report.check(
    'opened by the same attribute a popover is, so no script appears',
    dialogHtml.includes(`popovertarget="${dialogId}"`) && !/<script/i.test(dialogHtml),
    dialogId ? 'wired, scriptless' : 'unwired'
  );
  report.check(
    'it carries a label to be announced by',
    /<dialog[^>]*aria-label="[^"]+"/.test(dialogHtml),
    /aria-label/.test(dialogHtml) ? 'labelled' : 'unlabelled'
  );
  // The class and the id both come from the node id, but only the class is
  // shortened at publish — a DOM id is referenced by `popovertarget` and has
  // to keep matching it. So the class is the prefix, and the full form is
  // tried too for the rare id whose prefix collides with another on the page.
  const dialogClass = [
    `.c-${dialogId.slice(2, 2 + 4)}::backdrop`,
    `.c-${dialogId.slice(2)}::backdrop`,
  ].find((selector) => dialogHtml.includes(selector));
  report.check(
    'the backdrop is a rule on the node’s own class',
    Boolean(dialogClass),
    dialogClass ?? `neither .c-${dialogId.slice(2, 2 + 4)}::backdrop nor the full form`
  );

  const modal = await ctx.newPage();
  await modal.goto(`${APP}/s/${id}/`, { waitUntil: 'domcontentloaded' });

  const box = modal.locator(`#${dialogId}`);
  const open = modal.locator(`button[popovertarget="${dialogId}"]`).first();

  report.check('it starts closed', !(await box.isVisible()));
  await open.click();
  await modal.waitForTimeout(220);
  report.check('the button opens it', await box.isVisible());

  // The part a `<div popover>` cannot do, and the only reason this is a
  // separate primitive at all.
  const announced = await box.ariaSnapshot();
  report.check(
    'assistive technology is told it is a dialog, by name',
    /^- dialog "Delete this project\?"/.test(announced.trim()),
    announced.split('\n')[0]
  );

  const dimmed = await modal.evaluate((did) => {
    const el = document.getElementById(did);
    const backdrop = el ? getComputedStyle(el, '::backdrop').backgroundColor : 'none';
    return {
      backdrop,
      // Not modal, and this is the check that keeps that honest rather than
      // letting the suite imply otherwise. `showModal()` is what makes the
      // page inert, and it needs a script these pages do not carry.
      pageStillReachable: document.querySelector('a, button:not([popovertarget])') !== null,
    };
  }, dialogId);

  report.check(
    'the page behind is dimmed',
    dimmed.backdrop !== 'rgba(0, 0, 0, 0)' && dimmed.backdrop !== 'none',
    dimmed.backdrop
  );
  report.check(
    'and is documented as still reachable — this is not showModal()',
    dimmed.pageStillReachable,
    'not modal, as stated'
  );

  await modal.keyboard.press('Escape');
  await modal.waitForTimeout(220);
  report.check('Escape cancels it', !(await box.isVisible()));

  await open.click();
  await modal.waitForTimeout(220);
  await modal.locator(`#${dialogId} button:text-is("Cancel")`).click();
  await modal.waitForTimeout(220);
  report.check('so does Cancel', !(await box.isVisible()));
  report.check(
    'and focus lands back on the button that opened it',
    await modal.evaluate(
      (did) => document.activeElement?.getAttribute('popovertarget') === did,
      dialogId
    )
  );

  await modal.close();
} catch (error) {
  report.check('native suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
