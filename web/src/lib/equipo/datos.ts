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
  cargaPorPersona, contadores, generarCsv, lunesDe, sumarDias, tendencia, vencidasPorUnidad, DIAS_RIESGO,
  type Contadores, type FilaCarga, type FilaUnidad, type PuntoTendencia, type TareaPanel,
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
  const finales = new Set(finalesLista);
  const desde = inicioDiaUtc(sumarDias(lunesDe(hoy), -7 * 7));

  // Una sola consulta con lo minimo: abiertas (carga, vencidas) y lo tocado en 8 semanas (tendencia).
  const filas = await db.tasks.findMany({
    where: {
      AND: [
        await whereBase(u, alcance.elegidas),
        { OR: [{ status: { notIn: finalesLista } }, { created_at: { gte: desde } }, { updated_at: { gte: desde } }] },
      ],
    },
    select: { id: true, status: true, due_date: true, created_at: true, updated_at: true, assignee_id: true, area_id: true },
  });
  const tareas: TareaPanel[] = filas.map((t) => ({
    id: t.id, estado: t.status, vence: isoDeFecha(t.due_date), creada: t.created_at, actualizada: t.updated_at,
    asignadoId: t.assignee_id, unidadId: t.area_id,
  }));

  const personas = await db.users.findMany({
    where: { id: { in: [...new Set(tareas.map((t) => t.asignadoId))] } },
    select: { id: true, username: true },
  });
  const nombres = new Map(personas.map((p) => [p.id, p.username]));
  const lista = unidades.map((a) => ({ id: a.id, nombre: a.name }));
  const calor = await calorDeEquipo(await whereBase(u, alcance.elegidas), alcance.elegidas, finalesLista, hoy);
  const elegidas = lista.filter((a) => alcance.elegidas.includes(a.id));

  return {
    hoy,
    unidades: lista,
    estados: catalogo,
    contadores: contadores(tareas, finales, hoy),
    carga: cargaPorPersona(tareas, finales, hoy, catalogo.map((e) => e.nombre), nombres),
    tendencia: tendencia(tareas, finales, hoy, 8),
    porUnidad: vencidasPorUnidad(tareas, finales, hoy, elegidas),
    calor,
  };
}

export type FilaTareaEquipo = {
  id: number; titulo: string; cliente: string | null; estado: string; prioridad: string; vence: string;
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
    id: true, title: true, client: true, status: true, priority: true, due_date: true, assignee_id: true, updated_at: true,
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
    id: t.id, titulo: t.title, cliente: t.client, estado: t.status, prioridad: t.priority, vence: isoDeFecha(t.due_date),
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
    db.tasks.findMany({
      where: { AND: [await whereBase(u, alcance.elegidas), { client: { not: null } }, { NOT: { client: "" } }] },
      distinct: ["client"], select: { client: true }, orderBy: { client: "asc" }, take: 300,
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
