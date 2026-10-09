/*
 * Limite de intentos en memoria del proceso (ventana deslizante). Equivale al
 * "5 per minute" de Flask-Limiter con almacenamiento en memoria: con varios
 * procesos cada uno cuenta lo suyo. Para mas de una instancia hay que moverlo
 * a Redis, igual que en Flask.
 *
 * Las claves llevan el correo que escribe quien intenta entrar: sin barrido,
 * un bucle con correos inventados hacia crecer el mapa sin fin. Cada cierto
 * numero de llamadas se tiran las ventanas ya vencidas.
 */
type Ventana = { marcas: number[]; ms: number };
const ventanas = new Map<string, Ventana>();
const BARRER_CADA = 500;
let llamadas = 0;

function barrer(ahora: number) {
  for (const [clave, v] of ventanas) {
    if (!v.marcas.length || ahora - v.marcas[v.marcas.length - 1] >= v.ms) ventanas.delete(clave);
  }
}

export function permitir(clave: string, max: number, ventanaMs: number): boolean {
  const ahora = Date.now();
  if (++llamadas % BARRER_CADA === 0) barrer(ahora);
  const marcas = (ventanas.get(clave)?.marcas ?? []).filter((t) => ahora - t < ventanaMs);
  if (marcas.length >= max) {
    ventanas.set(clave, { marcas, ms: ventanaMs });
    return false;
  }
  marcas.push(ahora);
  ventanas.set(clave, { marcas, ms: ventanaMs });
  return true;
}

/* Para las pruebas. */
export function clavesEnMemoria() {
  return ventanas.size;
}
