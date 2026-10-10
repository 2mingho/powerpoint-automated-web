/*
 * Riesgo, puntualidad y carga de trabajo (logica pura, sin base ni reloj).
 * Portado del MVP de seguimiento: risk, onTimeRate, loadByWeek y lvl.
 *
 * Todo parte de un "hoy" que pasa quien llama (hoyNegocio()), y las fechas son
 * dias de negocio YYYY-MM-DD. Los estados se reducen a cinco con `EstadoSeg`;
 * la traduccion desde los nombres del catalogo vive en quien consulta la base.
 */
import { esFinDeSemana, sumarDias } from "@/lib/tareas/fechas";

export type EstadoSeg = "pendiente" | "en_curso" | "bloqueada" | "revision" | "hecha";
export type Riesgo = "" | "vencida" | "bloqueada" | "en_riesgo";

export type TareaSeg = {
  estado: EstadoSeg;
  /* Entrega (fecha limite); sin ella no hay riesgo ni carga. */
  entrega: string | null;
  /* Primer dia de trabajo; si falta se deduce de las horas (ver inicioDe). */
  inicio?: string | null;
  horas: number;
  /* Pasos hijos: terminados / total. Sin pasos, la tarea hecha vale 1 y el resto 0. */
  pasosHechos?: number;
  pasosTotal?: number;
  /* Fecha en que se marco hecha. */
  hechaEl?: string | null;
  esEntrega?: boolean;
};

/* Dias habiles (lunes a viernes) del rango cerrado [desde, hasta]. */
export function habilesEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let d = desde;
  // Tope: un rango de anos no debe colgar el proceso.
  for (let i = 0; d <= hasta && i < 400; i++) {
    if (!esFinDeSemana(d)) out.push(d);
    d = sumarDias(d, 1);
  }
  return out;
}

/*
 * Suma `n` dias habiles (negativo retrocede). Si `desde` cae en fin de semana
 * primero se corre al habil mas cercano en esa direccion: es el addBiz del MVP.
 */
export function sumarHabiles(desde: string, n: number): string {
  const paso = n < 0 ? -1 : 1;
  let d = desde;
  while (esFinDeSemana(d)) d = sumarDias(d, paso);
  let faltan = Math.abs(n);
  while (faltan > 0) {
    d = sumarDias(d, paso);
    if (!esFinDeSemana(d)) faltan--;
  }
  return d;
}

/* Un dia de trabajo rinde 6 horas: las tareas largas empiezan antes de la entrega. */
export const HORAS_POR_DIA = 6;

export function inicioDe(t: Pick<TareaSeg, "entrega" | "inicio" | "horas">): string | null {
  if (t.inicio) return t.inicio;
  if (!t.entrega) return null;
  return sumarHabiles(t.entrega, -Math.max(0, Math.ceil(t.horas / HORAS_POR_DIA) - 1));
}

/* Avance 0..1 por pasos hijos; sin pasos, hecha=1 y lo demas 0. */
export function avance(t: Pick<TareaSeg, "estado" | "pasosHechos" | "pasosTotal">): number {
  if (t.pasosTotal && t.pasosTotal > 0) return Math.min(1, (t.pasosHechos ?? 0) / t.pasosTotal);
  return t.estado === "hecha" ? 1 : 0;
}

/*
 * vencida: la entrega ya paso. bloqueada: bloqueo declarado. en_riesgo: quedan
 * dos dias habiles o menos (contando hoy) y la tarea no ha arrancado o va por
 * debajo de la mitad. Una tarea hecha, o sin entrega, no tiene riesgo.
 */
export function riesgoDe(t: TareaSeg, hoy: string): Riesgo {
  if (t.estado === "hecha" || !t.entrega) return "";
  if (t.entrega < hoy) return "vencida";
  if (t.estado === "bloqueada") return "bloqueada";
  const quedan = habilesEntre(hoy, t.entrega).length;
  if (quedan <= 2 && (t.estado === "pendiente" || avance(t) < 0.5)) return "en_riesgo";
  return "";
}

/*
 * % de entregas al cliente cerradas en los ultimos 30 dias que llegaron a
 * tiempo. null si no hubo ninguna: no se inventa un 100 %.
 */
export function puntualidad(tareas: TareaSeg[], hoy: string): number | null {
  const desde = sumarDias(hoy, -30);
  const hechas = tareas.filter((t) => t.esEntrega && t.estado === "hecha" && t.hechaEl && t.entrega && t.hechaEl >= desde);
  if (!hechas.length) return null;
  const aTiempo = hechas.filter((t) => t.hechaEl! <= t.entrega!).length;
  return Math.round((100 * aTiempo) / hechas.length);
}

/*
 * Horas que una tarea abierta aporta a cada semana (sin redondear). Las horas
 * pendientes (las totales menos lo avanzado) se reparten parejas entre los dias
 * habiles desde el inicio (o hoy, si ya arranco) hasta la entrega; una vencida
 * o sin dias habiles carga su resto en hoy. `semanas` son lunes; lo que cae
 * fuera de ellas se ignora. Hecha o sin entrega no aporta nada.
 */
export function repartoSemanal(t: TareaSeg, semanas: string[], hoy: string): number[] {
  const out = semanas.map(() => 0);
  if (t.estado === "hecha" || !t.entrega) return out;
  const resto = t.horas * (1 - avance(t));
  const inicio = inicioDe(t)!;
  let dias = habilesEntre(inicio > hoy ? inicio : hoy, t.entrega >= hoy ? t.entrega : hoy);
  if (!dias.length) dias = [hoy];
  const porDia = resto / dias.length;
  for (const d of dias) {
    const i = semanas.findIndex((w) => d >= w && d <= sumarDias(w, 6));
    if (i >= 0) out[i] += porDia;
  }
  return out;
}

/* Horas abiertas de una persona por semana, redondeadas (ver repartoSemanal). */
export function cargaPorSemana(tareas: TareaSeg[], semanas: string[], hoy: string): number[] {
  const out = semanas.map(() => 0);
  for (const t of tareas) repartoSemanal(t, semanas, hoy).forEach((h, i) => { out[i] += h; });
  return out.map((x) => Math.round(x));
}

/*
 * Nivel de calor 0..4 de una razon carga/capacidad: <40 % libre, <75 % comodo,
 * <95 % lleno, hasta 110 % al limite, mas es sobrecarga.
 */
export function nivelDeCarga(razon: number): 0 | 1 | 2 | 3 | 4 {
  if (razon < 0.4) return 0;
  if (razon < 0.75) return 1;
  if (razon < 0.95) return 2;
  if (razon <= 1.1) return 3;
  return 4;
}
