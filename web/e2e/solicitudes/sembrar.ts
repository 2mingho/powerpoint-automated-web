/*
 * Datos de prueba del modulo de solicitudes (base newlink_solicitudes).
 * Idempotente: vacia solicitudes, tareas y notificaciones y vuelve a crear el
 * escenario. Uso: DATABASE_URL=... npx tsx e2e/solicitudes/sembrar.ts
 *
 *   Data Intelligence   lider.di (manager), analista, demo (admin), nuevo
 *   Comunicación        lider.com (manager), miembro.com; directora dirige a lider.com
 *   Diseño              lider.dis (manager), miembro.dis
 *   Comercial           externo (sin lider: resuelven los admins)
 *   Estrategia…         nombre de mas de 20 caracteres (tasks.area es VARCHAR(20))
 *   sin unidad          sin.unidad
 */
import { Client } from "pg";
import { generarHash } from "../../src/lib/auth/password";

export const CLAVE = "demo1234";
export const UNIDADES = {
  di: "Data Intelligence",
  com: "Comunicación",
  dis: "Diseño",
  comercial: "Comercial",
  est: "Estrategia y Planificación Digital",
} as const;

type U = { email: string; nombre: string; unidad: keyof typeof UNIDADES | null; admin?: boolean; lidera?: keyof typeof UNIDADES; jefe?: string; tour?: boolean };

export const USUARIOS: U[] = [
  { email: "demo@local.test", nombre: "demo", unidad: "di", admin: true },
  { email: "analista@local.test", nombre: "analista", unidad: "di" },
  { email: "lider.di@local.test", nombre: "Lucía Peña", unidad: "di", lidera: "di" },
  { email: "nuevo@local.test", nombre: "Nuevo Ingreso", unidad: "di", tour: false },
  { email: "lider.com@local.test", nombre: "Carlos Mejía", unidad: "com", lidera: "com", jefe: "directora@local.test" },
  { email: "miembro.com@local.test", nombre: "Ana Rosario", unidad: "com" },
  { email: "lider.dis@local.test", nombre: "Diego Santos", unidad: "dis", lidera: "dis" },
  { email: "miembro.dis@local.test", nombre: "Marta Gil", unidad: "dis" },
  { email: "externo@local.test", nombre: "Pedro Comercial", unidad: "comercial" },
  { email: "lider.est@local.test", nombre: "Elena Estrategia", unidad: "est", lidera: "est" },
  { email: "miembro.est@local.test", nombre: "Raúl Estrategia", unidad: "est" },
  { email: "directora@local.test", nombre: "Directora General", unidad: null },
  { email: "sin.unidad@local.test", nombre: "Sin Unidad", unidad: null },
];

export async function sembrar(url = process.env.DATABASE_URL) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("TRUNCATE notifications, task_requests, task_watchers, task_comments, task_checklist_items, task_tag_links, task_dependencies, tasks RESTART IDENTITY CASCADE");

    const area: Record<string, number> = {};
    for (const [clave, nombre] of Object.entries(UNIDADES)) {
      const r = await c.query(
        `INSERT INTO areas (name, description, created_at) VALUES ($1, '', now() at time zone 'utc')
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [nombre]);
      area[clave] = r.rows[0].id;
    }

    const hash = generarHash(CLAVE);
    const id: Record<string, number> = {};
    for (const u of USUARIOS) {
      const r = await c.query(
        `INSERT INTO users (username, email, password, role, is_active, created_at, area_id, tour_completed_at, allowed_tools, force_logout)
         VALUES ($1, $2, $3, $4, true, now() at time zone 'utc', $5, CASE WHEN $6 THEN now() at time zone 'utc' END, NULL, false)
         ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username, role = EXCLUDED.role, is_active = true,
           area_id = EXCLUDED.area_id, tour_completed_at = EXCLUDED.tour_completed_at, allowed_tools = NULL, force_logout = false,
           manager_id = NULL
         RETURNING id`,
        [u.nombre, u.email, hash, u.admin ? "admin" : "DI", u.unidad ? area[u.unidad] : null, u.tour !== false]);
      id[u.email] = r.rows[0].id;
    }
    // La contrasena de los dos usuarios base se respeta si ya existian con otra; aqui todos usan demo1234.
    await c.query("UPDATE users SET password = $1 WHERE email = ANY($2)", [hash, USUARIOS.map((u) => u.email)]);
    for (const u of USUARIOS) if (u.jefe) await c.query("UPDATE users SET manager_id = $1 WHERE id = $2", [id[u.jefe], id[u.email]]);

    await c.query("DELETE FROM unit_leads WHERE user_id = ANY($1)", [Object.values(id)]);
    for (const u of USUARIOS) if (u.lidera) await c.query("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [id[u.email], area[u.lidera]]);

    const sol = async (d: {
      titulo: string; de: string; para: keyof typeof UNIDADES; estado: string; prioridad?: string; entregaDias?: number | null;
      haceHoras: number; resueltaHaceHoras?: number; resuelve?: string; motivo?: string; cliente?: string; descripcion?: string; asignado?: string;
    }) => {
      const solicitante = USUARIOS.find((u) => u.email === d.de)!;
      const r = await c.query(
        `INSERT INTO task_requests (title, description, client, due_date, priority, requester_id, from_area_id, to_area_id, status,
           resolved_by_id, resolved_at, rejection_reason, created_at)
         VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE ((now() at time zone 'America/Santo_Domingo')::date + $4::int) END,
           $5, $6, $7, $8, $9, $10, CASE WHEN $11::int IS NULL THEN NULL ELSE (now() at time zone 'utc') - make_interval(hours => $11::int) END,
           $12, (now() at time zone 'utc') - make_interval(hours => $13::int))
         RETURNING id`,
        [d.titulo, d.descripcion ?? "", d.cliente ?? "", d.entregaDias ?? null, d.prioridad ?? "Media", id[d.de],
          solicitante.unidad ? area[solicitante.unidad] : null, area[d.para], d.estado, d.resuelve ? id[d.resuelve] : null,
          d.resueltaHaceHoras ?? null, d.motivo ?? null, d.haceHoras]);
      const sid = r.rows[0].id as number;
      if (d.estado === "Aceptada" && d.asignado) {
        const t = await c.query(
          `INSERT INTO tasks (title, description, client, due_date, status, area, creator_id, assignee_id, priority, visibility, area_id, created_at, updated_at)
           VALUES ($1, $2, $3, (now() at time zone 'America/Santo_Domingo')::date + 3, 'Pendiente', left($4, 20), $5, $6, $7, 'shared', $8,
             now() at time zone 'utc', now() at time zone 'utc') RETURNING id`,
          [d.titulo, d.descripcion ?? "", d.cliente ?? "", UNIDADES[d.para], id[d.resuelve!], id[d.asignado], d.prioridad ?? "Media", area[d.para]]);
        await c.query("INSERT INTO task_watchers (task_id, user_id, added_by_id, created_at) VALUES ($1, $2, $3, now() at time zone 'utc')", [t.rows[0].id, id[d.de], id[d.resuelve!]]);
        await c.query("UPDATE task_requests SET created_task_id = $1 WHERE id = $2", [t.rows[0].id, sid]);
      }
      return sid;
    };

    const s1 = await sol({ titulo: "Informe de menciones de octubre para Banco Popular", de: "miembro.com@local.test", para: "di", estado: "Pendiente", prioridad: "Alta", entregaDias: 0, haceHoras: 3, cliente: "Banco Popular", descripcion: "Necesitamos el volumen de menciones, el sentimiento y los cinco temas principales.\nFormato: el reporte habitual." });
    await sol({ titulo: "Análisis de sentimiento del lanzamiento", de: "lider.dis@local.test", para: "di", estado: "Pendiente", prioridad: "Media", entregaDias: -2, haceHoras: 50 });
    await sol({ titulo: "Monitoreo de marca para cliente nuevo", de: "sin.unidad@local.test", para: "di", estado: "Pendiente", prioridad: "Baja", entregaDias: null, haceHoras: 26 });
    await sol({ titulo: "Nota de prensa de la campaña de verano", de: "analista@local.test", para: "com", estado: "Pendiente", prioridad: "Alta", entregaDias: 1, haceHoras: 1 });
    await sol({ titulo: "Piezas para redes del informe trimestral", de: "analista@local.test", para: "dis", estado: "Pendiente", prioridad: "Media", entregaDias: 6, haceHoras: 5 });
    await sol({ titulo: "Clipping semanal de competencia", de: "miembro.com@local.test", para: "di", estado: "Aceptada", entregaDias: 3, haceHoras: 30, resueltaHaceHoras: 20, resuelve: "lider.di@local.test", asignado: "analista@local.test" });
    await sol({ titulo: "Dashboard de redes para Comercial", de: "externo@local.test", para: "di", estado: "Rechazada", entregaDias: 2, haceHoras: 40, resueltaHaceHoras: 36, resuelve: "lider.di@local.test", motivo: "Falta el detalle del cliente y el periodo a medir. Vuelve a enviarla con eso." });
    await sol({ titulo: "Banner para el boletín", de: "analista@local.test", para: "dis", estado: "Cancelada", entregaDias: 4, haceHoras: 60, resueltaHaceHoras: 58, resuelve: "analista@local.test" });
    await sol({ titulo: "Resumen de prensa de septiembre", de: "lider.di@local.test", para: "com", estado: "Aceptada", entregaDias: -20, haceHoras: 24 * 30, resueltaHaceHoras: 24 * 29, resuelve: "lider.com@local.test", asignado: "miembro.com@local.test" });
    await sol({ titulo: "Guion para video institucional", de: "miembro.dis@local.test", para: "com", estado: "Pendiente", entregaDias: 10, haceHoras: 8 });

    const notif = async (email: string, kind: string, title: string, body: string | null, link: string | null, haceMin: number, leida = false) =>
      c.query(
        `INSERT INTO notifications (user_id, kind, title, body, link_url, created_at, read_at)
         VALUES ($1, $2, $3, $4, $5, (now() at time zone 'utc') - make_interval(mins => $6::int),
           CASE WHEN $7 THEN now() at time zone 'utc' END)`,
        [id[email], kind, title, body, link, haceMin, leida]);
    await notif("lider.di@local.test", "request_received", "Solicitud de tarea: Informe de menciones de octubre para Banco Popular", "Ana Rosario ha solicitado una tarea a tu unidad.", `/solicitudes?solicitud=${s1}`, 180);
    await notif("lider.di@local.test", "mention", "Te mencionaron en «Clipping semanal»", "@Lucía revisa los filtros de la consulta.", "/tasks?task=1", 600, true);
    await notif("analista@local.test", "task_assigned", "Te asignaron: Clipping semanal de competencia", null, "/tasks?task=1", 1200);
    await notif("analista@local.test", "request_rejected", "Solicitud rechazada: Dashboard de redes", "Motivo: falta detalle.", "/task-requests", 2400, true);

    await c.query("COMMIT");
    return { area, id };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith("sembrar.ts")) {
  sembrar().then(() => console.log("Sembrado newlink_solicitudes")).catch((e) => { console.error(e); process.exit(1); });
}
