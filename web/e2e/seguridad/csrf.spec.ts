import { test } from "@playwright/test";
import { cookieDe, escenario, expect, soloEscritorio } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(120_000);
});

/*
 * SameSite=lax frena el CSRF desde otro sitio, pero no desde otro subdominio
 * del mismo sitio (same-site), y cuerpo() acepta JSON aunque llegue como
 * text/plain, el tipo que un <form> puede enviar sin preflight. Las rutas que
 * cambian datos rechazan un Origin ajeno o un Sec-Fetch-Site que no sea el propio.
 */
test("una mutacion con Origin ajeno o desde otro sitio se rechaza", async ({ context }) => {
  const e = await escenario("csrf");
  const id = await e.tarea("Objetivo CSRF", e.alfa, e.empleado, e.empleado);
  await context.addCookies([await cookieDe(e.empleado)]);
  const api = context.request;

  for (const headers of [
    { Origin: "https://evil.example" },
    { Origin: "https://intranet.newlink.example" },
    { "Sec-Fetch-Site": "same-site" },
    { "Sec-Fetch-Site": "cross-site" },
  ]) {
    const r = await api.put(`/api/tareas/${id}`, { headers: { ...headers, "Content-Type": "text/plain" }, data: JSON.stringify({ title: "Cambiada" }) });
    expect(r.status(), JSON.stringify(headers)).toBe(403);
  }
  const salir = await api.post("/api/sesion/salir", { headers: { Origin: "https://evil.example" }, maxRedirects: 0 });
  expect(salir.status()).toBe(403);

  // Lo propio sigue funcionando: mismo origen, o sin cabeceras (clientes que no son navegador).
  const base = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3201");
  expect((await api.put(`/api/tareas/${id}`, { headers: { Origin: base.origin, "Sec-Fetch-Site": "same-origin" }, data: { title: "Propia" } })).status()).toBe(200);
  expect((await api.put(`/api/tareas/${id}`, { data: { title: "Sin cabeceras" } })).status()).toBe(200);
  // Las lecturas no cambian nada: un GET con Origin ajeno sigue respondiendo (CORS ya impide leerlo).
  expect((await api.get(`/api/tareas/${id}`, { headers: { Origin: "https://evil.example" } })).status()).toBe(200);
});
