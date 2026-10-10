/*
 * Aritmetica de dias de negocio (YYYY-MM-DD), sin zona ni reloj: todo parte de
 * un "hoy" que fija el servidor con hoyNegocio(). Se calcula en UTC para que
 * ningun huso desplace el dia, el mismo error que Flask corrigio en la bandeja.
 *
 * Reglas portadas de blueprints/tasks.py:
 *   _generate_recurrence_dates   generarFechasRecurrencia
 *   _business_day_offset         desplazarDiasHabiles
 *   _parse_iso_or_mmddyyyy_date  parsearFechaEntrada
 *   _parse_csv_flexible_date     parsearFechaCsv
 */

export const TIPOS_RECURRENCIA = ["Diaria", "Semanal", "Mensual"] as const;
export type TipoRecurrencia = (typeof TIPOS_RECURRENCIA)[number];

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function aUtc(iso: string): Date | null {
  const m = RE_ISO.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function deUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* Fecha valida a partir de sus partes; null si el dia no existe (30 de febrero). */
export function fechaValida(anio: number, mes: number, dia: number): string | null {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || !Number.isInteger(dia)) return null;
  if (anio < 1 || anio > 9999 || mes < 1 || mes > 12 || dia < 1) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCFullYear(anio);
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function esIsoValida(iso: string): boolean {
  const m = RE_ISO.exec(iso);
  return !!m && fechaValida(Number(m[1]), Number(m[2]), Number(m[3])) === iso;
}

export function sumarDias(iso: string, dias: number): string {
  const d = aUtc(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + dias);
  return deUtc(d);
}

/* 0 domingo … 6 sabado, como Date.getDay(). */
export function diaSemana(iso: string): number {
  return aUtc(iso)?.getUTCDay() ?? 0;
}

export function esFinDeSemana(iso: string): boolean {
  const d = diaSemana(iso);
  return d === 0 || d === 6;
}

export function diasEntre(desde: string, hasta: string): number {
  const a = aUtc(desde);
  const b = aUtc(hasta);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/* Lunes de la semana de esa fecha. */
export function lunesDe(iso: string): string {
  const d = diaSemana(iso);
  return sumarDias(iso, d === 0 ? -6 : 1 - d);
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/*
 * Fechas de una serie recurrente hasta `fin`, saltando sabados y domingos.
 * Mensual conserva el dia del mes; si no existe (31 en febrero) cae al ultimo
 * dia, y desde ahi la serie sigue en ese dia, como hacia Flask con
 * date.replace (de 31 de enero pasa a 28 de febrero y despues a 28 de marzo).
 */
export function generarFechasRecurrencia(inicio: string, tipo: string, fin: string): string[] {
  const fechas: string[] = [];
  if (!esIsoValida(inicio) || !esIsoValida(fin)) return fechas;
  let actual = inicio;
  // Tope de seguridad: la API rechaza mas de 365, pero un rango de anos no debe colgar el proceso.
  const tope = 20_000;
  if (tipo === "Mensual") {
    while (actual <= fin && fechas.length < tope) {
      if (!esFinDeSemana(actual)) fechas.push(actual);
      const [a, m, d] = actual.split("-").map(Number);
      const mes = m === 12 ? 1 : m + 1;
      const anio = m === 12 ? a + 1 : a;
      actual = fechaValida(anio, mes, Math.min(d, ultimoDiaDelMes(anio, mes)))!;
    }
    return fechas;
  }
  const paso = tipo === "Diaria" ? 1 : 7; // cualquier otro valor era semanal en Flask
  while (actual <= fin && fechas.length < tope) {
    if (!esFinDeSemana(actual)) fechas.push(actual);
    actual = sumarDias(actual, paso);
  }
  return fechas;
}

/*
 * Entrega de la SIGUIENTE tarea de una serie, calculada desde la entrega de la que
 * se cierra (no desde el dia en que se cierra): una semanal que vencia el lunes 7 y
 * se cierra el martes 8 genera la del lunes 14.
 *  - Semanal: el mismo dia de la semana que la primera (`ancla`), la semana siguiente.
 *  - Mensual: el mismo dia del mes que la primera, el mes siguiente; si ese dia no existe
 *    (31 en febrero) cae en el ultimo, y el mes que sigue vuelve al dia de la primera.
 *  - Diaria: el siguiente dia laborable.
 * Fechas invalidas devuelven null.
 */
export function siguienteEntrega(tipo: string, actual: string, ancla: string): string | null {
  if (!esIsoValida(actual) || !esIsoValida(ancla)) return null;
  if (tipo === "Mensual") {
    const [a, m] = actual.split("-").map(Number);
    const mes = m === 12 ? 1 : m + 1;
    const anio = m === 12 ? a + 1 : a;
    return fechaValida(anio, mes, Math.min(Number(ancla.slice(8, 10)), ultimoDiaDelMes(anio, mes)));
  }
  if (tipo === "Diaria") {
    let d = sumarDias(actual, 1);
    while (esFinDeSemana(d)) d = sumarDias(d, 1);
    return d;
  }
  // Semanal (y cualquier otro valor, como en Flask): semanas de lunes a domingo.
  return sumarDias(lunesDe(actual), 7 + ((diaSemana(ancla) + 6) % 7));
}

/* Suma `dias` dias laborables (lunes a viernes) a partir de `inicio`. */
export function desplazarDiasHabiles(inicio: string, dias: number): string {
  let actual = inicio;
  let faltan = dias;
  while (faltan > 0) {
    actual = sumarDias(actual, 1);
    if (!esFinDeSemana(actual)) faltan -= 1;
  }
  return actual;
}

/* Fecha de un campo de la API: ISO (con hora opcional detras de la T) o MM/DD/YYYY. */
export function parsearFechaEntrada(crudo: unknown): string | null {
  let valor = String(crudo ?? "").trim();
  if (!valor) return null;
  if (valor.includes("T")) valor = valor.split("T", 1)[0];
  const iso = RE_ISO.exec(valor);
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor);
  if (mdy) return fechaValida(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
  return null;
}

const MESES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/*
 * Fechas del CSV: YYYY-MM-DD, M/D/YY(YY) o D-MMM(-YY). Sin ano se infiere el
 * actual y se avisa. Devuelve { fecha: null } si no se reconoce.
 */
export function parsearFechaCsv(crudo: unknown, anioActual: number): { fecha: string | null; aviso: "year_inferred_current" | null } {
  const valor = String(crudo ?? "").trim();
  const nada = { fecha: null, aviso: null } as const;
  if (!valor) return nada;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(valor);
  if (iso) return { fecha: fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3])), aviso: null };

  const barra = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(valor);
  if (barra) {
    let anio = Number(barra[3]);
    if (anio < 100) anio += 2000;
    return { fecha: fechaValida(anio, Number(barra[1]), Number(barra[2])), aviso: null };
  }

  const nombre = /^(\d{1,2})\s*[-/]\s*([A-Za-z]{3,9})(?:\s*[-/]\s*(\d{2,4}))?$/.exec(valor);
  if (nombre) {
    const mes = MESES[nombre[2].toLowerCase()];
    if (!mes) return nada;
    let anio = anioActual;
    let aviso: "year_inferred_current" | null = "year_inferred_current";
    if (nombre[3]) {
      anio = Number(nombre[3]);
      if (anio < 100) anio += 2000;
      aviso = null;
    }
    const fecha = fechaValida(anio, mes, Number(nombre[1]));
    return fecha ? { fecha, aviso } : nada;
  }
  return nada;
}

/* MM/DD/YYYY, el formato del CSV de Flask. */
export function formatoMdy(iso: string): string {
  const m = RE_ISO.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}
