import { conUsuario, ErrorApi } from "@/lib/api";
import { servicioGet } from "@/lib/datos/servicio";
import type { Trabajo } from "@/lib/datos/tipos";

/*
 * Estado de un trabajo. Sin herramienta fija: un trabajo es de una de las
 * cuatro, y el servicio comprueba la de su tipo y que sea tuyo (si no, 404).
 */
export const GET = conUsuario(async (_req, u, ctx: RouteContext<"/api/datos/trabajos/[id]">) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ErrorApi(404, "Ese proceso no existe o ya caducó.");
  const t = await servicioGet<Trabajo>(`/trabajos/${id}`, u);
  return Response.json(t, { headers: { "Cache-Control": "no-store" } });
});
