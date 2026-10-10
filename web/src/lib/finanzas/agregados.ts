/*
 * Cifras de la vista Ingresos (logica pura). Parten de los contratos y metas que
 * el servidor ya acoto a lo que la persona puede ver; aqui solo se suman. Los
 * conceptos son los del MVP: contratado (los 12 meses del ano), devengado (hasta
 * el mes actual, completo), por devengar, falta por contratar, ritmo esperado
 * (meta x mes / 12) y participacion en la meta.
 */
import { filasFin, mesActualDe, sumarMeses, type ContratoFin, type FilaFin } from "@/lib/seguimiento/finanzas";

export type ContratoIng = ContratoFin & {
  id: number;
  cliente: { id: number; nombre: string; tipo: string };
  unidad: { id: number; nombre: string };
  tipo: string;
};

/*
 * direccion: meta total FIJADA A MANO (null si no existe o no se ve). Por defecto no hay:
 * la meta total es la suma de las metas de las unidades que se ven (la cadena de quien
 * mira), calculada, sin que nadie la teclee. unidades: solo las que se ven.
 */
export type MetasIng = { direccion: number | null; unidades: Record<number, number> };

export type FiltroIng = { unidadId: number | null; clienteId: number | null; tipo: string };
export const SIN_FILTRO_ING: FiltroIng = { unidadId: null, clienteId: null, tipo: "" };

const r2 = (n: number) => Math.round(n * 100) / 100;
const suma = (l: number[]) => l.reduce((a, b) => a + b, 0);
const doce = () => Array<number>(12).fill(0);

export function filtrarContratos<C extends ContratoIng>(cs: C[], f: FiltroIng, omitir?: "unidad"): C[] {
  return cs.filter((c) => (omitir === "unidad" || !f.unidadId || c.unidad.id === f.unidadId) && (!f.clienteId || c.cliente.id === f.clienteId) && (!f.tipo || c.tipo === f.tipo));
}

/* La meta contra la que se mide lo que se ve: la de la unidad filtrada; sin filtro, la fijada a mano o, por defecto, la suma de las unidades visibles. null = sin meta. */
export function metaBase(m: MetasIng, f: FiltroIng): number | null {
  const v = f.unidadId ? (m.unidades[f.unidadId] ?? 0) : (m.direccion ?? suma(Object.values(m.unidades)));
  return v > 0 ? v : null;
}

export type ResumenIng = {
  filas: FilaFin<ContratoIng>[];
  mesActual: number;
  contratado: number;
  devengado: number;
  porDevengar: number;
  meta: number | null;
  /* Solo sin filtro de cliente ni de tipo: con ellos "falta" no tiene sentido. */
  faltaPorContratar: number | null;
  ritmo: number | null;
  /* Devengado menos el ritmo: positivo = adelantados. */
  contraRitmo: number | null;
  /* Solo con filtro de cliente o tipo: lo filtrado entre la meta. */
  participacion: number | null;
  porMes: number[];
  acumulado: number[];
  /* Meta repartida en partes iguales por mes, para la linea de referencia. */
  metaMensual: number | null;
};

export function resumenIngresos(contratos: ContratoIng[], metas: MetasIng, anio: number, hoy: string, f: FiltroIng): ResumenIng {
  const filas = filasFin(filtrarContratos(contratos, f), anio);
  const porMes = doce().map((_, i) => r2(sumarMeses(filas, i, i + 1)));
  const mesActual = mesActualDe(anio, hoy);
  // Las cifras se suman sin redondear y se redondean al final: sumar meses ya redondeados arrastra centavos de mas.
  const contratado = r2(sumarMeses(filas, 0, 12));
  const devengado = r2(sumarMeses(filas, 0, mesActual));
  const meta = metaBase(metas, f);
  const acotado = !!(f.clienteId || f.tipo);
  const ritmo = meta === null ? null : r2((meta * mesActual) / 12);
  return {
    filas, mesActual, contratado, devengado, porDevengar: r2(contratado - devengado), meta,
    faltaPorContratar: meta === null || acotado ? null : r2(Math.max(0, meta - contratado)),
    ritmo,
    contraRitmo: ritmo === null || acotado ? null : r2(devengado - ritmo),
    participacion: meta === null || !acotado ? null : contratado / meta,
    porMes,
    acumulado: porMes.map((_, i) => r2(sumarMeses(filas, 0, i + 1))),
    metaMensual: meta === null ? null : r2(meta / 12),
  };
}

export type TarjetaUnidad = { unidadId: number; nombre: string; total: number; meta: number | null; porMeta: number | null; pesoEnMeta: number | null };

/*
 * Una tarjeta por unidad con contratos o meta. Respeta cliente y tipo pero no el
 * filtro de unidad (para poder comparar y elegir). porMeta = total / su meta;
 * pesoEnMeta = su meta / la meta total (la fijada o la suma de las unidades).
 */
export function tarjetasPorUnidad(contratos: ContratoIng[], unidades: { id: number; nombre: string }[], metas: MetasIng, anio: number, f: FiltroIng): TarjetaUnidad[] {
  const filas = filasFin(filtrarContratos(contratos, f, "unidad"), anio);
  const total = new Map<number, number>();
  for (const x of filas) total.set(x.contrato.unidad.id, (total.get(x.contrato.unidad.id) ?? 0) + x.total);
  const metaTotal = metaBase(metas, SIN_FILTRO_ING);
  return unidades
    .map((u) => {
      const meta = metas.unidades[u.id] > 0 ? metas.unidades[u.id] : null;
      const t = r2(total.get(u.id) ?? 0);
      return {
        unidadId: u.id, nombre: u.nombre, total: t, meta,
        porMeta: meta === null ? null : t / meta,
        pesoEnMeta: meta === null || metaTotal === null ? null : meta / metaTotal,
      };
    })
    .filter((t) => t.total > 0 || t.meta !== null)
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

/*
 * De donde sale la meta total: la suma de las unidades que se ven (calculada) o un valor
 * fijado a mano. Si hay uno fijado, se dice cuanto sumarian las unidades para poder
 * volver a la suma. Reemplaza al antiguo aviso de "no suman".
 */
export function origenDeMeta(metas: MetasIng): { sumaUnidades: number; fijada: number | null } {
  return { sumaUnidades: r2(suma(Object.values(metas.unidades))), fijada: metas.direccion };
}

export type SerieUnidad = { unidadId: number; nombre: string; meses: number[]; total: number };

/* Ingreso de cada mes por unidad (para las columnas apiladas); respeta todos los filtros. */
export function porMesPorUnidad(filas: FilaFin<ContratoIng>[]): SerieUnidad[] {
  const m = new Map<number, SerieUnidad>();
  for (const x of filas) {
    const s = m.get(x.contrato.unidad.id) ?? { unidadId: x.contrato.unidad.id, nombre: x.contrato.unidad.nombre, meses: doce(), total: 0 };
    x.meses.forEach((v, i) => { s.meses[i] += v; });
    m.set(x.contrato.unidad.id, s);
  }
  return [...m.values()].map((s) => ({ ...s, meses: s.meses.map(r2), total: r2(suma(s.meses)) })).sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

export type FilaTabla = { clave: string; etiqueta: string; meses: number[]; total: number; contratoId?: number };

/*
 * Tabla mes a mes: por cliente o por unidad; con un cliente elegido, sus contratos uno a uno.
 */
export function tablaMensual(filas: FilaFin<ContratoIng>[], por: "cliente" | "unidad", contratoPorContrato = false): FilaTabla[] {
  if (contratoPorContrato) {
    return filas.map((x) => ({ clave: `c${x.contrato.id}`, etiqueta: `${x.contrato.unidad.nombre} · ${x.contrato.tipo}`, meses: x.meses.map(r2), total: r2(x.total), contratoId: x.contrato.id }))
      .sort((a, b) => b.total - a.total);
  }
  const m = new Map<string, FilaTabla>();
  for (const x of filas) {
    const clave = por === "cliente" ? `cl${x.contrato.cliente.id}` : `u${x.contrato.unidad.id}`;
    const f = m.get(clave) ?? { clave, etiqueta: por === "cliente" ? x.contrato.cliente.nombre : x.contrato.unidad.nombre, meses: doce(), total: 0 };
    x.meses.forEach((v, i) => { f.meses[i] += v; });
    m.set(clave, f);
  }
  return [...m.values()].map((f) => ({ ...f, meses: f.meses.map(r2), total: r2(suma(f.meses)) })).sort((a, b) => b.total - a.total || a.etiqueta.localeCompare(b.etiqueta, "es"));
}
