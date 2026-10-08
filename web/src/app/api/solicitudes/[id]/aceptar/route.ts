import { conUsuario, cuerpo, ok } from "@/lib/api";
import { aceptar } from "@/lib/solicitudes/servicio";

export const POST = conUsuario<RouteContext<"/api/solicitudes/[id]/aceptar">>(async (req, u, ctx) => {
  const { id } = await ctx.params;
  const c = await cuerpo(req);
  return ok(await aceptar(u, Number(id), { responsableId: c.responsableId, entrega: c.entrega }));
}, { herramienta: "tasks" });
