'use client';

/**
 * Publishing.
 *
 * Generate → store → serve. The stored artefact is finished HTML, so serving it
 * is a static read with no rendering on the request path. Swapping the storage
 * adapter for the Cloudflare one pushes the identical bytes to R2 and lets the
 * Worker in `workers/` stream them from cache — see docs/ARCHITECTURE.md.
 */

import { apiOrigin } from '../api/client';
import { getStorage, type PublishedSite } from '../api/storage';
import { slugify } from '../document/id';
import { routes } from '../routes';
import type { Cre8Document } from '../document/types';
import { generateSite, pagePath, renderPage } from './html';
import { createZip, downloadBlob } from './zip';

export interface PublishResult {
  site: PublishedSite;
  bytes: number;
  pageCount: number;
  /** Where the published home page can be viewed. */
  url: string;
  /** Present when the deployment gives published sites their own domain. */
  subdomain?: string;
  siteDomain?: string;
}

export async function publishProject(doc: Cre8Document): Promise<PublishResult> {
  // Forms post to the API, not to the site's own Worker — that one has no
  // database and would answer 404.
  const formTarget = { apiOrigin: apiOrigin() ?? undefined, projectId: doc.id };
  const generated = generateSite(doc, formTarget);

  const site: PublishedSite = {
    projectId: doc.id,
    projectName: doc.settings.siteName || doc.name,
    publishedAt: Date.now(),
    bytes: generated.totalBytes,
    pages: [...doc.pages]
      .sort((a, b) => a.order - b.order)
      .map((page) => ({
        slug: page.isHome ? '' : page.slug,
        title: page.meta.title || page.name,
        html: renderPage(doc, page, formTarget),
      })),
  };

  const info = await getStorage().savePublished(
    doc.id,
    site,
    generated.files.map((f) => ({ path: f.path, contents: f.contents })),
    generated.assets
  );

  return {
    site,
    bytes: generated.totalBytes,
    pageCount: generated.pageCount,
    // The host is the authority on where a site lives — it may have given the
    // project a domain of its own. Only fall back to a local route if not.
    url: info?.url ?? routes.publishedSite(doc.id),
    ...(info?.subdomain ? { subdomain: info.subdomain } : {}),
    ...(info?.siteDomain ? { siteDomain: info.siteDomain } : {}),
  };
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
${doc.pages
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((p) => `  ${pagePath(p).padEnd(24)} ${p.name}`)
  .join('\n')}
`;

  const blob = createZip([
    ...generated.files.map((f) => ({ path: f.path, contents: f.contents })),
    ...assetEntries.filter((entry) => entry !== null),
    { path: 'README.md', contents: readme },
  ]);

  downloadBlob(blob, `${slugify(doc.settings.siteName || doc.name) || 'cre8-site'}.zip`);
  return { missing };
}
