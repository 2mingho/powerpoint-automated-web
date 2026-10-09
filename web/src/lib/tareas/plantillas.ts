import "server-only";
import { resolverCliente } from "@/lib/clientes/resolver";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { ambitoUnidades } from "@/lib/alcance";
import { estadoInicial, prioridadesValidas, prioridadPorDefecto } from "@/lib/catalogo";
import { hoyNegocio } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import { puedeAsignarA } from "@/lib/tareas/alcance";
import { aDTOs, areaDe, descripcion, diaDb, INCLUIR_TAREA, texto } from "./base";
import { avisarAsignacion } from "./avisos";
import { desplazarDiasHabiles, parsearFechaEntrada } from "./fechas";
import type { PlantillaDTO } from "./tipos";

/* Plantillas por unidad (api_templates_*). El ambito decide cuales se ven y se usan. */

const SELECT = { id: true, name: true, area_id: true, payload_json: true, areas: { select: { name: true } }, users: { select: { username: true } } } as const;

type Datos = PlantillaDTO["datos"];

function leerDatos(json: string): Partial<Datos> {
  try { const d = JSON.parse(json); return d && typeof d === "object" ? d : {}; } catch { return {}; }
}

function dto(p: { id: number; name: string; area_id: number; payload_json: string; areas: { name: string }; users: { username: string } | null }): PlantillaDTO {
  const d = leerDatos(p.payload_json);
  return {
    id: p.id, nombre: p.name, unidadId: p.area_id, unidad: p.areas.name, creador: p.users?.username ?? "",
    datos: {
      title: String(d.title ?? ""), description: String(d.description ?? ""), client: String(d.client ?? ""),
      priority: String(d.priority ?? ""), budget_type: String(d.budget_type ?? ""),
      due_offset_days: Number(d.due_offset_days ?? 0) || 0, checklist: Array.isArray(d.checklist) ? d.checklist.map(String) : [],
    },
  };
}

async function validarDatos(crudo: unknown): Promise<Datos> {
  const p = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;
  const title = texto(p.title);
  if (!title) throw new ErrorApi(400, "El título es obligatorio.");
  const priority = texto(p.priority) || (await prioridadPorDefecto());
  if (!(await prioridadesValidas()).includes(priority)) throw new ErrorApi(400, "Prioridad inválida.");
  const off = p.due_offset_days == null || p.due_offset_days === "" ? 0 : Number(p.due_offset_days);
  if (!Number.isInteger(off)) throw new ErrorApi(400, "Los días hasta la entrega deben ser un número entero.");
  if (off < 0 || off > 90) throw new ErrorApi(400, "Los días hasta la entrega deben estar entre 0 y 90.");
  const checklist = Array.isArray(p.checklist) ? p.checklist : [];
  if (checklist.length > 30) throw new ErrorApi(400, "Máximo 30 ítems en el checklist.");
  checklist.forEach((it, i) => { if (typeof it !== "string" || !it.trim()) throw new ErrorApi(400, `Checklist ítem #${i + 1} inválido.`); });
  return {
    title, description: descripcion(p.description), client: texto(p.client), priority, budget_type: texto(p.budget_type),
    due_offset_days: off, checklist: (checklist as string[]).map((s) => s.trim()),
  };
}

export async function listarPlantillas(u: UsuarioActual) {
  const unidades = u.isAdmin ? null : await ambitoUnidades(u);
  if (unidades && !unidades.length) return [];
  const filas = await db.task_templates.findMany({ where: unidades ? { area_id: { in: unidades } } : {}, orderBy: { name: "asc" }, select: SELECT });
  return filas.map(dto);
}

export async function crearPlantilla(u: UsuarioActual, d: Record<string, unknown>) {
  if (!u.areaId) throw new ErrorApi(400, "Tu usuario no tiene unidad asignada.");
  if ((await db.task_templates.count({ where: { area_id: u.areaId } })) >= 50) throw new ErrorApi(400, "Máximo 50 plantillas por unidad.");
  const nombre = texto(d.name).slice(0, 100);
  if (!nombre) throw new ErrorApi(400, "El nombre de la plantilla es obligatorio.");
  const datos = await validarDatos(d.payload);
  const p = await db.task_templates.create({
    data: { area_id: u.areaId, created_by_id: u.id, name: nombre, payload_json: JSON.stringify(datos), created_at: new Date() },
    select: SELECT,
  });
  return dto(p);
}

async function plantillaDelAmbito(u: UsuarioActual, id: number) {
  const p = await db.task_templates.findUnique({ where: { id }, select: SELECT });
  // Una plantilla de otra unidad responde como si no existiera.
  if (!p || (!u.isAdmin && !(await ambitoUnidades(u)).includes(p.area_id))) throw new ErrorApi(404, "La plantilla no existe.");
  return p;
}

export async function editarPlantilla(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const p = await plantillaDelAmbito(u, id);
  const datos: { name?: string; payload_json?: string } = {};
  if ("name" in d) {
    const nombre = texto(d.name).slice(0, 100);
    if (!nombre) throw new ErrorApi(400, "El nombre es obligatorio.");
    datos.name = nombre;
  }
  if ("payload" in d) datos.payload_json = JSON.stringify(await validarDatos(d.payload));
  return dto(await db.task_templates.update({ where: { id: p.id }, data: datos, select: SELECT }));
}

export async function borrarPlantilla(u: UsuarioActual, id: number) {
  const p = await plantillaDelAmbito(u, id);
  await db.task_templates.delete({ where: { id: p.id } });
}

export async function usarPlantilla(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const p = await plantillaDelAmbito(u, id);
  const asignadoId = d.assignee_id ? Number(d.assignee_id) : NaN;
  if (!d.assignee_id) throw new ErrorApi(400, "Debes seleccionar un asignado.");
  if (!Number.isInteger(asignadoId)) throw new ErrorApi(400, "Asignado no válido.");
  const asignado = await db.users.findUnique({ where: { id: asignadoId }, select: { id: true, role: true, area_id: true, is_active: true, areas: { select: { name: true } } } });
  if (!asignado || !asignado.is_active) throw new ErrorApi(404, "Usuario no encontrado.");
  if (!(await puedeAsignarA(u, asignado))) throw new ErrorApi(400, "El asignado debe estar en tu ámbito.");

  const datos = leerDatos(p.payload_json);
  if (!datos.title) throw new ErrorApi(400, "Plantilla inválida.");
  const prioridad = (await prioridadesValidas()).includes(String(datos.priority)) ? String(datos.priority) : await prioridadPorDefecto();
  let entrega: string;
  if (texto(d.due_date)) {
    const f = parsearFechaEntrada(d.due_date);
    if (!f) throw new ErrorApi(400, "Fecha de entrega no válida.");
    entrega = f;
  } else entrega = desplazarDiasHabiles(hoyNegocio(), Number(datos.due_offset_days ?? 0) || 0);

  const ahora = new Date();
  const t = await db.$transaction(async (tx) => {
    const t = await tx.tasks.create({
      data: {
        title: String(datos.title).slice(0, 255), description: String(datos.description ?? ""), ...(await resolverCliente(tx, datos.client)),
        budget_type: String(datos.budget_type ?? "").slice(0, 255),
        due_date: diaDb(entrega), priority: prioridad, status: await estadoInicial(), ...areaDe(asignado),
        creator_id: u.id, assignee_id: asignado.id, is_recurrent: false, created_at: ahora, updated_at: ahora,
      },
      include: INCLUIR_TAREA,
    });
    const lista = Array.isArray(datos.checklist) ? datos.checklist : [];
    if (lista.length) {
      await tx.task_checklist_items.createMany({ data: lista.map((body, i) => ({ task_id: t.id, body: String(body).slice(0, 500), position: i, is_completed: false, created_at: ahora })) });
    }
    await avisarAsignacion("task_assigned", asignado.id, t, u.id, tx);
    return t;
  });
  await registrarActividad(u.id, "task_create", `Tarea creada desde plantilla "${p.name}": ${t.title}`, { tipo: "task", id: t.id });
  return (await aDTOs([t], u.id))[0];
}
