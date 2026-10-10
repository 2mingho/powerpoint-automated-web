import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { anadirItem, listarChecklist } from "@/lib/tareas/detalle";

type Ctx = RouteContext<"/api/tareas/[id]/checklist">;

export const GET = conUsuario<Ctx>(async (_req, u, ctx) => ok({ items: await listarChecklist(u, idDeRuta((await ctx.params).id)) }), { herramienta: "tasks" });
export const POST = conUsuario<Ctx>(async (req, u, ctx) => ok({ item: await anadirItem(u, idDeRuta((await ctx.params).id), await cuerpo(req)) }, 201), { herramienta: "tasks" });
