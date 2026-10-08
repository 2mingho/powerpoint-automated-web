import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { fijarEtiquetas } from "@/lib/tareas/etiquetas";

/* Fija las etiquetas visibles; las de otra unidad se conservan. */
export const PUT = conUsuario<RouteContext<"/api/tareas/[id]/etiquetas">>(async (req, u, ctx) => ok({ etiquetas: await fijarEtiquetas(u, idDeRuta((await ctx.params).id), await cuerpo(req)) }), { herramienta: "tasks" });
