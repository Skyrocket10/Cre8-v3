import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The editor stores documents client-side by default; images referenced by a
  // project can point anywhere, so the renderer uses plain <img> rather than
  // next/image. That also keeps editor / preview / published output identical.
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
