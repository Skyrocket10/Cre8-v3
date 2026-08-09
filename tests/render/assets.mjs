
/**
 * Can a stranger load the images on a published page — and are they worth
 * loading?
 *
 * The second half is newer. An image is the largest thing most pages ship, and
 * four things decide whether it is any good: the format it is encoded in, the
 * intrinsic size travelling with it so the page does not jump, the narrower
 * copies a small screen can take instead, and whether the one thing a visitor
 * is waiting for was told to wait its turn.
 */

import zlib from 'node:zlib';
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

/**
 * A real PNG, built here rather than pasted in as base64.
 *
 * The old fixture was a 2×2 red square, which was enough to prove an image
 * survives publishing and useless for everything this suite now asks: nothing
 * downscales, no responsive variant is narrower than the source, and an
 * intrinsic size of 2 tells you nothing about whether the intrinsic size is
 * being carried. So it is generated at a real photograph's dimensions.
 *
 * Written by hand because Node has no image encoder and the project has no
 * image dependency — a PNG is a signature, three chunks and a CRC, and that is
 * a smaller thing to own than a package.
 */
function makePng(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // A gradient rather than flat colour: a single colour compresses to almost
  // nothing at every size, so every rung of the ladder would come out the same
  // number of bytes and prove nothing about the encoder.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 3;
      raw[at] = (x * 255) / width;
      raw[at + 1] = (y * 255) / height;
      raw[at + 2] = ((x + y) * 255) / (width + height);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SOURCE_WIDTH = 1600;
const SOURCE_HEIGHT = 1000;
const PNG = makePng(SOURCE_WIDTH, SOURCE_HEIGHT);

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

  /* ------------------------------------ 3b. and it knows what it is made of */

  const onCanvas = await page.locator('.cre8-frame.cre8-editing img').first().evaluate((img) => ({
    width: img.getAttribute('width'),
    height: img.getAttribute('height'),
    srcset: img.getAttribute('srcset') ?? '',
    loading: img.getAttribute('loading'),
  }));

  // A PNG this size is re-encoded on the way in, and the whole point of doing
  // it in the browser is that the format is the modern one rather than
  // whichever one the designer happened to export.
  check('the upload was re-encoded, not stored as the PNG that arrived',
    (assetUrl ?? '').endsWith('.webp'), assetUrl?.slice(assetUrl.lastIndexOf('.')) ?? 'no extension');

  // 1600 wide is under the 2200 ceiling, so the intrinsic size should come
  // through untouched — this is a check on the number surviving, not on maths.
  check('choosing it records the intrinsic size on the node',
    onCanvas.width === String(SOURCE_WIDTH) && onCanvas.height === String(SOURCE_HEIGHT),
    `${onCanvas.width}×${onCanvas.height}, wanted ${SOURCE_WIDTH}×${SOURCE_HEIGHT}`);

  // Rungs below 1600: 480, 960 and 1440, plus the full-size original.
  const widths = [...onCanvas.srcset.matchAll(/(\d+)w/g)].map((m) => Number(m[1]));
  check('and the narrower copies it can offer instead',
    widths.join(',') === `480,960,1440,${SOURCE_WIDTH}`,
    widths.length ? `${widths.join('w, ')}w` : 'no srcset');
  check('every entry in the srcset is a real uploaded object',
    onCanvas.srcset.split(',').every((entry) => entry.trim().startsWith('/api/assets/')),
    onCanvas.srcset.slice(0, 70) || 'empty');

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

  /* ------------------------------- 4b. and it is described well enough to load */

  const tag = html.match(/<img[^>]*>/)?.[0] ?? '';
  check('the published image carries its intrinsic size, so the page cannot jump',
    new RegExp(`width="${SOURCE_WIDTH}"`).test(tag) && new RegExp(`height="${SOURCE_HEIGHT}"`).test(tag),
    tag.slice(0, 100));
  check('it is lazy by default, since most images are below the fold',
    /loading="lazy"/.test(tag) && /decoding="async"/.test(tag),
    /loading="[a-z]+"/.exec(tag)?.[0] ?? 'no loading attribute');
  check('the narrower copies ship with it',
    (tag.match(/_assets\/[^ ,"]+ \d+w/g) ?? []).length === 4,
    `${(tag.match(/\d+w/g) ?? []).length} srcset entries`);
  // Without `sizes` the browser assumes the image fills the viewport and
  // fetches the widest file it has — a srcset with no sizes can be slower than
  // no srcset at all.
  check('and a sizes hint, without which the srcset would pick the largest every time',
    /sizes="[^"]+"/.test(tag), /sizes="([^"]*)"/.exec(tag)?.[1] ?? 'absent');

  const variants = [...html.matchAll(/_assets\/([^ ,"]+) \d+w/g)].map((m) => m[1]);
  const fetched = await Promise.all(
    [...new Set(variants)].map((file) =>
      anonCtx.request.get(`${APP}/s/${projectId}/_assets/${file}`).then((r) => r.status())
    )
  );
  check('every one of them was published, not just referenced',
    fetched.length > 1 && fetched.every((status) => status === 200),
    `${fetched.filter((s) => s === 200).length}/${fetched.length} reachable`);

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

  /* ------------------------------- 6b. and the one above the fold does not wait */

  /*
   * Lazy-loading everything is the easy default and the wrong one: the largest
   * image at the top of the page is usually the thing a visitor is waiting
   * for, and deferring it makes the page measurably slower while looking like
   * an optimisation. So the choice is a control, and this is the check that
   * the control reaches the markup.
   */
  await page.bringToFront();
  await page.locator('.cre8-frame.cre8-editing img').first().click();
  await page.waitForTimeout(600);
  await page.locator('button:text-is("Straight away")').first().click();
  await page.waitForTimeout(600);

  await page.click('button:has-text("Publish")');
  await page.waitForSelector('text=/pages? published/', { timeout: PUBLISH_TIMEOUT });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const eagerTag = (await (await fetch(`${APP}/s/${projectId}/`)).text()).match(/<img[^>]*>/)?.[0] ?? '';
  check('an image marked to load straight away is not deferred',
    !/loading="lazy"/.test(eagerTag) && /fetchpriority="high"/.test(eagerTag),
    eagerTag.slice(0, 110));
  check('and it is decoded on the main thread rather than painted around',
    /decoding="sync"/.test(eagerTag),
    /decoding="[a-z]+"/.exec(eagerTag)?.[0] ?? 'absent');

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
