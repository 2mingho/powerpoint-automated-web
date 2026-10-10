import { describe, expect, it } from "vitest";
import { diferencia, leerConcesiones } from "./concesiones";

describe("leerConcesiones", () => {
  it("lee los dos tipos, ordena y quita repetidos", () => {
    expect(leerConcesiones({ contracts: [3, 1, 3], goals: [] })).toEqual({ ok: true, valor: { contracts: [1, 3], goals: [] } });
  });

  it("solo toca los tipos que llegan", () => {
    expect(leerConcesiones({ goals: [2] })).toEqual({ ok: true, valor: { goals: [2] } });
    expect(leerConcesiones({})).toEqual({ ok: true, valor: {} });
  });

  it.each([
    ["no es objeto", [1, 2]], ["null", null], ["texto", "x"],
    ["tipo desconocido", { ingresos: [1] }],
    ["lista no es lista", { contracts: "1" }],
    ["id no entero", { goals: [1.5] }],
    ["id cero", { goals: [0] }],
    ["id negativo", { contracts: [-2] }],
    ["id texto", { contracts: ["1"] }],
    ["demasiados", { goals: Array.from({ length: 501 }, (_, i) => i + 1) }],
  ])("rechaza %s", (_n, crudo) => {
    expect(leerConcesiones(crudo).ok).toBe(false);
  });
});

describe("diferencia", () => {
  it("separa altas y bajas", () => {
    expect(diferencia([1, 2, 3], [2, 3, 4])).toEqual({ altas: [4], bajas: [1] });
  });
  it("sin cambios no hay nada", () => {
    expect(diferencia([1, 2], [2, 1])).toEqual({ altas: [], bajas: [] });
    expect(diferencia([], [])).toEqual({ altas: [], bajas: [] });
  });
});
