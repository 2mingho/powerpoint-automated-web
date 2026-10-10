import { expect, test, type Page } from "@playwright/test";
import { escenario, entrarComo, sql } from "../tareas/apoyo";

/*
 * Vista Ingresos en pantalla: quien la ve, que ve, y que puede hacer segun sus
 * concesiones. La API de contratos y metas se prueba en contratos.spec.ts.
 */
const ANIO = new Date().getFullYear();

type Esc = Awaited<ReturnType<typeof escenario>>;
const conceder = (user: number, area: number, kind: "contracts" | "goals") =>
  sql("INSERT INTO finance_grants (user_id, area_id, kind, created_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING", [user, area, kind]);
const lidera = (user: number, area: number) => sql("INSERT INTO unit_leads (user_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user, area]);
const cliente = async (e: Esc, nombre: string) => {
  const n = `${nombre} ${e.sufijo}`;
  return { nombre: n, id: (await sql<{ id: number }>("INSERT INTO clients (name, name_key, client_type, is_active, created_at) VALUES ($1, $2, 'Corporativo', true, now()) ON CONFLICT (name_key) DO UPDATE SET name = excluded.name RETURNING id", [n, n.toLowerCase()]))[0].id };
};
const contrato = (clienteId: number, area: number, monto: number, tipo = "Fee", ini = `${ANIO}-01-01`, fin = `${ANIO}-12-31`) =>
  sql("INSERT INTO contracts (client_id, area_id, contract_type, amount, start_date, end_date, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now(), now())", [clienteId, area, tipo, monto, ini, fin]);
const meta = (area: number, monto: number, anio = ANIO) => sql("INSERT INTO goals (year, area_id, amount, updated_at) VALUES ($1, $2, $3, now())", [anio, area, monto]);

async function abrir(page: Page) {
  await page.goto("/ingresos");
  await expect(page.getByRole("heading", { name: "Ingresos", level: 1 })).toBeVisible();
}
const cifras = (page: Page) => page.getByRole("region", { name: "Avance contra la meta" });
/* Valor de una cifra del avance ("Contratado" -> "US$12k"). */
async function cifra(page: Page, rotulo: string) {
  const t = await cifras(page).getByText(rotulo, { exact: true }).first().locator("..").innerText();
  return t.split("\n").map((l) => l.trim()).filter(Boolean)[1];
}

test.describe("quien la ve", () => {
  test("sin mando ni concesiones: sin enlace en el menu y la pagina responde 403", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-nada");
    await entrarComo(context, e.empleado);
    await page.goto("/ingresos");
    await expect(page.getByText("Los ingresos son de quien supervisa")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Ingresos" })).toHaveCount(0);
  });

  test("sin sesion lleva al acceso", async ({ page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    await page.goto("/ingresos");
    await expect(page).toHaveURL(/\/login/);
  });

  test("quien lidera una unidad la ve, con el enlace en el menu, y solo esa", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-lidera");
    const c = await cliente(e, "Altice");
    const otro = await cliente(e, "Secreto");
    await contrato(c.id, e.alfa, 12000);
    await contrato(otro.id, e.beta, 99000);
    await meta(e.alfa, 20000);
    await meta(e.beta, 77000);
    await lidera(e.empleado, e.alfa);
    await entrarComo(context, e.empleado);
    await abrir(page);
    await expect(page.getByRole("navigation").getByRole("link", { name: "Ingresos" }).first()).toBeVisible();
    await expect.poll(() => cifra(page, "Contratado")).toBe("US$12k");
    await expect(page.getByRole("list").getByText(c.nombre).first()).toBeVisible();
    // Lo de otra unidad no llega ni en el HTML.
    const crudo = await (await context.request.get("/ingresos")).text();
    for (const ajeno of [otro.nombre, `Beta ${e.sufijo}`, "99000", "77000"]) expect(crudo, ajeno).not.toContain(ajeno);
  });
});

test.describe("la meta total se calcula", () => {
  test("sin nadie que la fije es la suma de las metas de sus unidades", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-suma");
    const c = await cliente(e, "Claro");
    await contrato(c.id, e.alfa, 6000);
    await meta(e.alfa, 10000);
    await meta(e.beta, 5000);
    await lidera(e.empleado, e.alfa);
    await lidera(e.empleado, e.beta);
    await entrarComo(context, e.empleado);
    await abrir(page);
    await expect(cifras(page)).toContainText("suma de las metas de las unidades");
    await expect(cifras(page)).toContainText("US$15,000"); // 10000 + 5000, sin teclear nada
    await expect.poll(() => cifra(page, "Falta por contratar")).toBe("US$9k");
    await expect(page.getByText("no suman")).toHaveCount(0);
  });
});

test.describe("lo que puede hacer", () => {
  test("sin concesion no hay botones de crear, editar ni borrar, ni campo de meta", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-lectura");
    const c = await cliente(e, "Lectura");
    await contrato(c.id, e.alfa, 12000);
    await meta(e.alfa, 20000);
    await lidera(e.empleado, e.alfa);
    await entrarComo(context, e.empleado);
    await abrir(page);
    await expect(page.getByRole("button", { name: "Nuevo contrato" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Editar el contrato/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Eliminar el contrato/ })).toHaveCount(0);
    await expect(page.getByLabel(`Meta ${ANIO} de Alfa ${e.sufijo}`)).toHaveCount(0);
    await expect(page.getByText(`Meta ${ANIO}:`)).toBeVisible(); // la cifra, sin campo
  });

  test("con concesion: crea un contrato y confirma el prorrateo, lo edita y lo elimina", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-crud");
    const c = await cliente(e, "Orange");
    await conceder(e.empleado, e.alfa, "contracts");
    await entrarComo(context, e.empleado);
    await abrir(page);
    await expect(page.getByText(`Sin contratos con ingreso en ${ANIO}`)).toBeVisible();

    await page.getByRole("button", { name: "Nuevo contrato" }).first().click();
    const d = page.getByRole("dialog", { name: "Nuevo contrato" });
    await d.getByLabel("Cliente").selectOption({ label: c.nombre });
    await d.getByLabel("Monto total (US$)").fill("15000");
    await expect(d.getByText("US$1,250 por mes durante 12 meses")).toBeVisible();
    await d.getByRole("button", { name: "Crear contrato" }).click();
    await expect(page.getByText("Contrato guardado. US$1,250 por mes durante 12 meses.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Editar el contrato de ${c.nombre} en Alfa ${e.sufijo}` })).toBeVisible();
    await expect.poll(() => cifra(page, "Contratado")).toBe("US$15k");

    await page.getByRole("button", { name: `Editar el contrato de ${c.nombre} en Alfa ${e.sufijo}` }).click();
    const ed = page.getByRole("dialog", { name: "Editar contrato" });
    await ed.getByLabel("Monto total (US$)").fill("6000");
    await ed.getByLabel("Fin").fill(`${ANIO}-06-30`);
    await expect(ed.getByText("US$1,000 por mes durante 6 meses")).toBeVisible();
    await ed.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Contrato actualizado. US$1,000 por mes durante 6 meses.")).toBeVisible();
    await expect.poll(() => cifra(page, "Contratado")).toBe("US$6k");

    await page.getByRole("button", { name: `Eliminar el contrato de ${c.nombre} en Alfa ${e.sufijo}` }).click();
    await page.getByRole("dialog", { name: "Eliminar contrato" }).getByRole("button", { name: "Eliminar contrato" }).click();
    await expect(page.getByText(`Sin contratos con ingreso en ${ANIO}`)).toBeVisible();
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM contracts WHERE area_id = $1", [e.alfa]))[0].n)).toBe(0);
  });

  test("el formulario avisa de lo invalido y el servidor no guarda nada", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-form-mal");
    const c = await cliente(e, "Tigo");
    await conceder(e.empleado, e.alfa, "contracts");
    await entrarComo(context, e.empleado);
    await abrir(page);
    await page.getByRole("button", { name: "Nuevo contrato" }).first().click();
    const d = page.getByRole("dialog", { name: "Nuevo contrato" });
    await d.getByRole("button", { name: "Crear contrato" }).click();
    await expect(d.getByRole("alert")).toContainText("cliente");
    await d.getByLabel("Cliente").selectOption({ label: c.nombre });
    await d.getByLabel("Monto total (US$)").fill("15,000");
    await d.getByRole("button", { name: "Crear contrato" }).click();
    await expect(d.getByRole("alert")).toContainText("separador de miles");
    await d.getByLabel("Monto total (US$)").fill("100");
    await d.getByLabel("Fin").fill(`${ANIO - 1}-01-01`);
    await d.getByRole("button", { name: "Crear contrato" }).click();
    await expect(d.getByRole("alert")).toContainText("posterior");
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM contracts WHERE area_id = $1", [e.alfa]))[0].n)).toBe(0);
  });

  test("con la concesion de metas puede fijar la de su unidad, y solo esa", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-meta");
    const c = await cliente(e, "Viva");
    await contrato(c.id, e.alfa, 6000);
    await conceder(e.empleado, e.alfa, "goals");
    await lidera(e.empleado, e.beta);
    await entrarComo(context, e.empleado);
    await abrir(page);
    await page.getByLabel(`Meta ${ANIO} de Alfa ${e.sufijo}`).fill("10000");
    await page.getByRole("button", { name: "Guardar" }).first().click();
    await expect(page.getByText(`Meta ${ANIO} de Alfa ${e.sufijo}: US$10,000.`)).toBeVisible();
    await expect(cifras(page)).toContainText("US$10,000");
    // Beta la ve pero no la edita: sin campo.
    await expect(page.getByLabel(`Meta ${ANIO} de Beta ${e.sufijo}`)).toHaveCount(0);
  });

  test("la meta fijada a mano la pone solo Administracion y se puede volver a la suma", async ({ browser }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { contextoCon } = await import("../admin/ayuda");
    const { page, ctx } = await contextoCon(browser, "demo@local.test");
    const anio = ANIO + 5;
    await ctx.request.put("/api/finanzas/metas", { data: { anio, unidadId: null, monto: 0 } });
    await page.goto(`/ingresos?anio=${anio}`);
    // Un año sin contratos muestra el vacio; la meta total se fija desde un año con contratos.
    const e = await escenario("ing-fijada");
    const c = await cliente(e, "Fijada");
    await contrato(c.id, e.alfa, 1200, "Fee", `${anio}-01-01`, `${anio}-12-31`);
    await meta(e.alfa, 3000, anio);
    await page.reload();
    const campo = page.getByLabel(`Meta ${anio} de la dirección`);
    await expect(campo).toBeVisible();
    await campo.fill("5000000");
    await page.getByRole("button", { name: "Guardar" }).first().click();
    await expect(page.getByText("fijada a mano")).toBeVisible();
    await expect(page.getByText("Las unidades suman")).toBeVisible();
    await page.getByRole("button", { name: "Volver a la suma de las unidades" }).click();
    await expect(page.getByText("suma de las metas de las unidades que ves")).toBeVisible();
    await ctx.request.put("/api/finanzas/metas", { data: { anio, unidadId: null, monto: 0 } });
    await sql("DELETE FROM goals WHERE year = $1", [anio]);
  });
});

test.describe("filtros y años", () => {
  test("filtra por cliente, tipo y unidad; cambia de año", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await escenario("ing-filtros");
    const a = await cliente(e, "Alfa Cliente");
    const b = await cliente(e, "Beta Cliente");
    await contrato(a.id, e.alfa, 12000, "Fee");
    await contrato(b.id, e.alfa, 6000, "Proyecto", `${ANIO}-03-01`, `${ANIO}-08-31`);
    await contrato(a.id, e.alfa, 2400, "Fee", `${ANIO - 1}-01-01`, `${ANIO - 1}-12-31`);
    await lidera(e.empleado, e.alfa);
    await entrarComo(context, e.empleado);
    await abrir(page);
    await expect.poll(() => cifra(page, "Contratado")).toBe("US$18k");

    await page.getByLabel("Tipo de contrato").selectOption("Proyecto");
    await expect.poll(() => cifra(page, "Contratado")).toBe("US$6k");
    await expect(page.getByRole("list", { name: "Filtros activos" })).toContainText("Tipo: Proyecto");
    await page.getByRole("button", { name: "Quitar todos los filtros" }).first().click();

    await page.getByRole("region", { name: "Filtros", exact: true }).getByLabel("Cliente", { exact: true }).selectOption({ label: a.nombre });
    await expect.poll(() => cifra(page, "Contratado")).toBe("US$12k");
    await expect(page.getByText(`Contratos de ${a.nombre}`)).toBeVisible();

    await page.getByRole("button", { name: `Año ${ANIO - 1}` }).click();
    await expect(page).toHaveURL(new RegExp(`anio=${ANIO - 1}`));
    await expect(page.getByRole("region", { name: "Avance contra la meta" })).toBeVisible();
    await expect.poll(() => cifra(page, "Contratado")).toBe("US$2.4k");
  });
});

test.describe("en el Panel de Inicio y en la ficha del cliente", () => {
  /* Un cliente con una tarea en Alfa y contratos en Alfa (visible) y en Beta (no visible para quien lidera Alfa). */
  async function montar(prefijo: string) {
    const e = await escenario(prefijo);
    const c = await cliente(e, "Panelero");
    const t = await e.tarea("Entrega del panelero", e.alfa, e.empleado, e.empleado, "Pendiente", `${ANIO}-${String(new Date().getMonth() + 1).padStart(2, "0")}-28`);
    await sql("UPDATE tasks SET client = $1, client_id = $2 WHERE id = $3", [c.nombre, c.id, t]);
    await contrato(c.id, e.alfa, 12000, "Fee");
    await contrato(c.id, e.beta, 50000, "Proyecto");
    await meta(e.alfa, 20000);
    return { e, c };
  }
  const panel = "/?vista=panel&periodo=todo";

  test("el Panel muestra los ingresos de las unidades que ve, con el tipo de contrato como filtro", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e } = await montar("ing-panel");
    await lidera(e.empleado, e.alfa);
    await entrarComo(context, e.empleado);
    await page.goto(panel);
    const bloque = page.getByRole("region", { name: `Ingresos ${ANIO}` });
    await expect(bloque).toBeVisible();
    await expect(bloque).toContainText("US$12k"); // Alfa; los 50k de Beta no se ven ni se suman
    await expect(bloque).not.toContainText("US$62k");
    await expect(bloque).toContainText("60.0%"); // 12k de la meta de 20k
    await expect(bloque.getByRole("link", { name: "Ver ingresos" })).toHaveAttribute("href", `/ingresos?anio=${ANIO}`);
    // El filtro de contrato existe y la tarea cae en el contrato vigente de su cliente y unidad.
    const filtro = page.getByRole("region", { name: "Filtros del panel" }).getByLabel("Tipo de contrato");
    await expect(filtro.locator("option")).toHaveText(["Todos", "Fee (1)"]);
    await filtro.selectOption("Fee");
    await expect(page.getByRole("table", { name: "Tareas que cumplen los filtros" }).getByText("Entrega del panelero")).toBeVisible();
    await page.getByRole("region", { name: "Filtros del panel" }).getByLabel("Cliente", { exact: true }).selectOption({ index: 1 });
    await expect(bloque).toContainText("US$12k");
  });

  test("sin acceso a ingresos: ni bloque ni filtro de contrato, ni cifras en el HTML", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e, c } = await montar("ing-panel-sin");
    await entrarComo(context, e.empleado); // ve la tarea, pero no supervisa ni edita ingresos
    await page.goto(panel);
    await expect(page.getByRole("table", { name: "Tareas que cumplen los filtros" }).getByText("Entrega del panelero")).toBeVisible();
    await expect(page.getByRole("region", { name: `Ingresos ${ANIO}` })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Filtros del panel" }).getByLabel("Tipo de contrato")).toHaveCount(0);
    const crudo = await (await context.request.get(panel)).text();
    for (const secreto of ["12000", "50000", "Proyecto", `"contrato":"Fee"`]) expect(crudo, secreto).not.toContain(secreto);
    const f = await (await context.request.get(`/api/clientes/${c.id}/ficha`)).json();
    expect(f.contratado).toBeNull();
  });

  test("la ficha del cliente trae lo contratado solo en las unidades que quien pregunta ve", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const { e, c } = await montar("ing-ficha");
    await lidera(e.empleado, e.alfa);
    await entrarComo(context, e.empleado);
    const f = await (await context.request.get(`/api/clientes/${c.id}/ficha`)).json();
    expect(f.contratado).toEqual({ anio: ANIO, total: 12000 });
    await page.goto("/tareas");
    await page.locator("li[data-tarea]").first().getByRole("button", { name: `Ficha del cliente ${c.nombre}` }).hover();
    const ficha = page.getByRole("dialog", { name: `Cliente: ${c.nombre}` });
    await expect(ficha).toContainText(`Contratado ${ANIO}`);
    await expect(ficha).toContainText("US$12k");
    await expect(ficha.getByRole("link", { name: "Ver ingresos" })).toBeVisible();
    // Con la concesion de contratos en Beta, ahora ve las dos.
    await conceder(e.empleado, e.beta, "contracts");
    expect((await (await context.request.get(`/api/clientes/${c.id}/ficha`)).json()).contratado.total).toBe(62000);
  });
});
