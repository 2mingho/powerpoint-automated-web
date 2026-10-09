import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { enteroONulo, SOLO_ADMIN } from "@/lib/admin/api";
import { validarSuperior } from "@/lib/admin/usuarios";

/* A quien reporta alguien (organizacion_superior). managerId vacio = nadie. */
export const POST = conUsuario(async (req, u) => {
  const d = await cuerpo(req);
  const userId = enteroONulo(d.userId);
  if (!userId) throw new ErrorApi(400, "Selecciona una persona.");
  const persona = await db.users.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (!persona) throw new ErrorApi(404, "Persona no encontrada.");
  const jefeId = enteroONulo(d.managerId);
  if (!jefeId) {
    await db.users.update({ where: { id: userId }, data: { manager_id: null } });
    await registrarActividad(u.id, "manager_clear", `${persona.username} ya no reporta a nadie`, { tipo: "user", id: userId });
    return ok({ ok: true });
  }
  const jefe = await validarSuperior(userId, jefeId);
  await db.users.update({ where: { id: userId }, data: { manager_id: jefeId } });
  await registrarActividad(u.id, "manager_set", `${persona.username} reporta a ${jefe.username}`, { tipo: "user", id: userId });
  return ok({ ok: true });
}, SOLO_ADMIN);
