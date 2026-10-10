import { ZONA_NEGOCIO } from "@/lib/reloj";
import { diasEntre, lunesDe, sumarDias } from "@/lib/tareas/fechas";
import type { EstadoCatalogo, Filtros, TareaDTO } from "@/lib/tareas/tipos";
import type { Tono } from "@/components/ui/estado";
import { irAlLogin } from "@/components/ui/sesion";

/* Utilidades del lado del navegador: peticiones JSON y formatos de fecha. */

export class ErrorPeticion extends Error {
  constructor(public status: number, mensaje: string, public datos: Record<string, unknown> = {}) { super(mensaje); }
}

export async function pedir<T>(url: string, opts: { metodo?: string; cuerpo?: unknown; form?: FormData; senal?: AbortSignal } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: opts.metodo ?? (opts.cuerpo !== undefined || opts.form ? "POST" : "GET"),
      headers: opts.form ? undefined : opts.cuerpo !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.form ?? (opts.cuerpo !== undefined ? JSON.stringify(opts.cuerpo) : undefined),
      signal: opts.senal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ErrorPeticion(0, "Sin conexión. Comprueba la red y vuelve a intentarlo.");
  }
  if (r.status === 401) irAlLogin();
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const mensaje = typeof datos.error === "string" ? datos.error
      : r.status === 429 ? "Demasiadas peticiones seguidas. Espera unos segundos."
      : "No se pudo completar. Intenta de nuevo.";
    throw new ErrorPeticion(r.status, mensaje, datos);
  }
  return datos as T;
}

export function consultaDeFiltros(f: Filtros, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, v);
  return p.toString();
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/* "08 OCT" para la columna ENTREGA. */
export function fechaCorta(iso: string) {
  if (!iso) return "";
  return `${iso.slice(8, 10)} ${MESES[Number(iso.slice(5, 7)) - 1]}`;
}

export function diaDeSemana(iso: string) {
  return DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

/* Relativo al hoy de negocio: "hoy", "mañana", "hace 3 d", "en 5 d". */
export function relativo(iso: string, hoy: string) {
  if (!iso) return "";
  const d = diasEntre(hoy, iso);
  if (d === 0) return "hoy";
  if (d === 1) return "mañana";
  if (d === -1) return "ayer";
  if (d < 0) return `hace ${-d} d`;
  if (d < 7) return diaDeSemana(iso);
  return `en ${d} d`;
}

/* Fecha y hora de una columna UTC, en la zona de negocio. */
export function momento(isoUtc: string) {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  const f = new Intl.DateTimeFormat("es-DO", { timeZone: ZONA_NEGOCIO, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return f.format(d).replace(",", "");
}

export function haceCuanto(isoUtc: string) {
  const min = Math.round((Date.now() - new Date(isoUtc).getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export type Grupo = "vencidas" | "hoy" | "semana" | "despues" | "completadas";
export const GRUPOS: Array<{ clave: Grupo; rotulo: string }> = [
  { clave: "vencidas", rotulo: "Vencidas" },
  { clave: "hoy", rotulo: "Hoy" },
  { clave: "semana", rotulo: "Esta semana" },
  { clave: "despues", rotulo: "Más adelante" },
  { clave: "completadas", rotulo: "Completadas" },
];

export function grupoDe(t: TareaDTO, hoy: string, esFinal: (e: string) => boolean): Grupo {
  if (esFinal(t.estado)) return "completadas";
  if (t.entrega < hoy) return "vencidas";
  if (t.entrega === hoy) return "hoy";
  if (t.entrega <= sumarDias(lunesDe(hoy), 6)) return "semana";
  return "despues";
}

export function tonoEstado(estados: EstadoCatalogo[], nombre: string): Tono {
  return estados.find((e) => e.nombre === nombre)?.color ?? "neutro";
}

/* Orden del panel: entrega, prioridad (de mayor a menor) y titulo. */
export function ordenarTareas(lista: TareaDTO[], prioridades: string[]) {
  const orden = new Map(prioridades.map((p, i) => [p, i]));
  return [...lista].sort((a, b) =>
    a.entrega !== b.entrega ? (a.entrega < b.entrega ? -1 : 1)
      : (orden.get(a.prioridad) ?? 99) - (orden.get(b.prioridad) ?? 99) || a.titulo.localeCompare(b.titulo, "es"));
}

export function iniciales(nombre: string) {
  const partes = nombre.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}
