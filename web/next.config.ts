import type { NextConfig } from "next";
import { CABECERAS_SEGURIDAD } from "./src/lib/cabeceras";

const nextConfig: NextConfig = {
  // Solo en la imagen de Docker (NEXT_OUTPUT=standalone): `next start` y el CI usan la salida normal.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [{ source: "/:path*", headers: CABECERAS_SEGURIDAD }];
  },
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    authInterrupts: true,
    // El proxy copia cada cuerpo en memoria y lo corta en silencio a este tope.
    // Las plantillas .pptx de /api/admin admiten 15 MB; /api/datos (hasta 200 MB)
    // queda fuera del matcher y va en streaming.
    proxyClientMaxBodySize: "16mb",
  },
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
