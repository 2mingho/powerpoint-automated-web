import { conUsuario, ok } from "@/lib/api";
import { asignables } from "@/lib/solicitudes/servicio";

/* Solo gente activa de la unidad destino: es a la unica que se le puede asignar la tarea. */
export const GET = conUsuario<RouteContext<"/api/solicitudes/[id]/asignables">>(async (_req, u, ctx) => {
  const { id } = await ctx.params;
  return ok(await asignables(u, Number(id)));
}, { herramienta: "tasks" });
