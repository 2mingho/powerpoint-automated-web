import "server-only";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { ambitoUnidades } from "@/lib/alcance";
import { notificar, notificarVarios } from "@/lib/notificaciones";
import type { UsuarioActual } from "@/lib/auth/session";
import { puedeEditarTarea, puedeVerTarea } from "@/lib/tareas/alcance";
import { aDTOs, enlaceTarea, tareaEditable, tareaVisible, texto } from "./base";
import { personasDelAmbito } from "./personas";
import type { ActividadDTO, ComentarioDTO, DetalleDTO, ItemChecklistDTO, ObservadorDTO } from "./tipos";

/* El pase de la tarea: detalle, checklist, comentarios, observadores y actividad. */

function unidadDe(p: { role: string; areas: { name: string } | null } | null) {
  return p?.areas?.name || "Sin unidad";
}

export async function detalleTarea(u: UsuarioActual, id: number): Promise<DetalleDTO> {
  const t = await tareaVisible(u, id);
  const [dto] = await aDTOs([t], u.id);
  const observadores = await db.task_watchers.findMany({
    where: { task_id: t.id },
    orderBy: { created_at: "asc" },
    select: { user_id: true, usuario: { select: { username: true, role: true, areas: { select: { name: true } } } } },
  });
  return {
    ...dto,
    puedeEditar: await puedeEditarTarea(u, t),
    observadores: observadores.map((o) => ({ usuarioId: o.user_id, nombre: o.usuario.username, unidad: unidadDe(o.usuario), soyYo: o.user_id === u.id })),
  };
}

/* ─── Checklist ─── */
function itemDTO(i: { id: number; body: string; position: number; is_completed: boolean | null; users: { username: string } | null }): ItemChecklistDTO {
  return { id: i.id, texto: i.body, posicion: i.position, hecho: !!i.is_completed, hechoPor: i.users?.username ?? null };
}
const SELECT_ITEM = { id: true, body: true, position: true, is_completed: true, users: { select: { username: true } } } as const;

export async function listarChecklist(u: UsuarioActual, id: number) {
  const t = await tareaVisible(u, id);
  const items = await db.task_checklist_items.findMany({ where: { task_id: t.id }, orderBy: { position: "asc" }, select: SELECT_ITEM });
  return items.map(itemDTO);
}

function textoItem(crudo: unknown) {
  const body = texto(crudo);
  if (!body) throw new ErrorApi(400, "Texto requerido.");
  if (body.length > 500) throw new ErrorApi(400, "Máximo 500 caracteres.");
  return body;
}

export async function anadirItem(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const t = await tareaEditable(u, id);
  const body = textoItem(d.body);
  const max = await db.task_checklist_items.aggregate({ where: { task_id: t.id }, _max: { position: true } });
  const item = await db.task_checklist_items.create({
    data: { task_id: t.id, body, position: (max._max.position ?? -1) + 1, is_completed: false, created_at: new Date() },
    select: SELECT_ITEM,
  });
  return itemDTO(item);
}

async function itemDeTarea(taskId: number, itemId: number) {
  const item = await db.task_checklist_items.findFirst({ where: { id: itemId, task_id: taskId } });
  if (!item) throw new ErrorApi(404, "El elemento no existe.");
  return item;
}

export async function cambiarItem(u: UsuarioActual, id: number, itemId: number, d: Record<string, unknown>) {
  const t = await tareaEditable(u, id);
  const item = await itemDeTarea(t.id, itemId);
  const datos: Record<string, unknown> = {};
  if ("body" in d) datos.body = textoItem(d.body);
  if ("is_completed" in d) {
    const hecho = !!d.is_completed;
    if (hecho && !item.is_completed) Object.assign(datos, { is_completed: true, completed_at: new Date(), completed_by_id: u.id });
    else if (!hecho && item.is_completed) Object.assign(datos, { is_completed: false, completed_at: null, completed_by_id: null });
  }
  if ("position" in d) {
    const n = Number(d.position);
    if (!Number.isInteger(n)) throw new ErrorApi(400, "Posición no válida.");
    datos.position = n;
  }
  const r = await db.task_checklist_items.update({ where: { id: item.id }, data: datos, select: SELECT_ITEM });
  return itemDTO(r);
}

export async function borrarItem(u: UsuarioActual, id: number, itemId: number) {
  const t = await tareaEditable(u, id);
  const item = await itemDeTarea(t.id, itemId);
  await db.task_checklist_items.delete({ where: { id: item.id } });
}

/* ─── Comentarios ─── */
function comentarioDTO(c: { id: number; user_id: number; body: string; created_at: Date | null; edited_at: Date | null; users: { username: string } }): ComentarioDTO {
  return { id: c.id, autorId: c.user_id, autor: c.users.username, texto: c.body, creado: c.created_at?.toISOString() ?? "", editado: !!c.edited_at };
}
const SELECT_COMENTARIO = { id: true, user_id: true, body: true, created_at: true, edited_at: true, users: { select: { username: true } } } as const;

export async function listarComentarios(u: UsuarioActual, id: number) {
  const t = await tareaVisible(u, id);
  const filas = await db.task_comments.findMany({ where: { task_id: t.id, deleted_at: null }, orderBy: { created_at: "asc" }, select: SELECT_COMENTARIO });
  return filas.map(comentarioDTO);
}

export async function comentar(u: UsuarioActual, id: number, d: Record<string, unknown>) {
  const t = await tareaEditable(u, id);
  const body = texto(d.body);
  if (!body) throw new ErrorApi(400, "Comentario vacío.");
  if (body.length > 2000) throw new ErrorApi(400, "Comentario demasiado largo.");

  // Solo se puede mencionar a gente activa del ambito de quien escribe (test_mention_notifies_unit_user_only).
  const nombres = new Set([...body.matchAll(/@([A-Za-z0-9_.\-]+)/g)].map((m) => m[1]));
  const personas = nombres.size ? await personasDelAmbito(u) : [];
  const mencionados = personas.filter((p) => nombres.has(p.nombre));
  const comun = { enlace: enlaceTarea(t.id), entidad: { tipo: "task", id: t.id }, actorId: u.id, cuerpo: body.slice(0, 300) };

  const c = await db.$transaction(async (tx) => {
    const c = await tx.task_comments.create({ data: { task_id: t.id, user_id: u.id, body, created_at: new Date() }, select: SELECT_COMENTARIO });
    for (const p of mencionados) await notificar(p.id, { ...comun, tipo: "mention", titulo: `${u.username} te mencionó en: ${t.title}` }, tx);
    const titulo = `Nuevo comentario en: ${t.title}`;
    await notificarVarios([t.assignee_id, t.creator_id], { ...comun, tipo: "task_comment", titulo }, tx);
    const obs = await tx.task_watchers.findMany({ where: { task_id: t.id }, select: { user_id: true } });
    await notificarVarios(obs.map((o) => o.user_id), { ...comun, tipo: "task_comment", titulo }, tx);
    return c;
  });
  await registrarActividad(u.id, "task_comment", `Comentario agregado en tarea ${t.id}`, { tipo: "task", id: t.id });
  return comentarioDTO(c);
}

export async function borrarComentario(u: UsuarioActual, comentarioId: number) {
  const c = await db.task_comments.findFirst({ where: { id: comentarioId, deleted_at: null }, select: { id: true, task_id: true, user_id: true } });
  if (!c) throw new ErrorApi(404, "El comentario no existe.");
  await tareaEditable(u, c.task_id); // 404 si la tarea no se ve
  if (!u.isAdmin && c.user_id !== u.id) throw new ErrorApi(403, "Solo quien escribió el comentario puede borrarlo.");
  await db.task_comments.update({ where: { id: c.id }, data: { deleted_at: new Date() } });
}

/* ─── Observadores ─── */
export async function candidatosObservar(u: UsuarioActual, id: number) {
  const t = await tareaVisible(u, id);
  // Observar existe para cruzar unidades: se ofrece cualquiera activo.
  const [ya, usuarios] = await Promise.all([
    db.task_watchers.findMany({ where: { task_id: t.id }, select: { user_id: true } }),
    db.users.findMany({ where: { is_active: true }, orderBy: { username: "asc" }, select: { id: true, username: true, role: true, areas: { select: { name: true } } } }),
  ]);
  const fuera = new Set(ya.map((w) => w.user_id));
  return usuarios.filter((x) => !fuera.has(x.id)).map((x) => ({ id: x.id, nombre: x.username, unidad: unidadDe(x) }));
}

export async function anadirObservador(u: UsuarioActual, id: number, d: Record<string, unknown>): Promise<ObservadorDTO> {
  const t = await tareaVisible(u, id);
  const usuarioId = Number(d.user_id);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) throw new ErrorApi(400, "Usuario no válido.");
  // Apuntarse uno mismo solo pide ver la tarea; apuntar a otro pide poder editarla.
  if (usuarioId !== u.id && !(await puedeEditarTarea(u, t))) throw new ErrorApi(403, "Solo quien puede editar la tarea añade a otras personas.");
  const obs = await db.users.findUnique({ where: { id: usuarioId }, select: { id: true, username: true, role: true, is_active: true, area_id: true, areas: { select: { name: true } } } });
  if (!obs) throw new ErrorApi(404, "Usuario no encontrado.");
  if (!obs.is_active) throw new ErrorApi(400, "Ese usuario está inactivo.");

  const ambito = await ambitoUnidades(u);
  const compartir = ambito.length > 0 && obs.area_id != null && !ambito.includes(obs.area_id);
  await db.$transaction(async (tx) => {
    await tx.task_watchers.upsert({
      where: { task_id_user_id: { task_id: t.id, user_id: obs.id } },
      create: { task_id: t.id, user_id: obs.id, added_by_id: u.id, created_at: new Date() },
      update: {},
    });
    if (compartir && t.visibility !== "shared") await tx.tasks.update({ where: { id: t.id }, data: { visibility: "shared" } });
    await notificar(obs.id, {
      tipo: "task_watching",
      titulo: `Ahora observas la tarea: ${t.title}`,
      cuerpo: `${u.username} te añadió como observador. Te avisaremos de sus cambios.`,
      enlace: enlaceTarea(t.id),
      entidad: { tipo: "task", id: t.id },
      actorId: u.id,
    }, tx);
  });
  return { usuarioId: obs.id, nombre: obs.username, unidad: unidadDe(obs), soyYo: obs.id === u.id };
}

export async function quitarObservador(u: UsuarioActual, id: number, usuarioId: number) {
  const t = await tareaVisible(u, id);
  // El permiso va antes de buscar la fila: si no, el 404 delataria quien observa.
  if (usuarioId !== u.id && !(await puedeEditarTarea(u, t))) throw new ErrorApi(403, "Sin permisos.");
  const fila = await db.task_watchers.findFirst({ where: { task_id: t.id, user_id: usuarioId }, select: { id: true } });
  if (!fila) throw new ErrorApi(404, "Observador no encontrado.");
  await db.task_watchers.delete({ where: { id: fila.id } });
  // Quien solo veia la tarea por observarla la pierde de vista al salir.
  return { sigueViendo: await puedeVerTarea(u, t) };
}

/* ─── Actividad ─── */
export async function actividadTarea(u: UsuarioActual, id: number): Promise<ActividadDTO[]> {
  const t = await tareaVisible(u, id);
  const filas = await db.activity_logs.findMany({
    where: { entity_type: "task", entity_id: t.id },
    orderBy: { timestamp: "desc" },
    take: 50,
    select: { action: true, detail: true, timestamp: true, users: { select: { username: true } } },
  });
  return filas.map((f) => ({ accion: f.action, detalle: f.detail ?? "", usuario: f.users.username, momento: f.timestamp?.toISOString() ?? "" }));
}
