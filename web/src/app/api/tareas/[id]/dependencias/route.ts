import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { crearDependencia, dependencias } from "@/lib/tareas/dependencias";

type Ctx = RouteContext<"/api/tareas/[id]/dependencias">;

export const GET = conUsuario<Ctx>(async (_req, u, ctx) => ok(await dependencias(u, idDeRuta((await ctx.params).id))), { herramienta: "tasks" });
export const POST = conUsuario<Ctx>(async (req, u, ctx) =>
  ok({ dependenciaId: await crearDependencia(u, idDeRuta((await ctx.params).id), await cuerpo(req)) }, 201), { herramienta: "tasks" });
