import { conUsuario, cuerpo, ok } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { SOLO_ADMIN } from "@/lib/admin/api";
import { crearPrioridad } from "@/lib/admin/catalogo";

export const POST = conUsuario(async (req, u) => {
  const r = await crearPrioridad(await cuerpo(req));
  await registrarActividad(u.id, "task_priority_create", r.mensaje, { tipo: "task_priority", id: r.prioridad.id });
  return ok({ id: r.prioridad.id, mensaje: r.mensaje }, 201);
}, SOLO_ADMIN);
