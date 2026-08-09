'use client';

/**
 * Publishing.
 *
 * Generate → store → serve. The stored artefact is finished HTML, so serving it
 * is a static read with no rendering on the request path.
 *
 * **Where the generating happens depends on whether there is a Worker.** With
 * one, publishing is a single request: the Worker reads the live document and
 * the rows from D1, runs the same generator this file used to run, and writes
 * the result to R2. Nothing the browser sends decides what a published page
 * contains, no collection crosses the wire to be rendered and thrown away, and
 * a republish needs no browser at all — which is what D6 is built on.
 *
 * With no backend there is nowhere to move to, so the browser still generates.
 * That path and the ZIP export below are two callers of `generateSite` that
 * keep the shared module honest, and the render suite holds them to producing
 * the same bytes as the Worker.
 */

import { apiOrigin } from '../api/client';
import { getStorage, type PublishedSite } from '../api/storage';
import { slugify } from '../document/id';
import { collectionsUsedBy, type RecordSet } from '../renderer/repeat';
import { routes } from '../routes';
import type { Cre8Document } from '../document/types';
import { generateSite } from './html';
import { createZip, downloadBlob } from './zip';

/**
 * What a publish reports back.
 *
 * A summary rather than the site: on the hosted path the browser never had the
 * HTML, and a field carrying an empty string where the markup used to be would
 * be a worse lie than not having the field.
 */
export interface PublishResult {
  projectId: string;
  publishedAt: number;
  bytes: number;
  pageCount: number;
  /** Enough to list and link every page. */
  pages: { slug: string; title: string }[];
  /** Where the published home page can be viewed. */
  url: string;
  /** Present when the deployment gives published sites their own domain. */
  subdomain?: string;
  siteDomain?: string;
  /** Present when the host only wrote what had changed. See `PublishedSummary`. */
  changed?: { written: number; removed: number; unchanged: number };
}

export async function publishProject(doc: Cre8Document): Promise<PublishResult> {
  const adapter = getStorage();

  if (adapter.publishSite) {
    const published = await adapter.publishSite(doc.id);
    return {
      projectId: doc.id,
      publishedAt: published.publishedAt,
      bytes: published.bytes,
      pageCount: published.pageCount,
      pages: published.pages,
      // The host is the authority on where a site lives — it may have given
      // the project a domain of its own.
      url: published.url || routes.publishedSite(doc.id),
      ...(published.subdomain ? { subdomain: published.subdomain } : {}),
      ...(published.siteDomain ? { siteDomain: published.siteDomain } : {}),
      ...(published.changed ? { changed: published.changed } : {}),
    };
  }

  /* --- No backend: generate here, because there is nowhere else ---------- */

  // Forms post to the API, not to the site's own Worker — that one has no
  // database and would answer 404. Null here, since there is no API at all.
  const formTarget = {
    apiOrigin: apiOrigin() ?? undefined,
    projectId: doc.id,
    records: await loadRecords(doc),
  };
  const generated = generateSite(doc, formTarget);
  const publishedAt = Date.now();

  const site: PublishedSite = {
    projectId: doc.id,
    projectName: doc.settings.siteName || doc.name,
    publishedAt,
    bytes: generated.totalBytes,
    // Read back off what was generated rather than rendered a second time.
    // One page is no longer one file — a dynamic route is thirty of them — so
    // rebuilding this list from `doc.pages` would leave the local preview
    // route showing three pages of a thirty-three page site.
    pages: generated.outputs.map((output) => ({
      slug: output.path === '/' ? '' : output.path.replace(/^\/|\/$/g, ''),
      title: output.page.meta.title || output.page.name,
      html: generated.files.find((f) => f.path === output.file)?.contents ?? '',
    })),
  };

  const info = await adapter.savePublished(
    doc.id,
    site,
    generated.files.map((f) => ({ path: f.path, contents: f.contents })),
    generated.assets
  );

  return {
    projectId: doc.id,
    publishedAt,
    bytes: generated.totalBytes,
    pageCount: generated.pageCount,
    pages: site.pages.map(({ slug, title }) => ({ slug, title })),
    url: info?.url ?? routes.publishedSite(doc.id),
    ...(info?.subdomain ? { subdomain: info.subdomain } : {}),
    ...(info?.siteDomain ? { siteDomain: info.siteDomain } : {}),
  };
}

/**
 * Every collection the document repeats over, read once before generating.
 *
 * Read here rather than inside the renderer because the renderer has no
 * network and should not grow one — it is the same framework-free module that
 * has to run in a Worker, where these come straight out of D1. One
 * implementation, two callers, no `fetch` in the middle.
 *
 * **This is the constraint D3 exists to remove.** Publishing runs in the
 * browser today, so a publish downloads the collections first: fine for a blog
 * of fifty posts, five megabytes for five thousand products, and impossible
 * for republish-on-change because nothing on the server can render. Moving the
 * publisher into the Worker turns this function into a D1 query.
 */
async function loadRecords(doc: Cre8Document): Promise<RecordSet> {
  const adapter = getStorage();
  const collections = collectionsUsedBy(doc.nodes, Object.keys(doc.nodes));
  if (!adapter.listRecords || !collections.length) return {};

  const loaded = await Promise.all(
    collections.map(async (collectionId) => {
      try {
        return [collectionId, await adapter.listRecords!(doc.id, collectionId)] as const;
      } catch {
        // A collection that will not load publishes as an empty list rather
        // than failing the whole site. The alternative is a designer unable to
        // publish a typo fix because one repeater points at a collection that
        // has been deleted.
        return [collectionId, []] as const;
      }
    })
  );
  return Object.fromEntries(loaded);
}

export interface ExportResult {
  /** Assets that could not be read, so the archive is short of them. */
  missing: string[];
}

/**
 * Download the whole static site as a ZIP, ready to drop on any host.
 *
 * Uploaded images have to be fetched: the document holds a URL, not bytes, so
 * an archive built from the document alone would reference `_assets/` files it
 * does not carry. That fetch is why this is async and why the button waits.
 *
 * Locally there is nothing to fetch — images are inlined in the document as
 * data URLs and travel inside the HTML.
 */
export async function exportProject(doc: Cre8Document): Promise<ExportResult> {
  const generated = generateSite(doc, {
    pretty: true,
    apiOrigin: apiOrigin() ?? undefined,
    projectId: doc.id,
    // A ZIP that dropped the bound rows would be a different site from the one
    // that was published, which is exactly what an export must not be.
    records: await loadRecords(doc),
  });

  const missing: string[] = [];
  const assetEntries = await Promise.all(
    generated.assets.map(async (asset) => {
      try {
        const response = await fetch(asset.url, { credentials: 'include' });
        if (!response.ok) throw new Error(String(response.status));
        return { path: asset.path, contents: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        // One unreadable image should not cost you the export; say which.
        missing.push(asset.path);
        return null;
      }
    })
  );
  const readme = `# ${doc.settings.siteName || doc.name}

Static site exported from Cre8.

Every page is plain HTML with inlined CSS and no JavaScript runtime, so this
directory can be served as-is from any static host or CDN:

  • Cloudflare Pages — \`npx wrangler pages deploy .\`
  • Netlify / Vercel — drag the folder onto the dashboard
  • S3 / R2 / nginx  — copy the files across

${generated.assets.length ? `Images are in ${'_assets'}/ and referenced relatively, so this folder\nworks opened straight from disk as well as served.\n\n` : ''}Pages
${generated.outputs.map((o) => `  ${o.path.padEnd(32)} ${o.page.name}`).join('\n')}
`;

  const blob = createZip([
    ...generated.files.map((f) => ({ path: f.path, contents: f.contents })),
    ...assetEntries.filter((entry) => entry !== null),
    { path: 'README.md', contents: readme },
  ]);

  downloadBlob(blob, `${slugify(doc.settings.siteName || doc.name) || 'cre8-site'}.zip`);
  return { missing };
}
