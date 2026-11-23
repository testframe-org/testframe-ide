import path from 'node:path';
import type { NextConfig } from 'next';

// The jsonassert engine (validation of jsonassert card code) and the tour UI (the test-tour screens
// at /tour) are imported from their TypeScript sources in the sibling folders modules/jsonassert
// and modules/testframe-tour-ui (tsconfig "paths"), so the bundler root is the monorepo root.
const monorepoRoot = path.resolve(import.meta.dirname, '../..');

// A sibling package resolves its own dependencies from its own node_modules. React has to be one
// copy for the whole page, so every react/react-dom request is pinned to this app's copy
// (tsconfig.json "paths" does the same for the types).
const ownReact = {
  react: path.join(import.meta.dirname, 'node_modules/react'),
  'react-dom': path.join(import.meta.dirname, 'node_modules/react-dom')
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: monorepoRoot, resolveAlias: ownReact },
  outputFileTracingRoot: monorepoRoot,
  webpack: (config) => ({ ...config, resolve: { ...config.resolve, alias: { ...config.resolve?.alias, ...ownReact } } }),
  // `bun run typecheck` (tsc --noEmit) is the type gate
  typescript: { ignoreBuildErrors: false }
};

export default nextConfig;
