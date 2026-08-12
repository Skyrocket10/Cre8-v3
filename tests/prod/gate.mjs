/**
 * The byte-identical gate, against a real deployment.
 *
 * Every other suite in this repo proves the two renderers agree *locally* —
 * the canvas against the string renderer, the browser publisher against the
 * Worker one, all of it driven by `wrangler dev`. That is miniflare: SQLite
 * standing in for D1, the filesystem for R2, an in-process object for the
 * Durable Object, and both Workers served by the same process. It is a good
 * simulation and it is not Cloudflare.
 *
 * This is the check that could not be written until something was deployed:
 * fetch a published site off the internet and compare it, file by file, with
 * what this repo's generator makes of the template it came from.
 *
 *     node tests/prod/gate.mjs <site-url> [template-id]
 *     node tests/prod/gate.mjs https://example.workers.dev/s/abc123/ saas
 *
 * ## What is normalised, and why each one has to be
 *
 * Two *different documents* are being compared — a project somebody made and a
 * freshly built template — so everything minted from a node id necessarily
 * differs while everything derived from structure does not. Left alone, three
 * of four pages come out the same length with different bytes, which is the
 * signature of exactly that and nothing else.
 *
 * - **Published class names** (`c-…`, `p-…`) are built from node ids.
 * - **`data-cre8-el` / `data-cre8-test`** carry node ids directly.
 * - **The form id in a submissions URL** is a node id.
 *
 * Each is replaced by its position in order of first appearance, so the
 * comparison asks the only question worth asking: did the two renderers walk
 * the same tree and emit the same things in the same order?
 *
 * - **The inlined runtimes** are set aside wholesale. The deployed Worker is
 *   bundled with `minify: true` and serialises its runtimes with
 *   `toString()`, so what reaches a published page is minified. The harness
 *   that loads this repo's modules compiles the same source with plain tsc and
 *   keeps every comment. That is a build difference, not a renderer one — and
 *   it is worth 9.5 KB on a page, which is enough to look alarming until you
 *   know what it is. Their *lengths* are still reported, because a runtime
 *   that stopped being minified in production is worth seeing.
 *
 * Nothing else is touched. Any remaining difference is a real one.
 */

import { createHash } from 'node:crypto';
import { createReport } from '../report.mjs';
import { loadBlocks } from '../static/load-blocks.mjs';

const [siteUrl, templateId = 'saas'] = process.argv.slice(2);
if (!siteUrl) {
  console.error('usage: node tests/prod/gate.mjs <site-url> [template-id]');
  process.exit(2);
}
const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;

/*
 * Node's `fetch` does not read HTTPS_PROXY, which curl and every other tool in
 * a proxied environment do. Without a dispatcher every request here comes back
 * as a 403 from the proxy and reads like the site is down. Wired only when the
 * variable is set, and skipped without complaint if `undici` is not installed,
 * because on a machine with direct egress none of this is needed.
 */
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
  } catch {
    console.error(`note: HTTPS_PROXY is set but undici is unavailable — requests may fail`);
  }
}

const report = createReport();

/* -------------------------------------------------------------- the local side */

const { TEMPLATES, generateSite } = loadBlocks();
const template = TEMPLATES.find((t) => t.id === templateId);
if (!template) {
  report.check(`the template "${templateId}" exists`, false, TEMPLATES.map((t) => t.id).join(', '));
  report.finish();
  process.exit(1);
}

/*
 * `apiOrigin` and `projectId` matter and are easy to forget: without them a
 * form is rendered with no `action` at all, while the deployed Worker always
 * supplies one. That is a 95-byte difference on any page with a form, and it
 * looks like a renderer disagreement rather than a missing argument.
 */
const origin = new URL(base).origin;
const projectId = /\/s\/([^/]+)\//.exec(base)?.[1] ?? 'PROJECT';
const local = generateSite(template.build(), {
  records: {},
  apiOrigin: origin,
  projectId,
});

/* ------------------------------------------------------------- what to compare */

const canon = (s) => {
  const seen = new Map();
  const id = (key) => {
    if (!seen.has(key)) seen.set(key, `x${seen.size}`);
    return seen.get(key);
  };
  return s
    .replace(/<script>[\s\S]*?<\/script>/g, '<script></script>')
    .replace(/\b([cp])-([a-z0-9]{2,})\b/g, (_, kind, v) => `${kind}-${id(kind + v)}`)
    .replace(/(data-cre8-(?:el|test)=")([^"]*)(")/g, (_, a, v, b) => a + id(`n${v}`) + b)
    .replace(/\/api\/f\/[^/]+\/([a-z0-9]+)/g, (_, f) => `/api/f/P/${id(`f${f}`)}`);
};

const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const scriptBytes = (s) =>
  [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => Buffer.byteLength(m[1]));

/* ------------------------------------------------------------------- the check */

let total = 0;
let served = 0;

for (const file of local.files) {
  const url = base + (file.path === 'index.html' ? '' : file.path.replace(/index\.html$/, ''));

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    report.check(`${file.path} is served`, false, `${url} — ${error.message}`);
    continue;
  }
  if (!response.ok) {
    report.check(`${file.path} is served`, false, `${url} — HTTP ${response.status}`);
    continue;
  }
  const body = await response.text();
  served += Buffer.byteLength(body);
  total += 1;

  const a = canon(body);
  const b = canon(file.contents);
  report.check(
    `${file.path} is the same file the local renderer makes`,
    a === b,
    a === b
      ? `${Buffer.byteLength(body)} bytes served, ${digest(a)}`
      : (() => {
          // Where, not just whether. A hash mismatch with no offset is a
          // failure nobody can act on.
          let i = 0;
          while (i < a.length && i < b.length && a[i] === b[i]) i++;
          return `diverges at ${i}: served ${JSON.stringify(
            a.slice(i, i + 60)
          )} / local ${JSON.stringify(b.slice(i, i + 60))}`;
        })()
  );

  const shipped = scriptBytes(body);
  if (shipped.length) {
    report.check(
      `${file.path} ships a minified runtime`,
      // The unminified source is over 12 KB, so anything near that means the
      // deployed bundle stopped minifying — which no local suite would notice.
      shipped.every((n) => n < 8000),
      shipped.map((n) => `${n} bytes`).join(', ')
    );
  }
}

report.check(
  'every file the local plan expects is on the internet',
  total === local.files.length,
  `${total}/${local.files.length} fetched, ${served} bytes served against ${local.totalBytes} generated`
);

/*
 * The security boundary, which is a property of the *response* rather than the
 * bytes. A site served from `/s/` shares an origin with the editor's session,
 * and the sandbox is the whole of what stops author-supplied script reaching
 * it. On a subdomain it is not needed and should be absent.
 */
const home = await fetch(base).catch(() => null);
if (home?.ok) {
  const csp = home.headers.get('content-security-policy') ?? '';
  const onFallback = /\/s\/[^/]+\/$/.test(base);
  report.check(
    onFallback
      ? 'the same-origin fallback is sandboxed'
      : 'a site on its own domain needs no sandbox',
    onFallback ? csp.includes('sandbox') : true,
    csp || 'no content-security-policy header'
  );
  report.check(
    'and it is not sniffable',
    home.headers.get('x-content-type-options') === 'nosniff',
    home.headers.get('x-content-type-options') ?? 'absent'
  );
}

report.finish();
