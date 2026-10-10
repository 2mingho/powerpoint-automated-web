import { conUsuario, ok } from "@/lib/api";
import { servicioGet } from "@/lib/datos/servicio";
import type { DetalleReporte } from "@/lib/datos/tipos";

export const GET = conUsuario(async (_req, u, ctx: RouteContext<"/api/datos/reportes/[token]">) => {
  const { token } = await ctx.params;
  return ok(await servicioGet<DetalleReporte>(`/reportes/${encodeURIComponent(token)}`, u));
}, { herramienta: "reports" });
