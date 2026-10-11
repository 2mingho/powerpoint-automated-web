import { expect, test, type BrowserContext } from "@playwright/test";
import { idDeCorreo } from "../comun";
import { BASE, entrarComo, escenario, HOY, sql } from "./apoyo";

/*
 * Gastos de la unidad: los registra y presupuesta quien la LIDERA; quien la supervisa solo los ve; el resto de la
 * gente no sabe que existen. Cada prueba crea su escenario: unidad Alfa (lider, empleado, companero) y Beta (ajeno).
 */
test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "Una vez basta, en escritorio."); });

type Esc = Awaited<ReturnType<typeof escenario>>;
const ANIO = Number(HOY.slice(0, 4));

async function nuevaPersona(e: Esc, nombre: string, area: number | null, manager: number | null = null) {
  return (await sql<{ id: number }>("INSERT INTO users (username, email, password, role, is_active, created_at, area_id, manager_id, allowed_tools, tour_completed_at) SELECT $1, $2, password, 'analista', true, now(), $3, $4, '[\"tasks\"]', now() FROM users WHERE id = $5 RETURNING id",
    [`${nombre}.${e.sufijo}`, `${nombre}.${e.sufijo}@e2e.test`, area, manager, e.empleado]))[0].id;
}

async function conGerente() {
  const e = await escenario("gastos");
  const director = await nuevaPersona(e, "director", null);
  const gerente = await nuevaPersona(e, "gerente", e.alfa, director);
  await sql("UPDATE users SET manager_id = $1 WHERE id = $2", [gerente, e.empleado]);
  await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [gerente, e.alfa]);
  return { e, gerente, director };
}

async function api(contexto: BrowserContext, userId: number) {
  await entrarComo(contexto, userId);
  return contexto.request;
}
const gasto = (e: Esc, o: Record<string, unknown> = {}) => ({ unidadId: e.alfa, fecha: `${ANIO}-03-10`, categoria: "Viajes y viáticos", descripcion: "Vuelo a Santiago", monto: 250, ...o });

test.describe("API de gastos", () => {
  test("el gerente registra, edita y borra; la categoría se normaliza y el resumen cuadra", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    const crear = async (o: Record<string, unknown>) => {
      const res = await r.post(`${BASE}/api/gastos`, { data: gasto(e, o) });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).id as number;
    };
    const a = await crear({ monto: "250" });
    await crear({ categoria: "  viajes   y viaticos ", descripcion: "Hotel", monto: "100,50" }); // misma categoría, escrita distinto
    await crear({ categoria: "Marketing", descripcion: "Anuncios", monto: 400, fecha: `${ANIO}-05-02` });
    await crear({ categoria: "Marketing", descripcion: "Del año pasado", monto: 9999, fecha: `${ANIO - 1}-12-31` });

    expect((await r.put(`${BASE}/api/gastos/presupuestos`, { data: { unidadId: e.alfa, anio: ANIO, categoria: "viajes y viáticos", monto: 400 } })).status()).toBe(200);
    expect((await r.put(`${BASE}/api/gastos/presupuestos`, { data: { unidadId: e.alfa, anio: ANIO, categoria: "Capacitación", monto: 1000 } })).status()).toBe(200);

    const d = await (await r.get(`${BASE}/api/gastos?unidad=${e.alfa}&anio=${ANIO}`)).json();
    expect(d.puedeEditar).toBe(true);
    expect(d.gastos).toHaveLength(3); // el del año pasado no
    // Marketing (400) no tiene presupuesto: no se mide contra los 1400 de las otras dos categorias.
    expect(d.resumen).toMatchObject({ gastado: 750.5, sinPresupuesto: 400, presupuesto: 1400, restante: 1049.5, estado: "bien" });
    const viajes = d.resumen.porCategoria.find((c: { categoria: string }) => c.categoria === "Viajes y viáticos");
    expect(viajes).toMatchObject({ gastado: 350.5, presupuesto: 400, estado: "bien" });
    expect(d.resumen.porCategoria.map((c: { categoria: string }) => c.categoria).sort()).toEqual(["Capacitación", "Marketing", "Viajes y viáticos"]);
    expect(d.resumen.porMes[2].gastado).toBe(350.5); // marzo
    expect(d.categorias).toContain("Marketing");

    // Editar: parcial.
    expect((await r.patch(`${BASE}/api/gastos/${a}`, { data: { monto: 500, descripcion: "Vuelo y maleta" } })).status()).toBe(200);
    const despues = await (await r.get(`${BASE}/api/gastos?unidad=${e.alfa}&anio=${ANIO}`)).json();
    expect(despues.gastos.find((g: { id: number }) => g.id === a)).toMatchObject({ monto: 500, descripcion: "Vuelo y maleta", categoria: "Viajes y viáticos" });
    expect(despues.resumen.porCategoria.find((c: { categoria: string }) => c.categoria === "Viajes y viáticos").estado).toBe("excedido");

    // Quitar un presupuesto (monto 0) y borrar un gasto.
    expect((await r.put(`${BASE}/api/gastos/presupuestos`, { data: { unidadId: e.alfa, anio: ANIO, categoria: "Capacitación", monto: 0 } })).status()).toBe(200);
    expect((await r.delete(`${BASE}/api/gastos/${a}`)).status()).toBe(200);
    const fin = await (await r.get(`${BASE}/api/gastos?unidad=${e.alfa}&anio=${ANIO}`)).json();
    expect(fin.gastos).toHaveLength(2);
    expect(fin.resumen.presupuesto).toBe(400);
    expect((await sql<{ n: string }>("SELECT count(*) n FROM activity_logs WHERE action IN ('expense_create','expense_edit','expense_delete','expense_budget_set','expense_budget_clear') AND user_id = $1", [gerente]))[0].n).toBe("9");
  });

  test("rechaza lo inválido con mensaje claro", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    for (const [malo, texto] of [
      [{ monto: 0 }, /mayor que 0/], [{ monto: "abc" }, /monto/i], [{ monto: "1.234" }, /dos decimales/], [{ categoria: " " }, /categoría/], [{ descripcion: "" }, /Describe/],
      [{ fecha: "2026-02-30" }, /fecha/i], [{ descripcion: "x".repeat(301) }, /300/], [{ unidadId: "" }, /unidad/i],
    ] as const) {
      const res = await r.post(`${BASE}/api/gastos`, { data: gasto(e, malo) });
      expect(res.status(), JSON.stringify(malo)).toBe(400);
      expect((await res.json()).error, JSON.stringify(malo)).toMatch(texto);
    }
    expect((await r.put(`${BASE}/api/gastos/presupuestos`, { data: { unidadId: e.alfa, anio: 1999, categoria: "x", monto: 1 } })).status()).toBe(400);
    expect((await r.put(`${BASE}/api/gastos/presupuestos`, { data: { unidadId: e.alfa, anio: ANIO, categoria: "x", monto: -5 } })).status()).toBe(400);
  });

  test("quién ve y quién edita: gerente edita, dirección solo ve, la gente de la unidad y las otras unidades, nada", async ({ context, browser }) => {
    const { e, gerente, director } = await conGerente();
    const id = (await (await (await api(context, gerente)).post(`${BASE}/api/gastos`, { data: gasto(e) })).json()).id as number;

    // Dirección: ve la unidad, no edita.
    const ctxDir = await browser.newContext();
    const rd = await api(ctxDir, director);
    const dd = await (await rd.get(`${BASE}/api/gastos?unidad=${e.alfa}&anio=${ANIO}`)).json();
    expect(dd.unidades.map((u: { id: number }) => u.id)).toContain(e.alfa);
    expect(dd.puedeEditar).toBe(false);
    expect(dd.gastos).toHaveLength(1);
    expect((await rd.post(`${BASE}/api/gastos`, { data: gasto(e) })).status()).toBe(403);
    expect((await rd.patch(`${BASE}/api/gastos/${id}`, { data: { monto: 1 } })).status()).toBe(403);
    expect((await rd.delete(`${BASE}/api/gastos/${id}`)).status()).toBe(403);
    expect((await rd.put(`${BASE}/api/gastos/presupuestos`, { data: { unidadId: e.alfa, anio: ANIO, categoria: "x", monto: 5 } })).status()).toBe(403);

    // Una persona de la unidad (ni lider ni jefe de nadie) y el lider de otra unidad: no existe para ellas (404, sin datos).
    const beta = await nuevaPersona(e, "gerentebeta", e.beta);
    await sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2)", [beta, e.beta]);
    for (const quien of [e.companero, beta]) {
      const ctx = await browser.newContext();
      const r = await api(ctx, quien);
      const d = await (await r.get(`${BASE}/api/gastos?unidad=${e.alfa}&anio=${ANIO}`)).json();
      expect(d.gastos, `persona ${quien}`).toEqual([]);
      expect(d.unidades.some((u: { id: number }) => u.id === e.alfa)).toBe(false);
      expect((await r.post(`${BASE}/api/gastos`, { data: gasto(e) })).status()).toBe(404);
      expect((await r.patch(`${BASE}/api/gastos/${id}`, { data: { monto: 1 } })).status()).toBe(404);
      expect((await r.delete(`${BASE}/api/gastos/${id}`)).status()).toBe(404);
      expect((await r.get(`${BASE}/api/gastos/exportar?unidad=${e.alfa}&anio=${ANIO}`)).status()).toBe(404);
      await ctx.close();
    }
    await ctxDir.close();

    // La administración edita todo.
    const ctxAdm = await browser.newContext();
    const ra = await api(ctxAdm, await idDeCorreo("demo@local.test"));
    expect((await ra.patch(`${BASE}/api/gastos/${id}`, { data: { monto: 77 } })).status()).toBe(200);
    await ctxAdm.close();
  });

  test("una unidad con gastos no se puede eliminar", async ({ context }) => {
    const { e, gerente } = await conGerente();
    await (await api(context, gerente)).post(`${BASE}/api/gastos`, { data: gasto(e) });
    const vacia = await escenario("gastos-borrar");
    await sql("UPDATE users SET area_id = NULL WHERE area_id = $1", [vacia.alfa]);
    const adm = await api(context, await idDeCorreo("demo@local.test"));
    await sql("INSERT INTO expenses (area_id, spent_on, category, description, amount, created_at, updated_at) VALUES ($1, now(), 'Otros', 'x', 1, now(), now())", [vacia.alfa]);
    const res = await adm.delete(`${BASE}/api/admin/unidades/${vacia.alfa}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/1 gasto/);
  });

  test("CSV del año: con los gastos, sin fórmulas ejecutables y solo de lo que se ve", async ({ context }) => {
    const { e, gerente } = await conGerente();
    const r = await api(context, gerente);
    await r.post(`${BASE}/api/gastos`, { data: gasto(e, { descripcion: "=HYPERLINK(\"http://x\")", proveedor: "Acme, S.A." }) });
    const res = await r.get(`${BASE}/api/gastos/exportar?unidad=${e.alfa}&anio=${ANIO}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const texto = await res.text();
    expect(texto).toContain("Fecha,Categoria,Descripcion,Monto (USD),Proveedor,Nota");
    expect(texto).toContain("250.00");
    expect(texto).toContain('"Acme, S.A."');
    expect(texto).toContain("'=HYPERLINK"); // neutralizada
  });
});

test.describe("pantalla de gastos", () => {
  test("el gerente ve el menú, registra un gasto desde el diálogo, fija un presupuesto y ve el avance", async ({ context, page }) => {
    const { e, gerente } = await conGerente();
    await entrarComo(context, gerente);
    await page.goto("/gastos");
    await expect(page.getByRole("heading", { name: "Gastos", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Gastos" }).first()).toBeVisible();
    await expect(page.getByText("Sin gastos en")).toBeVisible();

    await page.getByRole("button", { name: "Nuevo gasto" }).click();
    const dialogo = page.getByRole("dialog", { name: "Nuevo gasto" });
    await dialogo.getByLabel("Monto (US$)").fill("120.75");
    await dialogo.getByLabel("Categoría").fill("transporte");
    await dialogo.getByLabel("Descripción").fill("Taxi al cliente");
    await dialogo.getByLabel("Proveedor").fill("Uber");
    await dialogo.getByRole("button", { name: "Registrar gasto" }).click();
    await expect(page.locator("[data-gasto]").filter({ hasText: "Taxi al cliente" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Cifras del año" })).toContainText("US$121");

    await page.getByRole("button", { name: "Fijar el presupuesto de Transporte" }).click();
    const pres = page.getByRole("dialog", { name: /Presupuesto/ });
    await pres.getByLabel(/Presupuesto de/).fill("100");
    await pres.getByRole("button", { name: "Guardar presupuesto" }).click();
    await expect(page.getByText(/Excedido en US\$20\.75/)).toBeVisible();
    await expect(page.getByRole("group", { name: "Cifras del año" })).toContainText("Excedido");
    expect((await sql<{ n: string }>("SELECT count(*) n FROM expenses WHERE area_id = $1", [e.alfa]))[0].n).toBe("1");

    // Editar y borrar.
    await page.getByRole("button", { name: /Editar el gasto «Taxi al cliente»/ }).click();
    await page.getByRole("dialog", { name: "Editar gasto" }).getByLabel("Monto (US$)").fill("60");
    await page.getByRole("dialog", { name: "Editar gasto" }).getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(/Dentro del presupuesto|Cerca del límite/).first()).toBeVisible();
    await page.getByRole("button", { name: /Eliminar el gasto «Taxi al cliente»/ }).click();
    await page.getByRole("dialog", { name: "Eliminar gasto" }).getByRole("button", { name: "Eliminar gasto" }).click();
    await expect(page.getByText("Sin gastos en")).toBeVisible();
  });

  test("quien no lidera ninguna unidad no ve el menú y la pantalla le dice por qué", async ({ context, page }) => {
    const { e } = await conGerente();
    await entrarComo(context, e.companero);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Gastos" })).toHaveCount(0);
    await page.goto("/gastos");
    await expect(page.getByText(/Los gastos son de quien lidera una unidad/)).toBeVisible();
  });

  test("dirección ve los gastos sin botones de edición", async ({ context, page }) => {
    const { e, gerente, director } = await conGerente();
    await (await api(context, gerente)).post(`${BASE}/api/gastos`, { data: gasto(e) });
    await entrarComo(context, director);
    await page.goto(`/gastos?unidad=${e.alfa}&anio=${ANIO}`);
    await expect(page.locator("[data-gasto]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Nuevo gasto" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Editar el gasto/ })).toHaveCount(0);
    await expect(page.getByText(/solo quien la lidera registra gastos/)).toBeVisible();
  });
});
