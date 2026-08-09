/**
 * Static site generation.
 *
 * Produces the finished HTML for every page from the same element model the
 * canvas renders, and the same stylesheet generator — only the responsive
 * at-rule differs (`@media` here, `@container` in the editor). There is no
 * second implementation of "what a Cre8 node looks like", which is what keeps
 * the published site honest.
 *
 * Output is plain HTML and CSS. A page that contains a switch also carries the
 * ~30-line behaviour runtime inline; a page that does not carries nothing to
 * execute. Either way it drops straight onto a CDN.
 */

import { describeElement, type AttrValue } from '../renderer/element-model';
import { variantsOf, type Variant } from '../renderer/variants';
import { behaviourRuntimeSource } from '../runtime/behaviour';
import { generateStylesheet, minifyCss } from '../renderer/css';
import { themeToCssVariables, usedWebFonts } from '../document/theme';
import { collectSubtree } from '../document/tree';
import { getElement } from '../document/schema';
import type { Cre8Document, NodeId, Page, SceneNode } from '../document/types';

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
  /** Give a form with no action of its own somewhere to post. */
  formAction?: (formId: string) => string;
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

  // A node whose rules change its content ships as one element per
  // alternative, every string in the file, with a stylesheet rule choosing
  // between them. That is what keeps conditional text indexed, selectable and
  // correct with scripting off — a script writing `textContent` would give a
  // crawler the default and nothing else.
  const variants = variantsOf(node);
  if (variants.length > 1) {
    return variants.map((variant) => renderVariant(doc, node, variant, options, depth)).join('');
  }
  return renderVariant(doc, node, variants[0]!, options, depth);
}

function renderVariant(
  doc: Cre8Document,
  node: SceneNode,
  variant: Variant,
  options: RenderNodeOptions,
  depth: number
): string {
  const model = describeElement(
    node,
    doc,
    {
      mode: 'publish',
      hrefResolver: options.hrefResolver,
      formAction: options.formAction,
    },
    variant
  );

  const attrs = renderAttrs(model.attrs);
  const tag = model.tag;

  // `model.void` means the element has no children — `textarea` keeps its value
  // in props, a divider has nothing inside it. That is not the same as being an
  // HTML void element, and only real void tags may omit a closing tag. Emitting
  // a bare `<div>` for a divider is invalid HTML, and the browser recovers by
  // nesting the entire rest of the page inside it.
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
  if (model.void) return `<${tag}${attrs}></${tag}>`;

  if (model.html !== undefined) return `<${tag}${attrs}>${model.html}</${tag}>`;
  if (model.text !== undefined) return `<${tag}${attrs}>${escapeHtml(model.text)}</${tag}>`;

  const rendered = getElement(node.type).container
    ? node.children
        .map((childId) => renderNodeToHtml(doc, childId, { ...options, depth: depth + 1 }))
        .join('')
    : '';
  const children = model.wrapChildren
    ? `<${model.wrapChildren}>${rendered}</${model.wrapChildren}>`
    : rendered;

  const lead = model.lead
    ? `<${model.lead.tag}>${escapeHtml(model.lead.text)}</${model.lead.tag}>`
    : '';

  return `<${tag}${attrs}>${lead}${children}</${tag}>`;
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
  /** Where the bytes can be read from right now, by a signed-in editor. */
  url: string;
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
    found.set(key, {
      key,
      path: `${ASSET_DIR}/${assetFileName(key)}`,
      url: `/api/assets/${encoded}`,
    });
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
    // A deferred template reference that never got resolved. Inert beats
    // shipping `page@pricing` as a literal href.
    if (href.startsWith('page@')) return '#';
    if (!href.startsWith('page:')) return href;
    const page = doc.pages.find((p) => p.id === href.slice(5));
    return page ? relativeHref(from, page) : '#';
  };
}

export interface RenderPageOptions {
  /** Emit readable HTML instead of the compact production form. */
  pretty?: boolean;
  /**
   * Absolute origin of the API, for form actions.
   *
   * A published site may be served from its own domain, so the action has to
   * be absolute — a relative path would post to the site's own Worker, which
   * has no database and would answer 404. Omitted, forms are published with
   * no action, which is honest: they post nowhere rather than somewhere
   * wrong.
   */
  apiOrigin?: string;
  /** Which project the submissions belong to. Required with `apiOrigin`. */
  projectId?: string;
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

  const body = renderNodeToHtml(doc, page.rootNodeId, {
    hrefResolver: hrefResolverFor(doc, page),
    formAction:
      options.apiOrigin && options.projectId
        ? (formId) =>
            // `r` is where to send the visitor afterwards. It travels in the
            // action rather than as a hidden input because a form element has
            // no children to inject one into — and it is needed at all because
            // the same-origin `/s/` fallback is served under a sandbox CSP,
            // which makes the page an opaque origin, so the browser sends no
            // Referer and the endpoint would have nothing to go back to.
            `${options.apiOrigin}/api/f/${encodeURIComponent(options.projectId!)}` +
            `/${encodeURIComponent(formId)}?r=${encodeURIComponent(pagePath(page))}`
        : undefined,
  });
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

  // The one script this project ships, and only onto pages that need it. A
  // page with no switch on it stays exactly what it was before Phase C: HTML
  // and CSS, nothing to execute. That is the invariant the suites assert now —
  // not "never any script", which stopped being true, but "no script unless
  // the page actually contains behaviour".
  const script = nodeIds.some((id) => doc.nodes[id]?.props.switchKey)
    ? `<script>${behaviourRuntimeSource()}</script>`
    : '';

  const lang = escapeAttr(doc.settings.language || 'en');
  const html = options.pretty
    ? `<!doctype html>
<html lang="${lang}">
  <head>
    ${head}
  </head>
  <body>
    ${body}
    ${script}
  </body>
</html>
`
    : `<!doctype html><html lang="${lang}"><head>${head}</head><body>${body}${script}</body></html>`;

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
