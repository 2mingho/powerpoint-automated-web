import "server-only";
import { resolverCliente } from "@/lib/clientes/resolver";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { alcanceUnidades, ambitoUnidades, unidadesLideradas } from "@/lib/alcance";
import { estadoInicial, prioridades, prioridadPorDefecto, prioridadesValidas } from "@/lib/catalogo";
import { notificar, notificarVarios } from "@/lib/notificaciones";
import { registrarActividad } from "@/lib/actividad";
import { fechaDeIso, hoyNegocio, isoDeFecha } from "@/lib/reloj";
import type { UsuarioActual } from "@/lib/auth/session";
import {
  DIAS_EN_BANDEJA, ordenarBandeja, type Bandeja, type DatosNuevaSolicitud, type EstadoSolicitud,
} from "./reglas";

/*
 * Solicitudes entre unidades (blueprints/task_requests.py).
 *
 *   ver       admin; quien la pidio; quien tiene la unidad destino en su
 *             ambito (Recibidas); quien tiene la unidad origen en su ambito
 *             (Enviadas de su unidad, como en Flask)
 *   resolver  admin, o quien SUPERVISA la unidad destino (alcance, no ambito:
 *             pertenecer a la unidad no da derecho a aceptar en su nombre)
 *   cancelar  quien la pidio, o un admin
 *
 * Lo que alguien no puede ver responde 404, no 403: no se confirma que exista.
 * Las transiciones son atomicas: el cambio de estado es un UPDATE condicionado
 * a status = 'Pendiente', asi que dos aceptaciones simultaneas no crean dos
 * tareas; la segunda encuentra la fila ya resuelta y recibe 409.
 */

export type SolicitudVista = {
  id: number;
  titulo: string;
  descripcion: string;
  cliente: string;
  entrega: string;
  prioridad: string;
  estado: EstadoSolicitud;
  solicitante: { id: number; nombre: string };
  origen: { id: number; nombre: string } | null;
  destino: { id: number; nombre: string };
  resueltaPor: { id: number; nombre: string } | null;
  resuelta: string | null;
  motivo: string;
  tareaId: number | null;
  enviada: string;
  puedeResolver: boolean;
  puedeCancelar: boolean;
  esMia: boolean;
};

const incluir = {
  solicitante: { select: { id: true, username: true } },
  resuelta_por: { select: { id: true, username: true } },
  unidad_origen: { select: { id: true, name: true } },
  unidad_destino: { select: { id: true, name: true } },
} satisfies Prisma.task_requestsInclude;

type Fila = Prisma.task_requestsGetPayload<{ include: typeof incluir }>;

type Contexto = { u: UsuarioActual; ambito: number[]; alcance: number[] };

async function contexto(u: UsuarioActual): Promise<Contexto> {
  const [ambito, alcance] = await Promise.all([ambitoUnidades(u), alcanceUnidades(u)]);
  return { u, ambito, alcance };
}

function puedeVer(c: Contexto, f: { requester_id: number; to_area_id: number; from_area_id: number | null }) {
  return c.u.isAdmin
    || f.requester_id === c.u.id
    || c.ambito.includes(f.to_area_id)
    || (f.from_area_id != null && c.ambito.includes(f.from_area_id));
}

function puedeResolverUnidad(c: Contexto, areaId: number) {
  return c.u.isAdmin || c.alcance.includes(areaId);
}

function vista(c: Contexto, f: Fila): SolicitudVista {
  const pendiente = f.status === "Pendiente";
  return {
    id: f.id,
    titulo: f.title,
    descripcion: f.description ?? "",
    cliente: f.client ?? "",
    entrega: isoDeFecha(f.due_date),
    prioridad: f.priority ?? "Media",
    estado: f.status as EstadoSolicitud,
    solicitante: { id: f.solicitante.id, nombre: f.solicitante.username },
    origen: f.unidad_origen ? { id: f.unidad_origen.id, nombre: f.unidad_origen.name } : null,
    destino: { id: f.unidad_destino.id, nombre: f.unidad_destino.name },
    resueltaPor: f.resuelta_por ? { id: f.resuelta_por.id, nombre: f.resuelta_por.username } : null,
    resuelta: f.resolved_at ? f.resolved_at.toISOString() : null,
    motivo: f.rejection_reason ?? "",
    tareaId: f.created_task_id,
    enviada: (f.created_at ?? new Date(0)).toISOString(),
    puedeResolver: pendiente && puedeResolverUnidad(c, f.to_area_id),
    puedeCancelar: pendiente && (f.requester_id === c.u.id || c.u.isAdmin),
    esMia: f.requester_id === c.u.id,
  };
}

/* Recibidas: a las unidades de su ambito. Enviadas: las suyas y las de su unidad. Cierra en falso. */
function filtroRecibidas(c: Contexto): Prisma.task_requestsWhereInput {
  return { to_area_id: { in: c.ambito } };
}
function filtroEnviadas(c: Contexto): Prisma.task_requestsWhereInput {
  const o: Prisma.task_requestsWhereInput[] = [{ requester_id: c.u.id }];
  if (c.ambito.length) o.push({ from_area_id: { in: c.ambito } });
  return { OR: o };
}

function haceDias(n: number) {
  return new Date(Date.now() - n * 86_400_000);
}

export type Listado = {
  solicitudes: SolicitudVista[];
  contadores: { recibidas: number; enviadas: number; historial: number };
};

export async function listar(u: UsuarioActual, bandeja: Bandeja): Promise<Listado> {
  const c = await contexto(u);
  const recibidas = filtroRecibidas(c);
  const enviadas = filtroEnviadas(c);
  const reciente: Prisma.task_requestsWhereInput = {
    OR: [{ status: "Pendiente" }, { resolved_at: { gte: haceDias(DIAS_EN_BANDEJA) } }],
  };

  let where: Prisma.task_requestsWhereInput;
  if (bandeja === "recibidas") where = { AND: [recibidas, reciente] };
  else if (bandeja === "enviadas") where = { AND: [enviadas, reciente] };
  else where = { AND: [{ OR: [recibidas, enviadas] }, { status: { not: "Pendiente" } }] };

  const [filas, nRecibidas, nEnviadas, nHistorial] = await Promise.all([
    db.task_requests.findMany({
      where,
      include: incluir,
      orderBy: bandeja === "historial" ? [{ resolved_at: "desc" }, { id: "desc" }] : [{ created_at: "desc" }],
      take: bandeja === "historial" ? 200 : 300,
    }),
    db.task_requests.count({ where: { AND: [recibidas, { status: "Pendiente" }] } }),
    db.task_requests.count({ where: { AND: [enviadas, { status: "Pendiente" }] } }),
    db.task_requests.count({ where: { AND: [{ OR: [recibidas, enviadas] }, { status: { not: "Pendiente" } }] } }),
  ]);

  const lista = filas.map((f) => vista(c, f));
  return {
    solicitudes: bandeja === "historial" ? lista : ordenarBandeja(lista),
    contadores: { recibidas: nRecibidas, enviadas: nEnviadas, historial: nHistorial },
  };
}

/* Una solicitud que se puede ver, o 404 (no se confirma que exista). */
async function cargarVisible(c: Contexto, id: number): Promise<Fila> {
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApi(404, "Solicitud no encontrada.");
  const f = await db.task_requests.findUnique({ where: { id }, include: incluir });
  if (!f || !puedeVer(c, f)) throw new ErrorApi(404, "Solicitud no encontrada.");
  return f;
}

export async function obtener(u: UsuarioActual, id: number): Promise<SolicitudVista> {
  const c = await contexto(u);
  return vista(c, await cargarVisible(c, id));
}

/* Unidades a las que no tiene sentido solicitarse trabajo a uno mismo (_unidades_propias). */
export async function unidadesPropias(u: UsuarioActual): Promise<Set<number>> {
  const unidades = new Set(u.isAdmin ? await unidadesLideradas(u.id) : await ambitoUnidades(u));
  if (u.areaId != null) unidades.add(u.areaId);
  return unidades;
}

export async function opcionesFormulario(u: UsuarioActual) {
  const [areas, propias, lista, defecto] = await Promise.all([
    db.areas.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    unidadesPropias(u),
    prioridades(),
    prioridadPorDefecto(),
  ]);
  return {
    unidades: areas.filter((a) => !propias.has(a.id)).map((a) => ({ id: a.id, nombre: a.name })),
    prioridades: lista.map((p) => ({ nombre: p.nombre, tono: p.color })),
    prioridadDefecto: defecto,
    hoy: hoyNegocio(),
  };
}

/* Quien resuelve lo que llega a una unidad: sus lideres activos, o si no tiene, los administradores. */
async function resolutores(areaId: number): Promise<number[]> {
  const lideres = await db.unit_leads.findMany({
    where: { area_id: areaId, users: { is_active: true } },
    select: { user_id: true },
  });
  if (lideres.length) return lideres.map((l) => l.user_id);
  const admins = await db.users.findMany({ where: { is_admin: true, is_active: true }, select: { id: true } });
  return admins.map((a) => a.id);
}

export async function crear(u: UsuarioActual, d: DatosNuevaSolicitud): Promise<SolicitudVista> {
  if ((await unidadesPropias(u)).has(d.unidadDestinoId)) {
    throw new ErrorApi(400, "Esa unidad ya es tuya. Elige otra o crea la tarea directamente.");
  }
  const destino = await db.areas.findUnique({ where: { id: d.unidadDestinoId }, select: { id: true, name: true } });
  if (!destino) throw new ErrorApi(404, "Unidad destino no encontrada.");

  const prioridad = d.prioridad ?? (await prioridadPorDefecto());
  if (!(await prioridadesValidas()).includes(prioridad)) throw new ErrorApi(400, "Prioridad no válida.");

  const avisar = await resolutores(destino.id);
  if (!avisar.length) {
    throw new ErrorApi(400, "Esa unidad no tiene a nadie que pueda recibir solicitudes. Avisa a un administrador.");
  }

  const creada = await db.$transaction(async (tx) => {
    const s = await tx.task_requests.create({
      data: {
        title: d.titulo,
        description: d.descripcion,
        client: d.cliente,
        due_date: d.entrega ? fechaDeIso(d.entrega) : null,
        priority: prioridad,
        requester_id: u.id,
        from_area_id: u.areaId,
        to_area_id: destino.id,
        status: "Pendiente",
        created_at: new Date(),
      },
      include: incluir,
    });
    await notificarVarios(avisar, {
      tipo: "request_received",
      titulo: `Solicitud de tarea: ${d.titulo}`,
      cuerpo: `${u.username} ha solicitado una tarea a tu unidad.`,
      enlace: `/solicitudes?solicitud=${s.id}`,
      entidad: { tipo: "task_request", id: s.id },
      actorId: u.id,
    }, tx);
    return s;
  });

  await registrarActividad(u.id, "task_request_created", `Solicitud #${creada.id}: ${d.titulo} -> ${destino.name}`,
    { tipo: "task_request", id: creada.id });
  return vista(await contexto(u), creada);
}

/* Resolver exige ver la solicitud (si no, 404) y supervisar la unidad destino (si no, 403). */
async function cargarParaResolver(c: Contexto, id: number, verbo: string) {
  const f = await cargarVisible(c, id);
  if (!puedeResolverUnidad(c, f.to_area_id)) {
    throw new ErrorApi(403, `Solo quien lidera la unidad destino puede ${verbo}.`);
  }
  return f;
}

export async function asignables(u: UsuarioActual, id: number) {
  const c = await contexto(u);
  const f = await cargarParaResolver(c, id, "aceptar");
  const usuarios = await db.users.findMany({
    where: { area_id: f.to_area_id, is_active: true },
    select: { id: true, username: true },
    orderBy: { username: "asc" },
  });
  return {
    unidad: f.unidad_destino.name,
    entrega: isoDeFecha(f.due_date),
    usuarios: usuarios.map((x) => ({ id: x.id, nombre: x.username })),
  };
}

const YA_RESUELTA = "La solicitud ya fue resuelta.";

export async function aceptar(u: UsuarioActual, id: number, datos: { responsableId: unknown; entrega: unknown }) {
  const c = await contexto(u);
  const f = await cargarParaResolver(c, id, "aceptar");
  if (f.status !== "Pendiente") throw new ErrorApi(409, YA_RESUELTA);

  const responsableId = Number(datos.responsableId);
  if (!Number.isInteger(responsableId) || responsableId <= 0) throw new ErrorApi(400, "Elige a quién se le asigna.");
  const responsable = await db.users.findUnique({ where: { id: responsableId }, select: { id: true, is_active: true, area_id: true } });
  if (!responsable || !responsable.is_active) throw new ErrorApi(404, "Usuario no encontrado o inactivo.");
  if (responsable.area_id !== f.to_area_id) throw new ErrorApi(400, "El responsable debe pertenecer a la unidad destino.");

  let entrega: Date | null = null;
  if (typeof datos.entrega === "string" && datos.entrega.trim()) {
    entrega = fechaDeIso(datos.entrega.trim());
    if (!entrega) throw new ErrorApi(400, "Fecha de entrega no válida.");
  }
  entrega ??= f.due_date ?? fechaDeIso(hoyNegocio());

  const estado = await estadoInicial();
  const ahora = new Date();

  const tareaId = await db.$transaction(async (tx) => {
    // El candado: solo una transaccion pasa de Pendiente a Aceptada.
    const reclamada = await tx.task_requests.updateMany({
      where: { id: f.id, status: "Pendiente" },
      data: { status: "Aceptada", resolved_by_id: u.id, resolved_at: ahora },
    });
    if (reclamada.count !== 1) throw new ErrorApi(409, YA_RESUELTA);

    const tarea = await tx.tasks.create({
      data: {
        title: f.title,
        description: f.description,
        ...(await resolverCliente(tx, f.client)),
        due_date: entrega!,
        priority: f.priority ?? "Media",
        status: estado,
        visibility: "shared",
        // tasks.area es VARCHAR(20): un nombre de unidad mas largo rompia el INSERT en Flask.
        area: f.unidad_destino.name.slice(0, 20),
        area_id: f.to_area_id,
        creator_id: u.id,
        assignee_id: responsable.id,
        created_at: ahora,
      },
      select: { id: true, title: true },
    });
    await tx.task_watchers.create({
      data: { task_id: tarea.id, user_id: f.requester_id, added_by_id: u.id, created_at: ahora },
    });
    await tx.task_requests.update({ where: { id: f.id }, data: { created_task_id: tarea.id } });

    const enlace = `/tareas?tarea=${tarea.id}`;
    await notificar(f.requester_id, {
      tipo: "request_accepted", titulo: `Solicitud aceptada: ${f.title}`,
      cuerpo: `${u.username} la aceptó y la asignó. Quedas como observador de la tarea.`,
      enlace, entidad: { tipo: "task", id: tarea.id }, actorId: u.id,
    }, tx);
    await notificar(responsable.id, {
      tipo: "task_assigned", titulo: `Te asignaron: ${tarea.title}`,
      cuerpo: `Llegó como solicitud de ${f.unidad_origen?.name ?? f.solicitante.username}.`,
      enlace, entidad: { tipo: "task", id: tarea.id }, actorId: u.id,
    }, tx);
    return tarea.id;
  });

  await registrarActividad(u.id, "task_request_accepted", `Solicitud #${f.id} aceptada, tarea #${tareaId} creada`,
    { tipo: "task_request", id: f.id });
  return { solicitud: await obtener(u, f.id), tareaId };
}

export async function rechazar(u: UsuarioActual, id: number, motivo: string) {
  const c = await contexto(u);
  const f = await cargarParaResolver(c, id, "rechazar");
  if (f.status !== "Pendiente") throw new ErrorApi(409, YA_RESUELTA);

  await db.$transaction(async (tx) => {
    const r = await tx.task_requests.updateMany({
      where: { id: f.id, status: "Pendiente" },
      data: { status: "Rechazada", resolved_by_id: u.id, resolved_at: new Date(), rejection_reason: motivo },
    });
    if (r.count !== 1) throw new ErrorApi(409, YA_RESUELTA);
    await notificar(f.requester_id, {
      tipo: "request_rejected", titulo: `Solicitud rechazada: ${f.title}`, cuerpo: `Motivo: ${motivo}`,
      enlace: `/solicitudes?solicitud=${f.id}`, entidad: { tipo: "task_request", id: f.id }, actorId: u.id,
    }, tx);
  });

  await registrarActividad(u.id, "task_request_rejected", `Solicitud #${f.id} rechazada: ${motivo}`,
    { tipo: "task_request", id: f.id });
  return obtener(u, f.id);
}

export async function cancelar(u: UsuarioActual, id: number) {
  const c = await contexto(u);
  const f = await cargarVisible(c, id);
  if (f.requester_id !== u.id && !u.isAdmin) throw new ErrorApi(403, "Solo quien la pidió puede cancelarla.");
  if (f.status !== "Pendiente") throw new ErrorApi(409, YA_RESUELTA);

  const r = await db.task_requests.updateMany({
    where: { id: f.id, status: "Pendiente" },
    data: { status: "Cancelada", resolved_by_id: u.id, resolved_at: new Date() },
  });
  if (r.count !== 1) throw new ErrorApi(409, YA_RESUELTA);

  await registrarActividad(u.id, "task_request_cancelled", `Solicitud #${f.id} cancelada por ${u.username}`,
    { tipo: "task_request", id: f.id });
  return obtener(u, f.id);
}
