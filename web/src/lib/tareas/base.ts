import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { estados, estadosFinales, prioridades } from "@/lib/catalogo";
import { fechaDeIso, hoyNegocio, isoDeFecha } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles, puedeEditarTarea, puedeVerTarea } from "@/lib/tareas/alcance";
import type { EstadoCatalogo, EtiquetaDTO, PrioridadCatalogo, TareaDTO } from "./tipos";
import type { Tono } from "@/components/ui/estado";

/*
 * Piezas comunes del modulo: como se lee una tarea, como se serializa y como
 * se cuentan en bloque los numeros de cada fila (checklist, comentarios,
 * etiquetas, bloqueos). Todo conteo recibe ids que ya pasaron por el alcance.
 */

export const MAX_FILAS = 500;
export const COLORES_ETIQUETA: Tono[] = ["neutro", "info", "aviso", "alerta", "bien", "violeta"];

export const INCLUIR_TAREA = {
  asignado: { select: { username: true } },
  creador: { select: { username: true } },
  revisor: { select: { username: true } },
  // Si es un paso de estudio, el estudio al que pertenece.
  padre: { select: { id: true, title: true, task_type: true } },
} satisfies Prisma.tasksInclude;

export type TareaFila = Prisma.tasksGetPayload<{ include: typeof INCLUIR_TAREA }>;

export function enlaceTarea(id: number) {
  return `/tareas?tarea=${id}`;
}

export async function catalogo(): Promise<{ estados: EstadoCatalogo[]; prioridades: PrioridadCatalogo[] }> {
  const [e, p] = await Promise.all([estados(), prioridades()]);
  return {
    estados: e.map((x) => ({ nombre: x.nombre, color: x.color, esInicial: x.esInicial, esFinal: x.esFinal })),
    prioridades: p.map((x) => ({ nombre: x.nombre, color: x.color, esDefecto: x.esDefecto })),
  };
}

export function etiquetaDTO(e: { id: number; nombre: string; color: string; area_id: number | null; areas?: { name: string } | null }): EtiquetaDTO {
  return {
    id: e.id,
    nombre: e.nombre,
    color: (COLORES_ETIQUETA.includes(e.color as Tono) ? e.color : "neutro") as Tono,
    unidadId: e.area_id,
    unidad: e.areas?.name ?? "",
  };
}

type Extras = Pick<TareaDTO, "checklistTotal" | "checklistHechos" | "comentarios" | "observando" | "etiquetas" | "bloqueadaPorAbiertas" | "bloqueaA">;
const SIN_EXTRAS: Extras = { checklistTotal: 0, checklistHechos: 0, comentarios: 0, observando: false, etiquetas: [], bloqueadaPorAbiertas: 0, bloqueaA: 0 };

export function aDTO(t: TareaFila, finales: string[], hoy: string, extras?: Partial<Extras>): TareaDTO {
  const entrega = isoDeFecha(t.due_date);
  return {
    id: t.id,
    titulo: t.title,
    descripcion: t.description ?? "",
    cliente: t.client ?? "",
    clienteId: t.client_id,
    inicio: isoDeFecha(t.start_date),
    fin: isoDeFecha(t.end_date),
    direccion: t.directorate ?? "",
    solicitadoPor: t.requested_by ?? "",
    presupuesto: t.budget_type ?? "",
    creada: t.created_at?.toISOString() ?? "",
    entrega,
    estado: t.status,
    prioridad: t.priority || "Media",
    recurrente: !!t.is_recurrent,
    recurrencia: t.recurrence_type ?? "",
    padreId: t.parent_task_id,
    fase: t.phase ?? "",
    estudio: t.padre?.task_type === "estudio" ? { id: t.padre.id, titulo: t.padre.title } : null,
    unidad: t.area,
    unidadId: t.area_id,
    visibilidad: t.visibility || "unit",
    creadorId: t.creator_id,
    creador: t.creador?.username ?? "",
    asignadoId: t.assignee_id,
    asignado: t.asignado?.username ?? "",
    horas: t.estimated_hours,
    revisorId: t.reviewer_id,
    revisor: t.revisor?.username ?? "",
    motivoBloqueo: t.block_reason ?? "",
    cerradaEl: t.done_at?.toISOString() ?? "",
    actualizada: t.updated_at?.toISOString() ?? "",
    posicion: t.board_position,
    // Flask comparaba con el literal 'Completado'; aqui manda el catalogo.
    vencida: !!entrega && entrega < hoy && !finales.includes(t.status),
    ...SIN_EXTRAS,
    ...extras,
  };
}

/* Checklist, comentarios, observar, etiquetas y bloqueos de varias tareas: cinco consultas para todas. */
export async function extrasEnBloque(ids: number[], userId: number, finales: string[]): Promise<Map<number, Extras>> {
  const salida = new Map<number, Extras>();
  if (!ids.length) return salida;

  const [checklist, hechos, comentarios, observadas, enlaces, bloqueos, bloquea] = await Promise.all([
    db.task_checklist_items.groupBy({ by: ["task_id"], where: { task_id: { in: ids } }, _count: { _all: true } }),
    db.task_checklist_items.groupBy({ by: ["task_id"], where: { task_id: { in: ids }, is_completed: true }, _count: { _all: true } }),
    db.task_comments.groupBy({ by: ["task_id"], where: { task_id: { in: ids }, deleted_at: null }, _count: { _all: true } }),
    db.task_watchers.findMany({ where: { task_id: { in: ids }, user_id: userId }, select: { task_id: true } }),
    db.task_tag_links.findMany({
      where: { task_id: { in: ids } },
      select: { task_id: true, task_tags: { select: { id: true, nombre: true, color: true, area_id: true, areas: { select: { name: true } } } } },
      orderBy: { task_tags: { nombre: "asc" } },
    }),
    // Solo cuentan bloqueadoras abiertas y no borradas: una previa cerrada ya no bloquea.
    db.task_dependencies.groupBy({
      by: ["blocked_task_id"],
      where: { blocked_task_id: { in: ids }, bloqueadora: { deleted_at: null, status: { notIn: finales } } },
      _count: { _all: true },
    }),
    db.task_dependencies.groupBy({
      by: ["blocker_task_id"],
      where: { blocker_task_id: { in: ids }, bloqueada: { deleted_at: null } },
      _count: { _all: true },
    }),
  ]);

  for (const id of ids) salida.set(id, { ...SIN_EXTRAS, etiquetas: [] });
  for (const f of checklist) salida.get(f.task_id)!.checklistTotal = f._count._all;
  for (const f of hechos) salida.get(f.task_id)!.checklistHechos = f._count._all;
  for (const f of comentarios) salida.get(f.task_id)!.comentarios = f._count._all;
  for (const f of observadas) salida.get(f.task_id)!.observando = true;
  for (const f of enlaces) salida.get(f.task_id)!.etiquetas.push(etiquetaDTO(f.task_tags));
  for (const f of bloqueos) salida.get(f.blocked_task_id)!.bloqueadaPorAbiertas = f._count._all;
  for (const f of bloquea) salida.get(f.blocker_task_id)!.bloqueaA = f._count._all;
  return salida;
}

export async function aDTOs(tareas: TareaFila[], userId: number): Promise<TareaDTO[]> {
  const finales = await estadosFinales();
  const hoy = hoyNegocio();
  const extras = await extrasEnBloque(tareas.map((t) => t.id), userId, finales);
  return tareas.map((t) => aDTO(t, finales, hoy, extras.get(t.id)));
}

/*
 * Busca una tarea viva. Lo que no se puede ver responde 404, igual que lo que
 * no existe: un 403 aqui confirmaria que hay una tarea con ese id en otra
 * unidad. El 403 queda para lo que se ve pero no se puede tocar (una tarea
 * compartida que solo se observa).
 */
export async function tareaVisible(u: UsuarioActual, id: number): Promise<TareaFila> {
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApi(404, "La tarea no existe o no la puedes ver.");
  // Un estudio (el contenedor) no es una tarea: se abre por /api/estudios.
  const t = await db.tasks.findFirst({ where: { id, deleted_at: null, task_type: { not: "estudio" } }, include: INCLUIR_TAREA });
  if (!t || !(await puedeVerTarea(u, t))) throw new ErrorApi(404, "La tarea no existe o no la puedes ver.");
  return t;
}

export async function tareaEditable(u: UsuarioActual, id: number): Promise<TareaFila> {
  const t = await tareaVisible(u, id);
  if (!(await puedeEditarTarea(u, t))) throw new ErrorApi(403, "Solo puedes ver esta tarea; no puedes cambiarla.");
  return t;
}

/* Visibles mas las compartidas que observa (para "cambió desde tu última visita"). */
export async function filtroVisiblesYObservadas(u: UsuarioActual): Promise<Prisma.tasksWhereInput> {
  return {
    OR: [
      await filtroTareasVisibles(u),
      { deleted_at: null, task_type: { not: "estudio" }, visibility: "shared", task_watchers: { some: { user_id: u.id } } },
    ],
  };
}

export function idDeRuta(valor: string): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

export function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : valor == null ? "" : String(valor).trim();
}

/* Tope de las descripciones (tareas, plantillas, solicitudes): la columna es TEXT, sin limite propio. */
export const MAX_DESCRIPCION = 10_000;

export function descripcion(valor: unknown): string {
  const d = texto(valor);
  if (d.length > MAX_DESCRIPCION) throw new ErrorApi(400, `La descripción no puede pasar de ${MAX_DESCRIPCION.toLocaleString("es")} caracteres.`);
  return d;
}

export function diaDb(iso: string) {
  return fechaDeIso(iso) as Date;
}

/* Area de la tarea a partir de su asignado (_task_area_for_user). La columna mide 20. */
export function areaDe(asignado: { role: string; area_id: number | null; areas: { name: string } | null }) {
  return { area: (asignado.areas?.name || "Sin unidad").slice(0, 20), area_id: asignado.area_id };
}

/* Inicio del dia de negocio en UTC (Santo Domingo es UTC-4 todo el ano). */
export function inicioDiaNegocioUtc(iso: string): Date {
  return new Date(`${iso}T04:00:00.000Z`);
}
