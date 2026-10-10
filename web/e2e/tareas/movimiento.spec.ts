import { expect, test } from "@playwright/test";
import { BASE, entrarComo, escenario, HOY, sumarDias } from "./apoyo";

test("completar desplaza la fila y anuncia el cambio también con movimiento reducido", async ({ page, context }, info) => {
  test.skip(info.project.name !== "escritorio", "El movimiento se comprueba una vez.");
  for (const modo of ["no-preference", "reduce"] as const) {
    const e = await escenario(`mov-${modo}`);
    const titulo = `Cambio visible ${e.sufijo}`;
    const id = await e.tarea(titulo, e.alfa, e.empleado, e.empleado, "Pendiente", HOY);
    await e.tarea(`Siguiente entrega ${e.sufijo}`, e.alfa, e.empleado, e.empleado, "Pendiente", sumarDias(HOY, 1));
    await page.emulateMedia({ reducedMotion: modo });
    await entrarComo(context, e.empleado);
    await page.goto(`${BASE}/tareas`);
    const fila = page.locator(`[data-tarea="${id}"]`);
    await expect(fila).toBeVisible();

    await page.evaluate((taskId) => {
      const w = window as typeof window & { muestras?: string[]; posiciones?: number[]; parar?: boolean };
      w.muestras = [];
      w.posiciones = [];
      w.parar = false;
      const medir = () => {
        const el = document.querySelector(`[data-tarea="${taskId}"]`);
        w.muestras!.push(el ? getComputedStyle(el).transform : "none");
        w.posiciones!.push(el?.getBoundingClientRect().top ?? -1);
        if (!w.parar) requestAnimationFrame(medir);
      };
      requestAnimationFrame(medir);
    }, id);
    await fila.getByRole("button", { name: `Completar «${titulo}»` }).click();
    await expect(fila.getByText(/^Completado/)).toBeVisible();
    await expect(fila.locator("[data-encendida]")).toBeVisible();
    await page.waitForTimeout(350);
    const { muestras, posiciones } = await page.evaluate(() => {
      const w = window as typeof window & { muestras?: string[]; posiciones?: number[]; parar?: boolean };
      w.parar = true;
      return { muestras: w.muestras ?? [], posiciones: w.posiciones ?? [] };
    });
    const posicionesDistintas = new Set(posiciones.map(Math.round)).size;
    if (modo === "no-preference") {
      expect(muestras.some((m) => m !== "none" && m !== "matrix(1, 0, 0, 1, 0, 0)")).toBe(true);
      expect(posicionesDistintas).toBeGreaterThan(2);
    } else {
      expect(posicionesDistintas).toBeLessThanOrEqual(2);
    }
  }
});
