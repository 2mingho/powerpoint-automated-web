import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { notificar } from "@/lib/notificaciones";
import { estadosFinales, estadosValidos, prioridadesValidas } from "@/lib/catalogo";
import { fechaDeIso } from "@/lib/reloj";
import { enteroONulo, idsDeLote, MAX_LOTE, SOLO_ADMIN } from "@/lib/admin/api";

/* Edicion masiva (api_admin_tasks_bulk_update). Solo admin, como en Flask. */
export const POST = conUsuario(async (req, u) => {
  const d = await cuerpo(req);
  const ids = idsDeLote(d.ids);
  if (!ids.length) throw new ErrorApi(400, "Selecciona al menos una tarea.");
  if (ids.length > MAX_LOTE) throw new ErrorApi(400, `Puedes editar hasta ${MAX_LOTE} tareas por lote.`);

  const datos: { status?: string; priority?: string; due_date?: Date; assignee_id?: number; area_id?: number | null; area?: string } = {};
  if (typeof d.estado === "string" && d.estado) {
    if (!(await estadosValidos()).includes(d.estado)) throw new ErrorApi(400, "Estado inválido.");
    datos.status = d.estado;
  }
  if (typeof d.prioridad === "string" && d.prioridad) {
    if (!(await prioridadesValidas()).includes(d.prioridad)) throw new ErrorApi(400, "Prioridad inválida.");
    datos.priority = d.prioridad;
  }
  if (typeof d.vence === "string" && d.vence) {
    const f = fechaDeIso(d.vence);
    if (!f) throw new ErrorApi(400, "Fecha de entrega inválida.");
    datos.due_date = f;
  }
  const asignadoId = enteroONulo(d.asignadoId);
  let asignado: { id: number; username: string; area_id: number | null; role: string; areas: { name: string } | null } | null = null;
  if (asignadoId) {
    asignado = await db.users.findUnique({ where: { id: asignadoId }, select: { id: true, username: true, area_id: true, role: true, areas: { select: { name: true } } } });
    if (!asignado) throw new ErrorApi(400, "La persona asignada no existe.");
    datos.assignee_id = asignado.id;
    datos.area_id = asignado.area_id;
    // tasks.area es VARCHAR(20): Flask guardaba el nombre entero de la unidad y fallaba con nombres largos.
    datos.area = (asignado.areas?.name ?? asignado.role).slice(0, 20);
  }
  if (!Object.keys(datos).length) throw new ErrorApi(400, "No hay cambios para aplicar.");

  const tareas = await db.tasks.findMany({ where: { id: { in: ids }, deleted_at: null }, select: { id: true, assignee_id: true, status: true } });
  if (!tareas.length) throw new ErrorApi(404, "No se encontraron tareas para editar.");
  const encontradas = tareas.map((t) => t.id);
  const finales = await estadosFinales();
  const reasignadas = asignado ? tareas.filter((t) => t.assignee_id !== asignado.id).length : 0;

  await db.$transaction(async (tx) => {
    const ahora = new Date();
    await tx.tasks.updateMany({ where: { id: { in: encontradas } }, data: { ...datos, updated_at: ahora } });
    // done_at solo cambia en las que cruzan la frontera abierta/cerrada (el admin aprueba cualquier tarea).
    if (datos.status) {
      const nuevoFinal = finales.includes(datos.status);
      const cruzan = tareas.filter((t) => finales.includes(t.status) !== nuevoFinal).map((t) => t.id);
      if (cruzan.length) await tx.tasks.updateMany({ where: { id: { in: cruzan } }, data: nuevoFinal ? { done_at: ahora, block_reason: null } : { done_at: null } });
    }
    if (asignado && reasignadas) {
      await notificar(asignado.id, {
        tipo: "task_reassigned", titulo: `Se te asignaron ${reasignadas} tareas`, cuerpo: "Revisa tus tareas actualizadas.",
        enlace: "/tareas", entidad: { tipo: "task_bulk", id: encontradas[0] }, actorId: u.id,
      }, tx);
    }
  });
  await registrarActividad(u.id, "task_bulk_update", `Actualización masiva de ${encontradas.length} tarea(s). ids=${JSON.stringify(encontradas)}`, { tipo: "task_bulk", id: encontradas[0] });
  return ok({ actualizadas: encontradas.length });
}, SOLO_ADMIN);
