import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { alcanceUnidades } from "@/lib/alcance";
import { estados, estadosFinales, prioridadPorDefecto, type Estado } from "@/lib/catalogo";
import { hoyNegocio, isoDeFecha } from "@/lib/reloj";
import { calorDeEquipo, type CalorEquipo } from "./calor";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import type { UsuarioActual } from "@/lib/auth/session";
import {
  cargaDesdeConteos, generarCsv, lunesDe, sumarDias, tendenciaDesdeMarcas, vencidasPorUnidadDesdeConteos, DIAS_RIESGO,
  type Contadores, type FilaCarga, type FilaUnidad, type PuntoTendencia,
} from "./agregados";

/*
 * Panel de equipo (/tasks/team-dashboard y api/team/* de Flask).
 *
 * Dos filtros a la vez, nunca uno solo:
 *  1. filtroTareasVisibles(u): la regla general de visibilidad de tareas.
 *  2. area_id dentro del ALCANCE (alcanceUnidades), no del ambito: aqui la
 *     pregunta es que supervisa, y pertenecer a una unidad no da derecho a ver
 *     a los companeros en el panel.
 * Pedir una unidad fuera del alcance no amplia nada: es "ajena" y quien llama
 * responde 403 (API) o vacio (pagina).
 */

export const MAX_FILAS = 500;
export const VISTAS = ["abiertas", "vencidas", "semana", "riesgo"] as const;
export type Vista = (typeof VISTAS)[number];

export type FiltrosEquipo = {
  unidad?: number | null;
  estado?: string;
  asignado?: number | null;
  cliente?: string;
  q?: string;
  vista?: Vista | null;
};

export function leerFiltros(p: URLSearchParams | Record<string, string | string[] | undefined>): FiltrosEquipo {
  const get = (k: string) => {
    const v = p instanceof URLSearchParams ? p.get(k) : p[k];
    return (Array.isArray(v) ? v[0] : v ?? "").trim();
  };
  const num = (k: string) => { const n = Number(get(k)); return Number.isInteger(n) && n > 0 ? n : null; };
  const vista = get("vista");
  return {
    unidad: num("unidad"),
    estado: get("estado").slice(0, 30),
    asignado: num("asignado"),
    cliente: get("cliente").slice(0, 100),
    q: get("q").slice(0, 100),
    vista: (VISTAS as readonly string[]).includes(vista) ? (vista as Vista) : null,
  };
}

export type Alcance = { todas: number[]; elegidas: number[]; ajena: boolean };

export async function resolverAlcance(u: UsuarioActual, unidad: number | null | undefined): Promise<Alcance> {
  const todas = await alcanceUnidades(u);
  if (unidad == null) return { todas, elegidas: todas, ajena: false };
  if (!todas.includes(unidad)) return { todas, elegidas: [], ajena: true };
  return { todas, elegidas: [unidad], ajena: false };
}

/* Medianoche de un dia de negocio en UTC (Santo Domingo es UTC-4 todo el ano). */
function inicioDiaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00-04:00`);
}

export async function whereBase(u: UsuarioActual, unidades: number[]): Promise<Prisma.tasksWhereInput> {
  return { AND: [await filtroTareasVisibles(u), { area_id: { in: unidades } }] };
}

async function whereFiltrado(u: UsuarioActual, unidades: number[], f: FiltrosEquipo): Promise<Prisma.tasksWhereInput> {
  const hoy = hoyNegocio();
  const finales = await estadosFinales();
  const y: Prisma.tasksWhereInput[] = [await whereBase(u, unidades)];
  if (f.estado && (await estados()).some((e) => e.nombre === f.estado)) y.push({ status: f.estado });
  if (f.asignado) y.push({ assignee_id: f.asignado });
  if (f.cliente) y.push({ client: { contains: f.cliente, mode: "insensitive" } });
  if (f.q) y.push({ title: { contains: f.q, mode: "insensitive" } });
  const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  if (f.vista === "abiertas") y.push({ status: { notIn: finales } });
  if (f.vista === "vencidas") y.push({ status: { notIn: finales }, due_date: { lt: dia(hoy) } });
  if (f.vista === "riesgo") y.push({ status: { notIn: finales }, due_date: { gte: dia(hoy), lte: dia(sumarDias(hoy, DIAS_RIESGO)) } });
  if (f.vista === "semana") y.push({ status: { in: finales }, updated_at: { gte: inicioDiaUtc(lunesDe(hoy)) } });
  return { AND: y };
}

export type PanelEquipo = {
  hoy: string;
  unidades: { id: number; nombre: string }[];
  estados: Estado[];
  contadores: Contadores;
  carga: FilaCarga[];
  tendencia: PuntoTendencia[];
  porUnidad: FilaUnidad[];
  calor: CalorEquipo;
};

export async function panelEquipo(u: UsuarioActual, alcance: Alcance): Promise<PanelEquipo> {
  const hoy = hoyNegocio();
  const [catalogo, finalesLista, unidades] = await Promise.all([
    estados(),
    estadosFinales(),
    db.areas.findMany({ where: { id: { in: alcance.todas } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const desde = inicioDiaUtc(sumarDias(lunesDe(hoy), -7 * 7));
  const base = await whereBase(u, alcance.elegidas);
  const lunes = inicioDiaUtc(lunesDe(hoy));
  const limiteRiesgo = sumarDias(hoy, DIAS_RIESGO);

  // Tres lecturas, ninguna con una fila por tarea: las abiertas se agrupan en la base por
  // (persona, unidad, estado, fecha de entrega), que son unas cuantas filas aunque haya decenas de
  // miles de tareas; las altas y los cierres de las ultimas 8 semanas viajan como una sola columna.
  // (Antes se traia cada tarea abierta o tocada solo para sumarla aqui; y doce conteos sueltos
  // eran peor: doce escaneos de la tabla.)
  const [abiertasAgrupadas, creadas, cerradas] = await Promise.all([
    db.tasks.groupBy({
      by: ["assignee_id", "area_id", "status", "due_date"],
      where: { AND: [base, { status: { notIn: finalesLista } }] },
      _count: { _all: true },
    }),
    db.tasks.findMany({ where: { AND: [base, { created_at: { gte: desde } }] }, select: { created_at: true } }),
    db.tasks.findMany({ where: { AND: [base, { status: { in: finalesLista }, updated_at: { gte: desde } }] }, select: { updated_at: true } }),
  ]);

  const nombres = new Map(
    (await db.users.findMany({
      where: { id: { in: [...new Set(abiertasAgrupadas.map((f) => f.assignee_id))] } },
      select: { id: true, username: true },
    })).map((p) => [p.id, p.username]),
  );
  const lista = unidades.map((a) => ({ id: a.id, nombre: a.name }));

  const porPersonaEstado = new Map<string, { personaId: number; estado: string; n: number }>();
  const vencidasPersona = new Map<number, number>();
  const porUnidadMapa = new Map<number, { unidadId: number; abiertas: number; vencidas: number }>();
  let totalAbiertas = 0, totalVencidas = 0, nEnRiesgo = 0;
  for (const f of abiertasAgrupadas) {
    const n = f._count._all;
    const vence = isoDeFecha(f.due_date);
    const vencida = vence < hoy;
    totalAbiertas += n;
    if (vencida) totalVencidas += n;
    else if (vence <= limiteRiesgo) nEnRiesgo += n;
    const k = `${f.assignee_id}|${f.status}`;
    const e = porPersonaEstado.get(k) ?? { personaId: f.assignee_id, estado: f.status, n: 0 };
    e.n += n;
    porPersonaEstado.set(k, e);
    if (vencida) vencidasPersona.set(f.assignee_id, (vencidasPersona.get(f.assignee_id) ?? 0) + n);
    if (f.area_id != null) {
      const un = porUnidadMapa.get(f.area_id) ?? { unidadId: f.area_id, abiertas: 0, vencidas: 0 };
      un.abiertas += n;
      if (vencida) un.vencidas += n;
      porUnidadMapa.set(f.area_id, un);
    }
  }
  const nSemana = cerradas.filter((t) => t.updated_at && t.updated_at >= lunes).length;
  const calor = await calorDeEquipo(base, alcance.elegidas, finalesLista, hoy);
  const elegidas = lista.filter((a) => alcance.elegidas.includes(a.id));

  return {
    hoy,
    unidades: lista,
    estados: catalogo,
    contadores: { abiertas: totalAbiertas, vencidas: totalVencidas, completadasSemana: nSemana, enRiesgo: nEnRiesgo },
    carga: cargaDesdeConteos([...porPersonaEstado.values()], vencidasPersona, catalogo.map((e) => e.nombre), nombres),
    tendencia: tendenciaDesdeMarcas(creadas.map((t) => t.created_at), cerradas.map((t) => t.updated_at), hoy, 8),
    porUnidad: vencidasPorUnidadDesdeConteos([...porUnidadMapa.values()], elegidas),
    calor,
  };
}

export type FilaTareaEquipo = {
  id: number; titulo: string; cliente: string | null; clienteId: number | null; estado: string; prioridad: string; vence: string;
  asignado: string; asignadoId: number; unidad: string | null; actualizada: string | null;
};

/*
 * Lo de hoy primero: las abiertas por entrega (la mas urgente arriba) y
 * despues las terminadas, de la mas reciente a la mas antigua.
 */
export async function tareasEquipo(u: UsuarioActual, alcance: Alcance, f: FiltrosEquipo) {
  const where = await whereFiltrado(u, alcance.elegidas, f);
  const finales = await estadosFinales();
  const select = {
    id: true, title: true, client: true, client_id: true, status: true, priority: true, due_date: true, assignee_id: true, updated_at: true,
    asignado: { select: { username: true } }, areas: { select: { name: true } },
  } as const;
  const [total, abiertas] = await Promise.all([
    db.tasks.count({ where }),
    db.tasks.findMany({ where: { AND: [where, { status: { notIn: finales } }] }, orderBy: [{ due_date: "asc" }, { id: "asc" }], take: MAX_FILAS, select }),
  ]);
  const cerradas = abiertas.length < MAX_FILAS
    ? await db.tasks.findMany({ where: { AND: [where, { status: { in: finales } }] }, orderBy: [{ due_date: "desc" }, { id: "desc" }], take: MAX_FILAS - abiertas.length, select })
    : [];
  const tareas: FilaTareaEquipo[] = [...abiertas, ...cerradas].map((t) => ({
    id: t.id, titulo: t.title, cliente: t.client, clienteId: t.client_id, estado: t.status, prioridad: t.priority, vence: isoDeFecha(t.due_date),
    asignado: t.asignado.username, asignadoId: t.assignee_id, unidad: t.areas?.name ?? null,
    actualizada: t.updated_at?.toISOString() ?? null,
  }));
  return { total, tareas };
}

/* Opciones de filtro limitadas al alcance: personas activas de esas unidades y clientes de sus tareas. */
export async function opcionesEquipo(u: UsuarioActual, alcance: Alcance) {
  const [personas, clientes] = await Promise.all([
    db.users.findMany({
      where: { is_active: true, area_id: { in: alcance.elegidas } },
      select: { id: true, username: true }, orderBy: { username: "asc" },
    }),
    // groupBy y no `distinct` (que Prisma resuelve en memoria, trayendo todas las filas).
    db.tasks.groupBy({
      by: ["client"],
      where: { AND: [await whereBase(u, alcance.elegidas), { client: { not: null } }, { NOT: { client: "" } }] },
      orderBy: { client: "asc" }, take: 300,
    }),
  ]);
  return { personas: personas.map((p) => ({ id: p.id, nombre: p.username })), clientes: clientes.map((c) => c.client!).filter(Boolean) };
}

export async function csvEquipo(u: UsuarioActual, alcance: Alcance, f: FiltrosEquipo): Promise<string> {
  const filas = await db.tasks.findMany({
    where: await whereFiltrado(u, alcance.elegidas, f),
    orderBy: [{ due_date: "desc" }, { id: "asc" }],
    select: {
      start_date: true, end_date: true, due_date: true, directorate: true, client: true, title: true, requested_by: true,
      description: true, budget_type: true, priority: true, is_recurrent: true, recurrence_type: true,
      asignado: { select: { username: true } },
    },
  });
  return generarCsv(filas.map((t) => ({ ...t, asignado: t.asignado.username })), await prioridadPorDefecto());
}
