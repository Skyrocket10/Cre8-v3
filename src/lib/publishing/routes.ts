/**
 * What a site publishes, decided once.
 *
 * Until D4 the answer was "one file per page", and `doc.pages` was the whole
 * of it. Two things broke that: a dynamic page is a *template* that becomes
 * one file per record, and a paginated index is one page that becomes several.
 * Neither is expressible as a list of pages, so the list of pages stops being
 * the list of files.
 *
 * Everything downstream reads this instead — the generator, the sitemap, the
 * link resolver, the publish route's page count. One function decides, so
 * there is no second opinion about what exists at what URL, which is the kind
 * of disagreement that shows up as a link into a 404 six months later.
 *
 * Framework-free like the rest of `publishing/`, so it runs in the Worker.
 */

import { LIMITS } from '../document/types';
import type { CollectionRecord, Cre8Document, NodeId, Page } from '../document/types';
import { collectSubtree } from '../document/tree';
import { recordsFor, type RecordSet } from '../renderer/repeat';

/** One published file, and everything the renderer needs to produce it. */
export interface Output {
  page: Page;
  /** The record in scope for the whole tree. Null unless the page is dynamic. */
  record: CollectionRecord | null;
  /**
   * Which repeater this file is a slice of, and which slice.
   *
   * Absent on every file but a paginated index's.
   */
  window: PageWindow | null;
  /** 1-based position in a paginated series; 1 when there is no series. */
  number: number;
  /** How many files the series has; 1 when there is no series. */
  of: number;
  /** Site-relative and directory-style: `/`, `/blog/`, `/blog/2/`, `/blog/hello/`. */
  path: string;
  /** Where the bytes go inside the site: `index.html`, `blog/hello/index.html`. */
  file: string;
}

export interface PageWindow {
  /** The repeating node whose rows this file shows a slice of. */
  nodeId: NodeId;
  /** Index of the first row on this file. */
  offset: number;
  /** How many rows it shows. */
  size: number;
}

/** Raised where it can be shown to the person who caused it, not logged. */
export class RouteError extends Error {}

/**
 * A page's own path, ignoring records and pagination.
 *
 * Still the right answer for an ordinary page, and the *directory* a dynamic
 * page's records live in. The trailing slash is load-bearing rather than
 * cosmetic: `/plans` and `/plans/` resolve relative links to different places,
 * and every internal link is relative.
 */
export function pagePath(page: Page): string {
  return page.isHome || page.slug === '' ? '/' : `/${page.slug}/`;
}

/** How many directory levels down from the site root a published path sits. */
export function depthOf(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/**
 * A link from one published file to another, relative to where it sits.
 *
 * Published files are the same bytes wherever they end up: the root of a
 * domain, `/s/<projectId>/` on the editor's origin, or a folder on someone's
 * desktop after unzipping. A root-absolute `/blog/` works only in the first of
 * those; everywhere else it escapes the site.
 *
 * Computed from the *output* path rather than the page slug, because a record
 * page sits a level deeper than the page that generated it and would otherwise
 * climb one directory too few.
 */
export function relativePath(from: string, to: string): string {
  const up = '../'.repeat(depthOf(from));
  const target = to === '/' ? '' : to.replace(/^\//, '');
  return up + target || './';
}

/**
 * Every file the site will contain, in the order pages are ordered.
 *
 * Deterministic: the same document and the same records give the same list, in
 * the same order, which is what lets the Worker and the browser be held to
 * byte-identical output and what will let D6 tell a real change from a
 * re-render.
 */
export function plan(doc: Cre8Document, records: RecordSet | undefined): Output[] {
  const out: Output[] = [];
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);

  for (const page of pages) {
    if (page.dynamic) out.push(...routeOf(page, page.dynamic.collection, records));
    else out.push(...seriesOf(doc, page, records));
  }

  const seen = new Map<string, string>();
  for (const output of out) {
    const clash = seen.get(output.file);
    if (clash) {
      // Two files at one key means one of them is not on the site, and which
      // one depends on the order R2 happened to accept the writes. A record
      // slugged `2` beside a paginated index is the way this actually happens.
      throw new RouteError(
        `Two pages both publish to /${output.file} — “${clash}” and “${output.page.name}”`
      );
    }
    seen.set(output.file, output.page.name);
  }
  return out;
}

/** One file per record: the dynamic route. */
function routeOf(
  page: Page,
  collection: string,
  records: RecordSet | undefined
): Output[] {
  // No filter and no sort: a route is every published record, in the order the
  // collection is in. Narrowing which records get a *page* is a different
  // decision from narrowing which appear in a list, and the collection is the
  // place to make it.
  // Not the repeater ceiling. A repeater stops at five hundred because a page
  // holding more is unusable; a route stops at a thousand because a publish
  // writing more is unmanageable. Passing the repeater's here would have
  // silently capped a blog at five hundred posts and told nobody.
  const rows = recordsFor({ collection }, records?.[collection], Number.POSITIVE_INFINITY);
  if (rows.length > LIMITS.pagesPerRoute) {
    throw new RouteError(
      `“${page.name}” has more than ${LIMITS.pagesPerRoute} records, ` +
        `and one route publishes at most ${LIMITS.pagesPerRoute} pages`
    );
  }

  const prefix = pagePath(page);
  return rows.map((record) => {
    // A record with no slug still needs a URL, and its id is one. Ugly beats
    // absent: the alternative is a record that silently has no page.
    const name = record.slug || record.id;
    const path = `${prefix}${name}/`;
    return {
      page,
      record,
      window: null,
      number: 1,
      of: 1,
      path,
      file: `${path.slice(1)}index.html`,
    };
  });
}

/** One file, or one per slice when the page paginates. */
function seriesOf(doc: Cre8Document, page: Page, records: RecordSet | undefined): Output[] {
  const base = pagePath(page);
  const single: Output = {
    page,
    record: null,
    window: null,
    number: 1,
    of: 1,
    path: base,
    file: base === '/' ? 'index.html' : `${base.slice(1)}index.html`,
  };

  const pager = paginatorOn(doc, page);
  if (!pager) return [single];

  const rows = recordsFor(pager.repeat, records?.[pager.repeat.collection]);
  const size = pager.size;
  const of = Math.max(1, Math.ceil(rows.length / size));
  if (of > LIMITS.pagesPerRoute) {
    throw new RouteError(
      `“${page.name}” would publish ${of} pages, over the limit of ${LIMITS.pagesPerRoute}`
    );
  }

  return Array.from({ length: of }, (_, i) => {
    // Page one keeps the page's own address. Nobody wants `/blog/1/`, and a
    // second URL for the same content is a canonical problem nobody asked for.
    const path = i === 0 ? base : `${base}${i + 1}/`;
    return {
      page,
      record: null,
      window: { nodeId: pager.nodeId, offset: i * size, size },
      number: i + 1,
      of,
      path,
      file: path === '/' ? 'index.html' : `${path.slice(1)}index.html`,
    };
  });
}

/** The first repeater on the page that asks to paginate, if any. */
function paginatorOn(doc: Cre8Document, page: Page) {
  for (const id of collectSubtree(doc.nodes, page.rootNodeId)) {
    const node = doc.nodes[id];
    const size = node?.repeat?.paginate;
    if (node?.repeat && typeof size === 'number' && size > 0) {
      return { nodeId: id, repeat: node.repeat, size: Math.floor(size) };
    }
  }
  return null;
}
