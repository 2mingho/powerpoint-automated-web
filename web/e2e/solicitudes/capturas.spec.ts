import { test, type Page } from "@playwright/test";
import { entrar, sembrar } from "./ayuda";

/*
 * Capturas de revision (no comprueban nada): 1440 y 390 px, claro y oscuro.
 * Salen en e2e/capturas/solicitudes/. Ejecutar con --project=escritorio.
 */
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio" || !process.env.CAPTURAS, "Solo con CAPTURAS=1"); });
test.beforeAll(async () => { if (process.env.CAPTURAS) await sembrar(); });

const DIR = "e2e/capturas/solicitudes";
const ANCHOS = [{ n: "1440", w: 1440, h: 900 }, { n: "390", w: 390, h: 844 }];
const TEMAS = ["claro", "oscuro"] as const;

async function preparar(page: Page, tema: (typeof TEMAS)[number], w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript((t) => { try { localStorage.setItem("nl-tema", t); } catch { /* */ } }, tema === "oscuro" ? "dark" : "light");
}
const quieto = (page: Page) => page.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}" });

for (const a of ANCHOS) for (const tema of TEMAS) {
  test(`pantallas ${a.n} ${tema}`, async ({ page, context }) => {
    await entrar(context, "carlos@equipo.test");
    await preparar(page, tema, a.w, a.h);
    await page.goto("/solicitudes");
    await page.getByRole("heading", { name: "Solicitudes" }).waitFor();
    await page.waitForLoadState("networkidle");
    await quieto(page);
    await page.screenshot({ path: `${DIR}/recibidas-${a.n}-${tema}.png`, fullPage: a.w > 500 });
    if (a.w < 500) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Informe de menciones/ }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${DIR}/detalle-hoja-${a.n}-${tema}.png` });
      await page.keyboard.press("Escape");
    } else {
      await page.getByRole("button", { name: "Aceptar", exact: true }).first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${DIR}/aceptar-${a.n}-${tema}.png` });
    }

    await page.goto("/solicitudes?bandeja=historial");
    await page.waitForLoadState("networkidle");
    await quieto(page);
    await page.screenshot({ path: `${DIR}/historial-${a.n}-${tema}.png`, fullPage: a.w > 500 });

    await page.getByRole("button", { name: /Notificaciones/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/campana-${a.n}-${tema}.png` });
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+k");
    await page.keyboard.type("sol");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/paleta-${a.n}-${tema}.png` });
    await page.keyboard.press("Escape");

    await page.goto("/solicitudes?solicitar=1");
    await page.getByRole("heading", { name: "Solicitar a otra unidad" }).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/nueva-${a.n}-${tema}.png` });
  });

  test(`tour ${a.n} ${tema}`, async ({ page, context }) => {
    await entrar(context, "nuevo@local.test");
    await preparar(page, tema, a.w, a.h);
    await page.request.post("/api/tour/reiniciar");
    await page.goto("/");
    await page.getByRole("dialog", { name: /Bienvenido/ }).waitFor();
    await page.screenshot({ path: `${DIR}/tour-oferta-${a.n}-${tema}.png` });
    await page.getByRole("button", { name: "Empezar" }).click();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/tour-paso-${a.n}-${tema}.png` });
  });
}
