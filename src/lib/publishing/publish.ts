'use client';

/**
 * Publishing.
 *
 * Generate → store → serve. The stored artefact is finished HTML, so serving it
 * is a static read with no rendering on the request path. Swapping the storage
 * adapter for the Cloudflare one pushes the identical bytes to R2 and lets the
 * Worker in `workers/` stream them from cache — see docs/ARCHITECTURE.md.
 */

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
}

export async function publishProject(doc: Cre8Document): Promise<PublishResult> {
  const generated = generateSite(doc);

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
        html: renderPage(doc, page),
      })),
  };

  await getStorage().savePublished(doc.id, site);

  return {
    site,
    bytes: generated.totalBytes,
    pageCount: generated.pageCount,
    url: routes.publishedSite(doc.id),
  };
}

/** Download the whole static site as a ZIP, ready to drop on any host. */
export function exportProject(doc: Cre8Document): void {
  const generated = generateSite(doc, { pretty: true });
  const readme = `# ${doc.settings.siteName || doc.name}

Static site exported from Cre8.

Every page is plain HTML with inlined CSS and no JavaScript runtime, so this
directory can be served as-is from any static host or CDN:

  • Cloudflare Pages — \`npx wrangler pages deploy .\`
  • Netlify / Vercel — drag the folder onto the dashboard
  • S3 / R2 / nginx  — copy the files across

Pages
${doc.pages
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((p) => `  ${pagePath(p).padEnd(24)} ${p.name}`)
  .join('\n')}
`;

  const blob = createZip([
    ...generated.files.map((f) => ({ path: f.path, contents: f.contents })),
    { path: 'README.md', contents: readme },
  ]);

  downloadBlob(blob, `${slugify(doc.settings.siteName || doc.name) || 'cre8-site'}.zip`);
}
