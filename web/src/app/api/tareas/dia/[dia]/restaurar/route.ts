import { conUsuario, cuerpo, ok } from "@/lib/api";
import { restaurarDia } from "@/lib/tareas/mutaciones";

/* "Deshacer" del borrado de un dia: { marca } es la que devolvio el borrado. */
export const POST = conUsuario<RouteContext<"/api/tareas/dia/[dia]/restaurar">>(async (req, u, ctx) => ok(await restaurarDia(u, (await ctx.params).dia, (await cuerpo(req)).marca)), { herramienta: "tasks" });
