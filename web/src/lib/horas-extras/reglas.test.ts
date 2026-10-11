import { describe, expect, it } from "vitest";
import {
  avisoDeLimite, claveDePeriodo, leerHoras, leerLimite, leerRegistro, mesesDelTrimestre, mitadDe, nivelDeLimite, periodoAnterior, periodoDe, periodosDelTrimestre,
  periodoCoherente, redondear, rotuloPeriodo, trimestreDe,
} from "./reglas";

describe("quincenas y trimestres", () => {
  it("del 1 al 15 es la quincena 15; del 16 al fin de mes, la 30", () => {
    expect(mitadDe("2026-09-01")).toBe(15);
    expect(mitadDe("2026-09-15")).toBe(15);
    expect(mitadDe("2026-09-16")).toBe(30);
    expect(mitadDe("2026-02-28")).toBe(30);
    expect(periodoDe("2026-09-22")).toEqual({ anio: 2026, mes: 9, mitad: 30 });
  });

  it("trimestres naturales: abril a junio es el 2", () => {
    expect([1, 3, 4, 6, 7, 9, 10, 12].map(trimestreDe)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(mesesDelTrimestre(2)).toEqual([4, 5, 6]);
    expect(periodosDelTrimestre(2026, 3).map(claveDePeriodo)).toEqual(["2026-07-15", "2026-07-30", "2026-08-15", "2026-08-30", "2026-09-15", "2026-09-30"]);
  });

  it("el rotulo es el del encabezado del Excel", () => {
    expect(rotuloPeriodo({ anio: 2026, mes: 9, mitad: 30 })).toBe("2DA. QUINCENA DE SEPTIEMBRE 2026");
    expect(rotuloPeriodo({ anio: 2026, mes: 1, mitad: 15 }, false)).toBe("1ra. quincena de enero 2026");
  });

  it("el periodo anterior cruza meses y años", () => {
    expect(periodoAnterior({ anio: 2026, mes: 9, mitad: 30 })).toEqual({ anio: 2026, mes: 9, mitad: 15 });
    expect(periodoAnterior({ anio: 2026, mes: 9, mitad: 15 })).toEqual({ anio: 2026, mes: 8, mitad: 30 });
    expect(periodoAnterior({ anio: 2026, mes: 1, mitad: 15 })).toEqual({ anio: 2025, mes: 12, mitad: 30 });
  });
});

describe("horas", () => {
  it("acepta numeros y texto con coma o punto, hasta dos decimales", () => {
    expect(leerHoras(3)).toEqual({ ok: true, valor: 3 });
    expect(leerHoras("6,5")).toEqual({ ok: true, valor: 6.5 });
    expect(leerHoras("2.25")).toEqual({ ok: true, valor: 2.25 });
    expect(leerHoras(24)).toEqual({ ok: true, valor: 24 });
  });
  it("rechaza cero, negativos, mas de 24, tres decimales y basura", () => {
    for (const malo of [0, -1, 24.5, 1.234, "abc", "", null, undefined, NaN, "1.2.3"]) expect(leerHoras(malo).ok, String(malo)).toBe(false);
  });
  it("sumar no arrastra decimales", () => expect(redondear(0.1 + 0.2)).toBe(0.3));
});

describe("maximo por trimestre", () => {
  it("acepta de 0.01 a 400, con coma o punto", () => {
    for (const bien of [80, "80", "60,5", 400, 0.5]) expect(leerLimite(bien).ok, String(bien)).toBe(true);
  });
  it("rechaza cero, negativos, mas de 400, tres decimales y basura", () => {
    for (const malo of [0, -1, 401, "abc", 12.345, "", null, NaN]) expect(leerLimite(malo).ok, String(malo)).toBe(false);
  });
});

describe("registro", () => {
  const base = { personaId: 4, fecha: "2026-09-14", detalle: "  Cobertura   medios  ", horario: "08:00-11:00 PM", horas: "3" };
  it("normaliza espacios y toma el periodo de la fecha", () => {
    expect(leerRegistro(base)).toEqual({ ok: true, valor: { personaId: 4, fecha: "2026-09-14", detalle: "Cobertura medios", horario: "08:00-11:00 PM", horas: 3, periodo: { anio: 2026, mes: 9, mitad: 15 } } });
  });
  it("se puede registrar tarde en otro reporte: dias de agosto en la 2da quincena de septiembre", () => {
    const r = leerRegistro({ ...base, fecha: "2026-08-31", periodo: { anio: 2026, mes: 9, mitad: 30 } });
    expect(r.ok && r.valor.periodo).toEqual({ anio: 2026, mes: 9, mitad: 30 });
  });
  it("pide persona, dia valido y detalle, y acota los largos", () => {
    expect(leerRegistro({ ...base, personaId: "" }).ok).toBe(false);
    expect(leerRegistro({ ...base, fecha: "2026-02-30" }).ok).toBe(false);
    expect(leerRegistro({ ...base, detalle: "   " }).ok).toBe(false);
    expect(leerRegistro({ ...base, detalle: "x".repeat(301) }).ok).toBe(false);
    expect(leerRegistro({ ...base, horario: "x".repeat(121) }).ok).toBe(false);
    expect(leerRegistro({ ...base, horario: undefined })).toMatchObject({ ok: true });
  });
  it("rechaza un periodo imposible", () => {
    for (const periodo of [{ anio: 2026, mes: 13, mitad: 15 }, { anio: 2026, mes: 9, mitad: 20 }, { anio: 1999, mes: 9, mitad: 15 }, {}]) {
      expect(leerRegistro({ ...base, periodo }).ok).toBe(false);
    }
  });
});

describe("limite", () => {
  it("niveles del mapa de calor", () => {
    expect([0, 39, 40, 59, 60, 71, 72, 80, 81].map((h) => nivelDeLimite(h, 80))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    expect(nivelDeLimite(0, 0)).toBe(0);
    expect(nivelDeLimite(1, 0)).toBe(4);
  });
  it("avisa desde el 90 % y marca el exceso, sin bloquear", () => {
    expect([0, 71.9, 72, 80, 80.5].map((h) => avisoDeLimite(h, 80))).toEqual(["", "", "cerca", "cerca", "excedido"]);
  });
});

describe("reporte coherente con el dia trabajado", () => {
  it("el de su fecha o uno posterior, hasta seis meses despues", () => {
    expect(periodoCoherente("2026-08-31", { anio: 2026, mes: 8, mitad: 30 }).ok).toBe(true);
    expect(periodoCoherente("2026-08-31", { anio: 2026, mes: 9, mitad: 30 }).ok).toBe(true);
    expect(periodoCoherente("2026-08-31", { anio: 2027, mes: 2, mitad: 30 }).ok).toBe(true);
    expect(periodoCoherente("2026-08-31", { anio: 2027, mes: 3, mitad: 15 }).ok).toBe(false);
  });
  it("nunca por adelantado", () => {
    expect(periodoCoherente("2026-09-16", { anio: 2026, mes: 9, mitad: 15 }).ok).toBe(false);
    expect(periodoCoherente("2026-09-16", { anio: 2026, mes: 8, mitad: 30 }).ok).toBe(false);
    expect(periodoCoherente("2026-01-02", { anio: 2025, mes: 12, mitad: 30 }).ok).toBe(false);
  });
});
