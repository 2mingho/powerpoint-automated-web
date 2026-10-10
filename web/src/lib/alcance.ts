import "server-only";
import { db } from "@/lib/db";
import { porObjeto } from "@/lib/memo";
import type { UsuarioActual } from "@/lib/auth/session";

/*
 * Quien ve que unidades. Traduccion directa de services/alcance.py, que es la
 * pieza mas sensible de la app: si una regla se relaja aqui, alguien ve
 * trabajo de una unidad que no lidera.
 *
 *   empleado  sin filas en unit_leads y sin nadie a cargo
 *   manager   con al menos una fila en unit_leads
 *   director  con managers por debajo en la cadena de mando
 *
 * Todo cierra en falso: un alcance vacio debe producir cero filas, nunca
 * todas. Quien consuma esto filtra con `in: [...]` aunque venga vacio.
 */

/* El usuario y todo lo que cuelga de el en la cadena de mando. */
export async function personasACargo(userId: number): Promise<Set<number>> {
  const filas = await db.users.findMany({ select: { id: true, manager_id: true } });
  const reportes = new Map<number, number[]>();
  for (const f of filas) {
    if (f.manager_id == null) continue;
    const lista = reportes.get(f.manager_id) ?? [];
    lista.push(f.id);
    reportes.set(f.manager_id, lista);
  }
  const dentro = new Set<number>();
  const pila = [userId];
  while (pila.length) {
    const actual = pila.pop()!;
    // Corta ciclos: un ciclo aqui seria un bucle infinito en cada peticion.
    if (dentro.has(actual)) continue;
    dentro.add(actual);
    pila.push(...(reportes.get(actual) ?? []));
  }
  return dentro;
}

/*
 * Unidades que supervisa: las que lidera el o cualquiera a su cargo. Memorizado por peticion
 * (por el objeto del usuario: ver lib/memo.ts). Un solo viaje a la base: la cadena de mando
 * se recorre con una consulta recursiva (UNION descarta repetidos, asi que un ciclo no cuelga)
 * en vez de traer todos los usuarios para recorrerla aqui.
 */
export const alcanceUnidades = porObjeto(async (u: Pick<UsuarioActual, "id" | "isAdmin">): Promise<number[]> => {
  if (u.isAdmin) {
    return (await db.areas.findMany({ select: { id: true } })).map((a) => a.id);
  }
  const filas = await db.$queryRaw<{ area_id: number }[]>`
    WITH RECURSIVE equipo(id) AS (
      SELECT ${u.id}::int
      UNION
      SELECT p.id FROM users p JOIN equipo e ON p.manager_id = e.id
    )
    SELECT DISTINCT l.area_id FROM unit_leads l WHERE l.user_id IN (SELECT id FROM equipo)`;
  return filas.map((f) => f.area_id);
});

/* Solo las lideradas directamente (para distinguir manager de director). */
export async function unidadesLideradas(userId: number): Promise<number[]> {
  const filas = await db.unit_leads.findMany({ where: { user_id: userId }, select: { area_id: true } });
  return filas.map((f) => f.area_id);
}

/*
 * Unidades con las que trabaja: la suya mas las que supervisa. No es el
 * alcance: para un empleado el alcance es vacio y el ambito es su unidad.
 */
export const ambitoUnidades = porObjeto(async (u: Pick<UsuarioActual, "id" | "isAdmin" | "areaId">): Promise<number[]> => {
  const unidades = new Set(await alcanceUnidades(u));
  if (u.areaId != null) unidades.add(u.areaId);
  return [...unidades];
});

export async function puedeVerEquipo(u: Pick<UsuarioActual, "id" | "isAdmin">) {
  return u.isAdmin || (await alcanceUnidades(u)).length > 0;
}

export type Papel = "admin" | "director" | "manager" | "empleado";

/* Para mostrar, no para decidir permisos. */
export const papel = porObjeto(async (u: Pick<UsuarioActual, "id" | "isAdmin">): Promise<Papel> => {
  if (u.isAdmin) return "admin";
  if ((await unidadesLideradas(u.id)).length) return "manager";
  if ((await alcanceUnidades(u)).length) return "director";
  return "empleado";
});
