import { conUsuario, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { buscarRelacionables } from "@/lib/tareas/dependencias";

export const GET = conUsuario<RouteContext<"/api/tareas/[id]/relacionables">>(async (req, u, ctx) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  return ok({ tareas: await buscarRelacionables(u, idDeRuta((await ctx.params).id), q) });
}, { herramienta: "tasks" });
