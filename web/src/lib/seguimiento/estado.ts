/*
 * Reglas puras de los campos de seguimiento de una tarea: horas, motivo de
 * bloqueo y lo que pasa con done_at / block_reason al cambiar de estado.
 * Sin base ni reloj; las mutaciones del servidor las aplican.
 */

export const HORAS_MAX = 1000;

/* Capacidad semanal estandar (h) de quien no tiene `weekly_capacity`. 0 es "no recibe carga". */
export const CAPACIDAD_ESTANDAR = 35;

/* Horas estimadas de una tarea sin estimar, para no ignorarla en la carga. */
export const HORAS_POR_DEFECTO = 4;

export type Leido<T> = { ok: true; valor: T } | { ok: false; error: string };

/*
 * Horas estimadas de un formulario: "" o null las quitan; el resto debe ser un
 * numero mayor que 0 y de hasta 1000, con a lo sumo dos decimales.
 */
export function leerHoras(crudo: unknown): Leido<number | null> {
  if (crudo === null || crudo === undefined || (typeof crudo === "string" && !crudo.trim())) return { ok: true, valor: null };
  const n = typeof crudo === "number" ? crudo : typeof crudo === "string" ? Number(crudo.trim().replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > HORAS_MAX) return { ok: false, error: `Las horas deben ser un número mayor que 0 y de hasta ${HORAS_MAX}.` };
  return { ok: true, valor: Math.round(n * 100) / 100 };
}

/* "Bloqueado", "Bloqueada", "En bloqueo": el catalogo de estados es editable, asi que se reconoce por el nombre. */
export function esEstadoDeBloqueo(nombre: string): boolean {
  return /bloque/i.test(nombre);
}

/*
 * Que cambia en la tarea al pasar de un estado a otro. Cerrar fija done_at y
 * borra el motivo de bloqueo (ya no aplica); reabrir quita done_at. Moverse
 * entre estados abiertos, o entre cerrados, no toca nada: no se pierde la fecha
 * real de cierre.
 */
export function efectosDeEstado(previoFinal: boolean, nuevoFinal: boolean, ahora: Date): { done_at?: Date | null; block_reason?: null } {
  if (!previoFinal && nuevoFinal) return { done_at: ahora, block_reason: null };
  if (previoFinal && !nuevoFinal) return { done_at: null };
  return {};
}

/*
 * Una tarea con revisor la cierra el revisor o quien lidera; el resto la pasa
 * a revision. Devuelve true si `quien` puede cerrarla.
 */
export function puedeCerrar(revisorId: number | null, quienId: number, esLider: boolean): boolean {
  return revisorId == null || revisorId === quienId || esLider;
}

/*
 * Cambiar o quitar el revisor de una tarea que ya lo tiene lo hace el propio
 * revisor o quien lidera: si no, quitarlo seria la forma de saltarse la aprobacion.
 */
export function puedeCambiarRevisor(revisorActual: number | null, quienId: number, esLider: boolean): boolean {
  return revisorActual == null || revisorActual === quienId || esLider;
}
