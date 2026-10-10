import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { servicioPost } from "@/lib/datos/servicio";

export const POST = conUsuario(async (_req, u, ctx: RouteContext<"/api/datos/trabajos/[id]/cancelar">) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ErrorApi(404, "Ese proceso no existe o ya caducó.");
  const r = await servicioPost<{ ok: boolean }>(`/trabajos/${id}/cancelar`, u);
  return ok(r.datos, r.status);
});
