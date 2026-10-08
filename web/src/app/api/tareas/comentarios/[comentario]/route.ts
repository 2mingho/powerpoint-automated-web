import { conUsuario, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/tareas/base";
import { borrarComentario } from "@/lib/tareas/detalle";

export const DELETE = conUsuario<RouteContext<"/api/tareas/comentarios/[comentario]">>(async (_req, u, ctx) => {
  await borrarComentario(u, idDeRuta((await ctx.params).comentario));
  return ok({ ok: true });
}, { herramienta: "tasks" });
