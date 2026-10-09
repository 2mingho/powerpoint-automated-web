import "server-only";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { puedeVerEquipo } from "@/lib/alcance";
import type { UsuarioActual } from "@/lib/auth/session";
import { puedeAsignarA } from "@/lib/tareas/alcance";
import { efectosDeEstado, leerHoras, puedeCambiarRevisor, puedeCerrar } from "@/lib/seguimiento/estado";
import { texto } from "./base";

/*
 * Campos de seguimiento de una tarea (horas, revisor, motivo de bloqueo) y las
 * reglas de aprobacion. Las mutaciones de tareas los aplican todos por aqui,
 * para que crear, editar, mover en el tablero y los lotes no discrepen.
 */

export const ES_LIDER_ERROR = "Solo quien revisa la tarea o quien lidera la unidad puede completarla. Pásala a revisión.";

/* Quien lidera algo (o es admin) aprueba cualquier tarea de su ambito. */
export async function esLider(u: UsuarioActual): Promise<boolean> {
  return puedeVerEquipo(u);
}

/* Lanza 403 si la tarea tiene revisor y `u` no puede cerrarla. */
export async function exigirPuedeCerrar(u: UsuarioActual, tareas: Array<{ reviewer_id: number | null }>, revisorNombre?: string) {
  const ajenas = tareas.filter((t) => !puedeCerrar(t.reviewer_id, u.id, false));
  if (!ajenas.length) return;
  if (await esLider(u)) return;
  throw new ErrorApi(403, revisorNombre && ajenas.length === 1
    ? `Esta tarea la cierra ${revisorNombre} o quien lidera la unidad. Pásala a revisión.`
    : ES_LIDER_ERROR);
}

type Previa = { reviewer_id: number | null; assignee_id: number } | null;

export type CamposSeguimiento = {
  estimated_hours?: number | null;
  reviewer_id?: number | null;
  block_reason?: string | null;
};

/*
 * Lee y valida estimated_hours, reviewer_id y block_reason del cuerpo. Solo
 * devuelve lo que vino en el cuerpo. `asignadoFinal` es quien hara la tarea
 * despues del cambio: no puede ser tambien su revisor.
 */
export async function camposDeSeguimiento(u: UsuarioActual, d: Record<string, unknown>, previa: Previa, asignadoFinal: number): Promise<CamposSeguimiento> {
  const datos: CamposSeguimiento = {};

  if ("estimated_hours" in d) {
    const h = leerHoras(d.estimated_hours);
    if (!h.ok) throw new ErrorApi(400, h.error);
    datos.estimated_hours = h.valor;
  }
  if ("block_reason" in d) datos.block_reason = texto(d.block_reason).slice(0, 255) || null;

  const revisorActual = previa?.reviewer_id ?? null;
  if ("reviewer_id" in d) {
    const crudo = d.reviewer_id;
    const id = crudo === null || crudo === "" || crudo === 0 || crudo === "0" ? null : Number(crudo);
    if (id !== null && (!Number.isInteger(id) || id <= 0)) throw new ErrorApi(400, "El revisor no existe.");
    if (id !== revisorActual) {
      if (!puedeCambiarRevisor(revisorActual, u.id, await esLider(u))) {
        throw new ErrorApi(403, "Solo el revisor actual o quien lidera la unidad puede cambiar o quitar el revisor.");
      }
      if (id !== null) {
        const r = await db.users.findUnique({ where: { id }, select: { id: true, area_id: true, is_active: true } });
        // Mismo ambito que para asignar: un revisor fuera de el responde igual que uno inexistente.
        if (!r || r.is_active === false || !(await puedeAsignarA(u, r))) throw new ErrorApi(400, "El revisor no existe o no es de tu unidad.");
      }
    }
    datos.reviewer_id = id;
  }

  const revisorFinal = "reviewer_id" in datos ? datos.reviewer_id ?? null : revisorActual;
  if (revisorFinal != null && revisorFinal === asignadoFinal) throw new ErrorApi(400, "El revisor no puede ser quien hace la tarea.");
  return datos;
}

/* done_at y block_reason segun el cambio de estado (ver efectosDeEstado). */
export function efectosDeCambio(previoFinal: boolean, nuevoFinal: boolean, ahora = new Date()) {
  return efectosDeEstado(previoFinal, nuevoFinal, ahora);
}
