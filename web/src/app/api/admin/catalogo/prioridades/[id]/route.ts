import { conUsuario, cuerpo, ok } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { editarPrioridad, eliminarPrioridad } from "@/lib/admin/catalogo";

export const PATCH = conUsuario<RouteContext<"/api/admin/catalogo/prioridades/[id]">>(async (req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const r = await editarPrioridad(id, await cuerpo(req));
  await registrarActividad(u.id, "task_priority_edit", r.mensaje, { tipo: "task_priority", id });
  return ok({ id, movidas: r.movidas, mensaje: r.mensaje });
}, SOLO_ADMIN);

export const DELETE = conUsuario<RouteContext<"/api/admin/catalogo/prioridades/[id]">>(async (_req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const nombre = await eliminarPrioridad(id);
  await registrarActividad(u.id, "task_priority_delete", `Prioridad eliminada: ${nombre}`, { tipo: "task_priority", id });
  return ok({ id });
}, SOLO_ADMIN);
