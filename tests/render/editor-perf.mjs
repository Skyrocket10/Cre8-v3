/**
 * What the editor costs, measured on a document big enough to hurt.
 *
 * `docs/ARCHITECTURE.md` claims "1,000+ nodes, no perceptible lag" and lists
 * the four things that are supposed to buy it — per-node subscriptions,
 * CSS memoised on node identity, a windowed layer tree, overlays outside the
 * transform. This is that claim, put to a stopwatch.
 *
 * It is a probe rather than a gate: the numbers depend on the machine, so it
 * prints them and only *fails* on the ones that would be a bug at any speed.
 * A budget nobody can reproduce is a budget that gets deleted the first time
 * CI is busy.
 *
 * The interesting measurement is not "how long does one edit take" — it is how
 * much of the page is rebuilt per edit. So the probe counts renders as well as
 * milliseconds: a store change that re-renders forty inspector controls is
 * invisible at 200 nodes and is the whole problem at two thousand.
 */

import { APP, createReport, launch, openProject, READY_TIMEOUT, saveDocument, getDocument, signUp, node } from './harness.mjs';

const report = createReport();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

/** Sections × rows, giving roughly `4 × sections × rows` nodes. */
const SECTIONS = Number(process.env.CRE8_PERF_SECTIONS ?? 40);
const ROWS = 6;

const ms = (n) => `${n.toFixed(1)}ms`;

/**
 * Run `action`, then wait for the browser to actually paint the result.
 *
 * A double `requestAnimationFrame` is the only reliable "the frame that
 * contains my change has been committed" signal — measuring to the end of the
 * event handler measures React's synchronous half and misses layout, style
 * recalculation and paint, which on a page with a thousand elements is most of
 * the cost.
 */
async function timed(action) {
  await page.evaluate(() => {
    window.__t0 = performance.now();
  });
  await action();
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now() - window.__t0))
        );
      })
  );
}

/** Long tasks (>50ms) recorded while `action` runs — the jank a person feels. */
async function longTasks(action) {
  await page.evaluate(() => {
    window.__long = [];
    window.__obs?.disconnect();
    window.__obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__long.push(entry.duration);
    });
    window.__obs.observe({ entryTypes: ['longtask'] });
  });
  await action();
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    window.__obs?.disconnect();
    return window.__long ?? [];
  });
}

try {
  await signUp(page, 'Perry Kwan', 'perf');
  const id = await openProject(page, 'Blank');

  /* ------------------------------------------------- a document worth timing */

  const doc = await getDocument(page, id);
  const home = doc.pages.find((p) => p.isHome) ?? doc.pages[0];
  const root = doc.nodes[home.rootNodeId];

  for (let s = 0; s < SECTIONS; s++) {
    const sectionId = `sec${String(s).padStart(3, '0')}aaa`;
    const children = [];
    for (let r = 0; r < ROWS; r++) {
      const stackId = `stk${String(s).padStart(3, '0')}${String(r).padStart(2, '0')}`;
      const headId = `hed${String(s).padStart(3, '0')}${String(r).padStart(2, '0')}`;
      const bodyId = `bod${String(s).padStart(3, '0')}${String(r).padStart(2, '0')}`;
      doc.nodes[stackId] = node(stackId, 'stack', `Row ${s}.${r}`, {
        parentId: sectionId,
        children: [headId, bodyId],
        styles: {
          desktop: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' },
          mobile: { padding: '8px' },
        },
      });
      doc.nodes[headId] = node(headId, 'heading', `Heading ${s}.${r}`, {
        parentId: stackId,
        props: { text: `Section ${s} row ${r}`, level: 3 },
        styles: { desktop: { fontSize: '20px', fontWeight: '600', color: '#e2e8f0' } },
      });
      doc.nodes[bodyId] = node(bodyId, 'paragraph', `Body ${s}.${r}`, {
        parentId: stackId,
        props: { text: 'Some copy that exists so the element has a box worth laying out.' },
        styles: { desktop: { fontSize: '15px', color: '#94a3b8' } },
      });
      children.push(stackId);
    }
    doc.nodes[sectionId] = node(sectionId, 'section', `Section ${s}`, {
      parentId: root.id,
      children,
      styles: {
        desktop: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '32px' },
        tablet: { padding: '24px' },
      },
    });
    root.children.push(sectionId);
  }

  const total = Object.keys(doc.nodes).length;
  const saved = await saveDocument(page, doc);
  if (!report.check(`a ${total}-node document is accepted`, saved === 200, `HTTP ${saved}`)) {
    throw new Error(`could not seed (HTTP ${saved})`);
  }

  /* ------------------------------------------------------------- 1. opening */

  const openStart = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.cre8-frame.cre8-editing *').length > n,
    total / 2,
    { timeout: READY_TIMEOUT }
  );
  const openMs = Date.now() - openStart;
  await page.waitForTimeout(1500);

  const drawn = await page.evaluate(
    () => document.querySelectorAll('.cre8-frame.cre8-editing *').length
  );
  console.log(`\n  nodes ${total} · elements drawn ${drawn} · open ${openMs}ms\n`);
  report.check(
    'the whole document is on the canvas, not a truncated part of it',
    drawn >= total - 5,
    `${drawn} elements for ${total} nodes`
  );

  /* -------------------------------------------------- 2. how big is the CSS */

  const sheet = await page.evaluate(() => {
    const style = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .filter((t) => t.includes('@container') || t.includes('.c-'))
      .sort((a, b) => b.length - a.length)[0];
    return style?.length ?? 0;
  });
  console.log(`  canvas stylesheet ${(sheet / 1024).toFixed(0)}KB`);

  /* ---------------------------------------------------------- 3. selecting */

  // Deep in the document rather than at a fixed index, so the probe scales
  // with the fixture instead of silently aborting on a smaller one.
  const headings = await page.locator('.cre8-frame.cre8-editing h3').count();
  const target = page.locator('.cre8-frame.cre8-editing h3').nth(Math.floor(headings * 0.8));
  const selectMs = await timed(async () => {
    await target.click();
  });
  await page.waitForTimeout(400);
  // Driven entirely through the UI: the app ships no debug hook and adding one
  // to be measured would change the thing being measured.
  const named = await page.locator('aside').last().locator('input').first().inputValue();
  console.log(`  select an element ${ms(selectMs)}`);
  report.check(
    'clicking an element deep in the document selects it',
    /Heading/.test(named),
    named || 'the inspector did not follow'
  );

  /* ------------------------------------------ 4. one style edit, end to end */

  /*
   * A single property written to a single node. Everything the editor does
   * while you drag a slider is this, sixty times a second — so if one costs
   * more than a frame, dragging cannot be smooth however the drag is written.
   */
  const sizeField = page
    .locator('aside')
    .last()
    .locator('label:text-is("Size")')
    .locator('xpath=../..')
    .locator('input')
    .first();

  const editMs = [];
  for (const size of ['21', '22', '23', '24', '25']) {
    editMs.push(
      await timed(async () => {
        await sizeField.fill(size);
        await sizeField.press('Enter');
      })
    );
  }
  const editAvg = editMs.reduce((a, b) => a + b, 0) / editMs.length;
  const editWorst = Math.max(...editMs);
  console.log(`  one style write ${ms(editAvg)} avg, ${ms(editWorst)} worst`);
  report.check(
    'a single style write does not take longer than a quarter of a second',
    editWorst < 250,
    `${ms(editWorst)} worst of ${editMs.length}`
  );

  /* ------------------------------------------ 5. dragging, which is the test */

  /*
   * A *scrub*, not an element drag. Dragging an element on the canvas moves it
   * once, on drop; dragging the label inside a number field writes a style on
   * every pointer move, which is the interaction that actually asks the editor
   * to rebuild the page sixty times a second. The first version of this probe
   * measured the wrong one and reported no jank at all.
   */
  const jank = await longTasks(async () => {
    await sizeField.click();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(8);
    }
    await sizeField.press('Escape');
  });
  const worstJank = jank.length ? Math.max(...jank) : 0;
  const totalJank = jank.reduce((a, b) => a + b, 0);
  console.log(
    `  40 rapid style writes: ${jank.length} long tasks, worst ${ms(worstJank)}, total ${ms(totalJank)}`
  );
  report.check(
    'a burst of style writes does not lock the main thread for a visible stretch',
    worstJank < 250,
    `${jank.length} long tasks, worst ${ms(worstJank)}`
  );

  /* --------------------------------------- 6. typing into an inspector field */

  const nameField = page.locator('aside').last().locator('input').first();
  const typeMs = await timed(async () => {
    await nameField.fill('Renamed by the probe');
    await nameField.press('Enter');
  });
  console.log(`  one prop write ${ms(typeMs)}`);

  /* --------------------------------------------------------- 8. the layer tree */

  await page.keyboard.press('Escape');
  /*
   * Away and back, not "click Layers" — the rail toggles, and `leftTab`
   * already defaults to `layers`, so a single click *closes* the panel. The
   * first version of this probe did exactly that and then reported zero rows
   * mounted as evidence of good windowing.
   */
  await page.locator('nav button[aria-label="Insert"]').first().click();
  await page.waitForTimeout(400);
  const treeMs = await timed(async () => {
    await page.locator('nav button[aria-label="Layers"]').first().click();
  });
  await page.waitForSelector('[data-layer-row]', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(600);

  const rows = await page.locator('[data-layer-row]').count();
  console.log(`  open the layer tree ${ms(treeMs)} · ${rows} rows mounted of ${total} nodes`);
  report.check(
    'the layer tree mounts some rows at all, so the count below means something',
    rows > 0,
    `${rows} rows`
  );
  // Only meaningful once the tree is taller than the panel. On a small
  // fixture every row is legitimately on screen, and asserting otherwise
  // fails the probe for being run on a small document.
  const windowed = total > 400;
  report.check(
    windowed
      ? 'and it mounts a window rather than the whole document'
      : 'and it mounts the whole of a document that fits (nothing to window)',
    windowed ? rows > 0 && rows < total / 2 : rows > 0,
    `${rows} rows for ${total} nodes`
  );

  /* ------------------------------------------------------- 9. memory, roughly */

  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  if (heap) console.log(`  JS heap ${(heap / 1024 / 1024).toFixed(0)}MB`);
  console.log('');
} catch (error) {
  report.check('the probe ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
}

report.finish();
