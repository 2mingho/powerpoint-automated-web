import { expect, test } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sql } from "./apoyo";

/* La interfaz: completar en un clic y deshacer, alta rápida y pase. */

test("completar una tarea desde la fila y deshacerlo", async ({ page, context }) => {
  const e = await escenario("ui");
  const titulo = `Completar desde la fila ${e.sufijo}`;
  const id = await e.tarea(titulo, e.alfa, e.empleado, e.empleado, "Pendiente", HOY);
  await entrarComo(context, e.empleado);
  await page.goto(`${BASE}/tareas`);

  const fila = page.locator(`li[data-tarea="${id}"]`);
  await expect(fila).toBeVisible();
  await expect(fila.getByText("Pendiente", { exact: true })).toBeVisible();

  await fila.getByRole("button", { name: `Completar «${titulo}»` }).click();
  // La fila no desaparece: pasa a Completadas y su estado queda encendido.
  await expect(fila.getByText("Completado", { exact: true })).toBeVisible();
  await expect.poll(async () => (await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [id]))[0].status).toBe("Completado");

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(async () => (await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [id]))[0].status).toBe("Pendiente");
  await expect(fila.getByText("Pendiente", { exact: true })).toBeVisible();
});

test("alta rápida con @persona, mañana y !alta", async ({ page, context }, info) => {
  test.skip(info.project.name !== "escritorio", "Una vez basta.");
  const e = await escenario("alta");
  await entrarComo(context, e.empleado);
  await page.goto(`${BASE}/tareas`);
  const entrada = page.getByLabel("Alta rápida de tarea");
  await entrada.fill(`Preparar informe ${e.sufijo} @companero.${e.sufijo} mañana !alta`);
  await expect(page.getByText(/Se creará «Preparar informe/)).toBeVisible();
  await entrada.press("Enter");
  await expect.poll(async () => (await sql<{ assignee_id: number; priority: string }>("SELECT assignee_id, priority FROM tasks WHERE title = $1", [`Preparar informe ${e.sufijo}`]))[0])
    .toEqual({ assignee_id: e.companero, priority: "Alta" });
});

test("el pase muestra las celdas de la tarea y cambia el estado", async ({ page, context }, info) => {
  test.skip(info.project.name !== "escritorio", "Una vez basta.");
  const e = await escenario("pase");
  const titulo = `Con pase ${e.sufijo}`;
  const id = await e.tarea(titulo, e.alfa, e.empleado, e.empleado);
  await entrarComo(context, e.empleado);
  await page.goto(`${BASE}/tareas?tarea=${id}`);
  const pase = page.getByRole("article", { name: `Tarea: ${titulo}` });
  for (const rotulo of ["Entrega", "Prioridad", "Unidad", "Responsable"]) await expect(pase.getByText(rotulo, { exact: true })).toBeVisible();
  await pase.getByRole("radio", { name: "En Revisión" }).click();
  await expect.poll(async () => (await sql<{ status: string }>("SELECT status FROM tasks WHERE id = $1", [id]))[0].status).toBe("En Revisión");
});
