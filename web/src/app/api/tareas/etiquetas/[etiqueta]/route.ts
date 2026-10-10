import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { borrarEtiqueta, editarEtiqueta } from "@/lib/tareas/etiquetas";

type Ctx = RouteContext<"/api/tareas/etiquetas/[etiqueta]">;

export const PUT = conUsuario<Ctx>(async (req, u, ctx) =>
  ok({ etiqueta: await editarEtiqueta(u, idDeRuta((await ctx.params).etiqueta), await cuerpo(req)) }), { herramienta: "tasks" });

export const DELETE = conUsuario<Ctx>(async (_req, u, ctx) => {
  await borrarEtiqueta(u, idDeRuta((await ctx.params).etiqueta));
  return ok({ ok: true });
}, { herramienta: "tasks" });
