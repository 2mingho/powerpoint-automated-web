/*
 * Filtros cruzados del Inicio, estilo Power BI (logica pura). Portado de
 * hPass del MVP: cada grafico filtra a los demas pero no a si mismo, por eso
 * `omitir` salta la dimension que se esta pintando.
 *
 * La visibilidad (quien puede ver la tarea) NO se decide aqui: las tareas que
 * llegan ya pasaron por filtroTareasVisibles en el servidor.
 */
import { lunesDe } from "@/lib/tareas/fechas";
import { riesgoDe, type Riesgo, type TareaSeg } from "./riesgo";

export type Dimension = "unidad" | "cliente" | "persona" | "tipo" | "contrato" | "semana" | "estado";

export type FiltrosCruzados = {
  /* Rango de entrega, ambos extremos incluidos; "" deja el extremo abierto. */
  desde: string;
  hasta: string;
  unidad: string;
  cliente: string;
  persona: string;
  tipo: string;
  contrato: string;
  /* Lunes de la semana de entrega. */
  semana: string;
  /* Un estado, "vencida" para el riesgo o "abierta" para todo lo no hecho. */
  estado: string;
};

export type TareaFiltrable = TareaSeg & {
  unidad: string;
  cliente: string;
  persona: string;
  tipo: string;
  contrato: string;
  /*
   * Riesgo ya calculado. Las celdas del panel agrupan muchas tareas con la misma combinacion y el riesgo
   * (que depende de la fecha exacta y de los pasos) se resuelve antes de agruparlas; sin este campo se
   * calcula con riesgoDe.
   */
  riesgo?: Riesgo;
};

/* El riesgo de la fila: el precalculado si lo trae y, si no, el que sale de sus datos. */
export function riesgoEfectivo(t: TareaFiltrable, hoy: string): Riesgo {
  return t.riesgo ?? riesgoDe(t, hoy);
}

export const SIN_FILTROS: FiltrosCruzados = { desde: "", hasta: "", unidad: "", cliente: "", persona: "", tipo: "", contrato: "", semana: "", estado: "" };

export function pasaFiltros(t: TareaFiltrable, f: FiltrosCruzados, hoy: string, omitir?: Dimension): boolean {
  if (f.desde && (!t.entrega || t.entrega < f.desde)) return false;
  if (f.hasta && (!t.entrega || t.entrega > f.hasta)) return false;
  if (omitir !== "unidad" && f.unidad && t.unidad !== f.unidad) return false;
  if (omitir !== "cliente" && f.cliente && t.cliente !== f.cliente) return false;
  if (omitir !== "persona" && f.persona && t.persona !== f.persona) return false;
  if (omitir !== "tipo" && f.tipo && t.tipo !== f.tipo) return false;
  if (omitir !== "contrato" && f.contrato && t.contrato !== f.contrato) return false;
  if (omitir !== "semana" && f.semana && (!t.entrega || lunesDe(t.entrega) !== f.semana)) return false;
  if (omitir !== "estado" && f.estado) {
    if (f.estado === "vencida" ? riesgoEfectivo(t, hoy) !== "vencida" : f.estado === "abierta" ? t.estado === "hecha" : t.estado !== f.estado) return false;
  }
  return true;
}

/* Pulsar un valor lo activa; pulsar el activo lo quita (alternar). */
export function alternar(f: FiltrosCruzados, dim: keyof Omit<FiltrosCruzados, "desde" | "hasta">, valor: string): FiltrosCruzados {
  return { ...f, [dim]: f[dim] === valor ? "" : valor };
}
