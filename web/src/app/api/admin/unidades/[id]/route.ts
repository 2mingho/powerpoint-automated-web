import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN, texto } from "@/lib/admin/api";

async function unidad(id: number) {
  const a = await db.areas.findUnique({ where: { id } });
  if (!a) throw new ErrorApi(404, "Unidad no encontrada.");
  return a;
}

export const PATCH = conUsuario<RouteContext<"/api/admin/unidades/[id]">>(async (req, u, ctx) => {
  const a = await unidad(await idDeRuta(ctx));
  const d = await cuerpo(req);
  const nombre = "nombre" in d ? texto(d.nombre, 100) : a.name;
  if (!nombre) throw new ErrorApi(400, "El nombre de la unidad es obligatorio.");
  // Flask no lo comprobaba y el UNIQUE de la base acababa en un 500.
  if (nombre !== a.name && await db.areas.findFirst({ where: { name: { equals: nombre, mode: "insensitive" }, NOT: { id: a.id } }, select: { id: true } })) {
    throw new ErrorApi(409, `La unidad "${nombre}" ya existe.`);
  }
  const descripcion = "descripcion" in d ? texto(d.descripcion, 500) : a.description;
  await db.areas.update({ where: { id: a.id }, data: { name: nombre, description: descripcion } });
  await registrarActividad(u.id, "area_edit", `Unidad editada: ${nombre}`, { tipo: "area", id: a.id });
  return ok({ id: a.id });
}, SOLO_ADMIN);

/*
 * Borrar una unidad. Ademas de las personas (lo unico que miraba Flask), las
 * tareas, plantillas, solicitudes y etiquetas la referencian sin ON DELETE:
 * borrarla con cualquiera de ellas acababa en un 500. Se dice que hay y se para.
 */
export const DELETE = conUsuario<RouteContext<"/api/admin/unidades/[id]">>(async (_req, u, ctx) => {
  const a = await unidad(await idDeRuta(ctx));
  const [personas, tareas, plantillas, solicitudes, etiquetas, contratos] = await Promise.all([
    db.users.count({ where: { area_id: a.id } }),
    db.tasks.count({ where: { area_id: a.id } }),
    db.task_templates.count({ where: { area_id: a.id } }),
    db.task_requests.count({ where: { OR: [{ to_area_id: a.id }, { from_area_id: a.id }] } }),
    db.task_tags.count({ where: { area_id: a.id } }),
    db.contracts.count({ where: { area_id: a.id } }),
  ]);
  const usos = [
    personas && `${personas} persona(s)`, tareas && `${tareas} tarea(s)`, plantillas && `${plantillas} plantilla(s) de tarea`,
    solicitudes && `${solicitudes} solicitud(es)`, etiquetas && `${etiquetas} etiqueta(s)`, contratos && `${contratos} contrato(s)`,
  ].filter(Boolean);
  if (usos.length) throw new ErrorApi(409, `No se puede eliminar: la usan ${usos.join(", ")}. Muévelas a otra unidad antes.`);
  await db.areas.delete({ where: { id: a.id } }); // unit_leads cae en cascada
  await registrarActividad(u.id, "area_delete", `Unidad eliminada: ${a.name}`, { tipo: "area", id: a.id });
  return ok({ id: a.id });
}, SOLO_ADMIN);
