import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { anadirObservador } from "@/lib/tareas/detalle";

export const POST = conUsuario<RouteContext<"/api/tareas/[id]/observadores">>(async (req, u, ctx) => ok({ observador: await anadirObservador(u, idDeRuta((await ctx.params).id), await cuerpo(req)) }), { herramienta: "tasks" });
