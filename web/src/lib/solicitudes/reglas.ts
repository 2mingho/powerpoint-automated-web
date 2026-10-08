/*
 * Reglas puras de las solicitudes entre unidades (blueprints/task_requests.py).
 * Sin base ni sesion: lo que se puede probar con Vitest sin montar nada.
 */
import type { Tono } from "@/lib/catalogo";

export const ESTADOS_SOLICITUD = ["Pendiente", "Aceptada", "Rechazada", "Cancelada"] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

export const TONO_ESTADO: Record<EstadoSolicitud, Tono> = {
  Pendiente: "aviso",
  Aceptada: "bien",
  Rechazada: "alerta",
  Cancelada: "neutro",
};

export const BANDEJAS = ["recibidas", "enviadas", "historial"] as const;
export type Bandeja = (typeof BANDEJAS)[number];

export function esBandeja(v: unknown): v is Bandeja {
  return typeof v === "string" && (BANDEJAS as readonly string[]).includes(v);
}

/* Lo resuelto deja la bandeja de trabajo pasados estos dias y queda en Historial. */
export const DIAS_EN_BANDEJA = 14;

/* Resuelta hace mas de DIAS_EN_BANDEJA: ya solo vive en Historial. */
export function salioDeLaBandeja(resuelta: string | null, ahora = Date.now()) {
  return !!resuelta && ahora - new Date(resuelta).getTime() > DIAS_EN_BANDEJA * 86_400_000;
}

export const MIN_MOTIVO = 5;
export const MAX_TITULO = 255;
export const MAX_CLIENTE = 100;

export type DatosNuevaSolicitud = {
  titulo: string;
  unidadDestinoId: number;
  prioridad: string | null;
  entrega: string | null;
  descripcion: string;
  cliente: string;
};

/* Valida la forma del cuerpo; lo que depende de la base (unidad, prioridad) se comprueba despues. */
export function leerNuevaSolicitud(c: Record<string, unknown>): { ok: true; datos: DatosNuevaSolicitud } | { ok: false; error: string } {
  const titulo = typeof c.titulo === "string" ? c.titulo.trim() : "";
  if (!titulo) return { ok: false, error: "El título es obligatorio." };
  if (titulo.length > MAX_TITULO) return { ok: false, error: `El título no puede pasar de ${MAX_TITULO} caracteres.` };

  const unidad = Number(c.unidadDestinoId);
  if (!Number.isInteger(unidad) || unidad <= 0) return { ok: false, error: "Elige la unidad destino." };

  const entrega = typeof c.entrega === "string" && c.entrega.trim() ? c.entrega.trim() : null;
  if (entrega && !esFechaIso(entrega)) return { ok: false, error: "Fecha de entrega no válida." };

  const cliente = typeof c.cliente === "string" ? c.cliente.trim() : "";
  if (cliente.length > MAX_CLIENTE) return { ok: false, error: `El cliente no puede pasar de ${MAX_CLIENTE} caracteres.` };

  return {
    ok: true,
    datos: {
      titulo,
      unidadDestinoId: unidad,
      prioridad: typeof c.prioridad === "string" && c.prioridad.trim() ? c.prioridad.trim() : null,
      entrega,
      descripcion: typeof c.descripcion === "string" ? c.descripcion.trim() : "",
      cliente,
    },
  };
}

export function esFechaIso(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function leerMotivo(c: Record<string, unknown>): { ok: true; motivo: string } | { ok: false; error: string } {
  const motivo = typeof c.motivo === "string" ? c.motivo.trim() : "";
  if (motivo.length < MIN_MOTIVO) return { ok: false, error: `Escribe el motivo (mínimo ${MIN_MOTIVO} caracteres).` };
  return { ok: true, motivo };
}

/* Orden de una bandeja: lo pendiente arriba por entrega (sin fecha al final), lo resuelto debajo, lo ultimo primero. */
export type Ordenable = { estado: string; entrega: string; enviada: string; resuelta: string | null };
export function ordenarBandeja<T extends Ordenable>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    const pa = a.estado === "Pendiente" ? 0 : 1;
    const pb = b.estado === "Pendiente" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0) {
      if (a.entrega !== b.entrega) {
        if (!a.entrega) return 1;
        if (!b.entrega) return -1;
        return a.entrega < b.entrega ? -1 : 1;
      }
      return a.enviada < b.enviada ? 1 : -1;
    }
    const ra = a.resuelta ?? a.enviada;
    const rb = b.resuelta ?? b.enviada;
    return ra < rb ? 1 : ra > rb ? -1 : 0;
  });
}

/*
 * Enlaces de notificaciones guardadas por Flask mientras conviven las dos
 * apps: se traducen a las rutas nuevas al pintarlas.
 */
export function enlaceNuevo(enlace: string | null | undefined): string | null {
  if (!enlace) return null;
  const tarea = /^\/tasks\?task=(\d+)/.exec(enlace);
  if (tarea) return `/tareas?tarea=${tarea[1]}`;
  if (enlace === "/task-requests" || enlace.startsWith("/task-requests?")) return "/solicitudes";
  if (enlace === "/tasks" || enlace.startsWith("/tasks?")) return "/tareas";
  if (!enlace.startsWith("/") || enlace.startsWith("//")) return null;
  return enlace;
}
