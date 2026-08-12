/**
 * What arrives, and what a press does.
 *
 * Split out of `behaviour.mjs`, which had grown to ten sections and several
 * publishes and was taking eleven minutes — long enough that it began failing on
 * the environment rather than on the code, and long enough that the checks at
 * the end were the ones paying for it. Six runs were spent trying to observe
 * three of them. A suite you learn to distrust is worse than a smaller one.
 *
 * The two halves that moved are the ones that belong together anyway: a reveal
 * and a press are both *what an element does*, and neither is about the switch
 * machinery the other suite was written for.
 *
 * Everything here is checked against the cases the platform does not guarantee.
 * A reveal that leaves content invisible is not a missing flourish, it is a
 * blank page — so it is measured before and after scrolling, with reduced
 * motion, and on a page too short to scroll at all. A jump is a link, so it is
 * checked to be one; copying is the single action with no element behind it, so
 * it is checked to cost nothing on a page that does not use it.
 */

import {
  APP,
  getDocument,
  launch,
  node,
  openProject,
  publish,
  READY_TIMEOUT,
  saveDocument,
  signUp,
} from './harness.mjs';
import { createReport } from '../report.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

try {
  await signUp(page, 'Press Gantry', 'press');
  const id = await openProject(page, 'Blank');

  /* ------------------------------ 9. arriving as you scroll to it --------- */

  /*
   * The one visual effect that needs machinery past a declaration, and the two
   * cases the platform does not cover for it: a browser with no scroll-driven
   * animations, and a visitor who asked for less motion. Both have to end with
   * the element *visible* — a reveal that leaves content at `opacity: 0` on a
   * browser that could not run it is not a flourish, it is a blank page.
   *
   * Seeded rather than built through the panel: the claim here is about what
   * the published file does, and the row that writes it is checked in the
   * inspector suite.
   */
  // Taken here rather than inherited from an earlier section: this suite starts
  // from an empty project, so the count before the reveal is the honest zero.
  const beforeReveal = ((await (await fetch(`${APP}/s/${id}/`)).text()).match(/<script/gi) ?? [])
    .length;
  const revealDoc = await getDocument(page, id);
  {
    const home = revealDoc.pages.find((p) => p.isHome) ?? revealDoc.pages[0];
    const root = revealDoc.nodes[home.rootNodeId];
    /*
     * Something above it, so the page scrolls at all.
     *
     * This was inherited rather than declared while these checks lived in the
     * behaviour suite: by the time they ran, eight earlier sections had put a
     * form and two switches on the page. Extracted into a suite that starts
     * from an empty project, "it was waiting its turn" failed — correctly, on a
     * page with no turn to wait for. The dependency was invisible for as long
     * as it was satisfied by accident.
     */
    revealDoc.nodes.revealfill = node('revealfill', 'section', 'Above it', {
      parentId: home.rootNodeId,
      props: {},
      styles: { desktop: { minHeight: '1400px' } },
    });
    revealDoc.nodes.revealband = node('revealband', 'section', 'Reveal band', {
      parentId: home.rootNodeId,
      props: {},
      styles: { desktop: { appear: 'rise', minHeight: '200px', backgroundColor: '#0b1220' } },
    });
    root.children = [...root.children, 'revealfill', 'revealband'];
  }
  const revealSaved = await saveDocument(page, revealDoc);
  report.check('the reveal seeded', revealSaved === 200, `HTTP ${revealSaved}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1200);
  await publish(page);

  const revealed = await (await fetch(`${APP}/s/${id}/`)).text();
  report.check(
    'a page with a reveal on it ships nothing extra to execute',
    (revealed.match(/<script/gi) ?? []).length === beforeReveal,
    /*
     * Against the count taken a moment ago, not against section 1's empty page:
     * by here the project has a switch and a form on it and legitimately
     * carries the behaviour runtime. Comparing to the original baseline
     * reported the reveal as having added a script it did not add.
     */
    `${(revealed.match(/<script/gi) ?? []).length} script(s), ${beforeReveal} before the reveal`
  );

  /*
   * Measured in a short viewport and again after scrolling to it, because those
   * are two different questions and only one of them is about the animation.
   *
   * A reveal that leaves content at `opacity: 0` is not a missing flourish, it
   * is a blank page — and on the machine it was designed on, where everything
   * is above the fold, it looks identical to one that works.
   */
  const shown = await ctx.newPage();
  await shown.setViewportSize({ width: 1200, height: 500 });
  await shown.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  await shown.waitForTimeout(800);

  const read = () =>
    shown.evaluate(() => {
      const band = document.querySelector('[data-reveal-band]')
        ?? [...document.querySelectorAll('section')].pop();
      if (!band) return null;
      const cs = getComputedStyle(band);
      return {
        opacity: Number(cs.opacity),
        name: cs.animationName,
        fill: cs.animationFillMode,
        scrollable: document.documentElement.scrollHeight > window.innerHeight,
      };
    });

  const beforeScroll = await read();
  await shown.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await shown.waitForTimeout(900);
  const afterScroll = await read();

  report.check(
    'the element it reveals is on screen once it has been scrolled to',
    afterScroll !== null && afterScroll.opacity > 0.9,
    JSON.stringify(afterScroll)
  );
  report.check(
    'and it is the reveal doing it, not a coincidence',
    afterScroll?.name?.includes('cre8-ap-rise') === true && afterScroll?.fill === 'both',
    JSON.stringify({ name: afterScroll?.name, fill: afterScroll?.fill })
  );
  report.check(
    'and it was waiting its turn before that, rather than already finished',
    beforeScroll !== null && beforeScroll.scrollable && beforeScroll.opacity < 0.9,
    // Otherwise the check above proves nothing: an element that was visible the
    // whole time would pass it whether or not the animation ran at all.
    JSON.stringify(beforeScroll)
  );
  await shown.close();

  /* Each of the above, handed something it must reject. */
  const calm = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1200, height: 800 },
  });
  const quietPage = await calm.newPage();
  await quietPage.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  await quietPage.waitForTimeout(600);
  const quietSeen = await quietPage.evaluate(() => {
    const band = [...document.querySelectorAll('section')].pop();
    return band ? Number(getComputedStyle(band).opacity) : null;
  });
  report.check(
    'somebody who asked for less motion gets the content, not a fade',
    quietSeen !== null && quietSeen > 0.9,
    // The keyframes are redefined under the media query rather than switched
    // off, so this is the same animation arriving at the same place having
    // moved nothing. A blanket override would have had to out-specify every
    // rule on the page.
    `opacity ${quietSeen}`
  );
  await calm.close();

  /*
   * And the case that would be a blank page rather than a missing flourish: a
   * page too short to scroll at all.
   *
   * Backwards fill is what holds an element at `opacity: 0` before its turn, so
   * "there is no turn" is the one arrangement where a reveal could plausibly
   * hide content for good — and on the machine it was designed on, where
   * everything is above the fold, it would look identical to one that works.
   *
   * The page is stripped to the band rather than given a tall viewport, because
   * the first attempt did the latter: this page carries a form and two switches
   * by now and scrolls at any height, so the check passed a scrollable page off
   * as an unscrollable one and proved nothing at all.
   */
  const onlyBand = await getDocument(page, id);
  {
    const home = onlyBand.pages.find((p) => p.isHome) ?? onlyBand.pages[0];
    onlyBand.nodes[home.rootNodeId].children = ['revealband'];
    onlyBand.nodes.revealband.styles.desktop.minHeight = '80px';
  }
  await saveDocument(page, onlyBand);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1200);
  await publish(page);

  const tall = await browser.newContext({ viewport: { width: 1200, height: 3000 } });
  const shortPage = await tall.newPage();
  await shortPage.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  await shortPage.waitForTimeout(800);
  const unscrollable = await shortPage.evaluate(() => {
    const band = [...document.querySelectorAll('section')].pop();
    return {
      opacity: band ? Number(getComputedStyle(band).opacity) : null,
      scrollable: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  report.check(
    'a page too short to scroll shows what it reveals rather than hiding it',
    unscrollable.opacity !== null && unscrollable.opacity > 0.9 && !unscrollable.scrollable,
    // The platform's answer is that an inactive timeline means the effect is
    // not applied. Pinned rather than assumed, because it is exactly the sort
    // of thing an engine changes and the failure is a page of nothing.
    JSON.stringify(unscrollable)
  );
  await tall.close();
  /* --------------------------- 10. what a press does ---------------------- */

  /*
   * Two actions, and they sit at opposite ends of the same question. Jumping to
   * a section is a link — nothing to execute, works with scripting off, and the
   * only new thing is that the fragment is minted from a reference instead of
   * typed. Copying has no element behind it at all, so it is the one action
   * that costs a visitor a script.
   */
  const pressDoc = await getDocument(page, id);
  {
    const home = pressDoc.pages.find((p) => p.isHome) ?? pressDoc.pages[0];
    const root = pressDoc.nodes[home.rootNodeId];
    pressDoc.nodes.jumpbtn = node('jumpbtn', 'button', 'Jump', {
      parentId: home.rootNodeId,
      props: { label: 'See pricing' },
      refs: { scrollTo: { node: 'pricingband' } },
    });
    pressDoc.nodes.copybtn = node('copybtn', 'button', 'Copy', {
      parentId: home.rootNodeId,
      props: { label: 'Copy command', copyText: 'npm i cre8' },
    });
    pressDoc.nodes.filler = node('filler', 'section', 'Filler', {
      parentId: home.rootNodeId,
      styles: { desktop: { minHeight: '1800px' } },
    });
    /*
     * Tall enough that the browser can actually bring it to the top. At 400px
     * on a 700px viewport it is the last thing on the page, so the scroll runs
     * out and the band settles 300px down — correct behaviour, and a check
     * asserting "near the top" then fails for a reason that has nothing to do
     * with the link.
     */
    pressDoc.nodes.pricingband = node('pricingband', 'section', 'Pricing band', {
      parentId: home.rootNodeId,
      props: { anchor: 'Pricing band' },
      styles: { desktop: { minHeight: '900px', backgroundColor: '#123' } },
    });
    root.children = ['jumpbtn', 'copybtn', 'filler', 'pricingband'];
  }
  await saveDocument(page, pressDoc);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1200);
  await publish(page);

  const pressed = await browser.newContext({ viewport: { width: 1200, height: 700 } });
  await pressed.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  const acting = await pressed.newPage();
  await acting.goto(`${APP}/s/${id}/`, { waitUntil: 'load' });
  await acting.waitForTimeout(500);

  const jump = acting.locator('a:has-text("See pricing")');
  report.check(
    'a control that jumps is a link, so it works with no scripting at all',
    (await jump.count()) === 1,
    // `resolveTag` decided that from `props.href`, which a reference does not
    // set, so it stayed a `<button>` and dropped the href until the tag rule
    // learned about the reference too.
    `${await jump.count()} link(s) for the jump`
  );
  if (await jump.count()) {
    await jump.click();
    await acting.waitForTimeout(1200);
    const landed = await acting.evaluate(() => {
      const band = document.getElementById('pricing-band');
      return {
        scrolled: window.scrollY,
        top: band ? Math.round(band.getBoundingClientRect().top) : null,
      };
    });
    report.check(
      'and pressing it lands on the section',
      landed.scrolled > 200 && landed.top !== null && landed.top >= 0 && landed.top < 150,
      // Both halves: the page moved, and it moved to the right place. Either
      // alone passes for a link that scrolls to the wrong section. The upper
      // bound allows the 96px `scroll-margin-top` the reset gives every id, so
      // a heading does not end up under a sticky header.
      JSON.stringify(landed)
    );
  }

  await acting.evaluate(() => window.scrollTo(0, 0));
  await acting.locator('button:has-text("Copy command")').click();
  await acting.waitForTimeout(400);
  const clip = await acting.evaluate(() => navigator.clipboard.readText());
  report.check(
    'a control that copies puts its text on the clipboard',
    clip === 'npm i cre8',
    JSON.stringify(clip)
  );
  const marked = await acting.evaluate(() =>
    Boolean(document.querySelector('[data-cre8-copied]'))
  );
  report.check(
    'and says so through an attribute, rather than wording it itself',
    marked,
    // An attribute condition is something the rules panel has expressed since
    // stage 2, so "say Copied for a second" is a rule the designer writes and
    // styles like any other state. The runtime has no opinion about the words.
    marked ? 'data-cre8-copied is set' : 'nothing marked'
  );
  await acting.waitForTimeout(1600);
  report.check(
    'and stops saying so',
    !(await acting.evaluate(() => Boolean(document.querySelector('[data-cre8-copied]')))),
    // Otherwise the mark is not feedback, it is a permanent change of state.
    'the mark is removed again'
  );
  await pressed.close();
} catch (error) {
  report.check('press suite completed', false, error.message);
} finally {
  await browser.close();
  report.finish();
}
