/*
 * Apoyo de las pruebas de seguridad. Reutiliza los escenarios aislados y las
 * sesiones selladas de las pruebas de tareas (no tocan las semillas de otros
 * modulos) y añade un login por formulario con IP propia, para no agotar el
 * limite de 5 intentos por minuto.
 *
 *   BASE_URL=http://127.0.0.1:3201 \
 *   DATABASE_URL=postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_seguridad \
 *   npx playwright test e2e/seguridad --workers=1
 */
import { expect, type Browser, type Page } from "@playwright/test";
import { BASE_URL, selloSesion } from "../comun";
import { escenario } from "../tareas/apoyo";
export { BASE, entrarComo, escenario, sql, HOY, sumarDias } from "../tareas/apoyo";

/* Cookie de sesion valida para ese usuario (rota su session_token como un login). */
export async function cookieDe(userId: number) {
  return { name: "nl_sesion", value: await selloSesion(userId, { rotar: true }), url: BASE_URL };
}

let n = 0;
export function ipNueva() {
  n++;
  return `10.77.${process.pid & 255}.${(Date.now() + n) % 250}`;
}

export async function contextoAnonimo(browser: Browser) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ipNueva() } });
  return { ctx, page: await ctx.newPage() };
}

export async function rellenarLogin(page: Page, email: string, clave = "demo1234") {
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/* Una cuenta nueva por prueba: el limite de login tambien cuenta por cuenta (5 por minuto). */
export async function cuentaNueva(prefijo: string) {
  const e = await escenario(prefijo);
  return { ...e, email: `empleado.${e.sufijo}@e2e.test` };
}

export function soloEscritorio(info: { project: { name: string } }) {
  return info.project.name !== "escritorio";
}

export { expect };
