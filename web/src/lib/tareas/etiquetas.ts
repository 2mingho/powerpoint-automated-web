import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { ambitoUnidades } from "@/lib/alcance";
import type { UsuarioActual } from "@/lib/auth/session";
import { COLORES_ETIQUETA, etiquetaDTO, tareaEditable } from "./base";
import type { EtiquetaDTO } from "./tipos";
import type { Tono } from "@/components/ui/estado";

/*
 * Etiquetas (services/tablero.py + tasks_tablero.py). Pertenecen a una unidad:
 * cada equipo clasifica su trabajo a su manera. area_id nulo es comun: solo la
 * crea un admin y la ven todos.
 */
const NOMBRE_MAX = 40;
const SELECT = { id: true, nombre: true, color: true, area_id: true, areas: { select: { name: true } } } as const;

export async function filtroEtiquetasVisibles(u: UsuarioActual): Promise<Prisma.task_tagsWhereInput> {
  if (u.isAdmin) return {};
  const unidades = await ambitoUnidades(u);
  return unidades.length ? { OR: [{ area_id: null }, { area_id: { in: unidades } }] } : { area_id: null };
}

export async function puedeGestionarEtiqueta(u: UsuarioActual, e: { area_id: number | null }) {
  if (u.isAdmin) return true;
  if (e.area_id == null) return false;
  return (await ambitoUnidades(u)).includes(e.area_id);
}

export async function etiquetasVisibles(u: UsuarioActual): Promise<Array<EtiquetaDTO & { gestionable: boolean }>> {
  const [filas, unidades] = await Promise.all([
    db.task_tags.findMany({ where: await filtroEtiquetasVisibles(u), orderBy: { nombre: "asc" }, select: SELECT }),
    ambitoUnidades(u),
  ]);
  return filas.map((e) => ({ ...etiquetaDTO(e), gestionable: u.isAdmin || (e.area_id != null && unidades.includes(e.area_id)) }));
}

function validar(d: Record<string, unknown>, colorActual?: string) {
  const nombre = String(d.nombre ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (!nombre) throw new ErrorApi(400, "El nombre es obligatorio.");
  if (nombre.length > NOMBRE_MAX) throw new ErrorApi(400, `Máximo ${NOMBRE_MAX} caracteres.`);
  const color = String(d.color || colorActual || "neutro");
  if (!COLORES_ETIQUETA.includes(color as Tono)) throw new ErrorApi(400, "Color inválido.");
  return { nombre, color };
}

async function nombreOcupado(nombre: string, areaId: number | null, excluir?: number) {
  return !!(await db.task_tags.findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" }, area_id: areaId, ...(excluir ? { id: { not: excluir } } : {}) },
    select: { id: true },
  }));
}

export async function crearEtiqueta(u: UsuarioActual, d: Record<string, unknown>) {
  const { nombre, color } = validar(d);
  let areaId: number | null;
  if (u.isAdmin && d.comun) areaId = null;
  else {
    const crudo = d.area_id ?? u.areaId;
    areaId = crudo == null || crudo === "" ? null : Number(crudo);
    if (areaId != null && !Number.isInteger(areaId)) throw new ErrorApi(400, "Unidad inválida.");
    if (areaId == null) throw new ErrorApi(400, "Necesitas una unidad para crear etiquetas.");
    if (!u.isAdmin && !(await ambitoUnidades(u)).includes(areaId)) throw new ErrorApi(403, "Solo puedes crear etiquetas en tus unidades.");
  }
  if (await nombreOcupado(nombre, areaId)) throw new ErrorApi(409, "Ya existe una etiqueta con ese nombre.");
  const e = await db.task_tags.create({ data: { nombre, color, area_id: areaId, created_by_id: u.id, created_at: new Date() }, select: SELECT });
  return { ...etiquetaDTO(e), gestionable: true };
}

async function etiquetaGestionable(u: UsuarioActual, id: number) {
  // Fuera de las visibles es 404: ni se ve ni se confirma que exista.
  const e = await db.task_tags.findFirst({ where: { AND: [await filtroEtiquetasVisibles(u), { id }] }, select: SELECT });
  if (!e) throw new ErrorApi(404, "La etiqueta no existe.");
  if (!(await puedeGestionarEtiqueta(u, e))) throw new ErrorApi(403, "Las etiquetas comunes solo las gestiona un administrador.");
  return e;
}

export async function editarEtiqueta(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const e = await etiquetaGestionable(u, id);
  const { nombre, color } = validar({ nombre: d.nombre ?? e.nombre, color: d.color }, e.color);
  if (await nombreOcupado(nombre, e.area_id, e.id)) throw new ErrorApi(409, "Ya existe una etiqueta con ese nombre.");
  const r = await db.task_tags.update({ where: { id: e.id }, data: { nombre, color }, select: SELECT });
  return { ...etiquetaDTO(r), gestionable: true };
}

export async function borrarEtiqueta(u: UsuarioActual, id: number) {
  const e = await etiquetaGestionable(u, id);
  await db.$transaction([
    db.task_tag_links.deleteMany({ where: { tag_id: e.id } }),
    db.task_tags.delete({ where: { id: e.id } }),
  ]);
}

/*
 * Fija las etiquetas de una tarea. Las que ya tenia y este usuario no ve (de
 * otra unidad) se conservan: quitarlas seria borrar el trabajo de otro equipo
 * sin saberlo.
 */
export async function fijarEtiquetas(u: UsuarioActual, taskId: number, d: Record<string, unknown>) {
  const t = await tareaEditable(u, taskId);
  if (!Array.isArray(d.tag_ids)) throw new ErrorApi(400, "Falta la lista de etiquetas.");
  const pedidas = new Set<number>();
  for (const x of d.tag_ids) {
    const n = Number(x);
    if (!Number.isInteger(n)) throw new ErrorApi(400, "Etiquetas inválidas.");
    pedidas.add(n);
  }
  const filtro = await filtroEtiquetasVisibles(u);
  const nuevas = pedidas.size ? await db.task_tags.findMany({ where: { AND: [filtro, { id: { in: [...pedidas] } }] }, select: SELECT }) : [];
  if (nuevas.length !== pedidas.size) throw new ErrorApi(400, "Alguna etiqueta no existe o no es de tu unidad.");

  const actuales = await db.task_tag_links.findMany({ where: { task_id: t.id }, select: { task_tags: { select: SELECT } } });
  const visibles = new Set((await db.task_tags.findMany({ where: filtro, select: { id: true } })).map((e) => e.id));
  const conservar = actuales.map((a) => a.task_tags).filter((e) => !visibles.has(e.id));
  const finales = new Map([...conservar, ...nuevas].map((e) => [e.id, e]));

  await db.$transaction([
    db.task_tag_links.deleteMany({ where: { task_id: t.id } }),
    db.task_tag_links.createMany({ data: [...finales.keys()].map((tag_id) => ({ task_id: t.id, tag_id })) }),
  ]);
  const antes = actuales.map((a) => a.task_tags.nombre).sort();
  const despues = [...finales.values()].map((e) => e.nombre).sort();
  if (antes.join("|") !== despues.join("|")) {
    await registrarActividad(u.id, "task_update", `Etiquetas de "${t.title}": ${despues.join(", ") || "ninguna"} (id=${t.id})`, { tipo: "task", id: t.id });
  }
  return [...finales.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(etiquetaDTO);
}
