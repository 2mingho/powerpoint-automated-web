import { test } from "@playwright/test";
import { BASE, cookieDe, escenario, expect, soloEscritorio } from "./apoyo";

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
