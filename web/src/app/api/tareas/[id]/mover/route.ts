import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { moverTarea } from "@/lib/tareas/mutaciones";

/* Tablero: cambiar de columna (409 si la version no coincide) o de sitio (sin tocar updated_at). */
export const POST = conUsuario<RouteContext<"/api/tareas/[id]/mover">>(async (req, u, ctx) => ok(await moverTarea(u, idDeRuta((await ctx.params).id), await cuerpo(req))), { herramienta: "tasks" });
