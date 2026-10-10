import { hoyNegocio, ZONA_NEGOCIO } from "@/lib/reloj";

/*
 * Formatos de fecha para el cliente, siempre en la zona de negocio (Santo
 * Domingo), nunca en la del navegador. Las fecha-hora llegan como ISO UTC;
 * las de solo dia como YYYY-MM-DD.
 */
const diaZona = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_NEGOCIO });
const horaZona = new Intl.DateTimeFormat("es-DO", { timeZone: ZONA_NEGOCIO, hour: "2-digit", minute: "2-digit", hour12: false });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function diaDe(iso: string) { return diaZona.format(new Date(iso)); }

function restarDias(dia: string, n: number) {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/* "12 oct" desde YYYY-MM-DD. */
export function diaCorto(dia: string) {
  const [, m, d] = dia.split("-");
  return `${d} ${MESES[Number(m) - 1]}`;
}

/* Momento corto para columnas: "14:32" hoy, "ayer 14:32", "12 oct 14:32". */
export function momentoCorto(iso: string, hoy = hoyNegocio()) {
  const dia = diaDe(iso);
  const hora = horaZona.format(new Date(iso));
  if (dia === hoy) return hora;
  if (dia === restarDias(hoy, 1)) return `ayer ${hora}`;
  return `${diaCorto(dia)} ${hora}`;
}

/* Relativo para la campana: "ahora", "hace 5 min", "hace 3 h", y despues el momento corto. */
export function haceCuanto(iso: string, ahora = Date.now()) {
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 6 * 3600) return `hace ${Math.floor(s / 3600)} h`;
  return momentoCorto(iso);
}

/* Entrega de un dia de negocio respecto a hoy. */
export function entregaRelativa(dia: string, hoy = hoyNegocio()): { texto: string; tono: "alerta" | "aviso" | "neutro" } {
  if (!dia) return { texto: "Sin fecha", tono: "neutro" };
  if (dia < hoy) return { texto: diaCorto(dia), tono: "alerta" };
  if (dia === hoy) return { texto: "Hoy", tono: "aviso" };
  return { texto: diaCorto(dia), tono: "neutro" };
}
