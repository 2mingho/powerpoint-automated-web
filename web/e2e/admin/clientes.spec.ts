import { expect, test } from "@playwright/test";
import { claveDeCliente } from "../../src/lib/clientes/nombre";
import { escenario, entrarComo, sql } from "../tareas/apoyo";
import { ADMIN, contextoCon } from "./ayuda";

/*
 * Administracion de clientes: crear, renombrar, unir, borrar y vincular
 * pendientes. Todo es global, asi que solo admin; cada prueba usa nombres
 * propios para no tocar los clientes de la semilla.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000);
});

const sufijo = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const cliente = async (id: number) => (await sql<{ name: string; name_key: string; client_type: string | null; account_lead_id: number | null; is_active: boolean }>("SELECT * FROM clients WHERE id = $1", [id]))[0];
const existe = async (id: number) => (await sql("SELECT 1 FROM clients WHERE id = $1", [id])).length === 1;
const nuevoCliente = async (nombre: string, extra: { tipo?: string; lider?: number } = {}) =>
  (await sql<{ id: number }>("INSERT INTO clients (name, name_key, client_type, account_lead_id, is_active, created_at) VALUES ($1, $2, $3, $4, true, now()) RETURNING id", [nombre, claveDeCliente(nombre), extra.tipo ?? null, extra.lider ?? null]))[0].id;
const tareaDe = async (titulo: string, clienteId: number, nombre: string) => {
  const e = await escenario("cli-adm");
  const id = await e.tarea(titulo, e.alfa, e.empleado, e.empleado);
  await sql("UPDATE tasks SET client = $1, client_id = $2 WHERE id = $3", [nombre, clienteId, id]);
  return { id, e };
};
const marca = async (id: number) => (await sql<{ u: Date }>("SELECT updated_at u FROM tasks WHERE id = $1", [id]))[0].u.toISOString();

test.describe("alta y validacion", () => {
  test("crea, no admite el mismo nombre con otras mayusculas, y valida", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const n = `Nuevo ${sufijo()}`;
    const lider = (await sql<{ id: number }>("SELECT id FROM users WHERE email = 'laura@equipo.test'"))[0].id;
    const alta = await page.request.post("/api/admin/clientes", { data: { nombre: `  ${n}  `, tipo: "Gobierno", liderId: lider } });
    expect(alta.status(), await alta.text()).toBe(201);
    const { id } = await alta.json();
    expect(await cliente(id)).toMatchObject({ name: n, name_key: n.toLowerCase(), client_type: "Gobierno", account_lead_id: lider, is_active: true });

    const repetido = await page.request.post("/api/admin/clientes", { data: { nombre: n.toUpperCase() } });
    expect(repetido.status()).toBe(409);
    expect((await repetido.json()).error).toContain(n);

    for (const mal of [{ nombre: "   " }, { nombre: "x".repeat(101) }, { nombre: "Ok", tipo: "t".repeat(41) }, { nombre: "Ok", liderId: 99999999 }]) {
      expect((await page.request.post("/api/admin/clientes", { data: mal })).status(), JSON.stringify(mal).slice(0, 40)).toBe(400);
    }
  });

  test("el listado filtra por nombre sin acentos ni mayusculas y por estado", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const a = await nuevoCliente(`Cámara ${s}`);
    const b = await nuevoCliente(`Camión ${s}`);
    await sql("UPDATE clients SET is_active = false WHERE id = $1", [b]);
    const lista = async (q: string) => ((await (await page.request.get(`/api/admin/clientes?${q}`)).json()) as { filas: { id: number }[] }).filas.map((f) => f.id);
    expect(await lista(`q=CAMARA ${s}`)).toEqual([a]);
    expect(await lista(`q=${s}&estado=activos`)).toEqual([a]);
    expect(await lista(`q=${s}&estado=inactivos`)).toEqual([b]);
    expect((await lista(`q=${s}`)).sort()).toEqual([a, b].sort());
  });
});

test.describe("renombrar", () => {
  test("renombra las tareas sin tocar su updated_at, y no admite chocar con otro cliente", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const id = await nuevoCliente(`Viejo ${s}`);
    const otro = await nuevoCliente(`Otro ${s}`);
    const { id: tarea } = await tareaDe("Renombrada", id, `Viejo ${s}`);
    const antes = await marca(tarea);

    const r = await page.request.patch(`/api/admin/clientes/${id}`, { data: { nombre: `Nuevo Nombre ${s}` } });
    expect(r.status(), await r.text()).toBe(200);
    expect((await cliente(id)).name_key).toBe(`nuevo nombre ${s}`.toLowerCase());
    expect((await sql<{ client: string }>("SELECT client FROM tasks WHERE id = $1", [tarea]))[0].client).toBe(`Nuevo Nombre ${s}`);
    expect(await marca(tarea)).toBe(antes);

    const choque = await page.request.patch(`/api/admin/clientes/${id}`, { data: { nombre: `OTRO ${s}` } });
    expect(choque.status()).toBe(409);
    expect((await cliente(id)).name).toBe(`Nuevo Nombre ${s}`);
    expect(await existe(otro)).toBe(true);
    expect((await page.request.patch("/api/admin/clientes/99999999", { data: { nombre: "x" } })).status()).toBe(404);
  });

  test("tipo, lider y activo se cambian por separado y se vacian", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const id = await nuevoCliente(`Campos ${sufijo()}`, { tipo: "Privado" });
    const lider = (await sql<{ id: number }>("SELECT id FROM users WHERE email = 'laura@equipo.test'"))[0].id;
    expect((await page.request.patch(`/api/admin/clientes/${id}`, { data: { liderId: lider, activo: false } })).status()).toBe(200);
    expect(await cliente(id)).toMatchObject({ client_type: "Privado", account_lead_id: lider, is_active: false });
    expect((await page.request.patch(`/api/admin/clientes/${id}`, { data: { tipo: "", liderId: null } })).status()).toBe(200);
    expect(await cliente(id)).toMatchObject({ client_type: null, account_lead_id: null, is_active: false });
  });
});

test.describe("unir", () => {
  test("mueve las tareas, conserva lo del destino, hereda lo que falte y elimina el origen", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const lider = (await sql<{ id: number }>("SELECT id FROM users WHERE email = 'laura@equipo.test'"))[0].id;
    const origen = await nuevoCliente(`Claro RD ${s}`, { tipo: "Telecom", lider });
    const destino = await nuevoCliente(`Claro ${s}`, { tipo: "Corporativo" });
    const { id: t1 } = await tareaDe("Uno", origen, `Claro RD ${s}`);
    const { id: t2 } = await tareaDe("Dos", destino, `Claro ${s}`);
    const antes = await marca(t1);

    const r = await page.request.post(`/api/admin/clientes/${origen}/unir`, { data: { destinoId: destino } });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toEqual({ movidas: 1, destino: `Claro ${s}` });
    expect(await existe(origen)).toBe(false);
    expect(await cliente(destino)).toMatchObject({ client_type: "Corporativo", account_lead_id: lider });
    for (const t of [t1, t2]) expect((await sql<{ client: string; client_id: number }>("SELECT client, client_id FROM tasks WHERE id = $1", [t]))[0]).toEqual({ client: `Claro ${s}`, client_id: destino });
    expect(await marca(t1)).toBe(antes);
  });

  test("rechaza unir uno consigo mismo, destinos que no existen y datos mal formados", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const id = await nuevoCliente(`Solo ${sufijo()}`);
    expect((await page.request.post(`/api/admin/clientes/${id}/unir`, { data: { destinoId: id } })).status()).toBe(400);
    expect((await page.request.post(`/api/admin/clientes/${id}/unir`, { data: { destinoId: 99999999 } })).status()).toBe(404);
    expect((await page.request.post(`/api/admin/clientes/${id}/unir`, { data: {} })).status()).toBe(400);
    expect((await page.request.post("/api/admin/clientes/99999999/unir", { data: { destinoId: id } })).status()).toBe(404);
    expect(await existe(id)).toBe(true);
  });

  test("el listado sugiere los parecidos y no sugiere los distintos", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const base = await nuevoCliente(`Zeta${s}`);
    const rd = await nuevoCliente(`Zeta${s} RD`);
    const punto = await nuevoCliente(`Zeta${s}.`);
    const ajeno = await nuevoCliente(`Omega${s}`);
    const { filas } = (await (await page.request.get(`/api/admin/clientes?q=${s}`)).json()) as { filas: { id: number; parecidos: { id: number }[] }[] };
    const de = (id: number) => filas.find((f) => f.id === id)!.parecidos.map((p) => p.id).sort();
    expect(de(base)).toEqual([rd, punto].sort());
    expect(de(ajeno)).toEqual([]);
  });
});

test.describe("eliminar", () => {
  test("con tareas es 409 y se queda; sin tareas se elimina", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const conTareas = await nuevoCliente(`Con tareas ${s}`);
    const sinTareas = await nuevoCliente(`Sin tareas ${s}`);
    await tareaDe("Ancla", conTareas, `Con tareas ${s}`);
    const mal = await page.request.delete(`/api/admin/clientes/${conTareas}`);
    expect(mal.status()).toBe(409);
    expect((await mal.json()).error).toContain("1 tarea");
    expect(await existe(conTareas)).toBe(true);
    expect((await page.request.delete(`/api/admin/clientes/${sinTareas}`)).status()).toBe(200);
    expect(await existe(sinTareas)).toBe(false);
    expect((await page.request.delete(`/api/admin/clientes/${sinTareas}`)).status()).toBe(404);
  });
});

test.describe("vincular pendientes", () => {
  test("une cada nombre a su cliente o crea uno, y deja en paz lo vacio", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const existente = await nuevoCliente(`Flask ${s}`);
    const e = await escenario("cli-vin");
    const ponerTexto = async (titulo: string, texto: string) => {
      const id = await e.tarea(titulo, e.alfa, e.empleado, e.empleado);
      await sql("UPDATE tasks SET client = $1, client_id = NULL WHERE id = $2", [texto, id]);
      return id;
    };
    const a = await ponerTexto("A", `FLASK ${s}`);
    const b = await ponerTexto("B", `  flask ${s} `);
    const c = await ponerTexto("C", `Brand New ${s}`);
    const d = await ponerTexto("D", `brand   new ${s}`);
    const vacio = await ponerTexto("E", "   ");
    const antes = await marca(a);

    const previo = ((await (await page.request.get("/api/admin/clientes")).json()) as { pendientes: number }).pendientes;
    expect(previo).toBeGreaterThanOrEqual(4);

    const r = await page.request.post("/api/admin/clientes/vincular", { data: {} });
    expect(r.status(), await r.text()).toBe(200);
    expect((await r.json()).nuevos).toBe(1);

    const nuevo = (await sql<{ id: number; name: string }>("SELECT id, name FROM clients WHERE name_key = $1", [`brand new ${s}`]))[0];
    const fila = async (id: number) => (await sql<{ client: string; client_id: number | null }>("SELECT client, client_id FROM tasks WHERE id = $1", [id]))[0];
    expect(await fila(a)).toEqual({ client: `Flask ${s}`, client_id: existente });
    expect(await fila(b)).toEqual({ client: `Flask ${s}`, client_id: existente });
    expect(await fila(c)).toEqual({ client: nuevo.name, client_id: nuevo.id });
    expect(await fila(d)).toEqual({ client: nuevo.name, client_id: nuevo.id });
    expect(await fila(vacio)).toEqual({ client: "   ", client_id: null });
    expect(await marca(a)).toBe(antes);

    // Idempotente, y lo vacio no cuenta como pendiente.
    const otra = await page.request.post("/api/admin/clientes/vincular", { data: {} });
    expect(await otra.json()).toEqual({ tareas: 0, nuevos: 0 });
    expect(((await (await page.request.get("/api/admin/clientes")).json()) as { pendientes: number }).pendientes).toBe(0);
  });
});

test.describe("pantalla", () => {
  test("se une un cliente desde la sugerencia de parecidos", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const base = await nuevoCliente(`Pantalla${s}`);
    const duplicado = await nuevoCliente(`Pantalla${s} RD`);
    const { id: tarea } = await tareaDe("Por pantalla", duplicado, `Pantalla${s} RD`);

    await page.goto(`/admin/clientes?q=Pantalla${s}`);
    await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible({ timeout: 30_000 });
    // Filas por orden de clave: primero la base, luego «RD». La base tambien menciona a «RD» en su sugerencia, asi que se elige por posicion.
    const fila = page.getByRole("row").filter({ hasText: `Pantalla${s}` }).last();
    await expect(fila.getByRole("button", { name: `Pantalla${s} RD`, exact: true }).first()).toBeVisible();
    await fila.getByRole("button", { name: `Pantalla${s}`, exact: true }).click(); // la sugerencia: unir RD en la base
    const dialogo = page.getByRole("dialog", { name: "Unir clientes" });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByRole("combobox")).toHaveValue(String(base));
    await dialogo.getByRole("button", { name: "Unir clientes" }).click();

    await expect.poll(async () => existe(duplicado)).toBe(false);
    expect((await sql<{ client: string; client_id: number }>("SELECT client, client_id FROM tasks WHERE id = $1", [tarea]))[0]).toEqual({ client: `Pantalla${s}`, client_id: base });
    await expect(page.getByRole("row").filter({ hasText: `Pantalla${s} RD` })).toHaveCount(0);
  });

  test("un cliente inactivo no se sugiere al crear una tarea, pero sigue en el filtro", async ({ page, context }) => {
    const s = sufijo();
    const activo = await nuevoCliente(`Activo ${s}`);
    const inactivo = await nuevoCliente(`Inactivo ${s}`);
    await sql("UPDATE clients SET is_active = false WHERE id = $1", [inactivo]);
    const e = await escenario("cli-inact");
    for (const [titulo, id, nombre] of [["Activa", activo, `Activo ${s}`], ["Inactiva", inactivo, `Inactivo ${s}`]] as const) {
      const t = await e.tarea(titulo, e.alfa, e.empleado, e.empleado);
      await sql("UPDATE tasks SET client = $1, client_id = $2 WHERE id = $3", [nombre, id, t]);
    }
    await entrarComo(context, e.empleado);
    await page.goto("/tareas");
    await page.getByRole("button", { name: "Nueva tarea" }).click();
    await page.getByText("Más datos").click();
    await expect(page.locator(`datalist#clientes-nueva option[value="Activo ${s}"]`)).toHaveCount(1);
    await expect(page.locator(`datalist#clientes-nueva option[value="Inactivo ${s}"]`)).toHaveCount(0);
  });
});
