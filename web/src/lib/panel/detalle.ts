import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { estados } from "@/lib/catalogo";
import { hoyNegocio, isoDeFecha } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import { diaDb } from "@/lib/tareas/base";
import { esIsoValida, lunesDe, sumarDias } from "@/lib/tareas/fechas";
import { grupoDeEstado, HORAS_POR_DEFECTO } from "@/lib/seguimiento/estado";
import type { RangoFechas } from "@/lib/seguimiento/periodo";
import { unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import type { Direccion } from "@/lib/orden";
import { GRUPOS_ESTADO, type FilaDetalle } from "./tipos";

/*
 * Detalle del panel: las tareas sueltas que se ven en la tabla, solo la pagina pedida, con los filtros
 * cruzados aplicados AQUI (en la base) y no en el navegador. Cada filtro es el mismo criterio con el que se
 * agrupan las celdas (datos.ts): si uno cambia, el otro tambien, y la prueba de coherencia
 * (e2e/tareas/panel.spec.ts) compara el total del detalle con la cifra de las celdas.
 *
 * La visibilidad es siempre filtroTareasVisibles(u): los filtros solo estrechan.
 */

export const PAGINA_DETALLE = 40;
export const MAX_PAGINA_DETALLE = 100;

export type FiltrosDetalle = { unidad: string; cliente: string; persona: string; tipo: string; contrato: string; semana: string; estado: string };
export const SIN_FILTROS_DETALLE: FiltrosDetalle = { unidad: "", cliente: "", persona: "", tipo: "", contrato: "", semana: "", estado: "" };

export const COLUMNAS_ORDEN = ["entrega", "tarea", "persona", "unidad", "estado", "horas"] as const;
export type ColumnaDetalle = (typeof COLUMNAS_ORDEN)[number];
export type OrdenDetalle = { col: ColumnaDetalle; dir: Direccion } | null;

export function leerFiltrosDetalle(p: URLSearchParams): FiltrosDetalle {
  const g = (k: string, max = 200) => (p.get(k) ?? "").slice(0, max);
  const semana = g("semana", 10);
  return {
    unidad: g("unidad"), cliente: g("cliente"), persona: /^\d+$/.test(g("persona", 12)) ? g("persona", 12) : "", tipo: g("tipo"), contrato: g("contrato"),
    semana: esIsoValida(semana) ? semana : "", estado: g("estado", 20),
  };
}

export function leerOrdenDetalle(p: URLSearchParams): OrdenDetalle {
  const col = p.get("orden") as ColumnaDetalle | null;
  if (!col || !COLUMNAS_ORDEN.includes(col)) return null;
  return { col, dir: p.get("dir") === "desc" ? "desc" : "asc" };
}

/* Rango de entrega del periodo como condicion de la base. */
export function condicionDePeriodo(rango: RangoFechas): Prisma.tasksWhereInput {
  const due = {
    ...(rango.desde ? { gte: diaDb(rango.desde) } : {}),
    ...(rango.hasta ? { lte: diaDb(rango.hasta) } : {}),
  };
  return Object.keys(due).length ? { due_date: due } : {};
}

/*
 * El tipo de contrato de una tarea es el del contrato del mismo cliente y unidad vigente en su fecha de entrega
 * (el mas reciente si hay varios). Como condicion: las tareas de cada contrato del tipo pedido cuyo dia no cae
 * en un contrato anterior en la lista (mas reciente) del mismo cliente y unidad.
 */
export type ContratoVigencia = { client_id: number; area_id: number; contract_type: string; start_date: Date; end_date: Date };

export function condicionDeContrato(tipo: string, contratos: ContratoVigencia[]): Prisma.tasksWhereInput {
  const o: Prisma.tasksWhereInput[] = [];
  contratos.forEach((c, i) => {
    if (c.contract_type !== tipo) return;
    const masRecientes = contratos.slice(0, i).filter((x) => x.client_id === c.client_id && x.area_id === c.area_id);
    o.push({
      client_id: c.client_id, area_id: c.area_id,
      AND: [
        { due_date: { gte: c.start_date, lte: c.end_date } },
        ...masRecientes.map((x): Prisma.tasksWhereInput => ({ NOT: { due_date: { gte: x.start_date, lte: x.end_date } } })),
      ],
    });
  });
  return { OR: o };
}

export async function contratosVisibles(u: UsuarioActual): Promise<ContratoVigencia[]> {
  const unidades = await unidadesVisiblesFinanzas(u);
  if (!unidades.length) return [];
  return db.contracts.findMany({
    where: { area_id: { in: unidades } },
    select: { client_id: true, area_id: true, contract_type: true, start_date: true, end_date: true },
    orderBy: { start_date: "desc" },
  });
}

async function condicionesDeFiltros(u: UsuarioActual, f: FiltrosDetalle, hoy: string): Promise<Prisma.tasksWhereInput[]> {
  const y: Prisma.tasksWhereInput[] = [];
  const catalogo = await estados();
  const finales = catalogo.filter((e) => e.esFinal).map((e) => e.nombre);
  if (f.unidad) y.push({ OR: [{ areas: { name: f.unidad } }, { area_id: null, area: f.unidad }] });
  if (f.cliente) y.push({ cliente_entidad: { name: f.cliente } });
  if (f.persona) y.push({ assignee_id: Number(f.persona) });
  if (f.tipo) y.push({ cliente_entidad: { client_type: f.tipo } });
  if (f.contrato) y.push(condicionDeContrato(f.contrato, await contratosVisibles(u)));
  if (f.semana) y.push({ due_date: { gte: diaDb(lunesDe(f.semana)), lte: diaDb(sumarDias(lunesDe(f.semana), 6)) } });
  if (f.estado === "abierta") y.push({ status: { notIn: finales } });
  else if (f.estado === "vencida") y.push({ status: { notIn: finales }, due_date: { lt: diaDb(hoy) } });
  else if (GRUPOS_ESTADO.some((g) => g.valor === f.estado)) {
    y.push({ status: { in: catalogo.filter((e) => grupoDeEstado(e) === f.estado).map((e) => e.nombre) } });
  }
  return y;
}

const SELECT = {
  id: true, title: true, status: true, due_date: true, start_date: true, estimated_hours: true, done_at: true,
  assignee_id: true, asignado: { select: { username: true } },
  areas: { select: { name: true } }, area: true,
  client_id: true, cliente_entidad: { select: { name: true } },
} satisfies Prisma.tasksSelect;

function ordenDe(o: OrdenDetalle): Prisma.tasksOrderByWithRelationInput[] | null {
  if (!o) return null;
  const d = o.dir;
  const principal: Prisma.tasksOrderByWithRelationInput =
    o.col === "entrega" ? { due_date: d }
    : o.col === "tarea" ? { title: d }
    : o.col === "persona" ? { asignado: { username: d } }
    : o.col === "unidad" ? { areas: { name: d } }
    : o.col === "estado" ? { status: d }
    : { estimated_hours: { sort: d, nulls: "last" } };
  return o.col === "entrega" ? [principal, { id: "asc" }] : [principal, { due_date: "asc" }, { id: "asc" }];
}

export async function detallePanel(
  u: UsuarioActual, rango: RangoFechas, f: FiltrosDetalle, orden: OrdenDetalle, offset: number, limite: number,
): Promise<{ filas: FilaDetalle[]; total: number }> {
  const hoy = hoyNegocio();
  const [visibles, catalogo, filtros] = await Promise.all([filtroTareasVisibles(u), estados(), condicionesDeFiltros(u, f, hoy)]);
  const finales = catalogo.filter((e) => e.esFinal).map((e) => e.nombre);
  const where: Prisma.tasksWhereInput = { AND: [visibles, condicionDePeriodo(rango), ...filtros] };
  const abierta: Prisma.tasksWhereInput = { status: { notIn: finales } };
  const cerrada: Prisma.tasksWhereInput = { status: { in: finales } };

  let tareas: Prisma.tasksGetPayload<{ select: typeof SELECT }>[];
  let total: number;
  const propio = ordenDe(orden);
  if (propio) {
    [total, tareas] = await Promise.all([
      db.tasks.count({ where }),
      db.tasks.findMany({ where, orderBy: propio, skip: offset, take: limite, select: SELECT }),
    ]);
  } else {
    // Lo urgente primero: lo abierto por entrega ascendente y, al final, lo cerrado por entrega descendente.
    const abiertas = await db.tasks.count({ where: { AND: [where, abierta] } });
    const cerradas = await db.tasks.count({ where: { AND: [where, cerrada] } });
    total = abiertas + cerradas;
    const deAbiertas = offset < abiertas
      ? await db.tasks.findMany({ where: { AND: [where, abierta] }, orderBy: [{ due_date: "asc" }, { id: "asc" }], skip: offset, take: limite, select: SELECT })
      : [];
    const faltan = limite - deAbiertas.length;
    const deCerradas = faltan > 0
      ? await db.tasks.findMany({
        where: { AND: [where, cerrada] }, orderBy: [{ due_date: "desc" }, { id: "desc" }],
        skip: Math.max(0, offset - abiertas), take: faltan, select: SELECT,
      })
      : [];
    tareas = [...deAbiertas, ...deCerradas];
  }

  const ids = tareas.map((t) => t.id);
  const pasos = ids.length ? await db.task_checklist_items.groupBy({ by: ["task_id", "is_completed"], where: { task_id: { in: ids } }, _count: { _all: true } }) : [];
  const total_ = new Map<number, number>(), hechos = new Map<number, number>();
  for (const p of pasos) {
    total_.set(p.task_id, (total_.get(p.task_id) ?? 0) + p._count._all);
    if (p.is_completed) hechos.set(p.task_id, p._count._all);
  }
  const grupo = new Map(catalogo.map((e) => [e.nombre, grupoDeEstado(e)]));

  const filas: FilaDetalle[] = tareas.map((t) => ({
    id: t.id,
    titulo: t.title,
    estadoNombre: t.status,
    estado: grupo.get(t.status) ?? "en_curso",
    entrega: isoDeFecha(t.due_date) || null,
    inicio: t.start_date ? isoDeFecha(t.start_date) : null,
    horas: t.estimated_hours ?? HORAS_POR_DEFECTO,
    estimada: t.estimated_hours != null,
    pasosTotal: total_.get(t.id) ?? 0,
    pasosHechos: hechos.get(t.id) ?? 0,
    hechaEl: t.done_at ? hoyNegocio(t.done_at) : null,
    personaNombre: t.asignado.username,
    unidad: t.areas?.name ?? t.area,
    cliente: t.cliente_entidad?.name ?? "",
    clienteId: t.client_id,
  }));
  return { filas, total };
}

