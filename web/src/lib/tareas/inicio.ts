import "server-only";
import { db } from "@/lib/db";
import { alcanceUnidades, ambitoUnidades } from "@/lib/alcance";
import { estadosFinales } from "@/lib/catalogo";
import { hoyNegocio } from "@/lib/reloj";
import { tieneHerramienta, type UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import { aDTOs, diaDb, filtroVisiblesYObservadas, INCLUIR_TAREA } from "./base";
import { contarSalidas } from "./consultas";
import type { Contadores, TareaDTO } from "./tipos";

/*
 * Inicio: "lo de hoy primero". Todo sale del alcance visible de la persona;
 * nada se cuenta fuera de el.
 */

export type CambioDTO = { tarea: TareaDTO; quien: string; que: string; cuando: string };
export type CargaPersona = { id: number; nombre: string; unidad: string; abiertas: number; vencidas: number };

const RELACION_CONMIGO = (id: number) => ({ OR: [{ assignee_id: id }, { creator_id: id }, { task_watchers: { some: { user_id: id } } }] });

/* Que dice el registro, en palabras de la persona que lo lee. */
function describir(accion: string, detalle: string): string {
  if (accion === "task_comment") return "comentó";
  if (accion === "task_create") return "la creó";
  if (accion === "task_dependency_add") return "añadió una dependencia";
  if (accion === "task_dependency_remove") return "quitó una dependencia";
  const flecha = /\(([^()]+) → ([^()]+)\)/.exec(detalle);
  if (flecha) return `la movió a ${flecha[2]}`;
  if (detalle.startsWith("Etiquetas")) return "cambió las etiquetas";
  return "la actualizó";
}

export async function datosInicio(u: UsuarioActual, desde: Date) {
  const conTareas = tieneHerramienta(u, "tasks");
  const hoy = hoyNegocio();
  const finales = await estadosFinales();
  const ambito = await ambitoUnidades(u);

  const solicitudesPromesa = Promise.all([
    // Recibidas: como la lista de Flask, las que llegan a cualquier unidad del ambito.
    ambito.length ? db.task_requests.count({ where: { status: "Pendiente", to_area_id: { in: ambito } } }) : Promise.resolve(0),
    db.task_requests.count({ where: { status: "Pendiente", requester_id: u.id } }),
  ]);

  if (!conTareas) {
    const [recibidas, enviadas] = await solicitudesPromesa;
    return { conTareas, contadores: null, proximas: [], cambios: [], solicitudes: { recibidas, enviadas }, carga: null };
  }

  const visibles = await filtroTareasVisibles(u);
  const [contadores, proximasFilas, cambiadas, [recibidas, enviadas], carga] = await Promise.all([
    contarSalidas(u, "mias"),
    db.tasks.findMany({
      where: { AND: [visibles, { assignee_id: u.id, status: { notIn: finales }, due_date: { gte: diaDb(hoy) } }] },
      include: INCLUIR_TAREA, orderBy: [{ due_date: "asc" }, { id: "asc" }], take: 7,
    }),
    db.tasks.findMany({
      where: { AND: [await filtroVisiblesYObservadas(u), RELACION_CONMIGO(u.id), { updated_at: { gt: desde } }] },
      include: INCLUIR_TAREA, orderBy: { updated_at: "desc" }, take: 30,
    }),
    solicitudesPromesa,
    cargaDelAlcance(u, hoy, finales),
  ]);

  // Solo lo que cambio otra persona: lo propio ya se sabe.
  const registros = cambiadas.length ? await db.activity_logs.findMany({
    where: { entity_type: "task", entity_id: { in: cambiadas.map((t) => t.id) }, timestamp: { gt: desde }, user_id: { not: u.id } },
    orderBy: { timestamp: "desc" },
    select: { entity_id: true, action: true, detail: true, timestamp: true, users: { select: { username: true } } },
  }) : [];
  const ultimo = new Map<number, (typeof registros)[number]>();
  for (const r of registros) if (r.entity_id != null && !ultimo.has(r.entity_id)) ultimo.set(r.entity_id, r);
  const conCambio = cambiadas.filter((t) => ultimo.has(t.id)).slice(0, 8);

  const [proximas, cambiosDTO] = await Promise.all([aDTOs(proximasFilas, u.id), aDTOs(conCambio, u.id)]);
  const cambios: CambioDTO[] = cambiosDTO.map((t) => {
    const r = ultimo.get(t.id)!;
    return { tarea: t, quien: r.users.username, que: describir(r.action, r.detail ?? ""), cuando: r.timestamp?.toISOString() ?? "" };
  });

  return { conTareas, contadores: contadores as Contadores, proximas, cambios, solicitudes: { recibidas, enviadas }, carga };
}

/* Carga de quien lidera: abiertas y vencidas por persona en las unidades que supervisa. */
async function cargaDelAlcance(u: UsuarioActual, hoy: string, finales: string[]): Promise<CargaPersona[] | null> {
  const unidades = await alcanceUnidades(u);
  if (!unidades.length) return null;
  const base = { deleted_at: null, area_id: { in: unidades }, status: { notIn: finales } };
  const [abiertas, vencidas] = await Promise.all([
    db.tasks.groupBy({ by: ["assignee_id"], where: base, _count: { _all: true } }),
    db.tasks.groupBy({ by: ["assignee_id"], where: { ...base, due_date: { lt: diaDb(hoy) } }, _count: { _all: true } }),
  ]);
  const ids = abiertas.map((a) => a.assignee_id);
  const personas = ids.length ? await db.users.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, role: true, areas: { select: { name: true } } } }) : [];
  const porId = new Map(personas.map((p) => [p.id, p]));
  const venc = new Map(vencidas.map((v) => [v.assignee_id, v._count._all]));
  return abiertas
    .map((a) => ({
      id: a.assignee_id,
      nombre: porId.get(a.assignee_id)?.username ?? "",
      unidad: porId.get(a.assignee_id)?.areas?.name || porId.get(a.assignee_id)?.role || "",
      abiertas: a._count._all,
      vencidas: venc.get(a.assignee_id) ?? 0,
    }))
    .sort((a, b) => b.vencidas - a.vencidas || b.abiertas - a.abiertas || a.nombre.localeCompare(b.nombre, "es"));
}
