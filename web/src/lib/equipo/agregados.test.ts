import { describe, expect, it } from "vitest";
import {
  cargaPorPersona, clasificar, contadores, generarCsv, lunesDe, mmddyyyy, sumarDias, tendencia, vencidasPorUnidad, type TareaPanel,
} from "./agregados";

const HOY = "2026-10-08"; // jueves
const finales = new Set(["Completado", "Cerrado"]);
let sig = 1;
function t(p: Partial<TareaPanel>): TareaPanel {
  return { id: sig++, estado: "Pendiente", vence: HOY, creada: new Date("2026-10-01T15:00:00Z"), actualizada: new Date("2026-10-01T15:00:00Z"), asignadoId: 1, unidadId: 10, ...p };
}

describe("fechas de negocio", () => {
  it("el lunes de un jueves es tres dias antes y un lunes es su propio lunes", () => {
    expect(lunesDe("2026-10-08")).toBe("2026-10-05");
    expect(lunesDe("2026-10-05")).toBe("2026-10-05");
    expect(lunesDe("2026-10-11")).toBe("2026-10-05"); // domingo
  });
  it("suma dias cruzando meses", () => expect(sumarDias("2026-09-29", 3)).toBe("2026-10-02"));
  it("una marca de las 02:00 UTC del lunes cae en domingo en Santo Domingo", () => {
    const k = clasificar({ estado: "Completado", vence: HOY, actualizada: new Date("2026-10-05T02:00:00Z") }, finales, HOY);
    expect(k.completadaSemana).toBe(false);
    const k2 = clasificar({ estado: "Completado", vence: HOY, actualizada: new Date("2026-10-05T05:00:00Z") }, finales, HOY);
    expect(k2.completadaSemana).toBe(true);
  });
});

describe("contadores", () => {
  it("vencidas excluye las terminadas; en riesgo son abiertas que vencen en dos dias", () => {
    const c = contadores([
      t({ vence: "2026-10-01" }), // vencida
      t({ vence: "2026-10-01", estado: "Completado", actualizada: new Date("2026-09-30T15:00:00Z") }), // tarde pero cerrada
      t({ vence: HOY }), // en riesgo (hoy)
      t({ vence: "2026-10-10" }), // en riesgo (+2)
      t({ vence: "2026-10-11" }), // fuera de riesgo
      t({ estado: "Cerrado", actualizada: new Date("2026-10-06T15:00:00Z") }), // completada esta semana, final renombrado
    ], finales, HOY);
    expect(c).toEqual({ abiertas: 4, vencidas: 1, enRiesgo: 2, completadasSemana: 1 });
  });
  it("sin tareas todo es cero", () => expect(contadores([], finales, HOY)).toEqual({ abiertas: 0, vencidas: 0, completadasSemana: 0, enRiesgo: 0 }));
});

describe("carga por persona", () => {
  it("apila por estado en el orden del catalogo y ordena por total", () => {
    const filas = cargaPorPersona([
      t({ asignadoId: 1, estado: "En Progreso" }), t({ asignadoId: 1, estado: "Pendiente", vence: "2026-10-01" }),
      t({ asignadoId: 2, estado: "Bloqueado" }), t({ asignadoId: 2, estado: "Pendiente" }), t({ asignadoId: 2, estado: "Pendiente" }),
      t({ asignadoId: 3, estado: "Completado" }),
    ], finales, HOY, ["Pendiente", "En Progreso", "Bloqueado", "Completado"], new Map([[1, "Ana"], [2, "Luis"]]));
    expect(filas.map((f) => f.nombre)).toEqual(["Luis", "Ana"]);
    expect(filas[0].segmentos).toEqual([{ estado: "Pendiente", n: 2 }, { estado: "Bloqueado", n: 1 }]);
    expect(filas[1].vencidas).toBe(1);
  });
});

describe("tendencia", () => {
  it("devuelve siempre 8 semanas, de la mas antigua a la actual, aunque no haya datos", () => {
    const p = tendencia([], finales, HOY);
    expect(p).toHaveLength(8);
    expect(p[7].semana).toBe("2026-10-05");
    expect(p[0].semana).toBe("2026-08-17");
    expect(p.every((x) => x.creadas === 0 && x.completadas === 0)).toBe(true);
  });
  it("cuenta creadas por fecha de alta y completadas por ultima modificacion", () => {
    const p = tendencia([
      t({ creada: new Date("2026-10-06T15:00:00Z"), estado: "Pendiente" }),
      t({ creada: new Date("2026-09-29T15:00:00Z"), estado: "Completado", actualizada: new Date("2026-10-07T15:00:00Z") }),
      t({ creada: new Date("2026-01-01T15:00:00Z"), estado: "Completado", actualizada: new Date("2026-01-02T15:00:00Z") }), // fuera de ventana
    ], finales, HOY);
    expect(p[7]).toEqual({ semana: "2026-10-05", creadas: 1, completadas: 1 });
    expect(p[6]).toEqual({ semana: "2026-09-28", creadas: 1, completadas: 0 });
  });
  it("una sola semana no rompe nada", () => expect(tendencia([t({})], finales, HOY, 1)).toHaveLength(1));
});

describe("vencidas por unidad", () => {
  it("incluye unidades del alcance sin vencidas e ignora unidades ajenas", () => {
    const f = vencidasPorUnidad([t({ unidadId: 10, vence: "2026-10-01" }), t({ unidadId: 99, vence: "2026-10-01" })], finales, HOY,
      [{ id: 10, nombre: "DI" }, { id: 11, nombre: "COM" }]);
    expect(f).toEqual([{ unidadId: 10, nombre: "DI", vencidas: 1, abiertas: 1 }, { unidadId: 11, nombre: "COM", vencidas: 0, abiertas: 0 }]);
  });
});

describe("CSV", () => {
  it("usa las columnas de Flask, fecha MM/DD/YYYY y neutraliza formulas", () => {
    const csv = generarCsv([{
      start_date: null, end_date: null, due_date: new Date("2026-10-08T00:00:00Z"), directorate: null, client: "=HYPERLINK()", title: 'Con "comillas", y coma',
      requested_by: null, asignado: "Ana", description: null, budget_type: null, priority: "", is_recurrent: false, recurrence_type: null,
    }], "Media");
    const lineas = csv.replace("﻿", "").split("\r\n");
    expect(lineas[0].startsWith("Fecha De inicio,Fecha De finalizacion,Fecha De entrega")).toBe(true);
    expect(lineas[1]).toBe(`,,10/08/2026,,'=HYPERLINK(),"Con ""comillas"", y coma",,Ana,,,Media,No`);
    expect(mmddyyyy(null)).toBe("");
  });
});
