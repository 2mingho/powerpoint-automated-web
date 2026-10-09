import { test } from "@playwright/test";
import { contextoAnonimo, cuentaNueva, expect, rellenarLogin, soloEscritorio } from "./apoyo";

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

test("un destino propio se respeta", async ({ browser }) => {
  const { ctx, page } = await contextoAnonimo(browser);
  const { email } = await cuentaNueva("destino");
  await page.goto(`/login?destino=${encodeURIComponent("/solicitudes?bandeja=enviadas")}`);
  await rellenarLogin(page, email);
  await expect(page).toHaveURL(/\/solicitudes\?bandeja=enviadas/, { timeout: 60_000 });
  await ctx.close();
});
