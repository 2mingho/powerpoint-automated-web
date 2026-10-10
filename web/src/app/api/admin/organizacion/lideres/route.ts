import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { enteroONulo, SOLO_ADMIN } from "@/lib/admin/api";

async function par(req: Request) {
  const d = await cuerpo(req);
  const unidadId = enteroONulo(d.unidadId);
  const userId = enteroONulo(d.userId);
  if (!unidadId || !userId) throw new ErrorApi(400, "Selecciona una unidad y una persona.");
  const [area, usuario] = await Promise.all([
    db.areas.findUnique({ where: { id: unidadId }, select: { id: true, name: true } }),
    db.users.findUnique({ where: { id: userId }, select: { id: true, username: true } }),
  ]);
  if (!area || !usuario) throw new ErrorApi(404, "Unidad o persona no encontrada.");
  return { area, usuario };
}

/* Asignar liderazgo (organizacion_lider_add). */
export const POST = conUsuario(async (req, u) => {
  const { area, usuario } = await par(req);
  const ya = await db.unit_leads.findUnique({ where: { user_id_area_id: { user_id: usuario.id, area_id: area.id } } });
  if (ya) throw new ErrorApi(409, `${usuario.username} ya lidera ${area.name}.`);
  await db.unit_leads.create({ data: { user_id: usuario.id, area_id: area.id } });
  await registrarActividad(u.id, "unit_lead_add", `${usuario.username} lidera ${area.name}`, { tipo: "area", id: area.id });
  return ok({ ok: true }, 201);
}, SOLO_ADMIN);

/* Quitar liderazgo (organizacion_lider_remove). */
export const DELETE = conUsuario(async (req, u) => {
  const { area, usuario } = await par(req);
  const r = await db.unit_leads.deleteMany({ where: { user_id: usuario.id, area_id: area.id } });
  if (!r.count) throw new ErrorApi(404, `${usuario.username} no lidera ${area.name}.`);
  await registrarActividad(u.id, "unit_lead_remove", `${usuario.username} deja de liderar ${area.name}`, { tipo: "area", id: area.id });
  return ok({ ok: true });
}, SOLO_ADMIN);
