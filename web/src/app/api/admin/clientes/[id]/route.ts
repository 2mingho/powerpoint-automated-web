import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { borrarCliente, editarCliente } from "@/lib/clientes/admin";

export const PATCH = conUsuario<RouteContext<"/api/admin/clientes/[id]">>(async (req, u, ctx) => {
  await editarCliente(u.id, await idDeRuta(ctx), await cuerpo(req));
  return ok({ ok: true });
}, SOLO_ADMIN);

export const DELETE = conUsuario<RouteContext<"/api/admin/clientes/[id]">>(async (_req, u, ctx) => {
  await borrarCliente(u.id, await idDeRuta(ctx));
  return ok({ ok: true });
}, SOLO_ADMIN);
