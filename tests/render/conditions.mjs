/**
 * The seven conditions that compiled and could not be authored.
 *
 * `css.ts` has compiled eleven condition shapes for most of this project's
 * life. The panel could author four. Nothing failed and nothing warned — the
 * CSS for the other seven was written, commented and correct, and two of them
 * existed in real documents only because `blocks/kit.ts` hand-writes them. The
 * only symptom was a designer who could not style a ticked checkbox.
 *
 * The static suite proves the panel now offers every shape the generator
 * compiles. That is a claim about two tables agreeing. This is the other half,
 * and the half only a browser can answer: **does the state the designer picked
 * actually change what a visitor sees.**
 *
 * ## Both halves of every measurement
 *
 * Each condition is measured on one element, twice — outside the state and
 * inside it — and both readings are asserted:
 *
 *   after === the styled value      the rule applies when it should
 *   before !== after                the rule does not apply when it should not
 *
 * The second is the one that matters. A rule with no condition at all, or a
 * selector so broad it matches everything, passes the first reading perfectly.
 * It was checking only the first that let a whole class of dead selectors sit
 * in the generator unnoticed, and a suite written to prove they are alive has
 * no business repeating the mistake.
 *
 * ## And the panel, separately
 *
 * A shape reachable from a seeded document is not a shape a designer can
 * reach. The last section drives the real menu: a checkbox is offered
 * "Ticked", a plain container is not, and picking it puts the condition the
 * generator wants into the document.
 */

import {
  APP,
  getDocument,
  launch,
  node,
  openInspectorSection,
  openProject,
  publish,
  READY_TIMEOUT,
  saveDocument,
  signUp,
} from './harness.mjs';
import { createReport } from '../report.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/**
 * A colour per condition, all distinct.
 *
 * Distinct so a rule landing on the wrong element is a wrong *value* rather
 * than a missing one — seven elements all turning the same red would hide a
 * selector that matched more than it should behind a check that passed.
 */
const PAINT = {
  checked: 'rgb(10, 110, 60)',
  disabled: 'rgb(20, 40, 200)',
  invalid: 'rgb(200, 30, 30)',
  placeholder: 'rgb(120, 60, 190)',
  active: 'rgb(230, 120, 0)',
  focus: 'rgb(0, 130, 160)',
  attr: 'rgb(150, 90, 40)',
  either: 'rgb(40, 40, 40)',
  typed: 'rgb(90, 20, 120)',
};

/**
 * A rule that paints the element when the condition holds.
 *
 * `when` is a `Test`, which for a single condition is that condition bare —
 * the model stopped wrapping one condition in a list when the two condition
 * languages became one.
 */
const paints = (id, when, colour) => ({
  id: `r-${id}`,
  when,
  apply: { backgroundColor: colour },
});

try {
  await signUp(page, 'Conditions Gantry', 'cond');
  const projectId = await openProject(page, 'Blank');

  /* ---------------------------------------------------------------- seed -- */

  /*
   * Four-character node ids on purpose.
   *
   * A published page shortens every class to the first four characters of its
   * node id — the ids are the highest-entropy bytes on the page — so an id
   * that is already four characters long is named identically on the canvas
   * and in the file, and one selector finds the element on either.
   */
  const doc = await getDocument(page, projectId);
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];

  const seeded = [
    node('chkx', 'checkbox', 'Tickable', {
      parentId: root.id,
      props: { label: 'Subscribe', name: 'sub' },
      rules: [paints('chkx', { kind: 'control', pseudo: 'checked' }, PAINT.checked)],
    }),
    node('btnd', 'button', 'Stoppable', {
      parentId: root.id,
      props: { label: 'Send' },
      rules: [paints('btnd', { kind: 'control', pseudo: 'disabled' }, PAINT.disabled)],
    }),
    node('inpv', 'input', 'Address', {
      parentId: root.id,
      props: { inputType: 'email', name: 'email', placeholder: 'you@company.com' },
      rules: [paints('inpv', { kind: 'control', pseudo: 'invalid' }, PAINT.invalid)],
    }),
    node('inpp', 'input', 'Empty one', {
      parentId: root.id,
      props: { inputType: 'text', name: 'note', placeholder: 'Say something' },
      rules: [
        paints('inpp', { kind: 'control', pseudo: 'placeholder-shown' }, PAINT.placeholder),
      ],
    }),
    node('btna', 'button', 'Pressable', {
      parentId: root.id,
      props: { label: 'Hold me' },
      rules: [paints('btna', { kind: 'pointer', pseudo: 'active' }, PAINT.active)],
    }),
    node('btnf', 'button', 'Focusable', {
      parentId: root.id,
      props: { label: 'Focus me' },
      rules: [paints('btnf', { kind: 'pointer', pseudo: 'focus' }, PAINT.focus)],
    }),
    node('boxp', 'container', 'Plain box', { parentId: root.id }),
    /*
     * The OR case, and the group it needs.
     *
     * "Hovered *or* the annual plan" is a sentence the model could hold, the
     * generator could compile and the panel could not author, and it is the
     * one shape whose check has to test three readings rather than two: a
     * selector so broad it matched everything would satisfy both branches
     * perfectly and only fail on the case where neither holds.
     */
    node('grpo', 'container', 'Plan group', {
      parentId: root.id,
      props: { switchKey: 'plan', switchDefault: 'monthly' },
      children: ['orxx', 'btna2'],
    }),
    node('orxx', 'text', 'Either way', {
      parentId: 'grpo',
      props: { text: 'Either way' },
      rules: [
        paints(
          'orxx',
          {
            kind: 'some',
            tests: [
              { kind: 'pointer', pseudo: 'hover' },
              { kind: 'state', key: 'plan', op: 'is', values: ['annual'] },
            ],
          },
          PAINT.either
        ),
      ],
    }),
    node('btna2', 'button', 'Go annual', {
      parentId: 'grpo',
      props: { label: 'Go annual' },
      events: [{ event: 'onClick', actions: [{ type: 'setState', value: 'annual' }] }],
    }),
    /*
     * A comparison in a style rule, against something typed.
     *
     * The half of minting a browser has to answer: the value is not knowable
     * when the page is published, so the compiler ships the comparison and the
     * runtime turns the attribute on and off as somebody types. The folded
     * half — a comparison against a record — is checked in the static suite,
     * where a record can be handed to the publisher directly.
     */
    node('inpw', 'input', 'Watched', {
      parentId: root.id,
      props: { inputType: 'text', name: 'watched', placeholder: 'Type here' },
    }),
    node('cmpx', 'text', 'Follows what is typed', {
      parentId: root.id,
      props: { text: 'Follows what is typed' },
      rules: [
        paints(
          'cmpx',
          /*
           * By element, not by name. `input` looks for a control *inside* the
           * node that owns the rule, and this text sits beside the field
           * rather than around it — which is the ordinary arrangement and the
           * reason the element operand exists at all.
           */
          { kind: 'compare', left: { kind: 'element', ref: { node: 'inpw' } }, op: 'notEmpty' },
          PAINT.typed
        ),
      ],
    }),
    node('deto', 'details', 'Openable', {
      parentId: root.id,
      props: { summary: 'More' },
      rules: [
        paints('deto', { kind: 'attr', name: 'open', op: 'is', values: [''] }, PAINT.attr),
      ],
    }),
  ];

  for (const one of seeded) doc.nodes[one.id] = one;
  // Only the ones that belong to the root. Two of the seeds live inside the
  // plan group, and adding them here as well would give them two parents —
  // which renders twice and selects unpredictably.
  root.children = [
    ...root.children,
    ...seeded.filter((one) => one.parentId === root.id).map((one) => one.id),
  ];

  const status = await saveDocument(page, doc);
  report.check('the seed landed', status === 200, `HTTP ${status}`);

  await page.waitForTimeout(1200);
  await publish(page);

  /* ------------------------------------------------------------ published -- */

  report.group('a published page honours every condition the generator compiles');

  await page.goto(`${APP}/s/${projectId}/`, { waitUntil: 'load', timeout: READY_TIMEOUT });
  await page.waitForTimeout(400);

  /**
   * Reads the background either side of `toggle`, and asserts both readings.
   *
   * `toggle` is handed the locator rather than a selector so a section can do
   * whatever the state actually needs — a click, a keystroke, a held mouse
   * button — instead of everything being squeezed into one mechanism.
   */
  const measure = async (label, id, colour, toggle, options = {}) => {
    const { startsInState = false, after: leave } = options;
    const el = page.locator(`.c-${id}`).first();
    if (!(await el.count())) {
      report.check(`${label}: the element is on the page`, false, `.c-${id} not found`);
      return;
    }
    const read = () => el.evaluate((n) => getComputedStyle(n).backgroundColor);

    const first = await read();
    await toggle(el);
    const second = await read();
    if (leave) await leave(el);

    /*
     * `startsInState` exists for one condition and is worth the parameter.
     * "Still empty" is true of a field before anybody touches it, so the
     * toggle takes it *out* of the state rather than into it — and a check
     * that assumed the second reading was the interesting one would assert
     * the painted colour against the unpainted reading and fail an element
     * that was working perfectly.
     */
    const inState = startsInState ? first : second;
    const outOfState = startsInState ? second : first;

    report.check(`${label}: the rule applies in the state`, inState === colour, inState);
    /*
     * And does not apply outside it. Without this line every check in this
     * file would pass against a rule with an empty `when`, which is precisely
     * the failure a suite about conditions exists to rule out.
     */
    report.check(
      `${label}: and does nothing outside it`,
      outOfState !== inState,
      `${outOfState} → ${inState}`
    );
  };

  await measure('ticked', 'chkx', PAINT.checked, async (el) => {
    await el.click();
    await page.waitForTimeout(80);
  });

  await measure('unavailable', 'btnd', PAINT.disabled, async (el) => {
    // Set on the real element rather than through a prop: the claim is that
    // the stylesheet answers the browser's own notion of disabled, and the
    // browser's notion is the IDL property.
    await el.evaluate((n) => {
      n.disabled = true;
    });
    await page.waitForTimeout(80);
  });

  await measure('filled in wrongly', 'inpv', PAINT.invalid, async (el) => {
    // An empty, non-required email field is valid; "nope" is not an address,
    // so constraint validation makes it `:invalid` with nothing scripted.
    await el.fill('nope');
    await page.waitForTimeout(80);
  });

  await measure(
    'still empty',
    'inpp',
    PAINT.placeholder,
    async (el) => {
      // Backwards, and that is the point of the flag: the field is empty when
      // the page loads, so typing is what takes it *out* of the state.
      await el.fill('something');
      await page.waitForTimeout(80);
    },
    { startsInState: true }
  );

  await measure(
    'being pressed',
    'btna',
    PAINT.active,
    async (el) => {
      const box = await el.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(80);
    },
    { after: async () => page.mouse.up() }
  );

  await measure('focused', 'btnf', PAINT.focus, async (el) => {
    /*
     * `.focus()` rather than a click or a Tab, and that is the whole point of
     * this one. `:focus` and `:focus-visible` differ precisely here: a
     * programmatic focus with no prior keyboard interaction satisfies the
     * first and not the second, so an element painted by this measurement is
     * being painted by a `:focus` rule and could not be painted by the
     * `:focus-visible` rule the panel already offered.
     */
    await el.evaluate((n) => n.focus());
    await page.waitForTimeout(80);
  });

  await measure('an attribute is set', 'deto', PAINT.attr, async (el) => {
    await el.evaluate((n) => {
      n.open = true;
    });
    await page.waitForTimeout(80);
  });

  /* ------------------------------------------------------------------ or -- */

  {
    const el = page.locator('.c-orxx').first();
    const read = () => el.evaluate((n) => getComputedStyle(n).backgroundColor);
    const away = page.locator('.c-deto').first();

    const neither = await read();
    await el.hover();
    await page.waitForTimeout(80);
    const hovered = await read();

    // Off it, and then into the other branch — the state — with the pointer
    // parked somewhere that cannot be confused for the target.
    await away.hover();
    await page.waitForTimeout(80);
    await page.locator('.c-btna2').first().click();
    await page.waitForTimeout(120);
    const stated = await read();

    report.check('either way: the first branch applies', hovered === PAINT.either, hovered);
    report.check('either way: so does the second', stated === PAINT.either, stated);
    /*
     * And the reading the other two cannot give.
     *
     * A rule with no condition, or a selector list so broad it matches
     * everything, satisfies both branches above. The only measurement that
     * tells an OR apart from an accident is the case where neither branch
     * holds.
     */
    report.check(
      'either way: and neither branch means it does not apply',
      neither !== PAINT.either,
      `neither ${neither} · hovered ${hovered} · annual ${stated}`
    );
  }

  /* --------------------------------------------------------------- mint -- */

  {
    /*
     * A comparison reads a form control, so the rule on this element is not
     * about this element at all — which is why the intermediate is an
     * attribute the compiler owns rather than a state. The three readings are
     * the same three the OR case needs: before, during, and back again.
     */
    const el = page.locator('.c-cmpx').first();
    const field = page.locator('.c-inpw').first();
    const read = () => el.evaluate((n) => getComputedStyle(n).backgroundColor);

    const blank = await read();
    await field.fill('something');
    await page.waitForTimeout(120);
    const typed = await read();
    await field.fill('');
    await page.waitForTimeout(120);
    const cleared = await read();

    report.check('a comparison paints once the field has something in it', typed === PAINT.typed, typed);
    report.check(
      'and does not before anything is typed',
      blank !== PAINT.typed,
      `blank ${blank} · typed ${typed}`
    );
    /*
     * And back. A rule that only ever turned on would pass both readings
     * above and leave every visitor stuck in the styled state the moment they
     * touched the field once.
     */
    report.check(
      'and comes off again when the field is emptied',
      cleared === blank,
      `typed ${typed} → cleared ${cleared}`
    );
    report.check(
      'the element carries the compiler’s attribute, not a state',
      await el.evaluate((n) => n.hasAttribute('data-cre8-test') && !n.hasAttribute('data-cre8-switch')),
      await el.evaluate((n) => n.getAttributeNames().join(' '))
    );
  }

  /* ----------------------------------------------------- no script for it -- */

  /*
   * None of this costs the visitor anything.
   *
   * Every one of the shapes above is a selector, and a shape that quietly
   * needed the runtime would be one that stops working with scripting off —
   * the whole argument for compiling conditions to CSS is that they do not.
   *
   * The page does carry one script, and it is not theirs: the OR case needs a
   * *state*, a state needs something to set it, and a switch has always
   * shipped the thirty-line behaviour runtime. So the check attributes the
   * script rather than counting it. Counting alone would have two failure
   * modes it could not tell apart — a condition that started needing script,
   * and a fixture that grew a switch — and this suite hit the second one the
   * first time it was run.
   */
  const html = await (await fetch(`${APP}/s/${projectId}/`)).text();
  const scripts = (html.match(/<script/gi) ?? []).length;
  const script = html.slice(html.indexOf('<script'), html.lastIndexOf('</script>'));
  report.check(
    'the only script on the page is the switch runtime',
    scripts === 1 && script.includes('data-cre8-switch'),
    `${scripts} script tags`
  );
  /*
   * And no pseudo-class is in it. This is the line that would catch a shape
   * quietly moving from the stylesheet into the runtime, which a count of one
   * could never see.
   *
   * Pseudo-classes only, and the distinction matters: `data-cre8-copied` *is*
   * in the runtime, because the copy action is what writes it. That is the
   * designed split rather than a leak — the runtime sets an attribute, the
   * stylesheet reads one — and a first version of this check listed it as
   * evidence of a problem and failed on correct code.
   */
  const leaked = [':hover', ':active', ':focus', ':checked', ':disabled', ':invalid',
    ':placeholder-shown'].filter((needle) => script.includes(needle));
  report.check(
    'and no pseudo-class is in it — every one of those is a selector',
    leaked.length === 0,
    leaked.join(' ') || 'no pseudo-class anywhere in the runtime'
  );
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  report.check(
    'every one of them is in the stylesheet instead',
    [':hover', ':active', ':focus', ':has(:checked)', ':disabled', ':invalid',
     ':placeholder-shown', '[open='].every((needle) => css.includes(needle)),
    [':hover', ':active', ':focus', ':has(:checked)', ':disabled', ':invalid',
     ':placeholder-shown', '[open='].filter((n) => !css.includes(n)).join(' ') || 'all eight'
  );

  /* --------------------------------------------------------------- panel -- */

  report.group('and a designer can reach them from the panel');

  await page.goto(`${APP}/editor?p=${projectId}`, { waitUntil: 'load', timeout: READY_TIMEOUT });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  /*
   * Selection goes through the layer tree, not the canvas: the canvas overlay
   * eats direct clicks, and the Layers tab is open by default — clicking it
   * unconditionally would close it and leave nothing selectable at all.
   */
  const showLayers = async () => {
    if (await page.locator('[data-layer-row]').first().isVisible().catch(() => false)) return;
    await page.locator('button[aria-label="Layers"]').first().click();
    await page.waitForTimeout(300);
  };

  /**
   * Opens the Rules section for a layer and returns the When… menu's entries.
   *
   * Every failure carries the reason it failed. A helper that answers `null`
   * makes three checks all report "no menu", which is the same sentence for a
   * layer that was not found, a section that would not open and a menu that
   * opened empty — three different bugs wearing one message.
   */
  const offeredFor = async (layerName) => {
    await showLayers();
    const row = page.locator(`[data-layer-row]:has-text("${layerName}")`).first();
    if (!(await row.count())) {
      const rows = await page.locator('[data-layer-row]').allInnerTexts();
      return { labels: [], why: `no layer row for ${layerName} among ${rows.length}: ${rows.join(' / ')}` };
    }
    await row.click();
    await page.waitForTimeout(400);

    if (!(await openInspectorSection(page, 'States & conditions'))) {
      const titles = await page.locator('aside').last().locator('.panel-title').allInnerTexts();
      return { labels: [], why: `the section would not open; sections: ${titles.join(' / ')}` };
    }
    const trigger = page.locator('aside').last().locator('button:has-text("When")').first();
    if (!(await trigger.count())) {
      return { labels: [], why: 'the Rules section has no When… button' };
    }
    await trigger.click();
    await page.waitForTimeout(350);
    const menu = page.locator('.anim-pop').last();
    const labels = await menu.locator('button > span:first-child').allInnerTexts();
    return { labels, menu, why: labels.length ? '' : 'the menu opened with nothing in it' };
  };

  const onCheckbox = await offeredFor('Tickable');
  report.check(
    'the When… menu opens on a checkbox',
    onCheckbox.labels.length > 0,
    onCheckbox.why || `${onCheckbox.labels.length} entries`
  );

  if (onCheckbox.labels.length) {
    report.check(
      'a checkbox is offered Ticked',
      onCheckbox.labels.includes('Ticked'),
      onCheckbox.labels.join(' · ')
    );
    report.check(
      'and the four pointer states, including the two that had no button',
      ['Pointed at', 'Being pressed', 'Focused', 'Focused by keyboard'].every((one) =>
        onCheckbox.labels.includes(one)
      ),
      onCheckbox.labels.filter((one) => one.startsWith('Focus') || one.includes('press')).join(' · ')
    );

    /* Picking one puts the condition the generator wants into the document. */
    await onCheckbox.menu.locator('button:has(span:text-is("Ticked"))').first().click();
    await page.waitForTimeout(900);
    const after = await getDocument(page, projectId);
    const rules = after.nodes.chkx?.rules ?? [];
    // `when` is a `Test`; one condition is that condition, not a list holding
    // it. Reading `when[0]` counted zero for a rule that was perfectly correct.
    const added = rules.filter(
      (rule) => rule.when?.kind === 'control' && rule.when.pseudo === 'checked'
    );
    report.check(
      'picking it writes a control condition the generator understands',
      added.length === 2,
      `${added.length} checked rules — one seeded, one added`
    );
  }

  /* ------------------------------------------------- a declared value ---- */

  /*
   * The gap X5 exists to close, driven through the real panel.
   *
   * A state's values used to be *discovered* by walking the subtree for
   * controls that set them, so a case could not exist until something reached
   * it — the empty case of a filter could not be designed until the button was
   * wired. Here a third case is added to a group whose controls only ever set
   * two, and then designed against.
   */
  {
    await showLayers();
    await page.locator('[data-layer-row]:has-text("Plan group")').first().click();
    await page.waitForTimeout(400);
    const panel = page.locator('aside').last();
    const opened = await openInspectorSection(page, 'Switch');
    report.check('the Switch section opens on a group that declares one', opened, String(opened));

    if (opened) {
      const row = panel.locator('div:has(> .panel-title)').first();
      const before = await panel.locator('[aria-label^="Remove "]').count();
      const add = panel.locator('input[placeholder="+ case"]').first();
      report.check('it offers somewhere to write a case down', await add.count() > 0, String(before));

      if (await add.count()) {
        await add.fill('lifetime');
        await add.blur();
        await page.waitForTimeout(700);
        const doc = await getDocument(page, projectId);
        const values = doc.nodes.grpo?.state?.values ?? [];
        report.check(
          'a case nothing sets is written down and kept',
          values.includes('lifetime'),
          values.join(' ') || 'no values'
        );
        /*
         * And it can be designed against — which is the whole point. Nothing
         * on the page sets `lifetime`, so before this the canvas had no way to
         * show it and the panel had no way to name it.
         */
        const editing = panel.locator('button:has-text("lifetime")');
        report.check(
          'and the canvas can be pointed at it',
          (await editing.count()) > 0,
          `${await editing.count()} controls mention it`
        );
        /*
         * And the box is ready for the next one. `TextInput` holds a draft and
         * only takes a new one when `value` changes — this field's is the
         * constant empty string, so the committed case sat in the box beside
         * the chip it had just become, reading as an edit that had not landed.
         */
        report.check(
          'and the box empties itself, ready for the next case',
          (await add.inputValue()) === '',
          JSON.stringify(await add.inputValue())
        );
      }
    }
  }

  const onContainer = await offeredFor('Plain box');
  /*
   * And the other half of the applicability rule, which is the one that keeps
   * the menu honest: a `div` is never ticked, and offering it would be
   * offering a selector that compiles, ships and can never match.
   */
  report.check(
    'a plain container is offered no control state at all',
    onContainer.labels.length > 0 &&
      !['Ticked', 'Unavailable', 'Filled in wrongly', 'Still empty'].some((one) =>
        onContainer.labels.includes(one)
      ),
    onContainer.why || onContainer.labels.join(' · ')
  );
  report.check(
    'but is still offered the pointer states',
    onContainer.labels.includes('Pointed at'),
    onContainer.why || onContainer.labels.slice(0, 4).join(' · ')
  );
} finally {
  await browser.close();
}

report.finish();
