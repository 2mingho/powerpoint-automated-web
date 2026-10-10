import { expect, test } from "@playwright/test";
import { entrarComo, escenario, HOY, sumarDias } from "./apoyo";

/*
 * El panel de salidas es una ventana alrededor de hoy (50 por cada lado) con "Ver más" arriba y abajo;
 * el refresco no la encoge y cambiar un filtro la reinicia.
 */
test("Ver más antiguas y más lejanas amplía la lista por el lado elegido", async ({ page, context }, info) => {
  test.skip(info.project.name !== "escritorio", "Se prueba una vez, en escritorio.");
  const e = await escenario("vermas");
  for (let d = 1; d <= 55; d++) await e.tarea(`Vieja ${String(d).padStart(2, "0")}`, e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(HOY, -d));
  for (let d = 1; d <= 55; d++) await e.tarea(`Lejana ${String(d).padStart(2, "0")}`, e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(HOY, d));
  await entrarComo(context, e.empleado);
  await page.goto("/tareas");
  const filas = page.locator("[data-tarea]");

  await expect(filas).toHaveCount(100);
  await expect(page.getByText("Vieja 50", { exact: true })).toBeVisible();
  await expect(page.getByText("Vieja 51", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lejana 50", { exact: true })).toBeVisible();
  await expect(page.getByText("Lejana 51", { exact: true })).toHaveCount(0);

  await page.locator('[data-ver-mas="antes"]').click();
  await expect(filas).toHaveCount(105);
  await expect(page.getByText("Vieja 55", { exact: true })).toBeVisible();
  // Ya no queda nada más antiguo: el botón desaparece; el otro lado sigue.
  await expect(page.locator('[data-ver-mas="antes"]')).toHaveCount(0);
  await expect(page.locator('[data-ver-mas="despues"]')).toBeVisible();

  // Cambiar el alcance y volver reinicia la ventana a lo cercano.
  await page.locator('[data-ver-mas="despues"]').click();
  await expect(filas).toHaveCount(110);
  await expect(page.locator('[data-ver-mas="despues"]')).toHaveCount(0);
});
