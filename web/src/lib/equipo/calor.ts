import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isoDeFecha } from "@/lib/reloj";
import { mapaDeCalor, semanasDesde, type FilaCalor, type TareaDeCarga } from "@/lib/seguimiento/mapa-calor";

/*
 * Mapa de calor de carga de un alcance. `where` ya trae la visibilidad
 * (filtroTareasVisibles) y las unidades elegidas; aqui solo se leen las abiertas
 * y se reparten sus horas. Las personas son las activas de esas unidades mas
 * quien tenga tareas abiertas en ellas, aunque ya no este activo.
 */
export type CalorEquipo = { semanas: string[]; filas: FilaCalor[] };

export const SEMANAS_DE_CALOR = 4;

export async function calorDeEquipo(where: Prisma.tasksWhereInput, unidades: number[], finales: string[], hoy: string): Promise<CalorEquipo> {
  const semanas = semanasDesde(hoy, SEMANAS_DE_CALOR);
  const abiertas = await db.tasks.findMany({
    where: { AND: [where, { status: { notIn: finales } }] },
    select: { id: true, assignee_id: true, due_date: true, start_date: true, estimated_hours: true },
  });
  // Los pasos se filtran con la misma condicion (relacion), no con una lista de ids: con decenas de
  // miles de abiertas esa lista era un IN gigante que Prisma tenia que partir en varias consultas.
  const deAbiertas = { tasks: { is: { AND: [where, { status: { notIn: finales } }] } } };
  const [pasosAgrupados, personas] = await Promise.all([
    db.task_checklist_items.groupBy({ by: ["task_id", "is_completed"], where: deAbiertas, _count: { _all: true } }),
    db.users.findMany({
      where: { OR: [{ is_active: true, area_id: { in: unidades } }, { id: { in: [...new Set(abiertas.map((t) => t.assignee_id))] } }] },
      select: { id: true, username: true, weekly_capacity: true },
    }),
  ]);
  const pasos = new Map<number, number>();
  const pasosHechos = new Map<number, number>();
  for (const f of pasosAgrupados) {
    pasos.set(f.task_id, (pasos.get(f.task_id) ?? 0) + f._count._all);
    if (f.is_completed) pasosHechos.set(f.task_id, f._count._all);
  }

  const tareas: TareaDeCarga[] = abiertas.map((t) => ({
    estado: "en_curso",
    entrega: isoDeFecha(t.due_date),
    inicio: t.start_date ? isoDeFecha(t.start_date) : null,
    horas: t.estimated_hours ?? 0,
    estimada: t.estimated_hours != null,
    pasosTotal: pasos.get(t.id) ?? 0,
    pasosHechos: pasosHechos.get(t.id) ?? 0,
    personaId: t.assignee_id,
  }));
  const filas = mapaDeCalor(personas.map((p) => ({ id: p.id, nombre: p.username, capacidad: p.weekly_capacity })), tareas, semanas, hoy);
  return { semanas, filas };
}
