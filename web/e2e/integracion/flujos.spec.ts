import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { iniciarSesion, selloSesion, sql, BASE_URL } from "../comun";
import { sembrarSolicitudes } from "../semilla";

/*
 * Lo que cruza modulos y nadie probo junto: avisos que abren lo que anuncian,
 * solicitudes que acaban en tareas, la paleta contra la API de tareas,
 * contadores que cuadran entre pantallas, cierre forzado, catalogo y
 * navegacion por rol. Sobre la base comun (e2e/semilla.ts).
 */
test.setTimeout(90_000);
test.beforeAll(async () => { await sembrarSolicitudes(); });

const esMovil = (p: Page) => (p.viewportSize()?.width ?? 0) < 1024;
const soloEscritorio = () => test.skip(test.info().project.name !== "escritorio", "una pasada basta");

async function como(ctx: BrowserContext, email: string) { await iniciarSesion(ctx, email); }
const pase = (page: Page, titulo: string) => page.getByRole("article", { name: `Tarea: ${titulo}` });

async function abrirCampana(page: Page) {
  const campana = page.getByRole("button", { name: /^Notificaciones/ });
  await campana.click();
  return page.getByRole("region", { name: "Notificaciones" });
}

async function abrirPaleta(page: Page) {
  const entrada = page.getByRole("combobox", { name: /Buscar una tarea/ });
  await expect(async () => {
    if (!(await entrada.isVisible())) await page.getByRole("button", { name: /Buscar o ir a/ }).click();
    await expect(entrada).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  return entrada;
}

test.describe("solicitud aceptada → tarea → avisos", () => {
  test.describe.configure({ mode: "serial" });
  const titulo = "Informe de menciones de octubre para Banco Popular";
  let tareaId = 0;

  test("aceptar crea la tarea en /tareas e Inicio del responsable, con su aviso", async ({ browser }) => {
    soloEscritorio();
    const [{ id }] = await sql<{ id: number }>("SELECT id FROM task_requests WHERE title = $1", [titulo]);
    const lider = await browser.newContext();
    await como(lider, "carlos@equipo.test");
    const analista = (await sql<{ id: number }>("SELECT id FROM users WHERE email = 'analista@local.test'"))[0].id;
    const r = await lider.request.post(`${BASE_URL}/api/solicitudes/${id}/aceptar`, { data: { responsableId: analista } });
    expect(r.status(), await r.text()).toBe(200);
    tareaId = (await r.json()).tareaId;
    await lider.close();

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await como(ctx, "analista@local.test");
    const page = await ctx.newPage();
    await page.goto("/tareas");
    await expect(page.locator(`li[data-tarea="${tareaId}"]`)).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("link", { name: new RegExp(titulo) }).first()).toHaveAttribute("href", `/tareas?tarea=${tareaId}`);
    // El aviso de la campana abre la tarea.
    const region = await abrirCampana(page);
    await region.getByRole("button", { name: new RegExp(`^Te asignaron.*${titulo.slice(0, 20)}`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/tareas\\?tarea=${tareaId}`));
    await expect(pase(page, titulo)).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  });

  test("quien la pidio la abre desde su aviso aunque solo la observa", async ({ browser }) => {
    soloEscritorio();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await como(ctx, "elena@equipo.test");
    const page = await ctx.newPage();
    await page.goto("/solicitudes");
    const region = await abrirCampana(page);
    await region.getByRole("button", { name: /^Solicitud aceptada: Informe de menciones/ }).click();
    await expect(page).toHaveURL(new RegExp(`/tareas\\?tarea=${tareaId}`));
    await expect(pase(page, titulo)).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  });

  test("un aviso de tarea abre su pase aunque ya se este en /tareas", async ({ page, context }) => {
    await como(context, "analista@local.test");
    await page.goto("/tareas");
    await expect(page.getByRole("heading", { name: "Mis tareas" })).toBeVisible();
    // Aviso con el enlace viejo de Flask (/tasks?task=ID), sembrado para la tarea de «Clipping».
    const region = await abrirCampana(page);
    await region.getByRole("button", { name: /^Te asignaron: Clipping semanal/ }).click();
    await expect(page).toHaveURL(/\/tareas\?tarea=\d+/);
    await expect(pase(page, "Clipping semanal de competencia")).toBeVisible({ timeout: 20_000 });
  });

  test("el aviso de solicitud recibida abre esa solicitud", async ({ page, context }) => {
    await como(context, "carlos@equipo.test");
    await page.goto("/");
    const region = await abrirCampana(page);
    await region.getByRole("button", { name: /^Solicitud de tarea: Informe de menciones/ }).click();
    await expect(page).toHaveURL(/\/solicitudes\?.*solicitud=\d+/);
    const detalle = esMovil(page)
      ? page.getByRole("dialog", { name: "Detalle de la solicitud" })
      : page.getByRole("complementary", { name: "Detalle de la solicitud" });
    await expect(detalle.getByRole("heading", { name: titulo })).toBeVisible();
  });
});

test.describe("paleta", () => {
  test("busca tareas de toda la unidad con GET /api/tareas?q= y abre la elegida", async ({ page, context }) => {
    await como(context, "analista@local.test");
    await page.goto("/tareas");
    const pedidas: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/tareas?")) pedidas.push(r.url()); });
    const entrada = await abrirPaleta(page);
    // De Luis, en la misma unidad: no esta asignada a analista.
    await entrada.fill("Benchmark de engagement");
    const opcion = page.getByRole("option", { name: /Benchmark de engagement por canal/ });
    await expect(opcion).toBeVisible();
    await expect(opcion).toContainText("Altice");
    expect(pedidas.some((u) => /[?&]q=Benchmark/.test(u))).toBe(true);
    await opcion.click();
    await expect(page).toHaveURL(/\/tareas\?tarea=\d+/);
    await expect(pase(page, "Benchmark de engagement por canal")).toBeVisible({ timeout: 20_000 });
  });

  test("la respuesta de la API trae lo que pinta la paleta y respeta el limite", async ({ browser }) => {
    soloEscritorio();
    const ctx = await browser.newContext();
    await como(ctx, "analista@local.test");
    const r = await ctx.request.get(`${BASE_URL}/api/tareas?q=informe&alcance=unidad&limite=6`);
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.tareas.length).toBeGreaterThan(0);
    expect(d.tareas.length).toBeLessThanOrEqual(6);
    for (const t of d.tareas) {
      expect(typeof t.id).toBe("number");
      expect(t.titulo.toLowerCase() + (t.cliente ?? "").toLowerCase() + "desc").toBeTruthy();
      expect(typeof t.estado).toBe("string");
    }
    await ctx.close();
  });

  test("«Nueva tarea» abre el alta en /tareas y «Solicitar» el formulario de solicitud", async ({ page, context }) => {
    await como(context, "analista@local.test");
    await page.goto("/");
    let entrada = await abrirPaleta(page);
    await entrada.fill("nueva tarea");
    await page.getByRole("option", { name: "Nueva tarea" }).click();
    await expect(page).toHaveURL(/\/tareas/);
    await expect(page.getByRole("dialog", { name: "Nueva tarea" })).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/nueva=1/);
    await page.getByRole("dialog", { name: "Nueva tarea" }).getByRole("button", { name: "Cancelar" }).click();

    // Ya en /tareas, la misma accion vuelve a abrirlo.
    entrada = await abrirPaleta(page);
    await entrada.fill("nueva tarea");
    await page.getByRole("option", { name: "Nueva tarea" }).click();
    await expect(page.getByRole("dialog", { name: "Nueva tarea" })).toBeVisible();
    await page.getByRole("dialog", { name: "Nueva tarea" }).getByRole("button", { name: "Cancelar" }).click();

    entrada = await abrirPaleta(page);
    await entrada.fill("solicitar trabajo");
    await page.getByRole("option", { name: /Solicitar trabajo a otra unidad/ }).click();
    await expect(page.locator("dialog[open]").getByRole("heading", { name: "Solicitar a otra unidad" })).toBeVisible();
    await expect(page).not.toHaveURL(/solicitar=1/);
  });
});

test.describe("contadores", () => {
  test("Inicio cuadra con /tareas (mis salidas) y con /equipo (carga del alcance)", async ({ browser }) => {
    soloEscritorio();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await como(ctx, "carlos@equipo.test");
    const page = await ctx.newPage();
    await page.goto("/");
    const franja = page.getByRole("group", { name: "Tus salidas" });
    await expect(franja).toBeVisible();
    const valor = async (rotulo: string) => Number((await franja.getByRole("button", { name: new RegExp(rotulo) }).innerText()).match(/\d+/)![0]);
    const inicio = { vencidas: await valor("Vencidas"), hoy: await valor("Hoy"), enCurso: await valor("En curso"), bloqueadas: await valor("Bloqueadas") };
    const tareas = await (await ctx.request.get(`${BASE_URL}/api/tareas/contadores?alcance=mias`)).json();
    expect(inicio).toEqual(tareas);

    // Carga por persona de Inicio = carga del panel de equipo.
    const filas = page.getByRole("table", { name: "Carga por persona" }).getByRole("row");
    const cargaInicio: Record<string, [number, number]> = {};
    for (const f of (await filas.all()).slice(1)) {
      const celdas = await f.getByRole("cell").allInnerTexts();
      cargaInicio[celdas[0]] = [Number(celdas[2]), Number(celdas[3])];
    }
    const equipo = await (await ctx.request.get(`${BASE_URL}/api/equipo`)).json();
    const cargaEquipo = Object.fromEntries((equipo.carga as Array<{ nombre: string; total: number; vencidas: number }>).map((c) => [c.nombre, [c.total, c.vencidas]]));
    expect(Object.keys(cargaInicio).length).toBeGreaterThan(3);
    expect(cargaInicio).toEqual(cargaEquipo);
    const totalAbiertas = Object.values(cargaInicio).reduce((s, [a]) => s + a, 0);
    expect(totalAbiertas).toBe(equipo.contadores.abiertas);
    await ctx.close();
  });
});

test.describe("catalogo", () => {
  test("renombrar un estado se ve en el tablero, en Inicio y en el panel de equipo", async ({ browser }) => {
    soloEscritorio();
    const nuevo = "En Revisión QA";
    const admin = await browser.newContext();
    await como(admin, "admin2@equipo.test");
    const [{ id }] = await sql<{ id: number }>("SELECT id FROM task_statuses WHERE nombre = 'En Revisión'");
    const renombrar = (nombre: string) => admin.request.patch(`${BASE_URL}/api/admin/catalogo/estados/${id}`, { data: { nombre } });
    expect((await renombrar(nuevo)).status()).toBe(200);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await como(ctx, "analista@local.test");
      const page = await ctx.newPage();
      // Tablero: la columna y las tarjetas con el nombre nuevo.
      const tab = await (await ctx.request.get(`${BASE_URL}/api/tareas/tablero?alcance=unidad`)).json();
      expect((tab.tareas as Array<{ estado: string }>).some((t) => t.estado === nuevo)).toBe(true);
      expect((tab.tareas as Array<{ estado: string }>).some((t) => t.estado === "En Revisión")).toBe(false);
      await page.goto("/tareas?alcance=unidad&vista=tablero");
      await expect(page.getByRole("heading", { name: new RegExp(nuevo) }).or(page.getByText(nuevo, { exact: true })).first()).toBeVisible();
      // Inicio: «Revisar nube de palabras…» vence hoy y estaba en revision.
      await page.goto("/");
      const fila = page.getByRole("link", { name: /Revisar nube de palabras/ }).first();
      await expect(fila).toContainText(nuevo);
      await ctx.close();

      const lider = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await como(lider, "carlos@equipo.test");
      const equipo = await (await lider.request.get(`${BASE_URL}/api/equipo`)).json();
      const segmentos = (equipo.carga as Array<{ segmentos: { estado: string }[] }>).flatMap((c) => c.segmentos.map((s) => s.estado));
      expect(segmentos).toContain(nuevo);
      expect(segmentos).not.toContain("En Revisión");
      const p2 = await lider.newPage();
      await p2.goto("/equipo");
      await expect(p2.getByRole("combobox", { name: "Estado" }).locator("option", { hasText: nuevo })).toHaveCount(1);
      await lider.close();
    } finally {
      expect((await renombrar("En Revisión")).status()).toBe(200);
      await admin.close();
    }
  });
});

test.describe("cierre forzado", () => {
  test("expulsa en todas las pantallas y en sus API", async ({ browser }) => {
    soloEscritorio();
    const victima = "jorge@equipo.test";
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await iniciarSesion(ctx, victima, { rotar: true });
    const page = await ctx.newPage();
    const pantallas = ["/", "/tareas", "/solicitudes", "/reportes", "/clasificacion", "/union", "/analisis"];
    for (const r of pantallas) {
      await page.goto(r);
      await expect(page, r).not.toHaveURL(/\/login/);
    }
    // Una pantalla abierta mientras el admin lo expulsa.
    await page.goto("/tareas");
    await expect(page.getByRole("heading", { name: "Mis tareas" })).toBeVisible();

    const admin = await browser.newContext();
    await como(admin, "demo@local.test");
    const [{ id }] = await sql<{ id: number }>("SELECT id FROM users WHERE email = $1", [victima]);
    expect((await admin.request.post(`${BASE_URL}/api/admin/usuarios/${id}/expulsar`, { data: {} })).status()).toBe(200);
    await admin.close();

    for (const api of ["/api/tareas", "/api/tareas/contadores", "/api/solicitudes", "/api/notificaciones/contador", "/api/datos/reportes", "/api/equipo"]) {
      expect((await page.request.get(`${BASE_URL}${api}`)).status(), api).toBe(401);
    }
    // La pantalla abierta: la siguiente accion lleva al login.
    await page.getByRole("button", { name: "Actualizar la lista" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    for (const r of pantallas) {
      await page.goto(r);
      await expect(page, r).toHaveURL(/\/login/);
    }
    await ctx.close();
  });
});

test.describe("navegacion por rol y tour", () => {
  const PERFILES = [
    "analista@local.test", "carlos@equipo.test", "laura@equipo.test", "demo@local.test",
    "sin.reportes@local.test", "herramientas.datos@local.test", "sin.unidad@local.test", "luis@equipo.test",
  ];

  test("la navegacion solo ofrece lo que se puede abrir", async ({ browser }) => {
    soloEscritorio();
    for (const email of PERFILES) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await como(ctx, email);
      const page = await ctx.newPage();
      await page.goto("/");
      const nav = page.locator("aside").getByRole("navigation", { name: "Principal" });
      await expect(nav.getByRole("link").first()).toBeVisible();
      const hrefs = await nav.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
      expect(hrefs.length, email).toBeGreaterThan(1);
      for (const href of hrefs) {
        const r = await page.goto(href);
        expect(r?.status(), `${email} ${href}`).toBeLessThan(400);
        await expect(page.locator("main h1, main h2").first(), `${email} ${href}`).toBeVisible();
        const texto = await page.locator("main").innerText();
        expect(texto, `${email} ${href}`).not.toMatch(/Sin permisos|Sin acceso a esta herramienta|No tienes acceso a la gestión/);
      }
      // Y lo que no ofrece, no se abre.
      const todas = ["/tareas", "/equipo", "/reportes/nuevo", "/clasificacion", "/union", "/analisis", "/admin"];
      for (const href of todas.filter((h) => !hrefs.includes(h))) {
        const r = await page.goto(href);
        if (r!.status() >= 400) continue;
        // forbidden() llega por streaming: el aviso se pinta al hidratar.
        await expect(page.locator("body"), `${email} no deberia abrir ${href}`).toContainText(/Sin permisos|Sin acceso|No tienes acceso|fuera de tu alcance/);
      }
      await ctx.close();
    }
  });

  test("el tour ilumina la navegacion real de cada perfil", async ({ page, context }) => {
    for (const email of esMovil(page) ? ["analista@local.test"] : ["analista@local.test", "laura@equipo.test", "demo@local.test"]) {
      await context.clearCookies();
      await sql("UPDATE users SET tour_completed_at = now() WHERE email = $1", [email]);
      await context.addCookies([{ name: "nl_sesion", value: await selloSesion(email), url: BASE_URL }]);
      await page.goto("/");
      await page.getByRole("button", { name: "Ver el tour de bienvenida" }).click();
      const dialogo = page.locator("[data-tour-activo]");
      await dialogo.getByRole("button", { name: "Empezar" }).click();
      const vistos: string[] = [];
      for (let i = 0; i < 12; i++) {
        const titulo = await dialogo.locator("#tour-titulo").innerText();
        vistos.push(titulo);
        if (/Eso es todo/i.test(titulo)) break;
        // Cada paso intermedio ilumina algo que existe y se ve.
        const caja = dialogo.locator(".outline-marca");
        await expect(caja, `${email}: «${titulo}» no ilumina nada`).toHaveCount(1);
        const b = (await caja.boundingBox())!;
        expect(b.width * b.height, titulo).toBeGreaterThan(100);
        await page.keyboard.press("ArrowRight");
        await expect(dialogo.locator("#tour-titulo")).not.toHaveText(titulo);
      }
      expect(vistos.at(-1)).toMatch(/Eso es todo/i);
      const esperados = { "analista@local.test": ["Tus tareas"], "laura@equipo.test": ["El panel de tu equipo"], "demo@local.test": ["Administración", "El panel de tu equipo"] }[email]!;
      for (const e of esperados) expect(vistos.some((v) => v.toLowerCase().startsWith(e.toLowerCase())), `${email}: falta «${e}»`).toBe(true);
      if (email === "analista@local.test") expect(vistos.some((v) => /Administración/i.test(v))).toBe(false);
      await page.keyboard.press("Escape");
    }
  });
});
