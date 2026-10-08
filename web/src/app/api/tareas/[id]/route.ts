import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { detalleTarea } from "@/lib/tareas/detalle";
import { actualizarTarea, borrarTarea } from "@/lib/tareas/mutaciones";

type Ctx = RouteContext<"/api/tareas/[id]">;

export const GET = conUsuario<Ctx>(async (_req, u, ctx) => ok({ tarea: await detalleTarea(u, idDeRuta((await ctx.params).id)) }), { herramienta: "tasks" });

export const PUT = conUsuario<Ctx>(async (req, u, ctx) =>
  ok({ tarea: await actualizarTarea(u, idDeRuta((await ctx.params).id), await cuerpo(req)) }), { herramienta: "tasks" });

export const DELETE = conUsuario<Ctx>(async (req, u, ctx) => {
  const serie = new URL(req.url).searchParams.get("serie") === "true";
  return ok({ borradas: await borrarTarea(u, idDeRuta((await ctx.params).id), serie) });
}, { herramienta: "tasks" });
