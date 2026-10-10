import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ErrorApi } from "@/lib/api";
import { db } from "@/lib/db";
import { alcanceUnidades } from "@/lib/alcance";
import type { UsuarioActual } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";
import { notificar } from "@/lib/notificaciones";
import { CLAVES_FINANZAS, diferencia, SIN_CONCESIONES, TIPOS_FINANZAS, type Concesiones, type TipoFinanzas } from "./concesiones";

/*
 * Quien puede tocar los ingresos de una unidad. Dos puertas distintas:
 *  - EDITAR (contratos / metas): una concesion de un administrador por persona,
 *    unidad y tipo. El administrador edita todo sin concesiones.
 *  - VER: la estructura de mando (unidades que supervisa) mas lo que se le haya
 *    concedido editar; no se edita a ciegas.
 * Cierra en falso: sin concesion no hay edicion, y lo que no se ve no existe (404).
 */

type Pieza = Pick<UsuarioActual, "id" | "isAdmin">;

export async function concesionesDe(userId: number): Promise<Concesiones> {
  return (await concesionesDeVarios([userId])).get(userId) ?? SIN_CONCESIONES();
}

export async function concesionesDeVarios(userIds: number[]): Promise<Map<number, Concesiones>> {
  const mapa = new Map<number, Concesiones>(userIds.map((id) => [id, SIN_CONCESIONES()]));
  if (!userIds.length) return mapa;
  const filas = await db.finance_grants.findMany({ where: { user_id: { in: userIds } }, select: { user_id: true, area_id: true, kind: true }, orderBy: { area_id: "asc" } });
  for (const f of filas) if (f.kind === "contracts" || f.kind === "goals") mapa.get(f.user_id)?.[f.kind].push(f.area_id);
  return mapa;
}

async function todasLasUnidades() {
  return (await db.areas.findMany({ select: { id: true } })).map((a) => a.id);
}

/* Unidades cuyos contratos o metas puede editar. Administracion: todas. */
export async function unidadesEditables(u: Pieza, tipo: TipoFinanzas): Promise<number[]> {
  if (u.isAdmin) return todasLasUnidades();
  return (await concesionesDe(u.id))[tipo];
}

export async function puedeEditarFinanzas(u: Pieza, tipo: TipoFinanzas, unidadId: number): Promise<boolean> {
  if (u.isAdmin) return !!(await db.areas.findUnique({ where: { id: unidadId }, select: { id: true } }));
  return !!(await db.finance_grants.findUnique({ where: { user_id_area_id_kind: { user_id: u.id, area_id: unidadId, kind: tipo } }, select: { user_id: true } }));
}

/*
 * Para las escrituras: una unidad que no ve es un 404 (ni siquiera sabe que
 * existe en ingresos); una que ve pero no puede editar es un 403.
 */
export async function exigirEditarFinanzas(u: Pieza, tipo: TipoFinanzas, unidadId: number) {
  if (await puedeEditarFinanzas(u, tipo, unidadId)) return;
  if ((await unidadesVisiblesFinanzas(u)).includes(unidadId)) throw new ErrorApi(403, `No tienes permiso para editar ${TIPOS_FINANZAS[tipo].toLowerCase()} de esta unidad.`);
  throw new ErrorApi(404, "Unidad no encontrada.");
}

/* Unidades cuyos ingresos puede ver: las que supervisa mas las que puede editar. */
export async function unidadesVisiblesFinanzas(u: Pieza): Promise<number[]> {
  if (u.isAdmin) return todasLasUnidades();
  const [supervisadas, c] = await Promise.all([alcanceUnidades(u), concesionesDe(u.id)]);
  return [...new Set([...supervisadas, ...c.contracts, ...c.goals])].sort((a, b) => a - b);
}

/*
 * Reemplaza las concesiones de `persona` (solo los tipos que llegan), en una
 * transaccion. Valida que las unidades existan, deja registro y avisa a la
 * persona. Devuelve el resumen para la actividad ("" si no cambio nada).
 */
export async function fijarConcesiones(admin: Pieza, persona: { id: number; username: string; isAdmin: boolean }, nuevas: Partial<Concesiones>): Promise<string[]> {
  const tipos = CLAVES_FINANZAS.filter((t) => nuevas[t] !== undefined);
  if (!tipos.length) return [];
  if (persona.isAdmin && tipos.some((t) => nuevas[t]!.length)) throw new ErrorApi(400, "Administración ya edita los ingresos de todas las unidades.");
  const pedidas = [...new Set(tipos.flatMap((t) => nuevas[t]!))];
  if (pedidas.length) {
    const existentes = new Set((await db.areas.findMany({ where: { id: { in: pedidas } }, select: { id: true } })).map((a) => a.id));
    const falta = pedidas.find((id) => !existentes.has(id));
    if (falta !== undefined) throw new ErrorApi(400, "Alguna de las unidades elegidas no existe.");
  }

  const nombres = new Map((await db.areas.findMany({ select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const cambios: string[] = [];
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const actual = await concesionesDe(persona.id);
    for (const tipo of tipos) {
      const { altas, bajas } = diferencia(actual[tipo], nuevas[tipo]!);
      if (!altas.length && !bajas.length) continue;
      if (bajas.length) await tx.finance_grants.deleteMany({ where: { user_id: persona.id, kind: tipo, area_id: { in: bajas } } });
      if (altas.length) await tx.finance_grants.createMany({ data: altas.map((area_id) => ({ user_id: persona.id, area_id, kind: tipo, granted_by: admin.id, created_at: new Date() })) });
      const parte = [...altas.map((i) => `+${nombres.get(i) ?? i}`), ...bajas.map((i) => `-${nombres.get(i) ?? i}`)].join(", ");
      cambios.push(`${TIPOS_FINANZAS[tipo].toLowerCase()}: ${parte}`);
      await notificar(persona.id, {
        tipo: "finance_grant",
        titulo: altas.length ? `Ahora puedes editar ${TIPOS_FINANZAS[tipo].toLowerCase()}` : `Ya no editas ${TIPOS_FINANZAS[tipo].toLowerCase()} de algunas unidades`,
        cuerpo: [altas.length ? `Se añadió: ${altas.map((i) => nombres.get(i) ?? i).join(", ")}.` : "", bajas.length ? `Se quitó: ${bajas.map((i) => nombres.get(i) ?? i).join(", ")}.` : ""].filter(Boolean).join(" "),
        entidad: { tipo: "user", id: persona.id },
        actorId: admin.id,
      }, tx);
    }
  });
  if (cambios.length) await registrarActividad(admin.id, "finance_grant_update", `Permisos de ingresos de ${persona.username} (#${persona.id}): ${cambios.join("; ")}`, { tipo: "user", id: persona.id });
  return cambios;
}
