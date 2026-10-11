import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { EntradaHoras } from "./agregados";
import { iniciales, libroDeHorasExtras } from "./excel";

// Cargar exceljs y armar el libro tarda: con la maquina ocupada (otras baterias a la vez) 5 s se quedaban cortos.
vi.setConfig({ testTimeout: 30_000 });

/* El reporte real de la 2da quincena de septiembre de Media Watch (Reporte HE - 2da. Quincena - Septiembre.xlsx). */
let id = 0;
const p = (anio: number, mes: number, mitad: 15 | 30) => ({ anio, mes, mitad });
const SEP30 = p(2026, 9, 30);
const e = (personaId: number, personaNombre: string, fecha: string, horas: number, detalle: string, horario: string, periodo = SEP30): EntradaHoras =>
  ({ id: ++id, personaId, personaNombre, fecha, detalle, horario, horas, periodo });

const DENNYS = [1, "Dennys Faneyte"] as const, ANUDIS = [2, "Anudis Reyes"] as const, FELIX = [3, "Felix Rojas"] as const, FRANKLIN = [4, "Franklin Paredes"] as const, CELINA = [5, "Celina Gonzalez"] as const;
const ENTRADAS: EntradaHoras[] = [
  ...["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31"].map((f) => e(...DENNYS, f, 3, "Terminando mis Medios - AN7M - AM - RDN", "5:00 PM-8:00 PM")),
  e(...ANUDIS, "2026-09-09", 1, "Cobertura medios PM (RNN y NT)", "10:00-11:00 PM"), e(...ANUDIS, "2026-09-14", 3, "Cobertura medios Day Off Celina (TV y Digitales)", "08:00-11:00 PM"),
  e(...ANUDIS, "2026-09-15", 1, "Cobertura medios PM (RNN y NT)", "10:00-11:00 PM"), e(...ANUDIS, "2026-09-16", 1, "Cobertura medios PM (RNN y NT)", "10:00-11:00 PM"),
  e(...ANUDIS, "2026-09-17", 1, "Cobertura medios PM (RNN y NT)", "10:00-11:00 PM"), e(...ANUDIS, "2026-09-18", 3, "Cobertura medios Day Off Franklin (TV y Digitales)", "08:00-11:00 PM"),
  e(...ANUDIS, "2026-09-21", 1, "Cobertura medios PM (RNN y NT)", "08:00-11:00 PM"),
  ...["2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"].map((f) => e(...FELIX, f, 1, "2 Medios TV Pedro", "08:00-09:00")),
  e(...FRANKLIN, "2026-09-07", 6.5, "Cubrir medios turno AM del sábado, domingo y lunes", "6:00-12:30 PM"), e(...FRANKLIN, "2026-09-11", 2.5, "Cubrir medios turno AM", "6:00 AM-08:50 AM"),
  e(...FRANKLIN, "2026-09-14", 4, "Cubrir medios turno AM", "6:00-09:00 AM y 14:00-3:00 PM"), e(...FRANKLIN, "2026-09-15", 5, "Cubrir medios turno AM revisión y carga de links", "6:30-09:00 AM y 11:00 - 13:30 PM"),
  e(...FRANKLIN, "2026-09-16", 4, "Cubrir medios turno AM revisión y carga de links", "6:30-9:30 AM y 2:00-3:00 PM"), e(...FRANKLIN, "2026-09-17", 3, "Cubrir medios turno AM", "7:00-10:00 AM"),
  e(...CELINA, "2026-09-11", 4, "Cobertura medios am", "10:20 am a 2:20 pm"), e(...CELINA, "2026-09-15", 2, "Cobertura medios am", "11:00 am a 1:00 pm"),
  e(...CELINA, "2026-09-16", 4.5, "Cobertura medios am", "9:15 am a 1:45 pm"), e(...CELINA, "2026-09-17", 2.5, "Cobertura medios am", "10:00 am a 12:45 pm"),
  e(...CELINA, "2026-09-18", 2.5, "Cobertura medios am", "10:15 a 12:45 pm"), e(...CELINA, "2026-09-19", 1, "Completar pauta", "11:00 am a 12:00 pm"),
];

async function libro() {
  const buf = await libroDeHorasExtras({
    unidad: "Media Watch", limite: 80, periodo: SEP30, entradas: ENTRADAS,
    personas: [DENNYS, ANUDIS, FELIX, FRANKLIN, CELINA].map(([id, nombre]) => ({ id, nombre })), generadoPor: "Jarlina Fulgencio", hoy: "2026-09-22",
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/* El valor de una celda, sea constante o formula. */
const valor = (ws: ExcelJS.Worksheet, ref: string) => {
  const v = ws.getCell(ref).value;
  return v && typeof v === "object" && "result" in v ? v.result : v;
};

describe("libro de horas extras", () => {
  it("tiene las dos hojas del Excel actual", async () => {
    const wb = await libro();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["GENERALES", "2DA QUINCENA DE SEPTIEMBRE"]);
  });

  it("el reporte de la quincena cuadra con el Excel: 73.5 h de 5 colaboradores, y 15, 11, 6, 25 y 16.5 por persona", async () => {
    const ws = (await libro()).getWorksheet("2DA QUINCENA DE SEPTIEMBRE")!;
    expect(ws.getCell("A1").value).toBe("MEDIA WATCH - REPORTE DE HORAS EXTRAS");
    expect(ws.getCell("A2").value).toBe("FECHA: 2DA. QUINCENA DE SEPTIEMBRE 2026");
    expect(ws.getCell("A3").value).toBe("22/09/2026-JF");
    expect(valor(ws, "A6")).toBe(73.5);
    expect(valor(ws, "C6")).toBe(5);
    expect(ws.getCell("E6").value).toBe("SEPTIEMBRE 2026");
    // Un bloque por persona: su nombre esta justo encima de la fila de encabezados («DIA»).
    const totales: Record<string, number> = {};
    let nombre = "";
    ws.eachRow((fila) => {
      const a = fila.getCell(1).value;
      if (ws.getCell(fila.number + 1, 1).value === "DIA") nombre = String(a);
      if (a === "Total") totales[nombre] = Number(valor(ws, `F${fila.number}`));
    });
    expect(totales).toEqual({ "ANUDIS REYES": 11, "CELINA GONZALEZ": 16.5, "DENNYS FANEYTE": 15, "FELIX ROJAS": 6, "FRANKLIN PAREDES": 25 });
  });

  it("segmenta L-V y SAB-DOM por el dia trabajado, y el total es una formula", async () => {
    const ws = (await libro()).getWorksheet("2DA QUINCENA DE SEPTIEMBRE")!;
    let sabado: ExcelJS.Row | undefined, lunes: ExcelJS.Row | undefined;
    ws.eachRow((f) => {
      const a = f.getCell(1).value;
      if (a instanceof Date && a.toISOString().startsWith("2026-09-19")) sabado = f; // 19 de septiembre de 2026: sabado
      if (a instanceof Date && a.toISOString().startsWith("2026-09-14") && f.getCell(2).value === "Cobertura medios Day Off Celina (TV y Digitales)") lunes = f;
    });
    expect(sabado!.getCell(4).value).toBeNull();
    expect(sabado!.getCell(5).value).toBe(1);
    expect(lunes!.getCell(4).value).toBe(3);
    expect(lunes!.getCell(5).value).toBeNull();
    const f = sabado!.getCell(6).value as { formula: string; result: number };
    expect(f.formula).toMatch(/^SUM\(D\d+:E\d+\)$/);
    expect(f.result).toBe(1);
  });

  it("GENERALES: total del trimestre con formula y el MAXIMO al pie", async () => {
    const ws = (await libro()).getWorksheet("GENERALES")!;
    // Cada trimestre son siete columnas: Q1 B..H, Q2 I..O, Q3 P..V (septiembre es T=15 y U=30, y el total, V), Q4 W..AC.
    expect(ws.getCell("P3").value).toBe("Q3");
    expect(ws.getCell("T4").value).toBe("Septiembre");
    expect(ws.getCell("T5").value).toBe(15);
    expect(ws.getCell("U5").value).toBe(30);
    // Anudis (primera por orden alfabetico) lleva 11 h en la 2da de septiembre.
    expect(ws.getCell("A6").value).toBe("Anudis Reyes");
    expect(ws.getCell("U6").value).toBe(11);
    const total = ws.getCell("V6").value as { formula: string; result: number };
    expect(total.formula).toBe("SUM(P6:U6)");
    expect(total.result).toBe(11);
    expect(ws.getCell("U11").value).toBe("MÁXIMO");
    expect(ws.getCell("V11").value).toBe(80);
  });
});

describe("texto escrito por el usuario", () => {
  it("una celda que empieza con = + - @ se guarda como texto y nunca como formula (no se ejecuta al abrir el Excel)", async () => {
    const malicioso = '=HYPERLINK("http://malo.example","clic")';
    const buf = await libroDeHorasExtras({
      unidad: "Media Watch", limite: 80, periodo: SEP30, personas: [{ id: 9, nombre: "+cmd|' /C calc'!A0" }], generadoPor: "Jarlina Fulgencio", hoy: "2026-09-22",
      entradas: [e(9, "+cmd|' /C calc'!A0", "2026-09-14", 2, malicioso, "@SUM(1+1)")],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("2DA QUINCENA DE SEPTIEMBRE")!;
    const celdas: ExcelJS.Cell[] = [];
    ws.eachRow((f) => f.eachCell((c) => celdas.push(c)));
    for (const texto of [malicioso, "@SUM(1+1)", "+CMD|' /C CALC'!A0"]) {
      const c = celdas.find((x) => String(x.value).toUpperCase() === texto.toUpperCase());
      expect(c, texto).toBeDefined();
      expect(c!.type, texto).toBe(ExcelJS.ValueType.String); // texto, no ValueType.Formula
    }
    // Las unicas formulas son las de los totales.
    const formulas = celdas.filter((c) => c.type === ExcelJS.ValueType.Formula).map((c) => (c.value as { formula: string }).formula);
    expect(formulas.every((f) => /^(SUM|COUNTA)\(|^F\d+$|^[DEF]\d+(\+[DEF]\d+)*$/.test(f))).toBe(true);
  });
});

describe("iniciales", () => {
  it("las de cada nombre, para firmar el reporte", () => {
    expect(iniciales("Jarlina Fulgencio")).toBe("JF");
    expect(iniciales("domingo")).toBe("D");
    expect(iniciales("")).toBe("");
  });
});
