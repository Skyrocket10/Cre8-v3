
/** Can a stranger load the images on a published page? */

import { APP, ARTIFACTS, launch, PUBLISH_TIMEOUT, READY_TIMEOUT } from './harness.mjs';

const results = [];
let failed = 0;
const check = (n, ok, d = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`);
};

const stamp = Date.now();
const U = { email: `asset${stamp}@cre8.test`, name: 'Ansel Adams', pw: 'correct-horse-battery' };

// A tiny but genuinely decodable PNG (red 2x2).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64'
);

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

try {
  await page.goto(`${APP}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[autocomplete="name"]', U.name);
  await page.fill('input[type="email"]', U.email);
  await page.fill('input[type="password"]', U.pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${APP}/`, { timeout: READY_TIMEOUT });

  await page.locator('button:has-text("Blank")').first().click();
  await page.waitForURL(/\/editor\?p=/, { timeout: READY_TIMEOUT });
  const projectId = new URL(page.url()).searchParams.get('p');
  await page.waitForSelector('.cre8-frame.cre8-editing', { timeout: READY_TIMEOUT });
  await page.waitForSelector('header >> text=Live', { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);

  /* --------------------------------------- 1. upload through the Assets panel */

  await page.locator('button[aria-label="Assets"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('aside input[type="file"], input[type="file"]').first()
    .setInputFiles({ name: 'hero shot.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForTimeout(3000);

  const anonCtx = await browser.newContext();

  /* --------------------------------- 3. put it on the page, the way a designer would */

  await page.locator('button[aria-label="Insert"]').first().click();
  await page.waitForTimeout(400);
  // Exact match on the label: `has-text` is a substring, and the library now
  // contains blocks whose names mention an image ("CTA with image"), which sort
  // above the element cards and would be clicked instead.
  const imageCard = page.locator('button:has(span:text-is("Image"))').first();
  await imageCard.scrollIntoViewIfNeeded().catch(() => {});
  await imageCard.click();
  await page.waitForTimeout(1000);

  const choose = page.locator('button:has-text("Choose image"), button:has-text("Replace image")').first();
  await choose.waitFor({ timeout: 15000 });
  check('an image element is selected and offers a source', true);
  await choose.click();

  const picker = page.locator('.anim-pop').last();
  await picker.waitFor({ state: 'visible', timeout: 10000 });
  const options = picker.locator('button');
  check('the uploaded asset appears in the picker', (await options.count()) > 0,
    (await picker.innerText()).slice(0, 60).replace(/\n/g, ' '));
  await options.first().click();
  await page.locator('.cre8-frame.cre8-editing img').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);

  // The node's own src is the fact that matters — read it off the canvas.
  const assetUrl = await page.locator('.cre8-frame.cre8-editing img').first().getAttribute('src');
  check('the chosen image points at the authenticated API path',
    (assetUrl ?? '').startsWith('/api/assets/'), assetUrl ?? 'no img on canvas');

  if (assetUrl) {
    const anonProbe = await anonCtx.request.get(`${APP}${assetUrl}`);
    check('a signed-out visitor cannot read that uploads path',
      anonProbe.status() === 401 || anonProbe.status() === 404, `HTTP ${anonProbe.status()}`);
  }

  /* ------------------------------------------------------------- 4. publish */

  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: PUBLISH_TIMEOUT });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const html = await (await fetch(`${APP}/s/${projectId}/`)).text();
  check(
    'the published page no longer points at /api/assets',
    !html.includes('/api/assets/'),
    (html.match(/\/api\/assets\/[^"']*/) ?? ['none'])[0]
  );
  const ref = html.match(/src="([^"]*_assets\/[^"]+)"/);
  check('it points at a copy inside the site, relatively', Boolean(ref), ref?.[1] ?? 'no _assets reference');

  /* --------------------------------------- 5. a stranger can now load the image */

  if (ref) {
    const anonImg = await anonCtx.request.get(`${APP}/s/${projectId}/${ref[1]}`);
    check('a signed-out visitor can load it from the published site',
      anonImg.status() === 200, `HTTP ${anonImg.status()}`);
    check('served as an image', (anonImg.headers()['content-type'] ?? '').startsWith('image/'),
      anonImg.headers()['content-type'] ?? 'none');
    // Not byte-identical to the upload on purpose: the editor downscales and
    // re-encodes before storing, so what R2 holds is its own image.
    const bytes = await anonImg.body();
    check('the bytes are a real image, not an error page', bytes.length > 0 && !bytes.includes('<html'),
      `${bytes.length} bytes`);
  }

  /* ------------------------------------ 6. the browser actually renders it */

  const visitor = await anonCtx.newPage();
  const failedRequests = [];
  visitor.on('requestfailed', (r) => failedRequests.push(r.url()));
  visitor.on('response', (r) => {
    if (r.status() >= 400 && /\.(png|jpe?g|webp|svg|avif)$/i.test(r.url())) failedRequests.push(`${r.status()} ${r.url()}`);
  });
  await visitor.goto(`${APP}/s/${projectId}/`, { waitUntil: 'networkidle' });
  await visitor.waitForTimeout(800);
  check('no broken image requests on the published page', failedRequests.length === 0,
    failedRequests.slice(0, 2).join(', '));

  const decoded = await visitor.evaluate(() =>
    [...document.images].map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth }))
  );
  check('the image decoded in the browser',
    decoded.length > 0 && decoded.every((i) => i.w > 0), JSON.stringify(decoded));

  /* ---------------------------- 7. one project cannot copy another's uploads */

  const stolen = await page.evaluate(
    async ({ id }) => {
      const r = await fetch(`/api/projects/${id}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-cre8-csrf': '1', 'content-type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: 'index.html', contents: '<html></html>' }],
          assets: [{ key: 'someone-elses-project/secret.png', path: '_assets/secret.png' }],
        }),
      });
      return r.status;
    },
    { id: projectId }
  );
  check("an asset key outside the project is refused", stolen === 403, `HTTP ${stolen}`);

  /* ------------------------------------------- 8. the ZIP carries the bytes too */

  await page.bringToFront();
  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: PUBLISH_TIMEOUT });

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: PUBLISH_TIMEOUT }),
    page.click('button:has-text("Download ZIP")'),
  ]).then(([d]) => d);

  const zipPath = `${ARTIFACTS}/export.zip`;
  await download.saveAs(zipPath);
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync('python3', ['-c',
    `import zipfile,sys\nz=zipfile.ZipFile('${zipPath}')\nbad=z.testzip()\nprint('BAD' if bad else 'OK')\n` +
    `[print(i.filename, i.file_size) for i in z.infolist()]`], { encoding: 'utf8' });
  console.log('  zip:', listing.split('\n').filter(Boolean).join(' | '));

  check('the archive is a valid ZIP', listing.startsWith('OK'));
  const assetLine = listing.split('\n').find((l) => l.startsWith('_assets/'));
  check('it contains the image', Boolean(assetLine), assetLine ?? 'no _assets entry');
  check('with real bytes, not an empty placeholder',
    Boolean(assetLine) && Number(assetLine.split(' ').pop()) > 100, assetLine ?? '');

  /* --------------------------------- 9. and the archive works opened from disk */

  const outDir = `${ARTIFACTS}/unzipped`;
  execFileSync('python3', ['-c',
    `import zipfile,shutil,os\nshutil.rmtree('${outDir}',ignore_errors=True)\n` +
    `zipfile.ZipFile('${zipPath}').extractall('${outDir}')`]);

  const disk = await anonCtx.newPage();
  const diskFailures = [];
  disk.on('requestfailed', (r) => diskFailures.push(r.url()));
  await disk.goto(`file://${outDir}/index.html`, { waitUntil: 'load' });
  await disk.waitForTimeout(800);
  const diskImages = await disk.evaluate(() =>
    [...document.images].map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth }))
  );
  check('opened straight from disk, the image still resolves',
    diskImages.length > 0 && diskImages.every((i) => i.w > 0),
    `${JSON.stringify(diskImages)} ${diskFailures.slice(0, 1).join('')}`);
} catch (error) {
  check('harness completed', false, error.message);
} finally {
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
