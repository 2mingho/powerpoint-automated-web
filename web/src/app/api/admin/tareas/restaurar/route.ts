import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idsDeLote, MAX_LOTE, SOLO_ADMIN } from "@/lib/admin/api";

/* "Deshacer" de un borrado masivo: solo restaura lo que borro esta misma persona. */
export const POST = conUsuario(async (req, u) => {
  const ids = idsDeLote((await cuerpo(req)).ids);
  if (!ids.length || ids.length > MAX_LOTE * 4) throw new ErrorApi(400, "Nada que restaurar.");
  const r = await db.tasks.updateMany({ where: { id: { in: ids }, deleted_by_id: u.id, NOT: { deleted_at: null } }, data: { deleted_at: null, deleted_by_id: null } });
  await registrarActividad(u.id, "task_bulk_restore", `Restauradas ${r.count} tarea(s). ids=${JSON.stringify(ids)}`, { tipo: "task_bulk", id: ids[0] });
  return ok({ restauradas: r.count });
}, SOLO_ADMIN);
