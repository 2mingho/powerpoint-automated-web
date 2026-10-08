/*
 * Posiciones del tablero (services/tablero.py y _colocar de tasks_tablero.py).
 *
 * board_position es un real para poder soltar una tarjeta entre otras dos sin
 * renumerar la columna. Nula = nunca colocada a mano; esas van al final, por
 * fecha de entrega. Con doble precision el hueco se puede partir por la mitad
 * unas cincuenta veces antes de perder resolucion.
 */
export const PASO_DE_POSICION = 1024;

export function posicionEntre(anterior: number | null, siguiente: number | null): number {
  if (anterior == null && siguiente == null) return PASO_DE_POSICION;
  if (anterior == null) return (siguiente as number) - PASO_DE_POSICION;
  if (siguiente == null) return anterior + PASO_DE_POSICION;
  return (anterior + siguiente) / 2;
}

export function hayHueco(anterior: number | null, siguiente: number | null, posicion: number): boolean {
  if (anterior != null && !(posicion > anterior)) return false;
  if (siguiente != null && !(posicion < siguiente)) return false;
  return true;
}

export function posicionesRenumeradas(cuantas: number): number[] {
  return Array.from({ length: cuantas }, (_, i) => (i + 1) * PASO_DE_POSICION);
}

export type TarjetaColumna = { id: number; posicion: number | null; entrega: string };

/* Orden de una columna: colocadas primero por posicion; el resto por entrega y por id. */
export function compararColumna(a: TarjetaColumna, b: TarjetaColumna): number {
  const na = a.posicion == null ? 1 : 0;
  const nb = b.posicion == null ? 1 : 0;
  if (na !== nb) return na - nb;
  if (a.posicion != null && b.posicion != null && a.posicion !== b.posicion) return a.posicion - b.posicion;
  if (a.entrega !== b.entrega) return a.entrega < b.entrega ? -1 : 1;
  return a.id - b.id;
}

/*
 * Donde cae la tarjeta en la columna de destino (ya ordenada y sin ella).
 * Las vecinas se buscan en el servidor y no se fian de las posiciones que
 * mande el navegador: otra persona puede haber movido algo entretanto.
 *
 * Si no cabe (vecinas sin colocar o hueco agotado) se renumera la columna
 * entera y `otras` trae las posiciones nuevas del resto.
 */
export function colocar(
  columna: TarjetaColumna[],
  tareaId: number,
  anteriorId: number | null,
  siguienteId: number | null,
): { posicion: number; otras: Array<[number, number]> } {
  const ids = columna.map((t) => t.id);
  let indice: number;
  if (anteriorId != null && ids.includes(anteriorId)) indice = ids.indexOf(anteriorId) + 1;
  else if (siguienteId != null && ids.includes(siguienteId)) indice = ids.indexOf(siguienteId);
  else indice = columna.length;

  const antes = indice > 0 ? columna[indice - 1] : null;
  const despues = indice < columna.length ? columna[indice] : null;
  const posAntes = antes?.posicion ?? null;
  const posDespues = despues?.posicion ?? null;

  const sinColocar = (antes != null && posAntes == null) || (despues != null && posDespues == null);
  if (!sinColocar) {
    const nueva = posicionEntre(posAntes, posDespues);
    if (hayHueco(posAntes, posDespues, nueva)) return { posicion: nueva, otras: [] };
  }

  const orden = [...ids.slice(0, indice), tareaId, ...ids.slice(indice)];
  const posiciones = posicionesRenumeradas(orden.length);
  const otras: Array<[number, number]> = [];
  orden.forEach((id, i) => { if (id !== tareaId) otras.push([id, posiciones[i]]); });
  return { posicion: posiciones[indice], otras };
}
