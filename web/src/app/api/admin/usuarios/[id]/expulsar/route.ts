import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { datosExpulsion, usuarioEditable } from "@/lib/admin/usuarios";

/*
 * Forzar cierre de sesion (user_kick). force_logout=true y session_token
 * rotado: usuarioActual() deja de reconocer la cookie en la siguiente
 * peticion. El proximo inicio de sesion limpia la marca.
 */
export const POST = conUsuario<RouteContext<"/api/admin/usuarios/[id]/expulsar">>(async (_req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const actual = await usuarioEditable(id);
  if (id === u.id) throw new ErrorApi(400, "Para cerrar tu propia sesión usa Salir.");
  await db.users.update({ where: { id }, data: datosExpulsion() });
  await registrarActividad(u.id, "user_kick", `Sesión terminada para ${actual.username}`, { tipo: "user", id });
  return ok({ id });
}, SOLO_ADMIN);
