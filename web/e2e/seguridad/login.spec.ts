import { test } from "@playwright/test";
import { contextoAnonimo, cuentaNueva, expect, rellenarLogin, soloEscritorio, sql } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(120_000);
});

/*
 * El destino del login es una ruta propia. "/\evil.com" empieza por "/" y no
 * por "//", pero el navegador lo lee como "//evil.com": era una redireccion
 * abierta tras un login real, perfecta para phishing.
 */
for (const destino of ["/\\evil.example", "/\\/evil.example/", "https://evil.example/"]) {
  test(`el destino ${JSON.stringify(destino)} no saca de la aplicacion`, async ({ browser }) => {
    const { ctx, page } = await contextoAnonimo(browser);
    const fuera: string[] = [];
    await ctx.route((u) => u.hostname.endsWith("evil.example"), (r) => { fuera.push(r.request().url()); return r.abort(); });
    const { email } = await cuentaNueva("destino");
    await page.goto(`/login?destino=${encodeURIComponent(destino)}`);
    await rellenarLogin(page, email);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    expect(fuera, "intento de salir a otro origen").toEqual([]);
    expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL ?? page.url()).host);
    await ctx.close();
  });
}

/*
 * La primera entrada de x-forwarded-for la escribe el cliente: el registro de
 * actividad la guardaba como IP, asi que cualquiera firmaba sus acciones con la
 * IP que quisiera. Vale la ultima, la que añade el proxy de confianza (la misma
 * que ya usaba el limite de intentos).
 */
test("el registro de actividad guarda la IP que añade el proxy, no la que inventa el cliente", async ({ browser }) => {
  const { email, empleado } = await cuentaNueva("ip");
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "6.6.6.6, 10.200.0.7" } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await rellenarLogin(page, email);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  const filas = await sql<{ ip_address: string }>("SELECT ip_address FROM activity_logs WHERE user_id = $1 AND action = 'login'", [empleado]);
  expect(filas.map((f) => f.ip_address)).toEqual(["10.200.0.7"]);
  await ctx.close();
});

/*
 * La cookie caduca en el navegador a las 12 h, pero el sello de iron-session
 * llevaba la caducidad por defecto (14 dias): una cookie copiada seguia
 * valiendo dos semanas si nadie volvia a entrar con esa cuenta.
 */
test("el sello de la sesion caduca a las 12 horas, como la cookie", async ({ browser }) => {
  const { email } = await cuentaNueva("ttl");
  const { ctx, page } = await contextoAnonimo(browser);
  await page.goto("/login");
  await rellenarLogin(page, email);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  const cookie = (await ctx.cookies()).find((c) => c.name === "nl_sesion")!;
  const caducaSello = Number(cookie.value.split("*")[5]);
  const doceHoras = 12 * 3600_000;
  expect(caducaSello - Date.now()).toBeLessThanOrEqual(doceHoras + 60_000);
  expect(caducaSello - Date.now()).toBeGreaterThan(doceHoras - 10 * 60_000);
  await ctx.close();
});

test("un destino propio se respeta", async ({ browser }) => {
  const { ctx, page } = await contextoAnonimo(browser);
  const { email } = await cuentaNueva("destino");
  await page.goto(`/login?destino=${encodeURIComponent("/solicitudes?bandeja=enviadas")}`);
  await rellenarLogin(page, email);
  await expect(page).toHaveURL(/\/solicitudes\?bandeja=enviadas/, { timeout: 60_000 });
  await ctx.close();
});
