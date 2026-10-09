import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN, texto } from "@/lib/admin/api";

async function rol(id: number) {
  const r = await db.roles.findUnique({ where: { id } });
  if (!r) throw new ErrorApi(404, "Rol no encontrado.");
  return r;
}

export const PATCH = conUsuario<RouteContext<"/api/admin/roles/[id]">>(async (req, u, ctx) => {
  const r = await rol(await idDeRuta(ctx));
  const d = await cuerpo(req);
  const nombre = "nombre" in d ? texto(d.nombre, 100) : r.display_name;
  if (!nombre) throw new ErrorApi(400, "El nombre es obligatorio.");
  const descripcion = "descripcion" in d ? texto(d.descripcion, 500) : r.description;
  await db.roles.update({ where: { id: r.id }, data: { display_name: nombre, description: descripcion } });
  await registrarActividad(u.id, "role_edit", `Rol editado: ${r.code}`, { tipo: "role", id: r.id });
  return ok({ id: r.id });
}, SOLO_ADMIN);

export const DELETE = conUsuario<RouteContext<"/api/admin/roles/[id]">>(async (_req, u, ctx) => {
  const r = await rol(await idDeRuta(ctx));
  const n = await db.users.count({ where: { role: r.code } });
  if (n > 0) throw new ErrorApi(409, `No se puede eliminar: ${n} persona(s) tienen este rol.`);
  await db.roles.delete({ where: { id: r.id } });
  await registrarActividad(u.id, "role_delete", `Rol eliminado: ${r.code}`, { tipo: "role", id: r.id });
  return ok({ id: r.id });
}, SOLO_ADMIN);
