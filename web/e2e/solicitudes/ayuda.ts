import { execSync } from "node:child_process";
import { Client } from "pg";
import { sealData } from "iron-session";
import { request, type APIRequestContext, type BrowserContext } from "@playwright/test";

/*
 * Utilidades de las pruebas de solicitudes. La sesion se sella con el mismo
 * secreto que la app (iron-session) en vez de pasar por el formulario: el
 * login esta limitado a 5 intentos por minuto y por IP y rota el token de
 * sesion, asi que entrar con varios usuarios por prueba lo haria fallar.
 */
export const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3102";
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_solicitudes";
const SECRETO = process.env.SESSION_SECRET ?? "dev-only-session-secret-change-me-32chars-min";

export function sembrar() {
  execSync("npx tsx e2e/solicitudes/sembrar.ts", { env: { ...process.env, DATABASE_URL }, stdio: "pipe" });
}

export async function consulta<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
}

export async function idDe(email: string) {
  const [u] = await consulta<{ id: number; session_token: string | null }>("SELECT id, session_token FROM users WHERE email = $1", [email]);
  if (!u) throw new Error(`No existe ${email}`);
  return u;
}

async function cookieDe(email: string) {
  const u = await idDe(email);
  return sealData({ userId: u.id, token: u.session_token ?? undefined }, { password: SECRETO });
}

/* Contexto de API con la sesion de ese usuario. */
export async function api(email: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: `nl_sesion=${await cookieDe(email)}` } });
}

/* Sesion en un contexto de navegador. */
export async function entrar(ctx: BrowserContext, email: string) {
  const url = new URL(BASE_URL);
  await ctx.addCookies([{ name: "nl_sesion", value: await cookieDe(email), domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
}

export async function idSolicitud(titulo: string) {
  const [s] = await consulta<{ id: number }>("SELECT id FROM task_requests WHERE title = $1 ORDER BY id DESC LIMIT 1", [titulo]);
  return s.id;
}
