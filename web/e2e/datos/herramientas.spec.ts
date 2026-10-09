import { expect, test } from "@playwright/test";
import { entrar, prepararUsuarios, USUARIOS } from "./ayuda";

/* Clasificacion, union y analisis: archivo → opciones → proceso → resultado descargable. */
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { await prepararUsuarios(); });
test.beforeEach(async ({}, info) => { test.skip(info.project.name !== "escritorio", "flujos en escritorio"); test.setTimeout(120_000); });

const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
const MENCIONES = utf16(
  "Hit Sentence\tSource\tKeywords\n" +
  "\"Suben los precios\nen el mercado\"\tTwitter\tinflacion\n" +
  "Nuevo hospital en la ciudad\tFacebook\tsalud\n" +
  "Partido de futbol\tInstagram\tdeporte\n",
);

test("clasificar: reglas, preset, proceso y descarga", async ({ page }) => {
  await entrar(page, USUARIOS.herramientas);
  await page.goto("/clasificacion");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles({ name: "menciones.csv", mimeType: "text/csv", buffer: MENCIONES });
  await expect(page.getByText(/UTF-16 · tabulador · 3 columnas/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Vista previa del archivo" })).toContainText("Nuevo hospital");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Categoría 1").fill("Economía");
  await page.getByLabel("Temática").first().fill("Precios");
  await page.getByLabel("Palabras clave, separadas por comas").first().fill("precios, inflación");

  // Preset: se guarda y aparece en la lista.
  const preset = `Reglas e2e ${Date.now()}`;
  await page.getByRole("button", { name: "Guardar como…" }).click();
  await page.getByRole("dialog").getByLabel("Nombre").fill(preset);
  await page.getByRole("dialog").getByRole("button", { name: "Guardar preset" }).click();
  await expect(page.getByLabel("Preset", { exact: true })).toHaveValue(/\d+/);
  await expect(page.getByLabel("Preset", { exact: true }).locator("option", { hasText: preset })).toHaveCount(1);

  await page.getByRole("button", { name: "Clasificar" }).click();
  await expect(page.getByText("Clasificar menciones")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible({ timeout: 60_000 });
  // El texto con salto de linea es una sola fila: 3, no 4.
  await expect(page.getByRole("definition").filter({ hasText: /^3$/ }).first()).toBeVisible();
  const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar clasificado" }).click()]);
  expect(descarga.suggestedFilename()).toBe("Clasificado_menciones.csv");
});

test("unir: dos archivos apilados", async ({ page }) => {
  await entrar(page, USUARIOS.herramientas);
  await page.goto("/union");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "enero.csv", mimeType: "text/csv", buffer: Buffer.from("Nombre,Edad\nAna,30\nBeto,40\n") },
    { name: "febrero.csv", mimeType: "text/csv", buffer: Buffer.from("Nombre;Edad;Ciudad\nCarla;22;Santiago\n") },
  ]);
  await expect(page.getByText(/coma · 2 columnas/)).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(/no están en todos los archivos/)).toBeVisible();
  await page.getByRole("button", { name: "Unir archivos" }).click();
  await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Descargar unión" })).toBeVisible();
  await expect(page.getByLabel("Filas por archivo")).toContainText("febrero.csv");
});

test("analizar: CSV en UTF-16 sin elegir nada", async ({ page }) => {
  await entrar(page, USUARIOS.herramientas);
  await page.goto("/analisis");
  await page.locator('input[type="file"]').setInputFiles({
    name: "datos.csv", mimeType: "text/csv",
    buffer: utf16("Fuente\tAlcance\tLikes\nTwitter\t10\t1\nFacebook\t20\t3\nTwitter\t30\t2\nInstagram\t25\t5\n"),
  });
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Analizar" }).click();
  await expect(page.getByText("Valores más frecuentes")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Correlación entre columnas numéricas")).toBeVisible();
  await expect(page.getByLabel("Valores más frecuentes de Fuente")).toContainText("Twitter");
});

test("permiso por herramienta: sin unión de archivos es 403", async ({ page }) => {
  await entrar(page, USUARIOS.sinReportes);
  const r = await page.request.post("/api/datos/union", {
    multipart: { archivos: { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") } },
  });
  expect(r.status()).toBe(403);
  // La que si tiene (clasificacion) responde.
  const ok = await page.request.get("/api/datos/clasificacion/presets");
  expect(ok.status()).toBe(200);
  await page.goto("/union");
  await expect(page.getByText("Sin acceso a esta herramienta")).toBeVisible();
});

test("los presets son de su dueño", async ({ page }) => {
  await entrar(page, USUARIOS.herramientas);
  const creado = await page.request.post("/api/datos/clasificacion/presets", { data: { nombre: "Privado", reglas: [] } });
  expect(creado.status()).toBe(201);
  const { id } = await creado.json();
  await page.context().clearCookies();
  await entrar(page, USUARIOS.sinReportes);
  expect((await page.request.get(`/api/datos/clasificacion/presets/${id}`)).status()).toBe(404);
  expect((await page.request.delete(`/api/datos/clasificacion/presets/${id}`)).status()).toBe(404);
});
