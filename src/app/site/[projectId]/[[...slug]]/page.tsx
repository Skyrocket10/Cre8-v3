import { PublishedSiteView } from '@/components/preview/published-site';

/**
 * Serves a published site.
 *
 * The published artefact is finished HTML produced at publish time, so this
 * route only reads and mounts it — nothing is rendered from the document here.
 * When the Cloudflare adapter is in use, this same path is served straight from
 * R2 through the Worker with no origin render at all.
 */
export default async function PublishedPage({
  params,
}: {
  params: Promise<{ projectId: string; slug?: string[] }>;
}) {
  const { projectId, slug } = await params;
  return <PublishedSiteView projectId={projectId} slug={(slug ?? []).join('/')} />;
}
