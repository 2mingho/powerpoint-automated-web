import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { usuarioEditable } from "@/lib/admin/usuarios";

/* Activar o desactivar (user_toggle / user_delete, que en Flask tambien solo desactivaba). */
export const POST = conUsuario<RouteContext<"/api/admin/usuarios/[id]/activo">>(async (req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const actual = await usuarioEditable(id);
  if (id === u.id) throw new ErrorApi(400, "No puedes desactivarte a ti mismo.");
  const d = await cuerpo(req);
  const activo = typeof d.activo === "boolean" ? d.activo : !(actual.is_active !== false);
  await db.users.update({ where: { id }, data: { is_active: activo } });
  await registrarActividad(u.id, "admin_toggle_user", `Usuario #${id} (${actual.username}) ${activo ? "activado" : "desactivado"}`, { tipo: "user", id });
  return ok({ id, activo });
}, SOLO_ADMIN);
