import { conUsuario, cuerpo, ok } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN } from "@/lib/admin/api";
import { editarEstado, eliminarEstado } from "@/lib/admin/catalogo";

export const PATCH = conUsuario<RouteContext<"/api/admin/catalogo/estados/[id]">>(async (req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const r = await editarEstado(id, await cuerpo(req));
  await registrarActividad(u.id, "task_status_edit", r.mensaje, { tipo: "task_status", id });
  return ok({ id, movidas: r.movidas, mensaje: r.mensaje });
}, SOLO_ADMIN);

export const DELETE = conUsuario<RouteContext<"/api/admin/catalogo/estados/[id]">>(async (_req, u, ctx) => {
  const id = await idDeRuta(ctx);
  const nombre = await eliminarEstado(id);
  await registrarActividad(u.id, "task_status_delete", `Estado eliminado: ${nombre}`, { tipo: "task_status", id });
  return ok({ id });
}, SOLO_ADMIN);
