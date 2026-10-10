import { conUsuario, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { candidatosObservar } from "@/lib/tareas/detalle";

export const GET = conUsuario<RouteContext<"/api/tareas/[id]/observadores/candidatos">>(async (_req, u, ctx) => ok({ personas: await candidatosObservar(u, idDeRuta((await ctx.params).id)) }), { herramienta: "tasks" });
