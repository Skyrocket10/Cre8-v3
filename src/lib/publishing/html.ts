/**
 * Static site generation.
 *
 * Produces the finished HTML for every page from the same element model the
 * canvas renders, and the same stylesheet generator — only the responsive
 * at-rule differs (`@media` here, `@container` in the editor). There is no
 * second implementation of "what a Cre8 node looks like", which is what keeps
 * the published site honest.
 *
 * Output is plain HTML and CSS with no runtime: it drops straight onto a CDN.
 */

import { describeElement, type AttrValue } from '../renderer/element-model';
import { generateStylesheet, minifyCss } from '../renderer/css';
import { themeToCssVariables, usedWebFonts } from '../document/theme';
import { collectSubtree } from '../document/tree';
import { getElement } from '../document/schema';
import type { Cre8Document, NodeId, Page } from '../document/types';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function renderAttrs(attrs: Record<string, AttrValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === null) continue;
    if (value === true) parts.push(key);
    else parts.push(`${key}="${escapeAttr(String(value))}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export interface RenderNodeOptions {
  /** Resolve `page:<id>` links to real paths. */
  hrefResolver?: (href: string) => string;
  /** Guard against a component that somehow contains itself. */
  depth?: number;
}

export function renderNodeToHtml(
  doc: Cre8Document,
  nodeId: NodeId,
  options: RenderNodeOptions = {}
): string {
  const depth = options.depth ?? 0;
  if (depth > 64) return '';

  const node = doc.nodes[nodeId];
  if (!node || node.meta.hidden) return '';

  if (node.type === 'instance') {
    const component = doc.components.find((c) => c.id === node.props.componentId);
    if (!component) return '';
    return renderNodeToHtml(doc, component.rootNodeId, { ...options, depth: depth + 1 });
  }

  const model = describeElement(node, doc, {
    mode: 'publish',
    hrefResolver: options.hrefResolver,
  });

  const attrs = renderAttrs(model.attrs);
  const tag = model.tag;

  if (model.void || VOID_TAGS.has(tag)) {
    // `textarea` is void in our model (its value lives in props) but is not a
    // void element in HTML, so it still needs a closing tag.
    if (tag === 'textarea') return `<textarea${attrs}></textarea>`;
    return `<${tag}${attrs}>`;
  }

  if (model.html !== undefined) return `<${tag}${attrs}>${model.html}</${tag}>`;
  if (model.text !== undefined) return `<${tag}${attrs}>${escapeHtml(model.text)}</${tag}>`;

  const children = getElement(node.type).container
    ? node.children
        .map((childId) => renderNodeToHtml(doc, childId, { ...options, depth: depth + 1 }))
        .join('')
    : '';

  return `<${tag}${attrs}>${children}</${tag}>`;
}

/* --------------------------------------------------------------------------
 * Whole pages
 * ----------------------------------------------------------------------- */

/**
 * A page's canonical path, always directory-style.
 *
 * The trailing slash is load-bearing rather than cosmetic: `/plans` and
 * `/plans/` resolve relative links to different places, and every internal link
 * below is relative. Both Workers redirect to this form.
 */
export function pagePath(page: Page): string {
  return page.isHome || page.slug === '' ? '/' : `/${page.slug}/`;
}

export function pageFilename(page: Page): string {
  return page.isHome || page.slug === '' ? 'index.html' : `${page.slug}/index.html`;
}

/** How many directory levels down from the site root a page sits. */
function depthOf(page: Page): number {
  if (page.isHome || page.slug === '') return 0;
  return page.slug.split('/').filter(Boolean).length;
}

/**
 * A link from one page to another, written relative to the page it sits on.
 *
 * Published files are the same bytes wherever they end up: the root of a
 * domain, `/s/<projectId>/` on the editor's origin, or a folder on someone's
 * desktop after unzipping. A root-absolute `/plans` only works in the first of
 * those — everywhere else it escapes the site and lands on whatever owns the
 * origin root. Relative links work in all three.
 */
export function relativeHref(from: Page, to: Page): string {
  const target = to.isHome || to.slug === '' ? '' : `${to.slug}/`;
  return '../'.repeat(depthOf(from)) + target || './';
}

/* --------------------------------------------------------------------------
 * Uploaded assets
 * ----------------------------------------------------------------------- */

/** Where the API puts an uploaded file: `/api/assets/<url-encoded R2 key>`. */
const ASSET_URL = /\/api\/assets\/([A-Za-z0-9%._~-]+)/g;

/** Directory published assets live in, inside the site. */
export const ASSET_DIR = '_assets';

export interface PublishedAsset {
  /** R2 object key under the uploads bucket. */
  key: string;
  /** Path inside the published site. */
  path: string;
}

/**
 * Every uploaded asset the document references.
 *
 * Found by scanning the serialised document rather than walking known fields.
 * An asset URL can sit in `props.src`, in a `backgroundImage` style, in
 * `settings.favicon`, in a page's `ogImage` — and in whatever field gets added
 * next. The document is JSON, so one pass over it cannot miss a surface the way
 * a list of field names silently would.
 */
export function collectPublishedAssets(doc: Cre8Document): PublishedAsset[] {
  const found = new Map<string, PublishedAsset>();
  for (const [, encoded] of JSON.stringify(doc).matchAll(ASSET_URL)) {
    const key = safeDecode(encoded ?? '');
    if (!key || found.has(key)) continue;
    found.set(key, { key, path: `${ASSET_DIR}/${assetFileName(key)}` });
  }
  return [...found.values()];
}

/** The R2 key's last segment, already sanitised and made unique at upload. */
function assetFileName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1) || key;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Point every asset reference at the copy inside the published site.
 *
 * Applied to the finished page rather than threaded through the renderer and
 * the CSS generator separately: the same URL turns up as an `src` attribute, a
 * `url()` in a generated rule, and a `<link rel="icon">`, and one pass over the
 * output covers all of them at once.
 *
 * The path is relative for the same reason page links are — the same bytes are
 * served from a domain root, from `/s/<projectId>/`, and from a folder on a
 * desktop.
 */
function rewriteAssetUrls(html: string, from: Page): string {
  const prefix = '../'.repeat(depthOf(from));
  return html.replace(ASSET_URL, (whole, encoded: string) => {
    const key = safeDecode(encoded);
    return key ? `${prefix}${ASSET_DIR}/${assetFileName(key)}` : whole;
  });
}

function hrefResolverFor(doc: Cre8Document, from: Page) {
  return (href: string): string => {
    if (!href) return '#';
    if (!href.startsWith('page:')) return href;
    const page = doc.pages.find((p) => p.id === href.slice(5));
    return page ? relativeHref(from, page) : '#';
  };
}

export interface RenderPageOptions {
  /** Emit readable HTML instead of the compact production form. */
  pretty?: boolean;
}

export function renderPage(doc: Cre8Document, page: Page, options: RenderPageOptions = {}): string {
  const nodeIds = collectSubtree(doc.nodes, page.rootNodeId);
  // Components referenced anywhere on this page still need their rules.
  for (const component of doc.components) nodeIds.push(...collectSubtree(doc.nodes, component.rootNodeId));

  const css = generateStylesheet(doc, {
    mode: 'media',
    nodeIds,
    themeVars: themeToCssVariables(doc.theme),
    rootSelector: ':root',
    includeStates: true,
    // This file *is* the document, so its body belongs to the page.
    standalone: true,
  });

  const body = renderNodeToHtml(doc, page.rootNodeId, { hrefResolver: hrefResolverFor(doc, page) });
  // A page inherits a sensible <title> rather than repeating its internal
  // name: the home page is the site, everything else is "Page · Site".
  const title =
    page.meta.title ||
    (page.isHome || page.slug === ''
      ? doc.settings.siteName
      : `${page.name} · ${doc.settings.siteName}`);
  const description = page.meta.description ?? doc.settings.description ?? '';

  const fonts = usedWebFonts(doc.theme);
  const fontLink = fonts.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts
        .map(
          (f) =>
            `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:wght@${f.weights.join(';')}`
        )
        .join('&')}&display=swap">`
    : '';

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeAttr(description)}">` : '',
    page.meta.noIndex ? '<meta name="robots" content="noindex">' : '',
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    description ? `<meta property="og:description" content="${escapeAttr(description)}">` : '',
    page.meta.ogImage ? `<meta property="og:image" content="${escapeAttr(page.meta.ogImage)}">` : '',
    '<meta property="og:type" content="website">',
    doc.settings.favicon ? `<link rel="icon" href="${escapeAttr(doc.settings.favicon)}">` : '',
    fontLink,
    `<style>${options.pretty ? css : minifyCss(css)}</style>`,
    doc.settings.customHead ?? '',
  ]
    .filter(Boolean)
    .join(options.pretty ? '\n    ' : '');

  const lang = escapeAttr(doc.settings.language || 'en');
  const html = options.pretty
    ? `<!doctype html>
<html lang="${lang}">
  <head>
    ${head}
  </head>
  <body>
    ${body}
  </body>
</html>
`
    : `<!doctype html><html lang="${lang}"><head>${head}</head><body>${body}</body></html>`;

  return rewriteAssetUrls(html, page);
}

/* --------------------------------------------------------------------------
 * Whole sites
 * ----------------------------------------------------------------------- */

export interface GeneratedFile {
  path: string;
  contents: string;
  bytes: number;
}

export interface GeneratedSite {
  files: GeneratedFile[];
  /**
   * Uploaded files the site needs, which the host copies from where they
   * already live rather than the browser re-uploading bytes it does not have.
   */
  assets: PublishedAsset[];
  totalBytes: number;
  pageCount: number;
}

export function generateSite(doc: Cre8Document, options: RenderPageOptions = {}): GeneratedSite {
  const files: GeneratedFile[] = [];

  for (const page of [...doc.pages].sort((a, b) => a.order - b.order)) {
    const contents = renderPage(doc, page, options);
    files.push({ path: pageFilename(page), contents, bytes: byteLength(contents) });
  }

  files.push(sitemap(doc));
  files.push(robots(doc));

  return {
    files,
    assets: collectPublishedAssets(doc),
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    pageCount: doc.pages.length,
  };
}

function sitemap(doc: Cre8Document): GeneratedFile {
  const urls = [...doc.pages]
    .sort((a, b) => a.order - b.order)
    .filter((p) => !p.meta.noIndex)
    .map((page) => `  <url><loc>${escapeHtml(pagePath(page))}</loc></url>`)
    .join('\n');
  const contents = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return { path: 'sitemap.xml', contents, bytes: byteLength(contents) };
}

function robots(doc: Cre8Document): GeneratedFile {
  const contents = `User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n`;
  void doc;
  return { path: 'robots.txt', contents, bytes: byteLength(contents) };
}

export function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length;
}
