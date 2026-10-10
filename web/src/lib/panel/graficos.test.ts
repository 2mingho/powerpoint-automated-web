import { describe, expect, it } from "vitest";
import { SIN_FILTROS } from "@/lib/seguimiento/filtros";
import { CLAVE_OTRAS, TOPE_PORCIONES, cargaPorPersona, entregasPorSemana, estadoPorCliente, repartoPor, TOPE_BARRAS, TOPE_SEMANAS } from "./graficos";
import { acumularCeldas, entradaDeTarea } from "./celdas";
import type { CeldaPanel } from "./tipos";

const HOY = "2026-10-08"; // jueves; la semana empieza el 2026-10-05
/* Una tarea suelta convertida en celda, con el mismo camino que usa el servidor (riesgo y puntualidad incluidos). */
type Suelta = Parameters<typeof entradaDeTarea>[0];
const t = (o: Partial<Suelta> = {}): CeldaPanel => acumularCeldas([entradaDeTarea({
  estado: "pendiente", entrega: "2026-10-14", horas: 4, unidad: "Insights", cliente: "Altice", persona: "1", personaNombre: "Ana", tipo: "Fee", contrato: "",
  ...o,
}, HOY)])[0];

describe("estado por cliente", () => {
  const filas = [
    t({ cliente: "Altice" }), t({ cliente: "Altice", estado: "hecha", entrega: "2026-10-06" }), t({ cliente: "Altice", entrega: "2026-10-01" }),
    t({ cliente: "Claro", estado: "bloqueada" }), t({ cliente: "" }),
  ];

  it("apila por estado, cuenta vencidas y ordena de mayor a menor; sin cliente no sale", () => {
    const { barras } = estadoPorCliente(filas, SIN_FILTROS, HOY, "n");
    expect(barras.map((b) => [b.clave, b.total])).toEqual([["Altice", 3], ["Claro", 1]]);
    expect(barras[0]).toMatchObject({ vencidas: 1, porGrupo: { pendiente: 2, hecha: 1 } });
  });

  it("no se filtra por si mismo pero si por lo demas", () => {
    const r = estadoPorCliente(filas, { ...SIN_FILTROS, cliente: "Claro", estado: "hecha" }, HOY, "n");
    expect(r.barras.map((b) => b.clave)).toEqual(["Altice"]);
    const s = estadoPorCliente(filas, { ...SIN_FILTROS, cliente: "Claro" }, HOY, "n");
    expect(s.barras.map((b) => b.clave)).toEqual(["Altice", "Claro"]);
  });

  it("en horas suma las horas", () => {
    expect(estadoPorCliente([t({ horas: 2.5 }), t({ horas: 1 })], SIN_FILTROS, HOY, "h").barras[0].total).toBe(3.5);
  });

  it("recorta a ocho y conserva al elegido aunque quede fuera", () => {
    const muchas = Array.from({ length: 12 }, (_, i) => Array.from({ length: 12 - i }, () => t({ cliente: `C${String(i).padStart(2, "0")}` }))).flat();
    const base = estadoPorCliente(muchas, SIN_FILTROS, HOY, "n");
    expect(base.barras).toHaveLength(TOPE_BARRAS);
    expect(base.omitidos).toBe(4);
    const r = estadoPorCliente(muchas, { ...SIN_FILTROS, cliente: "C11" }, HOY, "n");
    expect(r.barras).toHaveLength(TOPE_BARRAS);
    expect(r.barras.at(-1)?.clave).toBe("C11");
  });
});

describe("carga por persona", () => {
  const filas = [t({ persona: "1", personaNombre: "Ana" }), t({ persona: "1", personaNombre: "Ana", estado: "hecha" }), t({ persona: "2", personaNombre: "Luis", estado: "hecha" })];

  it("sin filtro de estado cuenta solo lo abierto", () => {
    expect(cargaPorPersona(filas, SIN_FILTROS, HOY, "n").barras.map((b) => [b.etiqueta, b.total])).toEqual([["Ana", 1]]);
  });

  it("con filtro de estado cuenta lo que ese filtro deje", () => {
    expect(cargaPorPersona(filas, { ...SIN_FILTROS, estado: "hecha" }, HOY, "n").barras.map((b) => [b.etiqueta, b.total])).toEqual([["Ana", 1], ["Luis", 1]]);
  });
});

describe("entregas por semana", () => {
  it("separa hechas, abiertas y vencidas por el lunes de la entrega", () => {
    const filas = [
      t({ entrega: "2026-10-06", estado: "hecha" }), t({ entrega: "2026-10-07" }), t({ entrega: "2026-10-02" }), t({ entrega: "2026-10-14" }),
    ];
    const { semanas } = entregasPorSemana(filas, SIN_FILTROS, HOY, "n");
    expect(semanas.map((s) => [s.lunes, s.hechas, s.abiertas, s.vencidas])).toEqual([
      ["2026-09-28", 0, 0, 1], ["2026-10-05", 1, 0, 1], ["2026-10-12", 0, 1, 0],
    ]);
  });

  it("rellena las semanas vacias y no cuenta lo que no tiene entrega", () => {
    const { semanas } = entregasPorSemana([t({ entrega: "2026-10-05" }), t({ entrega: "2026-10-26" }), t({ entrega: null })], SIN_FILTROS, HOY, "n");
    expect(semanas.map((s) => s.total)).toEqual([1, 0, 0, 1]);
  });

  it("no se filtra por semana a si mismo", () => {
    const filas = [t({ entrega: "2026-10-06" }), t({ entrega: "2026-10-14" })];
    expect(entregasPorSemana(filas, { ...SIN_FILTROS, semana: "2026-10-05" }, HOY, "n").semanas).toHaveLength(2);
  });

  it("limita las semanas dibujadas alrededor de hoy", () => {
    const filas = [t({ entrega: "2025-01-06" }), t({ entrega: "2026-10-08" }), t({ entrega: "2027-12-06" })];
    const { semanas, omitidas } = entregasPorSemana(filas, SIN_FILTROS, HOY, "n");
    expect(semanas).toHaveLength(TOPE_SEMANAS);
    expect(omitidas).toBeGreaterThan(0);
    expect(semanas.some((s) => s.lunes === "2026-10-05")).toBe(true);
  });

  it("sin tareas con entrega no hay semanas", () => {
    expect(entregasPorSemana([], SIN_FILTROS, HOY, "n")).toEqual({ semanas: [], omitidas: 0 });
  });
});

describe("reparto", () => {
  const filas = [t({ tipo: "Fee" }), t({ tipo: "Fee" }), t({ tipo: "Proyecto" }), t({ tipo: "" })];

  it("agrupa por tipo, de mayor a menor, con rotulo para lo vacio", () => {
    expect(repartoPor(filas, SIN_FILTROS, HOY, "n", "tipo", "Sin tipo").map((p) => [p.etiqueta, p.valor])).toEqual([["Fee", 2], ["Proyecto", 1], ["Sin tipo", 1]]);
  });

  it("no se filtra por su propia dimension", () => {
    expect(repartoPor(filas, { ...SIN_FILTROS, tipo: "Fee" }, HOY, "n", "tipo", "Sin tipo")).toHaveLength(3);
    expect(repartoPor(filas, { ...SIN_FILTROS, unidad: "Otra" }, HOY, "n", "tipo", "Sin tipo")).toHaveLength(0);
  });

  it("junta lo que sobra en 'Otras' y conserva a la elegida con nombre", () => {
    const filas = Array.from({ length: 10 }, (_, i) => Array.from({ length: 10 - i }, () => t({ unidad: `U${i}` }))).flat();
    const base = repartoPor(filas, SIN_FILTROS, HOY, "n", "unidad", "Sin unidad");
    expect(base).toHaveLength(TOPE_PORCIONES + 1);
    expect(base.at(-1)).toMatchObject({ clave: CLAVE_OTRAS, etiqueta: "Otras 4", valor: 4 + 3 + 2 + 1 });
    expect(base.reduce((a, p) => a + p.valor, 0)).toBe(55);
    const r = repartoPor(filas, { ...SIN_FILTROS, unidad: "U9" }, HOY, "n", "unidad", "Sin unidad");
    expect(r.some((p) => p.clave === "U9")).toBe(true);
    expect(r.reduce((a, p) => a + p.valor, 0)).toBe(55);
  });
});
