import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { generarHash } from "@/lib/auth/password";
import { HERRAMIENTAS } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";
import { leerFiltrosUsuarios, listarUsuarios } from "@/lib/admin/consultas";
import { enteroONulo, SOLO_ADMIN, texto } from "@/lib/admin/api";
import { validarRol } from "@/lib/admin/usuarios";
import { ROL_POR_DEFECTO } from "@/lib/roles";

export const GET = conUsuario(async (req) => {
  return ok(await listarUsuarios(leerFiltrosUsuarios(new URL(req.url).searchParams)));
}, SOLO_ADMIN);

/* Alta de usuario (user_create). */
export const POST = conUsuario(async (req, u) => {
  const d = await cuerpo(req);
  const nombre = texto(d.nombre, 150);
  const email = texto(d.email, 150).toLowerCase();
  const contrasena = typeof d.contrasena === "string" ? d.contrasena : "";
  const rol = texto(d.rol, 20) || ROL_POR_DEFECTO;
  if (d.esAdmin !== undefined && typeof d.esAdmin !== "boolean") throw new ErrorApi(400, "«Es administrador» debe ser verdadero o falso.");
  const esAdmin = d.esAdmin === true;
  const unidadId = enteroONulo(d.unidadId);
  const herramientas = Array.isArray(d.herramientas) ? d.herramientas.filter((h): h is string => typeof h === "string" && h in HERRAMIENTAS) : Object.keys(HERRAMIENTAS);

  if (nombre.length < 3) throw new ErrorApi(400, "El nombre de usuario debe tener al menos 3 caracteres.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorApi(400, "Escribe un correo válido.");
  if (contrasena.length < 8) throw new ErrorApi(400, "La contraseña debe tener al menos 8 caracteres.");
  validarRol(rol);
  if (unidadId && !(await db.areas.findUnique({ where: { id: unidadId }, select: { id: true } }))) throw new ErrorApi(400, "La unidad no existe.");
  // El login compara sin distinguir mayusculas: la unicidad tambien.
  if (await db.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) {
    throw new ErrorApi(409, "Ya existe un usuario con ese correo.");
  }

  const nuevo = await db.users.create({
    data: {
      username: nombre, email, password: generarHash(contrasena), role: rol, is_admin: esAdmin, area_id: unidadId, is_active: true,
      created_at: new Date(), allowed_tools: JSON.stringify(herramientas), force_logout: false, is_area_lead: false,
    },
    select: { id: true },
  });
  await registrarActividad(u.id, "admin_create_user", `Creó usuario: ${nombre} (${email}) con cargo ${rol}${esAdmin ? " y administrador" : ""}`, { tipo: "user", id: nuevo.id });
  return ok({ id: nuevo.id }, 201);
}, SOLO_ADMIN);
