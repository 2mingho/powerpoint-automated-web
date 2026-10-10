import { hoyNegocio, isoDeFecha } from "@/lib/reloj";

/*
 * Agregados del panel de equipo. Logica pura sobre filas ya filtradas por
 * alcance: aqui no se decide quien ve que, solo se cuenta.
 *
 * "Completada" no es un nombre sino un estado con es_final. Como en Flask, no
 * hay columna completed_at: se toma updated_at de una tarea en estado final.
 * Se desvia solo si alguien edita una tarea cerrada hace tiempo, e infla el
 * numero, nunca lo reduce.
 */

export type TareaPanel = {
  id: number;
  estado: string;
  vence: string; // YYYY-MM-DD (dia de negocio)
  creada: Date | null; // UTC
  actualizada: Date | null; // UTC
  asignadoId: number;
  unidadId: number | null;
};

export type Contadores = { abiertas: number; vencidas: number; completadasSemana: number; enRiesgo: number };

const DIA = 86_400_000;

export function sumarDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
}

/* Lunes de la semana del dia dado (ISO, lunes = inicio). */
export function lunesDe(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return sumarDias(iso, -dow);
}

/* Dia de negocio de una marca UTC sin zona. */
export function diaNegocio(d: Date | null): string | null {
  return d ? hoyNegocio(d) : null;
}

/* En riesgo: abierta, no vencida y vence hoy o en los dos dias siguientes. */
export const DIAS_RIESGO = 2;

export function clasificar(t: Pick<TareaPanel, "estado" | "vence" | "actualizada">, finales: Set<string>, hoy: string) {
  const abierta = !finales.has(t.estado);
  const vencida = abierta && t.vence < hoy;
  const enRiesgo = abierta && !vencida && t.vence <= sumarDias(hoy, DIAS_RIESGO);
  const completadaSemana = !abierta && (diaNegocio(t.actualizada) ?? "") >= lunesDe(hoy);
  return { abierta, vencida, enRiesgo, completadaSemana };
}

export function contadores(tareas: TareaPanel[], finales: Set<string>, hoy: string): Contadores {
  const c: Contadores = { abiertas: 0, vencidas: 0, completadasSemana: 0, enRiesgo: 0 };
  for (const t of tareas) {
    const k = clasificar(t, finales, hoy);
    if (k.abierta) c.abiertas++;
    if (k.vencida) c.vencidas++;
    if (k.enRiesgo) c.enRiesgo++;
    if (k.completadaSemana) c.completadasSemana++;
  }
  return c;
}

/*
 * Las mismas cifras, pero a partir de CONTEOS que ya hizo la base (groupBy), no de cada tarea. Con decenas
 * de miles de tareas, traerlas todas solo para contarlas era lo mas caro de Equipo; esto viaja en
 * unas decenas de filas. Las funciones de arriba siguen definiendo la semantica y la prueba
 * (agregados.test.ts) comprueba que ambos caminos dan lo mismo.
 */
export type ConteoCarga = { personaId: number; estado: string; n: number };
export type ConteoUnidad = { unidadId: number; abiertas: number; vencidas: number };

export function cargaDesdeConteos(
  abiertas: ConteoCarga[],
  vencidasPorPersona: Map<number, number>,
  ordenEstados: string[],
  nombres: Map<number, string>,
): FilaCarga[] {
  const porPersona = new Map<number, Map<string, number>>();
  for (const c of abiertas) {
    if (c.n <= 0) continue;
    const m = porPersona.get(c.personaId) ?? new Map<string, number>();
    m.set(c.estado, (m.get(c.estado) ?? 0) + c.n);
    porPersona.set(c.personaId, m);
  }
  const rango = (e: string) => { const i = ordenEstados.indexOf(e); return i < 0 ? ordenEstados.length : i; };
  return [...porPersona.entries()]
    .map(([personaId, m]) => {
      const segmentos = [...m.entries()].map(([estado, n]) => ({ estado, n })).sort((a, b) => rango(a.estado) - rango(b.estado) || a.estado.localeCompare(b.estado));
      return {
        personaId,
        nombre: nombres.get(personaId) ?? `#${personaId}`,
        total: segmentos.reduce((s, x) => s + x.n, 0),
        vencidas: vencidasPorPersona.get(personaId) ?? 0,
        segmentos,
      };
    })
    .sort((a, b) => b.total - a.total || b.vencidas - a.vencidas || a.nombre.localeCompare(b.nombre, "es"));
}

export function vencidasPorUnidadDesdeConteos(conteos: ConteoUnidad[], unidades: { id: number; nombre: string }[]): FilaUnidad[] {
  const filas = new Map(unidades.map((u) => [u.id, { unidadId: u.id, nombre: u.nombre, vencidas: 0, abiertas: 0 }]));
  for (const c of conteos) {
    const f = filas.get(c.unidadId);
    if (!f) continue; // unidades ajenas al alcance elegido
    f.abiertas += c.abiertas;
    f.vencidas += c.vencidas;
  }
  return [...filas.values()].sort((a, b) => b.vencidas - a.vencidas || b.abiertas - a.abiertas || a.nombre.localeCompare(b.nombre, "es"));
}

/*
 * Tendencia a partir de los conteos por semana que ya hizo la base (lunes -> cuantas): se queda con las
 * `semanas` ultimas, la actual incluida, de la mas antigua a la actual; lo que cae fuera se ignora.
 */
export function tendenciaDesdeSemanas(creadas: ReadonlyMap<string, number>, completadas: ReadonlyMap<string, number>, hoy: string, semanas = 8): PuntoTendencia[] {
  const actual = lunesDe(hoy);
  const puntos: PuntoTendencia[] = [];
  for (let i = semanas - 1; i >= 0; i--) {
    const semana = sumarDias(actual, -7 * i);
    puntos.push({ semana, creadas: creadas.get(semana) ?? 0, completadas: completadas.get(semana) ?? 0 });
  }
  return puntos;
}

export type FilaCarga = {
  personaId: number;
  nombre: string;
  total: number;
  vencidas: number;
  segmentos: { estado: string; n: number }[];
};

/* Tareas abiertas por persona, apiladas por estado en el orden del catalogo. */
export function cargaPorPersona(
  tareas: TareaPanel[],
  finales: Set<string>,
  hoy: string,
  ordenEstados: string[],
  nombres: Map<number, string>,
): FilaCarga[] {
  const porPersona = new Map<number, Map<string, number>>();
  const vencidas = new Map<number, number>();
  for (const t of tareas) {
    const k = clasificar(t, finales, hoy);
    if (!k.abierta) continue;
    const m = porPersona.get(t.asignadoId) ?? new Map<string, number>();
    m.set(t.estado, (m.get(t.estado) ?? 0) + 1);
    porPersona.set(t.asignadoId, m);
    if (k.vencida) vencidas.set(t.asignadoId, (vencidas.get(t.asignadoId) ?? 0) + 1);
  }
  const rango = (e: string) => { const i = ordenEstados.indexOf(e); return i < 0 ? ordenEstados.length : i; };
  return [...porPersona.entries()]
    .map(([personaId, m]) => {
      const segmentos = [...m.entries()].map(([estado, n]) => ({ estado, n })).sort((a, b) => rango(a.estado) - rango(b.estado) || a.estado.localeCompare(b.estado));
      return {
        personaId,
        nombre: nombres.get(personaId) ?? `#${personaId}`,
        total: segmentos.reduce((s, x) => s + x.n, 0),
        vencidas: vencidas.get(personaId) ?? 0,
        segmentos,
      };
    })
    .sort((a, b) => b.total - a.total || b.vencidas - a.vencidas || a.nombre.localeCompare(b.nombre, "es"));
}

export type PuntoTendencia = { semana: string; creadas: number; completadas: number };

/* Ultimas `semanas` semanas (la actual incluida), de la mas antigua a la actual. */
export function tendencia(tareas: TareaPanel[], finales: Set<string>, hoy: string, semanas = 8): PuntoTendencia[] {
  const actual = lunesDe(hoy);
  const puntos: PuntoTendencia[] = [];
  for (let i = semanas - 1; i >= 0; i--) puntos.push({ semana: sumarDias(actual, -7 * i), creadas: 0, completadas: 0 });
  const indice = new Map(puntos.map((p, i) => [p.semana, i]));
  for (const t of tareas) {
    const dc = diaNegocio(t.creada);
    if (dc) {
      const i = indice.get(lunesDe(dc));
      if (i != null) puntos[i].creadas++;
    }
    if (finales.has(t.estado)) {
      const dd = diaNegocio(t.actualizada);
      if (dd) {
        const i = indice.get(lunesDe(dd));
        if (i != null) puntos[i].completadas++;
      }
    }
  }
  return puntos;
}

export type FilaUnidad = { unidadId: number; nombre: string; vencidas: number; abiertas: number };

/* Vencidas por unidad; incluye las unidades del alcance con cero para que el reparto se lea completo. */
export function vencidasPorUnidad(
  tareas: TareaPanel[],
  finales: Set<string>,
  hoy: string,
  unidades: { id: number; nombre: string }[],
): FilaUnidad[] {
  const filas = new Map(unidades.map((u) => [u.id, { unidadId: u.id, nombre: u.nombre, vencidas: 0, abiertas: 0 }]));
  for (const t of tareas) {
    if (t.unidadId == null) continue;
    const f = filas.get(t.unidadId);
    if (!f) continue;
    const k = clasificar(t, finales, hoy);
    if (k.abierta) f.abiertas++;
    if (k.vencida) f.vencidas++;
  }
  return [...filas.values()].sort((a, b) => b.vencidas - a.vencidas || b.abiertas - a.abiertas || a.nombre.localeCompare(b.nombre, "es"));
}

/* ── CSV (mismas columnas que TASK_CSV_COLUMNS de Flask) ── */

export const COLUMNAS_CSV = [
  "Fecha De inicio", "Fecha De finalizacion", "Fecha De entrega", "Director o Gerencia", "Cliente", "Titulo",
  "Solicitado por", "Asignar a", "Descripcion", "Tipo de Presupuesto", "Prioridad", "Recurrencia",
];

export type FilaCsv = {
  start_date: Date | null; end_date: Date | null; due_date: Date; directorate: string | null; client: string | null;
  title: string; requested_by: string | null; asignado: string; description: string | null; budget_type: string | null;
  priority: string | null; is_recurrent: boolean | null; recurrence_type: string | null;
};

export function mmddyyyy(d: Date | null): string {
  const iso = isoDeFecha(d);
  return iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "";
}

function celda(v: string): string {
  // Neutraliza formulas al abrir el CSV en una hoja de calculo.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function generarCsv(filas: FilaCsv[], prioridadDefecto: string): string {
  const lineas = [COLUMNAS_CSV.map(celda).join(",")];
  for (const t of filas) {
    lineas.push([
      mmddyyyy(t.start_date), mmddyyyy(t.end_date), mmddyyyy(t.due_date), t.directorate ?? "", t.client ?? "", t.title ?? "",
      t.requested_by ?? "", t.asignado, t.description ?? "", t.budget_type ?? "", t.priority || prioridadDefecto,
      t.is_recurrent && t.recurrence_type ? t.recurrence_type : "No",
    ].map(celda).join(","));
  }
  return "﻿" + lineas.join("\r\n") + "\r\n";
}
