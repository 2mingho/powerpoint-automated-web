import { describe, expect, it } from "vitest";
import { horasDelTrimestre, matrizDelTrimestre, reporteDePeriodo, segmentar, type EntradaHoras } from "./agregados";

let n = 0;
const e = (o: Partial<EntradaHoras> & { fecha: string; horas: number; personaId?: number }): EntradaHoras => {
  const personaId = o.personaId ?? 1;
  return { id: ++n, personaNombre: personaId === 1 ? "Anudis Reyes" : personaId === 2 ? "Celina Gonzalez" : "Dennys Faneyte", detalle: "Cobertura", horario: "", personaId, periodo: { anio: 2026, mes: 9, mitad: 30 }, ...o };
};

describe("segmentacion L-V / SAB-DOM", () => {
  it("separa por el dia de la semana trabajado", () => {
    // 2026-09-12 es sabado, 09-13 domingo, 09-14 lunes.
    expect(segmentar([{ fecha: "2026-09-12", horas: 6.5 }, { fecha: "2026-09-13", horas: 2.5 }, { fecha: "2026-09-14", horas: 4 }])).toEqual({ laborables: 4, finDeSemana: 9, total: 13 });
    expect(segmentar([])).toEqual({ laborables: 0, finDeSemana: 0, total: 0 });
  });
});

describe("reporte de una quincena (la hoja de detalle del Excel)", () => {
  // La 2da quincena de septiembre del Excel: Dennys 15 h (5 x 3), Anudis 11 h, Celina 16.5 h.
  const entradas = [
    ...["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31"].map((fecha) => e({ personaId: 3, fecha, horas: 3 })),
    e({ personaId: 1, fecha: "2026-09-14", horas: 3 }), e({ personaId: 1, fecha: "2026-09-15", horas: 1 }),
    e({ personaId: 2, fecha: "2026-09-19", horas: 1 }), e({ personaId: 2, fecha: "2026-09-15", horas: 2 }),
    e({ personaId: 2, fecha: "2026-09-05", horas: 9, periodo: { anio: 2026, mes: 9, mitad: 15 } }), // otra quincena: no entra
  ];
  const r = reporteDePeriodo(entradas, { anio: 2026, mes: 9, mitad: 30 });

  it("agrupa por persona, en orden alfabetico, y ordena sus dias por fecha", () => {
    expect(r.bloques.map((b) => b.nombre)).toEqual(["Anudis Reyes", "Celina Gonzalez", "Dennys Faneyte"]);
    expect(r.bloques[1].filas.map((f) => f.fecha)).toEqual(["2026-09-15", "2026-09-19"]);
  });
  it("totales por persona, segmentados (el sabado 19 cuenta como SAB-DOM)", () => {
    expect(r.bloques.map((b) => [b.laborables, b.finDeSemana, b.total])).toEqual([[4, 0, 4], [2, 1, 3], [15, 0, 15]]);
    expect(r.bloques[1].filas.map((f) => f.finDeSemana)).toEqual([false, true]);
  });
  it("total general y colaboradores", () => {
    expect(r.total).toBe(22);
    expect(r.colaboradores).toBe(3);
  });
  it("un periodo sin horas queda vacio", () => {
    expect(reporteDePeriodo(entradas, { anio: 2026, mes: 10, mitad: 15 })).toMatchObject({ total: 0, colaboradores: 0, bloques: [] });
  });
});

describe("matriz del trimestre contra el maximo (la hoja GENERALES)", () => {
  const p = (mes: number, mitad: 15 | 30) => ({ anio: 2026, mes, mitad });
  const entradas = [
    e({ personaId: 1, fecha: "2026-07-10", horas: 10, periodo: p(7, 15) }), e({ personaId: 1, fecha: "2026-07-25", horas: 36, periodo: p(7, 30) }),
    e({ personaId: 1, fecha: "2026-08-10", horas: 9, periodo: p(8, 15) }), e({ personaId: 1, fecha: "2026-08-20", horas: 1, periodo: p(8, 30) }),
    e({ personaId: 1, fecha: "2026-09-10", horas: 12, periodo: p(9, 15) }), e({ personaId: 1, fecha: "2026-09-20", horas: 11, periodo: p(9, 30) }),
    e({ personaId: 2, fecha: "2026-09-12", horas: 30, periodo: p(9, 15) }),
    e({ personaId: 1, fecha: "2026-06-10", horas: 5, periodo: p(6, 15) }), // otro trimestre
    e({ personaId: 3, fecha: "2026-08-12", horas: 3, periodo: p(8, 15) }), // ya no esta en la plantilla
  ];
  const m = matrizDelTrimestre(entradas, [{ id: 1, nombre: "Anudis Reyes" }, { id: 2, nombre: "Celina Gonzalez" }, { id: 4, nombre: "Sin horas" }], 2026, 3, 80);

  it("seis quincenas por persona y total del trimestre: Anudis suma 79 de 80, como el Excel", () => {
    expect(m.periodos).toHaveLength(6);
    const a = m.filas.find((f) => f.personaId === 1)!;
    expect(a.celdas.map((c) => c.horas)).toEqual([10, 36, 9, 1, 12, 11]);
    expect(a.total).toBe(79);
    expect(a.restante).toBe(1);
    expect(a.aviso).toBe("cerca");
    expect(a.nivel).toBe(3);
  });
  it("no mezcla trimestres", () => expect(m.filas.find((f) => f.personaId === 1)!.total).toBe(79));
  it("las celdas se colorean contra el ritmo (limite / 6) y el total contra el limite", () => {
    const a = m.filas.find((f) => f.personaId === 1)!;
    expect(m.ritmo).toBeCloseTo(13.333, 2);
    expect(a.celdas.map((c) => c.nivel)).toEqual([2, 4, 1, 0, 2, 2]);
  });
  it("incluye a quien no tiene horas y a quien las tiene sin estar ya en la plantilla; de mas a menos horas", () => {
    expect(m.filas.map((f) => f.nombre)).toEqual(["Anudis Reyes", "Celina Gonzalez", "Dennys Faneyte", "Sin horas"]);
    expect(m.filas.find((f) => f.personaId === 4)).toMatchObject({ total: 0, nivel: 0, aviso: "" });
  });
  it("totales por quincena y general", () => {
    expect(m.totalesPorPeriodo).toEqual([10, 36, 12, 1, 42, 11]);
    expect(m.total).toBe(112);
  });
  it("pasarse del maximo se marca, no se corta", () => {
    const f = matrizDelTrimestre([e({ fecha: "2026-09-10", horas: 24, periodo: p(9, 15) }), e({ fecha: "2026-09-11", horas: 24, periodo: p(9, 15) }), e({ fecha: "2026-09-12", horas: 24, periodo: p(9, 15) }), e({ fecha: "2026-09-13", horas: 12, periodo: p(9, 15) })], [], 2026, 3, 80).filas[0];
    expect(f).toMatchObject({ total: 84, restante: -4, aviso: "excedido", nivel: 4 });
  });
});

describe("horas ya usadas en el trimestre", () => {
  const entradas = [e({ personaId: 1, fecha: "2026-07-01", horas: 10, periodo: { anio: 2026, mes: 7, mitad: 15 } }), e({ personaId: 1, fecha: "2026-09-20", horas: 5, periodo: { anio: 2026, mes: 9, mitad: 30 } }), e({ personaId: 1, fecha: "2026-10-02", horas: 7, periodo: { anio: 2026, mes: 10, mitad: 15 } })];
  it("cuenta el trimestre del reporte y deja fuera el registro que se edita", () => {
    expect(horasDelTrimestre(entradas, 1, { anio: 2026, mes: 8, mitad: 15 })).toBe(15);
    expect(horasDelTrimestre(entradas, 1, { anio: 2026, mes: 8, mitad: 15 }, entradas[0].id)).toBe(5);
    expect(horasDelTrimestre(entradas, 2, { anio: 2026, mes: 8, mitad: 15 })).toBe(0);
  });
});
