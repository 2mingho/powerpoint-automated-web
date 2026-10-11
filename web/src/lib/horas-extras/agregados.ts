/*
 * Cifras de las horas extras (logica pura): el reporte de una quincena, con la segmentacion L-V / SAB-DOM de cada
 * persona, y la matriz del trimestre contra el maximo (la hoja GENERALES del Excel), que es la base del mapa de calor.
 */
import { esFinDeSemana } from "@/lib/tareas/fechas";
import {
  avisoDeLimite, claveDePeriodo, nivelDeLimite, periodosDelTrimestre, redondear, trimestreDe,
  type Aviso, type Nivel, type Periodo,
} from "./reglas";

export type EntradaHoras = {
  id: number;
  personaId: number;
  personaNombre: string;
  fecha: string;
  detalle: string;
  horario: string;
  horas: number;
  periodo: Periodo;
};

export type Persona = { id: number; nombre: string };

export type Segmentos = { laborables: number; finDeSemana: number; total: number };

/* L-V y SAB-DOM de una lista de registros, segun el dia trabajado de cada uno. */
export function segmentar(entradas: readonly Pick<EntradaHoras, "fecha" | "horas">[]): Segmentos {
  let laborables = 0, finDeSemana = 0;
  for (const e of entradas) {
    if (esFinDeSemana(e.fecha)) finDeSemana += e.horas;
    else laborables += e.horas;
  }
  return { laborables: redondear(laborables), finDeSemana: redondear(finDeSemana), total: redondear(laborables + finDeSemana) };
}

export type BloquePersona = Segmentos & { personaId: number; nombre: string; filas: (EntradaHoras & { finDeSemana: boolean })[] };

const porPeriodo = (e: EntradaHoras, p: Periodo) => e.periodo.anio === p.anio && e.periodo.mes === p.mes && e.periodo.mitad === p.mitad;
const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });

/* El reporte de una quincena: un bloque por persona (orden alfabetico, sus dias por fecha) y los totales. */
export function reporteDePeriodo(entradas: readonly EntradaHoras[], periodo: Periodo): Segmentos & { colaboradores: number; bloques: BloquePersona[] } {
  const por = new Map<number, EntradaHoras[]>();
  for (const e of entradas) if (porPeriodo(e, periodo)) por.set(e.personaId, [...(por.get(e.personaId) ?? []), e]);
  const bloques: BloquePersona[] = [...por.values()].map((lista) => {
    const filas = [...lista].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id)).map((e) => ({ ...e, finDeSemana: esFinDeSemana(e.fecha) }));
    return { personaId: lista[0].personaId, nombre: lista[0].personaNombre, filas, ...segmentar(filas) };
  }).sort(porNombre);
  const total = segmentar(bloques.flatMap((b) => b.filas));
  return { ...total, colaboradores: bloques.length, bloques };
}

export type CeldaMatriz = { periodo: Periodo; horas: number; nivel: Nivel };

export type FilaMatriz = {
  personaId: number;
  nombre: string;
  celdas: CeldaMatriz[];
  total: number;
  limite: number;
  /* Lo que queda del maximo (negativo si se paso). */
  restante: number;
  nivel: Nivel;
  aviso: Aviso;
};

/*
 * Matriz de un trimestre: personas por quincenas (seis), con el total contra el limite. La celda de cada quincena
 * se colorea contra el RITMO (limite / 6: lo que toca gastar por quincena para llegar justo al maximo); el total, contra
 * el limite. Entran las personas dadas (la plantilla de la unidad) y quien tenga horas aunque ya no este en ella.
 */
export function matrizDelTrimestre(entradas: readonly EntradaHoras[], personas: readonly Persona[], anio: number, trimestre: number, limite: number) {
  const periodos = periodosDelTrimestre(anio, trimestre);
  const ritmo = limite / periodos.length;
  const delTrimestre = entradas.filter((e) => e.periodo.anio === anio && trimestreDe(e.periodo.mes) === trimestre);
  const nombres = new Map(personas.map((p) => [p.id, p.nombre]));
  for (const e of delTrimestre) if (!nombres.has(e.personaId)) nombres.set(e.personaId, e.personaNombre);
  const filas: FilaMatriz[] = [...nombres].map(([personaId, nombre]) => {
    const suyas = delTrimestre.filter((e) => e.personaId === personaId);
    const celdas = periodos.map((periodo) => {
      const horas = redondear(suyas.filter((e) => porPeriodo(e, periodo)).reduce((a, e) => a + e.horas, 0));
      return { periodo, horas, nivel: nivelDeLimite(horas, ritmo) };
    });
    const total = redondear(celdas.reduce((a, c) => a + c.horas, 0));
    return { personaId, nombre, celdas, total, limite, restante: redondear(limite - total), nivel: nivelDeLimite(total, limite), aviso: avisoDeLimite(total, limite) };
  }).sort((a, b) => b.total - a.total || porNombre(a, b));
  const totalesPorPeriodo = periodos.map((p) => redondear(filas.reduce((a, f) => a + (f.celdas.find((c) => claveDePeriodo(c.periodo) === claveDePeriodo(p))?.horas ?? 0), 0)));
  return { periodos, ritmo, filas, totalesPorPeriodo, total: redondear(filas.reduce((a, f) => a + f.total, 0)) };
}

/* Horas de una persona en el trimestre de un reporte, sin contar el registro `salvo` (al editarlo). Para avisar del limite al guardar. */
export function horasDelTrimestre(entradas: readonly EntradaHoras[], personaId: number, periodo: Periodo, salvo?: number): number {
  const t = trimestreDe(periodo.mes);
  return redondear(entradas.filter((e) => e.personaId === personaId && e.id !== salvo && e.periodo.anio === periodo.anio && trimestreDe(e.periodo.mes) === t).reduce((a, e) => a + e.horas, 0));
}
