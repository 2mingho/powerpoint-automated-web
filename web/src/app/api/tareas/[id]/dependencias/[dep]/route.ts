import { conUsuario, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { borrarDependencia } from "@/lib/tareas/dependencias";

export const DELETE = conUsuario<RouteContext<"/api/tareas/[id]/dependencias/[dep]">>(async (_req, u, ctx) => {
  const { id, dep } = await ctx.params;
  await borrarDependencia(u, idDeRuta(id), idDeRuta(dep));
  return ok({ ok: true });
}, { herramienta: "tasks" });
