import "server-only";
import ExcelJS from "exceljs";
import { reporteDePeriodo, matrizDelTrimestre, type EntradaHoras, type Persona } from "./agregados";
import { MESES, rotuloPeriodo, type Periodo } from "./reglas";

/*
 * El libro de horas extras, con el mismo formato que la unidad lleva hoy en Excel:
 *   GENERALES                       horas por persona y quincena, por trimestre, con el total contra el MAXIMO.
 *   1RA/2DA QUINCENA DE <MES>       el reporte de la quincena: por persona, dia, detalle, horario, L-V, SAB-DOM y total.
 * Los totales llevan formula (como el original), asi quien lo edite despues los ve recalcularse.
 */

const AZUL = "FF1C2127";
const GRIS = "FFE6E9ED";
const FINO = { style: "thin", color: { argb: "FFB5BBC3" } } as const;
const BORDE = { top: FINO, left: FINO, bottom: FINO, right: FINO };

export function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).map((p) => p[0]).join("").toUpperCase().slice(0, 4);
}

const letra = (n: number): string => (n > 26 ? letra(Math.floor((n - 1) / 26)) : "") + String.fromCharCode(65 + ((n - 1) % 26));

function aFecha(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function hojaGenerales(wb: ExcelJS.Workbook, entradas: EntradaHoras[], personas: Persona[], anio: number, limite: number) {
  const ws = wb.addWorksheet("GENERALES");
  const matrices = [1, 2, 3, 4].map((t) => matrizDelTrimestre(entradas, personas, anio, t, limite));
  // Mismas personas (y orden) en los cuatro trimestres: alfabetico.
  const nombres = new Map<number, string>();
  for (const m of matrices) for (const f of m.filas) nombres.set(f.personaId, f.nombre);
  const orden = [...nombres].sort((a, b) => a[1].localeCompare(b[1], "es", { sensitivity: "base" }));
  const ultima = 1 + 4 * 7;

  ws.getColumn(1).width = 30;
  for (let c = 2; c <= ultima; c++) ws.getColumn(c).width = c % 7 === 1 ? 10 : 7;
  ws.mergeCells(2, 1, 2, ultima);
  Object.assign(ws.getCell(2, 1), { value: `HORAS EXTRAS ${anio}`, font: { bold: true, size: 14, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }, alignment: { horizontal: "center" } });
  ws.getCell(3, 1).value = "Trimestre";
  ws.getCell(4, 1).value = "Mes";
  ws.getCell(5, 1).value = "Quincena";

  matrices.forEach((m, q) => {
    const c0 = 2 + q * 7;
    ws.mergeCells(3, c0, 3, c0 + 6);
    ws.getCell(3, c0).value = `Q${q + 1}`;
    [0, 1, 2].forEach((i) => {
      ws.mergeCells(4, c0 + i * 2, 4, c0 + i * 2 + 1);
      ws.getCell(4, c0 + i * 2).value = MESES[q * 3 + i];
      ws.getCell(5, c0 + i * 2).value = 15;
      ws.getCell(5, c0 + i * 2 + 1).value = 30;
    });
    ws.mergeCells(4, c0 + 6, 5, c0 + 6);
    ws.getCell(4, c0 + 6).value = "TOTAL";

    orden.forEach(([id], fila) => {
      const f = m.filas.find((x) => x.personaId === id);
      const r = 6 + fila;
      f?.celdas.forEach((cel, i) => { if (cel.horas > 0) ws.getCell(r, c0 + i).value = cel.horas; });
      ws.getCell(r, c0 + 6).value = { formula: `SUM(${letra(c0)}${r}:${letra(c0 + 5)}${r})`, result: f?.total ?? 0 };
    });
    const rMax = 6 + orden.length;
    ws.getCell(rMax, c0 + 5).value = "MÁXIMO";
    ws.getCell(rMax, c0 + 6).value = limite;
  });
  orden.forEach(([, nombre], fila) => { ws.getCell(6 + fila, 1).value = nombre; });

  for (let r = 3; r <= 5; r++) {
    for (let c = 1; c <= ultima; c++) {
      const cel = ws.getCell(r, c);
      cel.font = { bold: true };
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
      cel.alignment = { horizontal: "center", vertical: "middle" };
      cel.border = BORDE;
    }
  }
  for (let r = 6; r <= 6 + orden.length; r++) {
    for (let c = 1; c <= ultima; c++) {
      const cel = ws.getCell(r, c);
      cel.border = BORDE;
      if (c > 1) cel.alignment = { horizontal: "center" };
      if (c > 1 && (c - 1) % 7 === 0) cel.font = { bold: true };
    }
  }
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];
}

function hojaQuincena(wb: ExcelJS.Workbook, entradas: EntradaHoras[], periodo: Periodo, unidad: string, generadoPor: string, hoy: string) {
  const reporte = reporteDePeriodo(entradas, periodo);
  const nombreHoja = `${periodo.mitad === 15 ? "1RA" : "2DA"} QUINCENA DE ${MESES[periodo.mes - 1].toUpperCase()}`.slice(0, 31);
  const ws = wb.addWorksheet(nombreHoja);
  ws.columns = [{ width: 13 }, { width: 58 }, { width: 30 }, { width: 10 }, { width: 11 }, { width: 11 }];
  const centrado = { horizontal: "center", vertical: "middle", wrapText: true } as const;

  const titulo = (fila: number, texto: string, negrita = true, tam = 11) => {
    ws.mergeCells(fila, 1, fila, 6);
    Object.assign(ws.getCell(fila, 1), { value: texto, font: { bold: negrita, size: tam }, alignment: centrado });
  };
  titulo(1, `${unidad.toUpperCase()} - REPORTE DE HORAS EXTRAS`, true, 14);
  titulo(2, `FECHA: ${rotuloPeriodo(periodo)}`);
  titulo(3, `${hoy.slice(8, 10)}/${hoy.slice(5, 7)}/${hoy.slice(0, 4)}-${generadoPor}`, false, 10);

  ws.mergeCells(5, 1, 5, 2); ws.mergeCells(5, 3, 5, 4); ws.mergeCells(5, 5, 5, 6);
  ws.mergeCells(6, 1, 6, 2); ws.mergeCells(6, 3, 6, 4); ws.mergeCells(6, 5, 6, 6);
  ws.getCell(5, 1).value = "TOTAL GENERAL"; ws.getCell(5, 3).value = "COLABORADORES"; ws.getCell(5, 5).value = "PERÍODO";
  ws.getCell(6, 5).value = `${MESES[periodo.mes - 1].toUpperCase()} ${periodo.anio}`;
  for (let c = 1; c <= 6; c++) for (const r of [5, 6]) Object.assign(ws.getCell(r, c), { alignment: centrado, border: BORDE, font: { bold: true } });
  for (let c = 1; c <= 6; c++) ws.getCell(5, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };

  let fila = 8;
  const filasTotal: number[] = [];
  const filasNombre: number[] = [];
  for (const b of reporte.bloques) {
    ws.mergeCells(fila, 1, fila, 6);
    Object.assign(ws.getCell(fila, 1), { value: b.nombre.toUpperCase(), font: { bold: true, color: { argb: "FFFFFFFF" } }, alignment: { horizontal: "left", vertical: "middle" }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } } });
    filasNombre.push(fila);
    fila++;
    ["DIA", "DETALLE", "HORARIO", "L-V", "SAB-DOM", "TOTAL\nHORAS"].forEach((t, i) => {
      Object.assign(ws.getCell(fila, i + 1), { value: t, font: { bold: true }, alignment: centrado, border: BORDE, fill: { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } } });
    });
    fila++;
    const primera = fila;
    for (const f of b.filas) {
      ws.getCell(fila, 1).value = aFecha(f.fecha);
      ws.getCell(fila, 1).numFmt = "dd/mm/yyyy";
      ws.getCell(fila, 2).value = f.detalle;
      ws.getCell(fila, 3).value = f.horario;
      ws.getCell(fila, f.finDeSemana ? 5 : 4).value = f.horas;
      ws.getCell(fila, 6).value = { formula: `SUM(D${fila}:E${fila})`, result: f.horas };
      for (let c = 1; c <= 6; c++) {
        const cel = ws.getCell(fila, c);
        cel.border = BORDE;
        cel.alignment = c === 2 || c === 3 ? { vertical: "middle", wrapText: true } : { horizontal: "center", vertical: "middle" };
      }
      fila++;
    }
    ws.getCell(fila, 1).value = "Total";
    ws.getCell(fila, 4).value = { formula: `SUM(D${primera}:D${fila - 1})`, result: b.laborables };
    ws.getCell(fila, 5).value = { formula: `SUM(E${primera}:E${fila - 1})`, result: b.finDeSemana };
    ws.getCell(fila, 6).value = { formula: `SUM(F${primera}:F${fila - 1})`, result: b.total };
    for (let c = 1; c <= 6; c++) Object.assign(ws.getCell(fila, c), { font: { bold: true }, border: BORDE, alignment: { horizontal: c === 1 ? "left" : "center" } });
    filasTotal.push(fila);
    fila += 2;
  }

  const suma = (col: string) => filasTotal.map((r) => `${col}${r}`).join("+") || "0";
  ws.getCell(fila, 1).value = "TOTAL HORAS";
  ws.getCell(fila, 4).value = { formula: suma("D"), result: reporte.laborables };
  ws.getCell(fila, 5).value = { formula: suma("E"), result: reporte.finDeSemana };
  ws.getCell(fila, 6).value = { formula: suma("F"), result: reporte.total };
  for (let c = 1; c <= 6; c++) Object.assign(ws.getCell(fila, c), { font: { bold: true }, border: BORDE, fill: { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } }, alignment: { horizontal: c === 1 ? "left" : "center" } });

  ws.getCell(6, 1).value = { formula: `F${fila}`, result: reporte.total };
  ws.getCell(6, 3).value = { formula: `COUNTA(${filasNombre.map((r) => `A${r}`).join(",") || "A1"})`, result: reporte.colaboradores };
  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

export async function libroDeHorasExtras(d: {
  unidad: string; limite: number; periodo: Periodo; entradas: EntradaHoras[]; personas: Persona[]; generadoPor: string; hoy: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.generadoPor;
  hojaGenerales(wb, d.entradas, d.personas, d.periodo.anio, d.limite);
  hojaQuincena(wb, d.entradas, d.periodo, d.unidad, iniciales(d.generadoPor), d.hoy);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
