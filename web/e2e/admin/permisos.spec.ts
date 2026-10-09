import { expect, test } from "@playwright/test";
import { ADMIN, ANALISTA, bd, contextoCon, idDe } from "./ayuda";

/* Una cuenta propia para la expulsion: si fuera analista, las pruebas en paralelo perderian su sesion. */
const VICTIMA = "rosa@equipo.test";

/*
 * Solo administracion entra a /admin y a /api/admin/*. Cada ruta, con cada
 * metodo, responde 403 a quien no es admin, y ninguna respuesta lleva api_key.
 * Corren solo en el proyecto de escritorio: son pruebas de contrato, no de pantalla.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000); // el servidor de desarrollo compila cada ruta la primera vez
});

const RUTAS_API: [string, string][] = [
  ["GET", "/api/admin/resumen"], ["GET", "/api/admin/usuarios"], ["POST", "/api/admin/usuarios"], ["PATCH", "/api/admin/usuarios/1"],
  ["POST", "/api/admin/usuarios/1/activo"], ["POST", "/api/admin/usuarios/1/expulsar"], ["GET", "/api/admin/roles"], ["POST", "/api/admin/roles"],
  ["PATCH", "/api/admin/roles/1"], ["DELETE", "/api/admin/roles/1"], ["GET", "/api/admin/unidades"], ["POST", "/api/admin/unidades"],
  ["PATCH", "/api/admin/unidades/1"], ["DELETE", "/api/admin/unidades/1"], ["GET", "/api/admin/organizacion"], ["POST", "/api/admin/organizacion/lideres"],
  ["DELETE", "/api/admin/organizacion/lideres"], ["POST", "/api/admin/organizacion/superior"], ["GET", "/api/admin/catalogo"],
  ["POST", "/api/admin/catalogo/estados"], ["PATCH", "/api/admin/catalogo/estados/1"], ["DELETE", "/api/admin/catalogo/estados/1"],
  ["POST", "/api/admin/catalogo/estados/orden"], ["POST", "/api/admin/catalogo/prioridades"], ["PATCH", "/api/admin/catalogo/prioridades/1"],
  ["DELETE", "/api/admin/catalogo/prioridades/1"], ["POST", "/api/admin/catalogo/prioridades/orden"], ["GET", "/api/admin/plantillas"],
  ["POST", "/api/admin/plantillas"], ["GET", "/api/admin/plantillas/1"], ["DELETE", "/api/admin/plantillas/1"], ["GET", "/api/admin/ia"],
  ["POST", "/api/admin/ia"], ["PATCH", "/api/admin/ia/1"], ["DELETE", "/api/admin/ia/1"], ["POST", "/api/admin/ia/1/activar"],
  ["POST", "/api/admin/ia/1/desactivar"], ["POST", "/api/admin/ia/1/probar"], ["GET", "/api/admin/actividad"], ["POST", "/api/admin/tareas/lote"],
  ["POST", "/api/admin/tareas/borrar"], ["POST", "/api/admin/tareas/restaurar"],
];
const PAGINAS = ["/admin", "/admin/personas", "/admin/organizacion", "/admin/catalogo", "/admin/plantillas", "/admin/ia", "/admin/actividad"];

test("un no admin recibe 403 en cada ruta de la API de administracion", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page } = await contextoCon(browser, ANALISTA);
  for (const [metodo, ruta] of RUTAS_API) {
    const r = await page.request.fetch(ruta, { method: metodo, data: metodo === "GET" ? undefined : {} });
    expect(r.status(), `${metodo} ${ruta}`).toBe(403);
    expect(await r.json()).toEqual({ error: "Sin permisos." });
  }
});

test("sin sesion la API de administracion responde 401", async ({ request }) => {
  const r = await request.get("/api/admin/usuarios");
  expect(r.status()).toBe(401);
});

test("un no admin ve 'Sin permisos' en cada pagina de administracion, sin datos", async ({ browser }) => {
  const { page } = await contextoCon(browser, ANALISTA);
  for (const ruta of PAGINAS) {
    const r = await page.goto(ruta);
    expect(r?.status(), ruta).toBe(403);
    await expect(page.getByRole("heading", { name: "Sin permisos" }), ruta).toBeVisible();
    const html = await page.content();
    expect(html).toContain('name="robots" content="noindex"');
    for (const dato of ["laura@equipo.test", "Groq producción", "SECRETO", "Reporte_plantilla"]) expect(html, `${ruta} filtra ${dato}`).not.toContain(dato);
  }
});

test("api_key nunca aparece en ninguna respuesta de administracion", async ({ browser }) => {
  const { page } = await contextoCon(browser, ADMIN);
  const claves = (await bd<{ api_key: string }>("select api_key from ai_providers")).map((x) => x.api_key);
  expect(claves.length).toBeGreaterThan(0);

  // Alta y edicion de una conexion con una clave reconocible.
  const nueva = "sk-e2e-CLAVE-QUE-NO-DEBE-SALIR-1234";
  const alta = await page.request.post("/api/admin/ia", { data: { nombre: `E2E ${Date.now()}`, proveedor: "openai", modelo: "gpt-e2e", clave: nueva } });
  expect(alta.status()).toBe(201);
  const altaTexto = await alta.text();
  const { id } = JSON.parse(altaTexto);
  const edicion = await page.request.patch(`/api/admin/ia/${id}`, { data: { nombre: `E2E editada ${id}`, proveedor: "openai", modelo: "gpt-e2e", clave: "" } });
  const respuestas = [altaTexto, await edicion.text()];

  for (const ruta of ["/api/admin/ia", "/api/admin/resumen", "/api/admin/actividad", "/api/admin/usuarios", "/api/admin/organizacion", "/api/admin/roles"]) {
    respuestas.push(await (await page.request.get(ruta)).text());
  }
  for (const ruta of ["/admin", "/admin/ia", "/admin/actividad"]) {
    await page.goto(ruta);
    await page.locator("h1").first().waitFor();
    respuestas.push(await page.content());
  }
  const todo = respuestas.join("\n");
  for (const k of [...claves, nueva]) expect(todo).not.toContain(k);
  expect(todo).not.toContain("api_key");
  expect(todo).toContain("••••1234"); // la mascara si sale

  // La clave vacia al editar conserva la anterior.
  expect((await bd<{ api_key: string }>("select api_key from ai_providers where id = $1", [id]))[0].api_key).toBe(nueva);
  await page.request.delete(`/api/admin/ia/${id}`);
});

test("forzar cierre de sesion expulsa al usuario en su siguiente peticion", async ({ browser }) => {
  const victima = await contextoCon(browser, VICTIMA);
  const admin = await contextoCon(browser, ADMIN);
  const id = await idDe(VICTIMA);
  const antes = (await bd<{ session_token: string }>("select session_token from users where id = $1", [id]))[0].session_token;

  // Antes: tiene sesion (403 por permisos, no 401 por sesion).
  expect((await victima.page.request.get("/api/admin/resumen")).status()).toBe(403);

  const r = await admin.page.request.post(`/api/admin/usuarios/${id}/expulsar`, { data: {} });
  expect(r.status()).toBe(200);
  const fila = (await bd<{ session_token: string; force_logout: boolean }>("select session_token, force_logout from users where id = $1", [id]))[0];
  expect(fila.force_logout).toBe(true);
  expect(fila.session_token).not.toBe(antes);

  // Siguiente peticion: sin sesion, en la API y en las paginas.
  expect((await victima.page.request.get("/api/admin/resumen")).status()).toBe(401);
  await victima.page.goto("/");
  await expect(victima.page).toHaveURL(/\/login/);

  // Queda registrado y el siguiente inicio de sesion limpia la marca.
  const log = await bd("select 1 from activity_logs where action = 'user_kick' and entity_id = $1", [id]);
  expect(log.length).toBeGreaterThan(0);
  const otra = await contextoCon(browser, VICTIMA);
  expect((await otra.page.request.get("/api/admin/resumen")).status()).toBe(403);
  expect((await bd<{ force_logout: boolean }>("select force_logout from users where id = $1", [id]))[0].force_logout).toBe(false);
});

test("un admin no puede expulsarse ni desactivarse a si mismo, ni quitarse el rol", async ({ browser }) => {
  const { page } = await contextoCon(browser, ADMIN);
  const yo = await idDe(ADMIN);
  expect((await page.request.post(`/api/admin/usuarios/${yo}/expulsar`, { data: {} })).status()).toBe(400);
  expect((await page.request.post(`/api/admin/usuarios/${yo}/activo`, { data: { activo: false } })).status()).toBe(400);
  expect((await page.request.patch(`/api/admin/usuarios/${yo}`, { data: { rol: "DI" } })).status()).toBe(400);
});
