import { test } from "@playwright/test";
import { cookieDe, escenario, expect, soloEscritorio } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(120_000);
});

/*
 * Cabeceras de seguridad en paginas, API y la pagina 403 que pinta el proxy:
 * nadie puede enmarcar la app (clickjacking), el navegador no adivina tipos y
 * la URL completa (con ?tarea=, ?solicitud=) no se filtra a otros sitios.
 */
function comprobar(h: Record<string, string>, ruta: string) {
  expect(h["x-content-type-options"], ruta).toBe("nosniff");
  expect(h["x-frame-options"], ruta).toBe("DENY");
  expect(h["referrer-policy"], ruta).toBe("strict-origin-when-cross-origin");
  const csp = h["content-security-policy"] ?? "";
  for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"]) expect(csp, `${ruta}: ${d}`).toContain(d);
  expect(h["permissions-policy"], ruta).toContain("camera=()");
}

test("paginas, API y 403 llevan las cabeceras de seguridad", async ({ context }) => {
  const anonimo = await context.request.get("/login");
  comprobar(anonimo.headers(), "/login");

  const e = await escenario("cabeceras");
  await context.addCookies([await cookieDe(e.empleado)]);
  for (const ruta of ["/", "/api/notificaciones/contador", "/api/datos/reportes"]) {
    const r = await context.request.get(ruta, { maxRedirects: 0 });
    comprobar(r.headers(), ruta);
  }
  const prohibido = await context.request.get("/admin");
  expect(prohibido.status()).toBe(403);
  comprobar(prohibido.headers(), "/admin (403 del proxy)");
});
