import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { esAdminProtegido } from "./consultas";
import { esRol, ROLES } from "@/lib/roles";
import { creariaBucle, type PersonaOrg } from "./mando";

/* Un cargo vale si es uno de los cinco (lib/roles.ts). Administrar no es un cargo: es la casilla «Es administrador». */
export function validarRol(rol: string) {
  if (!esRol(rol)) throw new ErrorApi(400, `El cargo debe ser uno de: ${ROLES.map((r) => r.nombre).join(", ")}. Para administrar, marca «Es administrador».`);
}

export async function usuarioEditable(id: number) {
  const u = await db.users.findUnique({ where: { id } });
  if (!u) throw new ErrorApi(404, "Persona no encontrada.");
  if (esAdminProtegido(u.email)) throw new ErrorApi(403, "La cuenta de administrador predeterminada no puede modificarse.");
  return u;
}

/*
 * Cambiar el superior de alguien. Rechaza ser su propio superior y los ciclos:
 * si el jefe elegido ya cuelga de esta persona, asignarlo cierra un bucle.
 */
export async function validarSuperior(personaId: number, jefeId: number) {
  if (personaId === jefeId) throw new ErrorApi(400, "Nadie puede ser su propio superior.");
  const jefe = await db.users.findUnique({ where: { id: jefeId }, select: { id: true, username: true } });
  if (!jefe) throw new ErrorApi(400, "Superior no encontrado.");
  const filas = await db.users.findMany({ select: { id: true, username: true, area_id: true, manager_id: true } });
  const personas: PersonaOrg[] = filas.map((f) => ({ id: f.id, nombre: f.username, unidadId: f.area_id, managerId: f.manager_id, activo: true }));
  if (creariaBucle(personas, personaId, jefeId)) {
    const p = filas.find((f) => f.id === personaId)?.username ?? `#${personaId}`;
    throw new ErrorApi(409, `${jefe.username} ya está por debajo de ${p}: asignarlo crearía un bucle en la cadena de mando.`);
  }
  return jefe;
}

/* Cierre forzado: la marca y un token nuevo invalidan la cookie en la siguiente peticion. */
export function datosExpulsion() {
  return { force_logout: true, session_token: randomBytes(24).toString("hex") };
}
