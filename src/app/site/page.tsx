'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PublishedSiteView } from '@/components/preview/published-site';

/**
 * Local preview of a published site.
 *
 * The published artefact is finished HTML produced at publish time, so this
 * route only reads and mounts it — nothing is rendered from the document here.
 * In a Cloudflare deployment the equivalent path is served straight from R2 by
 * the Worker, with no origin render at all.
 */
export default function PublishedRoute() {
  return (
    <Suspense fallback={<div className="h-dvh bg-white" />}>
      <PublishedRouteInner />
    </Suspense>
  );
}

function PublishedRouteInner() {
  const params = useSearchParams();
  return <PublishedSiteView projectId={params.get('p') ?? ''} slug={params.get('page') ?? ''} />;
}
