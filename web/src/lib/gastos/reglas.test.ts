import { describe, expect, it } from "vitest";
import { resumenDeGastos } from "./agregados";
import { estadoDePresupuesto, leerGasto, leerPresupuesto, normalizarCategoria } from "./reglas";

describe("categoria", () => {
  it("quita espacios y reutiliza la escritura de una existente, sin distinguir mayusculas ni tildes", () => {
    expect(normalizarCategoria("  viajes   y viaticos ")).toEqual({ ok: true, valor: "Viajes y viáticos" });
    expect(normalizarCategoria("capacitacion")).toEqual({ ok: true, valor: "Capacitación" });
    expect(normalizarCategoria("Suscripciones", ["suscripciones"])).toEqual({ ok: true, valor: "suscripciones" });
    expect(normalizarCategoria("Nueva cosa")).toEqual({ ok: true, valor: "Nueva cosa" });
  });
  it("la pide y acota su largo", () => {
    expect(normalizarCategoria("   ").ok).toBe(false);
    expect(normalizarCategoria(undefined).ok).toBe(false);
    expect(normalizarCategoria("x".repeat(61)).ok).toBe(false);
  });
});

describe("gasto", () => {
  const base = { unidadId: 3, fecha: "2026-09-14", categoria: "transporte", descripcion: "  Taxi   al   cliente ", monto: "45,50", proveedor: " Uber ", nota: "" };
  it("normaliza y valida", () => {
    expect(leerGasto(base)).toEqual({ ok: true, valor: { unidadId: 3, fecha: "2026-09-14", categoria: "Transporte", descripcion: "Taxi al cliente", monto: 45.5, proveedor: "Uber", nota: "" } });
  });
  it("rechaza lo incompleto o fuera de rango", () => {
    for (const malo of [{ unidadId: "" }, { fecha: "2026-13-01" }, { categoria: "" }, { descripcion: " " }, { monto: 0 }, { monto: "abc" }, { monto: "1.234" }, { descripcion: "x".repeat(301) }, { proveedor: "x".repeat(121) }, { nota: "x".repeat(501) }]) {
      expect(leerGasto({ ...base, ...malo }).ok, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe("presupuesto", () => {
  it("acepta cero (sin presupuesto) y un año valido", () => {
    expect(leerPresupuesto({ unidadId: 3, anio: "2026", categoria: "marketing", monto: 0 })).toEqual({ ok: true, valor: { unidadId: 3, anio: 2026, categoria: "Marketing", monto: 0 } });
    expect(leerPresupuesto({ unidadId: 3, anio: 1999, categoria: "x", monto: 1 }).ok).toBe(false);
    expect(leerPresupuesto({ unidadId: 3, anio: 2026, categoria: "x", monto: -1 }).ok).toBe(false);
  });
});

describe("estado contra el presupuesto", () => {
  it("bien, cerca desde el 90 %, excedido al pasarlo y sin presupuesto", () => {
    expect([[0, 100], [89, 100], [90, 100], [100, 100], [101, 100], [5, 0]].map(([g, p]) => estadoDePresupuesto(g, p))).toEqual(["bien", "bien", "cerca", "cerca", "excedido", "sin_presupuesto"]);
  });
});

describe("resumen del año", () => {
  const gastos = [
    { id: 1, fecha: "2026-01-10", categoria: "Viajes y viáticos", monto: 400 }, { id: 2, fecha: "2026-01-20", categoria: "viajes y viaticos", monto: 100.25 },
    { id: 3, fecha: "2026-03-05", categoria: "Marketing", monto: 950 }, { id: 4, fecha: "2026-03-06", categoria: "Otros", monto: 30 },
    { id: 5, fecha: "2025-12-31", categoria: "Marketing", monto: 9999 }, // otro año
  ];
  const r = resumenDeGastos(gastos, [{ categoria: "Viajes y viáticos", monto: 1000 }, { categoria: "Marketing", monto: 1000 }, { categoria: "Capacitación", monto: 500 }], 2026);

  it("totales del año, sin contar otros años", () => {
    expect(r.gastado).toBe(1480.25);
    expect(r.presupuesto).toBe(2500);
    expect(r.restante).toBe(1019.75);
    expect(r.porcentaje).toBeCloseTo(0.592, 3);
    expect(r.estado).toBe("bien");
  });
  it("por mes", () => {
    expect(r.porMes.map((m) => m.gastado)).toEqual([500.25, 0, 980, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it("por categoria: junta las escritas distinto, ordena por gasto y marca el estado de cada una", () => {
    expect(r.porCategoria.map((c) => [c.categoria, c.gastado, c.presupuesto, c.estado])).toEqual([
      ["Marketing", 950, 1000, "cerca"], ["Viajes y viáticos", 500.25, 1000, "bien"], ["Otros", 30, 0, "sin_presupuesto"], ["Capacitación", 0, 500, "bien"],
    ]);
  });
  it("sin presupuesto no hay restante ni porcentaje", () => {
    const s = resumenDeGastos(gastos, [], 2026);
    expect(s).toMatchObject({ presupuesto: 0, restante: null, porcentaje: null, estado: "sin_presupuesto" });
  });
  it("un gasto en una categoria sin presupuesto cuenta en lo gastado y no mueve el presupuesto", () => {
    expect(r.porCategoria.find((c) => c.categoria === "Otros")).toMatchObject({ gastado: 30, restante: -30 });
  });
});
