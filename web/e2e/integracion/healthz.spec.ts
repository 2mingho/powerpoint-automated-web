import { expect, test } from "@playwright/test";
import { BASE } from "../tareas/apoyo";

/* /healthz: la sonda del orquestador. Sin sesion, sin redirecciones y sin detalles internos. */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
});

test("responde 200 sin sesion y dice que la base responde y el esquema es el esperado", async ({ request }) => {
  const r = await request.get(`${BASE}/healthz`, { maxRedirects: 0 });
  expect(r.status()).toBe(200);
  const cuerpo = (await r.json()) as { status: string; database: string; schema?: string };
  expect(cuerpo.status).toBe("ok");
  expect(["reachable", "idle"]).toContain(cuerpo.database);
  if (cuerpo.database === "reachable") expect(cuerpo.schema).toBe("ok");
});

test("no se cachea, lleva las cabeceras de seguridad y no cuenta secretos ni versiones", async ({ request }) => {
  const r = await request.get(`${BASE}/healthz`);
  expect(r.headers()["cache-control"]).toContain("no-store");
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  const texto = await r.text();
  expect(Object.keys(JSON.parse(texto)).sort()).toEqual(expect.arrayContaining(["database", "status"]));
  for (const prohibido of ["postgresql", "newlink_", "version", "0018", "password", "error:"]) expect(texto.toLowerCase()).not.toContain(prohibido);
});

test("solo se consulta con GET y nada mas del sitio queda abierto por estar junto", async ({ request }) => {
  expect((await request.post(`${BASE}/healthz`, { data: {} })).status()).toBe(405);
  // Lo demas sigue pidiendo sesion.
  expect((await request.get(`${BASE}/api/tareas`)).status()).toBe(401);
  const r = await request.get(`${BASE}/tareas`, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(r.status());
});
