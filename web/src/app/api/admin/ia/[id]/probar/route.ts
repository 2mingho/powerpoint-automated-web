import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { probarConexion } from "@/lib/admin/ia";

export const POST = conUsuario<RouteContext<"/api/admin/ia/[id]/probar">>(async (_req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const c = await db.ai_providers.findUnique({ where: { id }, select: { name: true, provider: true, model: true, api_key: true } });
  if (!c) throw new ErrorApi(404, "Conexión no encontrada.");
  const r = await probarConexion(c.provider, c.model, c.api_key);
  await registrarActividad(u.id, "ai_provider_test", `Prueba de conexión IA ${c.name}: ${r.ok ? "ok" : "fallo"}`, { tipo: "ai_provider", id });
  return ok({ id, ok: r.ok, mensaje: r.mensaje });
}, SOLO_ADMIN);
