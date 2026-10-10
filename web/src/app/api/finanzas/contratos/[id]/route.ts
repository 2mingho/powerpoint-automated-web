import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/admin/api";
import { borrarContrato, editarContrato, leerContratoVisible } from "@/lib/finanzas/servicio";

export const GET = conUsuario<RouteContext<"/api/finanzas/contratos/[id]">>(async (_req, u, ctx) => ok(await leerContratoVisible(u, await idDeRuta(ctx))));

export const PATCH = conUsuario<RouteContext<"/api/finanzas/contratos/[id]">>(async (req, u, ctx) => ok(await editarContrato(u, await idDeRuta(ctx), await cuerpo(req))));

export const DELETE = conUsuario<RouteContext<"/api/finanzas/contratos/[id]">>(async (_req, u, ctx) => {
  await borrarContrato(u, await idDeRuta(ctx));
  return ok({ ok: true });
});
