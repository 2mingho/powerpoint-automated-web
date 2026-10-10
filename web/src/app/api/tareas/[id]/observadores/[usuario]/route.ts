import { conUsuario, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { quitarObservador } from "@/lib/tareas/detalle";

export const DELETE = conUsuario<RouteContext<"/api/tareas/[id]/observadores/[usuario]">>(async (_req, u, ctx) => {
  const { id, usuario } = await ctx.params;
  return ok(await quitarObservador(u, idDeRuta(id), idDeRuta(usuario)));
}, { herramienta: "tasks" });
