import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/admin/api";
import { borrarGasto, editarGasto } from "@/lib/gastos/servicio";

export const PATCH = conUsuario<RouteContext<"/api/gastos/[id]">>(async (req, u, ctx) => ok(await editarGasto(u, await idDeRuta(ctx), await cuerpo(req))));

export const DELETE = conUsuario<RouteContext<"/api/gastos/[id]">>(async (_req, u, ctx) => {
  await borrarGasto(u, await idDeRuta(ctx));
  return ok({ ok: true });
});
