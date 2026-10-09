/*
 * Donde se pone la ficha flotante de un cliente (logica pura). A la derecha del
 * nombre; si no cabe, a la izquierda; y si tampoco, pegada al borde. En vertical
 * se alinea con el nombre y se corre lo justo para no salirse de la ventana.
 */
export type Caja = { left: number; top: number; right: number; bottom: number };
export type Tam = { w: number; h: number };

export const MARGEN_VENTANA = 8;
export const SEPARACION = 8;

export function posicionarFicha(ancla: Caja, ficha: Tam, ventana: Tam): { left: number; top: number } {
  const m = MARGEN_VENTANA;
  let left = ancla.right + SEPARACION;
  if (left + ficha.w > ventana.w - m) left = ancla.left - SEPARACION - ficha.w;
  left = Math.max(m, Math.min(left, ventana.w - m - ficha.w));
  let top = ancla.top;
  if (top + ficha.h > ventana.h - m) top = ventana.h - m - ficha.h;
  top = Math.max(m, top);
  return { left, top };
}
