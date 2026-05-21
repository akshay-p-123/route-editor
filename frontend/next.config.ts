import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["maplibre-gl"],
  output: "standalone",
  async rewrites() {
    // BACKEND_URL is server-side only — never exposed to the browser.
    // The browser always calls the Next.js server (same origin).
    // Next.js forwards /api/* to the backend server-side.
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
