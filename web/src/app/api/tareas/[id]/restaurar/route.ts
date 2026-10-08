import { conUsuario, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { restaurarTarea } from "@/lib/tareas/mutaciones";

/* "Deshacer" de un borrado: solo lo que borro esta misma persona. */
export const POST = conUsuario<RouteContext<"/api/tareas/[id]/restaurar">>(async (_req, u, ctx) => ok({ restauradas: await restaurarTarea(u, idDeRuta((await ctx.params).id)) }), { herramienta: "tasks" });
