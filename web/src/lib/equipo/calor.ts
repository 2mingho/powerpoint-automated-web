import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { UsuarioActual } from "@/lib/auth/session";
import { isoDeFecha } from "@/lib/reloj";
import { HORAS_POR_DEFECTO } from "@/lib/seguimiento/estado";
import { mapaDeCalor, semanasDesde, type FilaCalor, type TareaDeCarga, type VencidasDePersona } from "@/lib/seguimiento/mapa-calor";
import { HORAS_POR_DIA } from "@/lib/seguimiento/riesgo";
import { visibilidadSql } from "@/lib/tareas/alcance";
import { diaDb } from "@/lib/tareas/base";
import { sumarDias } from "@/lib/tareas/fechas";

/*
 * Mapa de calor de carga de un alcance. `where` ya trae la visibilidad
 * (filtroTareasVisibles) y las unidades elegidas. Las personas son las activas de esas
 * unidades mas quien tenga tareas abiertas en ellas, aunque ya no este activo (`asignados`).
 *
 * Repartir las horas de cada tarea abierta es lo caro (34.000 abiertas = 34.000 repartos), y casi todo
 * eso es innecesario: solo carga la ventana (4 semanas) lo que cae en ella. Por eso:
 *   - las VENCIDAS (que cargan todo su resto en hoy) se suman en la base, una fila por persona;
 *   - de las demas solo se leen las que pueden tocar la ventana: vencen dentro de ella, o empiezan antes
 *     de que acabe, o (sin fecha de inicio) empiezan antes por sus horas. Es un filtro por exceso: lo que
 *     sobra reparte ceros, nunca cambia una cifra.
 * La prueba mapa-calor.test.ts comprueba que sumar las vencidas aparte da lo mismo que repartirlas una a una.
 */
export type CalorEquipo = { semanas: string[]; filas: FilaCalor[] };

export const SEMANAS_DE_CALOR = 4;

/* Dias de calendario que puede adelantarse el inicio de una tarea sin fecha de inicio por sus horas (dias habiles de trabajo, con fines de semana). */
function margenPorHoras(maxHoras: number): number {
  return Math.ceil((Math.ceil(maxHoras / HORAS_POR_DIA) * 7) / 5) + 4;
}

export async function calorDeEquipo(
  u: UsuarioActual, where: Prisma.tasksWhereInput, unidades: number[], finales: string[], hoy: string, asignados: number[],
): Promise<CalorEquipo> {
  const semanas = semanasDesde(hoy, SEMANAS_DE_CALOR);
  const finVentana = sumarDias(semanas[semanas.length - 1], 6);
  const abierta: Prisma.tasksWhereInput = { AND: [where, { status: { notIn: finales } }] };

  const [vencidasFilas, mayor] = await Promise.all([
    // Vencidas: el resto de cada una (horas por (1 - avance de sus pasos)) sumado por persona, en la base.
    db.$queryRaw<{ persona: number; tareas: number; sin_estimar: number; horas: number }[]>`
      SELECT persona, count(*)::int AS tareas, (count(*) FILTER (WHERE sin_estimar))::int AS sin_estimar, sum(resto)::float8 AS horas
      FROM (
        SELECT t.assignee_id AS persona, (t.estimated_hours IS NULL) AS sin_estimar,
               coalesce(t.estimated_hours, ${HORAS_POR_DEFECTO}::float8)
                 * (1 - CASE WHEN coalesce(c.total, 0) > 0 THEN least(1::float8, c.hechos::float8 / c.total) ELSE 0 END) AS resto
        FROM tasks t
        LEFT JOIN (
          SELECT task_id, count(*) AS total, count(*) FILTER (WHERE is_completed) AS hechos FROM task_checklist_items GROUP BY task_id
        ) c ON c.task_id = t.id
        WHERE ${await visibilidadSql(u)} AND t.area_id = ANY(${unidades}::int[])
          AND t.status <> ALL(${finales}::text[]) AND t.due_date < ${hoy}::date
      ) v
      WHERE resto > 0
      GROUP BY persona`,
    db.tasks.aggregate({ where: { AND: [abierta, { due_date: { gt: diaDb(finVentana) } }] }, _max: { estimated_hours: true } }),
  ]);
  const vencidas = new Map<number, VencidasDePersona>(vencidasFilas.map((f) => [f.persona, { tareas: f.tareas, sinEstimar: f.sin_estimar, horas: f.horas }]));

  // Las demas abiertas que pueden tocar la ventana.
  const limiteSinInicio = sumarDias(finVentana, margenPorHoras(Math.max(mayor._max.estimated_hours ?? 0, HORAS_POR_DEFECTO)));
  const queTocanLaVentana: Prisma.tasksWhereInput = {
    AND: [abierta, { due_date: { gte: diaDb(hoy) } }, { OR: [{ due_date: { lte: diaDb(limiteSinInicio) } }, { start_date: { lte: diaDb(finVentana) } }] }],
  };
  const cercanas = await db.tasks.findMany({
    where: queTocanLaVentana,
    select: { id: true, assignee_id: true, due_date: true, start_date: true, estimated_hours: true },
  });
  const ids = cercanas.map((t) => t.id);
  const [pasosFilas, personas] = await Promise.all([
    ids.length
      ? db.task_checklist_items.groupBy({ by: ["task_id", "is_completed"], where: { tasks: { is: queTocanLaVentana } }, _count: { _all: true } })
      : [],
    db.users.findMany({
      where: { OR: [{ is_active: true, area_id: { in: unidades } }, { id: { in: asignados } }] },
      select: { id: true, username: true, weekly_capacity: true },
    }),
  ]);
  const pasos = new Map<number, number>();
  const pasosHechos = new Map<number, number>();
  for (const f of pasosFilas) {
    pasos.set(f.task_id, (pasos.get(f.task_id) ?? 0) + f._count._all);
    if (f.is_completed) pasosHechos.set(f.task_id, f._count._all);
  }

  const tareas: TareaDeCarga[] = cercanas.map((t) => ({
    estado: "en_curso",
    entrega: isoDeFecha(t.due_date),
    inicio: t.start_date ? isoDeFecha(t.start_date) : null,
    horas: t.estimated_hours ?? 0,
    estimada: t.estimated_hours != null,
    pasosTotal: pasos.get(t.id) ?? 0,
    pasosHechos: pasosHechos.get(t.id) ?? 0,
    personaId: t.assignee_id,
  }));
  const filas = mapaDeCalor(personas.map((p) => ({ id: p.id, nombre: p.username, capacidad: p.weekly_capacity })), tareas, semanas, hoy, vencidas);
  return { semanas, filas };
}
