import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { generarHash } from "@/lib/auth/password";
import { HERRAMIENTAS } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";
import { enteroONulo, idDeRuta, SOLO_ADMIN, texto } from "@/lib/admin/api";
import { usuarioEditable, validarRol, validarSuperior } from "@/lib/admin/usuarios";

/*
 * Edicion parcial (user_edit): solo cambia lo que llega en el cuerpo. El
 * superior tambien se puede cambiar aqui, con la misma guarda de ciclos que
 * la pantalla de Organizacion.
 */
export const PATCH = conUsuario<RouteContext<"/api/admin/usuarios/[id]">>(async (req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const actual = await usuarioEditable(id);
  const d = await cuerpo(req);
  const datos: Record<string, unknown> = {};
  const cambios: string[] = [];

  if ("nombre" in d) {
    const nombre = texto(d.nombre, 150);
    if (nombre.length < 3) throw new ErrorApi(400, "El nombre de usuario debe tener al menos 3 caracteres.");
    if (nombre !== actual.username) { datos.username = nombre; cambios.push(`nombre: ${actual.username} -> ${nombre}`); }
  }
  if ("email" in d) {
    const email = texto(d.email, 150).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorApi(400, "Escribe un correo válido.");
    if (email !== actual.email.toLowerCase()) {
      const otro = await db.users.findFirst({ where: { email: { equals: email, mode: "insensitive" }, NOT: { id } }, select: { id: true } });
      if (otro) throw new ErrorApi(409, "Ya existe un usuario con ese correo.");
      datos.email = email;
      cambios.push(`email: ${actual.email} -> ${email}`);
    }
  }
  if ("rol" in d) {
    const rol = texto(d.rol, 20);
    if (!rol) throw new ErrorApi(400, "Elige un rol.");
    if (id === u.id && rol !== "admin") throw new ErrorApi(400, "No puedes quitarte tu propio rol de administrador.");
    await validarRol(rol, actual.role);
    if (rol !== actual.role) { datos.role = rol; cambios.push(`rol: ${actual.role} -> ${rol}`); }
  }
  if ("unidadId" in d) {
    const unidadId = enteroONulo(d.unidadId);
    if (unidadId && !(await db.areas.findUnique({ where: { id: unidadId }, select: { id: true } }))) throw new ErrorApi(400, "La unidad no existe.");
    if (unidadId !== actual.area_id) { datos.area_id = unidadId; cambios.push("unidad actualizada"); }
  }
  if ("managerId" in d) {
    const jefeId = enteroONulo(d.managerId);
    if (jefeId) await validarSuperior(id, jefeId);
    if (jefeId !== actual.manager_id) { datos.manager_id = jefeId; cambios.push("superior actualizado"); }
  }
  if ("herramientas" in d) {
    if (!Array.isArray(d.herramientas)) throw new ErrorApi(400, "Herramientas inválidas.");
    const lista = d.herramientas.filter((h): h is string => typeof h === "string" && h in HERRAMIENTAS);
    const nuevo = JSON.stringify(lista);
    if (nuevo !== actual.allowed_tools) { datos.allowed_tools = nuevo; cambios.push("permisos actualizados"); }
  }
  if ("contrasena" in d && typeof d.contrasena === "string" && d.contrasena) {
    if (d.contrasena.length < 8) throw new ErrorApi(400, "La contraseña debe tener al menos 8 caracteres.");
    datos.password = generarHash(d.contrasena);
    cambios.push("contraseña actualizada");
  }

  if (Object.keys(datos).length) await db.users.update({ where: { id }, data: datos });
  await registrarActividad(u.id, "admin_edit_user", `Editó usuario #${id}: ${cambios.length ? cambios.join(", ") : "sin cambios"}`, { tipo: "user", id });
  return ok({ id, cambios: cambios.length });
}, SOLO_ADMIN);
