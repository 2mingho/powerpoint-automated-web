/*
 * Reglas puras de los gastos de una unidad y de su presupuesto anual por categoria. Solo USD, como los
 * contratos. Sin base ni reloj.
 */
import { leerMonto } from "@/lib/finanzas/contratos";
import { esIsoValida } from "@/lib/tareas/fechas";

export type Leido<T> = { ok: true; valor: T } | { ok: false; error: string };

/* Categorias que se ofrecen siempre; el gerente puede escribir otras. */
export const CATEGORIAS_BASE = [
  "Software y licencias", "Herramientas y equipos", "Viajes y viáticos", "Capacitación", "Servicios externos",
  "Alimentación y reuniones", "Transporte", "Marketing", "Otros",
] as const;

export const MAX_CATEGORIA = 60;

const clave = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/*
 * La categoria como se guarda: sin espacios de mas y, si ya existe una igual (sin distinguir mayusculas ni tildes),
 * con SU escritura, para que "viajes" y "Viajes" no partan un mismo gasto en dos filas de presupuesto.
 */
export function normalizarCategoria(crudo: unknown, existentes: readonly string[] = []): Leido<string> {
  const t = typeof crudo === "string" ? crudo.trim().replace(/\s+/g, " ") : "";
  if (!t) return { ok: false, error: "Elige o escribe la categoría." };
  if (t.length > MAX_CATEGORIA) return { ok: false, error: `La categoría admite hasta ${MAX_CATEGORIA} caracteres.` };
  const igual = [...CATEGORIAS_BASE, ...existentes].find((c) => clave(c) === clave(t));
  return { ok: true, valor: igual ?? t };
}

export type DatosGasto = { unidadId: number; fecha: string; categoria: string; descripcion: string; monto: number; proveedor: string; nota: string };

const entero = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

export function leerGasto(crudo: Record<string, unknown>, categoriasExistentes: readonly string[] = []): Leido<DatosGasto> {
  const unidadId = entero(crudo.unidadId);
  if (!unidadId) return { ok: false, error: "Elige la unidad del gasto." };
  const fecha = typeof crudo.fecha === "string" ? crudo.fecha : "";
  if (!esIsoValida(fecha)) return { ok: false, error: "Indica la fecha del gasto." };
  const categoria = normalizarCategoria(crudo.categoria, categoriasExistentes);
  if (!categoria.ok) return categoria;
  const descripcion = typeof crudo.descripcion === "string" ? crudo.descripcion.trim().replace(/\s+/g, " ") : "";
  if (!descripcion) return { ok: false, error: "Describe el gasto." };
  if (descripcion.length > 300) return { ok: false, error: "La descripción admite hasta 300 caracteres." };
  const monto = leerMonto(crudo.monto);
  if (!monto.ok) return monto;
  const proveedor = typeof crudo.proveedor === "string" ? crudo.proveedor.trim() : "";
  if (proveedor.length > 120) return { ok: false, error: "El proveedor admite hasta 120 caracteres." };
  const nota = typeof crudo.nota === "string" ? crudo.nota.trim() : "";
  if (nota.length > 500) return { ok: false, error: "La nota admite hasta 500 caracteres." };
  return { ok: true, valor: { unidadId, fecha, categoria: categoria.valor, descripcion, monto: monto.valor, proveedor, nota } };
}

export type DatosPresupuesto = { unidadId: number; anio: number; categoria: string; monto: number };

export function leerPresupuesto(crudo: Record<string, unknown>, categoriasExistentes: readonly string[] = []): Leido<DatosPresupuesto> {
  const unidadId = entero(crudo.unidadId);
  if (!unidadId) return { ok: false, error: "Elige la unidad del presupuesto." };
  const anio = typeof crudo.anio === "string" && /^\d{4}$/.test(crudo.anio) ? Number(crudo.anio) : crudo.anio;
  if (typeof anio !== "number" || !Number.isInteger(anio) || anio < 2000 || anio > 2100) return { ok: false, error: "El año debe estar entre 2000 y 2100." };
  const categoria = normalizarCategoria(crudo.categoria, categoriasExistentes);
  if (!categoria.ok) return categoria;
  const monto = leerMonto(crudo.monto, { permitirCero: true });
  if (!monto.ok) return monto;
  return { ok: true, valor: { unidadId, anio, categoria: categoria.valor, monto: monto.valor } };
}

export type Estado = "sin_presupuesto" | "bien" | "cerca" | "excedido";

/* <90 % bien, hasta el 100 % cerca, mas es excedido; sin presupuesto no hay contra que medir. */
export function estadoDePresupuesto(gastado: number, presupuesto: number): Estado {
  if (!(presupuesto > 0)) return "sin_presupuesto";
  if (gastado > presupuesto) return "excedido";
  return gastado / presupuesto >= 0.9 ? "cerca" : "bien";
}

export const ROTULO_ESTADO: Record<Estado, string> = { sin_presupuesto: "Sin presupuesto", bien: "Dentro del presupuesto", cerca: "Cerca del límite", excedido: "Excedido" };
