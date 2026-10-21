import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // PGlite ships a WASM binary and touches the filesystem; keep it (and the pg driver) out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
