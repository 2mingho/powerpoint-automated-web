/*
 * Semilla de la base newlink_admin: una organizacion realista para probar
 * Administracion y el panel de equipo. Idempotente: borra lo sembrado y lo
 * vuelve a crear. Respeta demo@local.test (admin) y analista@local.test.
 *
 *   DATABASE_URL=... npx tsx e2e/admin/semilla.ts
 *
 * Organizacion:
 *   Laura Mendez (directora)
 *     Carlos Perez (manager) -> Data Intelligence, Investigacion
 *     Sofia Ramirez (manager) -> Comunicacion
 *   Andres Gil (manager, fuera de la cadena de Laura) -> Estrategia Digital
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { generarHash } from "../../src/lib/auth/password";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DOMINIO = "equipo.test";

/* PRNG determinista: la misma semilla da los mismos datos en cada maquina. */
let s = 20261008;
const azar = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const elegir = <T,>(l: T[]) => l[Math.floor(azar() * l.length)];

function hoySD(): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" }).format(new Date());
  return new Date(`${iso}T00:00:00.000Z`);
}
const DIA = 86_400_000;

export async function sembrar() {
  // ── Limpieza ──
  const sembrados = await db.users.findMany({ where: { email: { endsWith: `@${DOMINIO}` } }, select: { id: true } });
  const ids = sembrados.map((u) => u.id);
  await db.task_tag_links.deleteMany({});
  await db.task_watchers.deleteMany({});
  await db.task_comments.deleteMany({});
  await db.task_checklist_items.deleteMany({});
  await db.task_dependencies.deleteMany({});
  await db.task_requests.deleteMany({});
  await db.notifications.deleteMany({});
  await db.tasks.updateMany({ data: { parent_task_id: null } });
  await db.tasks.deleteMany({});
  await db.ai_usage.deleteMany({});
  await db.ai_providers.deleteMany({});
  await db.activity_logs.deleteMany({ where: { user_id: { in: ids } } });
  await db.unit_leads.deleteMany({});
  await db.users.updateMany({ data: { manager_id: null } });
  await db.users.deleteMany({ where: { id: { in: ids } } });
  await db.pptx_templates.deleteMany({ where: { name: { startsWith: "e2e_" } } });

  // ── Catalogo por defecto (las pruebas lo renombran y lo restauran) ──
  await db.task_statuses.deleteMany({ where: { nombre: { notIn: ["Pendiente", "En Progreso", "Bloqueado", "En Revisión", "Completado"] } } });
  const estados: [string, number, string, boolean, boolean][] = [
    ["Pendiente", 10, "aviso", true, false], ["En Progreso", 20, "info", false, false], ["Bloqueado", 30, "alerta", false, false],
    ["En Revisión", 40, "violeta", false, false], ["Completado", 50, "bien", false, true],
  ];
  for (const [nombre, orden, color, ini, fin] of estados) {
    await db.task_statuses.upsert({ where: { nombre }, update: { orden, color, es_inicial: ini, es_final: fin }, create: { nombre, orden, color, es_inicial: ini, es_final: fin } });
  }
  await db.task_priorities.deleteMany({ where: { nombre: { notIn: ["Alta", "Media", "Baja"] } } });
  for (const [nombre, orden, color, def] of [["Alta", 30, "alerta", false], ["Media", 20, "aviso", true], ["Baja", 10, "neutro", false]] as const) {
    await db.task_priorities.upsert({ where: { nombre }, update: { orden, color, es_defecto: def }, create: { nombre, orden, color, es_defecto: def } });
  }

  // ── Roles y unidades ──
  for (const [code, display_name] of [["DI", "Data Intelligence"], ["COM", "Comunicación"], ["INV", "Investigación"], ["EST", "Estrategia"], ["DIR", "Dirección"]]) {
    await db.roles.upsert({ where: { code }, update: { display_name }, create: { code, display_name, created_at: new Date() } });
  }
  const unidad = async (name: string, description: string) =>
    (await db.areas.upsert({ where: { name }, update: { description }, create: { name, description, created_at: new Date() } })).id;
  const DI = await unidad("Data Intelligence", "Reportes de social listening y análisis de datos.");
  const COM = await unidad("Comunicación", "Comunicación corporativa y relaciones con medios.");
  const INV = await unidad("Investigación", "Estudios de mercado y encuestas.");
  const EST = await unidad("Estrategia Digital", "Campañas y estrategia en redes.");
  await db.areas.deleteMany({ where: { id: { notIn: [DI, COM, INV, EST] }, users: { none: {} } } });

  // ── Personas ──
  const hash = generarHash("demo1234");
  const persona = async (username: string, local: string, role: string, area_id: number | null, manager_id: number | null) =>
    (await db.users.create({
      data: { username, email: `${local}@${DOMINIO}`, password: hash, role, area_id, manager_id, is_active: true, created_at: new Date(Date.now() - azar() * 200 * DIA), force_logout: false, is_area_lead: false },
    })).id;

  const laura = await persona("Laura Méndez", "laura", "DIR", null, null);
  const carlos = await persona("Carlos Pérez", "carlos", "DI", DI, laura);
  const sofia = await persona("Sofía Ramírez", "sofia", "COM", COM, laura);
  const andres = await persona("Andrés Gil", "andres", "EST", EST, null);
  const ana = await persona("Ana Torres", "ana", "DI", DI, carlos);
  const luis = await persona("Luis Gómez", "luis", "DI", DI, carlos);
  const marta = await persona("Marta Díaz", "marta", "INV", INV, carlos);
  const pedro = await persona("Pedro Ruiz", "pedro", "INV", INV, carlos);
  const elena = await persona("Elena Castro", "elena", "COM", COM, sofia);
  const jorge = await persona("Jorge Navarro", "jorge", "COM", COM, sofia);
  const paula = await persona("Paula Vidal", "paula", "EST", EST, andres);
  const diego = await persona("Diego Romero", "diego", "EST", EST, andres);
  await persona("Rosa Ibáñez", "rosa", "COM", COM, null);
  const inactiva = await persona("Tomás Ferrer", "tomas", "DI", DI, carlos);
  await db.users.update({ where: { id: inactiva }, data: { is_active: false } });

  await db.users.updateMany({ where: { email: "demo@local.test" }, data: { is_active: true, force_logout: false, role: "admin", area_id: DI } });
  const analista = await db.users.update({ where: { email: "analista@local.test" }, data: { is_active: true, force_logout: false, role: "DI", area_id: DI, manager_id: carlos, allowed_tools: null } });
  const demo = (await db.users.findUniqueOrThrow({ where: { email: "demo@local.test" } })).id;

  await db.unit_leads.createMany({ data: [
    { user_id: carlos, area_id: DI }, { user_id: carlos, area_id: INV }, { user_id: sofia, area_id: COM }, { user_id: andres, area_id: EST },
  ] });

  // ── Tareas: ~120 en 8 semanas ──
  const equipo: [number, number, string][] = [
    [analista.id, DI, "Data Intelligence"], [ana, DI, "Data Intelligence"], [luis, DI, "Data Intelligence"], [carlos, DI, "Data Intelligence"],
    [marta, INV, "Investigación"], [pedro, INV, "Investigación"], [elena, COM, "Comunicación"], [jorge, COM, "Comunicación"], [sofia, COM, "Comunicación"],
    [paula, EST, "Estrategia Digital"], [diego, EST, "Estrategia Digital"], [andres, EST, "Estrategia Digital"],
  ];
  const clientes = ["Altice", "Banco Popular", "Claro", "Grupo Ramos", "Brugal", "Cervecería Nacional", "Ministerio de Turismo"];
  const tipos = ["Reporte semanal de menciones", "Análisis de sentimiento", "Monitoreo de crisis", "Informe de competencia", "Clasificación de menciones", "Resumen ejecutivo", "Encuesta de marca", "Plan de contenidos", "Revisión de KPIs", "Mapa de influenciadores"];
  const hoy = hoySD();
  const abiertos = ["Pendiente", "En Progreso", "Bloqueado", "En Revisión"];
  const pesoCarga = [3, 2, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1];
  const bolsa = equipo.flatMap((e, i) => Array(pesoCarga[i]).fill(e) as [number, number, string][]);
  for (let i = 0; i < 124; i++) {
    const [asignado, area_id, area] = elegir(bolsa);
    const creadaDias = Math.floor(azar() * 56);
    const creada = new Date(hoy.getTime() - creadaDias * DIA + (13 + Math.floor(azar() * 8)) * 3600_000);
    const vence = new Date(hoy.getTime() - creadaDias * DIA + Math.floor(2 + azar() * 18) * DIA);
    let status: string;
    let actualizada = new Date(creada.getTime() + Math.floor(azar() * 3) * DIA);
    if (vence < hoy && azar() < 0.72) status = "Completado";
    else if (vence >= hoy && azar() < 0.18) status = "Completado";
    else status = elegir(abiertos);
    if (status === "Completado") {
      const fin = Math.min(hoy.getTime() + 12 * 3600_000, vence.getTime() + (azar() < 0.8 ? -1 : 1) * Math.floor(azar() * 3) * DIA + 15 * 3600_000);
      actualizada = new Date(Math.max(creada.getTime() + 3600_000, fin));
    }
    if (actualizada > new Date()) actualizada = new Date();
    await db.tasks.create({
      data: {
        title: `${elegir(tipos)} · ${elegir(clientes)}`, client: elegir(clientes), description: "Tarea de ejemplo sembrada para el panel de equipo.",
        due_date: vence, start_date: creada, status, priority: azar() < 0.25 ? "Alta" : azar() < 0.7 ? "Media" : "Baja",
        area: area.slice(0, 20), area_id, assignee_id: asignado, creator_id: asignado === carlos || azar() < 0.5 ? carlos : demo,
        created_at: creada, updated_at: actualizada, visibility: "unit", is_recurrent: false, requested_by: elegir(["Dirección", "Cliente", "Cuentas"]),
      },
    });
  }

  // ── IA: dos conexiones y ~70 llamadas en 30 dias ──
  const groq = await db.ai_providers.create({ data: { name: "Groq producción", provider: "groq", model: "llama-3.3-70b-versatile", api_key: "gsk_semilla_SECRETO_no_usar_7f3a", is_active: true, created_at: new Date(), created_by_id: demo, price_in_per_1m: 0.59, price_out_per_1m: 0.79 } });
  const claude = await db.ai_providers.create({ data: { name: "Anthropic análisis", provider: "anthropic", model: "claude-sonnet-5", api_key: "sk-ant-semilla-SECRETO-no-usar-91bc", is_active: false, created_at: new Date(), created_by_id: demo, price_in_per_1m: 3, price_out_per_1m: 15 } });
  for (let i = 0; i < 72; i++) {
    const c = azar() < 0.7 ? groq : claude;
    const ok = azar() > 0.06;
    const tin = ok ? Math.floor(1500 + azar() * 9000) : 0;
    const tout = ok ? Math.floor(300 + azar() * 1800) : 0;
    await db.ai_usage.create({ data: {
      provider_id: c.id, provider: c.provider, model: c.model, feature: elegir(["insights", "insights", "traduccion", "clasificacion"]), tokens_in: tin, tokens_out: tout,
      cost_usd: Math.round(((tin / 1e6) * c.price_in_per_1m + (tout / 1e6) * c.price_out_per_1m) * 1e6) / 1e6, ok,
      created_at: new Date(Date.now() - azar() * 30 * DIA), user_id: elegir([analista.id, ana, luis, marta]),
    } });
  }

  // ── Actividad ──
  for (let i = 0; i < 40; i++) {
    const [quien] = elegir(equipo);
    await db.activity_logs.create({ data: {
      user_id: quien, action: elegir(["login", "task_update", "task_create", "report_generate", "logout"]), detail: "Actividad de ejemplo sembrada.",
      ip_address: "10.0.0." + Math.floor(azar() * 200), timestamp: new Date(Date.now() - azar() * 14 * DIA),
    } });
  }
  console.log(`Semilla lista: ${await db.users.count()} personas, ${await db.tasks.count()} tareas, ${await db.ai_usage.count()} llamadas de IA.`);
}

sembrar().finally(() => db.$disconnect());
