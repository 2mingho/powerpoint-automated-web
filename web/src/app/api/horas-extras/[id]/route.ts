import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/admin/api";
import { borrarRegistro, editarRegistro } from "@/lib/horas-extras/servicio";

export const PATCH = conUsuario<RouteContext<"/api/horas-extras/[id]">>(async (req, u, ctx) => ok(await editarRegistro(u, await idDeRuta(ctx), await cuerpo(req))));

export const DELETE = conUsuario<RouteContext<"/api/horas-extras/[id]">>(async (_req, u, ctx) => {
  await borrarRegistro(u, await idDeRuta(ctx));
  return ok({ ok: true });
});
