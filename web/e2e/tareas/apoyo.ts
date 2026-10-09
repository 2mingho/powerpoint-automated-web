/*
 * Apoyo de las pruebas e2e de tareas: datos propios en la base y sesiones
 * selladas con iron-session, sin pasar por el formulario de login (que tiene
 * limite de 5 intentos por minuto).
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

// Las columnas de fecha y hora guardan UTC sin zona: pg serializa con la hora local del proceso.
process.env.TZ = "UTC";
import { sealData } from "iron-session";
import type { BrowserContext } from "@playwright/test";
import { hoyNegocio } from "../../src/lib/reloj";
import { sumarDias } from "../../src/lib/tareas/fechas";

export const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3101";
const SECRETO = process.env.SESSION_SECRET ?? "dev-only-session-secret-change-me-32chars-min";
export const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_tareas", max: 3 });
export const HOY = hoyNegocio();
export { sumarDias };

export async function sql<T = Record<string, unknown>>(texto: string, p: unknown[] = []): Promise<T[]> {
  return (await pool.query(texto, p)).rows as T[];
}

/* Cookie de sesion valida para ese usuario (rota su session_token como un login). */
export async function cookieDe(userId: number) {
  const token = randomBytes(24).toString("hex");
  await sql("UPDATE users SET session_token = $1, force_logout = false WHERE id = $2", [token, userId]);
  const valor = await sealData({ userId, token }, { password: SECRETO });
  return { name: "nl_sesion", value: valor, url: BASE };
}

export async function entrarComo(contexto: BrowserContext, userId: number) {
  await contexto.addCookies([await cookieDe(userId)]);
}

/* Escenario aislado: dos unidades con un empleado cada una, un compañero y etiquetas. */
export async function escenario(prefijo: string) {
  const sufijo = `${prefijo}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const hash = (await sql<{ password: string }>("SELECT password FROM users WHERE email = 'demo@local.test'"))[0].password;
  const area = async (n: string) => (await sql<{ id: number }>("INSERT INTO areas (name, description, created_at) VALUES ($1, '', now()) RETURNING id", [`${n} ${sufijo}`]))[0].id;
  const alfa = await area("Alfa");
  const beta = await area("Beta");
  const usuario = async (n: string, a: number) => (await sql<{ id: number }>(
    "INSERT INTO users (username, email, password, role, is_active, created_at, area_id, allowed_tools, tour_completed_at) VALUES ($1, $2, $3, 'DI', true, now(), $4, '[\"tasks\"]', now()) RETURNING id",
    [`${n}.${sufijo}`, `${n}.${sufijo}@e2e.test`, hash, a]))[0].id;
  const empleado = await usuario("empleado", alfa);
  const companero = await usuario("companero", alfa);
  const ajeno = await usuario("ajeno", beta);
  const tarea = async (titulo: string, a: number, creador: number, asignado: number, estado = "Pendiente", entrega = sumarDias(HOY, 5)) =>
    (await sql<{ id: number }>(`INSERT INTO tasks (title, description, client, due_date, status, priority, area, area_id, creator_id, assignee_id, visibility, is_recurrent, created_at, updated_at)
      VALUES ($1, '', 'Cliente E2E', $2, $3, 'Media', 'E2E', $4, $5, $6, 'unit', false, now() - interval '1 day', now() - interval '1 day') RETURNING id`,
      [titulo, entrega, estado, a, creador, asignado]))[0].id;
  const etiqueta = async (n: string, a: number | null) => (await sql<{ id: number }>("INSERT INTO task_tags (nombre, color, area_id, created_at) VALUES ($1, 'info', $2, now()) RETURNING id", [`${n} ${sufijo}`, a]))[0].id;
  return { sufijo, alfa, beta, empleado, companero, ajeno, tarea, etiqueta };
}

export async function updatedAt(id: number): Promise<string> {
  return (await sql<{ u: Date }>("SELECT updated_at AS u FROM tasks WHERE id = $1", [id]))[0].u.toISOString();
}
