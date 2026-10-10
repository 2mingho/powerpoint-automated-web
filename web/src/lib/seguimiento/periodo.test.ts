import { describe, expect, it } from "vitest";
import { leerPeriodo, rangoDePeriodo } from "./periodo";

describe("periodos del panel", () => {
  it("lee el periodo y cae en 'mes' si no lo entiende", () => {
    expect(leerPeriodo("semana")).toBe("semana");
    expect(leerPeriodo("nada")).toBe("mes");
    expect(leerPeriodo(undefined)).toBe("mes");
  });

  it("la semana va de lunes a domingo", () => {
    expect(rangoDePeriodo("semana", "2026-10-08")).toEqual({ desde: "2026-10-05", hasta: "2026-10-11" });
    expect(rangoDePeriodo("semana", "2026-10-11")).toEqual({ desde: "2026-10-05", hasta: "2026-10-11" });
  });

  it("el mes cubre del 1 al ultimo dia, bisiesto incluido", () => {
    expect(rangoDePeriodo("mes", "2026-10-08")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoDePeriodo("mes", "2028-02-10")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(rangoDePeriodo("mes", "2026-12-31")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });

  it("ultimos y proximos 30 dias incluyen hoy", () => {
    expect(rangoDePeriodo("ultimos30", "2026-10-08")).toEqual({ desde: "2026-09-08", hasta: "2026-10-08" });
    expect(rangoDePeriodo("proximos30", "2026-10-08")).toEqual({ desde: "2026-10-08", hasta: "2026-11-07" });
  });

  it("todo deja el rango abierto", () => {
    expect(rangoDePeriodo("todo", "2026-10-08")).toEqual({ desde: "", hasta: "" });
  });

  it("fechas a mano: descarta lo invalido y ordena los extremos", () => {
    expect(rangoDePeriodo("rango", "2026-10-08", { desde: "2026-10-20", hasta: "2026-10-10" })).toEqual({ desde: "2026-10-10", hasta: "2026-10-20" });
    expect(rangoDePeriodo("rango", "2026-10-08", { desde: "ayer", hasta: "2026-02-31" })).toEqual({ desde: "", hasta: "" });
    expect(rangoDePeriodo("rango", "2026-10-08", { desde: "2026-10-01" })).toEqual({ desde: "2026-10-01", hasta: "" });
  });
});
