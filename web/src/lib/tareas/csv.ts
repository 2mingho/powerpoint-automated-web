import { esFinDeSemana, formatoMdy, parsearFechaCsv } from "./fechas";

/*
 * Importar y exportar tareas en CSV (blueprints/tasks.py, bloque CSV). Logica
 * pura: lectura, cabeceras, validacion por fila y escritura. Quien llama pone
 * la lista de personas a las que se puede asignar (ya filtrada por alcance).
 */

export const COLUMNAS_CSV = [
  "Fecha De inicio", "Fecha De finalizacion", "Fecha De entrega", "Director o Gerencia", "Cliente",
  "Titulo", "Solicitado por", "Asignar a", "Descripcion", "Tipo de Presupuesto", "Prioridad", "Recurrencia",
] as const;

export const CAMPOS_CSV = [
  ["start_date", "Fecha De inicio"],
  ["end_date", "Fecha De finalizacion"],
  ["due_date", "Fecha De entrega"],
  ["directorate", "Director o Gerencia"],
  ["client", "Cliente"],
  ["title", "Titulo"],
  ["requested_by", "Solicitado por"],
  ["assignee", "Asignar a"],
  ["description", "Descripcion"],
  ["budget_type", "Tipo de Presupuesto"],
  ["priority", "Prioridad"],
  ["recurrence", "Recurrencia"],
] as const;

export type ClaveCsv = (typeof CAMPOS_CSV)[number][0];
export type CamposCsv = Record<ClaveCsv, string>;
const ETIQUETA: Record<string, string> = Object.fromEntries(CAMPOS_CSV);

export type FilaCsv = { row_number: number; fields: CamposCsv };
export type Incidencia = { severity: "error" | "warning"; column: string; code: string; message: string; value: string };
export type PersonaCsv = { id: number; username: string; email: string; area_id: number | null; areaNombre: string | null; role: string };

function espacios(valor: unknown): string {
  return String(valor ?? "").replace(/﻿/g, "").split(/\s+/).filter(Boolean).join(" ");
}

function sinAcentos(texto: string): string {
  return texto.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function normalizarCabecera(valor: unknown): string {
  return sinAcentos(espacios(valor)).toLowerCase();
}

export function normalizarBusqueda(valor: unknown): string {
  return sinAcentos(espacios(valor).toLowerCase());
}

export function camposVacios(): CamposCsv {
  return Object.fromEntries(CAMPOS_CSV.map(([k]) => [k, ""])) as CamposCsv;
}

/*
 * Bytes a texto: UTF-8 (con o sin BOM), UTF-16 si trae su BOM, y si no CP1252.
 * Flask probaba 'utf-16' sin BOM antes que CP1252, y un CP1252 de longitud par
 * se "decodificaba" como basura UTF-16; aqui solo se usa UTF-16 con BOM.
 */
export function decodificarCsv(bytes: Uint8Array): string | null {
  if (!bytes.length) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return texto.replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/* Separador: el que mas aparece en la primera linea entre coma, punto y coma y tabulador. */
export function detectarSeparador(texto: string): string {
  const linea = texto.slice(0, 4096).split(/\r?\n/, 1)[0] ?? "";
  let mejor = ",";
  let max = 0;
  for (const s of [",", ";", "\t"]) {
    let n = 0;
    let comillas = false;
    for (const c of linea) {
      if (c === '"') comillas = !comillas;
      else if (c === s && !comillas) n++;
    }
    if (n > max) { max = n; mejor = s; }
  }
  return mejor;
}

/* Lector RFC 4180: comillas dobles, saltos de linea dentro de comillas y "" escapadas. */
export function leerCsv(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      filas.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

export type ErrorEstructura = {
  error: string;
  details: { missing_headers: string[]; unexpected_headers: string[]; duplicate_headers: string[]; expected_headers: string[] };
};

export function extraerFilasCsv(texto: string): { filas: FilaCsv[] } | { fallo: ErrorEstructura } {
  const crudas = leerCsv(texto, detectarSeparador(texto));
  const cabeceras = crudas[0] ?? [];
  const esperadas = [...COLUMNAS_CSV] as string[];
  if (!cabeceras.length || cabeceras.every((c) => !c.trim())) {
    return { fallo: { error: "No se detectaron cabeceras en el CSV.", details: { missing_headers: esperadas, unexpected_headers: [], duplicate_headers: [], expected_headers: esperadas } } };
  }

  const esperadasPorNorma = new Map(esperadas.map((c) => [normalizarCabecera(c), c]));
  const recibidas = new Map<string, number>();
  const duplicadas: string[] = [];
  cabeceras.forEach((c, i) => {
    const n = normalizarCabecera(c);
    if (recibidas.has(n)) { duplicadas.push(espacios(c)); return; }
    recibidas.set(n, i);
  });
  const faltan = [...esperadasPorNorma].filter(([n]) => !recibidas.has(n)).map(([, l]) => l);
  const sobran = cabeceras.filter((c) => !esperadasPorNorma.has(normalizarCabecera(c))).map(espacios);
  if (duplicadas.length || faltan.length || sobran.length) {
    return { fallo: { error: "La estructura del CSV no coincide con el formato requerido.", details: { missing_headers: faltan, unexpected_headers: sobran, duplicate_headers: duplicadas, expected_headers: esperadas } } };
  }

  // Numeracion de DictReader: una linea en blanco no es un registro y no cuenta;
  // una fila de solo separadores si cuenta, aunque luego se salte.
  const filas: FilaCsv[] = [];
  let numero = 1;
  for (const valores of crudas.slice(1)) {
    if (valores.length === 1 && valores[0] === "") continue;
    numero++;
    if (!valores.some((v) => v.trim())) continue;
    const fields = camposVacios();
    for (const [clave, etiqueta] of CAMPOS_CSV) {
      fields[clave] = valores[recibidas.get(normalizarCabecera(etiqueta))!] ?? "";
    }
    filas.push({ row_number: numero, fields });
  }
  return { filas };
}

type Coincidencia = { estado: "empty" | "exact_email" | "exact_username" | "partial_unique" | "ambiguous" | "not_found"; candidatos: string[] };

export function resolverAsignado(crudo: string, personas: PersonaCsv[]): { persona: PersonaCsv | null; c: Coincidencia } {
  const busca = normalizarBusqueda(crudo);
  if (!busca) return { persona: null, c: { estado: "empty", candidatos: [] } };
  const porCorreo = personas.find((p) => normalizarBusqueda(p.email) === busca);
  if (porCorreo) return { persona: porCorreo, c: { estado: "exact_email", candidatos: [] } };
  const porNombre = personas.find((p) => normalizarBusqueda(p.username) === busca);
  if (porNombre) return { persona: porNombre, c: { estado: "exact_username", candidatos: [] } };

  const parciales = new Map<number, PersonaCsv>();
  for (const p of personas) {
    const nombre = normalizarBusqueda(p.username);
    const correo = normalizarBusqueda(p.email);
    if (nombre.includes(busca) || correo.includes(busca) || nombre.split(" ").some((t) => t.startsWith(busca))) parciales.set(p.id, p);
  }
  if (parciales.size === 1) {
    const p = [...parciales.values()][0];
    return { persona: p, c: { estado: "partial_unique", candidatos: [p.username] } };
  }
  if (parciales.size > 1) return { persona: null, c: { estado: "ambiguous", candidatos: [...parciales.values()].slice(0, 5).map((p) => p.username) } };
  return { persona: null, c: { estado: "not_found", candidatos: [] } };
}

export function normalizarRecurrencia(crudo: string): string | null {
  const v = espacios(crudo).toLowerCase();
  if (!v || ["no", "ninguna", "n/a", "na"].includes(v)) return "";
  return ({ diaria: "Diaria", semanal: "Semanal", mensual: "Mensual" } as Record<string, string>)[v] ?? null;
}

export type ContextoCsv = { prioridades: string[]; prioridadDefecto: string; anioActual: number };

export type Validacion = {
  status: "ok" | "warning" | "error";
  issues: Incidencia[];
  fields: CamposCsv;
  limpio: CamposCsv;
  parsed: { inicio: string | null; fin: string | null; entrega: string | null; asignado: PersonaCsv | null; prioridad: string; recurrencia: string };
  preview: { start_date: string; end_date: string; due_date: string; recurrence_type: string; priority: string; assignee_resolved: string };
};

export function validarFilaCsv(entrada: Partial<Record<string, unknown>>, personas: PersonaCsv[], ctx: ContextoCsv): Validacion {
  const fields = camposVacios();
  for (const [k] of CAMPOS_CSV) fields[k] = String(entrada?.[k] ?? "");
  const limpio = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()])) as CamposCsv;
  const issues: Incidencia[] = [];
  const anotar = (severity: Incidencia["severity"], clave: ClaveCsv, code: string, message: string, value?: string) =>
    issues.push({ severity, column: ETIQUETA[clave] ?? clave, code, message, value: value ?? fields[clave] ?? "" });

  if (!limpio.title) anotar("error", "title", "required", "El título es obligatorio.");
  if (!limpio.client) anotar("warning", "client", "recommended", "Se recomienda indicar el cliente para mayor claridad.");
  if (!limpio.requested_by) anotar("warning", "requested_by", "recommended", "Se recomienda indicar quién solicitó la tarea.");

  const { persona, c } = resolverAsignado(limpio.assignee, personas);
  if (c.estado === "empty") anotar("error", "assignee", "required", "Debes indicar a quién asignar la tarea.");
  else if (c.estado === "not_found") anotar("error", "assignee", "assignee_not_found", "No se encontró un usuario activo con ese nombre o correo.");
  else if (c.estado === "ambiguous") {
    const lista = c.candidatos.join(", ");
    anotar("error", "assignee", "assignee_ambiguous", `Coincidencia ambigua en "Asignar a".${lista ? ` Posibles usuarios: ${lista}.` : ""}`);
  } else if (c.estado === "partial_unique" && persona) {
    anotar("warning", "assignee", "assignee_partial_match", `Se resolvió por coincidencia parcial con: ${persona.username}.`, fields.assignee);
  }

  const fecha = (clave: "start_date" | "end_date" | "due_date") => {
    const r = parsearFechaCsv(limpio[clave], ctx.anioActual);
    if (clave === "due_date" && !limpio[clave]) anotar("error", clave, "required", "La fecha de entrega es obligatoria.");
    else if (limpio[clave] && !r.fecha) anotar("error", clave, "invalid_date", "Fecha inválida. Usa MM/DD/YYYY o D-MMM.");
    else if (r.aviso === "year_inferred_current") anotar("warning", clave, "year_inferred_current", `Se infirió el año actual (${ctx.anioActual}) para esta fecha.`);
    return r.fecha;
  };
  const inicio = fecha("start_date");
  const fin = fecha("end_date");
  const entrega = fecha("due_date");

  let recurrencia = normalizarRecurrencia(limpio.recurrence);
  if (recurrencia === null) {
    anotar("error", "recurrence", "invalid_recurrence", "Valor inválido. Usa: No, Diaria, Semanal o Mensual.");
    recurrencia = "";
  }

  let prioridad = limpio.priority || ctx.prioridadDefecto;
  if (!ctx.prioridades.includes(prioridad)) {
    anotar("warning", "priority", "invalid_priority_fallback", `Prioridad inválida. Se usará ${ctx.prioridadDefecto}.`);
    prioridad = ctx.prioridadDefecto;
  }

  if (entrega && esFinDeSemana(entrega)) anotar("error", "due_date", "weekend_not_allowed", "Sábado y domingo solo se permiten para tareas manuales, no por CSV.");
  if (inicio && fin && fin < inicio) anotar("error", "end_date", "invalid_range", "La fecha de finalización no puede ser menor que la fecha de inicio.");

  const status = issues.some((i) => i.severity === "error") ? "error" : issues.some((i) => i.severity === "warning") ? "warning" : "ok";
  return {
    status, issues, fields, limpio,
    parsed: { inicio, fin, entrega, asignado: persona, prioridad, recurrencia },
    preview: {
      start_date: inicio ? formatoMdy(inicio) : "",
      end_date: fin ? formatoMdy(fin) : "",
      due_date: entrega ? formatoMdy(entrega) : "",
      recurrence_type: recurrencia || "No",
      priority: prioridad,
      assignee_resolved: persona?.username ?? "",
    },
  };
}

export type FilaVistaPrevia = { row_number: number; fields: CamposCsv; status: Validacion["status"]; issues: Incidencia[]; parsed: Validacion["preview"] };
export type ErrorPlano = { row: number; column: string; value: string; code: string; message: string };

export function erroresPlanos(fila: number, issues: Incidencia[]): ErrorPlano[] {
  return issues.filter((i) => i.severity === "error").map((i) => ({ row: fila, column: i.column, value: i.value, code: i.code, message: i.message }));
}

export function vistaPreviaCsv(filas: FilaCsv[], personas: PersonaCsv[], ctx: ContextoCsv) {
  const rows: FilaVistaPrevia[] = [];
  const errors: ErrorPlano[] = [];
  let ok = 0, avisos = 0, fallos = 0;
  for (const f of filas) {
    const v = validarFilaCsv(f.fields, personas, ctx);
    rows.push({ row_number: f.row_number, fields: v.fields, status: v.status, issues: v.issues, parsed: v.preview });
    if (v.status === "ok") ok++; else if (v.status === "warning") avisos++; else fallos++;
    errors.push(...erroresPlanos(f.row_number, v.issues));
  }
  return { rows, total_rows: rows.length, ok_rows: ok, warning_rows: avisos, error_rows: fallos, errors };
}

/* Escritura como csv.writer de Python: comillas solo cuando hacen falta, fin de linea CRLF. */
export function celdaCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export function escribirCsv(filas: string[][]): string {
  return filas.map((f) => f.map(celdaCsv).join(",")).join("\r\n") + "\r\n";
}
