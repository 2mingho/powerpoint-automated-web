import "server-only";
import { ErrorApi } from "@/lib/api";
import { db } from "@/lib/db";
import { alcanceUnidades, unidadesLideradas } from "@/lib/alcance";
import type { UsuarioActual } from "@/lib/auth/session";

/*
 * Quien toca los gastos de una unidad.
 *   - EDITAR (gastos y presupuesto): quien LIDERA la unidad (su gerente) y la administracion.
 *   - VER: lo anterior mas quien la supervisa por la cadena de mando (direccion). No edita.
 * Una unidad que no ve es un 404 (ni siquiera sabe que existe aqui); una que ve pero no puede editar, un 403.
 */
type Pieza = Pick<UsuarioActual, "id" | "isAdmin">;

const todas = async () => (await db.areas.findMany({ select: { id: true } })).map((a) => a.id);

export async function unidadesQueVeGastos(u: Pieza): Promise<number[]> {
  return u.isAdmin ? todas() : alcanceUnidades(u);
}

export async function unidadesQueEditaGastos(u: Pieza): Promise<number[]> {
  return u.isAdmin ? todas() : unidadesLideradas(u.id);
}

export async function exigirEditarGastos(u: Pieza, unidadId: number) {
  if ((await unidadesQueEditaGastos(u)).includes(unidadId)) return;
  if ((await unidadesQueVeGastos(u)).includes(unidadId)) throw new ErrorApi(403, "No tienes permiso para editar los gastos de esta unidad.");
  throw new ErrorApi(404, "Unidad no encontrada.");
}

export async function exigirVerGastos(u: Pieza, unidadId: number) {
  if (!(await unidadesQueVeGastos(u)).includes(unidadId)) throw new ErrorApi(404, "Unidad no encontrada.");
}
