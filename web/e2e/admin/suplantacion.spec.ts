import { expect, test, type BrowserContext } from "@playwright/test";
import { iniciarSesion, selloSesion, sql } from "../comun";
import { escenario } from "../tareas/apoyo";
import { ADMIN, ADMIN_2, contextoCon, idDe } from "./ayuda";

/*
 * Ver la aplicacion como otra persona. Cualquier administradora, y solo a personas que no
 * administran; la sesion recuerda quien es de verdad.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API y flujo de escritorio: una pasada basta");
  test.setTimeout(120_000);
});

const EMAIL_PRINCIPAL = "admin@dataintel.com";
/* La cuenta principal no viene en la semilla: se crea una vez, con la clave de las demas. */
async function principal(): Promise<number> {
  const [ya] = await sql<{ id: number }>("SELECT id FROM users WHERE lower(email) = $1", [EMAIL_PRINCIPAL]);
  if (ya) { await sql("UPDATE users SET is_active = true, force_logout = false, role = 'director', is_admin = true WHERE id = $1", [ya.id]); return ya.id; }
  const hash = (await sql<{ password: string }>("SELECT password FROM users WHERE email = $1", [ADMIN]))[0].password;
  return (await sql<{ id: number }>("INSERT INTO users (username, email, password, role, is_admin, is_active, created_at, allowed_tools, tour_completed_at) VALUES ('Administrador principal', $1, $2, 'director', true, true, now(), NULL, now()) RETURNING id", [EMAIL_PRINCIPAL, hash]))[0].id;
}
async function contextoPrincipal(browser: import("@playwright/test").Browser) {
  const id = await principal();
  const ctx = await browser.newContext();
  await iniciarSesion(ctx, id, { rotar: true });
  return { ctx, id, page: await ctx.newPage() };
}
const suplantar = (ctx: BrowserContext, id: number) => ctx.request.post(`/api/admin/usuarios/${id}/suplantar`, { data: {} });
const token = async (id: number) => (await sql<{ t: string | null }>("SELECT session_token t FROM users WHERE id = $1", [id]))[0].t;
const actividad = (accion: string, userId: number) => sql<{ detail: string; user_id: number }>("SELECT detail, user_id FROM activity_logs WHERE action = $1 AND user_id = $2 ORDER BY id DESC", [accion, userId]);

test.describe("quien puede", () => {
  test("cualquier administradora puede; una persona comun o nadie, no", async ({ browser, request }) => {
    const e = await escenario("sup-quien");
    // Una administradora que NO es la cuenta principal.
    const { ctx: otraAdmin } = await contextoCon(browser, ADMIN);
    const r1 = await suplantar(otraAdmin, e.empleado);
    expect(r1.status(), await r1.text()).toBe(200);
    expect((await actividad("impersonate_start", await idDe(ADMIN)))[0].detail).toContain(`empleado.${e.sufijo}`);
    // Una persona comun, no.
    const comun = await browser.newContext();
    await iniciarSesion(comun, e.empleado, { rotar: true });
    expect((await suplantar(comun, e.companero)).status()).toBe(403);
    // Sin sesion, tampoco.
    expect((await request.post(`/api/admin/usuarios/${e.empleado}/suplantar`, { data: {} })).status()).toBe(401);
  });

  test("a otra administradora no se la puede ver: ni a la principal ni a cualquier otra", async ({ browser }) => {
    const { ctx } = await contextoCon(browser, ADMIN);
    const otra = await idDe(ADMIN_2);
    const r = await suplantar(ctx, otra);
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toContain("otra persona administradora");
    const principal2 = await principal();
    expect((await suplantar(ctx, principal2)).status()).toBe(403);
    // La sesion de quien lo intento no cambio.
    expect((await ctx.request.get("/api/admin/usuarios")).status()).toBe(200);
  });

  test("quien administra por la casilla, aunque su cargo sea otro, puede; quien deja de administrar, ya no", async ({ browser }) => {
    const e = await escenario("sup-casilla");
    await sql("UPDATE users SET role = 'gerente', is_admin = true WHERE id = $1", [e.companero]);
    const ctx = await browser.newContext();
    await iniciarSesion(ctx, e.companero, { rotar: true });
    expect((await suplantar(ctx, e.empleado)).status()).toBe(200);
    await ctx.close();
    await sql("UPDATE users SET is_admin = false WHERE id = $1", [e.companero]);
    const ctx2 = await browser.newContext();
    await iniciarSesion(ctx2, e.companero, { rotar: true });
    expect((await suplantar(ctx2, e.empleado)).status()).toBe(403);
  });

  test("no a si misma, ni a una cuenta desactivada, ni a una que no existe, ni dos veces seguidas", async ({ browser }) => {
    const e = await escenario("sup-limites");
    const { ctx, id } = await contextoPrincipal(browser);
    expect((await suplantar(ctx, id)).status()).toBe(400);
    await sql("UPDATE users SET is_active = false WHERE id = $1", [e.ajeno]);
    expect((await suplantar(ctx, e.ajeno)).status()).toBe(400);
    expect((await suplantar(ctx, 99999999)).status()).toBe(404);
    expect((await suplantar(ctx, e.empleado)).status()).toBe(200);
    // Ya viendo como el empleado, no se encadena otra suplantacion (y el empleado ni siquiera es administrador).
    expect((await suplantar(ctx, e.companero)).status()).toBe(403);
    // Ni se suplanta a una persona administradora.
  });
});

test.describe("viendo como otra persona", () => {
  test("la aplicacion es la de esa persona: sus datos, su menu, sin permisos de administracion; y un aviso fijo", async ({ browser }) => {
    const e = await escenario("sup-ver");
    const t = await e.tarea("Tarea de Empleado", e.alfa, e.empleado, e.empleado);
    const { ctx, page } = await contextoPrincipal(browser);
    expect((await suplantar(ctx, e.empleado)).status()).toBe(200);

    const mias = (await (await ctx.request.get("/api/tareas?alcance=mias")).json()) as { tareas: { id: number }[] };
    expect(mias.tareas.map((x) => x.id)).toContain(t);
    expect((await ctx.request.get("/api/admin/usuarios")).status()).toBe(403); // es el empleado: sin administracion

    await page.goto("/");
    const aviso = page.getByRole("status").filter({ hasText: "Estás viendo la aplicación como" });
    await expect(aviso).toContainText(`empleado.${e.sufijo}`);
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Administración" })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page.getByText(/sin permisos|no tienes permiso/i).first()).toBeVisible();
  });

  test("volver a mi cuenta desde el aviso: otra vez la principal, sin aviso, y queda en la actividad", async ({ browser }) => {
    const e = await escenario("sup-volver");
    const { ctx, id, page } = await contextoPrincipal(browser);
    await suplantar(ctx, e.empleado);
    await page.goto("/");
    await page.getByRole("button", { name: "Volver a mi cuenta" }).click();
    await expect(page).toHaveURL(/\/admin\/personas/);
    await expect(page.getByRole("status").filter({ hasText: "Estás viendo la aplicación como" })).toHaveCount(0);
    expect((await ctx.request.get("/api/admin/usuarios")).status()).toBe(200);
    expect((await actividad("impersonate_start", id))[0].detail).toContain(`empleado.${e.sufijo}`);
    expect((await actividad("impersonate_stop", id)).length).toBeGreaterThan(0);
  });

  test("lo que se hace queda en la actividad como de esa persona, marcado como suplantacion", async ({ browser }) => {
    const e = await escenario("sup-rastro");
    const { ctx, id } = await contextoPrincipal(browser);
    await suplantar(ctx, e.empleado);
    const r = await ctx.request.post("/api/tareas", { data: { title: `Creada suplantando ${e.sufijo}`, assignee_id: e.empleado, due_date: "2031-01-06" } });
    expect(r.status(), await r.text()).toBe(201);
    const [log] = await sql<{ detail: string; user_id: number }>("SELECT detail, user_id FROM activity_logs WHERE action = 'task_create' AND detail LIKE $1", [`%Creada suplantando ${e.sufijo}%`]);
    expect(log.user_id).toBe(e.empleado);
    expect(log.detail).toContain(`[suplantado por administrador #${id}]`);
    // Sin suplantar, el mismo registro no lleva la marca.
    const [normal] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'impersonate_start' AND user_id = $1 ORDER BY id DESC LIMIT 1", [id]);
    expect(normal.detail).not.toContain("suplantado por");
  });

  test("salir viendo como otra persona cierra la sesion del administrador y no toca la de la persona", async ({ browser }) => {
    const e = await escenario("sup-salir");
    const { ctx, id, page } = await contextoPrincipal(browser);
    const antesAdmin = await token(id);
    const antesEmpleado = await selloSesion(e.empleado); // fija su token
    void antesEmpleado;
    const tokenEmpleado = await token(e.empleado);
    await suplantar(ctx, e.empleado);
    await page.goto("/");
    await page.request.post("/api/sesion/salir");
    expect(await token(id)).not.toBe(antesAdmin); // la sesion de verdad es la del administrador
    expect(await token(e.empleado)).toBe(tokenEmpleado); // la de la persona sigue viva
    expect((await ctx.request.get("/api/tareas")).status()).toBe(401);
  });

  test("si la sesion del administrador se cierra, la suplantacion tambien", async ({ browser }) => {
    const e = await escenario("sup-admin-cae");
    const { ctx, id } = await contextoPrincipal(browser);
    await suplantar(ctx, e.empleado);
    expect((await ctx.request.get("/api/tareas")).status()).toBe(200);
    await sql("UPDATE users SET force_logout = true WHERE id = $1", [id]);
    expect((await ctx.request.get("/api/tareas")).status()).toBe(401);
    await sql("UPDATE users SET force_logout = false WHERE id = $1", [id]);
    expect((await ctx.request.get("/api/tareas")).status()).toBe(200);
    await sql("UPDATE users SET session_token = 'otro' WHERE id = $1", [id]); // alguien inicio sesion con esa cuenta
    expect((await ctx.request.get("/api/tareas")).status()).toBe(401);
  });

  test("si desactivan a la persona suplantada, se acaba; si solo la expulsan o inicia sesion, no", async ({ browser }) => {
    const e = await escenario("sup-destino");
    const { ctx } = await contextoPrincipal(browser);
    await suplantar(ctx, e.empleado);
    await sql("UPDATE users SET force_logout = true, session_token = 'nuevo' WHERE id = $1", [e.empleado]);
    expect((await ctx.request.get("/api/tareas")).status()).toBe(200); // no es ella quien entra
    await sql("UPDATE users SET is_active = false WHERE id = $1", [e.empleado]);
    expect((await ctx.request.get("/api/tareas")).status()).toBe(401);
  });

  test("una sesion normal (sin ser administradora) no puede suplantar aunque conozca la ruta", async ({ browser }) => {
    const e = await escenario("sup-falsa");
    const comun = await browser.newContext();
    await iniciarSesion(comun, e.empleado, { rotar: true });
    expect((await suplantar(comun, e.companero)).status()).toBe(403);
    expect((await comun.request.get("/api/admin/usuarios")).status()).toBe(403);
  });
});

test.describe("en pantalla", () => {
  test("el boton aparece para cualquier administradora, solo en personas que no administran, y lleva a ver como esa persona", async ({ browser }) => {
    const e = await escenario("sup-pantalla");
    const nombre = `empleado.${e.sufijo}`;
    // Una administradora que no es la principal: tiene el boton con una persona comun...
    const { page: otra } = await contextoCon(browser, ADMIN);
    await otra.goto(`/admin/personas?q=${encodeURIComponent(nombre)}`);
    await otra.getByRole("button", { name: `Editar a ${nombre}` }).click();
    await expect(otra.getByRole("button", { name: "Forzar cierre de sesión" })).toBeVisible();
    await expect(otra.getByRole("button", { name: "Ver como esta persona" })).toBeVisible();
    // ...y no lo tiene con otra administradora.
    await sql("UPDATE users SET is_admin = true WHERE id = $1", [e.companero]);
    const otraAdmin = `companero.${e.sufijo}`;
    await otra.goto(`/admin/personas?q=${encodeURIComponent(otraAdmin)}`);
    await otra.getByRole("button", { name: `Editar a ${otraAdmin}` }).click();
    await expect(otra.getByRole("button", { name: "Forzar cierre de sesión" })).toBeVisible();
    await expect(otra.getByRole("button", { name: "Ver como esta persona" })).toHaveCount(0);

    const { page } = await contextoPrincipal(browser);
    await page.goto(`/admin/personas?q=${encodeURIComponent(nombre)}`);
    await page.getByRole("button", { name: `Editar a ${nombre}` }).click();
    await page.getByRole("button", { name: "Ver como esta persona" }).click();
    const d = page.getByRole("dialog", { name: "Ver como esta persona" });
    await expect(d).toContainText("Lo que hagas queda registrado");
    await d.getByRole("button", { name: `Ver como ${nombre}` }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("status").filter({ hasText: nombre })).toBeVisible();
  });
});
