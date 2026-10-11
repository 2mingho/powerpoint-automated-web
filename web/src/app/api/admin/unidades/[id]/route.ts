import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { idDeRuta, SOLO_ADMIN, texto } from "@/lib/admin/api";
import { leerLimite } from "@/lib/horas-extras/reglas";

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
  let tieneEstudios = a.has_studies;
  if ("tieneEstudios" in d) {
    if (typeof d.tieneEstudios !== "boolean") throw new ErrorApi(400, "«Hace estudios» debe ser verdadero o falso.");
    tieneEstudios = d.tieneEstudios;
  }
  let tieneHorasExtras = a.has_overtime;
  if ("tieneHorasExtras" in d) {
    if (typeof d.tieneHorasExtras !== "boolean") throw new ErrorApi(400, "«Gestiona horas extras» debe ser verdadero o falso.");
    tieneHorasExtras = d.tieneHorasExtras;
  }
  let limiteHorasExtras = Number(a.overtime_limit.toString());
  if ("limiteHorasExtras" in d) {
    const l = leerLimite(d.limiteHorasExtras);
    if (!l.ok) throw new ErrorApi(400, l.error);
    limiteHorasExtras = l.valor;
  }
  await db.areas.update({ where: { id: a.id }, data: { name: nombre, description: descripcion, has_studies: tieneEstudios, has_overtime: tieneHorasExtras, overtime_limit: limiteHorasExtras } });
  const cambios = [
    tieneEstudios !== a.has_studies && `estudios: ${tieneEstudios ? "sí" : "no"}`,
    tieneHorasExtras !== a.has_overtime && `horas extras: ${tieneHorasExtras ? "sí" : "no"}`,
    limiteHorasExtras !== Number(a.overtime_limit.toString()) && `máximo de horas extras: ${limiteHorasExtras}`,
  ].filter(Boolean);
  await registrarActividad(u.id, "area_edit", `Unidad editada: ${nombre}${cambios.length ? ` (${cambios.join("; ")})` : ""}`, { tipo: "area", id: a.id });
  return ok({ id: a.id });
}, SOLO_ADMIN);

/*
 * Borrar una unidad. Ademas de las personas (lo unico que miraba Flask), las
 * tareas, plantillas, solicitudes y etiquetas la referencian sin ON DELETE:
 * borrarla con cualquiera de ellas acababa en un 500. Se dice que hay y se para.
 */
export const DELETE = conUsuario<RouteContext<"/api/admin/unidades/[id]">>(async (_req, u, ctx) => {
  const a = await unidad(await idDeRuta(ctx));
  const [personas, tareas, plantillas, solicitudes, etiquetas, contratos, gastos, horas] = await Promise.all([
    db.users.count({ where: { area_id: a.id } }),
    db.tasks.count({ where: { area_id: a.id } }),
    db.task_templates.count({ where: { area_id: a.id } }),
    db.task_requests.count({ where: { OR: [{ to_area_id: a.id }, { from_area_id: a.id }] } }),
    db.task_tags.count({ where: { area_id: a.id } }),
    db.contracts.count({ where: { area_id: a.id } }),
    db.expenses.count({ where: { area_id: a.id } }),
    db.overtime_entries.count({ where: { area_id: a.id } }),
  ]);
  const usos = [
    personas && `${personas} persona(s)`, tareas && `${tareas} tarea(s)`, plantillas && `${plantillas} plantilla(s) de tarea`,
    solicitudes && `${solicitudes} solicitud(es)`, etiquetas && `${etiquetas} etiqueta(s)`, contratos && `${contratos} contrato(s)`,
    gastos && `${gastos} gasto(s)`, horas && `${horas} registro(s) de horas extras`,
  ].filter(Boolean);
  if (usos.length) throw new ErrorApi(409, `No se puede eliminar: la usan ${usos.join(", ")}. Muévelas a otra unidad antes.`);
  await db.areas.delete({ where: { id: a.id } }); // unit_leads cae en cascada
  await registrarActividad(u.id, "area_delete", `Unidad eliminada: ${a.name}`, { tipo: "area", id: a.id });
  return ok({ id: a.id });
}, SOLO_ADMIN);
