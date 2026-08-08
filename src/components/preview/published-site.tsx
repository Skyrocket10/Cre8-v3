'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStorage, type PublishedSite } from '@/lib/api/storage';

/**
 * Mounts a published page.
 *
 * The stored HTML is a complete document, so it goes into an iframe rather than
 * being spliced into this one: it gets its own `<head>`, its own stylesheet and
 * no chance of the editor's CSS leaking into it. What you see here is byte-for-
 * byte what a static host would serve.
 */
export function PublishedSiteView({ projectId, slug }: { projectId: string; slug: string }) {
  const [site, setSite] = useState<PublishedSite | null | 'missing'>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getStorage().loadPublished(projectId);
        if (!cancelled) setSite(loaded ?? 'missing');
      } catch {
        if (!cancelled) setSite('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (site === null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white">
        <span className="anim-spin size-5 rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      </div>
    );
  }

  if (site === 'missing') {
    return <Notice title="Nothing published yet" body="Open this project and hit Publish." projectId={projectId} />;
  }

  const page = site.pages.find((p) => p.slug === slug) ?? (slug === '' ? site.pages[0] : undefined);

  if (!page) {
    return (
      <Notice
        title="Page not found"
        body={`This site has no page at /${slug}.`}
        projectId={projectId}
      />
    );
  }

  return (
    <iframe
      title={page.title}
      srcDoc={page.html}
      className="h-dvh w-full border-0 bg-white"
      // The published page is our own generated output, but sandboxing keeps
      // any pasted embed from reaching back into the editor origin.
      sandbox="allow-same-origin allow-popups allow-forms"
    />
  );
}

function Notice({
  title,
  body,
  projectId,
}: {
  title: string;
  body: string;
  projectId: string;
}) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-[var(--app)] px-6 text-center">
      <p className="text-[15px] font-medium text-[var(--text)]">{title}</p>
      <p className="max-w-[320px] text-[12.5px] leading-relaxed text-[var(--text-muted)]">{body}</p>
      <Link
        href={`/editor/${projectId}`}
        className="mt-1 rounded-md bg-[var(--field)] px-3 py-1.5 text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
      >
        Open in the editor
      </Link>
    </div>
  );
}
