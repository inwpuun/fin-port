import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // `pg` loads optional native/runtime pieces by dynamic require, which the
  // bundler cannot follow: bundling it yields "Cannot find module 'pg-cloudflare'"
  // at runtime. Leave it to Node, which also keeps it out of the client graph.
  serverExternalPackages: ["pg"],
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
