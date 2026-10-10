import { expect, test } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sql, sumarDias } from "./apoyo";

/*
 * Ficha flotante del cliente. Lo sensible: las cifras salen solo de las tareas
 * que quien pregunta puede ver, y un cliente sin tareas visibles es un 404.
 */

type Ficha = { id: number; nombre: string; tipo: string; lider: string; abiertas: number; vencidas: number; proximas: { id: number; titulo: string; entrega: string }[]; aTiempo: { porcentaje: number | null; cerradas: number }; unidades: string[] };

async function conCliente(prefijo: string) {
  const e = await escenario(prefijo);
  const nombre = `Ficha ${e.sufijo}`;
  const id = (await sql<{ id: number }>("INSERT INTO clients (name, name_key, client_type, is_active, created_at) VALUES ($1, $2, 'Corporativo', true, now()) RETURNING id", [nombre, nombre.toLowerCase()]))[0].id;
  /* Una tarea de ese cliente: unidad, responsable, estado, entrega y, si esta cerrada, cuando se cerro. */
  const tarea = async (titulo: string, area: number, quien: number, estado: string, entrega: string, cerradaHace?: number) => {
    const t = await e.tarea(titulo, area, quien, quien, estado, entrega);
    await sql("UPDATE tasks SET client = $1, client_id = $2, done_at = CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(days => $4::int) END WHERE id = $3", [nombre, id, t, cerradaHace ?? null]);
    return t;
  };
  return { e, nombre, id, tarea };
}

const ficha = async (ctx: import("@playwright/test").BrowserContext, id: number) => ctx.request.get(`${BASE}/api/clientes/${id}/ficha`);

test.describe("API de la ficha", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "La API se prueba una vez, en escritorio."); });

  test("cuenta solo lo que quien pregunta ve: otra unidad no suma ni aparece", async ({ context }) => {
    const { e, id, tarea } = await conCliente("fic-ambito");
    await tarea("Alfa abierta", e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 3));
    await tarea("Alfa vencida", e.alfa, e.empleado, "En Progreso", sumarDias(HOY, -2));
    await tarea("Beta secreta", e.beta, e.ajeno, "Pendiente", sumarDias(HOY, 1));

    await entrarComo(context, e.empleado);
    const r = await ficha(context, id);
    expect(r.status(), await r.text()).toBe(200);
    const f = (await r.json()) as Ficha;
    expect(f).toMatchObject({ id, tipo: "Corporativo", abiertas: 2, vencidas: 1 });
    expect(f.proximas.map((t) => t.titulo)).toEqual(["Alfa abierta"]);
    expect(JSON.stringify(f)).not.toContain("Beta");
    expect(JSON.stringify(f)).not.toContain(`ajeno.${e.sufijo}`);

    await entrarComo(context, e.ajeno);
    const otro = (await (await ficha(context, id)).json()) as Ficha;
    expect(otro).toMatchObject({ abiertas: 1, vencidas: 0 });
    expect(otro.proximas.map((t) => t.titulo)).toEqual(["Beta secreta"]);
    expect(JSON.stringify(otro)).not.toContain("Alfa");
  });

  test("sin tareas visibles es 404, igual que un cliente que no existe", async ({ context }) => {
    const { e, id, tarea } = await conCliente("fic-404");
    await tarea("Solo Beta", e.beta, e.ajeno, "Pendiente", sumarDias(HOY, 1));
    await entrarComo(context, e.empleado);
    const sinVer = await ficha(context, id);
    const inexistente = await ficha(context, 99999999);
    expect(sinVer.status()).toBe(404);
    expect(inexistente.status()).toBe(404);
    expect(await sinVer.json()).toEqual(await inexistente.json());
    expect((await ficha(context, 0)).status()).toBe(404);
    expect((await context.request.get(`${BASE}/api/clientes/abc/ficha`)).status()).toBe(404);
  });

  test("sin sesion es 401 y sin la herramienta de tareas es 403", async ({ context, request }) => {
    const { e, id } = await conCliente("fic-acceso");
    expect((await request.get(`${BASE}/api/clientes/${id}/ficha`)).status()).toBe(401);
    await sql("UPDATE users SET allowed_tools = '[\"reports\"]' WHERE id = $1", [e.empleado]);
    await entrarComo(context, e.empleado);
    expect((await ficha(context, id)).status()).toBe(403);
  });

  test("proximas: solo abiertas con fecha por delante, la mas cercana primero y como mucho tres", async ({ context }) => {
    const { e, id, tarea } = await conCliente("fic-prox");
    for (const [titulo, dias] of [["D", 9], ["B", 2], ["A", 0], ["C", 5]] as const) await tarea(titulo, e.alfa, e.empleado, "Pendiente", sumarDias(HOY, dias));
    await tarea("Vencida", e.alfa, e.empleado, "Pendiente", sumarDias(HOY, -1));
    await tarea("Cerrada", e.alfa, e.empleado, "Completado", sumarDias(HOY, 1), 0);
    await entrarComo(context, e.empleado);
    const f = (await (await ficha(context, id)).json()) as Ficha;
    expect(f.proximas.map((t) => t.titulo)).toEqual(["A", "B", "C"]);
    expect(f).toMatchObject({ abiertas: 5, vencidas: 1 });
  });

  test("a tiempo: de lo cerrado en 30 dias, lo que llego a la fecha; sin datos no inventa un 100", async ({ context }) => {
    const { e, id, tarea } = await conCliente("fic-tiempo");
    await entrarComo(context, e.empleado);
    await tarea("Pendiente", e.alfa, e.empleado, "Pendiente", sumarDias(HOY, 4));
    const vacio = (await (await ficha(context, id)).json()) as Ficha;
    expect(vacio.aTiempo).toEqual({ porcentaje: null, cerradas: 0 });

    await tarea("A tiempo", e.alfa, e.empleado, "Completado", sumarDias(HOY, 2), 1); // cerrada ayer, vencia en 2 dias
    await tarea("Tarde", e.alfa, e.empleado, "Completado", sumarDias(HOY, -10), 1); // vencia hace 10, cerrada ayer
    await tarea("Sin fecha de cierre", e.alfa, e.empleado, "Completado", sumarDias(HOY, -20)); // anterior a done_at: no cuenta
    await tarea("Antigua", e.alfa, e.empleado, "Completado", sumarDias(HOY, -60), 45); // fuera de 30 dias
    const f = (await (await ficha(context, id)).json()) as Ficha;
    expect(f.aTiempo).toEqual({ porcentaje: 50, cerradas: 2 });
  });
});

test.describe("la ficha en pantalla", () => {
  async function pantalla(prefijo: string) {
    const c = await conCliente(prefijo);
    const abierta = await c.tarea("Entrega del cliente", c.e.alfa, c.e.empleado, "Pendiente", sumarDias(HOY, 2));
    await c.tarea("Otra", c.e.alfa, c.e.empleado, "Pendiente", sumarDias(HOY, 6));
    return { ...c, abierta };
  }

  test("con el raton: abre al pasar, se mantiene sobre ella y Escape la cierra", async ({ page, context }, info) => {
    test.skip(info.project.name !== "escritorio", "El cursor es de escritorio.");
    const { e, nombre, abierta } = await pantalla("fic-raton");
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas`);
    const fila = page.locator(`li[data-tarea="${abierta}"]`);
    const disparador = fila.getByRole("button", { name: `Ficha del cliente ${nombre}` });
    await disparador.hover();
    const tarjeta = page.getByRole("dialog", { name: `Cliente: ${nombre}` });
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.getByText("Corporativo")).toBeVisible();
    await expect(tarjeta.getByRole("term").filter({ hasText: "Abiertas" })).toBeVisible();
    await expect(tarjeta.getByRole("link", { name: /Entrega del cliente/ })).toBeVisible();

    // Pasar el cursor a la ficha no la cierra.
    await tarjeta.hover();
    await page.waitForTimeout(500);
    await expect(tarjeta).toBeVisible();
    // Salir la cierra.
    await page.mouse.move(5, 5);
    await expect(tarjeta).toBeHidden();

    await disparador.hover();
    await expect(tarjeta).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tarjeta).toBeHidden();
  });

  test("con el teclado: Enter abre y lleva el foco a la ficha; Escape lo devuelve al nombre", async ({ page, context }, info) => {
    test.skip(info.project.name !== "escritorio", "El teclado se prueba en escritorio.");
    const { e, nombre, abierta } = await pantalla("fic-teclado");
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas`);
    const disparador = page.locator(`li[data-tarea="${abierta}"]`).getByRole("button", { name: `Ficha del cliente ${nombre}` });
    await disparador.focus();
    await page.keyboard.press("Enter");
    const tarjeta = page.getByRole("dialog", { name: `Cliente: ${nombre}` });
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta).toBeFocused();
    // No se cierra sola: el foco que pasa del nombre a la ficha no es "salir".
    await page.waitForTimeout(700);
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tarjeta).toBeHidden();
    await expect(disparador).toBeFocused();
  });

  test("con el teclado: Tab dentro de la ficha la mantiene y al salir de ella se cierra", async ({ page, context }, info) => {
    test.skip(info.project.name !== "escritorio", "El teclado se prueba en escritorio.");
    const { e, nombre, abierta } = await pantalla("fic-tab");
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas`);
    const disparador = page.locator(`li[data-tarea="${abierta}"]`).getByRole("button", { name: `Ficha del cliente ${nombre}` });
    await disparador.focus();
    await page.keyboard.press("Enter");
    const tarjeta = page.getByRole("dialog", { name: `Cliente: ${nombre}` });
    await expect(tarjeta).toBeFocused();
    await expect(tarjeta.getByRole("link").first()).toBeVisible(); // ya cargo: antes no hay a donde ir
    await page.keyboard.press("Tab"); // al primer enlace de la propia ficha
    await page.waitForTimeout(500);
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.getByRole("link").first()).toBeFocused();
    await tarjeta.getByRole("link").last().focus();
    await page.keyboard.press("Tab"); // fuera de la ficha
    await expect(tarjeta).toBeHidden();
  });

  test("al tocar: abre como hoja inferior sin abrir la tarea, y se cierra al tocar fuera", async ({ page, context }, info) => {
    test.skip(info.project.name !== "movil", "El toque es del proyecto movil.");
    const { e, nombre, abierta } = await pantalla("fic-toque");
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas?tarea=${abierta}`);
    const pase = page.getByRole("article", { name: /Entrega del cliente/ });
    await expect(pase).toBeVisible({ timeout: 20_000 });
    await pase.getByRole("button", { name: `Ficha del cliente ${nombre}` }).tap();
    const tarjeta = page.getByRole("dialog", { name: `Cliente: ${nombre}` });
    await expect(tarjeta).toBeVisible();
    const caja = (await tarjeta.boundingBox())!;
    const ancho = page.viewportSize()!.width;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
    await expect(tarjeta.getByRole("button", { name: "Cerrar ficha" })).toBeVisible();
    await tarjeta.getByRole("button", { name: "Cerrar ficha" }).tap();
    await expect(tarjeta).toBeHidden();
  });

  test("Equipo tambien la ofrece, con las cifras del alcance de quien la abre", async ({ page, context }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez basta.");
    const { e, nombre, tarea } = await pantalla("fic-equipo");
    await tarea("En beta", e.beta, e.ajeno, "Pendiente", sumarDias(HOY, 1));
    const lider = (await sql<{ id: number }>("INSERT INTO users (username, email, password, role, is_active, created_at, area_id, allowed_tools, tour_completed_at) SELECT $1, $2, password, 'DI', true, now(), $3, '[\"tasks\"]', now() FROM users WHERE id = $4 RETURNING id",
      [`lider.${e.sufijo}`, `lider.${e.sufijo}@e2e.test`, e.alfa, e.empleado]))[0].id;
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [lider, e.alfa]);
    await entrarComo(context, lider);
    await page.goto(`${BASE}/equipo?cliente=${encodeURIComponent(nombre)}`);
    const disparador = page.getByRole("button", { name: `Ficha del cliente ${nombre}` }).first();
    await expect(disparador).toBeVisible({ timeout: 20_000 });
    await disparador.hover();
    const tarjeta = page.getByRole("dialog", { name: `Cliente: ${nombre}` });
    await expect(tarjeta).toBeVisible();
    // Dos de Alfa (la de la pantalla y «Otra»); la de Beta no cuenta para quien lidera Alfa.
    await expect(tarjeta.getByRole("definition").first()).toHaveText("2");
    await expect(tarjeta).not.toContainText("Beta");
  });
});
