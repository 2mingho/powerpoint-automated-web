import { conUsuario, ok } from "@/lib/api";
import { servicioPost } from "@/lib/datos/servicio";

/* Textos del modelo para un reporte guardado: 202 con trabajo, o 200 si ya estaban. */
export const POST = conUsuario(async (_req, u, ctx: RouteContext<"/api/datos/reportes/[token]/insights">) => {
  const { token } = await ctx.params;
  const r = await servicioPost<unknown>(`/reportes/${encodeURIComponent(token)}/insights`, u);
  return ok(r.datos, r.status);
}, { herramienta: "reports" });
