import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idsDeLote, MAX_LOTE, SOLO_ADMIN } from "@/lib/admin/api";

/*
 * Borrado masivo (api_admin_tasks_bulk_delete): borrado logico, con las hijas
 * de recurrencia. Devuelve los ids para poder deshacer.
 */
export const POST = conUsuario(async (req, u) => {
  const d = await cuerpo(req);
  const ids = idsDeLote(d.ids);
  if (!ids.length) throw new ErrorApi(400, "Selecciona al menos una tarea.");
  if (ids.length > MAX_LOTE) throw new ErrorApi(400, `Puedes eliminar hasta ${MAX_LOTE} tareas por lote.`);

  const elegidas = await db.tasks.findMany({ where: { id: { in: ids }, deleted_at: null }, select: { id: true } });
  if (!elegidas.length) throw new ErrorApi(404, "No se encontraron tareas para eliminar.");
  const hijas = await db.tasks.findMany({ where: { parent_task_id: { in: elegidas.map((t) => t.id) }, deleted_at: null }, select: { id: true } });
  const todas = [...new Set([...elegidas, ...hijas].map((t) => t.id))];

  await db.tasks.updateMany({ where: { id: { in: todas } }, data: { deleted_at: new Date(), deleted_by_id: u.id } });
  await registrarActividad(u.id, "task_bulk_delete", `Eliminación masiva de ${todas.length} tarea(s). ids=${JSON.stringify(todas)}`, { tipo: "task_bulk", id: todas[0] });
  return ok({ eliminadas: todas.length, ids: todas });
}, SOLO_ADMIN);
