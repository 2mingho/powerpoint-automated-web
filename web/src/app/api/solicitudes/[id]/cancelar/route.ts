import { conUsuario, ok } from "@/lib/api";
import { cancelar } from "@/lib/solicitudes/servicio";

export const POST = conUsuario<RouteContext<"/api/solicitudes/[id]/cancelar">>(async (_req, u, ctx) => {
  const { id } = await ctx.params;
  return ok({ solicitud: await cancelar(u, Number(id)) });
}, { herramienta: "tasks" });
