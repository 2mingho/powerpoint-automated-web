import { test } from "@playwright/test";
import { BASE, cookieDe, escenario, expect, soloEscritorio, sql } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(120_000);
});

/* Un GET con efectos se dispara desde cualquier pagina ajena (img, enlace): no debe cerrar la sesion. */
test("un GET a salir no cierra la sesion", async ({ context }) => {
  const e = await escenario("salir-get");
  await context.addCookies([await cookieDe(e.empleado)]);
  const r = await context.request.get("/api/sesion/salir", { maxRedirects: 0 });
  expect(r.status()).toBe(405);
  expect((await context.request.get("/api/notificaciones/contador")).status()).toBe(200);
});

/* La cookie sellada no tiene estado: tras salir, una copia de ella no puede seguir valiendo. */
test("tras salir, una copia de la cookie deja de valer", async ({ playwright }) => {
  const e = await escenario("salir-post");
  const cookie = await cookieDe(e.empleado);
  const api = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Cookie: `nl_sesion=${cookie.value}` } });
  expect((await api.get("/api/notificaciones/contador")).status()).toBe(200);
  const r = await api.post("/api/sesion/salir", { maxRedirects: 0 });
  expect(r.status()).toBe(303);
  expect(r.headers()["location"]).toMatch(/\/login$/);
  // La misma cookie, reenviada a mano: el servidor ya no la reconoce.
  const copia = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Cookie: `nl_sesion=${cookie.value}` } });
  expect((await copia.get("/api/notificaciones/contador")).status()).toBe(401);
  await api.dispose();
  await copia.dispose();
});

test("el boton Salir cierra la sesion", async ({ context, page }) => {
  const e = await escenario("salir-ui");
  await context.addCookies([await cookieDe(e.empleado)]);
  await page.goto("/");
  await page.getByRole("button", { name: "Cerrar sesión" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  expect((await context.request.get("/api/notificaciones/contador")).status()).toBe(401);
});

/* Si un admin cambia la contrasena de alguien (cuenta robada), las sesiones abiertas de esa persona caen. */
test("cambiar la contrasena desde administracion cierra las sesiones de esa persona", async ({ playwright }) => {
  const e = await escenario("clave-admin");
  const victima = await cookieDe(e.empleado);
  const admin = await cookieDe((await sql<{ id: number }>("SELECT id FROM users WHERE email = 'demo@local.test'"))[0].id);
  const con = (valor: string) => playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Cookie: `nl_sesion=${valor}` } });
  const comoVictima = await con(victima.value);
  const comoAdmin = await con(admin.value);
  expect((await comoVictima.get("/api/notificaciones/contador")).status()).toBe(200);
  const r = await comoAdmin.patch(`/api/admin/usuarios/${e.empleado}`, { data: { contrasena: "otra-clave-segura" } });
  expect(r.status()).toBe(200);
  expect((await comoVictima.get("/api/notificaciones/contador")).status()).toBe(401);
  // Cambiar otra cosa (el nombre) no echa a nadie.
  const comoOtra = await con((await cookieDe(e.companero)).value);
  expect((await comoAdmin.patch(`/api/admin/usuarios/${e.companero}`, { data: { nombre: `renombrado ${e.sufijo}` } })).status()).toBe(200);
  expect((await comoOtra.get("/api/notificaciones/contador")).status()).toBe(200);
  for (const c of [comoVictima, comoAdmin, comoOtra]) await c.dispose();
});
