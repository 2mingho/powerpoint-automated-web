import path from "node:path";
import fs from "node:fs";
import { Client } from "pg";
import { expect, type Page } from "@playwright/test";

export const WIDGETS = path.resolve(__dirname, "../../../tests/fixtures/meltwater_widgets");
export const CAPTURAS = path.resolve(__dirname, "../capturas/datos");

export function widgets(prefijos?: string[]) {
  return fs.readdirSync(WIDGETS)
    .filter((f) => f.endsWith(".xlsx") && (!prefijos || prefijos.some((p) => f.startsWith(p))))
    .sort()
    .map((f) => path.join(WIDGETS, f));
}

/* Usuarios propios de estas pruebas, con la contrasena de demo (demo1234). */
export const USUARIOS = {
  analista: "analista@local.test",
  colega: "colega.datos@local.test",
  sinReportes: "sin.reportes@local.test",
};

export async function prepararUsuarios() {
  const db = new Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_datos" });
  await db.connect();
  try {
    const { rows } = await db.query("select password, area_id from users where email = 'analista@local.test'");
    const { password, area_id } = rows[0];
    for (const [email, nombre, tools] of [
      [USUARIOS.colega, "Colega Datos", JSON.stringify(["reports", "classification", "file_merge", "csv_analysis"])],
      [USUARIOS.sinReportes, "Sin Reportes", JSON.stringify(["tasks", "classification"])],
    ]) {
      await db.query(
        `insert into users (username, email, password, role, is_active, allowed_tools, area_id, created_at, force_logout, is_area_lead)
         values ($1, $2, $3, 'DI', true, $4, $5, now(), false, false)
         on conflict (email) do update set allowed_tools = excluded.allowed_tools, is_active = true, password = excluded.password, session_token = null`,
        [nombre, email, password, tools, area_id],
      );
    }
  } finally {
    await db.end();
  }
}

export async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill("demo1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await page.waitForLoadState("load");
}

export async function tema(page: Page, t: "light" | "dark") {
  await page.evaluate((v) => { localStorage.setItem("nl-tema", v); document.documentElement.dataset.theme = v; }, t);
}
