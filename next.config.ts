import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Static export.
   *
   * Cre8 has no server-side logic: documents live in the browser (or behind the
   * Cloudflare Worker in `workers/`), and publishing produces finished HTML.
   * Exporting to plain files means the editor deploys to any CDN — Cloudflare
   * Pages included — with nothing to run and nothing to pay for per request.
   *
   * The one constraint this imposes: no route may take a path parameter that
   * can't be enumerated at build time, which is why project ids travel in the
   * query string. See `src/lib/routes.ts`.
   */
  output: 'export',

  // Images referenced by a project can point anywhere, so the renderer uses a
  // plain <img> rather than next/image. That also keeps editor, preview and
  // published output byte-identical.
  images: { unoptimized: true },

  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
