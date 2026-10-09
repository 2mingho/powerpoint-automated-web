import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";

/* Solo una conexion activa a la vez: es la que resuelve ai_provider.complete(). */
export const POST = conUsuario<RouteContext<"/api/admin/ia/[id]/activar">>(async (_req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const c = await db.ai_providers.findUnique({ where: { id }, select: { name: true } });
  if (!c) throw new ErrorApi(404, "Conexión no encontrada.");
  await db.$transaction([
    db.ai_providers.updateMany({ data: { is_active: false } }),
    db.ai_providers.update({ where: { id }, data: { is_active: true } }),
  ]);
  await registrarActividad(u.id, "ai_provider_activate", `Conexión IA activada: ${c.name}`, { tipo: "ai_provider", id });
  return ok({ id });
}, SOLO_ADMIN);
