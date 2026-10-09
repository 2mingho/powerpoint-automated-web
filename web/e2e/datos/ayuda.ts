import path from "node:path";
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { iniciarSesion } from "../comun";

export const WIDGETS = path.resolve(__dirname, "../../../tests/fixtures/meltwater_widgets");
export const CAPTURAS = path.resolve(__dirname, "../capturas/datos");

export function widgets(prefijos?: string[]) {
  return fs.readdirSync(WIDGETS)
    .filter((f) => f.endsWith(".xlsx") && (!prefijos || prefijos.some((p) => f.startsWith(p))))
    .sort()
    .map((f) => path.join(WIDGETS, f));
}

/* Usuarios propios de estas pruebas (sembrados en e2e/semilla.ts con herramientas recortadas). */
export const USUARIOS = {
  analista: "analista@local.test",
  colega: "colega.datos@local.test",
  sinReportes: "sin.reportes@local.test",
  // Cada spec corre en su worker y un login rota el session_token: usuario propio.
  herramientas: "herramientas.datos@local.test",
  capturas: "capturas.datos@local.test",
  capturasMovil: "capturas.movil@local.test",
};

/* La sesion se sella (comun.ts): el login rota el token y admite 5 intentos por minuto. */
export async function entrar(page: Page, email: string) {
  await iniciarSesion(page.context(), email);
}

export async function tema(page: Page, t: "light" | "dark") {
  await page.evaluate((v) => { localStorage.setItem("nl-tema", v); document.documentElement.dataset.theme = v; }, t);
}
