import { pbkdf2Sync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/*
 * Compatibilidad con los hashes de werkzeug que ya hay en la base:
 *
 *   scrypt:32768:8:1$<sal>$<hex>
 *   pbkdf2:sha256:600000$<sal>$<hex>
 *
 * La sal es texto, no bytes decodificados: werkzeug la pasa tal cual en UTF-8.
 * Nadie tiene que restablecer su contrasena por la reescritura.
 */

function comparar(hexEsperado: string, calculado: Buffer) {
  const esperado = Buffer.from(hexEsperado, "hex");
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

export function verificarContrasena(hash: string, contrasena: string): boolean {
  const [metodo, sal, hex] = hash.split("$");
  if (!metodo || !sal || !hex) return false;
  const partes = metodo.split(":");

  try {
    if (partes[0] === "scrypt") {
      const N = Number(partes[1] ?? 32768);
      const r = Number(partes[2] ?? 8);
      const p = Number(partes[3] ?? 1);
      const clave = scryptSync(contrasena, sal, 64, { N, r, p, maxmem: 132 * N * r * p });
      return comparar(hex, clave);
    }
    if (partes[0] === "pbkdf2") {
      const digest = partes[1] ?? "sha256";
      const iteraciones = Number(partes[2] ?? 600000);
      const longitud = digest === "sha512" ? 64 : digest === "sha1" ? 20 : 32;
      const clave = pbkdf2Sync(contrasena, sal, iteraciones, longitud, digest);
      return comparar(hex, clave);
    }
  } catch {
    return false;
  }
  return false;
}

/* Mismo formato que werkzeug, para que la app Flask siga aceptandolos mientras conviven. */
export function generarHash(contrasena: string): string {
  const N = 32768, r = 8, p = 1;
  const sal = randomBytes(12).toString("base64url").slice(0, 16);
  const clave = scryptSync(contrasena, sal, 64, { N, r, p, maxmem: 132 * N * r * p });
  return `scrypt:${N}:${r}:${p}$${sal}$${clave.toString("hex")}`;
}
