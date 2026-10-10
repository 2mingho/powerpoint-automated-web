import { describe, expect, it } from "vitest";
import { avance, cargaPorSemana, habilesEntre, inicioDe, nivelDeCarga, puntualidad, riesgoDe, sumarHabiles, type TareaSeg } from "./riesgo";

// 2026-10-08 es jueves; 10-10 y 10-11 son fin de semana.
const HOY = "2026-10-08";
const tarea = (o: Partial<TareaSeg> = {}): TareaSeg => ({ estado: "pendiente", entrega: "2026-10-20", horas: 4, ...o });

describe("dias habiles", () => {
  it("habilesEntre cuenta lunes a viernes, extremos incluidos", () => {
    expect(habilesEntre("2026-10-08", "2026-10-13")).toEqual(["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"]);
    expect(habilesEntre("2026-10-10", "2026-10-11")).toEqual([]);
    expect(habilesEntre("2026-10-13", "2026-10-08")).toEqual([]);
  });

  it("sumarHabiles salta fines de semana en las dos direcciones", () => {
    expect(sumarHabiles("2026-10-08", 1)).toBe("2026-10-09");
    expect(sumarHabiles("2026-10-08", 2)).toBe("2026-10-12");
    expect(sumarHabiles("2026-10-12", -1)).toBe("2026-10-09");
  });

  it("desde un sabado primero se corre al habil en la direccion del avance", () => {
    expect(sumarHabiles("2026-10-10", 0)).toBe("2026-10-12");
    expect(sumarHabiles("2026-10-10", 1)).toBe("2026-10-13");
    expect(sumarHabiles("2026-10-10", -1)).toBe("2026-10-08");
  });
});

describe("inicio y avance", () => {
  it("el inicio retrocede un dia habil por cada 6 h por encima de la primera jornada", () => {
    expect(inicioDe({ entrega: "2026-10-12", inicio: null, horas: 4 })).toBe("2026-10-12");
    expect(inicioDe({ entrega: "2026-10-12", inicio: null, horas: 6 })).toBe("2026-10-12");
    expect(inicioDe({ entrega: "2026-10-12", inicio: null, horas: 13 })).toBe("2026-10-08");
    expect(inicioDe({ entrega: "2026-10-12", inicio: "2026-10-01", horas: 13 })).toBe("2026-10-01");
    expect(inicioDe({ entrega: null, inicio: null, horas: 4 })).toBeNull();
  });

  it("avance: por pasos, o 1 si esta hecha y 0 si no", () => {
    expect(avance({ estado: "en_curso", pasosHechos: 1, pasosTotal: 4 })).toBe(0.25);
    expect(avance({ estado: "en_curso", pasosHechos: 9, pasosTotal: 4 })).toBe(1);
    expect(avance({ estado: "hecha" })).toBe(1);
    expect(avance({ estado: "en_curso", pasosTotal: 0 })).toBe(0);
  });
});

describe("riesgo", () => {
  it("hecha o sin entrega: sin riesgo", () => {
    expect(riesgoDe(tarea({ estado: "hecha", entrega: "2026-10-01" }), HOY)).toBe("");
    expect(riesgoDe(tarea({ entrega: null }), HOY)).toBe("");
  });

  it("vencida gana a bloqueada", () => {
    expect(riesgoDe(tarea({ entrega: "2026-10-07" }), HOY)).toBe("vencida");
    expect(riesgoDe(tarea({ estado: "bloqueada", entrega: "2026-10-07" }), HOY)).toBe("vencida");
  });

  it("bloqueada con plazo vigente", () => {
    expect(riesgoDe(tarea({ estado: "bloqueada", entrega: "2026-10-30" }), HOY)).toBe("bloqueada");
  });

  it("en riesgo: dos dias habiles o menos y sin arrancar o por debajo de la mitad", () => {
    expect(riesgoDe(tarea({ entrega: "2026-10-09" }), HOY)).toBe("en_riesgo");
    expect(riesgoDe(tarea({ entrega: HOY }), HOY)).toBe("en_riesgo");
    expect(riesgoDe(tarea({ estado: "en_curso", entrega: "2026-10-09" }), HOY)).toBe("en_riesgo");
    expect(riesgoDe(tarea({ estado: "en_curso", entrega: "2026-10-09", pasosHechos: 1, pasosTotal: 4 }), HOY)).toBe("en_riesgo");
    expect(riesgoDe(tarea({ estado: "en_curso", entrega: "2026-10-09", pasosHechos: 2, pasosTotal: 4 }), HOY)).toBe("");
  });

  it("con tres dias habiles por delante no hay riesgo", () => {
    expect(riesgoDe(tarea({ entrega: "2026-10-12" }), HOY)).toBe("");
  });

  it("los dias habiles no cuentan el fin de semana: sabado a lunes queda uno", () => {
    expect(riesgoDe(tarea({ estado: "en_curso", entrega: "2026-10-12" }), "2026-10-10")).toBe("en_riesgo");
  });
});

describe("puntualidad", () => {
  const entrega = (o: Partial<TareaSeg>) => tarea({ esEntrega: true, estado: "hecha", entrega: "2026-10-05", hechaEl: "2026-10-05", ...o });

  it("sin entregas cerradas en 30 dias: null, no 100", () => {
    expect(puntualidad([], HOY)).toBeNull();
    expect(puntualidad([tarea({ estado: "hecha", hechaEl: HOY })], HOY)).toBeNull();
  });

  it("redondea el porcentaje a tiempo", () => {
    const lista = [entrega({}), entrega({ hechaEl: "2026-10-04" }), entrega({ hechaEl: "2026-10-07" })];
    expect(puntualidad(lista, HOY)).toBe(67);
  });

  it("ignora lo cerrado hace mas de 30 dias; el limite cuenta", () => {
    expect(puntualidad([entrega({ entrega: "2026-09-08", hechaEl: "2026-09-08" })], HOY)).toBe(100);
    expect(puntualidad([entrega({ entrega: "2026-09-07", hechaEl: "2026-09-07" })], HOY)).toBeNull();
  });
});

describe("carga por semana", () => {
  const SEMANAS = ["2026-10-05", "2026-10-12"];

  it("reparte las horas parejas entre los dias habiles de inicio a entrega", () => {
    expect(cargaPorSemana([tarea({ horas: 12, inicio: "2026-10-08", entrega: "2026-10-09" })], SEMANAS, HOY)).toEqual([12, 0]);
    expect(cargaPorSemana([tarea({ horas: 12, inicio: "2026-10-08", entrega: "2026-10-13" })], SEMANAS, HOY)).toEqual([6, 6]);
  });

  it("solo cuenta lo que falta: el avance por pasos descuenta", () => {
    const t = tarea({ estado: "en_curso", horas: 12, inicio: "2026-10-08", entrega: "2026-10-13", pasosHechos: 1, pasosTotal: 2 });
    expect(cargaPorSemana([t], SEMANAS, HOY)).toEqual([3, 3]);
  });

  it("lo que ya paso de inicio no se vuelve a cargar: se reparte desde hoy", () => {
    expect(cargaPorSemana([tarea({ horas: 8, inicio: "2026-09-01", entrega: "2026-10-09" })], SEMANAS, HOY)).toEqual([8, 0]);
  });

  it("vencida o sin dias habiles carga todo en hoy; hechas y sin entrega no cargan", () => {
    expect(cargaPorSemana([tarea({ horas: 5, entrega: "2026-10-01" })], SEMANAS, HOY)).toEqual([5, 0]);
    expect(cargaPorSemana([tarea({ horas: 4, entrega: "2026-10-10" })], SEMANAS, "2026-10-10")).toEqual([4, 0]);
    expect(cargaPorSemana([tarea({ estado: "hecha" }), tarea({ entrega: null })], SEMANAS, HOY)).toEqual([0, 0]);
  });

  it("las horas fuera de las semanas pedidas se ignoran", () => {
    expect(cargaPorSemana([tarea({ horas: 6, inicio: "2026-10-26", entrega: "2026-10-26" })], SEMANAS, HOY)).toEqual([0, 0]);
  });

  it("suma varias tareas y redondea", () => {
    const l = [tarea({ horas: 1, inicio: "2026-10-08", entrega: "2026-10-09" }), tarea({ horas: 1, inicio: "2026-10-08", entrega: "2026-10-09" })];
    expect(cargaPorSemana(l, SEMANAS, HOY)).toEqual([2, 0]);
  });
});

describe("nivel de calor", () => {
  it("respeta los cortes 40 / 75 / 95 / 110 %", () => {
    expect([0, 0.39, 0.4, 0.74, 0.75, 0.94, 0.95, 1.1, 1.11, 2].map(nivelDeCarga)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});
