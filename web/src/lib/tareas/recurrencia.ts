import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { estadoInicial } from "@/lib/catalogo";
import { isoDeFecha } from "@/lib/reloj";
import { avisarAsignacion } from "./avisos";
import { diaDb } from "./base";
import { diasEntre, siguienteEntrega, sumarDias } from "./fechas";

/*
 * Recurrencia: la SIGUIENTE tarea de una serie se crea cuando se cierra la anterior,
 * no antes. Sale para el mismo dia de la semana (semanal) o del mes (mensual) que la
 * primera, a partir de la ENTREGA de la que se cierra, no del dia en que se cierra
 * (ver siguienteEntrega). Sin fecha de fin la serie sigue mientras se vayan cerrando.
 */

export type SiguienteCreada = { de: number; id: number; entrega: string };

/*
 * Para las tareas que acaban de pasar a un estado final: crea la siguiente de las que
 * son recurrentes. Va dentro de la transaccion del cierre, asi cierre y siguiente son
 * una sola cosa. No crea nada si:
 *   - la siguiente pasaria de la fecha de fin de la serie (end_date de la primera);
 *   - la serie ya tiene una tarea para esa fecha o despues (una serie precalculada por
 *     la version anterior, o una siguiente que ya se creo y se borro: no se resucita).
 */
export async function crearSiguientes(tx: Prisma.TransactionClient, cerradas: number[], actorId: number, ahora: Date): Promise<SiguienteCreada[]> {
  if (!cerradas.length) return [];
  const filas = await tx.tasks.findMany({
    where: { id: { in: cerradas }, is_recurrent: true, recurrence_type: { not: null }, deleted_at: null, task_type: "normal" },
    include: { task_checklist_items: { orderBy: { position: "asc" } }, task_tag_links: true, task_watchers: true },
  });
  const inicial = filas.length ? await estadoInicial() : "";
  const creadas: SiguienteCreada[] = [];
  for (const t of filas) {
    const raiz = t.parent_task_id ?? t.id;
    const primera = t.parent_task_id ? await tx.tasks.findUnique({ where: { id: raiz }, select: { due_date: true, end_date: true } }) : t;
    if (!primera) continue;
    const entrega = isoDeFecha(t.due_date);
    const proxima = siguienteEntrega(t.recurrence_type!, entrega, isoDeFecha(primera.due_date));
    if (!proxima) continue;
    // end_date de una serie es su fin; lo toma de la primera para que moverlo en una sola no la alargue.
    const finSerie = primera.end_date ? isoDeFecha(primera.end_date) : "";
    if (finSerie && proxima > finSerie) continue;
    const yaHay = await tx.tasks.findFirst({ where: { OR: [{ id: raiz }, { parent_task_id: raiz }], due_date: { gte: diaDb(proxima) } }, select: { id: true } });
    if (yaHay) continue;

    const desfase = t.start_date ? diasEntre(isoDeFecha(t.start_date), entrega) : null;
    const nueva = await tx.tasks.create({
      data: {
        title: t.title, description: t.description, client: t.client, client_id: t.client_id,
        directorate: t.directorate, requested_by: t.requested_by, budget_type: t.budget_type,
        // El inicio conserva su distancia a la entrega.
        start_date: desfase === null ? null : diaDb(sumarDias(proxima, -desfase)),
        end_date: t.end_date, due_date: diaDb(proxima),
        status: inicial, priority: t.priority, is_recurrent: true, recurrence_type: t.recurrence_type, parent_task_id: raiz,
        area: t.area, area_id: t.area_id, creator_id: t.creator_id, assignee_id: t.assignee_id, visibility: t.visibility,
        estimated_hours: t.estimated_hours, reviewer_id: t.reviewer_id,
        created_at: ahora, updated_at: ahora,
      },
      select: { id: true, title: true },
    });
    // Lo que la tarea traia (pasos, etiquetas, quienes la observan) pasa a la nueva, sin marcar.
    if (t.task_checklist_items.length) {
      await tx.task_checklist_items.createMany({ data: t.task_checklist_items.map((c, i) => ({ task_id: nueva.id, body: c.body, position: i, is_completed: false, created_at: ahora })) });
    }
    if (t.task_tag_links.length) await tx.task_tag_links.createMany({ data: t.task_tag_links.map((l) => ({ task_id: nueva.id, tag_id: l.tag_id })) });
    if (t.task_watchers.length) await tx.task_watchers.createMany({ data: t.task_watchers.map((w) => ({ task_id: nueva.id, user_id: w.user_id, added_by_id: w.added_by_id, created_at: ahora })) });
    await avisarAsignacion("task_assigned", t.assignee_id, nueva, actorId, tx);
    creadas.push({ de: t.id, id: nueva.id, entrega: proxima });
  }
  return creadas;
}
