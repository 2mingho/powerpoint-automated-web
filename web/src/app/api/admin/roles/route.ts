import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { opcionesPersonas } from "@/lib/admin/consultas";
import { SOLO_ADMIN, texto } from "@/lib/admin/api";

/* Roles con su conteo, y las opciones del formulario de personas (unidades y posibles superiores). */
export const GET = conUsuario(async () => ok(await opcionesPersonas()), SOLO_ADMIN);

export const POST = conUsuario(async (req, u) => {
  const d = await cuerpo(req);
  const codigo = texto(d.codigo, 30).toUpperCase();
  const nombre = texto(d.nombre, 100);
  const descripcion = texto(d.descripcion, 500);
  if (!codigo || !nombre) throw new ErrorApi(400, "Código y nombre son obligatorios.");
  if (!/^[A-Z0-9_-]+$/.test(codigo)) throw new ErrorApi(400, "El código solo admite letras, números, guion y guion bajo.");
  if (codigo === "ADMIN") throw new ErrorApi(400, "El código ADMIN está reservado.");
  if (await db.roles.findUnique({ where: { code: codigo }, select: { id: true } })) throw new ErrorApi(409, `El código "${codigo}" ya existe.`);
  const r = await db.roles.create({ data: { code: codigo, display_name: nombre, description: descripcion, created_at: new Date() } });
  await registrarActividad(u.id, "role_create", `Rol creado: ${codigo}`, { tipo: "role", id: r.id });
  return ok({ id: r.id }, 201);
}, SOLO_ADMIN);
