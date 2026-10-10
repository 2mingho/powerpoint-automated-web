import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { alcanceUnidades } from "@/lib/alcance";
import { estados, estadosFinales, prioridadPorDefecto, type Estado } from "@/lib/catalogo";
import { hoyNegocio, isoDeFecha } from "@/lib/reloj";
import { calorDeEquipo, type CalorEquipo } from "./calor";
import { filtroTareasVisibles, visibilidadSql } from "@/lib/tareas/alcance";
import type { UsuarioActual } from "@/lib/auth/session";
import {
  cargaDesdeConteos, generarCsv, lunesDe, sumarDias, tendenciaDesdeSemanas, vencidasPorUnidadDesdeConteos, DIAS_RIESGO,
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
  const base = await whereBase(u, alcance.elegidas);
  const limiteRiesgo = sumarDias(hoy, DIAS_RIESGO);
  const lunesActual = lunesDe(hoy);
  const desde = inicioDiaUtc(sumarDias(lunesActual, -7 * 7)).toISOString().slice(0, 19);
  const visible = await visibilidadSql(u);
  const enAlcance = Prisma.sql`${visible} AND t.area_id = ANY(${alcance.elegidas}::int[])`;

  // Dos consultas agregadas en la base, ninguna con una fila por tarea. Antes se traia cada tarea abierta o
  // tocada en 8 semanas solo para sumarla aqui, y con decenas de miles era lo que tardaba (y con mas de
  // 32.000 abiertas fallaba). Salen unas decenas de filas: una por persona, unidad y estado, y una por semana.
  // La semana es la de Santo Domingo (UTC-4 todo el ano): se resta 4 h a la marca antes de truncar al lunes.
  const [abiertasAgrupadas, semanasFilas] = await Promise.all([
    db.$queryRaw<{ persona: number; unidad: number | null; estado: string; n: number; vencidas: number; en_riesgo: number }[]>`
      SELECT t.assignee_id AS persona, t.area_id AS unidad, t.status AS estado, count(*)::int AS n,
             (count(*) FILTER (WHERE t.due_date < ${hoy}::date))::int AS vencidas,
             (count(*) FILTER (WHERE t.due_date >= ${hoy}::date AND t.due_date <= ${limiteRiesgo}::date))::int AS en_riesgo
      FROM tasks t
      WHERE ${enAlcance} AND t.status <> ALL(${finalesLista}::text[])
      GROUP BY t.assignee_id, t.area_id, t.status`,
    db.$queryRaw<{ tipo: string; semana: string; n: number }[]>`
      SELECT 'creadas' AS tipo, to_char(date_trunc('week', t.created_at - interval '4 hours'), 'YYYY-MM-DD') AS semana, count(*)::int AS n
      FROM tasks t WHERE ${enAlcance} AND t.created_at >= ${desde}::timestamp GROUP BY 2
      UNION ALL
      SELECT 'cerradas', to_char(date_trunc('week', t.updated_at - interval '4 hours'), 'YYYY-MM-DD'), count(*)::int
      FROM tasks t WHERE ${enAlcance} AND t.status = ANY(${finalesLista}::text[]) AND t.updated_at >= ${desde}::timestamp GROUP BY 2`,
  ]);
  const creadasSemana = new Map<string, number>(), cerradasSemana = new Map<string, number>();
  for (const f of semanasFilas) (f.tipo === "creadas" ? creadasSemana : cerradasSemana).set(f.semana, f.n);

  const nombres = new Map(
    (await db.users.findMany({
      where: { id: { in: [...new Set(abiertasAgrupadas.map((f) => f.persona))] } },
      select: { id: true, username: true },
    })).map((p) => [p.id, p.username]),
  );
  const lista = unidades.map((a) => ({ id: a.id, nombre: a.name }));

  const porPersonaEstado = new Map<string, { personaId: number; estado: string; n: number }>();
  const vencidasPersona = new Map<number, number>();
  const porUnidadMapa = new Map<number, { unidadId: number; abiertas: number; vencidas: number }>();
  let totalAbiertas = 0, totalVencidas = 0, nEnRiesgo = 0;
  for (const f of abiertasAgrupadas) {
    totalAbiertas += f.n;
    totalVencidas += f.vencidas;
    nEnRiesgo += f.en_riesgo;
    const k = `${f.persona}|${f.estado}`;
    const e = porPersonaEstado.get(k) ?? { personaId: f.persona, estado: f.estado, n: 0 };
    e.n += f.n;
    porPersonaEstado.set(k, e);
    if (f.vencidas) vencidasPersona.set(f.persona, (vencidasPersona.get(f.persona) ?? 0) + f.vencidas);
    if (f.unidad != null) {
      const un = porUnidadMapa.get(f.unidad) ?? { unidadId: f.unidad, abiertas: 0, vencidas: 0 };
      un.abiertas += f.n;
      un.vencidas += f.vencidas;
      porUnidadMapa.set(f.unidad, un);
    }
  }
  // Lo cerrado esta semana: los cierres de la semana actual (la ultima del conteo).
  const nSemana = cerradasSemana.get(lunesActual) ?? 0;
  const calor = await calorDeEquipo(u, base, alcance.elegidas, finalesLista, hoy, [...new Set(abiertasAgrupadas.map((f) => f.persona))]);
  const elegidas = lista.filter((a) => alcance.elegidas.includes(a.id));

  return {
    hoy,
    unidades: lista,
    estados: catalogo,
    contadores: { abiertas: totalAbiertas, vencidas: totalVencidas, completadasSemana: nSemana, enRiesgo: nEnRiesgo },
    carga: cargaDesdeConteos([...porPersonaEstado.values()], vencidasPersona, catalogo.map((e) => e.nombre), nombres),
    tendencia: tendenciaDesdeSemanas(creadasSemana, cerradasSemana, hoy, 8),
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
