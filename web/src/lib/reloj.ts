/*
 * Zona de negocio: Santo Domingo (UTC-4, sin horario de verano). "Hoy" lo fija
 * esta zona, nunca el reloj del navegador ni el del servidor, para que nadie
 * vea las vencidas desplazadas por estar en otro huso.
 *
 * Las columnas de fecha-hora se guardan en UTC sin zona (como hacia Flask con
 * utcnow); las de solo fecha (due_date) son dias de negocio.
 */
export const ZONA_NEGOCIO = "America/Santo_Domingo";

export function hoyNegocio(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_NEGOCIO }).format(ahora);
}

/* Fecha ISO (YYYY-MM-DD) desde un Date de columna @db.Date, sin desplazarla de dia. */
export function isoDeFecha(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function fechaDeIso(iso: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00.000Z`) : null;
}
