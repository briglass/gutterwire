/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server-only packages that break when bundled; load them via Node instead.
  serverExternalPackages: ['@extractus/article-extractor', 'rss-parser'],
};

export default nextConfig;
