import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { estados } from "@/lib/catalogo";
import { hoyNegocio, isoDeFecha } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { filtroTareasVisibles } from "@/lib/tareas/alcance";
import { diaDb, inicioDiaNegocioUtc } from "@/lib/tareas/base";
import { lunesDe, sumarDias } from "@/lib/tareas/fechas";
import { grupoDeEstado, HORAS_POR_DEFECTO } from "@/lib/seguimiento/estado";
import type { RangoFechas } from "@/lib/seguimiento/periodo";
import { unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import { listarContratos, metasDelAnio } from "@/lib/finanzas/servicio";
import type { ContratoIng, MetasIng } from "@/lib/finanzas/agregados";
import { acumularCeldas, codificarCeldas, entradaDeTarea, horasDeGrupo, riesgoDelPanel, type CeldasWire, type Entrada } from "./celdas";
import { condicionDePeriodo, detallePanel, PAGINA_DETALLE, SIN_FILTROS_DETALLE } from "./detalle";
import type { EstadoPanel, FilaDetalle } from "./tipos";

/* Tope de celdas que viajan al navegador; mas alla se avisa y se pide acotar el periodo. */
export const MAX_CELDAS_PANEL = 20_000;

/* Dias por delante de hoy cuyas tareas abiertas se miran una a una para el riesgo (ver riesgoDe: dos dias habiles, fin de semana incluido). */
const DIAS_DE_RIESGO = 4;

/* Ingresos del año en curso, solo de las unidades cuyos ingresos puede ver la persona; null si no ve ninguna. */
export type IngresosPanel = { anio: number; contratos: ContratoIng[]; metas: MetasIng; unidades: { id: number; nombre: string }[] };

export type DatosPanel = {
  celdas: CeldasWire;
  /* Cuantas tareas hay en el periodo (todas, no las celdas). */
  tareas: number;
  truncado: boolean;
  estados: EstadoPanel[];
  ingresos: IngresosPanel | null;
  /* Primera pagina del detalle, sin filtros: la tabla sale ya pintada. */
  detalle: { filas: FilaDetalle[]; total: number };
};

/*
 * Cifras del panel de Inicio: las tareas que la persona puede ver (filtroTareasVisibles, nunca otro
 * criterio) con entrega dentro del rango, agrupadas EN LA BASE. Los filtros cruzados corren en el
 * navegador sobre las celdas, asi que nada que no pudiera ver llega a el.
 *
 * Tres caminos, que juntos cubren cada tarea exactamente una vez:
 *   - cerradas en los ultimos 30 dias: una a una, para saber si llegaron a tiempo;
 *   - abiertas que vencen en los proximos dias: una a una, para el riesgo (depende de los pasos);
 *   - todo lo demas: groupBy por (unidad, cliente, persona, estado, dia de entrega, horas).
 * El complemento se escribe explicito y no con NOT(...): una cerrada sin done_at (datos anteriores)
 * daria NULL en el NOT y desapareceria del panel.
 */
export async function datosPanel(u: UsuarioActual, rango: RangoFechas): Promise<DatosPanel> {
  const hoy = hoyNegocio();
  const [visibles, catalogo] = await Promise.all([filtroTareasVisibles(u), estados()]);
  const finales = catalogo.filter((e) => e.esFinal).map((e) => e.nombre);
  const grupo = new Map(catalogo.map((e) => [e.nombre, grupoDeEstado(e)]));
  const base: Prisma.tasksWhereInput = { AND: [visibles, condicionDePeriodo(rango)] };

  const hace30 = inicioDiaNegocioUtc(sumarDias(hoy, -30));
  const recientes: Prisma.tasksWhereInput = { status: { in: finales }, done_at: { gte: hace30 } };
  const proximas: Prisma.tasksWhereInput = { status: { notIn: finales }, due_date: { gte: diaDb(hoy), lte: diaDb(sumarDias(hoy, DIAS_DE_RIESGO)) } };
  const resto: Prisma.tasksWhereInput = {
    OR: [
      { status: { notIn: finales }, OR: [{ due_date: { lt: diaDb(hoy) } }, { due_date: { gt: diaDb(sumarDias(hoy, DIAS_DE_RIESGO)) } }] },
      { status: { in: finales }, OR: [{ done_at: null }, { done_at: { lt: hace30 } }] },
    ],
  };
  const dims = {
    area_id: true, area: true, client_id: true, assignee_id: true, status: true, due_date: true, estimated_hours: true,
  } satisfies Prisma.tasksSelect;

  const [grupos, deRecientes, deProximas, pasosProximas, total, detalle] = await Promise.all([
    // Las horas se suman en la base (_sum) y no entran en la clave: agrupar tambien por horas partiria cada combinacion en una por cada valor.
    db.tasks.groupBy({
      by: ["area_id", "area", "client_id", "assignee_id", "status", "due_date"], where: { AND: [base, resto] },
      _count: { _all: true, estimated_hours: true }, _sum: { estimated_hours: true },
    }),
    db.tasks.findMany({ where: { AND: [base, recientes] }, select: { ...dims, done_at: true } }),
    db.tasks.findMany({ where: { AND: [base, proximas] }, select: { ...dims, id: true } }),
    db.task_checklist_items.groupBy({ by: ["task_id", "is_completed"], where: { tasks: { is: { AND: [base, proximas] } } }, _count: { _all: true } }),
    db.tasks.count({ where: base }),
    detallePanel(u, rango, SIN_FILTROS_DETALLE, null, 0, PAGINA_DETALLE),
  ]);

  // Lo que las celdas rotulan: unidad, cliente, tipo de cliente y persona.
  const idsCliente = new Set<number>(), idsPersona = new Set<number>();
  for (const g of [...grupos, ...deRecientes, ...deProximas]) {
    if (g.client_id != null) idsCliente.add(g.client_id);
    idsPersona.add(g.assignee_id);
  }
  const unidadesFin = await unidadesVisiblesFinanzas(u);
  const conIngresos = unidadesFin.length > 0;
  const [areas, clientes, personas, contratos] = await Promise.all([
    db.areas.findMany({ select: { id: true, name: true } }),
    idsCliente.size ? db.clients.findMany({ where: { id: { in: [...idsCliente] } }, select: { id: true, name: true, client_type: true } }) : [],
    idsPersona.size ? db.users.findMany({ where: { id: { in: [...idsPersona] } }, select: { id: true, username: true } }) : [],
    conIngresos && idsCliente.size
      ? db.contracts.findMany({
        where: { client_id: { in: [...idsCliente] }, area_id: { in: unidadesFin } },
        select: { client_id: true, area_id: true, contract_type: true, start_date: true, end_date: true }, orderBy: { start_date: "desc" },
      })
      : [],
  ]);
  const nombreArea = new Map(areas.map((a) => [a.id, a.name]));
  const cliente = new Map(clientes.map((c) => [c.id, c]));
  const persona = new Map(personas.map((p) => [p.id, p.username]));
  const contratoDe = (clienteId: number | null, areaId: number | null, dia: string) =>
    clienteId == null || areaId == null ? "" : contratos.find((c) => c.client_id === clienteId && c.area_id === areaId && isoDeFecha(c.start_date) <= dia && dia <= isoDeFecha(c.end_date))?.contract_type ?? "";
  const dimsDe = (t: { area_id: number | null; area: string; client_id: number | null; assignee_id: number; due_date: Date }) => ({
    unidad: (t.area_id != null ? nombreArea.get(t.area_id) : undefined) ?? t.area,
    cliente: t.client_id != null ? cliente.get(t.client_id)?.name ?? "" : "",
    persona: String(t.assignee_id), personaNombre: persona.get(t.assignee_id) ?? `#${t.assignee_id}`,
    tipo: t.client_id != null ? cliente.get(t.client_id)?.client_type ?? "" : "",
    contrato: contratoDe(t.client_id, t.area_id, isoDeFecha(t.due_date)),
  });

  const entradas: Entrada[] = [];
  for (const g of grupos) {
    const estado = grupo.get(g.status) ?? "en_curso";
    const entrega = isoDeFecha(g.due_date);
    entradas.push({
      ...dimsDe(g), estado, entrega, n: g._count._all, horas: horasDeGrupo(g._sum.estimated_hours ?? 0, g._count.estimated_hours, g._count._all),
      // Aqui nunca hay tareas que venzan en los proximos dias: solo "vencida" o nada.
      riesgo: estado !== "hecha" && entrega < hoy ? "vencida" : "", tiempo: "",
    });
  }
  for (const t of deRecientes) {
    entradas.push(entradaDeTarea({
      ...dimsDe(t), estado: grupo.get(t.status) ?? "hecha", entrega: isoDeFecha(t.due_date), horas: t.estimated_hours ?? HORAS_POR_DEFECTO,
      hechaEl: t.done_at ? hoyNegocio(t.done_at) : null,
    }, hoy));
  }
  const pasos = new Map<number, { total: number; hechos: number }>();
  for (const p of pasosProximas) {
    const x = pasos.get(p.task_id) ?? { total: 0, hechos: 0 };
    x.total += p._count._all;
    if (p.is_completed) x.hechos += p._count._all;
    pasos.set(p.task_id, x);
  }
  for (const t of deProximas) {
    const estado = grupo.get(t.status) ?? "en_curso";
    const horas = t.estimated_hours ?? HORAS_POR_DEFECTO;
    const p = pasos.get(t.id);
    entradas.push({
      ...dimsDe(t), estado, entrega: isoDeFecha(t.due_date), n: 1, horas, tiempo: "",
      riesgo: riesgoDelPanel({ estado, entrega: isoDeFecha(t.due_date), horas, pasosTotal: p?.total ?? 0, pasosHechos: p?.hechos ?? 0 }, hoy),
    });
  }

  let celdas = acumularCeldas(entradas);
  const truncado = celdas.length > MAX_CELDAS_PANEL;
  if (truncado) {
    // Se queda con las semanas mas cercanas a hoy; el resto es historia lejana o futuro lejano.
    const centro = Date.parse(`${lunesDe(hoy)}T00:00:00Z`);
    const lejania = (e: string | null) => (e ? Math.abs(Date.parse(`${e}T00:00:00Z`) - centro) : Infinity);
    celdas = celdas.sort((a, b) => lejania(a.entrega) - lejania(b.entrega)).slice(0, MAX_CELDAS_PANEL);
  }

  // Ingresos del año en curso: lo contratado contra la meta, en las unidades cuyos ingresos ve la persona.
  const anio = Number(hoy.slice(0, 4));
  const [contratosAnio, metas] = conIngresos ? await Promise.all([listarContratos(u, { anio, unidadId: null, clienteId: null, tipo: "" }), metasDelAnio(u, anio)]) : [null, null];
  const ingresos: IngresosPanel | null = contratosAnio && metas ? {
    anio,
    contratos: contratosAnio.contratos.map((c) => ({ id: c.id, monto: c.monto, inicio: c.inicio, fin: c.fin, tipo: c.tipo, cliente: c.cliente, unidad: c.unidad })),
    metas: {
      direccion: metas.direccion && metas.direccion.monto > 0 ? metas.direccion.monto : null,
      unidades: Object.fromEntries(metas.unidades.filter((x) => x.monto > 0).map((x) => [x.unidadId as number, x.monto])),
    },
    unidades: metas.unidades.map((x) => ({ id: x.unidadId as number, nombre: x.nombre })),
  } : null;
  return { celdas: codificarCeldas(celdas), tareas: total, truncado, estados: catalogo.map((e) => ({ nombre: e.nombre, tono: e.color })), ingresos, detalle };
}
