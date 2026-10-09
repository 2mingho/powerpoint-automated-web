import type { NextConfig } from "next";
import { CABECERAS_SEGURIDAD } from "./src/lib/cabeceras";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: CABECERAS_SEGURIDAD }];
  },
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: { authInterrupts: true },
  allowedDevOrigins: ["127.0.0.1"],
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
