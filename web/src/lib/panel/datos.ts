import "server-only";
import { db } from "@/lib/db";
import { estados } from "@/lib/catalogo";
import { hoyNegocio, isoDeFecha } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import { diaDb } from "@/lib/tareas/base";
import { grupoDeEstado, HORAS_POR_DEFECTO } from "@/lib/seguimiento/estado";
import type { RangoFechas } from "@/lib/seguimiento/periodo";
import { unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import { listarContratos, metasDelAnio } from "@/lib/finanzas/servicio";
import type { ContratoIng, MetasIng } from "@/lib/finanzas/agregados";
import type { EstadoPanel, FilaPanel } from "./tipos";

/* Tope de filas que viajan al navegador; mas alla se avisa y se pide acotar el periodo. */
export const MAX_FILAS_PANEL = 3000;

/* Ingresos del año en curso, solo de las unidades cuyos ingresos puede ver la persona; null si no ve ninguna. */
export type IngresosPanel = { anio: number; contratos: ContratoIng[]; metas: MetasIng; unidades: { id: number; nombre: string }[] };

export type DatosPanel = { filas: FilaPanel[]; truncado: boolean; estados: EstadoPanel[]; ingresos: IngresosPanel | null };

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
      area_id: true, areas: { select: { name: true } }, area: true,
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

  // Contratos que la persona puede ver: sirven para el tipo de contrato de cada tarea y para el bloque de ingresos.
  const hoy = hoyNegocio();
  const anio = Number(hoy.slice(0, 4));
  const unidadesFin = await unidadesVisiblesFinanzas(u);
  const conIngresos = unidadesFin.length > 0;
  const [contratosAnio, metas] = conIngresos ? await Promise.all([listarContratos(u, { anio, unidadId: null, clienteId: null, tipo: "" }), metasDelAnio(u, anio)]) : [null, null];
  const contratosDeTareas = conIngresos
    ? await db.contracts.findMany({
      where: { client_id: { in: [...new Set(tareas.map((t) => t.client_id).filter((x): x is number => x != null))] }, area_id: { in: unidadesFin } },
      select: { client_id: true, area_id: true, contract_type: true, start_date: true, end_date: true }, orderBy: { start_date: "desc" },
    })
    : [];
  /* El contrato del mismo cliente y unidad vigente en la fecha de entrega (el MVP lo llama contractFor); el mas reciente si hay varios. */
  const contratoDe = (t: (typeof tareas)[number]) => {
    const dia = isoDeFecha(t.due_date);
    return contratosDeTareas.find((c) => c.client_id === t.client_id && c.area_id === t.area_id && isoDeFecha(c.start_date) <= dia && dia <= isoDeFecha(c.end_date))?.contract_type ?? "";
  };

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
    contrato: conIngresos ? contratoDe(t) : "",
  }));
  const ingresos: IngresosPanel | null = contratosAnio && metas ? {
    anio,
    contratos: contratosAnio.contratos.map((c) => ({ id: c.id, monto: c.monto, inicio: c.inicio, fin: c.fin, tipo: c.tipo, cliente: c.cliente, unidad: c.unidad })),
    metas: {
      direccion: metas.direccion && metas.direccion.monto > 0 ? metas.direccion.monto : null,
      unidades: Object.fromEntries(metas.unidades.filter((x) => x.monto > 0).map((x) => [x.unidadId as number, x.monto])),
    },
    unidades: metas.unidades.map((x) => ({ id: x.unidadId as number, nombre: x.nombre })),
  } : null;
  return { filas, truncado, estados: catalogo.map((e) => ({ nombre: e.nombre, tono: e.color })), ingresos };
}
