import { conUsuario, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { esAdminProtegido } from "@/lib/admin/protegido";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { obtenerSesion } from "@/lib/auth/session";

/*
 * Ver la aplicacion como otra persona (user_impersonate de Flask). Solo la cuenta de
 * administracion protegida. La sesion pasa a ser la de la persona suplantada, pero
 * recuerda quien es de verdad y su token: si esa sesion se cierra, esta tambien. Lo
 * que se haga queda en la actividad con una marca de suplantacion.
 */
export const POST = conUsuario<RouteContext<"/api/admin/usuarios/[id]/suplantar">>(async (_req, u, ctx) => {
  if (!esAdminProtegido(u.email)) throw new ErrorApi(403, "Solo el administrador principal puede usar esta función.");
  if (u.suplantadoPor) throw new ErrorApi(400, "Ya estás viendo como otra persona. Vuelve a tu cuenta primero.");
  const id = await idDeRuta(ctx);
  if (id === u.id) throw new ErrorApi(400, "Ya eres esa persona.");
  const destino = await db.users.findUnique({ where: { id }, select: { id: true, username: true, is_active: true } });
  if (!destino) throw new ErrorApi(404, "Persona no encontrada.");
  if (!destino.is_active) throw new ErrorApi(400, "Esa cuenta está desactivada: no se puede ver como ella.");

  const sesion = await obtenerSesion();
  const tokenAdmin = sesion.token;
  if (!tokenAdmin) throw new ErrorApi(401, "Sesión requerida.");
  await registrarActividad(u.id, "impersonate_start", `Impersonando a ${destino.username}`, { tipo: "user", id: destino.id });
  sesion.suplantadoPor = { id: u.id, token: tokenAdmin };
  sesion.userId = destino.id;
  sesion.token = undefined;
  await sesion.save();
  return ok({ ok: true, nombre: destino.username });
}, SOLO_ADMIN);
