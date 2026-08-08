/**
 * URL construction.
 *
 * Cre8 ships as a fully static export — there is no server-side logic in the
 * app at all, so every route has to be a file a CDN can hand back unchanged.
 * That rules out `/editor/[projectId]`, whose parameter can't be enumerated at
 * build time, so the project id travels in the query string instead.
 *
 * Centralised here so a future move to a hosted, per-project-path deployment
 * is one file rather than a hunt through components.
 */

import { hasBackend } from './api/client';

export const routes = {
  dashboard: () => '/',

  editor: (projectId: string) => `/editor?p=${encodeURIComponent(projectId)}`,

  /**
   * Where a published site actually lives.
   *
   * With the Worker deployed this is the real thing, served from R2 on this
   * same origin — so the link in the publish dialog is the link you can send
   * someone. With no backend there is nowhere to publish *to*, so it falls back
   * to the in-browser preview that renders from IndexedDB.
   */
  publishedSite: (projectId: string, slug = '') => {
    if (hasBackend()) {
      const base = `/s/${encodeURIComponent(projectId)}/`;
      return slug ? `${base}${slug.split('/').map(encodeURIComponent).join('/')}` : base;
    }
    return slug
      ? `/site?p=${encodeURIComponent(projectId)}&page=${encodeURIComponent(slug)}`
      : `/site?p=${encodeURIComponent(projectId)}`;
  },
};
