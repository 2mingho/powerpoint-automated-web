import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { borrarItem, cambiarItem } from "@/lib/tareas/detalle";

type Ctx = RouteContext<"/api/tareas/[id]/checklist/[item]">;

export const PUT = conUsuario<Ctx>(async (req, u, ctx) => {
  const { id, item } = await ctx.params;
  return ok({ item: await cambiarItem(u, idDeRuta(id), idDeRuta(item), await cuerpo(req)) });
}, { herramienta: "tasks" });

export const DELETE = conUsuario<Ctx>(async (_req, u, ctx) => {
  const { id, item } = await ctx.params;
  await borrarItem(u, idDeRuta(id), idDeRuta(item));
  return ok({ ok: true });
}, { herramienta: "tasks" });
