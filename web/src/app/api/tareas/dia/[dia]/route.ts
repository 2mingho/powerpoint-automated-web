import { conUsuario, ok } from "@/lib/api";
import { borrarDia } from "@/lib/tareas/mutaciones";

/* Borra todas las tareas que vencen ese dia (YYYY-MM-DD) dentro del ambito. Devuelve la marca para deshacerlo. */
export const DELETE = conUsuario<RouteContext<"/api/tareas/dia/[dia]">>(async (_req, u, ctx) => ok(await borrarDia(u, (await ctx.params).dia)), { herramienta: "tasks" });
