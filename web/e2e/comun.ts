/*
 * Lo que comparten todas las baterias e2e: un solo servidor (BASE_URL), una
 * sola base (DATABASE_URL de .env, sembrada por e2e/semilla.ts en el
 * globalSetup) y sesiones selladas con el mismo secreto que la app.
 *
 * Las sesiones no pasan por el formulario: el login admite 5 intentos por
 * minuto por cuenta y rota el token, y una pasada completa lo agotaria.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { sealData } from "iron-session";
import type { BrowserContext } from "@playwright/test";

// Las columnas de fecha y hora guardan UTC sin zona: pg serializa con la hora local del proceso.
process.env.TZ = "UTC";

export const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3301";
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_integracion";
const SECRETO = process.env.SESSION_SECRET ?? "dev-only-session-secret-change-me-32chars-min";

/*
 * Las pruebas y la semilla escriben en la base: solo corren contra una
 * descartable (newlink_<algo>). web/.env apunta a la de desarrollo (`newlink`) y
 * Playwright lo carga, asi que olvidar DATABASE_URL en la linea de comandos
 * borraria o ensuciaria esa base. SEMILLA_EN_CUALQUIER_BASE=1 levanta la guarda
 * a proposito.
 */
export function exigirBaseDescartable(url = DATABASE_URL) {
  if (process.env.SEMILLA_EN_CUALQUIER_BASE === "1") return;
  const nombre = decodeURIComponent(new URL(url || "postgresql://x@h/").pathname.slice(1));
  if (!/^newlink_\w+$/.test(nombre)) {
    throw new Error(`Las pruebas escriben en la base «${nombre || "(sin nombre)"}» y solo corren contra una descartable (newlink_<algo>). Pasa DATABASE_URL por la linea de comandos.`);
  }
}

let pool: Pool | null = null;
export async function sql<T = Record<string, unknown>>(texto: string, p: unknown[] = []): Promise<T[]> {
  if (!pool) exigirBaseDescartable();
  pool ??= new Pool({ connectionString: DATABASE_URL, max: 3 });
  return (await pool.query(texto, p)).rows as T[];
}

/* Cierra el pool de sql(): los scripts sueltos (capturas) no terminan mientras siga abierto. */
export async function cerrarBase() {
  await pool?.end();
  pool = null;
}

export async function idDeCorreo(email: string): Promise<number> {
  const [u] = await sql<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]);
  if (!u) throw new Error(`No existe ${email}: ¿se sembró la base (npx tsx e2e/semilla.ts)?`);
  return u.id;
}

/*
 * Valor de la cookie nl_sesion. Por defecto reutiliza el token vigente (otras
 * sesiones del mismo usuario siguen vivas); con rotar, hace lo que un login.
 */
export async function selloSesion(usuario: number | string, { rotar = false } = {}): Promise<string> {
  const id = typeof usuario === "number" ? usuario : await idDeCorreo(usuario);
  let [{ session_token: token }] = await sql<{ session_token: string | null }>("SELECT session_token FROM users WHERE id = $1", [id]);
  if (rotar || !token) {
    token = randomBytes(24).toString("hex");
    await sql("UPDATE users SET session_token = $1, force_logout = false WHERE id = $2", [token, id]);
  }
  return sealData({ userId: id, token }, { password: SECRETO });
}

export async function iniciarSesion(ctx: BrowserContext, usuario: number | string, opciones?: { rotar?: boolean }) {
  await ctx.addCookies([{ name: "nl_sesion", value: await selloSesion(usuario, opciones), url: BASE_URL, httpOnly: true, sameSite: "Lax" }]);
}
