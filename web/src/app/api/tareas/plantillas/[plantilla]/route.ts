import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { borrarPlantilla, editarPlantilla } from "@/lib/tareas/plantillas";

type Ctx = RouteContext<"/api/tareas/plantillas/[plantilla]">;

export const PUT = conUsuario<Ctx>(async (req, u, ctx) =>
  ok({ plantilla: await editarPlantilla(u, idDeRuta((await ctx.params).plantilla), await cuerpo(req)) }), { herramienta: "tasks" });

export const DELETE = conUsuario<Ctx>(async (_req, u, ctx) => {
  await borrarPlantilla(u, idDeRuta((await ctx.params).plantilla));
  return ok({ ok: true });
}, { herramienta: "tasks" });
