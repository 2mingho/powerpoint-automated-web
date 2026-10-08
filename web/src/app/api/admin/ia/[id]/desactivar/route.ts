import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";

export const POST = conUsuario<RouteContext<"/api/admin/ia/[id]/desactivar">>(async (_req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const c = await db.ai_providers.findUnique({ where: { id }, select: { name: true } });
  if (!c) throw new ErrorApi(404, "Conexión no encontrada.");
  await db.ai_providers.update({ where: { id }, data: { is_active: false } });
  await registrarActividad(u.id, "ai_provider_deactivate", `Conexión IA desactivada: ${c.name}`, { tipo: "ai_provider", id });
  return ok({ id });
}, SOLO_ADMIN);
