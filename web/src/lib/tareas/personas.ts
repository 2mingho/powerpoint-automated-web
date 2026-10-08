import "server-only";
import { db } from "@/lib/db";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles, idsUsuariosDelAmbito } from "@/lib/tareas/alcance";
import type { PersonaDTO } from "./tipos";

/*
 * Gente con la que se trabaja (_unit_user_query): su unidad mas las que
 * supervisa. Sin unidades, solo uno mismo, para poder asignarse trabajo.
 */
export async function personasDelAmbito(u: UsuarioActual, soloActivos = true): Promise<PersonaDTO[]> {
  const ids = await idsUsuariosDelAmbito(u, soloActivos);
  const filas = await db.users.findMany({
    where: { ...(ids === "todos" ? {} : { id: { in: ids } }), ...(soloActivos ? { is_active: true } : {}) },
    orderBy: { username: "asc" },
    select: { id: true, username: true, role: true, area_id: true, areas: { select: { name: true } } },
  });
  return filas.map((p) => ({ id: p.id, nombre: p.username, unidad: p.areas?.name || p.role || "Sin unidad", unidadId: p.area_id }));
}

/* Clientes distintos de las tareas visibles, para el filtro y el autocompletado. */
export async function clientesVisibles(u: UsuarioActual): Promise<string[]> {
  const filas = await db.tasks.findMany({
    where: { AND: [await filtroTareasVisibles(u), { client: { not: null } }, { NOT: { client: "" } }] },
    distinct: ["client"],
    select: { client: true },
    orderBy: { client: "asc" },
    take: 300,
  });
  return filas.map((f) => f.client!).filter(Boolean);
}

/* Unidades para el filtro de admin. */
export async function unidadesParaFiltro(u: UsuarioActual) {
  if (!u.isAdmin) return [];
  return db.areas.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}
