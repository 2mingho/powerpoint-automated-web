/*
 * Apoyo de las pruebas e2e de tareas: datos propios en la base y sesiones
 * selladas con iron-session, sin pasar por el formulario de login (que tiene
 * limite de 5 intentos por minuto).
 */
import type { BrowserContext } from "@playwright/test";
import { hoyNegocio } from "../../src/lib/reloj";
import { sumarDias } from "../../src/lib/tareas/fechas";
import { BASE_URL, iniciarSesion, sql } from "../comun";

export const BASE = BASE_URL;
export const HOY = hoyNegocio();
export { sql, sumarDias };

/* Sesion de ese usuario en el contexto (rota su session_token como un login). */
export async function entrarComo(contexto: BrowserContext, userId: number) {
  await iniciarSesion(contexto, userId, { rotar: true });
}

/* Escenario aislado: dos unidades con un empleado cada una, un compañero y etiquetas. */
export async function escenario(prefijo: string) {
  const sufijo = `${prefijo}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const hash = (await sql<{ password: string }>("SELECT password FROM users WHERE email = 'demo@local.test'"))[0].password;
  const area = async (n: string) => (await sql<{ id: number }>("INSERT INTO areas (name, description, created_at) VALUES ($1, '', now()) RETURNING id", [`${n} ${sufijo}`]))[0].id;
  const alfa = await area("Alfa");
  const beta = await area("Beta");
  const usuario = async (n: string, a: number) => (await sql<{ id: number }>(
    "INSERT INTO users (username, email, password, role, is_active, created_at, area_id, allowed_tools, tour_completed_at) VALUES ($1, $2, $3, 'analista', true, now(), $4, '[\"tasks\"]', now()) RETURNING id",
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
