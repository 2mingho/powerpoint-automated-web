import { expect, test, type Page } from "@playwright/test";
import { escenario, entrarComo, HOY, sql, sumarDias } from "../tareas/apoyo";

/* La vista de Estudios y como se ve un paso de estudio en Mis tareas. La API se prueba en estudios.spec.ts. */

async function conEstudios(prefijo: string) {
  const e = await escenario(prefijo);
  await sql("UPDATE areas SET has_studies = true WHERE id = $1", [e.alfa]);
  return e;
}
const crearPorApi = async (page: Page, e: Awaited<ReturnType<typeof escenario>>, extra: Record<string, unknown> = {}) => {
  const r = await page.request.post("/api/estudios", { data: { titulo: `Marca ${e.sufijo}`, cliente: `Cliente ${e.sufijo}`, metodo: "Cuantitativo", responsableId: e.companero, entrega: sumarDias(HOY, 45), ...extra } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: number; pasos: number };
};

test.describe("quien la ve", () => {
  test("el menu ofrece Estudios a quien trabaja en una unidad que los hace, y a nadie mas", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-menu");
    await entrarComo(context, e.empleado);
    await page.goto("/");
    await expect(page.getByRole("navigation").getByRole("link", { name: "Estudios" }).first()).toBeVisible();
    await entrarComo(context, e.ajeno); // Beta: no hace estudios y no ve ninguno
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Estudios" })).toHaveCount(0);
  });

  test("una unidad que no hace estudios no ve el boton de crear aunque llegue por la URL", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-sin");
    await entrarComo(context, e.ajeno);
    await page.goto("/estudios");
    await expect(page.getByRole("heading", { name: "Estudios", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nuevo estudio" })).toHaveCount(0);
    await expect(page.getByText("No hay estudios abiertos")).toBeVisible();
  });
});

test.describe("crear y trabajar", () => {
  test("crea un estudio desde el formulario viendo antes los pasos que saldran", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-crear");
    await entrarComo(context, e.empleado);
    await page.goto("/estudios");
    await page.getByRole("button", { name: "Nuevo estudio" }).first().click();
    const d = page.getByRole("dialog", { name: "Nuevo estudio" });
    await d.getByRole("button", { name: "Crear estudio" }).click();
    await expect(d.getByRole("alert")).toContainText("nombre");

    await d.getByLabel("Nombre del estudio").fill("Percepción de marca");
    await d.getByLabel("Cliente").fill(`Altice ${e.sufijo}`);
    await d.getByLabel("Quién lo lidera").selectOption({ label: `companero.${e.sufijo} · Alfa ${e.sufijo}` });
    await d.getByLabel("Entrega final").fill(sumarDias(HOY, 50));
    await d.getByRole("button", { name: "Mixto" }).click();
    await expect(d.getByRole("heading", { name: "Se crearán 8 pasos" })).toBeVisible();
    await d.getByRole("button", { name: "Cuantitativo" }).click();
    await expect(d.getByRole("heading", { name: "Se crearán 7 pasos" })).toBeVisible();
    await expect(d.getByRole("region", { name: "Pasos que se crearán" }).getByText("Trabajo de campo cualitativo")).toHaveCount(0);
    await expect(d.getByRole("region", { name: "Pasos que se crearán" }).getByText("Trabajo de campo cuantitativo")).toHaveCount(1);

    await d.getByRole("button", { name: "Crear estudio" }).click();
    await expect(page.getByText("Estudio creado con 7 pasos.")).toBeVisible();
    const fila = page.getByRole("button", { name: /Percepción de marca/ });
    await expect(fila).toHaveAttribute("aria-expanded", "true"); // el nuevo sale desplegado
    await expect(page.getByRole("list", { name: "Fases del estudio" })).toContainText("Propuesta");
    await expect(page.getByRole("link", { name: /Percepción de marca · Propuesta/ })).toBeVisible();
    expect(Number((await sql<{ n: string }>("SELECT count(*) n FROM tasks WHERE parent_task_id IN (SELECT id FROM tasks WHERE title = 'Percepción de marca' AND area_id = $1)", [e.alfa]))[0].n)).toBe(7);
  });

  test("la lista muestra avance, fase actual y vencidos; desplegar enseña las fases y los pasos", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-lista");
    await entrarComo(context, e.empleado);
    const { id } = await crearPorApi(page, e);
    const pasos = await sql<{ id: number }>("SELECT id FROM tasks WHERE parent_task_id = $1 ORDER BY id", [id]);
    await sql("UPDATE tasks SET status = 'Completado', done_at = now() WHERE id = $1", [pasos[0].id]);
    await sql("UPDATE tasks SET due_date = $2 WHERE id = $1", [pasos[1].id, sumarDias(HOY, -2)]);
    await page.goto("/estudios");
    const fila = page.getByRole("button", { name: new RegExp(`Marca ${e.sufijo}`) });
    await expect(fila).toHaveAttribute("aria-expanded", "false");
    const li = page.getByRole("listitem").filter({ has: fila });
    await expect(li).toContainText("Kick off"); // la fase actual: la propuesta esta hecha
    await expect(li.getByRole("img", { name: /^Avance \d+%/ })).toBeVisible();
    await expect(li.getByText("1 pasos vencidos")).toBeAttached();

    await fila.click();
    await expect(fila).toHaveAttribute("aria-expanded", "true");
    const fases = li.getByRole("list", { name: "Fases del estudio" });
    await expect(fases.getByRole("listitem").filter({ hasText: "Propuesta" })).toContainText("completa");
    await expect(fases.getByRole("listitem").filter({ hasText: "Kick off" })).toContainText("vencida");
    await expect(fases.getByRole("listitem").filter({ hasText: "Kick off" })).toHaveAttribute("aria-current", "step");
    await expect(li.getByRole("region", { name: "Campo" })).toContainText("campo cuantitativo");
  });

  test("buscar filtra la lista; Cerrados y Todos cambian lo que se ve", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-buscar");
    await entrarComo(context, e.empleado);
    await crearPorApi(page, e, { titulo: `Uno ${e.sufijo}` });
    const dos = await crearPorApi(page, e, { titulo: `Dos ${e.sufijo}`, cliente: `Otro ${e.sufijo}` });
    await sql("UPDATE tasks SET status = 'Completado', done_at = now() WHERE parent_task_id = $1", [dos.id]);
    await page.goto("/estudios");
    await expect(page.getByRole("button", { name: new RegExp(`Uno ${e.sufijo}`) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`Dos ${e.sufijo}`) })).toHaveCount(0); // cerrado: fuera de "Abiertos"
    await page.getByRole("link", { name: "Cerrados" }).click();
    await expect(page).toHaveURL(/estado=cerrados/);
    await expect(page.getByRole("button", { name: new RegExp(`Dos ${e.sufijo}`) })).toBeVisible();
    await page.getByRole("link", { name: "Todos" }).click();
    await page.getByLabel("Buscar un estudio").fill(`otro ${e.sufijo}`);
    await expect(page.getByRole("button", { name: new RegExp(`Dos ${e.sufijo}`) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`Uno ${e.sufijo}`) })).toHaveCount(0);
  });

  test("editar cambia el nombre; eliminar quita el estudio y se puede deshacer", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-editar");
    await entrarComo(context, e.empleado);
    const { id } = await crearPorApi(page, e);
    await page.goto(`/estudios?estudio=${id}`);
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const d = page.getByRole("dialog", { name: "Editar estudio" });
    await d.getByLabel("Nombre del estudio").fill("Nombre nuevo");
    await d.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Estudio actualizado.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Nombre nuevo/ })).toBeVisible();

    await page.getByRole("button", { name: "Eliminar estudio" }).first().click();
    await page.getByRole("dialog", { name: "Eliminar estudio" }).getByRole("button", { name: "Eliminar estudio" }).click();
    await expect(page.getByText(/eliminado con sus \d+ pasos/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Nombre nuevo/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Deshacer" }).click();
    await expect(page.getByText("Borrado deshecho.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Nombre nuevo/ })).toBeVisible();
  });

  test("quien puede registrar contratos ve el aviso si el estudio no tiene contrato", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-contrato");
    await sql("INSERT INTO finance_grants (user_id, area_id, kind, created_at) VALUES ($1, $2, 'contracts', now())", [e.empleado, e.alfa]);
    await entrarComo(context, e.empleado);
    const { id } = await crearPorApi(page, e);
    await page.goto(`/estudios?estudio=${id}`);
    await expect(page.getByText(`Sin contrato registrado para este cliente en Alfa ${e.sufijo}`)).toBeVisible();
    await entrarComo(context, e.companero); // no ve los ingresos de la unidad: ni el aviso ni el monto
    await page.goto(`/estudios?estudio=${id}`);
    await expect(page.getByRole("button", { name: new RegExp(`Marca ${e.sufijo}`) })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Sin contrato")).toHaveCount(0);
  });
});

test.describe("un paso en Mis tareas", () => {
  test("la fila dice de que estudio y fase es, y el pase enseña donde va el estudio", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-pase");
    await entrarComo(context, e.empleado);
    const { id } = await crearPorApi(page, e, { responsableId: e.empleado });
    const [p0] = await sql<{ id: number }>("SELECT id FROM tasks WHERE parent_task_id = $1 ORDER BY id LIMIT 1", [id]);
    await page.goto(`/tareas?tarea=${p0.id}`);
    await expect(page.getByText(`Estudio: Marca ${e.sufijo} · Propuesta`).first()).toBeVisible();
    const seccion = page.getByRole("region", { name: "Estudio", exact: true });
    await expect(seccion).toContainText(`Marca ${e.sufijo}`);
    await expect(seccion.getByRole("list", { name: "Fases del estudio" })).toContainText("Informe");
    await expect(seccion.getByRole("link", { name: `Marca ${e.sufijo}` })).toHaveAttribute("href", `/estudios?estudio=${id}`);
    await seccion.getByText(/Ver los \d+ pasos/).click();
    await expect(seccion.getByRole("link", { name: new RegExp(`Marca ${e.sufijo} · Propuesta`) })).toHaveAttribute("aria-current", "true");
  });

  test("una tarea normal no muestra nada de estudios", async ({ context, page }, info) => {
    test.skip(info.project.name !== "escritorio", "Una vez, en escritorio.");
    const e = await conEstudios("estp-normal");
    const t = await e.tarea("Tarea suelta", e.alfa, e.empleado, e.empleado);
    await entrarComo(context, e.empleado);
    await page.goto(`/tareas?tarea=${t}`);
    await expect(page.getByRole("article", { name: "Tarea: Tarea suelta" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Estudio", exact: true })).toHaveCount(0);
  });
});
