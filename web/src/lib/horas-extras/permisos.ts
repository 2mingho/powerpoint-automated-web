import "server-only";
import { ErrorApi } from "@/lib/api";
import { db } from "@/lib/db";
import { alcanceUnidades, unidadesLideradas } from "@/lib/alcance";
import type { UsuarioActual } from "@/lib/auth/session";

/*
 * Quien gestiona las horas extras de una unidad. Solo las unidades que las llevan (areas.has_overtime, que activa un
 * administrador).
 *   - EDITAR: quien LIDERA la unidad (su gerente) y la administracion.
 *   - VER: lo anterior mas quien la supervisa por la cadena de mando. No edita.
 * Las personas de la unidad no ven ni editan nada aqui. Una unidad que no ve es un 404; una que ve pero no edita, un 403.
 */
type Pieza = Pick<UsuarioActual, "id" | "isAdmin">;

async function conHorasExtras(ids?: number[]): Promise<number[]> {
  const filas = await db.areas.findMany({ where: { has_overtime: true, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true } });
  return filas.map((a) => a.id);
}

export async function unidadesQueVenHorasExtras(u: Pieza): Promise<number[]> {
  return u.isAdmin ? conHorasExtras() : conHorasExtras(await alcanceUnidades(u));
}

export async function unidadesQueEditanHorasExtras(u: Pieza): Promise<number[]> {
  return u.isAdmin ? conHorasExtras() : conHorasExtras(await unidadesLideradas(u.id));
}

export async function exigirEditarHorasExtras(u: Pieza, unidadId: number) {
  if ((await unidadesQueEditanHorasExtras(u)).includes(unidadId)) return;
  if ((await unidadesQueVenHorasExtras(u)).includes(unidadId)) throw new ErrorApi(403, "No tienes permiso para gestionar las horas extras de esta unidad.");
  throw new ErrorApi(404, "Unidad no encontrada.");
}

export async function exigirVerHorasExtras(u: Pieza, unidadId: number) {
  if (!(await unidadesQueVenHorasExtras(u)).includes(unidadId)) throw new ErrorApi(404, "Unidad no encontrada.");
}
