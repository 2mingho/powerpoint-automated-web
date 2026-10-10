/*
 * Semilla unica de las pruebas e2e y de la base de demostracion. Junta en una
 * sola organizacion lo que antes sembraba cada modulo por su cuenta (tareas,
 * solicitudes, administracion y datos). Idempotente: cada pasada deja la base
 * igual, conserva los id de las personas (upsert por correo) y borra lo que
 * crearon las pruebas.
 *
 *   npx tsx e2e/semilla.ts            (usa DATABASE_URL de .env)
 *
 * Organizacion (contrasena demo1234 para todos):
 *
 *   Laura Mendez (directora, sin unidad)
 *     Carlos Perez   lidera Data Intelligence e Investigacion
 *       analista, nuevo, Ana Torres, Luis Gomez (DI) · Marta Diaz, Pedro Ruiz (INV)
 *     Sofia Ramirez  lidera Comunicacion
 *       Elena Castro, Jorge Navarro (COM)
 *   Andres Gil       lidera Estrategia y Planificacion Digital (fuera de la cadena de Laura)
 *       Paula Vidal, Diego Romero
 *   Gabriela Soto    lidera Diseno · Ivan Peralta
 *   Comercial        sin lider (resuelven los admins) · Ramon Baez
 *   Rosa Ibanez (COM, sin superior), Sin Unidad, Tomas Ferrer (inactivo)
 *   demo (admin, DI) y Admin Catalogo (segundo admin)
 *   Cuentas de datos con herramientas recortadas: colega, sin.reportes, herramientas, capturas
 */
import { Pool, type PoolClient } from "pg";
import { generarHash } from "../src/lib/auth/password";
import { hoyNegocio } from "../src/lib/reloj";
import { esFinDeSemana, sumarDias } from "../src/lib/tareas/fechas";
import { agruparVariantes } from "../src/lib/clientes/nombre";
import { DATABASE_URL, exigirBaseDescartable } from "./comun";

export const CLAVE = "demo1234";

export const UNIDADES = {
  di: "Data Intelligence",
  com: "Comunicación",
  inv: "Investigación",
  est: "Estrategia y Planificación Digital", // mas de 20 caracteres: tasks.area es VARCHAR(20)
  dis: "Diseño",
  comercial: "Comercial",
} as const;
type Unidad = keyof typeof UNIDADES;

const TODAS = ["reports", "classification", "file_merge", "csv_analysis", "tasks"];

type Persona = {
  email: string; nombre: string; rol: string; unidad: Unidad | null; jefe?: string; lidera?: Unidad[];
  tour?: boolean; activo?: boolean; herramientas?: string[];
};

/* El orden importa: cada jefe aparece antes que su gente. */
export const PERSONAS: Persona[] = [
  { email: "demo@local.test", nombre: "demo", rol: "admin", unidad: "di" },
  { email: "admin2@equipo.test", nombre: "Admin Catálogo", rol: "admin", unidad: null },
  { email: "laura@equipo.test", nombre: "Laura Méndez", rol: "DIR", unidad: null },
  { email: "carlos@equipo.test", nombre: "Carlos Pérez", rol: "DI", unidad: "di", jefe: "laura@equipo.test", lidera: ["di", "inv"] },
  { email: "sofia@equipo.test", nombre: "Sofía Ramírez", rol: "COM", unidad: "com", jefe: "laura@equipo.test", lidera: ["com"] },
  { email: "andres@equipo.test", nombre: "Andrés Gil", rol: "EST", unidad: "est", lidera: ["est"] },
  { email: "analista@local.test", nombre: "analista", rol: "DI", unidad: "di", jefe: "carlos@equipo.test" },
  { email: "nuevo@local.test", nombre: "Nuevo Ingreso", rol: "DI", unidad: "di", jefe: "carlos@equipo.test", tour: false },
  { email: "ana@equipo.test", nombre: "Ana Torres", rol: "DI", unidad: "di", jefe: "carlos@equipo.test" },
  { email: "luis@equipo.test", nombre: "Luis Gómez", rol: "DI", unidad: "di", jefe: "carlos@equipo.test" },
  { email: "marta@equipo.test", nombre: "Marta Díaz", rol: "INV", unidad: "inv", jefe: "carlos@equipo.test" },
  { email: "pedro@equipo.test", nombre: "Pedro Ruiz", rol: "INV", unidad: "inv", jefe: "carlos@equipo.test" },
  { email: "elena@equipo.test", nombre: "Elena Castro", rol: "COM", unidad: "com", jefe: "sofia@equipo.test" },
  { email: "jorge@equipo.test", nombre: "Jorge Navarro", rol: "COM", unidad: "com", jefe: "sofia@equipo.test" },
  { email: "paula@equipo.test", nombre: "Paula Vidal", rol: "EST", unidad: "est", jefe: "andres@equipo.test" },
  { email: "diego@equipo.test", nombre: "Diego Romero", rol: "EST", unidad: "est", jefe: "andres@equipo.test" },
  { email: "rosa@equipo.test", nombre: "Rosa Ibáñez", rol: "COM", unidad: "com" },
  { email: "tomas@equipo.test", nombre: "Tomás Ferrer", rol: "DI", unidad: "di", jefe: "carlos@equipo.test", activo: false },
  { email: "lider.dis@local.test", nombre: "Gabriela Soto", rol: "DIS", unidad: "dis", lidera: ["dis"] },
  { email: "miembro.dis@local.test", nombre: "Iván Peralta", rol: "DIS", unidad: "dis", jefe: "lider.dis@local.test" },
  { email: "externo@local.test", nombre: "Ramón Báez", rol: "COMERCIAL", unidad: "comercial" },
  { email: "sin.unidad@local.test", nombre: "Sin Unidad", rol: "DI", unidad: null },
  // Cuentas del modulo Datos: cada spec entra con la suya (una sesion nueva rota el token).
  { email: "colega.datos@local.test", nombre: "Colega Datos", rol: "DI", unidad: "di", herramientas: ["reports", "classification", "file_merge", "csv_analysis"] },
  { email: "sin.reportes@local.test", nombre: "Sin Reportes", rol: "DI", unidad: "di", herramientas: ["tasks", "classification"] },
  { email: "herramientas.datos@local.test", nombre: "Herramientas Datos", rol: "DI", unidad: "di", herramientas: ["classification", "file_merge", "csv_analysis"] },
  { email: "capturas.datos@local.test", nombre: "Valeria Núñez", rol: "DI", unidad: "di", herramientas: TODAS },
  { email: "capturas.movil@local.test", nombre: "Valeria Núñez", rol: "DI", unidad: "di", herramientas: TODAS },
];

const HOY = hoyNegocio();
const DIA = 86_400_000;
const habil = (n: number) => { let d = sumarDias(HOY, n); while (esFinDeSemana(d)) d = sumarDias(d, n < 0 ? -1 : 1); return d; };
const haceHoras = (h: number) => new Date(Date.now() - h * 3_600_000);

/* PRNG determinista: la misma semilla da los mismos datos en cada maquina. */
function azaroso(semilla: number) {
  let s = semilla;
  const azar = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return { azar, elegir: <T,>(l: T[]) => l[Math.floor(azar() * l.length)] };
}

type Ctx = { c: PoolClient; area: Record<Unidad, number>; id: Record<string, number> };

async function q<T = Record<string, unknown>>(c: PoolClient, sql: string, p: unknown[] = []) {
  return (await c.query(sql, p)).rows as T[];
}

/* ── Organizacion ── */
async function organizacion(c: PoolClient): Promise<Ctx> {
  await q(c, `TRUNCATE notifications, task_requests, task_watchers, task_comments, task_checklist_items, task_tag_links,
    task_dependencies, task_templates, task_tags, tasks, clients, ai_usage, ai_providers, activity_logs, unit_leads,
    classification_presets, reports, temp_artifacts, contracts, goals, finance_grants RESTART IDENTITY CASCADE`);

  // Catalogo por defecto (las pruebas lo renombran y lo restauran).
  const estados: [string, number, string, boolean, boolean][] = [
    ["Pendiente", 10, "aviso", true, false], ["En Progreso", 20, "info", false, false], ["Bloqueado", 30, "alerta", false, false],
    ["En Revisión", 40, "violeta", false, false], ["Completado", 50, "bien", false, true],
  ];
  await q(c, "DELETE FROM task_statuses WHERE nombre <> ALL($1)", [estados.map((e) => e[0])]);
  for (const [nombre, orden, color, ini, fin] of estados) {
    await q(c, `INSERT INTO task_statuses (nombre, orden, color, es_inicial, es_final) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (nombre) DO UPDATE SET orden = $2, color = $3, es_inicial = $4, es_final = $5`, [nombre, orden, color, ini, fin]);
  }
  const prioridades: [string, number, string, boolean][] = [["Alta", 30, "alerta", false], ["Media", 20, "aviso", true], ["Baja", 10, "neutro", false]];
  await q(c, "DELETE FROM task_priorities WHERE nombre <> ALL($1)", [prioridades.map((p) => p[0])]);
  for (const [nombre, orden, color, def] of prioridades) {
    await q(c, `INSERT INTO task_priorities (nombre, orden, color, es_defecto) VALUES ($1, $2, $3, $4)
      ON CONFLICT (nombre) DO UPDATE SET orden = $2, color = $3, es_defecto = $4`, [nombre, orden, color, def]);
  }

  // Roles.
  const roles = [["DI", "Data Intelligence"], ["COM", "Comunicación"], ["INV", "Investigación"], ["EST", "Estrategia"], ["DIR", "Dirección"], ["DIS", "Diseño"], ["COMERCIAL", "Comercial"]];
  await q(c, "DELETE FROM roles WHERE code <> ALL($1)", [roles.map((r) => r[0])]);
  for (const [code, nombre] of roles) {
    await q(c, "INSERT INTO roles (code, display_name, created_at) VALUES ($1, $2, now()) ON CONFLICT (code) DO UPDATE SET display_name = $2", [code, nombre]);
  }

  // Unidades: las de la organizacion, sin las que dejaron las pruebas.
  const area = {} as Record<Unidad, number>;
  for (const [clave, nombre] of Object.entries(UNIDADES) as [Unidad, string][]) {
    area[clave] = (await q<{ id: number }>(c,
      `INSERT INTO areas (name, description, created_at) VALUES ($1, '', now()) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [nombre]))[0].id;
  }

  // Personas: upsert por correo (los id no cambian entre pasadas).
  const hash = generarHash(CLAVE);
  const id: Record<string, number> = {};
  await q(c, "UPDATE users SET manager_id = NULL");
  for (const p of PERSONAS) {
    id[p.email] = (await q<{ id: number }>(c,
      `INSERT INTO users (username, email, password, role, is_active, created_at, area_id, allowed_tools, force_logout, is_area_lead, manager_id, tour_completed_at, session_token)
       VALUES ($1, $2, $3, $4, $5, now() - interval '120 days', $6, $7, false, false, $8, CASE WHEN $9 THEN now() END, NULL)
       ON CONFLICT (email) DO UPDATE SET username = $1, password = $3, role = $4, is_active = $5, area_id = $6, allowed_tools = $7,
         force_logout = false, is_area_lead = false, manager_id = $8, tour_completed_at = CASE WHEN $9 THEN now() END, session_token = NULL
       RETURNING id`,
      [p.nombre, p.email, hash, p.rol, p.activo !== false, p.unidad ? area[p.unidad] : null,
        p.herramientas ? JSON.stringify(p.herramientas) : null, p.jefe ? id[p.jefe] : null, p.tour !== false]))[0].id;
  }
  // Fuera lo que crearon las pruebas (escenarios de tareas, altas de admin...).
  const ids = Object.values(id);
  await q(c, "DELETE FROM pptx_templates WHERE uploaded_by_id <> ALL($1) OR name LIKE 'e2e_%'", [ids]);
  await q(c, "DELETE FROM users WHERE id <> ALL($1)", [ids]);
  await q(c, "DELETE FROM areas WHERE id <> ALL($1) AND NOT EXISTS (SELECT 1 FROM users WHERE area_id = areas.id)", [Object.values(area)]);
  await q(c, "DELETE FROM roles WHERE code <> ALL($1) AND NOT EXISTS (SELECT 1 FROM users WHERE role = roles.code)", [roles.map((r) => r[0])]);

  for (const p of PERSONAS) for (const u of p.lidera ?? []) await q(c, "INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [id[p.email], area[u]]);
  return { c, area, id };
}

const AREA_TAREA = (nombre: string) => nombre.slice(0, 20);

/* ── Tareas a mano: la semana de analista y de su unidad (pantallas de Tareas e Inicio) ── */
async function tareasDeLaUnidad({ c, area, id }: Ctx) {
  const analista = id["analista@local.test"], carlos = id["carlos@equipo.test"], ana = id["ana@equipo.test"], luis = id["luis@equipo.test"];
  const laura = id["laura@equipo.test"], demo = id["demo@local.test"], sofia = id["sofia@equipo.test"], elena = id["elena@equipo.test"], jorge = id["jorge@equipo.test"];
  const unidadDe: Record<number, Unidad> = { [analista]: "di", [carlos]: "di", [ana]: "di", [luis]: "di", [demo]: "di", [sofia]: "com", [elena]: "com", [jorge]: "com" };

  // titulo, asignado, creador, entrega, estado, prioridad, cliente, horas desde el ultimo cambio
  type T = [string, number, number, string, string, string, string, number];
  const tareas: T[] = [
    ["Reporte semanal de menciones Banco Popular", analista, carlos, habil(-3), "En Progreso", "Alta", "Banco Popular", 30],
    ["Limpiar exportación de Meltwater de septiembre", analista, analista, habil(-1), "Pendiente", "Media", "Claro", 50],
    ["Clasificar menciones de la campaña de lanzamiento", analista, carlos, HOY, "Pendiente", "Alta", "Claro", 5],
    ["Revisar nube de palabras del informe mensual", analista, ana, HOY, "En Revisión", "Media", "Banreservas", 3],
    ["Preparar tablero de sentimiento para dirección", analista, analista, HOY, "En Progreso", "Media", "Interno", 70],
    ["Unir archivos de Brandwatch y Talkwalker", analista, luis, habil(1), "Pendiente", "Baja", "Altice", 80],
    ["Análisis de competencia telecomunicaciones", analista, carlos, habil(2), "Bloqueado", "Alta", "Altice", 2],
    ["Informe de crisis: retraso de vuelos", analista, analista, habil(3), "Pendiente", "Alta", "Arajet", 90],
    ["Plantilla de reporte trimestral", analista, carlos, habil(6), "Pendiente", "Media", "Interno", 100],
    ["Depurar diccionario de clasificación", analista, analista, habil(9), "Pendiente", "Baja", "Interno", 120],
    ["Resumen ejecutivo de redes sociales", analista, ana, habil(14), "Pendiente", "Media", "Banco Popular", 150],
    ["Medición de alcance del patrocinio", analista, analista, habil(-6), "Completado", "Media", "Brugal", 20],
    ["Reporte de menciones del fin de semana", analista, carlos, habil(-2), "Completado", "Alta", "Claro", 40],
    ["Auditoría de fuentes del monitoreo", ana, carlos, habil(-4), "En Progreso", "Media", "Interno", 60],
    ["Informe mensual de reputación", ana, ana, HOY, "Pendiente", "Alta", "Banreservas", 8],
    ["Etiquetado de menciones de producto", ana, analista, habil(1), "En Progreso", "Media", "Claro", 26],
    ["Cuadro de mando de influenciadores", ana, carlos, habil(4), "Pendiente", "Baja", "Brugal", 200],
    ["Actualizar consultas booleanas", ana, ana, habil(8), "Pendiente", "Media", "Interno", 300],
    ["Benchmark de engagement por canal", luis, carlos, habil(-2), "Bloqueado", "Alta", "Altice", 30],
    ["Revisión de calidad de la clasificación", luis, luis, HOY, "En Revisión", "Media", "Interno", 12],
    ["Análisis de picos de conversación", luis, analista, habil(2), "Pendiente", "Media", "Arajet", 400],
    ["Mapa de temas emergentes", luis, carlos, habil(5), "Pendiente", "Baja", "Banco Popular", 500],
    ["Presentación de resultados Q3", luis, luis, habil(11), "Pendiente", "Alta", "Interno", 600],
    ["Plan de capacitación en la herramienta", carlos, carlos, habil(3), "En Progreso", "Media", "Interno", 700],
    ["Revisión de carga del equipo", carlos, carlos, HOY, "Pendiente", "Media", "Interno", 30],
    ["Contrato de licencias de monitoreo", carlos, demo, habil(-5), "Pendiente", "Alta", "Interno", 150],
    ["Indicadores para el comité", carlos, laura, habil(7), "Pendiente", "Alta", "Interno", 160],
    ["Configurar alertas de crisis", demo, demo, habil(2), "Pendiente", "Media", "Interno", 170],
    ["Revisión de permisos de usuarios", demo, demo, habil(-1), "En Progreso", "Baja", "Interno", 180],
    ["Archivo histórico de reportes", ana, ana, habil(-9), "Completado", "Baja", "Interno", 90],
    ["Nota de prensa del lanzamiento", elena, sofia, HOY, "En Progreso", "Alta", "Claro", 4],
    ["Calendario editorial de octubre", elena, elena, habil(2), "Pendiente", "Media", "Interno", 50],
    ["Respuesta a medios: retraso de vuelos", jorge, sofia, habil(-1), "Pendiente", "Alta", "Arajet", 20],
    ["Guion del video corporativo", jorge, jorge, habil(5), "Pendiente", "Baja", "Brugal", 300],
    ["Dossier de prensa trimestral", sofia, sofia, habil(9), "Pendiente", "Media", "Interno", 400],
    ["Monitoreo de cobertura del evento", elena, sofia, habil(1), "En Revisión", "Media", "Banreservas", 60],
    ["Informe de clipping semanal", jorge, elena, habil(-3), "Completado", "Media", "Banco Popular", 70],
    ["Fotos de la rueda de prensa", elena, elena, habil(-4), "Pendiente", "Baja", "Claro", 300],
    ["Brief de campaña navideña", sofia, jorge, habil(15), "Pendiente", "Media", "Brugal", 500],
    ["Mensajes clave para portavoces", jorge, sofia, HOY, "Pendiente", "Alta", "Altice", 9],
  ];

  const ids: number[] = [];
  for (const [titulo, asig, creador, entrega, estado, prio, cliente, horas] of tareas) {
    const u = unidadDe[asig];
    const cambio = haceHoras(horas);
    const [{ id: tid }] = await q<{ id: number }>(c, `INSERT INTO tasks (title, description, client, due_date, status, priority, area, area_id, creator_id, assignee_id,
        visibility, is_recurrent, created_at, updated_at, requested_by, directorate)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unit', false, $11, $12, 'Gerencia de Marca', 'Dirección Comercial') RETURNING id`,
      [titulo, `Entregable para ${cliente}. Revisar fuentes y validar con el líder antes de enviar.`, cliente, entrega, estado, prio,
        AREA_TAREA(UNIDADES[u]), area[u], creador, asig, haceHoras(horas + 72), cambio]);
    ids.push(tid);
    // Registro del ultimo cambio, hecho por el creador (sirve para "cambió desde tu última visita").
    await q(c, "INSERT INTO activity_logs (user_id, action, detail, timestamp, entity_type, entity_id) VALUES ($1, $2, $3, $4, 'task', $5)",
      [creador, creador === asig ? "task_create" : "task_update", creador === asig ? `Tarea creada: ${titulo} (1 instancia(s))` : `Tarea movida en el tablero: ${titulo} (Pendiente → ${estado}) (id=${tid})`, cambio, tid]);
  }
  const T = (n: number) => ids[n];

  // Una serie recurrente semanal de analista.
  const [{ id: madre }] = await q<{ id: number }>(c, `INSERT INTO tasks (title, description, client, due_date, status, priority, area, area_id, creator_id, assignee_id, visibility, is_recurrent, recurrence_type, created_at, updated_at)
    VALUES ('Corte semanal de indicadores', '', 'Interno', $1, 'Pendiente', 'Media', 'Data Intelligence', $2, $3, $3, 'unit', true, 'Semanal', now(), now()) RETURNING id`, [habil(1), area.di, analista]);
  for (const s of [1, 2, 3]) {
    await q(c, `INSERT INTO tasks (title, description, client, due_date, status, priority, area, area_id, creator_id, assignee_id, visibility, is_recurrent, recurrence_type, parent_task_id, created_at, updated_at)
      VALUES ('Corte semanal de indicadores', '', 'Interno', $1, 'Pendiente', 'Media', 'Data Intelligence', $2, $3, $3, 'unit', true, 'Semanal', $4, now(), now())`, [sumarDias(habil(1), 7 * s), area.di, analista, madre]);
  }

  // Etiquetas: de DI, de Comunicacion y una comun.
  const tag = async (nombre: string, color: string, a: number | null) =>
    (await q<{ id: number }>(c, "INSERT INTO task_tags (nombre, color, area_id, created_by_id, created_at) VALUES ($1, $2, $3, $4, now()) RETURNING id", [nombre, color, a, demo]))[0].id;
  const cliente = await tag("Cliente", "info", area.di);
  const urgente = await tag("Urgente", "alerta", area.di);
  const interno = await tag("Interno", "neutro", area.di);
  const prensa = await tag("Prensa", "violeta", area.com);
  const reporte = await tag("Reporte", "bien", null);
  for (const [t, g] of [[T(0), cliente], [T(0), reporte], [T(2), urgente], [T(3), reporte], [T(6), cliente], [T(7), urgente],
    [T(8), interno], [T(14), reporte], [T(18), cliente], [T(30), prensa], [T(32), prensa], [T(4), interno]]) {
    await q(c, "INSERT INTO task_tag_links (task_id, tag_id) VALUES ($1, $2)", [t, g]);
  }

  // Dependencias: la competencia espera al benchmark; la crisis espera a la limpieza.
  for (const [a, b] of [[T(18), T(6)], [T(1), T(7)], [T(13), T(14)], [T(2), T(4)]]) {
    await q(c, "INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, created_by_id, created_at) VALUES ($1, $2, $3, now())", [a, b, carlos]);
  }

  // Checklist y comentarios.
  for (const [t, items] of [[T(0), ["Descargar exportación", "Clasificar menciones", "Redactar hallazgos", "Enviar al cliente"]], [T(2), ["Revisar reglas", "Correr clasificación"]], [T(6), ["Reunir datos", "Gráficos"]]] as Array<[number, string[]]>) {
    for (const [i, body] of items.entries()) {
      await q(c, "INSERT INTO task_checklist_items (task_id, body, position, is_completed, created_at) VALUES ($1, $2, $3, $4, now())", [t, body, i, i < 2]);
    }
  }
  const comentario = async (t: number, autor: number, body: string, horas: number) => {
    await q(c, "INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES ($1, $2, $3, $4)", [t, autor, body, haceHoras(horas)]);
    await q(c, "INSERT INTO activity_logs (user_id, action, detail, timestamp, entity_type, entity_id) VALUES ($1, 'task_comment', $2, $3, 'task', $4)", [autor, `Comentario agregado en tarea ${t}`, haceHoras(horas), t]);
    await q(c, "UPDATE tasks SET updated_at = GREATEST(updated_at, $2) WHERE id = $1", [t, haceHoras(horas)]);
  };
  await comentario(T(0), carlos, "@analista el cliente pidió incluir la comparación con agosto.", 6);
  await comentario(T(0), analista, "Hecho, lo añado en la sección de tendencias.", 4);
  await comentario(T(2), ana, "Las reglas nuevas ya están cargadas en el diccionario.", 1);

  // Observadores: analista sigue una tarea compartida de Comunicacion.
  await q(c, "UPDATE tasks SET visibility = 'shared' WHERE id = $1", [T(30)]);
  await q(c, "INSERT INTO task_watchers (task_id, user_id, added_by_id, created_at) VALUES ($1, $2, $3, now()), ($4, $5, $6, now())", [T(30), analista, sofia, T(14), analista, ana]);
  await q(c, "INSERT INTO activity_logs (user_id, action, detail, timestamp, entity_type, entity_id) VALUES ($1, 'task_update', $2, $3, 'task', $4)",
    [elena, `Tarea movida en el tablero: Nota de prensa del lanzamiento (Pendiente → En Progreso) (id=${T(30)})`, haceHoras(3), T(30)]);

  // Plantilla de DI.
  await q(c, "INSERT INTO task_templates (area_id, created_by_id, name, payload_json, created_at) VALUES ($1, $2, 'Reporte mensual de cliente', $3, now())",
    [area.di, carlos, JSON.stringify({ title: "Reporte mensual de cliente", description: "Exportar, clasificar y redactar.", client: "", priority: "Media", budget_type: "", due_offset_days: 3, checklist: ["Exportar datos", "Clasificar", "Redactar", "Revisión del líder"] })]);
}

/* ── Historico: ~120 tareas en 8 semanas para el panel de equipo ── */
async function historico({ c, area, id }: Ctx) {
  const { azar, elegir } = azaroso(20261008);
  const e = (email: string, u: Unidad): [number, Unidad] => [id[email], u];
  // Personas y peso de carga; analista ya tiene su semana a mano.
  const bolsa: [number, Unidad][] = [
    ...Array(2).fill(e("ana@equipo.test", "di")), e("luis@equipo.test", "di"), e("carlos@equipo.test", "di"), e("analista@local.test", "di"),
    ...Array(2).fill(e("marta@equipo.test", "inv")), e("pedro@equipo.test", "inv"),
    ...Array(2).fill(e("elena@equipo.test", "com")), e("jorge@equipo.test", "com"), e("sofia@equipo.test", "com"),
    e("paula@equipo.test", "est"), e("diego@equipo.test", "est"), e("andres@equipo.test", "est"),
  ];
  const clientes = ["Altice", "Banco Popular", "Claro", "Grupo Ramos", "Brugal", "Cervecería Nacional", "Ministerio de Turismo"];
  const tipos = ["Reporte semanal de menciones", "Análisis de sentimiento", "Monitoreo de crisis", "Informe de competencia", "Clasificación de menciones", "Resumen ejecutivo", "Encuesta de marca", "Plan de contenidos", "Revisión de KPIs", "Mapa de influenciadores"];
  const abiertos = ["Pendiente", "En Progreso", "Bloqueado", "En Revisión"];
  const hoy = new Date(`${HOY}T00:00:00.000Z`);
  const carlos = id["carlos@equipo.test"], demo = id["demo@local.test"];
  const filas: unknown[][] = [];
  for (let i = 0; i < 120; i++) {
    const [asignado, u] = elegir(bolsa);
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
    // Las entregas caen en dias habiles, como exige la app.
    let entrega = vence.toISOString().slice(0, 10);
    while (esFinDeSemana(entrega)) entrega = sumarDias(entrega, 1);
    filas.push([`${elegir(tipos)} · ${elegir(clientes)}`, elegir(clientes), entrega, creada.toISOString().slice(0, 10), status,
      azar() < 0.25 ? "Alta" : azar() < 0.7 ? "Media" : "Baja", AREA_TAREA(UNIDADES[u]), area[u], asignado,
      asignado === carlos || azar() < 0.5 ? carlos : demo, creada, actualizada, elegir(["Dirección", "Cliente", "Cuentas"])]);
  }
  for (const f of filas) {
    await q(c, `INSERT INTO tasks (title, client, description, due_date, start_date, status, priority, area, area_id, assignee_id, creator_id,
        created_at, updated_at, requested_by, visibility, is_recurrent)
      VALUES ($1, $2, 'Tarea del histórico del equipo.', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'unit', false)`, f);
  }
}

/* ── IA y actividad ── */
async function iaYActividad({ c, id }: Ctx) {
  const { azar, elegir } = azaroso(42);
  const demo = id["demo@local.test"];
  const conexion = async (name: string, provider: string, model: string, key: string, activa: boolean, pin: number, pout: number) =>
    (await q<{ id: number }>(c, `INSERT INTO ai_providers (name, provider, model, api_key, is_active, created_at, created_by_id, price_in_per_1m, price_out_per_1m)
      VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8) RETURNING id`, [name, provider, model, key, activa, demo, pin, pout]))[0].id;
  const groq = { id: await conexion("Groq producción", "groq", "llama-3.3-70b-versatile", "gsk_semilla_SECRETO_no_usar_7f3a", true, 0.59, 0.79), provider: "groq", model: "llama-3.3-70b-versatile", pin: 0.59, pout: 0.79 };
  const claude = { id: await conexion("Anthropic análisis", "anthropic", "claude-sonnet-5", "sk-ant-semilla-SECRETO-no-usar-91bc", false, 3, 15), provider: "anthropic", model: "claude-sonnet-5", pin: 3, pout: 15 };
  const usuarios = ["analista@local.test", "ana@equipo.test", "luis@equipo.test", "marta@equipo.test"].map((e) => id[e]);
  for (let i = 0; i < 72; i++) {
    const k = azar() < 0.7 ? groq : claude;
    const ok = azar() > 0.06;
    const tin = ok ? Math.floor(1500 + azar() * 9000) : 0;
    const tout = ok ? Math.floor(300 + azar() * 1800) : 0;
    await q(c, `INSERT INTO ai_usage (provider_id, provider, model, feature, tokens_in, tokens_out, cost_usd, ok, created_at, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [k.id, k.provider, k.model, elegir(["insights", "insights", "traduccion", "clasificacion"]), tin, tout,
        Math.round(((tin / 1e6) * k.pin + (tout / 1e6) * k.pout) * 1e6) / 1e6, ok, new Date(Date.now() - azar() * 30 * DIA), elegir(usuarios)]);
  }
  const equipo = ["analista@local.test", "ana@equipo.test", "luis@equipo.test", "carlos@equipo.test", "marta@equipo.test", "elena@equipo.test", "sofia@equipo.test", "paula@equipo.test"].map((e) => id[e]);
  for (let i = 0; i < 40; i++) {
    await q(c, "INSERT INTO activity_logs (user_id, action, detail, ip_address, timestamp) VALUES ($1, $2, 'Actividad de ejemplo sembrada.', $3, $4)",
      [elegir(equipo), elegir(["login", "report_generate", "logout"]), "10.0.0." + Math.floor(azar() * 200), new Date(Date.now() - azar() * 14 * DIA)]);
  }
}

/* ── Solicitudes entre unidades y avisos (se vuelve a sembrar antes de cada bateria de solicitudes) ── */
const TITULOS_AVISOS = ["Solicitud de tarea: Informe de menciones de octubre para Banco Popular", "Te mencionaron en «Clipping semanal»",
  "Te asignaron: Clipping semanal de competencia", "Solicitud rechazada: Dashboard de redes"];

async function solicitudes({ c, area, id }: Ctx) {
  // Fuera las solicitudes, las tareas que crearon y sus avisos.
  const creadas = (await q<{ id: number }>(c, "SELECT created_task_id AS id FROM task_requests WHERE created_task_id IS NOT NULL")).map((r) => r.id);
  await q(c, "DELETE FROM notifications WHERE kind LIKE 'request_%' OR title = ANY($1) OR (entity_type = 'task' AND entity_id = ANY($2))", [TITULOS_AVISOS, creadas]);
  await q(c, "DELETE FROM task_requests");
  for (const t of ["task_watchers", "task_comments", "task_checklist_items", "task_tag_links"]) await q(c, `DELETE FROM ${t} WHERE task_id = ANY($1)`, [creadas]);
  await q(c, "DELETE FROM task_dependencies WHERE blocker_task_id = ANY($1) OR blocked_task_id = ANY($1)", [creadas]);
  await q(c, "DELETE FROM tasks WHERE id = ANY($1)", [creadas]);
  // Lo que las pruebas de solicitudes tocan de las personas.
  await q(c, "UPDATE users SET tour_completed_at = NULL WHERE email = 'nuevo@local.test'");
  await q(c, "UPDATE users SET allowed_tools = NULL WHERE email = 'sofia@equipo.test'");

  const unidadDe = (email: string) => PERSONAS.find((p) => p.email === email)!.unidad;
  const sol = async (d: {
    titulo: string; de: string; para: Unidad; estado: string; prioridad?: string; entregaDias?: number | null;
    haceHoras: number; resueltaHaceHoras?: number; resuelve?: string; motivo?: string; cliente?: string; descripcion?: string; asignado?: string;
  }) => {
    const desde = unidadDe(d.de);
    const [{ id: sid }] = await q<{ id: number }>(c,
      `INSERT INTO task_requests (title, description, client, due_date, priority, requester_id, from_area_id, to_area_id, status,
         resolved_by_id, resolved_at, rejection_reason, created_at)
       VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE ((now() at time zone 'America/Santo_Domingo')::date + $4::int) END,
         $5, $6, $7, $8, $9, $10, CASE WHEN $11::int IS NULL THEN NULL ELSE (now() at time zone 'utc') - make_interval(hours => $11::int) END,
         $12, (now() at time zone 'utc') - make_interval(hours => $13::int))
       RETURNING id`,
      [d.titulo, d.descripcion ?? "", d.cliente ?? "", d.entregaDias ?? null, d.prioridad ?? "Media", id[d.de],
        desde ? area[desde] : null, area[d.para], d.estado, d.resuelve ? id[d.resuelve] : null,
        d.resueltaHaceHoras ?? null, d.motivo ?? null, d.haceHoras]);
    let tareaId: number | null = null;
    if (d.estado === "Aceptada" && d.asignado) {
      tareaId = (await q<{ id: number }>(c,
        `INSERT INTO tasks (title, description, client, due_date, status, area, creator_id, assignee_id, priority, visibility, area_id, created_at, updated_at, is_recurrent)
         VALUES ($1, $2, $3, $4, 'Pendiente', $5, $6, $7, $8, 'shared', $9, now() at time zone 'utc', now() at time zone 'utc', false) RETURNING id`,
        [d.titulo, d.descripcion ?? "", d.cliente ?? "", habil(3), AREA_TAREA(UNIDADES[d.para]), id[d.resuelve!], id[d.asignado], d.prioridad ?? "Media", area[d.para]]))[0].id;
      await q(c, "INSERT INTO task_watchers (task_id, user_id, added_by_id, created_at) VALUES ($1, $2, $3, now() at time zone 'utc')", [tareaId, id[d.de], id[d.resuelve!]]);
      await q(c, "UPDATE task_requests SET created_task_id = $1 WHERE id = $2", [tareaId, sid]);
    }
    return { sid, tareaId };
  };

  const { sid: s1 } = await sol({ titulo: "Informe de menciones de octubre para Banco Popular", de: "elena@equipo.test", para: "di", estado: "Pendiente", prioridad: "Alta", entregaDias: 0, haceHoras: 3, cliente: "Banco Popular", descripcion: "Necesitamos el volumen de menciones, el sentimiento y los cinco temas principales.\nFormato: el reporte habitual." });
  await sol({ titulo: "Análisis de sentimiento del lanzamiento", de: "lider.dis@local.test", para: "di", estado: "Pendiente", prioridad: "Media", entregaDias: -2, haceHoras: 50 });
  await sol({ titulo: "Monitoreo de marca para cliente nuevo", de: "sin.unidad@local.test", para: "di", estado: "Pendiente", prioridad: "Baja", entregaDias: null, haceHoras: 26 });
  await sol({ titulo: "Nota de prensa de la campaña de verano", de: "analista@local.test", para: "com", estado: "Pendiente", prioridad: "Alta", entregaDias: 1, haceHoras: 1 });
  await sol({ titulo: "Piezas para redes del informe trimestral", de: "analista@local.test", para: "dis", estado: "Pendiente", prioridad: "Media", entregaDias: 6, haceHoras: 5 });
  const { tareaId: clipping } = await sol({ titulo: "Clipping semanal de competencia", de: "elena@equipo.test", para: "di", estado: "Aceptada", entregaDias: 3, haceHoras: 30, resueltaHaceHoras: 20, resuelve: "carlos@equipo.test", asignado: "analista@local.test" });
  await sol({ titulo: "Dashboard de redes para Comercial", de: "externo@local.test", para: "di", estado: "Rechazada", entregaDias: 2, haceHoras: 40, resueltaHaceHoras: 36, resuelve: "carlos@equipo.test", motivo: "Falta el detalle del cliente y el periodo a medir. Vuelve a enviarla con eso." });
  await sol({ titulo: "Banner para el boletín", de: "analista@local.test", para: "dis", estado: "Cancelada", entregaDias: 4, haceHoras: 60, resueltaHaceHoras: 58, resuelve: "analista@local.test" });
  await sol({ titulo: "Resumen de prensa de septiembre", de: "carlos@equipo.test", para: "com", estado: "Aceptada", entregaDias: -20, haceHoras: 24 * 30, resueltaHaceHoras: 24 * 29, resuelve: "sofia@equipo.test", asignado: "elena@equipo.test" });
  await sol({ titulo: "Guion para video institucional", de: "miembro.dis@local.test", para: "com", estado: "Pendiente", entregaDias: 10, haceHoras: 8 });
  await sol({ titulo: "Datos de menciones para la nota de prensa", de: "jorge@equipo.test", para: "di", estado: "Pendiente", entregaDias: 4, haceHoras: 20 });
  await sol({ titulo: "Revisión del calendario de publicaciones", de: "ana@equipo.test", para: "com", estado: "Pendiente", entregaDias: 4, haceHoras: 22 });

  const notif = async (email: string, kind: string, title: string, body: string | null, link: string | null, entidad: [string, number] | null, haceMin: number, leida = false) =>
    q(c, `INSERT INTO notifications (user_id, kind, title, body, link_url, entity_type, entity_id, created_at, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (now() at time zone 'utc') - make_interval(mins => $8::int), CASE WHEN $9 THEN now() at time zone 'utc' END)`,
      [id[email], kind, title, body, link, entidad?.[0] ?? null, entidad?.[1] ?? null, haceMin, leida]);
  // Dos con el enlace de Flask (/tasks?task=, /task-requests): la campana los traduce.
  await notif("carlos@equipo.test", "request_received", TITULOS_AVISOS[0], "Elena Castro ha solicitado una tarea a tu unidad.", `/solicitudes?solicitud=${s1}`, ["task_request", s1], 180);
  await notif("carlos@equipo.test", "mention", TITULOS_AVISOS[1], "@Carlos revisa los filtros de la consulta.", `/tasks?task=${clipping}`, ["task", clipping!], 600, true);
  await notif("analista@local.test", "task_assigned", TITULOS_AVISOS[2], null, `/tasks?task=${clipping}`, ["task", clipping!], 1200);
  await notif("analista@local.test", "request_rejected", TITULOS_AVISOS[3], "Motivo: falta detalle.", "/task-requests", null, 2400, true);
}

async function conCliente<T>(fn: (c: PoolClient) => Promise<T>) {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

async function contexto(c: PoolClient): Promise<Ctx> {
  const area = {} as Record<Unidad, number>;
  for (const [k, n] of Object.entries(UNIDADES) as [Unidad, string][]) area[k] = (await q<{ id: number }>(c, "SELECT id FROM areas WHERE name = $1", [n]))[0].id;
  const id: Record<string, number> = {};
  for (const r of await q<{ id: number; email: string }>(c, "SELECT id, email FROM users")) id[r.email] = r.id;
  return { c, area, id };
}

/* Un cliente por nombre (mayusculas, acentos y espacios no cuentan), como la migracion 0016, y las tareas enlazadas. */
async function clientes(c: PoolClient) {
  const filas = await q<{ client: string; n: number }>(c, "SELECT client, count(*)::int AS n FROM tasks WHERE client IS NOT NULL AND client <> '' GROUP BY client");
  for (const g of agruparVariantes(filas.map((f) => ({ nombre: f.client, n: f.n })))) {
    const [{ id }] = await q<{ id: number }>(c, "INSERT INTO clients (name, name_key, is_active, created_at) VALUES ($1, $2, true, now()) RETURNING id", [g.nombre, g.clave]);
    await q(c, "UPDATE tasks SET client_id = $1, client = $2 WHERE client = ANY($3)", [id, g.nombre, g.variantes.map((v) => v.nombre)]);
  }
}

/* La base entera, desde cero. */
export async function sembrarTodo() {
  exigirBaseDescartable();
  return conCliente(async (c) => {
    const ctx = await organizacion(c);
    await tareasDeLaUnidad(ctx);
    await historico(ctx);
    await iaYActividad(ctx);
    await solicitudes(ctx);
    await clientes(c);
    const [n] = await q<{ personas: string; tareas: string; solicitudes: string }>(c,
      "SELECT (SELECT count(*) FROM users) personas, (SELECT count(*) FROM tasks) tareas, (SELECT count(*) FROM task_requests) solicitudes");
    return n;
  });
}

/* Solo el escenario de solicitudes (las pruebas lo consumen: aceptan, rechazan, cancelan). */
export async function sembrarSolicitudes() {
  exigirBaseDescartable();
  await conCliente(async (c) => solicitudes(await contexto(c)));
}

if (process.argv[1]?.endsWith("semilla.ts")) {
  sembrarTodo()
    .then((n) => console.log(`Semilla lista (${HOY}): ${n.personas} personas, ${n.tareas} tareas, ${n.solicitudes} solicitudes.`))
    .catch((e) => { console.error(e); process.exit(1); });
}
