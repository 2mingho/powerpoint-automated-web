import { conUsuario, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { actividadTarea } from "@/lib/tareas/detalle";

export const GET = conUsuario<RouteContext<"/api/tareas/[id]/actividad">>(async (_req, u, ctx) => ok({ actividad: await actividadTarea(u, idDeRuta((await ctx.params).id)) }), { herramienta: "tasks" });
