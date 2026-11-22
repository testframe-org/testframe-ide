import path from 'node:path';
import type { NextConfig } from 'next';

// The jsonassert engine (validation of jsonassert card code) is imported from its TypeScript
// sources in the sibling submodule modules/jsonassert (tsconfig "paths"), so the bundler root is
// the monorepo root.
const monorepoRoot = path.resolve(import.meta.dirname, '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  // `bun run typecheck` (tsc --noEmit) is the type gate
  typescript: { ignoreBuildErrors: false }
};

export default nextConfig;
