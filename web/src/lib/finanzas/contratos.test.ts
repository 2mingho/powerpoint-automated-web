import { describe, expect, it } from "vitest";
import { leerAnio, leerContrato, leerMonto, MONTO_MAX, textoDeProrrateo, usd, usdS } from "./contratos";

const base = { clienteId: 3, unidadId: 7, tipo: "Fee", monto: 15000, inicio: "2026-01-01", fin: "2026-12-31" };

describe("leerMonto", () => {
  it.each([[15000, 15000], ["15000", 15000], ["15000.5", 15000.5], ["15000,50", 15000.5], [" 99.99 ", 99.99], [0.01, 0.01]])("acepta %s", (e, v) => {
    expect(leerMonto(e)).toEqual({ ok: true, valor: v });
  });

  it.each([["15,000"], ["1.234,5"], ["abc"], [""], [null], [undefined], [NaN], [Infinity], ["12.345"], [10.005], [{}], [["1"]]])("rechaza %j", (e) => {
    expect(leerMonto(e).ok).toBe(false);
  });

  it("cero y negativo no valen (cero solo si se permite, para quitar una meta)", () => {
    expect(leerMonto(0).ok).toBe(false);
    expect(leerMonto(-5).ok).toBe(false);
    expect(leerMonto(0, { permitirCero: true })).toEqual({ ok: true, valor: 0 });
    expect(leerMonto(-1, { permitirCero: true }).ok).toBe(false);
  });

  it("tiene tope", () => {
    expect(leerMonto(MONTO_MAX).ok).toBe(true);
    expect(leerMonto(MONTO_MAX + 1).ok).toBe(false);
  });
});

describe("leerContrato", () => {
  it("lee un contrato completo", () => {
    expect(leerContrato(base)).toEqual({ ok: true, valor: { ...base, asignaId: null, nota: "" } });
  });

  it("acepta ids como texto y recorta la nota", () => {
    const r = leerContrato({ ...base, clienteId: "3", unidadId: "7", nota: "  renovación  " });
    expect(r).toMatchObject({ ok: true, valor: { clienteId: 3, unidadId: 7, nota: "renovación" } });
  });

  it.each([
    ["sin cliente", { clienteId: undefined }], ["cliente 0", { clienteId: 0 }], ["cliente texto", { clienteId: "x" }],
    ["sin unidad", { unidadId: null }],
    ["tipo desconocido", { tipo: "Mensual" }], ["tipo en minuscula", { tipo: "fee" }],
    ["sin monto", { monto: undefined }], ["monto 0", { monto: 0 }],
    ["sin fechas", { inicio: "", fin: "" }], ["fecha imposible", { fin: "2026-02-31" }], ["fecha en otro formato", { inicio: "01/01/2026" }],
    ["fin igual a inicio", { fin: "2026-01-01" }], ["fin anterior", { fin: "2025-12-31" }],
    ["mas de 20 años", { fin: "2047-01-01" }],
    ["nota larga", { nota: "x".repeat(501) }],
  ])("rechaza %s", (_n, cambio) => {
    expect(leerContrato({ ...base, ...cambio }).ok).toBe(false);
  });

  it("solo una Asignación indica la unidad que asigna, y no puede ser la misma", () => {
    expect(leerContrato({ ...base, asignaId: 4 }).ok).toBe(false);
    expect(leerContrato({ ...base, tipo: "Asignación", asignaId: 4 })).toMatchObject({ ok: true, valor: { asignaId: 4 } });
    expect(leerContrato({ ...base, tipo: "Asignación", asignaId: 7 }).ok).toBe(false);
    expect(leerContrato({ ...base, tipo: "Asignación", asignaId: "x" }).ok).toBe(false);
    expect(leerContrato({ ...base, tipo: "Asignación", asignaId: null })).toMatchObject({ ok: true, valor: { asignaId: null } });
  });
});

describe("leerAnio", () => {
  it("acepta 2000 a 2100, como numero o texto de cuatro cifras", () => {
    expect(leerAnio(2026)).toEqual({ ok: true, valor: 2026 });
    expect(leerAnio("2026")).toEqual({ ok: true, valor: 2026 });
  });
  it.each([[1999], [2101], [2026.5], ["26"], ["2026a"], [null], [undefined]])("rechaza %j", (e) => {
    expect(leerAnio(e).ok).toBe(false);
  });
});

describe("textos de dinero", () => {
  it("usd muestra centavos solo cuando los hay", () => {
    expect(usd(15000)).toBe("US$15,000");
    expect(usd(1250.5)).toBe("US$1,250.50");
    expect(usd(333.3333)).toBe("US$333.33");
    expect(usd(0)).toBe("US$0");
  });

  it("usdS abrevia como el MVP", () => {
    expect([0, 850, 999.6, 1000, 6500, 9999, 12500, 143000, 1_200_000, 1_000_000, -6500].map(usdS)).toEqual(
      ["US$0", "US$850", "US$1000", "US$1k", "US$6.5k", "US$10k", "US$13k", "US$143k", "US$1.2M", "US$1M", "-US$6.5k"]);
  });

  it("confirma el prorrateo como el MVP", () => {
    expect(textoDeProrrateo({ monto: 15000, inicio: "2026-01-01", fin: "2026-12-31" })).toBe("US$1,250 por mes durante 12 meses");
    expect(textoDeProrrateo({ monto: 1000, inicio: "2026-09-25", fin: "2026-11-05" })).toBe("US$333.33 por mes durante 3 meses");
    expect(textoDeProrrateo({ monto: 500, inicio: "2026-03-01", fin: "2026-03-31" })).toBe("US$500 por mes durante 1 mes");
    expect(textoDeProrrateo({ monto: 500, inicio: "2026-03-10", fin: "" })).toBe("");
  });
});
