import { describe, expect, it } from "vitest";
import { efectosDeEstado, esEstadoDeBloqueo, esEstadoDeRevision, grupoDeEstado, leerHoras, puedeCambiarRevisor, puedeCerrar } from "./estado";

const AHORA = new Date("2026-10-09T15:00:00Z");

describe("horas estimadas", () => {
  it("vacio o nulo las quitan", () => {
    for (const v of [null, undefined, "", "  "]) expect(leerHoras(v)).toEqual({ ok: true, valor: null });
  });

  it("acepta numeros y texto, con coma o punto, y redondea a dos decimales", () => {
    expect(leerHoras(6)).toEqual({ ok: true, valor: 6 });
    expect(leerHoras("2,5")).toEqual({ ok: true, valor: 2.5 });
    expect(leerHoras(" 1.256 ")).toEqual({ ok: true, valor: 1.26 });
    expect(leerHoras(1000)).toEqual({ ok: true, valor: 1000 });
  });

  it("rechaza cero, negativos, topes, texto y valores no numericos", () => {
    for (const v of [0, -1, 1000.5, "abc", "1e9999", Number.NaN, Infinity, {}, [], true]) {
      expect(leerHoras(v).ok, String(v)).toBe(false);
    }
  });
});

describe("estado de bloqueo", () => {
  it("se reconoce por el nombre", () => {
    expect(esEstadoDeBloqueo("Bloqueado")).toBe(true);
    expect(esEstadoDeBloqueo("En bloqueo")).toBe(true);
    expect(esEstadoDeBloqueo("En Progreso")).toBe(false);
  });
});

describe("efectos del cambio de estado", () => {
  it("cerrar fija done_at y borra el motivo de bloqueo", () => {
    expect(efectosDeEstado(false, true, AHORA)).toEqual({ done_at: AHORA, block_reason: null });
  });

  it("reabrir quita done_at y deja el resto", () => {
    expect(efectosDeEstado(true, false, AHORA)).toEqual({ done_at: null });
  });

  it("entre abiertos o entre cerrados no cambia nada", () => {
    expect(efectosDeEstado(false, false, AHORA)).toEqual({});
    expect(efectosDeEstado(true, true, AHORA)).toEqual({});
  });
});

describe("aprobacion por revisor", () => {
  it("sin revisor cualquiera cierra", () => {
    expect(puedeCerrar(null, 1, false)).toBe(true);
  });

  it("con revisor solo cierra el revisor o quien lidera", () => {
    expect(puedeCerrar(7, 1, false)).toBe(false);
    expect(puedeCerrar(7, 7, false)).toBe(true);
    expect(puedeCerrar(7, 1, true)).toBe(true);
  });

  it("quitar o cambiar un revisor existente sigue la misma regla; ponerlo la primera vez es libre", () => {
    expect(puedeCambiarRevisor(null, 1, false)).toBe(true);
    expect(puedeCambiarRevisor(7, 1, false)).toBe(false);
    expect(puedeCambiarRevisor(7, 7, false)).toBe(true);
    expect(puedeCambiarRevisor(7, 1, true)).toBe(true);
  });
});

describe("grupoDeEstado", () => {
  const e = (nombre: string, esInicial = false, esFinal = false) => ({ nombre, esInicial, esFinal });
  it("clasifica los estados del catalogo en los cinco grupos", () => {
    expect(grupoDeEstado(e("Completado", false, true))).toBe("hecha");
    expect(grupoDeEstado(e("Bloqueado"))).toBe("bloqueada");
    expect(grupoDeEstado(e("En revisión"))).toBe("revision");
    expect(grupoDeEstado(e("Pendiente", true))).toBe("pendiente");
    expect(grupoDeEstado(e("En Progreso"))).toBe("en_curso");
  });
  it("final manda sobre el nombre", () => {
    expect(grupoDeEstado(e("Bloqueado y cerrado", false, true))).toBe("hecha");
  });
});

describe("esEstadoDeRevision", () => {
  it("reconoce el estado de revision por el nombre", () => {
    for (const n of ["En Revisión", "En revision", "Revisión", "revisar"]) expect(esEstadoDeRevision(n), n).toBe(true);
    for (const n of ["Pendiente", "En Progreso", "Completado", ""]) expect(esEstadoDeRevision(n), n).toBe(false);
  });
});
