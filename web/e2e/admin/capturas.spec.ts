import { test, type Page } from "@playwright/test";
import { ADMIN, contextoCon, MANAGER } from "./ayuda";

/*
 * Capturas de revision a 1440 y 390 px, en claro y oscuro, en
 * e2e/capturas/admin/. Solo corre con CAPTURAS=1 y en el proyecto de
 * escritorio (el ancho lo fija cada captura).
 */
test.skip(!process.env.CAPTURAS, "solo con CAPTURAS=1");
test.beforeEach(() => test.skip(test.info().project.name !== "escritorio", "una pasada basta"));
test.setTimeout(240_000);

const RUTAS_ADMIN = ["/admin", "/admin/personas", "/admin/organizacion", "/admin/catalogo", "/admin/plantillas", "/admin/ia", "/admin/actividad", "/equipo"];
const SOLO = process.env.SOLO?.split(",");

async function capturar(page: Page, ruta: string, quien: string) {
  for (const tema of ["light", "dark"] as const) {
    for (const ancho of [1440, 390]) {
      await page.setViewportSize({ width: ancho, height: ancho > 800 ? 900 : 844 });
      await page.goto(ruta);
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(900);
      const nombre = `${quien}${ruta.replace(/\//g, "_") || "_inicio"}-${ancho}-${tema === "light" ? "claro" : "oscuro"}.png`;
      await page.screenshot({ path: `e2e/capturas/admin/${nombre}`, fullPage: true });
    }
  }
}

test("capturas de administracion", async ({ browser }) => {
  const { page } = await contextoCon(browser, ADMIN);
  for (const r of RUTAS_ADMIN.filter((x) => !SOLO || SOLO.includes(x))) await capturar(page, r, "admin");
});

test("capturas del panel de un manager", async ({ browser }) => {
  if (SOLO && !SOLO.includes("/equipo")) return;
  const { page } = await contextoCon(browser, MANAGER);
  await capturar(page, "/equipo", "manager");
});
