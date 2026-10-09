import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";

/*
 * Ayudas de las pruebas de Administracion y Equipo. Cada sesion entra con su
 * propia IP (x-forwarded-for): el limite de inicio de sesion es de 5 por
 * minuto y por IP, y una bateria de pruebas lo agota.
 */
export const CLAVE = "demo1234";
export const ADMIN = "demo@local.test";
export const ADMIN_2 = "admin2@equipo.test"; // para pruebas que corren a la vez que las de ADMIN
export const EMPLEADO = "luis@equipo.test";
export const ANALISTA = "analista@local.test";
export const DIRECTORA = "laura@equipo.test";
export const MANAGER = "carlos@equipo.test"; // lidera Data Intelligence e Investigacion
export const MANAGER_COM = "sofia@equipo.test";
export const MANAGER_FUERA = "andres@equipo.test"; // Estrategia Digital, fuera de la cadena de Laura

const URL_BD = process.env.DATABASE_URL ?? "postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_admin";

export async function bd<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL_BD });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

let n = 0;
function ipNueva() {
  n++;
  return `10.${(process.pid >> 8) & 255}.${process.pid & 255}.${(Date.now() + n) % 250}`;
}

export async function contextoCon(browser: Browser, email: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ipNueva() } });
  const page = await ctx.newPage();
  await entrar(page, email);
  return { ctx, page };
}

export async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

export async function idDe(email: string): Promise<number> {
  return (await bd<{ id: number }>("select id from users where email = $1", [email]))[0].id;
}
export async function idUnidad(nombre: string): Promise<number> {
  return (await bd<{ id: number }>("select id from areas where name = $1", [nombre]))[0].id;
}
