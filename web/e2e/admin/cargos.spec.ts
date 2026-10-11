import { expect, test } from "@playwright/test";
import { claveDeCliente } from "../../src/lib/clientes/nombre";
import { iniciarSesion, sql } from "../comun";
import { ADMIN, contextoCon, idDe } from "./ayuda";

/*
 * Cargos y administracion: el cargo es uno de cinco (coordinador, analista, ejecutiva, gerente, director) y
 * administrar es una casilla aparte. Los clientes tienen uno de tres tipos (Privado, Público, Interno) o ninguno.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API y flujo de escritorio: una pasada basta");
  test.setTimeout(120_000);
});

const sufijo = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const usuario = async (id: number) => (await sql<{ role: string; is_admin: boolean }>("SELECT role, is_admin FROM users WHERE id = $1", [id]))[0];
const alta = (nombre: string, extra: Record<string, unknown> = {}) => ({ nombre, email: `${nombre}@cargos.test`, contrasena: "clave-segura-1", ...extra });

test.describe("cargos de las personas", () => {
  test("se da de alta con uno de los cinco cargos (analista por defecto) y la casilla de administracion aparte", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const sin = await page.request.post("/api/admin/usuarios", { data: alta(`sin-cargo-${s}`) });
    expect(sin.status(), await sin.text()).toBe(201);
    expect(await usuario((await sin.json()).id)).toEqual({ role: "analista", is_admin: false });

    for (const cargo of ["coordinador", "analista", "ejecutiva", "gerente", "director"]) {
      const r = await page.request.post("/api/admin/usuarios", { data: alta(`${cargo}-${s}`, { rol: cargo }) });
      expect(r.status(), `${cargo}: ${await r.text()}`).toBe(201);
      expect((await usuario((await r.json()).id)).role).toBe(cargo);
    }
    // Una gerente que ademas administra: el cargo no cambia.
    const ger = await page.request.post("/api/admin/usuarios", { data: alta(`gerente-admin-${s}`, { rol: "gerente", esAdmin: true }) });
    expect(await usuario((await ger.json()).id)).toEqual({ role: "gerente", is_admin: true });
  });

  test("rechaza lo que no es un cargo: «admin», las disciplinas de antes, otra escritura y vacío", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    for (const malo of ["admin", "DI", "MW", "Gerente", "jefe", "directora"]) {
      const r = await page.request.post("/api/admin/usuarios", { data: alta(`malo-${malo}-${s}`, { rol: malo }) });
      expect(r.status(), malo).toBe(400);
      expect((await r.json()).error, malo).toContain("Coordinador, Analista, Ejecutiva, Gerente, Director");
    }
    expect((await page.request.post("/api/admin/usuarios", { data: alta(`malo-flag-${s}`, { esAdmin: "si" }) })).status()).toBe(400);
    const id = (await (await page.request.post("/api/admin/usuarios", { data: alta(`ok-${s}`) })).json()).id as number;
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { rol: "admin" } })).status()).toBe(400);
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { rol: "" } })).status()).toBe(400);
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { esAdmin: "true" } })).status()).toBe(400);
    expect(await usuario(id)).toEqual({ role: "analista", is_admin: false });
    // La base tambien lo exige.
    await expect(sql("UPDATE users SET role = 'DI' WHERE id = $1", [id])).rejects.toThrow(/ck_users_role/);
  });

  test("cambiar el cargo y administrar son cosas distintas, y queda en la actividad", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const id = (await (await page.request.post("/api/admin/usuarios", { data: alta(`cambia-${s}`) })).json()).id as number;
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { rol: "coordinador" } })).status()).toBe(200);
    expect(await usuario(id)).toEqual({ role: "coordinador", is_admin: false });
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { esAdmin: true } })).status()).toBe(200);
    expect(await usuario(id)).toEqual({ role: "coordinador", is_admin: true });
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { rol: "director", esAdmin: false } })).status()).toBe(200);
    expect(await usuario(id)).toEqual({ role: "director", is_admin: false });
    const logs = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'admin_edit_user' AND detail LIKE $1 ORDER BY id", [`%#${id}:%`]);
    expect(logs.map((l) => l.detail).join("|")).toMatch(/cargo: analista -> coordinador.*administrador: sí.*cargo: coordinador -> director, administrador: no/);
  });

  test("quien administra entra a Administracion y a todo; al quitarle la casilla deja de poder", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const s = sufijo();
    const id = (await (await page.request.post("/api/admin/usuarios", { data: alta(`casilla-${s}`, { rol: "analista", esAdmin: true, herramientas: ["tasks"] }) })).json()).id as number;
    const ctx = await browser.newContext();
    await iniciarSesion(ctx, id, { rotar: true });
    expect((await ctx.request.get("/api/admin/resumen")).status()).toBe(200);
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { esAdmin: false } })).status()).toBe(200);
    expect((await ctx.request.get("/api/admin/resumen")).status()).toBe(403);
  });

  test("nadie se quita a si mismo la casilla de administracion", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const yo = await idDe(ADMIN);
    expect((await page.request.patch(`/api/admin/usuarios/${yo}`, { data: { esAdmin: false } })).status()).toBe(400);
    expect((await usuario(yo)).is_admin).toBe(true);
    // A otra administradora si se le puede quitar (queda quien lo hace).
    const s = sufijo();
    const id = (await (await page.request.post("/api/admin/usuarios", { data: alta(`otra-${s}`, { esAdmin: true }) })).json()).id as number;
    expect((await page.request.patch(`/api/admin/usuarios/${id}`, { data: { esAdmin: false } })).status()).toBe(200);
  });

  test("el catalogo de roles ya no se edita: sus rutas no existen", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    for (const [metodo, ruta] of [["get", "/api/admin/roles"], ["post", "/api/admin/roles"], ["patch", "/api/admin/roles/1"], ["delete", "/api/admin/roles/1"]] as const) {
      expect((await page.request[metodo](ruta, metodo === "post" || metodo === "patch" ? { data: {} } : undefined)).status(), `${metodo} ${ruta}`).toBe(404);
    }
    expect((await sql<{ c: string }>("SELECT string_agg(code, ',' ORDER BY id) c FROM roles"))[0].c).toBe("coordinador,analista,ejecutiva,gerente,director");
  });

  test("la pantalla de personas ofrece los cinco cargos y la casilla «Es administrador»", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    await page.goto("/admin/personas");
    await expect(page.getByRole("heading", { name: "Personas" }).first()).toBeVisible();
    await expect(page.getByText("Todos los cargos")).toBeAttached();
    await page.getByRole("button", { name: "Nueva persona" }).first().click();
    const d = page.getByRole("dialog");
    const opciones = await d.getByLabel("Cargo", { exact: true }).locator("option").allInnerTexts();
    expect(opciones).toEqual(["Coordinador", "Analista", "Ejecutiva", "Gerente", "Director"]);
    await expect(d.getByLabel("Cargo", { exact: true })).toHaveValue("analista");
    const casilla = d.getByRole("checkbox", { name: /Es administrador/ });
    await expect(casilla).not.toBeChecked();
    const s = sufijo();
    await d.getByLabel("Nombre").fill(`pantalla-${s}`);
    await d.getByLabel("Correo").fill(`pantalla-${s}@cargos.test`);
    await d.getByLabel("Contraseña inicial").fill("clave-segura-1");
    await d.getByLabel("Cargo", { exact: true }).selectOption("ejecutiva");
    await casilla.check();
    await d.getByRole("button", { name: "Dar de alta" }).click();
    await expect.poll(async () => (await sql<{ role: string; is_admin: boolean }>("SELECT role, is_admin FROM users WHERE email = $1", [`pantalla-${s}@cargos.test`]))[0]).toEqual({ role: "ejecutiva", is_admin: true });
  });
});

test.describe("tipos de cliente", () => {
  const nombre = () => `Cli ${sufijo()}`;

  test("solo Privado, Público o Interno (o ninguno); «publico» se guarda como Público", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    for (const [pedido, guardado] of [["Privado", "Privado"], ["publico", "Público"], ["INTERNO", "Interno"], ["", null], [null, null]] as const) {
      const n = nombre();
      const r = await page.request.post("/api/admin/clientes", { data: { nombre: n, tipo: pedido } });
      expect(r.status(), String(pedido)).toBe(201);
      const [fila] = await sql<{ client_type: string | null }>("SELECT client_type FROM clients WHERE name_key = $1", [claveDeCliente(n)]);
      expect(fila.client_type, String(pedido)).toBe(guardado);
    }
    for (const malo of ["Corporativo", "Pyme", "Gobierno", "Externo", "Privado y Público"]) {
      const r = await page.request.post("/api/admin/clientes", { data: { nombre: nombre(), tipo: malo } });
      expect(r.status(), malo).toBe(400);
      expect((await r.json()).error).toContain("Privado, Público, Interno");
    }
  });

  test("al editar tambien: cambia entre los tres, se quita con vacio y no admite otro", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    const id = (await (await page.request.post("/api/admin/clientes", { data: { nombre: nombre(), tipo: "Privado" } })).json()).id as number;
    const tipo = async () => (await sql<{ client_type: string | null }>("SELECT client_type FROM clients WHERE id = $1", [id]))[0].client_type;
    expect((await page.request.patch(`/api/admin/clientes/${id}`, { data: { tipo: "Público" } })).status()).toBe(200);
    expect(await tipo()).toBe("Público");
    expect((await page.request.patch(`/api/admin/clientes/${id}`, { data: { tipo: "Pyme" } })).status()).toBe(400);
    expect(await tipo()).toBe("Público");
    expect((await page.request.patch(`/api/admin/clientes/${id}`, { data: { tipo: "" } })).status()).toBe(200);
    expect(await tipo()).toBeNull();
    // La base tambien lo exige.
    await expect(sql("UPDATE clients SET client_type = 'Corporativo' WHERE id = $1", [id])).rejects.toThrow(/ck_clients_type/);
  });

  test("el formulario de cliente ofrece exactamente tres tipos y «Sin tipo»", async ({ browser }) => {
    const { page } = await contextoCon(browser, ADMIN);
    await page.goto("/admin/clientes");
    await page.getByRole("button", { name: "Nuevo cliente" }).first().click();
    const d = page.getByRole("dialog");
    expect(await d.getByLabel("Tipo").locator("option").allInnerTexts()).toEqual(["Sin tipo", "Privado", "Público", "Interno"]);
  });
});
