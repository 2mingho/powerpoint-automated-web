import { expect, test } from "@playwright/test";
import { EMPLEADO, bd, contextoCon, DIRECTORA, idUnidad, MANAGER, MANAGER_FUERA } from "./ayuda";

/*
 * Alcance del panel de equipo (lo mas sensible). Organizacion sembrada:
 *   Laura (directora) -> Carlos (DI, Investigacion) y Sofia (Comunicacion)
 *   Andres (Estrategia Digital), fuera de la cadena de Laura.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000); // el servidor de desarrollo compila cada ruta la primera vez
});

type Panel = { unidades: { id: number; nombre: string }[]; carga: { nombre: string }[]; porUnidad: { nombre: string }[] };

async function filasCsv(texto: string) {
  return texto.replace("﻿", "").trim().split("\r\n").slice(1);
}

test("un manager no ve unidades fuera de su alcance: ni en la API, ni en el CSV, ni en la pagina", async ({ browser }) => {
  const { page } = await contextoCon(browser, MANAGER);
  const [DI, INV, COM, EST] = await Promise.all(["Data Intelligence", "Investigación", "Comunicación", "Estrategia Digital"].map(idUnidad));

  const panel = (await (await page.request.get("/api/equipo")).json()) as Panel;
  expect(panel.unidades.map((u) => u.nombre).sort()).toEqual(["Data Intelligence", "Investigación"]);
  const nombresFuera = ["Elena Castro", "Jorge Navarro", "Sofía Ramírez", "Paula Vidal", "Diego Romero", "Andrés Gil"];
  for (const n of nombresFuera) expect(panel.carga.map((c) => c.nombre)).not.toContain(n);

  // Tabla: solo tareas de sus unidades, y todas las de sus unidades.
  const t = await (await page.request.get("/api/equipo/tareas")).json();
  const esperadas = (await bd<{ n: string }>("select count(*) n from tasks where deleted_at is null and area_id = any($1)", [[DI, INV]]))[0].n;
  expect(String(t.total)).toBe(esperadas);
  for (const x of t.tareas) expect(["Data Intelligence", "Investigación"]).toContain(x.unidad);
  expect(t.opciones.personas.map((p: { nombre: string }) => p.nombre)).not.toContain("Elena Castro");

  // Pedir una unidad ajena: 403, nunca datos.
  for (const u of [COM, EST]) {
    for (const ruta of ["/api/equipo", "/api/equipo/tareas", "/api/equipo/csv"]) {
      const r = await page.request.get(`${ruta}?unidad=${u}`);
      expect(r.status(), `${ruta}?unidad=${u}`).toBe(403);
      expect(await r.text()).not.toMatch(/Elena|Jorge|Paula|Diego/);
    }
  }

  // CSV: tantas filas como tareas del alcance, sin responsables de fuera.
  const csv = await page.request.get("/api/equipo/csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const filas = await filasCsv(await csv.text());
  expect(String(filas.length)).toBe(esperadas);
  for (const n of nombresFuera) expect(filas.join("\n")).not.toContain(n);

  // Filtrar por una unidad propia acota.
  const soloInv = await (await page.request.get(`/api/equipo/tareas?unidad=${INV}`)).json();
  for (const x of soloInv.tareas) expect(x.unidad).toBe("Investigación");

  // Pagina con unidad ajena en la URL: aviso y nada de esa unidad.
  await page.goto(`/equipo?unidad=${COM}`);
  await expect(page.getByText("Esa unidad está fuera de tu alcance")).toBeVisible();
  const html = await page.content();
  for (const n of nombresFuera) expect(html).not.toContain(n);
  expect(html).not.toContain(">Comunicación<");
});

test("una directora hereda el alcance de sus managers y nada mas", async ({ browser }) => {
  const { page } = await contextoCon(browser, DIRECTORA);
  const [COM, EST] = await Promise.all(["Comunicación", "Estrategia Digital"].map(idUnidad));
  const panel = (await (await page.request.get("/api/equipo")).json()) as Panel;
  expect(panel.unidades.map((u) => u.nombre).sort()).toEqual(["Comunicación", "Data Intelligence", "Investigación"]);

  const com = await page.request.get(`/api/equipo/tareas?unidad=${COM}`);
  expect(com.status()).toBe(200);
  for (const x of (await com.json()).tareas) expect(x.unidad).toBe("Comunicación");

  expect((await page.request.get(`/api/equipo?unidad=${EST}`)).status()).toBe(403);
  expect((await page.request.get(`/api/equipo/csv?unidad=${EST}`)).status()).toBe(403);

  // Lo ve tambien la pagina: sus tres unidades en el selector y en "vencidas por unidad".
  await page.goto("/equipo");
  await expect(page.getByRole("heading", { name: "Equipo" })).toBeVisible();
  const opciones = await page.getByRole("combobox", { name: "Unidad" }).locator("option").allTextContents();
  expect(opciones).toEqual(expect.arrayContaining(["Comunicación", "Data Intelligence", "Investigación"]));
  expect(opciones).not.toContain("Estrategia Digital");
});

test("al quitarle el liderazgo al manager, la directora deja de ver esa unidad", async ({ browser }) => {
  const { page } = await contextoCon(browser, DIRECTORA);
  const COM = await idUnidad("Comunicación");
  const sofia = (await bd<{ id: number }>("select id from users where email = 'sofia@equipo.test'"))[0].id;
  await bd("delete from unit_leads where user_id = $1 and area_id = $2", [sofia, COM]);
  try {
    expect((await page.request.get(`/api/equipo?unidad=${COM}`)).status()).toBe(403);
  } finally {
    await bd("insert into unit_leads (user_id, area_id) values ($1, $2) on conflict do nothing", [sofia, COM]);
  }
  expect((await page.request.get(`/api/equipo?unidad=${COM}`)).status()).toBe(200);
});

test("quien no supervisa nada no entra al panel", async ({ browser }) => {
  const { page } = await contextoCon(browser, EMPLEADO);
  expect((await page.request.get("/api/equipo")).status()).toBe(403);
  expect((await page.request.get("/api/equipo/csv")).status()).toBe(403);
  await page.goto("/equipo");
  await expect(page.getByRole("heading", { name: "Sin permisos" })).toBeVisible();
});

test("un manager fuera de la cadena solo ve lo suyo", async ({ browser }) => {
  const { page } = await contextoCon(browser, MANAGER_FUERA);
  const panel = (await (await page.request.get("/api/equipo")).json()) as Panel;
  expect(panel.unidades.map((u) => u.nombre)).toEqual(["Estrategia Digital"]);
});

test("los contadores filtran la tabla y los graficos no se rompen", async ({ browser }) => {
  const { page } = await contextoCon(browser, MANAGER);
  await page.goto("/equipo");
  const vencidas = page.getByRole("button", { name: /Vencidas/ });
  await vencidas.click();
  await expect(vencidas).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/vista=vencidas/);
  const fechas = await page.locator("tbody time").allTextContents();
  expect(fechas.length).toBeGreaterThan(0);
  await expect(page.getByRole("img", { name: /Tareas creadas y completadas por semana, 8 semanas/ })).toBeVisible();
  await page.getByText("Ver como tabla").click();
  await expect(page.locator("details table tbody tr")).toHaveCount(8);
});
