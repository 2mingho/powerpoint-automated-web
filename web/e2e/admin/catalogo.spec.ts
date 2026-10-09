import { expect, test } from "@playwright/test";
import { ADMIN_2 as ADMIN, bd, contextoCon, idDe } from "./ayuda";

/* Catalogo de estados: renombrar arrastra las tareas y no se puede quedar sin final ni sin inicial. */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "escritorio", "contrato de API: una pasada basta");
  test.setTimeout(120_000); // el servidor de desarrollo compila cada ruta la primera vez
});

test("renombrar un estado reescribe las tareas que lo usan", async ({ browser }) => {
  const { page } = await contextoCon(browser, ADMIN);
  const sufijo = Date.now() % 100000;
  const nombre = `E2E ${sufijo}`;
  const creado = await page.request.post("/api/admin/catalogo/estados", { data: { nombre, color: "info" } });
  expect(creado.status()).toBe(201);
  const { id } = await creado.json();

  const yo = await idDe(ADMIN);
  const tareas = await bd<{ id: number }>(
    `insert into tasks (title, due_date, status, area, creator_id, assignee_id, priority, visibility, created_at, updated_at)
     values ('E2E renombrar 1', current_date, $1, 'DI', $2, $2, 'Media', 'unit', now(), now()),
            ('E2E renombrar 2', current_date, $1, 'DI', $2, $2, 'Media', 'unit', now(), now()) returning id`, [nombre, yo]);
  const ids = tareas.map((t) => t.id);

  try {
    // La pantalla avisa del impacto antes de guardar.
    await page.goto("/admin/catalogo");
    await page.getByRole("button", { name: `Editar ${nombre}` }).click();
    const campo = page.getByRole("textbox", { name: "Nombre" });
    await campo.fill(`${nombre} bis`);
    await expect(page.getByText("Renombrar afecta a")).toContainText("2");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/Se renombraron 2 tarea/)).toBeVisible();

    const despues = await bd<{ status: string }>("select status from tasks where id = any($1)", [ids]);
    expect(despues.map((t) => t.status)).toEqual([`${nombre} bis`, `${nombre} bis`]);
    expect((await bd("select 1 from task_statuses where nombre = $1", [nombre])).length).toBe(0);
    const log = await bd<{ detail: string }>("select detail from activity_logs where action = 'task_status_edit' order by id desc limit 1");
    expect(log[0].detail).toContain("Se renombraron 2");

    // Con tareas en uso no se puede borrar.
    expect((await page.request.delete(`/api/admin/catalogo/estados/${id}`)).status()).toBe(409);
  } finally {
    await bd("delete from tasks where id = any($1)", [ids]);
    await page.request.delete(`/api/admin/catalogo/estados/${id}`);
  }
});

test("no se puede dejar el catalogo sin estado final ni sin estado inicial", async ({ browser }) => {
  const { page } = await contextoCon(browser, ADMIN);
  const finales = await bd<{ id: number }>("select id from task_statuses where es_final");
  const inicial = (await bd<{ id: number }>("select id from task_statuses where es_inicial"))[0];
  expect(finales.length).toBe(1);

  const r1 = await page.request.patch(`/api/admin/catalogo/estados/${finales[0].id}`, { data: { esFinal: false } });
  expect(r1.status()).toBe(409);
  expect((await r1.json()).error).toContain("al menos un estado");
  expect((await bd<{ es_final: boolean }>("select es_final from task_statuses where id = $1", [finales[0].id]))[0].es_final).toBe(true);

  const r2 = await page.request.patch(`/api/admin/catalogo/estados/${inicial.id}`, { data: { esInicial: false } });
  expect(r2.status()).toBe(409);
  expect((await bd<{ n: string }>("select count(*) n from task_statuses where es_inicial"))[0].n).toBe("1");

  // Ni borrandolos.
  expect((await page.request.delete(`/api/admin/catalogo/estados/${inicial.id}`)).status()).toBe(409);
  expect((await page.request.delete(`/api/admin/catalogo/estados/${finales[0].id}`)).status()).toBe(409);

  // Marcar otro como inicial apaga el anterior: siempre uno solo.
  const otro = (await bd<{ id: number }>("select id from task_statuses where not es_inicial and not es_final order by orden limit 1"))[0];
  expect((await page.request.patch(`/api/admin/catalogo/estados/${otro.id}`, { data: { esInicial: true } })).status()).toBe(200);
  expect((await bd<{ id: number }>("select id from task_statuses where es_inicial")).map((x) => x.id)).toEqual([otro.id]);
  await page.request.patch(`/api/admin/catalogo/estados/${inicial.id}`, { data: { esInicial: true } });
  expect((await bd<{ id: number }>("select id from task_statuses where es_inicial")).map((x) => x.id)).toEqual([inicial.id]);
});

test("una prioridad no puede pasar de 10 caracteres (tasks.priority es VARCHAR(10))", async ({ browser }) => {
  const { page } = await contextoCon(browser, ADMIN);
  const r = await page.request.post("/api/admin/catalogo/prioridades", { data: { nombre: "Muy urgentísima" } });
  expect(r.status()).toBe(201);
  const { id } = await r.json();
  const fila = (await bd<{ nombre: string }>("select nombre from task_priorities where id = $1", [id]))[0];
  expect(fila.nombre.length).toBeLessThanOrEqual(10);
  await page.request.delete(`/api/admin/catalogo/prioridades/${id}`);
});
