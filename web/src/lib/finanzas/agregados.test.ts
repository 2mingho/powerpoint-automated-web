import { describe, expect, it } from "vitest";
import { metaBase, origenDeMeta, porMesPorUnidad, resumenIngresos, SIN_FILTRO_ING, tablaMensual, tarjetasPorUnidad, type ContratoIng, type MetasIng } from "./agregados";

let n = 0;
const c = (o: Partial<ContratoIng> & { monto: number; inicio: string; fin: string }): ContratoIng => ({
  id: ++n, cliente: { id: 1, nombre: "Altice", tipo: "Corporativo" }, unidad: { id: 10, nombre: "Insights" }, tipo: "Fee", ...o,
});
const HOY = "2026-05-20"; // mayo: van 5 meses

const anual = c({ monto: 12000, inicio: "2026-01-01", fin: "2026-12-31" }); // 1000 por mes
const mediawatch = c({ id: 99, unidad: { id: 20, nombre: "Mediawatch" }, cliente: { id: 2, nombre: "Claro", tipo: "Telecom" }, tipo: "Proyecto", monto: 1200, inicio: "2026-03-01", fin: "2026-06-30" }); // 300 por mes, mar-jun
const metas: MetasIng = { direccion: 20000, unidades: { 10: 12000, 20: 6000 } };

describe("resumen de ingresos", () => {
  const r = resumenIngresos([anual, mediawatch], metas, 2026, HOY, SIN_FILTRO_ING);

  it("contratado, devengado y por devengar", () => {
    expect(r.contratado).toBe(13200); // 12000 + 4 meses de 300
    expect(r.mesActual).toBe(5);
    expect(r.devengado).toBe(5000 + 900); // 5 meses de 1000 y marzo-mayo de 300
    expect(r.porDevengar).toBe(13200 - 5900);
  });

  it("meta, falta por contratar y ritmo esperado", () => {
    expect(r.meta).toBe(20000);
    expect(r.faltaPorContratar).toBe(6800);
    expect(r.ritmo).toBe(Math.round(((20000 * 5) / 12) * 100) / 100);
    expect(r.contraRitmo).toBe(Math.round((5900 - (20000 * 5) / 12) * 100) / 100);
    expect(r.participacion).toBeNull();
    expect(r.metaMensual).toBe(1666.67);
  });

  it("por mes y acumulado", () => {
    expect(r.porMes).toEqual([1000, 1000, 1300, 1300, 1300, 1300, 1000, 1000, 1000, 1000, 1000, 1000]);
    expect(r.acumulado.at(-1)).toBe(13200);
    expect(r.acumulado[2]).toBe(3300);
  });

  it("un año pasado esta devengado entero; uno futuro, nada", () => {
    const pasado = resumenIngresos([c({ monto: 1200, inicio: "2025-01-01", fin: "2025-12-31" })], metas, 2025, HOY, SIN_FILTRO_ING);
    expect(pasado.devengado).toBe(1200);
    expect(pasado.porDevengar).toBe(0);
    const futuro = resumenIngresos([c({ monto: 1200, inicio: "2027-01-01", fin: "2027-12-31" })], metas, 2027, HOY, SIN_FILTRO_ING);
    expect(futuro.devengado).toBe(0);
    expect(futuro.porDevengar).toBe(1200);
  });

  it("un contrato que cruza el año aporta solo los meses de ese año", () => {
    const cruza = c({ monto: 12000, inicio: "2025-10-01", fin: "2026-09-30" });
    expect(resumenIngresos([cruza], metas, 2026, HOY, SIN_FILTRO_ING).contratado).toBe(9000);
    expect(resumenIngresos([cruza], metas, 2025, HOY, SIN_FILTRO_ING).contratado).toBe(3000);
  });

  it("sin metas no hay falta ni ritmo, pero si cifras", () => {
    const s = resumenIngresos([anual], { direccion: null, unidades: {} }, 2026, HOY, SIN_FILTRO_ING);
    expect(s).toMatchObject({ meta: null, faltaPorContratar: null, ritmo: null, contraRitmo: null, contratado: 12000 });
  });
});

describe("redondeo", () => {
  it("las cifras no arrastran centavos por redondear mes a mes", () => {
    const tercios = c({ monto: 24000, inicio: "2026-04-01", fin: "2026-12-31" }); // 9 meses: 2666.666...
    const r = resumenIngresos([tercios], { direccion: null, unidades: {} }, 2026, "2026-12-15", SIN_FILTRO_ING);
    expect(r.contratado).toBe(24000);
    expect(r.devengado).toBe(24000);
    expect(r.acumulado.at(-1)).toBe(24000);
    expect(r.porMes[3]).toBe(2666.67);
  });
});

describe("filtros", () => {
  it("por unidad mide contra la meta de esa unidad", () => {
    const r = resumenIngresos([anual, mediawatch], metas, 2026, HOY, { ...SIN_FILTRO_ING, unidadId: 20 });
    expect(r.contratado).toBe(1200);
    expect(r.meta).toBe(6000);
    expect(r.faltaPorContratar).toBe(4800);
  });

  it("por cliente o tipo no hay 'falta', sino participacion en la meta", () => {
    const r = resumenIngresos([anual, mediawatch], metas, 2026, HOY, { ...SIN_FILTRO_ING, clienteId: 2 });
    expect(r.contratado).toBe(1200);
    expect(r.faltaPorContratar).toBeNull();
    expect(r.contraRitmo).toBeNull();
    expect(r.participacion).toBeCloseTo(1200 / 20000);
    expect(resumenIngresos([anual, mediawatch], metas, 2026, HOY, { ...SIN_FILTRO_ING, tipo: "Fee" }).contratado).toBe(12000);
  });

  it("quien no ve la direccion mide contra la suma de las metas de sus unidades", () => {
    expect(metaBase({ direccion: null, unidades: { 10: 5000, 20: 2500 } }, SIN_FILTRO_ING)).toBe(7500);
    expect(metaBase({ direccion: null, unidades: { 10: 5000 } }, { ...SIN_FILTRO_ING, unidadId: 30 })).toBeNull();
    expect(metaBase({ direccion: null, unidades: {} }, SIN_FILTRO_ING)).toBeNull();
  });
});

describe("tarjetas por unidad", () => {
  const unidades = [{ id: 10, nombre: "Insights" }, { id: 20, nombre: "Mediawatch" }, { id: 30, nombre: "Sin nada" }];

  it("total, porcentaje de su meta y peso en la meta de la direccion; omite las unidades sin nada", () => {
    const t = tarjetasPorUnidad([anual, mediawatch], unidades, metas, 2026, SIN_FILTRO_ING);
    expect(t.map((x) => x.nombre)).toEqual(["Insights", "Mediawatch"]);
    expect(t[0]).toMatchObject({ total: 12000, meta: 12000, porMeta: 1, pesoEnMeta: 0.6 });
    expect(t[1]).toMatchObject({ total: 1200, meta: 6000, porMeta: 0.2, pesoEnMeta: 0.3 });
  });

  it("no se filtra por unidad pero si por cliente", () => {
    const t = tarjetasPorUnidad([anual, mediawatch], unidades, metas, 2026, { ...SIN_FILTRO_ING, unidadId: 10, clienteId: 2 });
    expect(t.find((x) => x.unidadId === 20)?.total).toBe(1200);
    expect(t.find((x) => x.unidadId === 10)?.total).toBe(0);
  });

  it("una unidad con meta pero sin contratos aparece en cero", () => {
    const t = tarjetasPorUnidad([], unidades, { direccion: null, unidades: { 30: 100 } }, 2026, SIN_FILTRO_ING);
    expect(t).toEqual([{ unidadId: 30, nombre: "Sin nada", total: 0, meta: 100, porMeta: 0, pesoEnMeta: 100 / 100 }]);
  });
});

describe("meta total: calculada por defecto, fijada solo si alguien la cambia", () => {
  it("sin valor fijado es la suma de las unidades que se ven, sin que nadie la teclee", () => {
    const sola = { direccion: null, unidades: { 10: 12000, 20: 6000 } };
    expect(metaBase(sola, SIN_FILTRO_ING)).toBe(18000);
    expect(origenDeMeta(sola)).toEqual({ sumaUnidades: 18000, fijada: null });
    expect(resumenIngresos([anual], sola, 2026, HOY, SIN_FILTRO_ING).meta).toBe(18000);
  });

  it("cada quien suma la suya: una cadena con menos unidades tiene una meta menor", () => {
    expect(metaBase({ direccion: null, unidades: { 10: 12000 } }, SIN_FILTRO_ING)).toBe(12000);
  });

  it("un valor fijado a mano manda sobre la suma, y se sabe cuanto sumaria", () => {
    const fijada = { direccion: 20000, unidades: { 10: 12000, 20: 6000 } };
    expect(metaBase(fijada, SIN_FILTRO_ING)).toBe(20000);
    expect(origenDeMeta(fijada)).toEqual({ sumaUnidades: 18000, fijada: 20000 });
  });

  it("con una unidad filtrada siempre manda la de la unidad", () => {
    expect(metaBase({ direccion: 20000, unidades: { 10: 12000 } }, { ...SIN_FILTRO_ING, unidadId: 10 })).toBe(12000);
  });

  it("el peso de cada unidad se mide contra la meta total vigente", () => {
    const unidades = [{ id: 10, nombre: "Insights" }, { id: 20, nombre: "Mediawatch" }];
    const calculada = tarjetasPorUnidad([anual], unidades, { direccion: null, unidades: { 10: 12000, 20: 6000 } }, 2026, SIN_FILTRO_ING);
    expect(calculada.find((t) => t.unidadId === 10)?.pesoEnMeta).toBeCloseTo(12000 / 18000);
  });
});

describe("series y tabla", () => {
  const r = resumenIngresos([anual, mediawatch], metas, 2026, HOY, SIN_FILTRO_ING);

  it("por mes y por unidad", () => {
    const s = porMesPorUnidad(r.filas);
    expect(s.map((x) => [x.nombre, x.total])).toEqual([["Insights", 12000], ["Mediawatch", 1200]]);
    expect(s[1].meses).toEqual([0, 0, 300, 300, 300, 300, 0, 0, 0, 0, 0, 0]);
  });

  it("tabla por cliente, por unidad y contrato a contrato", () => {
    expect(tablaMensual(r.filas, "cliente").map((x) => [x.etiqueta, x.total])).toEqual([["Altice", 12000], ["Claro", 1200]]);
    expect(tablaMensual(r.filas, "unidad").map((x) => x.etiqueta)).toEqual(["Insights", "Mediawatch"]);
    const porContrato = tablaMensual(r.filas, "cliente", true);
    expect(porContrato).toHaveLength(2);
    expect(porContrato[0]).toMatchObject({ etiqueta: "Insights · Fee", contratoId: anual.id });
  });

  it("suma varios contratos del mismo cliente", () => {
    const dos = resumenIngresos([anual, c({ monto: 600, inicio: "2026-01-01", fin: "2026-06-30" })], metas, 2026, HOY, SIN_FILTRO_ING);
    const t = tablaMensual(dos.filas, "cliente");
    expect(t).toHaveLength(1);
    expect(t[0].meses[0]).toBe(1100);
    expect(t[0].total).toBe(12600);
  });
});
