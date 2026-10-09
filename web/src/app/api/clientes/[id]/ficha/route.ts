import { conUsuario, ok } from "@/lib/api";
import { fichaDeCliente } from "@/lib/clientes/ficha";

/* Ficha flotante de un cliente, con las cifras de las tareas que quien pregunta puede ver. */
export const GET = conUsuario<RouteContext<"/api/clientes/[id]/ficha">>(async (_req, u, ctx) => {
  const { id } = await ctx.params;
  return ok(await fichaDeCliente(u, Number(id)));
}, { herramienta: "tasks" });
