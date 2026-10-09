import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { leerConexion, nombreLibre } from "@/lib/admin/ia";

async function conexion(id: number) {
  const c = await db.ai_providers.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!c) throw new ErrorApi(404, "Conexión no encontrada.");
  return c;
}

/* Una clave vacia al editar significa "conserva la que ya estaba". */
export const PATCH = conUsuario<RouteContext<"/api/admin/ia/[id]">>(async (req, u, ctx) => {
  const actual = await conexion(await idDeRuta(ctx));
  const c = leerConexion(await cuerpo(req));
  await nombreLibre(c.nombre, actual.id);
  await db.ai_providers.update({
    where: { id: actual.id },
    data: {
      name: c.nombre, provider: c.proveedor, model: c.modelo, price_in_per_1m: c.precioIn, price_out_per_1m: c.precioOut,
      ...(c.clave ? { api_key: c.clave } : {}),
    },
  });
  await registrarActividad(u.id, "ai_provider_edit", `Conexión IA actualizada: ${c.nombre} (${c.proveedor}/${c.modelo})${c.clave ? " con clave nueva" : ""}`, { tipo: "ai_provider", id: actual.id });
  return ok({ id: actual.id });
}, SOLO_ADMIN);

/* El consumo historico se conserva: ai_usage.provider_id pasa a NULL. */
export const DELETE = conUsuario<RouteContext<"/api/admin/ia/[id]">>(async (_req, u, ctx) => {
  const c = await conexion(await idDeRuta(ctx));
  await db.ai_providers.delete({ where: { id: c.id } });
  await registrarActividad(u.id, "ai_provider_delete", `Conexión IA eliminada: ${c.name}`, { tipo: "ai_provider", id: c.id });
  return ok({ id: c.id });
}, SOLO_ADMIN);
