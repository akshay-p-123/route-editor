import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mapbox-gl uses browser APIs; mark it as external for SSR
  serverExternalPackages: ["mapbox-gl"],
};

export default nextConfig;
