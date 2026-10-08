import { conUsuario, ok } from "@/lib/api";
import { obtener } from "@/lib/solicitudes/servicio";

export const GET = conUsuario<RouteContext<"/api/solicitudes/[id]">>(async (_req, u, ctx) => {
  const { id } = await ctx.params;
  return ok({ solicitud: await obtener(u, Number(id)) });
});
