import { expect, test } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sql, sumarDias } from "./apoyo";

/* Lo que Flask ofrecia y faltaba en la app nueva: borrar un dia, ver lo que se observa y los clientes para autocompletar. */

const DIA = "2031-03-10";
const vivas = (e: Awaited<ReturnType<typeof escenario>>, dia: string) => sql<{ id: number; title: string }>("SELECT id, title FROM tasks WHERE due_date = $1 AND deleted_at IS NULL AND area_id = ANY($2) ORDER BY id", [dia, [e.alfa, e.beta]]);

test.describe("borrar las tareas de un dia", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "contrato de API: una pasada basta"); });

  test("borra lo del dia dentro de su ambito, no lo de otro dia ni lo de otra unidad, y lo deja en la actividad", async ({ context }) => {
    const e = await escenario("hue-dia");
    const a = await e.tarea("Del dia 1", e.alfa, e.empleado, e.empleado, "Pendiente", DIA);
    const b = await e.tarea("Del dia 2", e.alfa, e.empleado, e.companero, "Completado", DIA); // las cerradas tambien: como en Flask
    await e.tarea("Otro dia", e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(DIA, 1));
    const ajena = await e.tarea("Otra unidad", e.beta, e.ajeno, e.ajeno, "Pendiente", DIA);
    await entrarComo(context, e.empleado);

    const r = await context.request.delete(`${BASE}/api/tareas/dia/${DIA}`);
    expect(r.status(), await r.text()).toBe(200);
    const cuerpo = (await r.json()) as { borradas: number; fecha: string; marca: string };
    expect(cuerpo).toMatchObject({ borradas: 2, fecha: DIA });
    expect((await vivas(e, DIA)).map((t) => t.id)).toEqual([ajena]);
    expect((await vivas(e, sumarDias(DIA, 1))).length).toBe(1);
    const borradas = await sql<{ id: number; deleted_by_id: number }>("SELECT id, deleted_by_id FROM tasks WHERE id = ANY($1) AND deleted_at IS NOT NULL", [[a, b]]);
    expect(borradas.map((t) => t.deleted_by_id)).toEqual([e.empleado, e.empleado]);
    const [log] = await sql<{ detail: string }>("SELECT detail FROM activity_logs WHERE action = 'task_delete_day' AND user_id = $1 ORDER BY id DESC LIMIT 1", [e.empleado]);
    expect(log.detail).toContain(`${DIA}: 2`);
  });

  test("deshacer devuelve solo lo que ese borrado quito; otra persona no lo puede deshacer", async ({ context }) => {
    const e = await escenario("hue-deshacer");
    const antes = await e.tarea("Borrada antes", e.alfa, e.empleado, e.empleado, "Pendiente", DIA);
    await sql("UPDATE tasks SET deleted_at = now() - interval '2 days', deleted_by_id = $2 WHERE id = $1", [antes, e.empleado]); // ya estaba borrada
    const viva = await e.tarea("Viva", e.alfa, e.empleado, e.empleado, "Pendiente", DIA);
    await entrarComo(context, e.empleado);
    const { marca } = (await (await context.request.delete(`${BASE}/api/tareas/dia/${DIA}`)).json()) as { marca: string };

    await entrarComo(context, e.companero);
    const ajeno = await context.request.post(`${BASE}/api/tareas/dia/${DIA}/restaurar`, { data: { marca } });
    expect((await ajeno.json()).restauradas).toBe(0);
    expect((await vivas(e, DIA)).length).toBe(0);

    await entrarComo(context, e.empleado);
    const r = await context.request.post(`${BASE}/api/tareas/dia/${DIA}/restaurar`, { data: { marca } });
    expect((await r.json()).restauradas).toBe(1);
    expect((await vivas(e, DIA)).map((t) => t.id)).toEqual([viva]); // la que ya estaba borrada antes sigue borrada
    for (const mala of [{}, { marca: "ayer" }, { marca: 5 }]) {
      expect((await context.request.post(`${BASE}/api/tareas/dia/${DIA}/restaurar`, { data: mala })).status()).toBe(400);
    }
  });

  test("un dia sin tareas no borra nada; fechas invalidas y sin sesion", async ({ context, request }) => {
    const e = await escenario("hue-vacio");
    await entrarComo(context, e.empleado);
    expect((await (await context.request.delete(`${BASE}/api/tareas/dia/2031-03-11`)).json()).borradas).toBe(0);
    for (const mala of ["2031-02-31", "abc", "2031-3-5", "2031-13-01", "10-03-2031"]) {
      expect((await context.request.delete(`${BASE}/api/tareas/dia/${mala}`)).status(), mala).toBe(400);
    }
    expect((await request.delete(`${BASE}/api/tareas/dia/${DIA}`)).status()).toBe(401);
  });

  test("sin la herramienta de tareas es 403", async ({ context }) => {
    const e = await escenario("hue-sin");
    await sql("UPDATE users SET allowed_tools = '[\"reports\"]' WHERE id = $1", [e.empleado]);
    await entrarComo(context, e.empleado);
    expect((await context.request.delete(`${BASE}/api/tareas/dia/${DIA}`)).status()).toBe(403);
  });

  test("en el calendario: se confirma con el numero, se borra y se puede deshacer", async ({ context, page }) => {
    const e = await escenario("hue-cal");
    // El dia 15 del mes en curso (siempre dentro de la rejilla del calendario).
    const dia = `${HOY.slice(0, 8)}15`;
    await e.tarea("Calendario uno", e.alfa, e.empleado, e.empleado, "Pendiente", dia);
    await e.tarea("Calendario dos", e.alfa, e.empleado, e.empleado, "Pendiente", dia);
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas?vista=calendario&alcance=unidad`);
    await page.getByRole("button", { name: /Borrar las 2 tareas del/ }).first().click({ force: true });
    const d = page.getByRole("dialog", { name: "Borrar las tareas del día" });
    await expect(d).toContainText("2");
    await d.getByRole("button", { name: "Borrar 2 tareas" }).click();
    await expect(page.getByText(/Se borraron 2 tareas del/)).toBeVisible();
    expect((await vivas(e, dia)).length).toBe(0);
    await page.getByRole("button", { name: "Deshacer" }).click();
    await expect(page.getByText("Borrado deshecho.")).toBeVisible();
    await expect.poll(async () => (await vivas(e, dia)).length).toBe(2);
  });
});

test.describe("lo que observo", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "escritorio", "contrato de API: una pasada basta"); });

  test("«Observo» trae lo que observo, tambien lo compartido de otra unidad, y nada de lo que no", async ({ context, page }) => {
    const e = await escenario("hue-obs");
    const propia = await e.tarea("Propia observada", e.alfa, e.empleado, e.companero);
    await e.tarea("Propia sin observar", e.alfa, e.empleado, e.companero);
    const ajena = await e.tarea("Compartida de Beta", e.beta, e.ajeno, e.ajeno);
    const privada = await e.tarea("Privada de Beta", e.beta, e.ajeno, e.ajeno);
    await sql("UPDATE tasks SET visibility = 'shared' WHERE id = $1", [ajena]);
    for (const id of [propia, ajena, privada]) await sql("INSERT INTO task_watchers (task_id, user_id, added_by_id, created_at) VALUES ($1, $2, $2, now())", [id, e.empleado]);
    await entrarComo(context, e.empleado);

    const l = (await (await context.request.get(`${BASE}/api/tareas?alcance=observadas`)).json()) as { tareas: { id: number }[] };
    // La privada de otra unidad no se ve aunque figure como observada: no es suya ni esta compartida.
    expect(l.tareas.map((t) => t.id).sort()).toEqual([propia, ajena].sort());
    expect(JSON.stringify(l)).not.toContain("Privada de Beta");
    const cont = await context.request.get(`${BASE}/api/tareas/contadores?alcance=observadas`);
    expect(cont.status()).toBe(200);

    await page.goto(`${BASE}/tareas`);
    await page.getByRole("radio", { name: "Observo" }).click();
    await expect(page.getByText("Compartida de Beta").first()).toBeVisible();
    await expect(page.getByText("Propia sin observar")).toHaveCount(0);
  });

  test("la lista de clientes para autocompletar es la de las tareas que se ven", async ({ context }) => {
    const e = await escenario("hue-cli");
    await e.tarea("Con cliente", e.alfa, e.empleado, e.empleado);
    await e.tarea("De otra unidad", e.beta, e.ajeno, e.ajeno);
    await sql("UPDATE tasks SET client = $2 WHERE area_id = $1", [e.beta, `Secreto ${e.sufijo}`]);
    await entrarComo(context, e.empleado);
    const r = await context.request.get(`${BASE}/api/tareas/clientes`);
    expect(r.status()).toBe(200);
    const { clientes } = (await r.json()) as { clientes: string[] };
    expect(clientes).toContain("Cliente E2E");
    expect(clientes).not.toContain(`Secreto ${e.sufijo}`);
  });
});
