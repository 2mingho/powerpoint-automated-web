/*
 * Rutas internas seguras para redirigir o navegar (destino del login, enlaces
 * de notificaciones). "Empieza por / y no por //" no basta: el navegador trata
 * "/\evil.com" como "//evil.com", y descarta tabuladores y saltos de linea
 * ("/\t/evil.com"). Se resuelve contra un origen ficticio y solo se acepta si
 * sigue en ese origen; lo que sale es ruta + busqueda + ancla ya normalizadas.
 */
const ORIGEN = "http://interno.invalid";

export function rutaInterna(destino: unknown): string | null {
  if (typeof destino !== "string" || !destino.startsWith("/")) return null;
  // Barras invertidas y caracteres de control nunca forman parte de una ruta propia.
  if (/[\\\u0000-\u001f\u007f]/.test(destino)) return null;
  let url: URL;
  try {
    url = new URL(destino, ORIGEN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGEN) return null;
  const ruta = `${url.pathname}${url.search}${url.hash}`;
  return ruta.startsWith("//") ? null : ruta;
}
