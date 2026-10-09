import { expect, test } from "@playwright/test";
import { entrar, prepararUsuarios, USUARIOS, widgets } from "./ayuda";

/*
 * Reportes: subir → progreso → reporte, y quien puede hacer que.
 * Mismos permisos que Flask: el enlace se comparte para LEER; editar y pedir
 * textos a la IA es del dueno; sin la herramienta "reports" no se entra.
 */
test.describe.configure({ mode: "serial" });

let token = "";
const nombre = `Cliente E2E ${Date.now()}`;

test.beforeAll(async () => { await prepararUsuarios(); });

test("subir los widgets, ver el progreso y abrir el reporte", async ({ page }, info) => {
  test.skip(info.project.name !== "escritorio", "el flujo completo se prueba en escritorio");
  test.setTimeout(120_000);
  await entrar(page, USUARIOS.analista);
  await page.goto("/reportes/nuevo");
  await expect(page.getByRole("heading", { name: "Generar reporte" })).toBeVisible();

  // Validacion inmediata: un tipo que no vale no llega a subirse.
  await page.locator('input[type="file"]').setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await expect(page.getByText(/notas.txt» no es un tipo admitido/)).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(widgets(["00", "01", "04", "05", "07"]));
  await expect(page.getByText("5 de 10 widgets reconocidos")).toBeVisible();
  await expect(page.getByText("Sentimiento", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByLabel("Nombre del reporte").fill(nombre);
  await page.getByLabel("Autores únicos").fill("doce");
  await expect(page.getByText("Escribe solo el número")).toBeVisible();
  await page.getByLabel("Autores únicos").fill("12,480");
  await page.getByRole("button", { name: "Generar reporte" }).click();

  // El panel de salida enseña las fases reales del servicio.
  await expect(page.getByText("Leer los widgets")).toBeVisible();
  await expect(page.getByText("Guardar el reporte")).toBeVisible();

  await page.waitForURL(/\/reportes\/[\w-]{10,}$/, { timeout: 90_000 });
  token = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(nombre);
  await expect(page.getByText("Menciones por día")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "12,480" })).toBeVisible();
});

test("el dueño retoca un texto y se queda guardado", async ({ page }, info) => {
  test.skip(info.project.name !== "escritorio" || !token);
  await entrar(page, USUARIOS.analista);
  await page.goto(`/reportes/${token}`);
  const titular = page.locator('[data-slot="volume_title"]');
  await titular.click();
  await titular.fill("Titular escrito a mano");
  await titular.blur();
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-slot="volume_title"]')).toHaveText("Titular escrito a mano");
});

test("aparece en mis reportes y la búsqueda lo encuentra", async ({ page }, info) => {
  test.skip(info.project.name !== "escritorio" || !token);
  await entrar(page, USUARIOS.analista);
  await page.goto("/reportes");
  await expect(page.getByRole("link", { name: new RegExp(nombre) })).toBeVisible();
  await page.getByLabel("Buscar reportes").fill("no-existe-zzz");
  await expect(page.getByText("Sin coincidencias")).toBeVisible();
  await page.getByLabel("Buscar reportes").fill(nombre.slice(0, 12));
  await expect(page.getByRole("link", { name: new RegExp(nombre) })).toBeVisible();
});

test("un colega con el enlace lo lee pero no lo edita ni lo ve en su lista", async ({ page }, info) => {
  test.skip(info.project.name !== "escritorio" || !token);
  await entrar(page, USUARIOS.colega);
  await page.goto(`/reportes/${token}`);
  await expect(page.getByText("Solo lectura")).toBeVisible();
  await expect(page.locator('[data-slot="volume_title"]')).toHaveAttribute("contenteditable", "false");

  const textos = await page.request.post(`/api/datos/reportes/${token}/textos`, { data: { textos: { volume_title: "Intruso" } } });
  expect(textos.status()).toBe(403);
  const ia = await page.request.post(`/api/datos/reportes/${token}/insights`);
  expect(ia.status()).toBe(403);

  const lista = await page.request.get("/api/datos/reportes");
  expect(lista.status()).toBe(200);
  const { reportes } = await lista.json();
  expect(reportes.map((r: { token: string }) => r.token)).not.toContain(token);
});

test("sin la herramienta de reportes: 403 en la API y pantalla sin acceso", async ({ page }) => {
  await entrar(page, USUARIOS.sinReportes);
  for (const [metodo, ruta] of [["get", "/api/datos/reportes"], ["post", "/api/datos/reportes"], ["get", `/api/datos/reportes/${token || "x"}`]] as const) {
    const r = await page.request[metodo](ruta);
    expect(r.status(), `${metodo} ${ruta}`).toBe(403);
    expect((await r.json()).error).toBeTruthy();
  }
  await page.goto("/reportes/nuevo");
  await expect(page.getByText("Sin acceso a esta herramienta")).toBeVisible();
  // La navegacion no ofrece lo que no se puede abrir.
  await expect(page.getByRole("link", { name: "Generar reporte" })).toHaveCount(0);
});

test("sin sesión la API responde 401 en JSON", async ({ request }) => {
  const r = await request.get("/api/datos/reportes");
  expect(r.status()).toBe(401);
  expect((await r.json()).error).toBe("Sesión requerida.");
});

test("los trabajos y descargas de otro no existen para ti", async ({ page }, info) => {
  test.skip(info.project.name !== "escritorio");
  await entrar(page, USUARIOS.analista);
  const subida = await page.request.post("/api/datos/analisis", {
    multipart: { archivo: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n3,4\n") } },
  });
  expect(subida.status()).toBe(202);
  const { trabajo } = await subida.json();
  await expect.poll(async () => (await (await page.request.get(`/api/datos/trabajos/${trabajo}`)).json()).estado).toBe("hecho");

  await page.context().clearCookies();
  await entrar(page, USUARIOS.colega);
  expect((await page.request.get(`/api/datos/trabajos/${trabajo}`)).status()).toBe(404);
  expect((await page.request.get(`/api/datos/descargas/csv_summary/${trabajo}`)).status()).toBe(404);
});
