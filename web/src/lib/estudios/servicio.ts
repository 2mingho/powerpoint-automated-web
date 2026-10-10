import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ErrorApi } from "@/lib/api";
import { db } from "@/lib/db";
import { registrarActividad } from "@/lib/actividad";
import { estados, estadoInicial, prioridadPorDefecto } from "@/lib/catalogo";
import { resolverCliente } from "@/lib/clientes/resolver";
import { leerContrato, textoDeProrrateo, usd } from "@/lib/finanzas/contratos";
import { puedeEditarFinanzas, unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import { notificar } from "@/lib/notificaciones";
import { hoyNegocio, isoDeFecha } from "@/lib/reloj";
import { tieneHerramienta, type UsuarioActual } from "@/lib/auth/session";
import { filtroEstudiosVisibles, puedeAsignarA, puedeEditarTarea, puedeVerTarea } from "@/lib/tareas/alcance";
import { areaDe, descripcion, diaDb, texto } from "@/lib/tareas/base";
import { parsearFechaEntrada } from "@/lib/tareas/fechas";
import {
  avanceEstudio, estadoDeFases, FASES, METODOS, PLAN_BASE, planPara, primerDiaHabil, repartirFechas,
  type FaseEstado, type Metodo, type PasoFechado, type PasoPlan,
} from "./plan";

/*
 * Estudios por fases. Un estudio es una tarea de tipo "estudio" (task_type) que hace de
 * contenedor; sus pasos son tareas normales hijas (parent_task_id) con su fase. El
 * contenedor no sale en listas ni cifras de tareas (filtroTareasVisibles lo excluye):
 * lo que cuenta es el trabajo de los pasos. Solo las unidades con has_studies los hacen.
 */

const SELECT_PASO = {
  id: true, title: true, status: true, phase: true, estimated_hours: true, due_date: true, start_date: true,
  asignado: { select: { username: true } },
} satisfies Prisma.tasksSelect;

export type PasoDTO = { id: number; titulo: string; fase: string; estado: string; hecho: boolean; iniciado: boolean; horas: number | null; inicio: string; entrega: string; asignado: string };

export type EstudioDTO = {
  id: number;
  titulo: string;
  cliente: string;
  clienteId: number | null;
  metodo: string;
  responsableId: number;
  responsable: string;
  unidadId: number | null;
  unidad: string;
  entrega: string;
  creada: string;
  pasos: PasoDTO[];
  /* 0 a 1, ponderado por las horas de cada paso. */
  avance: number;
  fases: FaseEstado[];
  faseActual: string | null;
  abiertos: number;
  vencidos: number;
  /* Proxima entrega abierta (la mas cercana a hoy, o la mas atrasada). */
  siguiente: { id: number; titulo: string; entrega: string } | null;
  /* Contrato del cliente en esa unidad vigente en la entrega; `visible` false si la persona no ve los ingresos de la unidad. */
  contrato: { visible: boolean; monto: number | null; tipo: string };
  puedeEditar: boolean;
};

/* ── Permisos ── */

/* Quien crea estudios: administracion, o quien trabaja en una unidad que los hace y tiene Gestion de tareas. */
export async function puedeCrearEstudios(u: UsuarioActual): Promise<boolean> {
  if (!tieneHerramienta(u, "tasks")) return false;
  if (u.isAdmin) return true;
  if (u.areaId == null) return false;
  return !!(await db.areas.findFirst({ where: { id: u.areaId, has_studies: true }, select: { id: true } }));
}

/* Se ofrece "Estudios" a quien puede crearlos o ya ve alguno. */
export async function veEstudios(u: UsuarioActual): Promise<boolean> {
  if (!tieneHerramienta(u, "tasks")) return false;
  if (await puedeCrearEstudios(u)) return true;
  return (await db.tasks.count({ where: await filtroEstudiosVisibles(u), take: 1 })) > 0;
}

/* ── Plan de la unidad ── */

type PayloadPlantilla = { fase?: unknown; horas?: unknown; metodo?: unknown; checklist?: unknown };

/*
 * El plan de una unidad: sus plantillas que llevan fase (payload.fase) o, si no tiene
 * ninguna, el plan por defecto. Asi cada unidad adapta horas y pasos sin tocar codigo.
 */
export async function planDeUnidad(areaId: number | null): Promise<PasoPlan[]> {
  if (areaId == null) return PLAN_BASE;
  const filas = await db.task_templates.findMany({ where: { area_id: areaId }, orderBy: { id: "asc" }, select: { name: true, payload_json: true } });
  const pasos: PasoPlan[] = [];
  for (const f of filas) {
    let p: PayloadPlantilla;
    try { p = JSON.parse(f.payload_json) as PayloadPlantilla; } catch { continue; }
    const fase = FASES.find((x) => x === p.fase);
    if (!fase) continue;
    const horas = typeof p.horas === "number" && p.horas > 0 ? p.horas : 4;
    const metodo = p.metodo === "Cuantitativo" || p.metodo === "Cualitativo" ? p.metodo : undefined;
    pasos.push({ nombre: f.name, fase, horas, ...(metodo ? { metodo } : {}), checklist: Array.isArray(p.checklist) ? p.checklist.map(String).filter(Boolean).slice(0, 30) : [] });
  }
  return pasos.length ? pasos : PLAN_BASE;
}

function leerMetodo(crudo: unknown): Metodo {
  const m = METODOS.find((x) => x === crudo);
  if (!m) throw new ErrorApi(400, `El tipo de estudio debe ser ${METODOS.join(", ")}.`);
  return m;
}

/* Vista previa de los pasos y sus fechas, sin crear nada. */
export async function previsualizarPlan(u: UsuarioActual, d: { metodo: unknown; entrega: unknown; responsableId: unknown }): Promise<PasoFechado[]> {
  if (!(await puedeCrearEstudios(u))) throw new ErrorApi(403, "Tu unidad no hace estudios.");
  const metodo = leerMetodo(d.metodo);
  const entrega = parsearFechaEntrada(d.entrega);
  if (!entrega) throw new ErrorApi(400, "Indica la fecha de entrega final.");
  const resp = await responsableValido(u, d.responsableId);
  return repartirFechas(planPara(metodo, await planDeUnidad(resp.area_id)), primerDiaHabil(hoyNegocio()), entrega);
}

async function responsableValido(u: UsuarioActual, crudo: unknown) {
  const id = Number(crudo);
  if (!crudo || !Number.isInteger(id) || id <= 0) throw new ErrorApi(400, "Elige quién lidera el estudio.");
  const r = await db.users.findUnique({ where: { id }, select: { id: true, username: true, role: true, area_id: true, is_active: true, areas: { select: { name: true, has_studies: true } } } });
  if (!r || !r.is_active) throw new ErrorApi(400, "La persona elegida no existe o está inactiva.");
  if (!(await puedeAsignarA(u, r))) throw new ErrorApi(400, "Solo puedes asignar a personas de tu unidad.");
  if (!r.areas?.has_studies) throw new ErrorApi(400, `La unidad de ${r.username} no hace estudios.`);
  return r;
}

/* ── Alta ── */

export async function crearEstudio(u: UsuarioActual, d: Record<string, unknown>) {
  if (!(await puedeCrearEstudios(u))) throw new ErrorApi(403, "Tu unidad no hace estudios.");
  const titulo = texto(d.titulo).slice(0, 200);
  if (!titulo) throw new ErrorApi(400, "El nombre del estudio es obligatorio.");
  if (!texto(d.cliente)) throw new ErrorApi(400, "Indica el cliente del estudio.");
  const metodo = leerMetodo(d.metodo);
  const resp = await responsableValido(u, d.responsableId);
  const entrega = parsearFechaEntrada(d.entrega);
  if (!entrega) throw new ErrorApi(400, "Indica la fecha de entrega final.");
  const hoy = hoyNegocio();
  if (entrega < hoy) throw new ErrorApi(400, "La entrega final no puede ser anterior a hoy.");

  // El contrato opcional se valida y se autoriza ANTES de crear nada.
  let contrato: { monto: number } | null = null;
  if (d.monto !== undefined && d.monto !== null && String(d.monto).trim() !== "") {
    if (resp.area_id == null || !(await puedeEditarFinanzas(u, "contracts", resp.area_id))) throw new ErrorApi(403, "No tienes permiso para registrar contratos de esta unidad.");
    if (entrega <= hoy) throw new ErrorApi(400, "Para registrar el contrato, la entrega final debe ser posterior a hoy.");
    const l = leerContrato({ clienteId: 1, unidadId: resp.area_id, tipo: "Proyecto", monto: d.monto, inicio: hoy, fin: entrega });
    if (!l.ok) throw new ErrorApi(400, l.error);
    contrato = { monto: l.valor.monto };
  }

  const plan = planPara(metodo, await planDeUnidad(resp.area_id));
  const pasos = repartirFechas(plan, primerDiaHabil(hoy), entrega);
  const estado = await estadoInicial();
  const prioridad = await prioridadPorDefecto();
  const ahora = new Date();

  const r = await db.$transaction(async (tx) => {
    const cli = await resolverCliente(tx, d.cliente);
    const comun = {
      ...cli, ...areaDe(resp), creator_id: u.id, assignee_id: resp.id, status: estado, priority: prioridad,
      description: "", is_recurrent: false, created_at: ahora, updated_at: ahora,
    };
    const estudio = await tx.tasks.create({
      data: { ...comun, title: titulo, due_date: diaDb(entrega), start_date: diaDb(pasos[0]?.inicio ?? hoy), task_type: "estudio", study_method: metodo, description: descripcion(d.descripcion) },
      select: { id: true },
    });
    for (const p of pasos) {
      const paso = await tx.tasks.create({
        data: { ...comun, title: `${titulo} · ${p.nombre}`.slice(0, 255), due_date: diaDb(p.entrega), start_date: diaDb(p.inicio), estimated_hours: p.horas, phase: p.fase, parent_task_id: estudio.id },
        select: { id: true },
      });
      if (p.checklist.length) await tx.task_checklist_items.createMany({ data: p.checklist.map((body, i) => ({ task_id: paso.id, body: body.slice(0, 500), position: i, is_completed: false, created_at: ahora })) });
    }
    if (contrato && cli.client_id && resp.area_id != null) {
      const c = await tx.contracts.create({
        data: { client_id: cli.client_id, area_id: resp.area_id, contract_type: "Proyecto", amount: contrato.monto, start_date: diaDb(hoy), end_date: diaDb(entrega), note: `Estudio: ${titulo}`.slice(0, 500), created_by: u.id, created_at: ahora, updated_at: ahora },
        select: { id: true },
      });
      await registrarActividad(u.id, "contract_create", `Contrato #${c.id} del estudio «${titulo}»: ${usd(contrato.monto)}, ${hoy} a ${entrega}`, { tipo: "contract", id: c.id });
    }
    // Un solo aviso para quien lo lidera, no uno por paso.
    await notificar(resp.id, {
      tipo: "task_assigned", titulo: `Te asignaron el estudio «${titulo}»`, cuerpo: `${pasos.length} pasos hasta el ${entrega}.`,
      enlace: `/estudios?estudio=${estudio.id}`, entidad: { tipo: "task", id: estudio.id }, actorId: u.id,
    }, tx);
    return { id: estudio.id, cliente: cli.client };
  });

  await registrarActividad(u.id, "study_create", `Estudio creado: ${titulo} (${metodo}, ${pasos.length} pasos, entrega ${entrega})`, { tipo: "task", id: r.id });
  return {
    id: r.id, pasos: pasos.length,
    contrato: contrato ? textoDeProrrateo({ monto: contrato.monto, inicio: hoy, fin: entrega }) : "",
  };
}

/* ── Lectura ── */

type FilaEstudio = Prisma.tasksGetPayload<{ select: { id: true; title: true; client: true; client_id: true; study_method: true; assignee_id: true; area_id: true; area: true; due_date: true; created_at: true; asignado: { select: { username: true } }; areas: { select: { name: true } } } }>;

const SELECT_ESTUDIO = {
  id: true, title: true, client: true, client_id: true, study_method: true, assignee_id: true, area_id: true, area: true, due_date: true, created_at: true,
  asignado: { select: { username: true } }, areas: { select: { name: true } },
} satisfies Prisma.tasksSelect;

async function aDTOs(u: UsuarioActual, filas: FilaEstudio[]): Promise<EstudioDTO[]> {
  if (!filas.length) return [];
  const hoy = hoyNegocio();
  const catalogo = await estados();
  const info = new Map(catalogo.map((e) => [e.nombre, e]));
  const [hijos, unidadesFin] = await Promise.all([
    db.tasks.findMany({ where: { parent_task_id: { in: filas.map((f) => f.id) }, deleted_at: null }, select: { ...SELECT_PASO, parent_task_id: true }, orderBy: [{ start_date: "asc" }, { id: "asc" }] }),
    unidadesVisiblesFinanzas(u),
  ]);
  const contratos = unidadesFin.length
    ? await db.contracts.findMany({
      where: { area_id: { in: unidadesFin }, client_id: { in: [...new Set(filas.map((f) => f.client_id).filter((x): x is number => x != null))] } },
      select: { client_id: true, area_id: true, amount: true, contract_type: true, start_date: true, end_date: true }, orderBy: { start_date: "desc" },
    })
    : [];
  const porPadre = new Map<number, typeof hijos>();
  for (const h of hijos) (porPadre.get(h.parent_task_id!) ?? porPadre.set(h.parent_task_id!, []).get(h.parent_task_id!)!).push(h);

  return Promise.all(filas.map(async (f) => {
    const pasos: PasoDTO[] = (porPadre.get(f.id) ?? []).map((h) => {
      const e = info.get(h.status);
      return {
        id: h.id, titulo: h.title, fase: h.phase ?? "", estado: h.status, hecho: !!e?.esFinal, iniciado: !!e && !e.esInicial && !e.esFinal,
        horas: h.estimated_hours, inicio: h.start_date ? isoDeFecha(h.start_date) : "", entrega: isoDeFecha(h.due_date), asignado: h.asignado.username,
      };
    });
    const abiertos = pasos.filter((p) => !p.hecho);
    const entrega = isoDeFecha(f.due_date);
    const futuros = abiertos.filter((p) => p.entrega >= hoy).sort((a, b) => a.entrega.localeCompare(b.entrega));
    const siguiente = futuros[0] ?? [...abiertos].sort((a, b) => a.entrega.localeCompare(b.entrega))[0] ?? null;
    const fases = estadoDeFases(pasos.map((p) => ({ fase: p.fase, horas: p.horas, hecho: p.hecho, iniciado: p.iniciado, entrega: p.entrega })), hoy);
    const visibleFin = f.area_id != null && unidadesFin.includes(f.area_id);
    const c = visibleFin ? contratos.find((x) => x.client_id === f.client_id && x.area_id === f.area_id && isoDeFecha(x.start_date) <= entrega && entrega <= isoDeFecha(x.end_date)) : undefined;
    return {
      id: f.id, titulo: f.title, cliente: f.client ?? "", clienteId: f.client_id, metodo: f.study_method ?? "",
      responsableId: f.assignee_id, responsable: f.asignado.username, unidadId: f.area_id, unidad: f.areas?.name ?? f.area, entrega, creada: f.created_at?.toISOString() ?? "",
      pasos, avance: avanceEstudio(pasos), fases, faseActual: fases.find((x) => x.actual)?.fase ?? null,
      abiertos: abiertos.length, vencidos: abiertos.filter((p) => p.entrega < hoy).length,
      siguiente: siguiente ? { id: siguiente.id, titulo: siguiente.titulo, entrega: siguiente.entrega } : null,
      contrato: { visible: visibleFin, monto: c ? Number(c.amount.toString()) : null, tipo: c?.contract_type ?? "" },
      puedeEditar: await puedeEditarTarea(u, { id: f.id, area_id: f.area_id, assignee_id: f.assignee_id, visibility: "unit" }),
    };
  }));
}

export type FiltroEstudios = { estado: "abiertos" | "cerrados" | "todos"; q: string };

export function leerFiltroEstudios(p: URLSearchParams): FiltroEstudios {
  const e = p.get("estado");
  return { estado: e === "cerrados" || e === "todos" ? e : "abiertos", q: (p.get("q") ?? "").trim().slice(0, 100) };
}

export async function listarEstudios(u: UsuarioActual, f: FiltroEstudios): Promise<{ estudios: EstudioDTO[]; puedeCrear: boolean }> {
  const where: Prisma.tasksWhereInput = {
    AND: [await filtroEstudiosVisibles(u), f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { client: { contains: f.q, mode: "insensitive" } }] } : {}],
  };
  const filas = await db.tasks.findMany({ where, select: SELECT_ESTUDIO, orderBy: [{ due_date: "asc" }, { id: "asc" }], take: 300 });
  let estudios = await aDTOs(u, filas);
  if (f.estado === "abiertos") estudios = estudios.filter((e) => e.abiertos > 0 || !e.pasos.length);
  if (f.estado === "cerrados") estudios = estudios.filter((e) => e.pasos.length > 0 && e.abiertos === 0);
  return { estudios, puedeCrear: await puedeCrearEstudios(u) };
}

/* Un estudio que no se ve responde como si no existiera. */
async function estudioVisible(u: UsuarioActual, id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApi(404, "El estudio no existe o no lo puedes ver.");
  const f = await db.tasks.findFirst({ where: { id, deleted_at: null, task_type: "estudio" }, select: { ...SELECT_ESTUDIO, visibility: true } });
  if (!f || !(await puedeVerTarea(u, { id: f.id, area_id: f.area_id, assignee_id: f.assignee_id, visibility: f.visibility }))) throw new ErrorApi(404, "El estudio no existe o no lo puedes ver.");
  return f;
}

export async function leerEstudio(u: UsuarioActual, id: number): Promise<EstudioDTO> {
  return (await aDTOs(u, [await estudioVisible(u, id)]))[0];
}

/* ── Cambios ── */

async function estudioEditable(u: UsuarioActual, id: number) {
  const f = await estudioVisible(u, id);
  if (!(await puedeEditarTarea(u, { id: f.id, area_id: f.area_id, assignee_id: f.assignee_id, visibility: "unit" }))) throw new ErrorApi(403, "Solo puedes ver este estudio; no puedes cambiarlo.");
  return f;
}

/*
 * Cambia lo del estudio: nombre, cliente, quien lo lidera y la entrega final. El
 * cliente y quien lo lidera se propagan a los pasos abiertos; las fechas de los pasos no se
 * recalculan (se mueven a mano, paso por paso).
 */
export async function editarEstudio(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const f = await estudioEditable(u, id);
  const datos: Prisma.tasksUncheckedUpdateInput = {};
  const pasos: Prisma.tasksUncheckedUpdateManyInput = {};
  const cambios: string[] = [];
  if ("titulo" in d) {
    const t = texto(d.titulo).slice(0, 200);
    if (!t) throw new ErrorApi(400, "El nombre del estudio es obligatorio.");
    if (t !== f.title) { datos.title = t; cambios.push(`nombre: ${f.title} -> ${t}`); }
  }
  if ("entrega" in d) {
    const e = parsearFechaEntrada(d.entrega);
    if (!e) throw new ErrorApi(400, "Fecha de entrega inválida.");
    if (e !== isoDeFecha(f.due_date)) { datos.due_date = diaDb(e); cambios.push(`entrega: ${isoDeFecha(f.due_date)} -> ${e}`); }
  }
  if ("metodo" in d) {
    const m = leerMetodo(d.metodo);
    if (m !== f.study_method) { datos.study_method = m; cambios.push(`tipo: ${f.study_method} -> ${m}`); }
  }
  if ("responsableId" in d) {
    const r = await responsableValido(u, d.responsableId);
    if (r.id !== f.assignee_id) {
      datos.assignee_id = r.id; pasos.assignee_id = r.id; cambios.push(`responsable: ${f.asignado.username} -> ${r.username}`);
      Object.assign(datos, areaDe(r)); Object.assign(pasos, areaDe(r));
    }
  }
  const nuevoCliente = "cliente" in d ? await (async () => {
    if (!texto(d.cliente)) throw new ErrorApi(400, "Indica el cliente del estudio.");
    return resolverCliente(db, d.cliente);
  })() : null;
  if (nuevoCliente && nuevoCliente.client_id !== f.client_id) { Object.assign(datos, nuevoCliente); Object.assign(pasos, nuevoCliente); cambios.push(`cliente: ${f.client} -> ${nuevoCliente.client}`); }

  if (Object.keys(datos).length) {
    const finales = (await estados()).filter((e) => e.esFinal).map((e) => e.nombre);
    await db.$transaction([
      db.tasks.update({ where: { id }, data: { ...datos, updated_at: new Date() } }),
      ...(Object.keys(pasos).length ? [db.tasks.updateMany({ where: { parent_task_id: id, deleted_at: null, status: { notIn: finales } }, data: { ...pasos, updated_at: new Date() } })] : []),
    ]);
  }
  await registrarActividad(u.id, "study_update", `Estudio #${id}: ${cambios.length ? cambios.join(", ") : "sin cambios"}`, { tipo: "task", id });
  return leerEstudio(u, id);
}

/* Borra el estudio y todos sus pasos (borrado suave; "Deshacer" lo restaura todo junto). */
export async function borrarEstudio(u: UsuarioActual, id: number) {
  const f = await estudioEditable(u, id);
  const ahora = new Date();
  const n = await db.$transaction(async (tx) => {
    const r = await tx.tasks.updateMany({ where: { parent_task_id: id, deleted_at: null }, data: { deleted_at: ahora, deleted_by_id: u.id } });
    await tx.tasks.update({ where: { id }, data: { deleted_at: ahora, deleted_by_id: u.id } });
    return r.count;
  });
  await registrarActividad(u.id, "study_delete", `Estudio eliminado: ${f.title} (${n} paso(s))`, { tipo: "task", id });
  return n;
}
