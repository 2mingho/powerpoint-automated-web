import { describe, expect, it } from "vitest";
import { alternar, pasaFiltros, SIN_FILTROS, type TareaFiltrable } from "./filtros";

const HOY = "2026-10-08";
const t = (o: Partial<TareaFiltrable> = {}): TareaFiltrable => ({
  estado: "en_curso",
  entrega: "2026-10-14",
  horas: 4,
  unidad: "u1",
  cliente: "c1",
  persona: "p1",
  tipo: "Fee",
  contrato: "Anual",
  ...o,
});

describe("filtros cruzados", () => {
  it("sin filtros pasa todo, incluso sin entrega", () => {
    expect(pasaFiltros(t(), SIN_FILTROS, HOY)).toBe(true);
    expect(pasaFiltros(t({ entrega: null }), SIN_FILTROS, HOY)).toBe(true);
  });

  it("el rango incluye ambos extremos y deja fuera lo que no tiene entrega", () => {
    const f = { ...SIN_FILTROS, desde: "2026-10-14", hasta: "2026-10-14" };
    expect(pasaFiltros(t(), f, HOY)).toBe(true);
    expect(pasaFiltros(t({ entrega: "2026-10-13" }), f, HOY)).toBe(false);
    expect(pasaFiltros(t({ entrega: "2026-10-15" }), f, HOY)).toBe(false);
    expect(pasaFiltros(t({ entrega: null }), f, HOY)).toBe(false);
  });

  it("combina las dimensiones con Y", () => {
    const f = { ...SIN_FILTROS, cliente: "c1", persona: "p2" };
    expect(pasaFiltros(t(), f, HOY)).toBe(false);
    expect(pasaFiltros(t({ persona: "p2" }), f, HOY)).toBe(true);
  });

  it("omitir salta solo la dimension que se pinta", () => {
    const f = { ...SIN_FILTROS, cliente: "c2", persona: "p2" };
    const tarea = t({ cliente: "c1", persona: "p2" });
    expect(pasaFiltros(tarea, f, HOY)).toBe(false);
    expect(pasaFiltros(tarea, f, HOY, "cliente")).toBe(true);
    expect(pasaFiltros(tarea, f, HOY, "persona")).toBe(false);
  });

  it("semana filtra por el lunes de la entrega", () => {
    const f = { ...SIN_FILTROS, semana: "2026-10-12" };
    expect(pasaFiltros(t({ entrega: "2026-10-18" }), f, HOY)).toBe(true);
    expect(pasaFiltros(t({ entrega: "2026-10-19" }), f, HOY)).toBe(false);
    expect(pasaFiltros(t({ entrega: null }), f, HOY)).toBe(false);
  });

  it("estado compara el estado; 'vencida' compara el riesgo", () => {
    expect(pasaFiltros(t({ estado: "bloqueada" }), { ...SIN_FILTROS, estado: "bloqueada" }, HOY)).toBe(true);
    expect(pasaFiltros(t({ estado: "hecha" }), { ...SIN_FILTROS, estado: "bloqueada" }, HOY)).toBe(false);
    const vencida = { ...SIN_FILTROS, estado: "vencida" };
    expect(pasaFiltros(t({ entrega: "2026-10-01" }), vencida, HOY)).toBe(true);
    expect(pasaFiltros(t({ entrega: "2026-10-01", estado: "hecha" }), vencida, HOY)).toBe(false);
    expect(pasaFiltros(t(), vencida, HOY)).toBe(false);
  });

  it("unidad filtra por la unidad de la tarea", () => {
    const f = { ...SIN_FILTROS, unidad: "u2" };
    expect(pasaFiltros(t(), f, HOY)).toBe(false);
    expect(pasaFiltros(t({ unidad: "u2" }), f, HOY)).toBe(true);
    expect(pasaFiltros(t(), f, HOY, "unidad")).toBe(true);
  });

  it("'abierta' deja pasar todo lo que no esta hecho", () => {
    const f = { ...SIN_FILTROS, estado: "abierta" };
    expect(pasaFiltros(t({ estado: "pendiente" }), f, HOY)).toBe(true);
    expect(pasaFiltros(t({ estado: "bloqueada" }), f, HOY)).toBe(true);
    expect(pasaFiltros(t({ estado: "hecha" }), f, HOY)).toBe(false);
  });

  it("alternar activa, cambia y quita sin tocar el rango", () => {
    const a = alternar({ ...SIN_FILTROS, desde: "2026-10-01" }, "cliente", "c1");
    expect(a).toMatchObject({ cliente: "c1", desde: "2026-10-01" });
    expect(alternar(a, "cliente", "c2").cliente).toBe("c2");
    expect(alternar(a, "cliente", "c1").cliente).toBe("");
  });
});
