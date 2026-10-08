/*
 * Datos de demostración del módulo de tareas en la base newlink_tareas.
 * Idempotente: borra lo sembrado antes (todo lo de tareas y los usuarios
 * @local.test que no son demo ni analista) y lo vuelve a crear.
 *
 *   DATABASE_URL=... npx tsx e2e/tareas/sembrar.ts
 */
import { Pool } from "pg";

// Las columnas de fecha y hora guardan UTC sin zona: pg serializa con la hora local del proceso.
process.env.TZ = "UTC";
import { hoyNegocio } from "../../src/lib/reloj";
import { sumarDias, esFinDeSemana } from "../../src/lib/tareas/fechas";

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_tareas" });
const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

const HOY = hoyNegocio();
const habil = (n: number) => { let d = sumarDias(HOY, n); while (esFinDeSemana(d)) d = sumarDias(d, n < 0 ? -1 : 1); return d; };
const haceHoras = (h: number) => new Date(Date.now() - h * 3_600_000);

async function main() {
  await q("BEGIN");
  for (const t of ["task_tag_links", "task_dependencies", "task_watchers", "task_comments", "task_checklist_items", "task_requests", "notifications", "task_templates"]) await q(`DELETE FROM ${t}`);
  await q("DELETE FROM activity_logs WHERE entity_type IN ('task','task_bulk') OR action LIKE 'task_%'");
  await q("DELETE FROM tasks");
  await q("DELETE FROM task_tags");
  await q("DELETE FROM unit_leads");
  await q("UPDATE users SET manager_id = NULL");
  await q("DELETE FROM users WHERE email LIKE '%@local.test' AND email NOT IN ('demo@local.test','analista@local.test')");

  const area = async (nombre: string) => {
    const r = await q("SELECT id FROM areas WHERE name = $1", [nombre]);
    if (r.rows[0]) return r.rows[0].id as number;
    return (await q("INSERT INTO areas (name, description, created_at) VALUES ($1, '', now()) RETURNING id", [nombre])).rows[0].id as number;
  };
  const DI = await area("Data Intelligence");
  const COM = await area("Comunicación");
  const EST = await area("Estrategia Digital");

  const hash = (await q("SELECT password FROM users WHERE email = 'demo@local.test'")).rows[0].password;
  const id = async (email: string) => (await q("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as number;
  const demo = await id("demo@local.test");
  const analista = await id("analista@local.test");
  await q("UPDATE users SET area_id = $1 WHERE id IN ($2, $3)", [DI, demo, analista]);

  const usuario = async (nombre: string, area_id: number, role = "DI") =>
    (await q("INSERT INTO users (username, email, password, role, is_active, created_at, area_id, is_area_lead) VALUES ($1, $2, $3, $4, true, now(), $5, false) RETURNING id",
      [nombre, `${nombre}@local.test`, hash, role, area_id])).rows[0].id as number;
  const rosa = await usuario("rosa.vargas", EST, "Dirección");
  const lucia = await usuario("lucia.mendez", DI);
  const carlos = await usuario("carlos.rojas", DI);
  const maria = await usuario("maria.perez", DI);
  const pedro = await usuario("pedro.gomez", COM, "Comunicación");
  const jose = await usuario("jose.santos", COM, "Comunicación");
  const ana = await usuario("ana.diaz", COM, "Comunicación");
  await usuario("laura.nunez", EST, "Estrategia");

  // Lucía lidera DI y Pedro Comunicación; Rosa dirige a los dos.
  await q("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2), ($3, $4)", [lucia, DI, pedro, COM]);
  await q("UPDATE users SET manager_id = $1 WHERE id IN ($2, $3)", [rosa, lucia, pedro]);
  await q("UPDATE users SET manager_id = $1 WHERE id IN ($2, $3, $4)", [lucia, analista, carlos, maria]);
  await q("UPDATE users SET manager_id = $1 WHERE id IN ($2, $3)", [pedro, jose, ana]);

  const nombreArea: Record<number, string> = { [DI]: "Data Intelligence", [COM]: "Comunicación", [EST]: "Estrategia Digital" };
  const areaDe: Record<number, number> = { [demo]: DI, [analista]: DI, [lucia]: DI, [carlos]: DI, [maria]: DI, [pedro]: COM, [jose]: COM, [ana]: COM };

  type T = [string, number, number, string, string, string, string?, number?];
  // titulo, asignado, creador, entrega, estado, prioridad, cliente, horas desde el ultimo cambio
  const tareas: T[] = [
    ["Reporte semanal de menciones Banco Popular", analista, lucia, habil(-3), "En Progreso", "Alta", "Banco Popular", 30],
    ["Limpiar exportación de Meltwater de septiembre", analista, analista, habil(-1), "Pendiente", "Media", "Claro", 50],
    ["Clasificar menciones de la campaña de lanzamiento", analista, lucia, HOY, "Pendiente", "Alta", "Claro", 5],
    ["Revisar nube de palabras del informe mensual", analista, carlos, HOY, "En Revisión", "Media", "Banreservas", 3],
    ["Preparar tablero de sentimiento para dirección", analista, analista, HOY, "En Progreso", "Media", "Interno", 70],
    ["Unir archivos de Brandwatch y Talkwalker", analista, maria, habil(1), "Pendiente", "Baja", "Altice", 80],
    ["Análisis de competencia telecomunicaciones", analista, lucia, habil(2), "Bloqueado", "Alta", "Altice", 2],
    ["Informe de crisis: retraso de vuelos", analista, analista, habil(3), "Pendiente", "Alta", "Arajet", 90],
    ["Plantilla de reporte trimestral", analista, lucia, habil(6), "Pendiente", "Media", "Interno", 100],
    ["Depurar diccionario de clasificación", analista, analista, habil(9), "Pendiente", "Baja", "Interno", 120],
    ["Resumen ejecutivo de redes sociales", analista, carlos, habil(14), "Pendiente", "Media", "Banco Popular", 150],
    ["Medición de alcance del patrocinio", analista, analista, habil(-6), "Completado", "Media", "Brugal", 20],
    ["Reporte de menciones del fin de semana", analista, lucia, habil(-2), "Completado", "Alta", "Claro", 40],
    ["Auditoría de fuentes del monitoreo", carlos, lucia, habil(-4), "En Progreso", "Media", "Interno", 60],
    ["Informe mensual de reputación", carlos, carlos, HOY, "Pendiente", "Alta", "Banreservas", 8],
    ["Etiquetado de menciones de producto", carlos, analista, habil(1), "En Progreso", "Media", "Claro", 26],
    ["Cuadro de mando de influenciadores", carlos, lucia, habil(4), "Pendiente", "Baja", "Brugal", 200],
    ["Actualizar consultas booleanas", carlos, carlos, habil(8), "Pendiente", "Media", "Interno", 300],
    ["Benchmark de engagement por canal", maria, lucia, habil(-2), "Bloqueado", "Alta", "Altice", 30],
    ["Revisión de calidad de la clasificación", maria, maria, HOY, "En Revisión", "Media", "Interno", 12],
    ["Análisis de picos de conversación", maria, analista, habil(2), "Pendiente", "Media", "Arajet", 400],
    ["Mapa de temas emergentes", maria, lucia, habil(5), "Pendiente", "Baja", "Banco Popular", 500],
    ["Presentación de resultados Q3", maria, maria, habil(11), "Pendiente", "Alta", "Interno", 600],
    ["Plan de capacitación en la herramienta", lucia, lucia, habil(3), "En Progreso", "Media", "Interno", 700],
    ["Revisión de carga del equipo", lucia, lucia, HOY, "Pendiente", "Media", "Interno", 30],
    ["Contrato de licencias de monitoreo", lucia, demo, habil(-5), "Pendiente", "Alta", "Interno", 150],
    ["Indicadores para el comité", lucia, rosa, habil(7), "Pendiente", "Alta", "Interno", 160],
    ["Configurar alertas de crisis", demo, demo, habil(2), "Pendiente", "Media", "Interno", 170],
    ["Revisión de permisos de usuarios", demo, demo, habil(-1), "En Progreso", "Baja", "Interno", 180],
    ["Archivo histórico de reportes", carlos, carlos, habil(-9), "Completado", "Baja", "Interno", 90],
    ["Nota de prensa del lanzamiento", jose, pedro, HOY, "En Progreso", "Alta", "Claro", 4],
    ["Calendario editorial de octubre", jose, jose, habil(2), "Pendiente", "Media", "Interno", 50],
    ["Respuesta a medios: retraso de vuelos", ana, pedro, habil(-1), "Pendiente", "Alta", "Arajet", 20],
    ["Guion del video corporativo", ana, ana, habil(5), "Pendiente", "Baja", "Brugal", 300],
    ["Dossier de prensa trimestral", pedro, pedro, habil(9), "Pendiente", "Media", "Interno", 400],
    ["Monitoreo de cobertura del evento", jose, pedro, habil(1), "En Revisión", "Media", "Banreservas", 60],
    ["Informe de clipping semanal", ana, jose, habil(-3), "Completado", "Media", "Banco Popular", 70],
    ["Fotos de la rueda de prensa", jose, jose, habil(-4), "Pendiente", "Baja", "Claro", 300],
    ["Brief de campaña navideña", pedro, ana, habil(15), "Pendiente", "Media", "Brugal", 500],
    ["Mensajes clave para portavoces", ana, pedro, HOY, "Pendiente", "Alta", "Altice", 9],
  ];

  const ids: number[] = [];
  for (const [titulo, asig, creador, entrega, estado, prio, cliente, horas] of tareas) {
    const a = areaDe[asig];
    const cambio = haceHoras(horas ?? 48);
    const r = await q(`INSERT INTO tasks (title, description, client, due_date, status, priority, area, area_id, creator_id, assignee_id,
        visibility, is_recurrent, created_at, updated_at, requested_by, directorate)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unit', false, $11, $12, $13, $14) RETURNING id`,
      [titulo, `Entregable para ${cliente}. Revisar fuentes y validar con el líder antes de enviar.`, cliente, entrega, estado, prio,
        nombreArea[a].slice(0, 20), a, creador, asig, haceHoras((horas ?? 48) + 72), cambio, "Gerencia de Marca", "Dirección Comercial"]);
    ids.push(r.rows[0].id);
    // Registro del último cambio, hecho por el creador (sirve para "cambió desde tu última visita").
    await q("INSERT INTO activity_logs (user_id, action, detail, timestamp, entity_type, entity_id) VALUES ($1, $2, $3, $4, 'task', $5)",
      [creador, creador === asig ? "task_create" : "task_update", creador === asig ? `Tarea creada: ${titulo} (1 instancia(s))` : `Tarea movida en el tablero: ${titulo} (Pendiente → ${estado}) (id=${r.rows[0].id})`, cambio, r.rows[0].id]);
  }
  const T = (n: number) => ids[n];

  // Una serie recurrente semanal de analista.
  const madre = (await q(`INSERT INTO tasks (title, description, client, due_date, status, priority, area, area_id, creator_id, assignee_id, visibility, is_recurrent, recurrence_type, created_at, updated_at)
    VALUES ('Corte semanal de indicadores', '', 'Interno', $1, 'Pendiente', 'Media', 'Data Intelligence', $2, $3, $3, 'unit', true, 'Semanal', now(), now()) RETURNING id`, [habil(1), DI, analista])).rows[0].id;
  for (const s of [1, 2, 3]) {
    await q(`INSERT INTO tasks (title, description, client, due_date, status, priority, area, area_id, creator_id, assignee_id, visibility, is_recurrent, recurrence_type, parent_task_id, created_at, updated_at)
      VALUES ('Corte semanal de indicadores', '', 'Interno', $1, 'Pendiente', 'Media', 'Data Intelligence', $2, $3, $3, 'unit', true, 'Semanal', $4, now(), now())`, [sumarDias(habil(1), 7 * s), DI, analista, madre]);
  }

  // Etiquetas: de DI, de Comunicación y una común.
  const tag = async (nombre: string, color: string, area_id: number | null) =>
    (await q("INSERT INTO task_tags (nombre, color, area_id, created_by_id, created_at) VALUES ($1, $2, $3, $4, now()) RETURNING id", [nombre, color, area_id, demo])).rows[0].id as number;
  const cliente = await tag("Cliente", "info", DI);
  const urgente = await tag("Urgente", "alerta", DI);
  const interno = await tag("Interno", "neutro", DI);
  const prensa = await tag("Prensa", "violeta", COM);
  const reporte = await tag("Reporte", "bien", null);
  const enlaces: Array<[number, number]> = [[T(0), cliente], [T(0), reporte], [T(2), urgente], [T(3), reporte], [T(6), cliente], [T(7), urgente],
    [T(8), interno], [T(14), reporte], [T(18), cliente], [T(30), prensa], [T(32), prensa], [T(4), interno], [T(2), prensa]];
  for (const [t, g] of enlaces) await q("INSERT INTO task_tag_links (task_id, tag_id) VALUES ($1, $2)", [t, g]);

  // Dependencias: la competencia espera al benchmark; la crisis espera a la limpieza.
  const dep = (a: number, b: number) => q("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, created_by_id, created_at) VALUES ($1, $2, $3, now())", [a, b, lucia]);
  await dep(T(18), T(6));
  await dep(T(1), T(7));
  await dep(T(13), T(14));
  await dep(T(2), T(4));

  // Checklist y comentarios.
  for (const [t, items] of [[T(0), ["Descargar exportación", "Clasificar menciones", "Redactar hallazgos", "Enviar al cliente"]], [T(2), ["Revisar reglas", "Correr clasificación"]], [T(6), ["Reunir datos", "Gráficos"]]] as Array<[number, string[]]>) {
    for (const [i, body] of items.entries()) {
      await q("INSERT INTO task_checklist_items (task_id, body, position, is_completed, created_at) VALUES ($1, $2, $3, $4, now())", [t, body, i, i < 2]);
    }
  }
  const comentario = async (t: number, autor: number, body: string, horas: number) => {
    await q("INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES ($1, $2, $3, $4)", [t, autor, body, haceHoras(horas)]);
    await q("INSERT INTO activity_logs (user_id, action, detail, timestamp, entity_type, entity_id) VALUES ($1, 'task_comment', $2, $3, 'task', $4)", [autor, `Comentario agregado en tarea ${t}`, haceHoras(horas), t]);
    await q("UPDATE tasks SET updated_at = GREATEST(updated_at, $2) WHERE id = $1", [t, haceHoras(horas)]);
  };
  await comentario(T(0), lucia, "@analista el cliente pidió incluir la comparación con agosto.", 6);
  await comentario(T(0), analista, "Hecho, lo añado en la sección de tendencias.", 4);
  await comentario(T(2), carlos, "Las reglas nuevas ya están cargadas en el diccionario.", 1);

  // Observadores: analista sigue una tarea compartida de Comunicación.
  await q("UPDATE tasks SET visibility = 'shared' WHERE id = $1", [T(30)]);
  await q("INSERT INTO task_watchers (task_id, user_id, added_by_id, created_at) VALUES ($1, $2, $3, now()), ($4, $5, $6, now())", [T(30), analista, pedro, T(14), analista, carlos]);
  await q("INSERT INTO activity_logs (user_id, action, detail, timestamp, entity_type, entity_id) VALUES ($1, 'task_update', $2, $3, 'task', $4)", [jose, `Tarea movida en el tablero: Nota de prensa del lanzamiento (Pendiente → En Progreso) (id=${T(30)})`, haceHoras(3), T(30)]);

  // Plantilla de DI.
  await q("INSERT INTO task_templates (area_id, created_by_id, name, payload_json, created_at) VALUES ($1, $2, 'Reporte mensual de cliente', $3, now())",
    [DI, lucia, JSON.stringify({ title: "Reporte mensual de cliente", description: "Exportar, clasificar y redactar.", client: "", priority: "Media", budget_type: "", due_offset_days: 3, checklist: ["Exportar datos", "Clasificar", "Redactar", "Revisión del líder"] })]);

  // Solicitudes entre unidades.
  const sol = (titulo: string, de: number, desde: number, a: number, estado: string) => q(
    "INSERT INTO task_requests (title, description, client, due_date, priority, requester_id, from_area_id, to_area_id, status, created_at) VALUES ($1, '', 'Interno', $2, 'Media', $3, $4, $5, $6, now())",
    [titulo, habil(4), de, desde, a, estado]);
  await sol("Datos de menciones para la nota de prensa", jose, COM, DI, "Pendiente");
  await sol("Informe de conversación sobre la marca empleadora", ana, COM, DI, "Pendiente");
  await sol("Revisión del calendario de publicaciones", analista, DI, COM, "Pendiente");
  await sol("Ranking de medios del trimestre", pedro, COM, DI, "Aceptada");

  await q("COMMIT");
  console.log(`Sembradas ${tareas.length + 4} tareas. Hoy de negocio: ${HOY}`);
}

main().catch(async (e) => { await q("ROLLBACK").catch(() => {}); console.error(e); process.exitCode = 1; }).finally(() => pool.end());
