import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { HERRAMIENTAS, type Herramienta } from "@/lib/auth/session";
import { arbolDeMando, cadenaHaciaArriba, calcularAlcances, type PersonaOrg } from "./mando";

/*
 * Lecturas de administracion (blueprints/admin.py). Solo se llaman detras de
 * exigirAdmin() o conUsuario(..., { soloAdmin: true }).
 *
 * La clave de un proveedor de IA nunca sale de aqui: se enmascara en el
 * servidor y el cliente solo recibe "••••abcd".
 */

/* La cuenta de administrador protegida (DEFAULT_ADMIN_EMAIL de Flask). */
export const EMAIL_ADMIN_PROTEGIDO = (process.env.ADMIN_EMAIL ?? "admin@dataintel.com").toLowerCase();
export const esAdminProtegido = (email: string) => email.toLowerCase() === EMAIL_ADMIN_PROTEGIDO;

export const POR_PAGINA_USUARIOS = 25;
export const POR_PAGINA_ACTIVIDAD = 50;

export function enmascararClave(clave: string): string {
  const k = clave.trim();
  if (k.length <= 8) return "••••";
  return `••••${k.slice(-4)}`;
}

function herramientasDe(role: string, permitidas: string | null): Herramienta[] {
  const todas = Object.keys(HERRAMIENTAS) as Herramienta[];
  if (role === "admin" || !permitidas) return todas;
  try {
    const l = JSON.parse(permitidas);
    return Array.isArray(l) ? todas.filter((h) => l.includes(h)) : todas;
  } catch {
    return todas;
  }
}

/* ── Portada ── */

export async function resumenAdmin() {
  const hace30 = new Date(Date.now() - 30 * 86_400_000);
  const hace1 = new Date(Date.now() - 86_400_000);
  const [
    usuarios, activos, sinUnidad, unidades, lideres, roles, estadosCat, prioridadesCat,
    plantillas, conexiones, activa, consumo, fallos, actividad24, ultima,
  ] = await Promise.all([
    db.users.count(),
    db.users.count({ where: { is_active: true } }),
    db.users.count({ where: { is_active: true, area_id: null } }),
    db.areas.findMany({ select: { id: true } }),
    db.unit_leads.findMany({ select: { area_id: true }, distinct: ["area_id"] }),
    db.roles.count(),
    db.task_statuses.findMany({ select: { es_inicial: true, es_final: true } }),
    db.task_priorities.findMany({ select: { es_defecto: true } }),
    db.pptx_templates.count(),
    db.ai_providers.count(),
    db.ai_providers.findFirst({ where: { is_active: true }, select: { name: true, model: true } }),
    db.ai_usage.aggregate({ where: { created_at: { gte: hace30 } }, _sum: { cost_usd: true }, _count: { _all: true } }),
    db.ai_usage.count({ where: { created_at: { gte: hace30 }, ok: false } }),
    db.activity_logs.count({ where: { timestamp: { gte: hace1 } } }),
    db.activity_logs.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true, action: true, users: { select: { username: true } } } }),
  ]);
  const conLider = new Set(lideres.map((l) => l.area_id));
  return {
    personas: { total: usuarios, activas: activos, inactivas: usuarios - activos, sinUnidad, roles },
    organizacion: { unidades: unidades.length, sinLider: unidades.filter((u) => !conLider.has(u.id)).length },
    catalogo: {
      estados: estadosCat.length,
      iniciales: estadosCat.filter((e) => e.es_inicial).length,
      finales: estadosCat.filter((e) => e.es_final).length,
      prioridades: prioridadesCat.length,
      defecto: prioridadesCat.filter((p) => p.es_defecto).length,
    },
    plantillas: { subidas: plantillas, repositorio: (await plantillasDelRepositorio()).length },
    ia: { conexiones, activa, coste30: consumo._sum.cost_usd ?? 0, llamadas30: consumo._count._all, fallos30: fallos },
    actividad: { ultimas24: actividad24, ultima: ultima ? { cuando: ultima.timestamp?.toISOString() ?? null, accion: ultima.action, quien: ultima.users.username } : null },
  };
}
export type ResumenAdmin = Awaited<ReturnType<typeof resumenAdmin>>;

/* ── Personas ── */

export type FiltrosUsuarios = { q: string; rol: string; unidad: string; estado: string; pagina: number };

export function leerFiltrosUsuarios(p: URLSearchParams): FiltrosUsuarios {
  const n = Number(p.get("p") ?? "1");
  return {
    q: (p.get("q") ?? "").trim().slice(0, 100),
    rol: (p.get("rol") ?? "").trim().slice(0, 30),
    unidad: (p.get("unidad") ?? "").trim(),
    estado: (p.get("estado") ?? "").trim(),
    pagina: Number.isInteger(n) && n > 0 ? n : 1,
  };
}

export async function listarUsuarios(f: FiltrosUsuarios) {
  const y: Prisma.usersWhereInput[] = [{ NOT: { email: { equals: EMAIL_ADMIN_PROTEGIDO, mode: "insensitive" } } }];
  if (f.q) y.push({ OR: [{ username: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }] });
  if (f.rol) y.push({ role: f.rol });
  if (f.unidad === "sin") y.push({ area_id: null });
  else if (/^\d+$/.test(f.unidad)) y.push({ area_id: Number(f.unidad) });
  if (f.estado === "activos") y.push({ is_active: true });
  if (f.estado === "inactivos") y.push({ is_active: false });
  const where: Prisma.usersWhereInput = { AND: y };

  const total = await db.users.count({ where });
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_USUARIOS));
  const pagina = Math.min(f.pagina, paginas);
  const filas = await db.users.findMany({
    where,
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    skip: (pagina - 1) * POR_PAGINA_USUARIOS,
    take: POR_PAGINA_USUARIOS,
    select: {
      id: true, username: true, email: true, role: true, is_active: true, created_at: true, allowed_tools: true,
      area_id: true, manager_id: true, force_logout: true, areas: { select: { name: true } }, manager: { select: { username: true } },
    },
  });
  return {
    total, pagina, paginas,
    filas: filas.map((u) => ({
      id: u.id, nombre: u.username, email: u.email, rol: u.role, activo: u.is_active !== false,
      creado: u.created_at?.toISOString() ?? null, unidadId: u.area_id, unidad: u.areas?.name ?? null,
      managerId: u.manager_id, manager: u.manager?.username ?? null, expulsado: !!u.force_logout,
      herramientas: herramientasDe(u.role, u.allowed_tools),
    })),
  };
}
export type FilaUsuario = Awaited<ReturnType<typeof listarUsuarios>>["filas"][number];

export async function opcionesPersonas() {
  const [roles, unidades, personas, porRol] = await Promise.all([
    db.roles.findMany({ orderBy: { code: "asc" } }),
    db.areas.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.users.findMany({ where: { is_active: true }, orderBy: { username: "asc" }, select: { id: true, username: true } }),
    db.users.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);
  const conteo = new Map(porRol.map((r) => [r.role, r._count._all]));
  return {
    roles: roles.map((r) => ({ id: r.id, codigo: r.code, nombre: r.display_name, descripcion: r.description ?? "", usuarios: conteo.get(r.code) ?? 0 })),
    adminUsuarios: conteo.get("admin") ?? 0,
    unidades: unidades.map((a) => ({ id: a.id, nombre: a.name })),
    personas: personas.map((p) => ({ id: p.id, nombre: p.username })),
  };
}

/* ── Organizacion ── */

export async function organizacion() {
  const [areas, usuarios, lideres, tareasPorUnidad] = await Promise.all([
    db.areas.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, description: true } }),
    db.users.findMany({ where: { is_active: true }, orderBy: { username: "asc" }, select: { id: true, username: true, area_id: true, manager_id: true, is_active: true } }),
    db.unit_leads.findMany({ select: { user_id: true, area_id: true } }),
    db.tasks.groupBy({ by: ["area_id"], where: { deleted_at: null }, _count: { _all: true } }),
  ]);
  const personas: PersonaOrg[] = usuarios.map((u) => ({ id: u.id, nombre: u.username, unidadId: u.area_id, managerId: u.manager_id, activo: u.is_active !== false }));
  const unidades = areas.map((a) => ({ id: a.id, nombre: a.name }));
  const lid = lideres.map((l) => ({ userId: l.user_id, unidadId: l.area_id }));
  const { alcance, papel, aCargo } = calcularAlcances(personas, lid);
  const nombreUnidad = new Map(unidades.map((u) => [u.id, u.nombre]));
  const tareas = new Map(tareasPorUnidad.map((t) => [t.area_id, t._count._all]));

  return {
    arbol: arbolDeMando(personas, unidades, lid),
    unidades: areas.map((a) => ({
      id: a.id, nombre: a.name, descripcion: a.description ?? "",
      personas: personas.filter((p) => p.unidadId === a.id).length,
      tareas: tareas.get(a.id) ?? 0,
      lideres: lid.filter((l) => l.unidadId === a.id).map((l) => ({ id: l.userId, nombre: personas.find((p) => p.id === l.userId)?.nombre ?? `#${l.userId}` })),
    })),
    personas: personas.map((p) => ({
      ...p,
      unidad: p.unidadId != null ? nombreUnidad.get(p.unidadId) ?? null : null,
      papel: papel.get(p.id)!,
      aCargo: aCargo.get(p.id) ?? 0,
      alcance: (alcance.get(p.id) ?? []).map((id) => nombreUnidad.get(id) ?? `#${id}`).sort((a, b) => a.localeCompare(b, "es")),
      cadena: cadenaHaciaArriba(personas, p.id).map((c) => c.nombre),
    })),
  };
}
export type DatosOrganizacion = Awaited<ReturnType<typeof organizacion>>;

/* ── Catalogo ── */

export async function catalogo() {
  const [est, pri, usoE, usoP] = await Promise.all([
    db.task_statuses.findMany({ orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
    db.task_priorities.findMany({ orderBy: [{ orden: "desc" }, { nombre: "asc" }] }),
    db.tasks.groupBy({ by: ["status"], _count: { _all: true } }),
    db.tasks.groupBy({ by: ["priority"], _count: { _all: true } }),
  ]);
  const ue = new Map(usoE.map((x) => [x.status, x._count._all]));
  const up = new Map(usoP.map((x) => [x.priority, x._count._all]));
  return {
    estados: est.map((e) => ({ id: e.id, nombre: e.nombre, orden: e.orden, color: e.color, esInicial: e.es_inicial, esFinal: e.es_final, uso: ue.get(e.nombre) ?? 0 })),
    prioridades: pri.map((p) => ({ id: p.id, nombre: p.nombre, orden: p.orden, color: p.color, esDefecto: p.es_defecto, uso: up.get(p.nombre) ?? 0 })),
  };
}
export type DatosCatalogo = Awaited<ReturnType<typeof catalogo>>;

/* ── Plantillas ── */

export async function plantillasDelRepositorio(): Promise<string[]> {
  const dir = process.env.PLANTILLAS_DIR ?? path.join(process.cwd(), "..", "powerpoints");
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".pptx"))
      .map((f) => f.name)
      .sort();
  } catch {
    return [];
  }
}

export async function plantillas() {
  const [subidas, repo] = await Promise.all([
    db.pptx_templates.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, size_bytes: true, created_at: true, users: { select: { username: true } } },
    }),
    plantillasDelRepositorio(),
  ]);
  const nombres = new Set(subidas.map((s) => s.name));
  return {
    subidas: subidas.map((s) => ({ id: s.id, nombre: s.name, bytes: s.size_bytes, fecha: s.created_at?.toISOString() ?? null, por: s.users?.username ?? null, reemplazaRepositorio: repo.includes(s.name) })),
    repositorio: repo.filter((n) => !nombres.has(n)),
  };
}
export type DatosPlantillas = Awaited<ReturnType<typeof plantillas>>;

/* ── IA ── */

export const PROVEEDORES_IA = ["groq", "openai", "anthropic"] as const;

/* Tarifas de referencia de Anthropic (USD por millon de tokens) para precargar el formulario. */
export const PRECIOS_CONOCIDOS: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5": [3, 15],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
  "claude-fable-5": [10, 50],
};

export async function ia() {
  const [conexiones, porModelo, fallos, porUso] = await Promise.all([
    db.ai_providers.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, provider: true, model: true, api_key: true, is_active: true, created_at: true,
        price_in_per_1m: true, price_out_per_1m: true, users: { select: { username: true } },
      },
    }),
    db.ai_usage.groupBy({
      by: ["provider", "model"],
      _count: { _all: true }, _sum: { tokens_in: true, tokens_out: true, cost_usd: true }, _max: { created_at: true },
      orderBy: { _sum: { cost_usd: "desc" } },
    }),
    db.ai_usage.groupBy({ by: ["model"], where: { ok: false }, _count: { _all: true } }),
    db.ai_usage.groupBy({ by: ["feature"], _count: { _all: true }, _sum: { cost_usd: true }, orderBy: { _sum: { cost_usd: "desc" } } }),
  ]);
  const f = new Map(fallos.map((x) => [x.model, x._count._all]));
  const consumo = porModelo.map((c) => ({
    proveedor: c.provider, modelo: c.model, llamadas: c._count._all, tokensIn: c._sum.tokens_in ?? 0, tokensOut: c._sum.tokens_out ?? 0,
    coste: c._sum.cost_usd ?? 0, ultima: c._max.created_at?.toISOString() ?? null, fallos: f.get(c.model) ?? 0,
  }));
  return {
    // api_key se usa solo para la mascara; el objeto que sale no la lleva.
    conexiones: conexiones.map((c) => ({
      id: c.id, nombre: c.name, proveedor: c.provider, modelo: c.model, clave: enmascararClave(c.api_key), activa: c.is_active,
      creada: c.created_at?.toISOString() ?? null, por: c.users?.username ?? null, precioIn: c.price_in_per_1m, precioOut: c.price_out_per_1m,
    })),
    consumo,
    totales: consumo.reduce((t, c) => ({ llamadas: t.llamadas + c.llamadas, tokensIn: t.tokensIn + c.tokensIn, tokensOut: t.tokensOut + c.tokensOut, coste: t.coste + c.coste }), { llamadas: 0, tokensIn: 0, tokensOut: 0, coste: 0 }),
    porUso: porUso.map((u) => ({ uso: u.feature ?? "sin etiqueta", llamadas: u._count._all, coste: u._sum.cost_usd ?? 0 })),
    hayRespaldoEntorno: !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "no_api_key_provided",
  };
}
export type DatosIa = Awaited<ReturnType<typeof ia>>;

/* ── Actividad ── */

export type FiltrosActividad = { usuario: number | null; accion: string; desde: string; hasta: string; pagina: number };

export function leerFiltrosActividad(p: URLSearchParams): FiltrosActividad {
  const u = Number(p.get("usuario") ?? "");
  const n = Number(p.get("p") ?? "1");
  const fecha = (k: string) => { const v = (p.get(k) ?? "").trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; };
  return {
    usuario: Number.isInteger(u) && u > 0 ? u : null,
    accion: (p.get("accion") ?? "").trim().slice(0, 100),
    desde: fecha("desde"),
    hasta: fecha("hasta"),
    pagina: Number.isInteger(n) && n > 0 ? n : 1,
  };
}

export async function actividad(f: FiltrosActividad) {
  const y: Prisma.activity_logsWhereInput[] = [];
  if (f.usuario) y.push({ user_id: f.usuario });
  if (f.accion) y.push({ action: { contains: f.accion, mode: "insensitive" } });
  // Fechas de negocio: el dia empieza a las 04:00 UTC en Santo Domingo.
  if (f.desde) y.push({ timestamp: { gte: new Date(`${f.desde}T00:00:00-04:00`) } });
  if (f.hasta) y.push({ timestamp: { lt: new Date(Date.parse(`${f.hasta}T00:00:00-04:00`) + 86_400_000) } });
  const where: Prisma.activity_logsWhereInput = { AND: y };
  const total = await db.activity_logs.count({ where });
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_ACTIVIDAD));
  const pagina = Math.min(f.pagina, paginas);
  const filas = await db.activity_logs.findMany({
    where, orderBy: [{ timestamp: "desc" }, { id: "desc" }], skip: (pagina - 1) * POR_PAGINA_ACTIVIDAD, take: POR_PAGINA_ACTIVIDAD,
    select: { id: true, action: true, detail: true, ip_address: true, timestamp: true, user_id: true, users: { select: { username: true } } },
  });
  return {
    total, pagina, paginas,
    filas: filas.map((l) => ({ id: l.id, accion: l.action, detalle: l.detail ?? "", ip: l.ip_address, cuando: l.timestamp?.toISOString() ?? null, usuarioId: l.user_id, usuario: l.users.username })),
  };
}
export type DatosActividad = Awaited<ReturnType<typeof actividad>>;
