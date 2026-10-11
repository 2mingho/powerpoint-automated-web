import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ErrorApi } from "@/lib/api";
import { db } from "@/lib/db";
import type { UsuarioActual } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";
import { fechaDeIso, hoyNegocio, isoDeFecha } from "@/lib/reloj";
import { usd } from "@/lib/finanzas/contratos";
import { resumenDeGastos, type ResumenGastos } from "./agregados";
import { exigirEditarGastos, exigirVerGastos, unidadesQueEditaGastos, unidadesQueVeGastos } from "./permisos";
import { CATEGORIAS_BASE, leerGasto, leerPresupuesto } from "./reglas";

/*
 * Gastos de una unidad y su presupuesto anual por categoria. Todo en USD. Visibilidad y edicion en permisos.ts.
 */
type Pieza = Pick<UsuarioActual, "id" | "isAdmin">;

const dinero = (d: Prisma.Decimal | number) => Number(d.toString());

/* Tope de gastos que viajan de un año: de sobra para una unidad; mas alla se avisa. */
export const MAX_GASTOS = 5000;

export type GastoDTO = {
  id: number;
  fecha: string;
  categoria: string;
  descripcion: string;
  monto: number;
  proveedor: string;
  nota: string;
  registradoPor: string;
};

export type DatosGastos = {
  unidades: { id: number; nombre: string; editable: boolean }[];
  unidadId: number | null;
  anio: number;
  /* Hoy en la zona de negocio (el dia que propone el formulario). */
  hoy: string;
  puedeEditar: boolean;
  gastos: GastoDTO[];
  truncado: boolean;
  presupuestos: { categoria: string; monto: number }[];
  resumen: ResumenGastos;
  /* Categorias que se ofrecen al escribir: las base y las ya usadas en la unidad. */
  categorias: string[];
};

export function leerAnioDeGastos(crudo: unknown, hoy = hoyNegocio()): number {
  const n = typeof crudo === "string" && /^\d{4}$/.test(crudo) ? Number(crudo) : Number.NaN;
  return n >= 2000 && n <= 2100 ? n : Number(hoy.slice(0, 4));
}

async function categoriasDe(unidadId: number): Promise<string[]> {
  const [g, p] = await Promise.all([
    db.expenses.groupBy({ by: ["category"], where: { area_id: unidadId } }),
    db.expense_budgets.groupBy({ by: ["category"], where: { area_id: unidadId } }),
  ]);
  return [...new Set([...g, ...p].map((f) => f.category))];
}

export async function datosDeGastos(u: Pieza, unidadPedida: number | null, anio: number): Promise<DatosGastos> {
  const [ven, editan] = await Promise.all([unidadesQueVeGastos(u), unidadesQueEditaGastos(u)]);
  const nombres = ven.length ? await db.areas.findMany({ where: { id: { in: ven } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const unidades = nombres.map((a) => ({ id: a.id, nombre: a.name, editable: editan.includes(a.id) }));
  // La que pide si la ve; si no, la primera que edita y, si no, la primera que ve.
  const unidadId = unidadPedida && ven.includes(unidadPedida) ? unidadPedida : (unidades.find((x) => x.editable) ?? unidades[0])?.id ?? null;
  if (unidadId === null) {
    return { unidades, unidadId, anio, hoy: hoyNegocio(), puedeEditar: false, gastos: [], truncado: false, presupuestos: [], resumen: resumenDeGastos([], [], anio), categorias: [...CATEGORIAS_BASE] };
  }
  const desde = fechaDeIso(`${anio}-01-01`)!, hasta = fechaDeIso(`${anio}-12-31`)!;
  const [filas, presupuestos, usadas] = await Promise.all([
    db.expenses.findMany({
      where: { area_id: unidadId, spent_on: { gte: desde, lte: hasta } },
      orderBy: [{ spent_on: "desc" }, { id: "desc" }], take: MAX_GASTOS + 1,
      select: { id: true, spent_on: true, category: true, description: true, amount: true, vendor: true, note: true, creador: { select: { username: true } } },
    }),
    db.expense_budgets.findMany({ where: { area_id: unidadId, year: anio }, select: { category: true, amount: true }, orderBy: { category: "asc" } }),
    categoriasDe(unidadId),
  ]);
  const truncado = filas.length > MAX_GASTOS;
  const gastos: GastoDTO[] = filas.slice(0, MAX_GASTOS).map((g) => ({
    id: g.id, fecha: isoDeFecha(g.spent_on), categoria: g.category, descripcion: g.description, monto: dinero(g.amount),
    proveedor: g.vendor ?? "", nota: g.note ?? "", registradoPor: g.creador?.username ?? "",
  }));
  // El resumen sale de TODOS los gastos del año, no solo de los que viajan: suma en la base.
  const filasResumen = truncado
    ? (await db.expenses.findMany({ where: { area_id: unidadId, spent_on: { gte: desde, lte: hasta } }, select: { id: true, spent_on: true, category: true, amount: true } }))
      .map((g) => ({ id: g.id, fecha: isoDeFecha(g.spent_on), categoria: g.category, monto: dinero(g.amount) }))
    : gastos;
  const pres = presupuestos.map((p) => ({ categoria: p.category, monto: dinero(p.amount) }));
  return {
    unidades, unidadId, anio, hoy: hoyNegocio(), puedeEditar: editan.includes(unidadId), gastos, truncado, presupuestos: pres,
    resumen: resumenDeGastos(filasResumen, pres, anio),
    categorias: [...new Set([...CATEGORIAS_BASE, ...usadas])],
  };
}

async function unidadExiste(id: number) {
  const a = await db.areas.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!a) throw new ErrorApi(404, "Unidad no encontrada.");
  return a;
}

export async function crearGasto(u: Pieza, crudo: Record<string, unknown>) {
  // Primero el permiso: quien no ve la unidad no debe aprender nada de la validacion.
  const unidad = Number(crudo.unidadId);
  if (!Number.isInteger(unidad) || unidad <= 0) throw new ErrorApi(400, "Elige la unidad del gasto.");
  await exigirEditarGastos(u, unidad);
  const d = leerGasto(crudo, await categoriasDe(unidad));
  if (!d.ok) throw new ErrorApi(400, d.error);
  const a = await unidadExiste(unidad);
  const g = await db.expenses.create({
    data: {
      area_id: unidad, spent_on: fechaDeIso(d.valor.fecha)!, category: d.valor.categoria, description: d.valor.descripcion, amount: d.valor.monto,
      vendor: d.valor.proveedor || null, note: d.valor.nota || null, created_by: u.id, created_at: new Date(), updated_at: new Date(),
    },
    select: { id: true },
  });
  await registrarActividad(u.id, "expense_create", `Gasto #${g.id} en «${a.name}»: ${d.valor.categoria}, ${usd(d.valor.monto)} (${d.valor.descripcion})`, { tipo: "expense", id: g.id });
  return { id: g.id };
}

async function gastoDeUnidadVisible(u: Pieza, id: number) {
  const g = await db.expenses.findUnique({ where: { id } });
  // No se ve = no existe: un gasto ajeno es indistinguible de uno inexistente.
  if (!g || !(await unidadesQueVeGastos(u)).includes(g.area_id)) throw new ErrorApi(404, "Gasto no encontrado.");
  return g;
}

/* Edicion parcial: lo que no llega no cambia. La unidad no se cambia (se borra y se registra en la otra). */
export async function editarGasto(u: Pieza, id: number, crudo: Record<string, unknown>) {
  const actual = await gastoDeUnidadVisible(u, id);
  await exigirEditarGastos(u, actual.area_id);
  const permitidos = ["fecha", "categoria", "descripcion", "monto", "proveedor", "nota"];
  const mezcla = {
    unidadId: actual.area_id, fecha: isoDeFecha(actual.spent_on), categoria: actual.category, descripcion: actual.description,
    monto: dinero(actual.amount), proveedor: actual.vendor ?? "", nota: actual.note ?? "",
    ...Object.fromEntries(Object.entries(crudo).filter(([k]) => permitidos.includes(k))),
  };
  const d = leerGasto(mezcla, await categoriasDe(actual.area_id));
  if (!d.ok) throw new ErrorApi(400, d.error);
  await db.expenses.update({
    where: { id },
    data: { spent_on: fechaDeIso(d.valor.fecha)!, category: d.valor.categoria, description: d.valor.descripcion, amount: d.valor.monto, vendor: d.valor.proveedor || null, note: d.valor.nota || null, updated_at: new Date() },
  });
  await registrarActividad(u.id, "expense_edit", `Gasto #${id} editado: ${d.valor.categoria}, ${usd(d.valor.monto)} (${d.valor.descripcion})`, { tipo: "expense", id });
  return { id };
}

export async function borrarGasto(u: Pieza, id: number) {
  const actual = await gastoDeUnidadVisible(u, id);
  await exigirEditarGastos(u, actual.area_id);
  await db.expenses.delete({ where: { id } });
  await registrarActividad(u.id, "expense_delete", `Gasto #${id} eliminado: ${actual.category}, ${usd(dinero(actual.amount))} (${actual.description})`, { tipo: "expense", id });
}

/* Fija (o quita, con monto 0) el presupuesto anual de una categoria. */
export async function fijarPresupuesto(u: Pieza, crudo: Record<string, unknown>) {
  const unidad = Number(crudo.unidadId);
  if (!Number.isInteger(unidad) || unidad <= 0) throw new ErrorApi(400, "Elige la unidad del presupuesto.");
  await exigirEditarGastos(u, unidad);
  const d = leerPresupuesto(crudo, await categoriasDe(unidad));
  if (!d.ok) throw new ErrorApi(400, d.error);
  const a = await unidadExiste(unidad);
  const clave = { area_id_year_category: { area_id: unidad, year: d.valor.anio, category: d.valor.categoria } };
  if (d.valor.monto === 0) {
    await db.expense_budgets.deleteMany({ where: { area_id: unidad, year: d.valor.anio, category: d.valor.categoria } });
    await registrarActividad(u.id, "expense_budget_clear", `Presupuesto ${d.valor.anio} de «${a.name}» sin «${d.valor.categoria}»`, { tipo: "area", id: unidad });
    return { categoria: d.valor.categoria, monto: 0 };
  }
  await db.expense_budgets.upsert({
    where: clave,
    create: { area_id: unidad, year: d.valor.anio, category: d.valor.categoria, amount: d.valor.monto, updated_by: u.id, updated_at: new Date() },
    update: { amount: d.valor.monto, updated_by: u.id, updated_at: new Date() },
  });
  await registrarActividad(u.id, "expense_budget_set", `Presupuesto ${d.valor.anio} de «${a.name}», ${d.valor.categoria}: ${usd(d.valor.monto)}`, { tipo: "area", id: unidad });
  return { categoria: d.valor.categoria, monto: d.valor.monto };
}

export async function gastosDeUnidadCsv(u: Pieza, unidadId: number, anio: number): Promise<string> {
  await exigirVerGastos(u, unidadId);
  const filas = await db.expenses.findMany({
    where: { area_id: unidadId, spent_on: { gte: fechaDeIso(`${anio}-01-01`)!, lte: fechaDeIso(`${anio}-12-31`)! } },
    orderBy: [{ spent_on: "asc" }, { id: "asc" }],
    select: { spent_on: true, category: true, description: true, amount: true, vendor: true, note: true },
  });
  const celda = (v: string) => {
    // Neutraliza formulas al abrir el CSV en una hoja de calculo.
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [["Fecha", "Categoria", "Descripcion", "Monto (USD)", "Proveedor", "Nota"].map(celda).join(",")];
  for (const g of filas) lineas.push([isoDeFecha(g.spent_on), g.category, g.description, dinero(g.amount).toFixed(2), g.vendor ?? "", g.note ?? ""].map(celda).join(","));
  return "﻿" + lineas.join("\r\n") + "\r\n";
}
