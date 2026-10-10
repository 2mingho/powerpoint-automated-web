import { describe, expect, it } from "vitest";
import { enAnio, filasFin, mesActualDe, mesesDe, porMes, sumarMeses } from "./finanzas";

const anual = { monto: 12000, inicio: "2026-01-01", fin: "2026-12-31" };

describe("meses de un contrato", () => {
  it("cuenta meses naturales aunque empiece o termine a mitad de mes", () => {
    expect(mesesDe({ inicio: "2026-01-15", fin: "2026-03-02" })).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(mesesDe({ inicio: "2026-05-31", fin: "2026-05-31" })).toEqual(["2026-05"]);
  });

  it("cruza el cambio de ano", () => {
    expect(mesesDe({ inicio: "2025-11-01", fin: "2026-02-28" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("fechas vacias o fin anterior al inicio: sin meses", () => {
    expect(mesesDe({ inicio: "", fin: "2026-01-01" })).toEqual([]);
    expect(mesesDe({ inicio: "2026-03-01", fin: "2026-02-01" })).toEqual([]);
  });
});

describe("prorrateo", () => {
  it("reparte el monto en partes iguales", () => {
    expect(porMes(anual)).toBe(1000);
    expect(porMes({ monto: 6000, inicio: "2026-07-01", fin: "2026-12-31" })).toBe(1000);
  });

  it("sin meses o sin monto vale 0", () => {
    expect(porMes({ monto: 5000, inicio: "2026-03-01", fin: "2026-02-01" })).toBe(0);
    expect(porMes({ monto: Number.NaN, inicio: "2026-01-01", fin: "2026-02-01" })).toBe(0);
  });

  it("enAnio suma solo los meses del ano pedido", () => {
    const c = { monto: 12000, inicio: "2025-10-01", fin: "2026-09-30" };
    expect(enAnio(c, 2025)).toBe(3000);
    expect(enAnio(c, 2026)).toBe(9000);
    expect(enAnio(c, 2024)).toBe(0);
  });

  it("lo prorrateado de todos los anos suma el monto", () => {
    const c = { monto: 10000, inicio: "2024-11-01", fin: "2027-02-28" };
    expect(enAnio(c, 2024) + enAnio(c, 2025) + enAnio(c, 2026) + enAnio(c, 2027)).toBeCloseTo(10000, 6);
  });
});

describe("filas del ano", () => {
  const medio = { monto: 6000, inicio: "2026-07-01", fin: "2026-12-31", cliente: "b" };
  const otroAnio = { monto: 9000, inicio: "2025-01-01", fin: "2025-12-31", cliente: "c" };
  const contratos = [{ ...anual, cliente: "a" }, medio, otroAnio];

  it("una fila por contrato con su ingreso de cada mes; omite los que no tocan el ano", () => {
    const f = filasFin(contratos, 2026);
    expect(f.map((x) => x.contrato.cliente)).toEqual(["a", "b"]);
    expect(f[0].meses).toEqual(Array(12).fill(1000));
    expect(f[1].meses).toEqual([0, 0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1000]);
    expect(f[1].total).toBe(6000);
  });

  it("aplica el filtro recibido", () => {
    expect(filasFin(contratos, 2026, (c) => c.cliente === "b").map((x) => x.contrato.cliente)).toEqual(["b"]);
    expect(filasFin(contratos, 2026, () => false)).toEqual([]);
  });

  it("sumarMeses toma [desde, hasta) de todas las filas", () => {
    const f = filasFin(contratos, 2026);
    expect(sumarMeses(f, 0, 6)).toBe(6000);
    expect(sumarMeses(f, 6, 12)).toBe(12000);
    expect(sumarMeses(f, 0, 12)).toBe(18000);
  });
});

describe("mes actual", () => {
  it("12 para un ano pasado, 0 para uno futuro y el mes en el actual", () => {
    expect(mesActualDe(2025, "2026-10-08")).toBe(12);
    expect(mesActualDe(2027, "2026-10-08")).toBe(0);
    expect(mesActualDe(2026, "2026-10-08")).toBe(10);
  });
});
