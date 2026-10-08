import { describe, expect, it } from "vitest";
import { interpretarAlta } from "./alta-rapida";
import { desplazarDiasHabiles, generarFechasRecurrencia, parsearFechaCsv, parsearFechaEntrada, sumarDias } from "./fechas";
import { colocar, compararColumna, posicionEntre, hayHueco, posicionesRenumeradas, PASO_DE_POSICION } from "./posiciones";
import { extraerFilasCsv, validarFilaCsv, decodificarCsv, escribirCsv, COLUMNAS_CSV, type PersonaCsv } from "./csv";

// 2026-10-08 es jueves.
const HOY = "2026-10-08";
const ctx = {
  hoy: HOY,
  miId: 1,
  personas: [
    { id: 1, nombre: "demo" },
    { id: 2, nombre: "ana" },
    { id: 3, nombre: "ana maria" },
    { id: 4, nombre: "carlos.rojas" },
    { id: 5, nombre: "carmen" },
  ],
  prioridades: ["Alta", "Media", "Baja"],
  prioridadDefecto: "Media",
};

describe("alta rápida", () => {
  it("sin atajos: para mí, hoy y prioridad por defecto", () => {
    const r = interpretarAlta("Revisar informe semanal", ctx);
    expect(r).toMatchObject({ titulo: "Revisar informe semanal", asignado: 1, fecha: HOY, prioridad: "Media", problema: "", fechaExplicita: false });
  });

  it("@persona, mañana y !alta al final", () => {
    const r = interpretarAlta("Preparar reporte @carlos.rojas mañana !alta", ctx);
    expect(r).toMatchObject({ titulo: "Preparar reporte", asignado: 4, fecha: "2026-10-09", prioridad: "Alta", fechaExplicita: true });
  });

  it("la palabra de fecha en medio del título se queda en el título", () => {
    const r = interpretarAlta("Preparar la mañana de cine", ctx);
    expect(r.titulo).toBe("Preparar la mañana de cine");
    expect(r.fecha).toBe(HOY);
  });

  it("pasado mañana y días de la semana", () => {
    expect(interpretarAlta("Algo pasado mañana", ctx).fecha).toBe("2026-10-10");
    expect(interpretarAlta("Algo lunes", ctx).fecha).toBe("2026-10-12");
    // Si el día es hoy (jueves), la semana que viene.
    expect(interpretarAlta("Algo jueves", ctx).fecha).toBe("2026-10-15");
    expect(interpretarAlta("Algo miércoles", ctx).fecha).toBe("2026-10-14");
  });

  it("nombres de varias palabras ganan al más corto", () => {
    expect(interpretarAlta("Llamar @ana maria hoy", ctx)).toMatchObject({ asignado: 3, titulo: "Llamar" });
    expect(interpretarAlta("Llamar @ana hoy", ctx)).toMatchObject({ asignado: 2, titulo: "Llamar" });
  });

  it("prefijo único resuelve, ambiguo y desconocido avisan", () => {
    expect(interpretarAlta("x @carl", ctx).asignado).toBe(4);
    expect(interpretarAlta("x @car", ctx).problema).toMatch(/varias personas/);
    expect(interpretarAlta("x @zoe", ctx).problema).toMatch(/No hay nadie llamado «zoe»/);
  });

  it("prioridad por prefijo y prioridad desconocida en el título", () => {
    expect(interpretarAlta("x !ba", ctx).prioridad).toBe("Baja");
    const r = interpretarAlta("x !urgente", ctx);
    expect(r.prioridad).toBe("Media");
    expect(r.titulo).toBe("x !urgente");
  });

  it("solo la primera fecha de la cola cuenta", () => {
    const r = interpretarAlta("Tarea hoy mañana", ctx);
    expect(r.fecha).toBe(HOY);
    expect(r.titulo).toBe("Tarea mañana");
  });
});

describe("fechas de recurrencia", () => {
  it("diaria salta fines de semana", () => {
    expect(generarFechasRecurrencia("2026-10-08", "Diaria", "2026-10-13")).toEqual(["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"]);
  });

  it("semanal cada 7 días hasta el fin incluido", () => {
    expect(generarFechasRecurrencia("2026-10-08", "Semanal", "2026-10-22")).toEqual(["2026-10-08", "2026-10-15", "2026-10-22"]);
  });

  it("mensual conserva el día y omite los que caen en fin de semana", () => {
    // 2026-11-08 es domingo: se omite.
    expect(generarFechasRecurrencia("2026-10-08", "Mensual", "2027-01-31")).toEqual(["2026-10-08", "2026-12-08", "2027-01-08"]);
  });

  it("mensual desde fin de mes cae al último día y sigue ahí (como Flask)", () => {
    // 30-ene -> 28-feb (sábado) -> 28-mar (sábado) -> 28-abr: la serie ya no vuelve al 30.
    expect(generarFechasRecurrencia("2026-01-30", "Mensual", "2026-04-30")).toEqual(["2026-01-30", "2026-04-28"]);
  });

  it("fin anterior al inicio no genera nada", () => {
    expect(generarFechasRecurrencia("2026-10-08", "Diaria", "2026-10-07")).toEqual([]);
  });

  it("días hábiles para las plantillas", () => {
    expect(desplazarDiasHabiles("2026-10-08", 0)).toBe("2026-10-08");
    expect(desplazarDiasHabiles("2026-10-08", 2)).toBe("2026-10-12");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("entrada ISO o MM/DD/YYYY; fechas imposibles son null", () => {
    expect(parsearFechaEntrada("2026-10-08T13:00:00")).toBe("2026-10-08");
    expect(parsearFechaEntrada("10/8/2026")).toBe("2026-10-08");
    expect(parsearFechaEntrada("2026-02-30")).toBeNull();
    expect(parsearFechaEntrada("mañana")).toBeNull();
  });

  it("fechas del CSV con año inferido", () => {
    expect(parsearFechaCsv("15-Oct", 2026)).toEqual({ fecha: "2026-10-15", aviso: "year_inferred_current" });
    expect(parsearFechaCsv("15-oct-27", 2026)).toEqual({ fecha: "2027-10-15", aviso: null });
    expect(parsearFechaCsv("1/2/26", 2026)).toEqual({ fecha: "2026-01-02", aviso: null });
    expect(parsearFechaCsv("31-Feb", 2026).fecha).toBeNull();
  });
});

describe("posiciones del tablero", () => {
  it("entre dos, al principio, al final y en columna vacía", () => {
    expect(posicionEntre(null, null)).toBe(PASO_DE_POSICION);
    expect(posicionEntre(null, 2048)).toBe(1024);
    expect(posicionEntre(1024, null)).toBe(2048);
    expect(posicionEntre(1024, 2048)).toBe(1536);
    expect(hayHueco(1024, 1024, 1024)).toBe(false);
    expect(posicionesRenumeradas(3)).toEqual([1024, 2048, 3072]);
  });

  it("columna sin colocar se renumera entera", () => {
    const columna = [
      { id: 1, posicion: null, entrega: "2026-10-10" },
      { id: 2, posicion: null, entrega: "2026-10-11" },
    ];
    const r = colocar(columna, 3, null, 1);
    expect(r.posicion).toBe(1024);
    expect(r.otras).toEqual([[1, 2048], [2, 3072]]);
  });

  it("con hueco no toca a nadie más", () => {
    const columna = [
      { id: 3, posicion: 1024, entrega: "2026-10-10" },
      { id: 1, posicion: 2048, entrega: "2026-10-10" },
    ];
    expect(colocar(columna, 2, 3, 1)).toEqual({ posicion: 1536, otras: [] });
    expect(colocar(columna, 2, 1, null)).toEqual({ posicion: 3072, otras: [] });
  });

  it("hueco agotado renumera", () => {
    const columna = [
      { id: 1, posicion: 1, entrega: "a" },
      { id: 2, posicion: 1 + Number.EPSILON, entrega: "a" },
    ];
    const r = colocar(columna, 9, 1, 2);
    expect(r.posicion).toBe(2048);
    expect(r.otras).toEqual([[1, 1024], [2, 3072]]);
  });

  it("orden de columna: colocadas primero, luego por entrega e id", () => {
    const lista = [
      { id: 5, posicion: null, entrega: "2026-10-09" },
      { id: 4, posicion: null, entrega: "2026-10-08" },
      { id: 9, posicion: 2048, entrega: "2026-12-01" },
      { id: 8, posicion: 1024, entrega: "2026-12-01" },
    ].sort(compararColumna);
    expect(lista.map((t) => t.id)).toEqual([8, 9, 4, 5]);
  });
});

describe("CSV", () => {
  const personas: PersonaCsv[] = [
    { id: 1, username: "ana diaz", email: "ana@x.test", area_id: 1, areaNombre: "DI", role: "DI" },
    { id: 2, username: "ana lopez", email: "lopez@x.test", area_id: 1, areaNombre: "DI", role: "DI" },
    { id: 3, username: "carlos", email: "carlos@x.test", area_id: 1, areaNombre: "DI", role: "DI" },
  ];
  const c = { prioridades: ["Alta", "Media", "Baja"], prioridadDefecto: "Media", anioActual: 2026 };

  it("cabeceras: faltan, sobran y acentos/mayúsculas indiferentes", () => {
    const r = extraerFilasCsv("Titulo;Otra\nx;y\n");
    expect("fallo" in r && r.fallo.details.unexpected_headers).toEqual(["Otra"]);
    const cab = COLUMNAS_CSV.map((h) => h.toUpperCase().replace("Titulo".toUpperCase(), "Título")).join(";");
    const ok = extraerFilasCsv(`${cab}\n\n;;10/09/2026;;Cliente;Hola;;carlos;;;;\n`);
    expect("filas" in ok && ok.filas).toHaveLength(1);
    expect("filas" in ok && ok.filas[0].row_number).toBe(2);
  });

  it("valida errores, avisos y resuelve asignado", () => {
    const malo = validarFilaCsv({ title: "", assignee: "ana", due_date: "10/10/2026", recurrence: "anual" }, personas, c);
    expect(malo.status).toBe("error");
    expect(malo.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["required", "assignee_ambiguous", "weekend_not_allowed", "invalid_recurrence"]));
    const bien = validarFilaCsv({ title: "T", client: "C", requested_by: "R", assignee: "carl", due_date: "10/09/2026", priority: "Urgente" }, personas, c);
    expect(bien.status).toBe("warning");
    expect(bien.parsed.asignado?.id).toBe(3);
    expect(bien.parsed.prioridad).toBe("Media");
    expect(bien.preview.due_date).toBe("10/09/2026");
  });

  it("decodifica UTF-8 con BOM y CP1252", () => {
    expect(decodificarCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
    expect(decodificarCsv(new Uint8Array([0x41, 0xe9]))).toBe("Aé");
  });

  it("escribe con comillas solo cuando hace falta", () => {
    expect(escribirCsv([["a", "b,c", 'd"e']])).toBe('a,"b,c","d""e"\r\n');
  });
});
