import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { comentar, listarComentarios } from "@/lib/tareas/detalle";

type Ctx = RouteContext<"/api/tareas/[id]/comentarios">;

export const GET = conUsuario<Ctx>(async (_req, u, ctx) => ok({ comentarios: await listarComentarios(u, idDeRuta((await ctx.params).id)) }), { herramienta: "tasks" });
export const POST = conUsuario<Ctx>(async (req, u, ctx) => ok({ comentario: await comentar(u, idDeRuta((await ctx.params).id), await cuerpo(req)) }, 201), { herramienta: "tasks" });
