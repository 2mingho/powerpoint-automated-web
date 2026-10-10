import "server-only";
import { db } from "@/lib/db";
import { estados } from "@/lib/catalogo";
import { hoyNegocio, isoDeFecha } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import { diaDb } from "@/lib/tareas/base";
import { grupoDeEstado, HORAS_POR_DEFECTO } from "@/lib/seguimiento/estado";
import type { RangoFechas } from "@/lib/seguimiento/periodo";
import type { EstadoPanel, FilaPanel } from "./tipos";

/* Tope de filas que viajan al navegador; mas alla se avisa y se pide acotar el periodo. */
export const MAX_FILAS_PANEL = 3000;

export type DatosPanel = { filas: FilaPanel[]; truncado: boolean; estados: EstadoPanel[] };

/*
 * Tareas del panel de Inicio: las que la persona puede ver (filtroTareasVisibles,
 * nunca otro criterio) con entrega dentro del rango. Los filtros cruzados corren
 * en el navegador sobre estas filas, asi que nada que no pudiera ver llega a el.
 */
export async function datosPanel(u: UsuarioActual, rango: RangoFechas): Promise<DatosPanel> {
  const [visibles, catalogo] = await Promise.all([filtroTareasVisibles(u), estados()]);
  const due = {
    ...(rango.desde ? { gte: diaDb(rango.desde) } : {}),
    ...(rango.hasta ? { lte: diaDb(rango.hasta) } : {}),
  };
  const where = { AND: [visibles, Object.keys(due).length ? { due_date: due } : {}] };
  const tareas = await db.tasks.findMany({
    where,
    orderBy: [{ due_date: "asc" }, { id: "asc" }],
    take: MAX_FILAS_PANEL + 1,
    select: {
      id: true, title: true, status: true, due_date: true, start_date: true, estimated_hours: true, done_at: true,
      assignee_id: true, asignado: { select: { username: true } },
      areas: { select: { name: true } }, area: true,
      client_id: true, client: true, cliente_entidad: { select: { name: true, client_type: true } },
    },
  });
  const truncado = tareas.length > MAX_FILAS_PANEL;
  if (truncado) tareas.length = MAX_FILAS_PANEL;

  const ids = tareas.map((t) => t.id);
  const [total, hechos] = ids.length ? await Promise.all([
    db.task_checklist_items.groupBy({ by: ["task_id"], where: { task_id: { in: ids } }, _count: { _all: true } }),
    db.task_checklist_items.groupBy({ by: ["task_id"], where: { task_id: { in: ids }, is_completed: true }, _count: { _all: true } }),
  ]) : [[], []];
  const pasos = new Map(total.map((f) => [f.task_id, f._count._all]));
  const pasosHechos = new Map(hechos.map((f) => [f.task_id, f._count._all]));
  const grupo = new Map(catalogo.map((e) => [e.nombre, grupoDeEstado(e)]));

  const filas: FilaPanel[] = tareas.map((t) => ({
    id: t.id,
    titulo: t.title,
    estadoNombre: t.status,
    estado: grupo.get(t.status) ?? "en_curso",
    entrega: isoDeFecha(t.due_date) || null,
    inicio: t.start_date ? isoDeFecha(t.start_date) : null,
    horas: t.estimated_hours ?? HORAS_POR_DEFECTO,
    estimada: t.estimated_hours != null,
    pasosTotal: pasos.get(t.id) ?? 0,
    pasosHechos: pasosHechos.get(t.id) ?? 0,
    hechaEl: t.done_at ? hoyNegocio(t.done_at) : null,
    persona: String(t.assignee_id),
    personaNombre: t.asignado.username,
    unidad: t.areas?.name ?? t.area,
    cliente: t.cliente_entidad?.name ?? "",
    clienteId: t.client_id,
    tipo: t.cliente_entidad?.client_type ?? "",
    contrato: "",
  }));
  return { filas, truncado, estados: catalogo.map((e) => ({ nombre: e.nombre, tono: e.color })) };
}
