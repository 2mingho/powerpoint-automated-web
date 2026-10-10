import { describe, expect, it } from "vitest";
import { mapaDeCalor, resumirVencidas, semanasDesde, type TareaDeCarga } from "./mapa-calor";
import { leerCapacidad } from "./estado";

// 2026-10-08 es jueves; la semana empieza el lunes 10-05.
const HOY = "2026-10-08";
const SEMANAS = semanasDesde(HOY, 4);
const tarea = (o: Partial<TareaDeCarga> = {}): TareaDeCarga => ({
  estado: "en_curso", entrega: "2026-10-09", inicio: "2026-10-08", horas: 12, personaId: 1, estimada: true, ...o,
});

describe("semanas", () => {
  it("lunes de esta semana y las tres siguientes", () => {
    expect(SEMANAS).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(semanasDesde("2026-10-11", 2)).toEqual(["2026-10-05", "2026-10-12"]); // domingo: aun es la semana del 5
  });
});

describe("mapa de calor", () => {
  const ana = { id: 1, nombre: "Ana", capacidad: 35 };

  it("razon, horas y nivel por semana", () => {
    const [f] = mapaDeCalor([ana], [tarea({ horas: 35, inicio: "2026-10-08", entrega: "2026-10-09" })], SEMANAS, HOY);
    expect(f.celdas[0]).toMatchObject({ horas: 35, razon: 1, nivel: 3, tareas: 1, sinEstimar: 0 });
    expect(f.celdas[1]).toMatchObject({ horas: 0, razon: 0, nivel: 0, tareas: 0 });
    expect(f.pico).toBe(1);
  });

  it("una tarea sin estimar cuenta 4 h y se marca", () => {
    const [f] = mapaDeCalor([ana], [tarea({ horas: 99, estimada: false })], SEMANAS, HOY);
    expect(f.celdas[0]).toMatchObject({ horas: 4, tareas: 1, sinEstimar: 1 });
  });

  it("capacidad nula usa 35 h; con 0 la persona no se pinta; otra capacidad cambia la razon", () => {
    const t = tarea({ horas: 14, inicio: "2026-10-08", entrega: "2026-10-09" });
    const filas = mapaDeCalor([{ id: 1, nombre: "Ana", capacidad: null }, { id: 2, nombre: "Dir", capacidad: 0 }, { id: 3, nombre: "Pedro", capacidad: 20 }],
      [t, { ...t, personaId: 2 }, { ...t, personaId: 3 }], SEMANAS, HOY);
    expect(filas.map((x) => x.nombre)).toEqual(["Pedro", "Ana"]);
    expect(filas[1].capacidad).toBe(35);
    expect(filas[0].celdas[0].razon).toBeCloseTo(14 / 20, 6);
    expect(filas[0].celdas[0].nivel).toBe(1);
  });

  it("reparte una tarea entre semanas y cuenta la tarea en cada una", () => {
    const [f] = mapaDeCalor([ana], [tarea({ horas: 12, inicio: "2026-10-08", entrega: "2026-10-13" })], SEMANAS, HOY);
    expect(f.celdas.map((c) => [c.horas, c.tareas])).toEqual([[6, 1], [6, 1], [0, 0], [0, 0]]);
  });

  it("ordena por el pico mas alto y luego por nombre; ignora hechas y tareas de quien no esta en la lista", () => {
    const base = { horas: 10, inicio: "2026-10-08", entrega: "2026-10-09" };
    const filas = mapaDeCalor(
      [{ id: 1, nombre: "Zoe", capacidad: 35 }, { id: 2, nombre: "Ana", capacidad: 35 }, { id: 3, nombre: "Bea", capacidad: 35 }],
      [tarea({ ...base, personaId: 1 }), tarea({ ...base, horas: 30, personaId: 3 }), tarea({ ...base, personaId: 2, estado: "hecha" }), tarea({ ...base, personaId: 99 })],
      SEMANAS, HOY);
    expect(filas.map((f) => f.nombre)).toEqual(["Bea", "Zoe", "Ana"]);
    expect(filas[2].celdas[0].horas).toBe(0);
  });

  it("una persona sin tareas sale con todo en cero", () => {
    const [f] = mapaDeCalor([ana], [], SEMANAS, HOY);
    expect(f.celdas.every((c) => c.horas === 0 && c.nivel === 0)).toBe(true);
    expect(f.pico).toBe(0);
  });
});

describe("capacidad semanal", () => {
  it("vacio la quita; acepta enteros de 0 a 80", () => {
    expect(leerCapacidad("")).toEqual({ ok: true, valor: null });
    expect(leerCapacidad(null)).toEqual({ ok: true, valor: null });
    expect(leerCapacidad("0")).toEqual({ ok: true, valor: 0 });
    expect(leerCapacidad(35)).toEqual({ ok: true, valor: 35 });
    expect(leerCapacidad("80")).toEqual({ ok: true, valor: 80 });
  });

  it("rechaza negativos, decimales, mas de 80 y texto", () => {
    for (const v of [-1, 35.5, 81, "abc", "1e3", true, {}]) expect(leerCapacidad(v).ok, String(v)).toBe(false);
  });
});

describe("vencidas sumadas aparte (lo que hace la base)", () => {
  const personas = [{ id: 1, nombre: "Ana", capacidad: 35 }, { id: 2, nombre: "Beto", capacidad: 20 }];
  const t = (o: Partial<TareaDeCarga>): TareaDeCarga => tarea({ inicio: null, ...o });
  const lista: TareaDeCarga[] = [
    t({ entrega: "2026-10-01", horas: 8, personaId: 1 }), // vencida
    t({ entrega: "2026-09-10", horas: 3, personaId: 1, pasosTotal: 4, pasosHechos: 1 }), // vencida con avance
    t({ entrega: "2026-09-20", horas: 5, personaId: 1, pasosTotal: 2, pasosHechos: 2 }), // vencida terminada por pasos: no aporta
    t({ entrega: "2026-10-02", horas: 0, estimada: false, personaId: 2 }), // vencida sin estimar: 4 h
    t({ entrega: "2026-10-07", horas: 6, personaId: 2, estado: "hecha" }), // hecha: no cuenta
    t({ entrega: "2026-10-08", horas: 6, personaId: 1 }), // vence hoy: no es vencida
    t({ entrega: "2026-10-15", horas: 10, inicio: "2026-10-13", personaId: 2 }),
    t({ entrega: "2026-11-30", horas: 30, personaId: 1 }), // lejos de la ventana
  ];

  it("da el mismo mapa que repartir cada vencida una a una", () => {
    const todas = mapaDeCalor(personas, lista, SEMANAS, HOY);
    const vencidas = resumirVencidas(lista, HOY);
    const sinVencidas = lista.filter((x) => !(x.estado !== "hecha" && x.entrega && x.entrega < HOY));
    expect(mapaDeCalor(personas, sinVencidas, SEMANAS, HOY, vencidas)).toEqual(todas);
  });

  it("solo cuentan las que tienen horas pendientes y las sin estimar llevan 4 h y su marca", () => {
    const v = resumirVencidas(lista, HOY);
    expect(v.get(1)).toEqual({ tareas: 2, sinEstimar: 0, horas: 8 + 3 * (1 - 1 / 4) });
    expect(v.get(2)).toEqual({ tareas: 1, sinEstimar: 1, horas: 4 });
  });
});
