import { conUsuario, cuerpo, ok } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { SOLO_ADMIN } from "@/lib/admin/api";
import { crearEstado } from "@/lib/admin/catalogo";

export const POST = conUsuario(async (req, u) => {
  const r = await crearEstado(await cuerpo(req));
  await registrarActividad(u.id, "task_status_create", r.mensaje, { tipo: "task_status", id: r.estado.id });
  return ok({ id: r.estado.id, mensaje: r.mensaje }, 201);
}, SOLO_ADMIN);
