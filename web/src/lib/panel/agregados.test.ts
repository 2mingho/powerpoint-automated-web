import { describe, expect, it } from "vitest";
import { SIN_FILTROS } from "@/lib/seguimiento/filtros";
import { opcionesDe, resumen } from "./agregados";
import type { FilaPanel } from "./tipos";

const HOY = "2026-10-08";
let n = 0;
const t = (o: Partial<FilaPanel> = {}): FilaPanel => ({
  id: ++n, titulo: `t${n}`, estadoNombre: "Pendiente", estimada: true, personaNombre: "Ana", clienteId: 1,
  estado: "pendiente", entrega: "2026-10-14", horas: 4, unidad: "Insights", cliente: "Altice", persona: "1", tipo: "Fee", contrato: "",
  ...o,
});

describe("resumen del panel", () => {
  const filas = [
    t({ cliente: "Altice" }),
    t({ cliente: "Altice", estado: "hecha", hechaEl: "2026-10-05", entrega: "2026-10-06", horas: 2 }),
    t({ cliente: "Claro", entrega: "2026-10-01", horas: 6 }),
    t({ cliente: "", estado: "hecha", hechaEl: "2026-10-08", entrega: "2026-10-07", horas: 1 }),
  ];

  it("cuenta tareas, clientes distintos y estados", () => {
    expect(resumen(filas, SIN_FILTROS, HOY, "n")).toEqual({ clientes: 2, tareas: 4, completadas: 2, abiertas: 2, vencidas: 1, aTiempo: 50 });
  });

  it("en horas suma las horas de cada tarea", () => {
    expect(resumen(filas, SIN_FILTROS, HOY, "h")).toMatchObject({ tareas: 13, completadas: 3, abiertas: 10, vencidas: 6 });
  });

  it("los botones de estado ignoran el filtro de estado; el total no", () => {
    const r = resumen(filas, { ...SIN_FILTROS, estado: "hecha" }, HOY, "n");
    expect(r).toMatchObject({ tareas: 2, completadas: 2, abiertas: 2, vencidas: 1 });
  });

  it("el cliente elegido reduce todas las cifras", () => {
    expect(resumen(filas, { ...SIN_FILTROS, cliente: "Claro" }, HOY, "n")).toMatchObject({ clientes: 1, tareas: 1, vencidas: 1, aTiempo: null });
  });

  it("sin cierres en 30 dias no hay puntualidad", () => {
    expect(resumen([t()], SIN_FILTROS, HOY, "n").aTiempo).toBeNull();
  });
});

describe("opciones de un filtro", () => {
  const filas = [
    t({ cliente: "Altice", unidad: "Insights" }),
    t({ cliente: "Claro", unidad: "Insights" }),
    t({ cliente: "Arajet", unidad: "Mediawatch" }),
    t({ cliente: "" }),
  ];

  it("lista los valores con su cuenta, ordenados, sin los vacios", () => {
    expect(opcionesDe(filas, SIN_FILTROS, HOY, "cliente").map((o) => [o.valor, o.n])).toEqual([["Altice", 1], ["Arajet", 1], ["Claro", 1]]);
  });

  it("respeta los demas filtros pero no el propio", () => {
    const f = { ...SIN_FILTROS, unidad: "Insights", cliente: "Altice" };
    expect(opcionesDe(filas, f, HOY, "cliente").map((o) => o.valor)).toEqual(["Altice", "Claro"]);
    expect(opcionesDe(filas, f, HOY, "unidad").map((o) => o.valor)).toEqual(["Insights"]);
  });

  it("conserva el valor elegido aunque ya no haya filas", () => {
    const f = { ...SIN_FILTROS, unidad: "Mediawatch", cliente: "Altice" };
    const o = opcionesDe(filas, f, HOY, "cliente");
    expect(o.find((x) => x.valor === "Altice")?.n).toBe(0);
  });

  it("las personas se rotulan por nombre", () => {
    const o = opcionesDe([t({ persona: "7", personaNombre: "Luis" })], SIN_FILTROS, HOY, "persona");
    expect(o).toEqual([{ valor: "7", etiqueta: "Luis", n: 1 }]);
  });
});
