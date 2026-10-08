/*
 * Limite de intentos en memoria del proceso (ventana deslizante). Equivale al
 * "5 per minute" de Flask-Limiter con almacenamiento en memoria: con varios
 * procesos cada uno cuenta lo suyo. Para mas de una instancia hay que moverlo
 * a Redis, igual que en Flask.
 */
const ventanas = new Map<string, number[]>();

export function permitir(clave: string, max: number, ventanaMs: number): boolean {
  const ahora = Date.now();
  const lista = (ventanas.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
  if (lista.length >= max) {
    ventanas.set(clave, lista);
    return false;
  }
  lista.push(ahora);
  ventanas.set(clave, lista);
  return true;
}
