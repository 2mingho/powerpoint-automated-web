import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CAPTURAS, entrar, prepararUsuarios, USUARIOS, widgets } from "./ayuda";

/*
 * Capturas de revision: 1440 px (escritorio) y 390 px (movil), en claro y en
 * oscuro, incluido un proceso a medias. Se guardan en e2e/capturas/datos/.
 * Solo corre con CAPTURAS=1 para no alargar la pasada normal de pruebas.
 */
test.describe.configure({ mode: "serial" });
test.skip(!process.env.CAPTURAS, "solo con CAPTURAS=1");
test.beforeAll(async () => { await prepararUsuarios(); });

const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
const TEMAS = ["light", "dark"] as const;

async function preparar(page: Page, ancho: string) {
  if (ancho === "390") await page.setViewportSize({ width: 390, height: 844 });
}

async function foto(page: Page, nombre: string, ancho: string, tema: string, completa = true) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(CAPTURAS, `${nombre}-${ancho}-${tema === "light" ? "claro" : "oscuro"}.png`), fullPage: completa });
}

async function conTema(page: Page, tema: string) {
  await page.evaluate((t) => { localStorage.setItem("nl-tema", t); document.documentElement.dataset.theme = t; }, tema);
}

test("capturas del módulo Datos", async ({ page }, info) => {
  test.setTimeout(600_000);
  const ancho = info.project.name === "movil" ? "390" : "1440";
  const usuario = info.project.name === "movil" ? USUARIOS.capturasMovil : USUARIOS.capturas;
  await preparar(page, ancho);
  await entrar(page, usuario);

  // Un reporte real para las vistas de reporte y lista.
  await page.goto("/reportes/nuevo");
  await page.locator('input[type="file"]').setInputFiles(widgets());
  await expect(page.getByText("10 de 10 widgets reconocidos")).toBeVisible({ timeout: 30_000 });
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "01-reporte-archivos", ancho, t); }
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Nombre del reporte").fill("Ministerio de Turismo");
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "02-reporte-opciones", ancho, t); }

  // Proceso a medias: el sondeo se congela en una fase intermedia real.
  await page.route("**/api/datos/trabajos/*", (ruta) => ruta.fulfill({
    json: { id: "x", tipo: "reporte", estado: "en_curso", fase: "calculo", progreso: 62, mensaje: "Sumando menciones, alcance y reparto por red", error: null, detalle: [], resultado: null },
  }));
  await page.getByRole("button", { name: "Generar reporte" }).click();
  await expect(page.getByText("62%")).toBeVisible({ timeout: 30_000 });
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "03-reporte-proceso-a-medias", ancho, t); }
  await page.unroute("**/api/datos/trabajos/*");
  await page.waitForURL(/\/reportes\/[\w-]{10,}$/, { timeout: 90_000 });
  await expect(page.getByText("Menciones por día")).toBeVisible();
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "04-reporte-vista", ancho, t); }
  await page.emulateMedia({ media: "print" });
  await foto(page, "05-reporte-impresion", ancho, "light");
  await page.emulateMedia({ media: "screen" });

  await page.goto("/reportes");
  await expect(page.getByText("Ministerio de Turismo").first()).toBeVisible();
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "06-mis-reportes", ancho, t); }

  // Clasificacion: reglas y resultado.
  await page.goto("/clasificacion");
  await page.locator('input[type="file"]').setInputFiles({
    name: "menciones.csv", mimeType: "text/csv",
    buffer: utf16("Hit Sentence\tSource\tKeywords\nSuben los precios del pan\tTwitter\tinflacion\nNuevo hospital en Santiago\tFacebook\tsalud\nEl turismo crece en Punta Cana\tInstagram\tturismo\nClinica nueva en la capital\tTwitter\tsalud\nPartido de beisbol\tX\tdeporte\n"),
  });
  await expect(page.getByText(/UTF-16 · tabulador/)).toBeVisible();
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "07-clasificacion-archivo", ancho, t); }
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("textbox", { name: "Categoría 1" }).fill("Economía");
  await page.getByLabel("Temática").first().fill("Precios");
  await page.getByLabel("Palabras clave, separadas por comas").first().fill("precios, inflación");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await page.getByRole("textbox", { name: "Categoría 2" }).fill("Salud");
  await page.getByLabel("Temática").nth(1).fill("Hospitales");
  await page.getByLabel("Palabras clave, separadas por comas").nth(1).fill("hospital, clinica");
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "08-clasificacion-reglas", ancho, t); }
  await page.getByRole("button", { name: "Clasificar" }).click();
  await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible({ timeout: 60_000 });
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "09-clasificacion-resultado", ancho, t); }

  // Union: columnas.
  await page.goto("/union");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "enero.csv", mimeType: "text/csv", buffer: Buffer.from("Fecha,Fuente,Texto,Alcance\n2026-01-02,Twitter,hola,10\n") },
    { name: "febrero.csv", mimeType: "text/csv", buffer: Buffer.from("Fecha,Fuente,Texto\n2026-02-02,Facebook,adios\n") },
  ]);
  await expect(page.getByText(/coma · 4 columnas/)).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "10-union-columnas", ancho, t); }

  // Analisis: resultado.
  const filas = ["Fuente\tAlcance\tLikes\tComentarios"];
  const redes = ["Twitter", "Facebook", "Instagram", "TikTok", "YouTube"];
  for (let i = 0; i < 400; i++) filas.push(`${redes[(i * 7) % 5]}\t${(i * 37) % 900 + 50}\t${(i * 13) % 120}\t${i % 9 === 0 ? "" : (i * 5) % 40}`);
  await page.goto("/analisis");
  await page.locator('input[type="file"]').setInputFiles({ name: "metricas.csv", mimeType: "text/csv", buffer: utf16(filas.join("\n") + "\n") });
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Analizar" }).click();
  await expect(page.getByText("Correlación entre columnas numéricas")).toBeVisible({ timeout: 60_000 });
  for (const t of TEMAS) { await conTema(page, t); await foto(page, "11-analisis-resultado", ancho, t); }
});
