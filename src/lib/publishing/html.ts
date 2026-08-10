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
import { boundProps, repeatRows, type RecordSet } from '../renderer/repeat';
import { behaviourRuntimeSource } from '../runtime/behaviour';
import {
  DATA_ATTR,
  collectDataSources,
  dataRuntimeSource,
  fallbackTokens,
} from '../runtime/data';
import { generateStylesheet, minifyCss } from '../renderer/css';
import { themeToCssVariables, usedWebFonts } from '../document/theme';
import { collectSubtree } from '../document/tree';
import {
  instanceHidden,
  overriddenProps,
  scopeForInstance,
  type OverrideScope,
} from '../document/components';
import { getElement } from '../document/schema';
import type { CollectionRecord, Cre8Document, NodeId, SceneNode } from '../document/types';
import { depthOf, plan, relativePath, type Output, type PageWindow } from './routes';

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
  /** Resolve `page:<id>` and `series:*` links to real paths. */
  hrefResolver?: (href: string, record: CollectionRecord | null) => string;
  /** Give a form with no action of its own somewhere to post. */
  formAction?: (formId: string) => string;
  /** Every collection's rows, for the repeaters on this page. */
  records?: RecordSet;
  /**
   * The record in scope.
   *
   * Set by the nearest repeater above this node — or, on a dynamic page, by
   * the route itself before the tree is entered, which is what makes `bind`
   * work the same on a detail page as it does inside a list.
   */
  record?: CollectionRecord | null;
  /** Which slice of which repeater this file shows, on a paginated index. */
  window?: PageWindow | null;
  /**
   * What the component instance above this node fills in.
   *
   * Set when descending from an instance into its master, and replaced — never
   * merged — at a nested instance: the inner master's node ids belong to the
   * inner component, so an outer scope has nothing to say about them.
   */
  overrides?: OverrideScope | null;
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
  const scope = options.overrides ?? null;
  if (!node) return '';
  // A property that says "visible" un-hides a node the master hid — that is
  // what exposing it is for — so the instance is asked first and `meta` only
  // answers when it has said nothing.
  if (instanceHidden(node, scope) ?? node.meta.hidden) return '';

  if (node.type === 'instance') {
    const component = doc.components.find((c) => c.id === node.props.componentId);
    if (!component) return '';
    // Replaced, not merged. An instance nested inside a master still answers
    // to the outer scope for its own visibility — that is the check above,
    // which ran before this branch — but the nodes it is about to draw belong
    // to another component, and the outer scope cannot address them.
    return renderNodeToHtml(doc, component.rootNodeId, {
      ...options,
      overrides: scopeForInstance(component, node),
      depth: depth + 1,
    });
  }

  // The record in scope, written over the node's own props — and over whatever
  // the instance above filled in, which is why the override goes underneath
  // rather than on top. Everything below reads `variant.props`, so a bound
  // `src` reaches the `srcset` logic and a bound `href` reaches the link
  // resolver without either of them learning what a record is.
  const props = boundProps(node, options.record ?? null, overriddenProps(node, scope));

  // A node whose rules change its content ships as one element per
  // alternative, every string in the file, with a stylesheet rule choosing
  // between them. That is what keeps conditional text indexed, selectable and
  // correct with scripting off — a script writing `textContent` would give a
  // crawler the default and nothing else.
  const variants = variantsOf(node, props);
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
      record: options.record ?? null,
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

  const rendered = getElement(node.type).container ? renderChildren(doc, node, options, depth) : '';
  const children = model.wrapChildren
    ? `<${model.wrapChildren}>${rendered}</${model.wrapChildren}>`
    : rendered;

  const lead = model.lead
    ? `<${model.lead.tag}>${escapeHtml(model.lead.text)}</${model.lead.tag}>`
    : '';

  return `<${tag}${attrs}>${lead}${children}</${tag}>`;
}

/**
 * The subtree, once — or once per record.
 *
 * A repeater's element is emitted a single time; it is the *children* that
 * repeat, so the grid stays a grid and only what is inside it multiplies. The
 * template is normally one child, and several repeat as a group.
 *
 * The published page is the whole of the feature: these are real elements in
 * the file, so the list is indexed, printed, and correct with scripting off.
 * Nothing here writes a script and nothing here writes a rule.
 */
function renderChildren(
  doc: Cre8Document,
  node: SceneNode,
  options: RenderNodeOptions,
  depth: number
): string {
  const inside = (record: CollectionRecord | null) =>
    node.children
      .map((childId) => renderNodeToHtml(doc, childId, { ...options, record, depth: depth + 1 }))
      .join('');

  if (!node.repeat) return inside(options.record ?? null);
  const pool = options.records?.[node.repeat.collection];
  const rows = repeatRows(node.repeat, pool, 'publish');

  // A paginated index is the same repeater rendered several times, each file
  // taking its own slice. The slice is decided in `routes.ts` — this only has
  // to know which node it applies to.
  const window = options.window;
  const mine = window && window.nodeId === node.id
    ? rows.slice(window.offset, window.offset + window.size)
    : rows;
  return mine.map(inside).join('');
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
function rewriteAssetUrls(html: string, from: string): string {
  const prefix = '../'.repeat(depthOf(from));
  return html.replace(ASSET_URL, (whole, encoded: string) => {
    const key = safeDecode(encoded);
    return key ? `${prefix}${ASSET_DIR}/${assetFileName(key)}` : whole;
  });
}

/**
 * Where a link written in the editor actually points, from this file.
 *
 * Three schemes, and the interesting one is the middle:
 *
 * `page:<id>` names a page. When that page is *dynamic* it names a template
 * rather than a file, and which of its files is meant is decided by the record
 * in scope — so a card inside a repeater links to that card's record. With no
 * record in scope there is genuinely nowhere to point, and `#` is the honest
 * answer rather than a guess at the first one.
 *
 * `series:prev` / `series:next` step through a paginated index. They resolve
 * to the empty string at the ends, which the link element reads as "no target"
 * and hides — a Next button on the last page is worse than no button.
 *
 * Anything else is a URL the designer typed, and is left alone.
 */
function hrefResolverFor(doc: Cre8Document, from: Output, all: Output[]) {
  const seriesAt = (delta: number): string => {
    if (from.of <= 1) return '';
    const wanted = from.number + delta;
    if (wanted < 1 || wanted > from.of) return '';
    const target = all.find((o) => o.page.id === from.page.id && o.number === wanted);
    return target ? relativePath(from.path, target.path) : '';
  };

  return (href: string, record: CollectionRecord | null): string => {
    if (!href) return '#';
    // A deferred template reference that never got resolved. Inert beats
    // shipping `page@pricing` as a literal href.
    if (href.startsWith('page@')) return '#';
    if (href === 'series:prev') return seriesAt(-1);
    if (href === 'series:next') return seriesAt(1);
    if (!href.startsWith('page:')) return href;

    const pageId = href.slice(5);
    const page = doc.pages.find((p) => p.id === pageId);
    if (!page) return '#';
    if (!page.dynamic) {
      const target = all.find((o) => o.page.id === pageId);
      return target ? relativePath(from.path, target.path) : '#';
    }
    if (!record) return '#';
    const target = all.find((o) => o.page.id === pageId && o.record?.id === record.id);
    return target ? relativePath(from.path, target.path) : '#';
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
  /**
   * Every collection's rows, keyed by collection id.
   *
   * Passed in rather than fetched here because this module has no network and
   * should not grow one: the browser publisher reads them through the API
   * client, and the Worker will read them straight out of D1. One renderer,
   * two callers, no `fetch` in the middle.
   */
  records?: RecordSet;
}

/** The path of the file this many steps along the same series. */
function seriesPath(all: Output[], from: Output, delta: number): string {
  const wanted = from.number + delta;
  return all.find((o) => o.page.id === from.page.id && o.number === wanted)?.path ?? from.path;
}

/**
 * One published file.
 *
 * Takes an `Output` rather than a `Page` because a page is no longer a file:
 * a dynamic page is thirty of them and a paginated index is three. Everything
 * that used to be read off the page — where it sits, what links to it resolve
 * against, which record is in scope — is read off the output instead, and
 * `routes.ts` is the only thing that decides any of it.
 */
export function renderPage(
  doc: Cre8Document,
  output: Output,
  options: RenderPageOptions = {},
  all: Output[] = [output]
): string {
  const page = output.page;
  const nodeIds = collectSubtree(doc.nodes, page.rootNodeId);
  nodeIds.push(...componentsUsedOn(doc, nodeIds));

  const dataSources = collectDataSources(doc.nodes, nodeIds);

  // Cut the node ids down before either the stylesheet or the markup is
  // assembled, so the two can only ever agree — one map, applied twice.
  const shortClasses = shortClassMap(nodeIds);

  const css = applyShortClasses(
    generateStylesheet(doc, {
      mode: 'media',
      nodeIds,
      themeVars: themeToCssVariables(doc.theme),
      rootSelector: ':root',
      includeStates: true,
      // This file *is* the document, so its body belongs to the page.
      standalone: true,
    }),
    shortClasses
  );

  const body = applyShortClasses(renderNodeToHtml(doc, page.rootNodeId, {
    hrefResolver: hrefResolverFor(doc, output, all),
    records: options.records,
    // A dynamic page's record is in scope before the tree is entered, so
    // `bind` on a detail page reads exactly as it does inside a repeater.
    record: output.record,
    window: output.window,
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
            `/${encodeURIComponent(formId)}?r=${encodeURIComponent(output.path)}`
        : undefined,
  }), shortClasses);
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

  /*
   * A paginated index is one document split across several files, and
   * `rel=prev`/`rel=next` is how you say so. Worth emitting even where a
   * designer has built no pager: it is what tells a crawler these are a
   * series rather than three pages that happen to look alike, and it costs
   * two tags on the two-in-a-hundred pages that have a series at all.
   */
  const series =
    output.of > 1
      ? [
          output.number > 1
            ? `<link rel="prev" href="${escapeAttr(
                relativePath(output.path, seriesPath(all, output, -1))
              )}">`
            : '',
          output.number < output.of
            ? `<link rel="next" href="${escapeAttr(
                relativePath(output.path, seriesPath(all, output, 1))
              )}">`
            : '',
        ].filter(Boolean)
      : [];

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
    ...series,
    fontLink,
    `<style>${options.pretty ? css : minifyCss(css)}</style>`,
    // Before the stylesheet would be pointless and after the body would be a
    // flash: a classic script here blocks parsing, so the attribute every data
    // condition keys on is correct before a single element of the body exists.
    dataSources.size ? `<script>${dataRuntimeSource()}</script>` : '',
    // Rewritten too: a designer who did reach for a generated class in here
    // should not be the one who finds out it changed.
    applyShortClasses(doc.settings.customHead ?? '', shortClasses),
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
  // The values the file ships with. A visitor sees them for the instant before
  // the resolver runs, and for ever if they have no scripting — so they are a
  // real design decision, made in the inspector, not a placeholder.
  const shipped = fallbackTokens(doc.settings, dataSources);
  const root = `<html lang="${lang}"${shipped ? ` ${DATA_ATTR}="${escapeAttr(shipped)}"` : ''}>`;

  const html = options.pretty
    ? `<!doctype html>
${root}
  <head>
    ${head}
  </head>
  <body>
    ${body}
    ${script}
  </body>
</html>
`
    : `<!doctype html>${root}<head>${head}</head><body>${body}${script}</body></html>`;

  return rewriteAssetUrls(html, output.path);
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
  /** What was generated and where, for anything that needs to say so. */
  outputs: Output[];
  totalBytes: number;
  /** Files of HTML, which is no longer the number of pages in the document. */
  pageCount: number;
}

export function generateSite(doc: Cre8Document, options: RenderPageOptions = {}): GeneratedSite {
  const outputs = plan(doc, options.records);
  const files: GeneratedFile[] = [];

  for (const output of outputs) {
    const contents = renderPage(doc, output, options, outputs);
    files.push({ path: output.file, contents, bytes: byteLength(contents) });
  }

  files.push(sitemap(outputs));
  files.push(robots(doc));

  return {
    files,
    outputs,
    assets: collectPublishedAssets(doc),
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    pageCount: outputs.length,
  };
}

/**
 * Every page that was generated, which is not the same as every page designed.
 *
 * It used to be built from `doc.pages`, and that stopped being the list of
 * pages that exist the moment one page could become thirty files. A sitemap
 * naming three URLs for a thirty-post blog is worse than none: it tells a
 * crawler it has seen everything.
 */
function sitemap(outputs: Output[]): GeneratedFile {
  const urls = outputs
    .filter((output) => !output.page.meta.noIndex)
    .map((output) => `  <url><loc>${escapeHtml(output.path)}</loc></url>`)
    .join('\n');
  const contents = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return { path: 'sitemap.xml', contents, bytes: byteLength(contents) };
}

function robots(doc: Cre8Document): GeneratedFile {
  const contents = `User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n`;
  void doc;
  return { path: 'robots.txt', contents, bytes: byteLength(contents) };
}

/**
 * The component masters this page actually puts on screen.
 *
 * An instance renders from its master's subtree, so those nodes need their
 * rules in this page's stylesheet even though they are not in the page's own
 * tree. What they do *not* need is every other component in the project: a
 * library with a dozen components used one page each was putting all twelve
 * into all twelve pages, and each page paid for eleven it never rendered.
 *
 * Transitive, because a master can contain an instance of another master, and
 * `seen` closes the loop a component that somehow contains itself would open.
 */
function componentsUsedOn(doc: Cre8Document, pageNodes: NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  const seen = new Set<string>();
  const queue = [...pageNodes];

  while (queue.length) {
    const node = doc.nodes[queue.pop()!];
    if (node?.type !== 'instance') continue;
    const componentId = String(node.props.componentId ?? '');
    if (!componentId || seen.has(componentId)) continue;
    seen.add(componentId);

    const component = doc.components.find((c) => c.id === componentId);
    if (!component) continue;
    const subtree = collectSubtree(doc.nodes, component.rootNodeId);
    out.push(...subtree);
    queue.push(...subtree);
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Shorter class names
 * ----------------------------------------------------------------------- */

/**
 * How much of a node id survives into a published class.
 *
 * Ids are ten characters of `[a-z0-9]` so that they never collide inside one
 * document. A single *page* holds a few hundred nodes, where four characters —
 * 1.7 million of them — is ample, and the six characters saved are paid twice:
 * once in the stylesheet and once on every element that carries the class.
 * They are also the highest-entropy bytes on the page, so unlike the rest of
 * the markup they barely compress. Cutting them is most of what the whole
 * exercise wins after gzip.
 */
const SHORT_ID = 4;

/**
 * Which ids can be cut, given everything else on this page.
 *
 * Deliberately *not* a rename to `a`, `b`, `c`, which would be shorter still.
 * Two reasons. The `c-` prefix is what guarantees a generated class can never
 * collide with something a designer wrote into `customHead`, and a bare `.a`
 * throws that away. And a sequential rename depends on the order nodes are
 * walked, which nothing outside the generator can reproduce — a prefix is a
 * property of the id alone, so the render suite can map a canvas class to its
 * published form without knowing anything about how the page was built.
 *
 * An id whose prefix is shared with another on the same page keeps its full
 * length. That costs a few bytes on the rare page where it happens and keeps
 * the rule to one sentence.
 */
function shortClassMap(nodeIds: Iterable<NodeId>): Map<string, string> {
  const unique = new Set(nodeIds);
  const heads = new Map<string, number>();
  for (const id of unique) {
    const head = id.slice(0, SHORT_ID);
    heads.set(head, (heads.get(head) ?? 0) + 1);
  }

  const map = new Map<string, string>();
  for (const id of unique) {
    const head = id.slice(0, SHORT_ID);
    if (id.length > SHORT_ID && heads.get(head) === 1) map.set(id, head);
  }
  return map;
}

/**
 * Applied to the stylesheet and the markup, never to prose.
 *
 * `title`, the meta description and the page's own text are assembled
 * separately and left alone: a class token is only ever written by the
 * generator, and rewriting arbitrary copy on the off-chance it contains one
 * would be trading a certainty for a coincidence.
 */
function applyShortClasses(text: string, map: Map<string, string>): string {
  if (!map.size) return text;
  return text.replace(/\bc-([a-z0-9]{5,})\b/g, (whole, id: string) => {
    const short = map.get(id);
    return short ? `c-${short}` : whole;
  });
}

export function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length;
}
