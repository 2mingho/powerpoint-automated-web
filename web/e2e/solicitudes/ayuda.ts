import { request, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { BASE_URL, iniciarSesion, selloSesion, sql } from "../comun";
import { sembrarSolicitudes } from "../semilla";

/*
 * Utilidades de las pruebas de solicitudes, sobre la base comun. La sesion se
 * sella con el secreto de la app en vez de pasar por el formulario.
 */
export { BASE_URL };

/* Vuelve a dejar el escenario de solicitudes como recien sembrado, sin tocar lo demas. */
export function sembrar() {
  return sembrarSolicitudes();
}

export const consulta = sql;

export async function idDe(email: string) {
  const [u] = await sql<{ id: number; session_token: string | null }>("SELECT id, session_token FROM users WHERE email = $1", [email]);
  if (!u) throw new Error(`No existe ${email}`);
  return u;
}

/* Contexto de API con la sesion de ese usuario. */
export async function api(email: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: `nl_sesion=${await selloSesion(email)}` } });
}

/* Sesion en un contexto de navegador. */
export async function entrar(ctx: BrowserContext, email: string) {
  await iniciarSesion(ctx, email);
}

export async function idSolicitud(titulo: string) {
  const [s] = await sql<{ id: number }>("SELECT id FROM task_requests WHERE title = $1 ORDER BY id DESC LIMIT 1", [titulo]);
  return s.id;
}
