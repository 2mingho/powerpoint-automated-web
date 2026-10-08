import { conUsuario, ok } from "@/lib/api";
import { marcarLeida } from "@/lib/campana/consultas";

export const POST = conUsuario<RouteContext<"/api/notificaciones/[id]/leida">>(async (_req, u, ctx) => {
  const { id } = await ctx.params;
  return ok(await marcarLeida(u.id, Number(id)));
});
