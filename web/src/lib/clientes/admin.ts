import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErrorApi } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { claveDeCliente, nombreLimpio, parecidos } from "./nombre";
import { resolverClientes } from "./resolver";

/*
 * Administracion de clientes (solo admin: son globales, y renombrar o unir uno
 * cambia lo que ven todas las unidades). Los cambios de nombre o de enlace de
 * las tareas se escriben con SQL directo para NO tocar tasks.updated_at: no son
 * una edicion de la tarea y no deben avisar "cambio" a nadie ni chocar con quien
 * la tiene abierta.
 */

export const POR_PAGINA_CLIENTES = 25;
const MAX_NOMBRE = 100;
const MAX_TIPO = 40;

export type FiltrosClientes = { q: string; estado: "" | "activos" | "inactivos"; pagina: number };

export function leerFiltrosClientes(p: URLSearchParams): FiltrosClientes {
  const estado = p.get("estado");
  const pagina = Number(p.get("p"));
  return {
    q: (p.get("q") ?? "").trim().slice(0, 100),
    estado: estado === "activos" || estado === "inactivos" ? estado : "",
    pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
  };
}

export async function listarClientes(f: FiltrosClientes) {
  const y: Prisma.clientsWhereInput[] = [];
  const clave = claveDeCliente(f.q);
  if (clave) y.push({ name_key: { contains: clave } });
  if (f.estado) y.push({ is_active: f.estado === "activos" });
  const where: Prisma.clientsWhereInput = y.length ? { AND: y } : {};

  const total = await db.clients.count({ where });
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_CLIENTES));
  const pagina = Math.min(f.pagina, paginas);
  const [filas, todos, pendientes, personas, tipos] = await Promise.all([
    db.clients.findMany({
      where, orderBy: { name_key: "asc" }, skip: (pagina - 1) * POR_PAGINA_CLIENTES, take: POR_PAGINA_CLIENTES,
      select: { id: true, name: true, name_key: true, client_type: true, account_lead_id: true, is_active: true, responsable: { select: { username: true } } },
    }),
    db.clients.findMany({ select: { id: true, name: true, name_key: true }, orderBy: { name_key: "asc" } }),
    contarPendientes(),
    db.users.findMany({ where: { is_active: true }, select: { id: true, username: true }, orderBy: { username: "asc" } }),
    db.clients.findMany({ where: { client_type: { not: null } }, distinct: ["client_type"], select: { client_type: true }, orderBy: { client_type: "asc" } }),
  ]);
  const conteos = await db.tasks.groupBy({ by: ["client_id"], where: { client_id: { in: filas.map((c) => c.id) }, deleted_at: null }, _count: { _all: true } });
  const tareas = new Map(conteos.map((c) => [c.client_id, c._count._all]));
  const candidatos = todos.map((c) => ({ id: c.id, nombre: c.name, clave: c.name_key }));

  return {
    total, pagina, paginas, pendientes,
    filas: filas.map((c) => ({
      id: c.id, nombre: c.name, tipo: c.client_type ?? "", liderId: c.account_lead_id, lider: c.responsable?.username ?? "", activo: c.is_active,
      tareas: tareas.get(c.id) ?? 0,
      parecidos: parecidos(c.name_key, candidatos.filter((o) => o.id !== c.id)).map((o) => ({ id: o.id, nombre: o.nombre })),
    })),
    opciones: {
      personas: personas.map((p) => ({ id: p.id, nombre: p.username })),
      tipos: tipos.map((t) => t.client_type!).filter(Boolean),
      clientes: todos.map((c) => ({ id: c.id, nombre: c.name })),
    },
  };
}
export type ListaClientes = Awaited<ReturnType<typeof listarClientes>>;
export type FilaCliente = ListaClientes["filas"][number];

/* Tareas con un nombre de cliente que todavia no estan enlazadas (p. ej. creadas desde Flask). */
export async function contarPendientes(): Promise<number> {
  const [{ n }] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE client_id IS NULL AND client ~ '[^[:space:]]'`;
  return n;
}

function nombreValido(crudo: unknown): { nombre: string; clave: string } {
  const nombre = nombreLimpio(typeof crudo === "string" ? crudo : "");
  const clave = claveDeCliente(nombre);
  if (!clave) throw new ErrorApi(400, "El cliente necesita un nombre.");
  if (nombre.length > MAX_NOMBRE) throw new ErrorApi(400, `El nombre no puede pasar de ${MAX_NOMBRE} caracteres.`);
  return { nombre, clave };
}

function tipoValido(crudo: unknown): string | null {
  const t = typeof crudo === "string" ? nombreLimpio(crudo) : "";
  if (t.length > MAX_TIPO) throw new ErrorApi(400, `El tipo no puede pasar de ${MAX_TIPO} caracteres.`);
  return t || null;
}

async function liderValido(crudo: unknown): Promise<number | null> {
  if (crudo === null || crudo === "" || crudo === undefined) return null;
  const id = Number(crudo);
  const u = Number.isInteger(id) && id > 0 ? await db.users.findUnique({ where: { id }, select: { id: true, is_active: true } }) : null;
  if (!u || u.is_active === false) throw new ErrorApi(400, "El líder de cuenta no existe o está inactivo.");
  return u.id;
}

async function choque(clave: string, ignorar?: number) {
  const otro = await db.clients.findUnique({ where: { name_key: clave }, select: { id: true, name: true } });
  if (otro && otro.id !== ignorar) throw new ErrorApi(409, `Ya existe el cliente «${otro.name}». Si es el mismo, únelos desde su fila.`);
}

export async function crearCliente(adminId: number, d: Record<string, unknown>) {
  const { nombre, clave } = nombreValido(d.nombre);
  await choque(clave);
  const c = await db.clients.create({
    data: { name: nombre, name_key: clave, client_type: tipoValido(d.tipo), account_lead_id: await liderValido(d.liderId), created_at: new Date() },
    select: { id: true },
  });
  await registrarActividad(adminId, "admin_client_create", `Creó el cliente «${nombre}»`, { tipo: "client", id: c.id });
  return c.id;
}

export async function editarCliente(adminId: number, id: number, d: Record<string, unknown>) {
  const actual = await db.clients.findUnique({ where: { id } });
  if (!actual) throw new ErrorApi(404, "El cliente no existe.");
  const datos: Prisma.clientsUncheckedUpdateInput = {};
  const cambios: string[] = [];
  let renombrado: string | null = null;

  if ("nombre" in d) {
    const { nombre, clave } = nombreValido(d.nombre);
    if (nombre !== actual.name) {
      await choque(clave, id);
      datos.name = nombre;
      datos.name_key = clave;
      renombrado = nombre;
      cambios.push(`nombre: ${actual.name} -> ${nombre}`);
    }
  }
  if ("tipo" in d) { const t = tipoValido(d.tipo); if (t !== actual.client_type) { datos.client_type = t; cambios.push("tipo"); } }
  if ("liderId" in d) { const l = await liderValido(d.liderId); if (l !== actual.account_lead_id) { datos.account_lead_id = l; cambios.push("líder de cuenta"); } }
  if ("activo" in d && typeof d.activo === "boolean" && d.activo !== actual.is_active) { datos.is_active = d.activo; cambios.push(d.activo ? "activado" : "desactivado"); }

  if (Object.keys(datos).length) {
    await db.$transaction(async (tx) => {
      await tx.clients.update({ where: { id }, data: datos });
      // El nombre de las tareas sigue al del cliente, sin tocar su updated_at.
      if (renombrado) await tx.$executeRaw`UPDATE tasks SET client = ${renombrado} WHERE client_id = ${id}`;
    });
  }
  await registrarActividad(adminId, "admin_client_edit", `Editó el cliente #${id}: ${cambios.length ? cambios.join(", ") : "sin cambios"}`, { tipo: "client", id });
}

/* Une `origenId` en `destinoId`: sus tareas pasan al destino y el origen desaparece. */
export async function unirClientes(adminId: number, origenId: number, destinoId: number) {
  if (origenId === destinoId) throw new ErrorApi(400, "Elige otro cliente: no se puede unir uno consigo mismo.");
  const [origen, destino] = await Promise.all([db.clients.findUnique({ where: { id: origenId } }), db.clients.findUnique({ where: { id: destinoId } })]);
  if (!origen || !destino) throw new ErrorApi(404, "El cliente no existe.");
  const movidas = await db.$transaction(async (tx) => {
    const n = await tx.$executeRaw`UPDATE tasks SET client_id = ${destino.id}, client = ${destino.name} WHERE client_id = ${origen.id}`;
    // Los contratos viajan con el cliente: borrar el origen con contratos esta prohibido.
    await tx.$executeRaw`UPDATE contracts SET client_id = ${destino.id} WHERE client_id = ${origen.id}`;
    // El destino conserva lo suyo; lo que le falte lo hereda del origen.
    const herencia: Prisma.clientsUncheckedUpdateInput = {};
    if (!destino.client_type && origen.client_type) herencia.client_type = origen.client_type;
    if (!destino.account_lead_id && origen.account_lead_id) herencia.account_lead_id = origen.account_lead_id;
    if (Object.keys(herencia).length) await tx.clients.update({ where: { id: destino.id }, data: herencia });
    await tx.clients.delete({ where: { id: origen.id } });
    return n;
  });
  await registrarActividad(adminId, "admin_client_merge", `Unió «${origen.name}» en «${destino.name}» (${movidas} tarea(s))`, { tipo: "client", id: destino.id });
  return { movidas, destino: destino.name };
}

export async function borrarCliente(adminId: number, id: number) {
  const c = await db.clients.findUnique({ where: { id }, select: { name: true } });
  if (!c) throw new ErrorApi(404, "El cliente no existe.");
  const tareas = await db.tasks.count({ where: { client_id: id } });
  if (tareas) throw new ErrorApi(409, `«${c.name}» tiene ${tareas} tarea${tareas === 1 ? "" : "s"}. Únelo a otro cliente o márcalo como inactivo.`);
  const contratos = await db.contracts.count({ where: { client_id: id } });
  if (contratos) throw new ErrorApi(409, `«${c.name}» tiene ${contratos} contrato${contratos === 1 ? "" : "s"}. Un cliente con contratos no se puede eliminar: márcalo como inactivo.`);
  await db.clients.delete({ where: { id } });
  await registrarActividad(adminId, "admin_client_delete", `Eliminó el cliente «${c.name}»`, { tipo: "client", id });
}

/*
 * Enlaza las tareas que traen un nombre pero no cliente (las crea Flask mientras
 * conviven): cada nombre va a su cliente por clave, o crea uno nuevo. Mismo
 * criterio seguro que la migracion: solo mayusculas, acentos y espacios.
 */
export async function vincularPendientes(adminId: number) {
  const filas = await db.$queryRaw<{ client: string }[]>`SELECT client FROM tasks WHERE client_id IS NULL AND client ~ '[^[:space:]]' GROUP BY client`;
  const textos = filas.map((f) => f.client).filter((t) => claveDeCliente(t));
  const antes = await db.clients.count();
  const resueltos = await resolverClientes(db, textos);
  let tareas = 0;
  for (const t of textos) {
    const r = resueltos.get(t)!;
    tareas += await db.$executeRaw`UPDATE tasks SET client_id = ${r.client_id}, client = ${r.client} WHERE client_id IS NULL AND client = ${t}`;
  }
  const nuevos = (await db.clients.count()) - antes;
  await registrarActividad(adminId, "admin_client_link", `Vinculó ${tareas} tarea(s) a clientes (${nuevos} cliente(s) nuevo(s))`);
  return { tareas, nuevos };
}
