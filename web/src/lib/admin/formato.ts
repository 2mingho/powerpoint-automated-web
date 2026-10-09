import { ZONA_NEGOCIO } from "@/lib/reloj";

/* Formatos de presentacion (cliente y servidor). Fechas y horas siempre en la zona de negocio. */

const fechaHora = new Intl.DateTimeFormat("es-DO", { timeZone: ZONA_NEGOCIO, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const soloFecha = new Intl.DateTimeFormat("es-DO", { timeZone: ZONA_NEGOCIO, day: "2-digit", month: "short", year: "numeric" });

function partes(f: Intl.DateTimeFormat, iso: string) {
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { ...p, month: (p.month ?? "").replace(".", "") } as Record<string, string>;
}
/* "08 oct 14:56" */
export function fFechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = partes(fechaHora, iso);
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
}
/* "08 oct 2026" */
export function fFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = partes(soloFecha, iso);
  return `${p.day} ${p.month} ${p.year}`;
}
/* Dia de negocio YYYY-MM-DD como "08 oct". */
export function fDia(iso: string): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  return `${d} ${meses[Number(m) - 1]}`;
}
export function fBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export const fEntero = (n: number) => new Intl.NumberFormat("es-DO").format(n);
export const fUsd = (n: number) => `US$ ${n < 1 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
export function fCompacto(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} k`;
  return fEntero(n);
}
