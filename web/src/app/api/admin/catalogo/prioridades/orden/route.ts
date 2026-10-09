import { conUsuario, cuerpo, ok } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { SOLO_ADMIN } from "@/lib/admin/api";
import { reordenar } from "@/lib/admin/catalogo";

export const POST = conUsuario(async (req, u) => {
  const n = await reordenar("prioridades", (await cuerpo(req)).ids);
  await registrarActividad(u.id, "task_priority_reorder", `Prioridades reordenadas (${n})`);
  return ok({ ok: true });
}, SOLO_ADMIN);
