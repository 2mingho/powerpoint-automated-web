import { describe, expect, it } from "vitest";
import { SIN_FILTROS, type FiltrosCruzados } from "@/lib/seguimiento/filtros";
import { riesgoDe } from "@/lib/seguimiento/riesgo";
import { opcionesDe, resumen } from "./agregados";
import { acumularCeldas, codificarCeldas, decodificarCeldas, entradaDeTarea, horasDeGrupo, type Entrada } from "./celdas";
import { cargaPorPersona, entregasPorSemana, estadoPorCliente, repartoPor } from "./graficos";

const HOY = "2026-10-08"; // jueves
type Suelta = Parameters<typeof entradaDeTarea>[0];

/* Un conjunto variado de tareas sueltas: entregas, estados, personas, clientes y cierres de todo tipo. */
function tareas(): Suelta[] {
  const base: Suelta = { estado: "pendiente", entrega: "2026-10-14", horas: 4, unidad: "Insights", cliente: "Altice", persona: "1", personaNombre: "Ana", tipo: "Fee", contrato: "Anual" };
  const lista: Suelta[] = [];
  const unidades = ["Insights", "Campo"], clientes = ["Altice", "Claro", ""], personas: [string, string][] = [["1", "Ana"], ["2", "Beto"]];
  const estados: Suelta["estado"][] = ["pendiente", "en_curso", "bloqueada", "revision", "hecha"];
  const entregas = ["2026-09-20", "2026-10-01", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-30", "2026-11-20"];
  let i = 0;
  for (const u of unidades) for (const c of clientes) for (const [p, pn] of personas) for (const e of estados) for (const d of entregas) {
    i++;
    lista.push({
      ...base, unidad: u, cliente: c, persona: p, personaNombre: pn, estado: e, entrega: d, tipo: c ? (i % 2 ? "Fee" : "Proyecto") : "",
      contrato: i % 3 ? "Anual" : "", horas: 1 + (i % 5),
      pasosTotal: i % 4 ? 4 : 0, pasosHechos: i % 7 ? 1 : 3,
      hechaEl: e === "hecha" ? (i % 2 ? "2026-10-06" : "2026-10-12") : null,
    });
  }
  return lista;
}

const FILTROS: FiltrosCruzados[] = [
  SIN_FILTROS,
  { ...SIN_FILTROS, unidad: "Insights" },
  { ...SIN_FILTROS, cliente: "Claro", persona: "2" },
  { ...SIN_FILTROS, estado: "vencida" },
  { ...SIN_FILTROS, estado: "abierta", tipo: "Fee" },
  { ...SIN_FILTROS, semana: "2026-10-12" },
  { ...SIN_FILTROS, contrato: "Anual", estado: "hecha" },
];

describe("celdas del panel", () => {
  const sueltas = tareas();
  const individuales = sueltas.map((t) => acumularCeldas([entradaDeTarea(t, HOY)])[0]);
  const juntas = acumularCeldas(sueltas.map((t) => entradaDeTarea(t, HOY)));

  it("juntar tareas en celdas no cambia ninguna cifra ni ningun grafico, con ningun filtro ni metrica", () => {
    expect(juntas.length).toBeLessThan(individuales.length);
    for (const f of FILTROS) {
      for (const m of ["n", "h"] as const) {
        expect(resumen(juntas, f, HOY, m), JSON.stringify(f)).toEqual(resumen(individuales, f, HOY, m));
        expect(cargaPorPersona(juntas, f, HOY, m)).toEqual(cargaPorPersona(individuales, f, HOY, m));
        expect(estadoPorCliente(juntas, f, HOY, m)).toEqual(estadoPorCliente(individuales, f, HOY, m));
        expect(entregasPorSemana(juntas, f, HOY, m)).toEqual(entregasPorSemana(individuales, f, HOY, m));
        for (const dim of ["tipo", "unidad"] as const) expect(repartoPor(juntas, f, HOY, m, dim, "Sin")).toEqual(repartoPor(individuales, f, HOY, m, dim, "Sin"));
      }
      for (const dim of ["unidad", "cliente", "persona", "tipo", "contrato"] as const) expect(opcionesDe(juntas, f, HOY, dim)).toEqual(opcionesDe(individuales, f, HOY, dim));
    }
  });

  it("el total de tareas y de horas se conserva", () => {
    expect(juntas.reduce((a, c) => a + c.n, 0)).toBe(sueltas.length);
    expect(juntas.reduce((a, c) => a + c.horas, 0)).toBeCloseTo(sueltas.reduce((a, t) => a + t.horas, 0), 6);
  });

  it("el riesgo de la celda es el de riesgoDe, tarea por tarea (vencida y en riesgo; la bloqueada no cuenta)", () => {
    for (const t of sueltas) {
      const r = riesgoDe(t, HOY);
      expect(entradaDeTarea(t, HOY).riesgo).toBe(r === "vencida" || r === "en_riesgo" ? r : "");
    }
  });

  it("la puntualidad solo cuenta lo cerrado en los ultimos 30 dias, a tiempo o tarde", () => {
    const hecha = (hechaEl: string | null, entrega = "2026-10-06"): Suelta => ({ ...sueltas[0], estado: "hecha", entrega, hechaEl });
    expect(entradaDeTarea(hecha("2026-10-05"), HOY).tiempo).toBe("a");
    expect(entradaDeTarea(hecha("2026-10-06"), HOY).tiempo).toBe("a");
    expect(entradaDeTarea(hecha("2026-10-07"), HOY).tiempo).toBe("t");
    expect(entradaDeTarea(hecha("2026-08-01"), HOY).tiempo).toBe(""); // hace mas de 30 dias
    expect(entradaDeTarea(hecha(null), HOY).tiempo).toBe(""); // sin fecha de cierre (datos anteriores)
    expect(entradaDeTarea({ ...sueltas[0], estado: "pendiente", hechaEl: "2026-10-05" }, HOY).tiempo).toBe("");
  });

  it("las horas de un grupo cuentan las sin estimar con las de por defecto", () => {
    expect(horasDeGrupo(6, 3, 3)).toBe(6); // tres con 2 h
    expect(horasDeGrupo(0, 0, 3)).toBe(12); // tres sin estimar: 4 h cada una
    expect(horasDeGrupo(5, 2, 3)).toBe(9); // dos con 5 h en total y una sin estimar
  });

  it("codificar y decodificar devuelven las mismas celdas, y viajan como numeros", () => {
    const wire = codificarCeldas(juntas);
    expect(decodificarCeldas(wire)).toEqual(juntas.map((c) => ({ ...c, riesgo: c.riesgo ?? "" })));
    // Cada texto aparece una sola vez en los diccionarios, no en cada celda.
    expect(new Set(wire.c).size).toBe(wire.c.length);
    expect(JSON.stringify(wire.f)).not.toContain("Altice");
    expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(juntas).length / 2);
  });

  it("una entrada sin entrega no rompe la semana", () => {
    const e: Entrada = { unidad: "", cliente: "", persona: "1", personaNombre: "Ana", tipo: "", contrato: "", estado: "pendiente", entrega: "", n: 2, horas: 8, riesgo: "", tiempo: "" };
    const [c] = acumularCeldas([e]);
    expect(c.entrega).toBeNull();
    expect(decodificarCeldas(codificarCeldas([c]))[0].entrega).toBeNull();
  });
});
