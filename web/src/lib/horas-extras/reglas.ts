/*
 * Reglas puras de las horas extras de una unidad (sin base ni reloj). Salen del reporte que Media Watch lleva en Excel:
 *
 *   - Se reportan por QUINCENA, que se nombra por su ultimo dia: 15 (del 1 al 15) o 30 (del 16 al fin de mes).
 *   - Cada hora se segmenta en L-V o SAB-DOM segun la fecha trabajada.
 *   - Hay un maximo por persona y TRIMESTRE natural (80 h en el Excel actual).
 *
 * Una hora trabajada pertenece a un reporte (año, mes, quincena). Por defecto es el de su fecha, pero se puede
 * registrar tarde en otro: el Excel de la 2da quincena de septiembre incluye dias de finales de agosto. El trimestre
 * y el limite cuentan por el REPORTE, no por la fecha trabajada, igual que la hoja GENERALES.
 */
import { esFinDeSemana, esIsoValida } from "@/lib/tareas/fechas";

export type Leido<T> = { ok: true; valor: T } | { ok: false; error: string };

export type Mitad = 15 | 30;
export type Periodo = { anio: number; mes: number; mitad: Mitad };

export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const LIMITE_POR_DEFECTO = 80;
export const HORAS_MAX_POR_DIA = 24;

/* Quincena de una fecha: 15 si es del 1 al 15, 30 del 16 en adelante. */
export function mitadDe(iso: string): Mitad {
  return Number(iso.slice(8, 10)) <= 15 ? 15 : 30;
}

/* El reporte que le toca a una fecha trabajada. */
export function periodoDe(iso: string): Periodo {
  return { anio: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)), mitad: mitadDe(iso) };
}

/* Trimestre natural (1 a 4) de un mes (1 a 12). */
export function trimestreDe(mes: number): number {
  return Math.floor((mes - 1) / 3) + 1;
}

/* Los tres meses de un trimestre: [4, 5, 6] para el 2. */
export function mesesDelTrimestre(trimestre: number): number[] {
  return [1, 2, 3].map((i) => (trimestre - 1) * 3 + i);
}

/* "2DA. QUINCENA DE SEPTIEMBRE 2026", como el encabezado del Excel. */
export function rotuloPeriodo(p: Periodo, mayusculas = true): string {
  const t = `${p.mitad === 15 ? "1ra" : "2da"}. quincena de ${MESES[p.mes - 1].toLowerCase()} ${p.anio}`;
  return mayusculas ? t.toUpperCase() : t;
}

export const claveDePeriodo = (p: Periodo) => `${p.anio}-${String(p.mes).padStart(2, "0")}-${p.mitad}`;

/* Los periodos de un trimestre, en orden: seis quincenas. */
export function periodosDelTrimestre(anio: number, trimestre: number): Periodo[] {
  return mesesDelTrimestre(trimestre).flatMap((mes) => ([15, 30] as const).map((mitad) => ({ anio, mes, mitad })));
}

/* El periodo en curso y el anterior (para el selector); orden de mas reciente a mas antiguo. */
export function periodoAnterior(p: Periodo): Periodo {
  if (p.mitad === 30) return { ...p, mitad: 15 };
  return p.mes === 1 ? { anio: p.anio - 1, mes: 12, mitad: 30 } : { anio: p.anio, mes: p.mes - 1, mitad: 30 };
}

/* Horas con hasta dos decimales, redondeadas para que sumar no arrastre 0.30000000000000004. */
export const redondear = (n: number) => Math.round(n * 100) / 100;

export function leerHoras(crudo: unknown): Leido<number> {
  const malo = { ok: false, error: `Las horas deben ser un número mayor que 0 y de hasta ${HORAS_MAX_POR_DIA}, con hasta dos decimales.` } as const;
  let n: number;
  if (typeof crudo === "number") n = crudo;
  else if (typeof crudo === "string" && /^\d+([.,]\d{1,2})?$/.test(crudo.trim())) n = Number(crudo.trim().replace(",", "."));
  else return malo;
  if (!Number.isFinite(n) || redondear(n) !== n || n <= 0 || n > HORAS_MAX_POR_DIA) return malo;
  return { ok: true, valor: n };
}

export const LIMITE_MAX = 400;

/* El maximo por persona y trimestre que fija un administrador: mayor que 0 y de hasta 400 h, con hasta dos decimales. */
export function leerLimite(crudo: unknown): Leido<number> {
  const malo = { ok: false, error: `El máximo de horas extras por trimestre debe ser un número mayor que 0 y de hasta ${LIMITE_MAX}.` } as const;
  let n: number;
  if (typeof crudo === "number") n = crudo;
  else if (typeof crudo === "string" && /^\d+([.,]\d{1,2})?$/.test(crudo.trim())) n = Number(crudo.trim().replace(",", "."));
  else return malo;
  if (!Number.isFinite(n) || redondear(n) !== n || n <= 0 || n > LIMITE_MAX) return malo;
  return { ok: true, valor: n };
}

export type DatosHoras = {
  personaId: number;
  fecha: string;
  detalle: string;
  horario: string;
  horas: number;
  periodo: Periodo;
};

const entero = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

export function leerPeriodo(crudo: unknown): Leido<Periodo> {
  const p = crudo as { anio?: unknown; mes?: unknown; mitad?: unknown } | null;
  const anio = entero(p?.anio), mes = entero(p?.mes), mitad = entero(p?.mitad);
  if (!anio || anio < 2000 || anio > 2100) return { ok: false, error: "El año del reporte debe estar entre 2000 y 2100." };
  if (!mes || mes > 12) return { ok: false, error: "El mes del reporte debe ser de 1 a 12." };
  if (mitad !== 15 && mitad !== 30) return { ok: false, error: "La quincena del reporte es 15 (del 1 al 15) o 30 (del 16 al fin de mes)." };
  return { ok: true, valor: { anio, mes, mitad } };
}

/* Un registro de horas extras (alta). Sin periodo, el que le toca a su fecha. */
export function leerRegistro(crudo: Record<string, unknown>): Leido<DatosHoras> {
  const personaId = entero(crudo.personaId);
  if (!personaId) return { ok: false, error: "Elige la persona." };
  const fecha = typeof crudo.fecha === "string" ? crudo.fecha : "";
  if (!esIsoValida(fecha)) return { ok: false, error: "Indica el día trabajado." };
  const detalle = typeof crudo.detalle === "string" ? crudo.detalle.trim().replace(/\s+/g, " ") : "";
  if (!detalle) return { ok: false, error: "Describe qué se hizo." };
  if (detalle.length > 300) return { ok: false, error: "El detalle admite hasta 300 caracteres." };
  const horario = typeof crudo.horario === "string" ? crudo.horario.trim().replace(/\s+/g, " ") : "";
  if (horario.length > 120) return { ok: false, error: "El horario admite hasta 120 caracteres." };
  const horas = leerHoras(crudo.horas);
  if (!horas.ok) return horas;
  let periodo = periodoDe(fecha);
  if (crudo.periodo !== undefined && crudo.periodo !== null) {
    const p = leerPeriodo(crudo.periodo);
    if (!p.ok) return p;
    periodo = p.valor;
  }
  const coherente = periodoCoherente(fecha, periodo);
  if (!coherente.ok) return coherente;
  return { ok: true, valor: { personaId, fecha, detalle, horario, horas: horas.valor, periodo } };
}

/* L-V o SAB-DOM, segun el dia trabajado. */
export const esFinDeSemanaTrabajo = esFinDeSemana;

/* Niveles del mapa de calor: 0 libre ... 4 pasado del limite. Mismas franjas en la celda de ritmo y en el total. */
export type Nivel = 0 | 1 | 2 | 3 | 4;

/* <50 % libre, <75 % comodo, <90 % lleno, hasta el 100 % al limite, mas es pasarse. */
export function nivelDeLimite(horas: number, limite: number): Nivel {
  if (limite <= 0) return horas > 0 ? 4 : 0;
  const r = horas / limite;
  if (r < 0.5) return 0;
  if (r < 0.75) return 1;
  if (r < 0.9) return 2;
  if (r <= 1) return 3;
  return 4;
}

export const ROTULO_NIVEL: Record<Nivel, string> = { 0: "Libre", 1: "Cómodo", 2: "Lleno", 3: "Al límite", 4: "Pasado del límite" };

export type Aviso = "" | "cerca" | "excedido";

/* Avisa desde el 90 % del maximo y marca el exceso. No bloquea nada. */
export function avisoDeLimite(horas: number, limite: number): Aviso {
  if (horas > limite) return "excedido";
  return limite > 0 && horas / limite >= 0.9 ? "cerca" : "";
}

const posicion = (p: Periodo) => p.anio * 24 + (p.mes - 1) * 2 + (p.mitad === 30 ? 1 : 0);

/*
 * El reporte en que se registra un dia trabajado: el de su fecha o uno POSTERIOR (se reporta tarde, nunca por adelantado),
 * y a lo sumo seis meses despues; mas alla es casi seguro un error de dedo.
 */
export function periodoCoherente(fecha: string, periodo: Periodo): Leido<Periodo> {
  const propio = periodoDe(fecha);
  if (posicion(periodo) < posicion(propio)) return { ok: false, error: "El reporte no puede ser anterior al día trabajado." };
  if (posicion(periodo) - posicion(propio) > 12) return { ok: false, error: "El reporte queda a más de seis meses del día trabajado: revisa el periodo." };
  return { ok: true, valor: periodo };
}
