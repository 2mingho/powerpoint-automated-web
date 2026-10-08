import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { notificar, notificarVarios } from "@/lib/notificaciones";
import { estadosFinales } from "@/lib/catalogo";
import { hoyNegocio } from "@/lib/reloj";
import { diaDb, enlaceTarea, inicioDiaNegocioUtc } from "./base";
import { sumarDias } from "./fechas";

type Cliente = Prisma.TransactionClient | typeof db;

/*
 * Avisos del modulo. Nunca a quien hizo el cambio: lo garantiza notificar()
 * con actorId. Viajan en la misma transaccion que el cambio cuando la hay.
 */

/* A quien observa la tarea, cuando cambia de estado (_avisar_cambio_de_estado). */
export async function avisarCambioDeEstado(t: { id: number; title: string; status: string }, actorId: number, cliente: Cliente = db) {
  const obs = await cliente.task_watchers.findMany({ where: { task_id: t.id }, select: { user_id: true } });
  await notificarVarios(obs.map((o) => o.user_id), {
    tipo: "task_watching",
    titulo: `Estado actualizado en: ${t.title}`,
    cuerpo: `Nuevo estado: ${t.status}`,
    enlace: enlaceTarea(t.id),
    entidad: { tipo: "task", id: t.id },
    actorId,
  }, cliente);
}

export async function avisarAsignacion(tipo: "task_assigned" | "task_reassigned", asignadoId: number, t: { id: number; title: string }, actorId: number, cliente: Cliente = db) {
  await notificar(asignadoId, {
    tipo,
    titulo: tipo === "task_assigned" ? `Nueva tarea asignada: ${t.title}` : `Tarea reasignada: ${t.title}`,
    enlace: enlaceTarea(t.id),
    entidad: { tipo: "task", id: t.id },
    actorId,
  }, cliente);
}

/*
 * Avisos diarios de vencimiento (ensure_due_notifications): las asignadas
 * abiertas que vencen como muy tarde manana. Uno por tarea y tipo y dia.
 *
 * Flask buscaba los avisos "de hoy" desde la medianoche UTC del dia local:
 * entre las 20:00 y las 24:00 de Santo Domingo ya era otro dia UTC y repetia
 * el aviso. Aqui la ventana es el dia de negocio.
 */
export async function asegurarAvisosDeVencimiento(userId: number): Promise<number> {
  const hoy = hoyNegocio();
  const manana = sumarDias(hoy, 1);
  const tareas = await db.tasks.findMany({
    where: { assignee_id: userId, deleted_at: null, status: { notIn: await estadosFinales() }, due_date: { lte: diaDb(manana) } },
    select: { id: true, title: true, due_date: true },
  });
  if (!tareas.length) return 0;

  const inicio = inicioDiaNegocioUtc(hoy);
  const fin = inicioDiaNegocioUtc(manana);
  const ya = await db.notifications.findMany({
    where: {
      user_id: userId, entity_type: "task", kind: { in: ["task_overdue", "task_due_soon"] },
      entity_id: { in: tareas.map((t) => t.id) }, created_at: { gte: inicio, lt: fin },
    },
    select: { kind: true, entity_id: true },
  });
  const avisadas = new Set(ya.map((n) => `${n.kind}:${n.entity_id}`));

  const nuevas: Prisma.notificationsCreateManyInput[] = [];
  const ahora = new Date();
  for (const t of tareas) {
    const entrega = t.due_date.toISOString().slice(0, 10);
    const tipo = entrega < hoy ? "task_overdue" : "task_due_soon";
    if (avisadas.has(`${tipo}:${t.id}`)) continue;
    nuevas.push({
      user_id: userId,
      kind: tipo,
      title: (tipo === "task_overdue" ? `Tarea vencida: ${t.title}` : `Tarea próxima a vencer: ${t.title}`).slice(0, 255),
      link_url: enlaceTarea(t.id),
      entity_type: "task",
      entity_id: t.id,
      created_at: ahora,
    });
  }
  if (nuevas.length) await db.notifications.createMany({ data: nuevas });
  return nuevas.length;
}
