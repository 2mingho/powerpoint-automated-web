import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { usarPlantilla } from "@/lib/tareas/plantillas";

export const POST = conUsuario<RouteContext<"/api/tareas/plantillas/[plantilla]/usar">>(async (req, u, ctx) =>
  ok({ tarea: await usarPlantilla(u, idDeRuta((await ctx.params).plantilla), await cuerpo(req)) }, 201), { herramienta: "tasks" });
