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

export const routes = {
  dashboard: () => '/',

  editor: (projectId: string) => `/editor?p=${encodeURIComponent(projectId)}`,

  /** Local preview of published output. Real published sites are served by the Worker. */
  publishedSite: (projectId: string, slug = '') =>
    slug
      ? `/site?p=${encodeURIComponent(projectId)}&page=${encodeURIComponent(slug)}`
      : `/site?p=${encodeURIComponent(projectId)}`,
};
