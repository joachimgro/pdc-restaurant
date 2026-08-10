import type { NextConfig } from "next";
import path from "path";

const noStore = [
  {
    key: "Cache-Control",
    value: "private, no-cache, no-store, max-age=0, must-revalidate",
  },
  { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
  { key: "CDN-Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@lead-intake/shared-types"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    return [
      { source: "/login", headers: noStore },
      { source: "/inbox", headers: noStore },
      { source: "/", headers: noStore },
      { source: "/api/pdc/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
