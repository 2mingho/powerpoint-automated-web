import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { estados, estadosFinales, prioridadesValidas } from "@/lib/catalogo";
import { hoyNegocio } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import { aDTOs, diaDb, filtroVisiblesYObservadas, INCLUIR_TAREA, MAX_FILAS } from "./base";
import { esIsoValida } from "./fechas";
import type { Alcance, Contadores, FiltroRapido, Filtros } from "./tipos";

/*
 * Lista, contadores y tablero. Los chips y filtros se aplican DESPUES del
 * alcance y siempre con AND: estrechan lo que la unidad permite, nunca lo
 * amplian (test_scope_nunca_amplia_visibilidad).
 */

export const DIAS_DE_CERRADAS = 14;

const ALCANCES: Alcance[] = ["mias", "creadas", "unidad", "observadas"];
const FILTROS: FiltroRapido[] = ["", "vencidas", "hoy", "en_curso", "bloqueadas"];

export function leerFiltros(p: URLSearchParams | Record<string, string | string[] | undefined>): Filtros {
  const get = (k: string) => {
    const v = p instanceof URLSearchParams ? p.get(k) : p[k];
    return (Array.isArray(v) ? v[0] : v ?? "").trim();
  };
  const alcance = get("alcance") as Alcance;
  const filtro = get("filtro") as FiltroRapido;
  const num = (k: string) => (/^\d+$/.test(get(k)) ? get(k) : "");
  return {
    alcance: ALCANCES.includes(alcance) ? alcance : "mias",
    filtro: FILTROS.includes(filtro) ? filtro : "",
    q: get("q").slice(0, 100),
    prioridad: get("prioridad").slice(0, 10),
    persona: num("persona"),
    cliente: get("cliente").slice(0, 100),
    etiqueta: num("etiqueta"),
    unidad: num("unidad"),
  };
}

async function estadosIntermedios() {
  return (await estados()).filter((e) => !e.esInicial && !e.esFinal).map((e) => e.nombre);
}

/* Condiciones de los cuatro contadores de la franja (y de su filtro). */
async function condicionRapida(filtro: FiltroRapido, hoy: string, finales: string[]): Promise<Prisma.tasksWhereInput | null> {
  const abierta: Prisma.tasksWhereInput = { status: { notIn: finales } };
  switch (filtro) {
    case "vencidas": return { ...abierta, due_date: { lt: diaDb(hoy) } };
    case "hoy": return { ...abierta, due_date: diaDb(hoy) };
    case "en_curso": return { status: { in: await estadosIntermedios() } };
    case "bloqueadas": return {
      ...abierta,
      bloqueada_por: { some: { bloqueadora: { deleted_at: null, status: { notIn: finales } } } },
    };
    default: return null;
  }
}

function condicionAlcance(u: UsuarioActual, alcance: Alcance): Prisma.tasksWhereInput | null {
  if (alcance === "mias") return { assignee_id: u.id };
  if (alcance === "creadas") return { creator_id: u.id };
  // Las que observo, sean de mi ambito o compartidas por otra unidad (api_tasks_watching de Flask).
  if (alcance === "observadas") return { task_watchers: { some: { user_id: u.id } } };
  return null;
}

/* Lo observado incluye las tareas compartidas de otra unidad que se observan; el resto, lo del ambito. */
function visibleSegun(u: UsuarioActual, alcance: Alcance) {
  return alcance === "observadas" ? filtroVisiblesYObservadas(u) : filtroTareasVisibles(u);
}

/* Condiciones de filtro (sin alcance de visibilidad ni rango). */
export async function condicionesFiltro(u: UsuarioActual, f: Filtros, hoy: string, finales: string[]): Promise<Prisma.tasksWhereInput[]> {
  const y: Prisma.tasksWhereInput[] = [];
  const a = condicionAlcance(u, f.alcance);
  if (a) y.push(a);
  const r = await condicionRapida(f.filtro, hoy, finales);
  if (r) y.push(r);
  if (f.q.length >= 2) {
    y.push({ OR: [
      { title: { contains: f.q, mode: "insensitive" } },
      { description: { contains: f.q, mode: "insensitive" } },
      { client: { contains: f.q, mode: "insensitive" } },
    ] });
  }
  if (f.prioridad && (await prioridadesValidas()).includes(f.prioridad)) y.push({ priority: f.prioridad });
  if (f.persona) y.push({ assignee_id: Number(f.persona) });
  if (f.cliente) y.push({ client: { contains: f.cliente, mode: "insensitive" } });
  if (f.etiqueta) y.push({ task_tag_links: { some: { tag_id: Number(f.etiqueta) } } });
  // La unidad solo la filtra un admin: para el resto ya la fija el alcance.
  if (f.unidad && u.isAdmin) y.push({ area_id: Number(f.unidad) });
  return y;
}

/*
 * Lista del panel de salidas y del calendario.
 *   - Sin rango: todo lo abierto mas lo cerrado en los ultimos 14 dias.
 *   - Con rango (calendario): todo lo que vence en el rango, cerrado o no.
 * Ordenada por entrega y con tope de 500 (FUN-04).
 */
export async function listarTareas(u: UsuarioActual, f: Filtros, rango?: { desde: string; hasta: string }, maximo = MAX_FILAS) {
  const finales = await estadosFinales();
  const hoy = hoyNegocio();
  const y: Prisma.tasksWhereInput[] = [await visibleSegun(u, f.alcance), ...(await condicionesFiltro(u, f, hoy, finales))];
  if (rango && f.filtro !== "vencidas") {
    if (esIsoValida(rango.desde)) y.push({ due_date: { gte: diaDb(rango.desde) } });
    if (esIsoValida(rango.hasta)) y.push({ due_date: { lte: diaDb(rango.hasta) } });
  } else if (!rango) {
    const desde = new Date(Date.now() - DIAS_DE_CERRADAS * 86_400_000);
    y.push({ OR: [{ status: { notIn: finales } }, { updated_at: { gte: desde } }] });
  }
  const filas = await db.tasks.findMany({
    where: { AND: y },
    include: INCLUIR_TAREA,
    orderBy: [{ due_date: "asc" }, { id: "asc" }],
    take: maximo + 1,
  });
  const truncada = filas.length > maximo;
  return { tareas: await aDTOs(filas.slice(0, maximo), u.id), truncada };
}

/* Los cuatro contadores, dentro del alcance visible y del chip elegido. */
export async function contarSalidas(u: UsuarioActual, alcance: Alcance): Promise<Contadores> {
  const finales = await estadosFinales();
  const hoy = hoyNegocio();
  const base: Prisma.tasksWhereInput[] = [await visibleSegun(u, alcance)];
  const a = condicionAlcance(u, alcance);
  if (a) base.push(a);
  const contar = async (filtro: FiltroRapido) =>
    db.tasks.count({ where: { AND: [...base, (await condicionRapida(filtro, hoy, finales))!] } });
  const [vencidas, deHoy, enCurso, bloqueadas] = await Promise.all([
    contar("vencidas"), contar("hoy"), contar("en_curso"), contar("bloqueadas"),
  ]);
  return { vencidas, hoy: deHoy, enCurso, bloqueadas };
}

/* Tablero: mismas reglas que la lista; cerradas solo las de los ultimos `dias`. */
export async function tablero(u: UsuarioActual, f: Filtros, dias: number) {
  const finales = await estadosFinales();
  const hoy = hoyNegocio();
  const desde = new Date(Date.now() - dias * 86_400_000);
  const filas = await db.tasks.findMany({
    where: { AND: [
      await visibleSegun(u, f.alcance),
      ...(await condicionesFiltro(u, f, hoy, finales)),
      { OR: [{ status: { notIn: finales } }, { updated_at: { gte: desde } }] },
    ] },
    include: INCLUIR_TAREA,
    // Colocadas a mano primero, por posicion; el resto por entrega.
    orderBy: [{ board_position: { sort: "asc", nulls: "last" } }, { due_date: "asc" }, { id: "asc" }],
    take: MAX_FILAS + 1,
  });
  return { tareas: await aDTOs(filas.slice(0, MAX_FILAS), u.id), truncada: filas.length > MAX_FILAS, dias };
}
