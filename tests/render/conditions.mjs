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
};

/** A rule that paints the element when the condition holds. */
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
      rules: [paints('chkx', [{ kind: 'control', pseudo: 'checked' }], PAINT.checked)],
    }),
    node('btnd', 'button', 'Stoppable', {
      parentId: root.id,
      props: { label: 'Send' },
      rules: [paints('btnd', [{ kind: 'control', pseudo: 'disabled' }], PAINT.disabled)],
    }),
    node('inpv', 'input', 'Address', {
      parentId: root.id,
      props: { inputType: 'email', name: 'email', placeholder: 'you@company.com' },
      rules: [paints('inpv', [{ kind: 'control', pseudo: 'invalid' }], PAINT.invalid)],
    }),
    node('inpp', 'input', 'Empty one', {
      parentId: root.id,
      props: { inputType: 'text', name: 'note', placeholder: 'Say something' },
      rules: [
        paints('inpp', [{ kind: 'control', pseudo: 'placeholder-shown' }], PAINT.placeholder),
      ],
    }),
    node('btna', 'button', 'Pressable', {
      parentId: root.id,
      props: { label: 'Hold me' },
      rules: [paints('btna', [{ kind: 'pointer', pseudo: 'active' }], PAINT.active)],
    }),
    node('btnf', 'button', 'Focusable', {
      parentId: root.id,
      props: { label: 'Focus me' },
      rules: [paints('btnf', [{ kind: 'pointer', pseudo: 'focus' }], PAINT.focus)],
    }),
    node('boxp', 'container', 'Plain box', { parentId: root.id }),
    node('deto', 'details', 'Openable', {
      parentId: root.id,
      props: { summary: 'More' },
      rules: [
        paints('deto', [{ kind: 'attr', name: 'open', op: 'is', values: [''] }], PAINT.attr),
      ],
    }),
  ];

  for (const one of seeded) doc.nodes[one.id] = one;
  root.children = [...root.children, ...seeded.map((one) => one.id)];

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

  /* ----------------------------------------------------- no script for it -- */

  /*
   * None of this costs the visitor anything.
   *
   * Seven conditions, seven rules, and the page is still whatever it was —
   * every one of them is a selector. A shape that quietly needed the runtime
   * would be a shape that stops working with scripting off, and the whole
   * argument for compiling conditions to CSS is that they do not.
   */
  const html = await (await fetch(`${APP}/s/${projectId}/`)).text();
  const scripts = (html.match(/<script/gi) ?? []).length;
  report.check(
    'and none of them ships a line of script',
    scripts === 0,
    `${scripts} script tags`
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
    const added = rules.filter(
      (rule) => rule.when?.[0]?.kind === 'control' && rule.when[0].pseudo === 'checked'
    );
    report.check(
      'picking it writes a control condition the generator understands',
      added.length === 2,
      `${added.length} checked rules — one seeded, one added`
    );
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
