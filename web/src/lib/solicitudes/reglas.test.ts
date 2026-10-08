import { describe, expect, it } from "vitest";
import { enlaceNuevo, esFechaIso, leerMotivo, leerNuevaSolicitud, ordenarBandeja, salioDeLaBandeja } from "./reglas";

describe("leerNuevaSolicitud", () => {
  it("exige titulo y unidad", () => {
    expect(leerNuevaSolicitud({ titulo: " ", unidadDestinoId: 2 }).ok).toBe(false);
    expect(leerNuevaSolicitud({ titulo: "x", unidadDestinoId: "a" }).ok).toBe(false);
    expect(leerNuevaSolicitud({ titulo: " x ", unidadDestinoId: "2" })).toMatchObject({ ok: true, datos: { titulo: "x", unidadDestinoId: 2, entrega: null } });
  });
  it("rechaza fechas imposibles", () => {
    expect(esFechaIso("2026-02-31")).toBe(false);
    expect(esFechaIso("2026-02-28")).toBe(true);
    expect(leerNuevaSolicitud({ titulo: "x", unidadDestinoId: 2, entrega: "31/12/2026" }).ok).toBe(false);
  });
});

it("el motivo de rechazo tiene minimo 5 caracteres", () => {
  expect(leerMotivo({ motivo: " abcd " }).ok).toBe(false);
  expect(leerMotivo({ motivo: "abcde" })).toEqual({ ok: true, motivo: "abcde" });
});

it("ordena: pendientes por entrega (sin fecha al final), luego resueltas recientes", () => {
  const f = (id: number, estado: string, entrega: string, resuelta: string | null = null) => ({ id, estado, entrega, enviada: "2026-10-01T00:00:00Z", resuelta });
  const r = ordenarBandeja([
    f(1, "Aceptada", "2026-10-01", "2026-10-02T00:00:00Z"),
    f(2, "Pendiente", ""),
    f(3, "Pendiente", "2026-10-09"),
    f(4, "Pendiente", "2026-10-05"),
    f(5, "Rechazada", "", "2026-10-07T00:00:00Z"),
  ]);
  expect(r.map((x) => x.id)).toEqual([4, 3, 2, 5, 1]);
});

it("traduce los enlaces de Flask y descarta los externos", () => {
  expect(enlaceNuevo("/tasks?task=12")).toBe("/tareas?tarea=12");
  expect(enlaceNuevo("/task-requests")).toBe("/solicitudes");
  expect(enlaceNuevo("https://malo.example")).toBeNull();
  expect(enlaceNuevo("//malo.example")).toBeNull();
  expect(enlaceNuevo("/solicitudes?solicitud=3")).toBe("/solicitudes?solicitud=3");
});

it("lo resuelto hace mas de 14 dias sale de la bandeja", () => {
  const ahora = Date.parse("2026-10-20T00:00:00Z");
  expect(salioDeLaBandeja("2026-10-01T00:00:00Z", ahora)).toBe(true);
  expect(salioDeLaBandeja("2026-10-10T00:00:00Z", ahora)).toBe(false);
  expect(salioDeLaBandeja(null, ahora)).toBe(false);
});
