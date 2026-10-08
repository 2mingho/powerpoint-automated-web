import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { servicioPost } from "@/lib/datos/servicio";

/* Retoques del analista. Solo el dueno (o admin): lo decide el servicio. */
export const POST = conUsuario(async (req, u, ctx: RouteContext<"/api/datos/reportes/[token]/textos">) => {
  const { token } = await ctx.params;
  const { textos } = await cuerpo(req);
  if (!textos || typeof textos !== "object" || Array.isArray(textos)) throw new ErrorApi(400, "Nada que guardar.");
  const r = await servicioPost<{ ok: boolean; guardados: number }>(`/reportes/${encodeURIComponent(token)}/textos`, u, { textos });
  return ok(r.datos);
}, { herramienta: "reports" });
