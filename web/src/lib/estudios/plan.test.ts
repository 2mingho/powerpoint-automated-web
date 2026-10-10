import { describe, expect, it } from "vitest";
import { avanceEstudio, estadoDeFases, FASES, PLAN_BASE, planPara, primerDiaHabil, repartirFechas, type PasoEstudio } from "./plan";

describe("plan por metodo", () => {
  const nombres = (m: Parameters<typeof planPara>[0]) => planPara(m).map((p) => p.nombre);

  it("cuantitativo omite el campo cualitativo, y al reves; mixto lleva ambos", () => {
    expect(nombres("Cuantitativo")).toContain("Trabajo de campo cuantitativo");
    expect(nombres("Cuantitativo")).not.toContain("Trabajo de campo cualitativo");
    expect(nombres("Cualitativo")).toContain("Trabajo de campo cualitativo");
    expect(nombres("Cualitativo")).not.toContain("Trabajo de campo cuantitativo");
    expect(nombres("Mixto")).toHaveLength(8);
    expect(nombres("Cuantitativo")).toHaveLength(7);
  });

  it("cubre las siete fases y las sigue en orden", () => {
    const fases = planPara("Mixto").map((p) => p.fase);
    expect([...new Set(fases)]).toEqual([...FASES]);
    expect(fases.map((f) => FASES.indexOf(f))).toEqual([...fases.map((f) => FASES.indexOf(f))].sort((a, b) => a - b));
  });

  it("ordena un plan propio por fase sin perder el orden dentro de cada una", () => {
    const desordenado = [PLAN_BASE[6], PLAN_BASE[0], PLAN_BASE[4], PLAN_BASE[3]]; // informe, propuesta, campo cual., campo cuant.
    expect(planPara("Mixto", desordenado).map((p) => p.nombre)).toEqual(["Propuesta", "Trabajo de campo cualitativo", "Trabajo de campo cuantitativo", "Informe de resultados"]);
  });
});

describe("reparto de fechas", () => {
  const plan = planPara("Cuantitativo");
  const HOY = "2026-10-12"; // lunes

  it("secuencia sin huecos hacia atras, termina en la entrega y no la pasa", () => {
    const f = repartirFechas(plan, HOY, "2026-11-06"); // 20 dias habiles
    expect(f[0].inicio).toBe(HOY);
    expect(f.at(-1)?.entrega).toBe("2026-11-06");
    for (let i = 0; i < f.length; i++) {
      expect(f[i].inicio <= f[i].entrega).toBe(true);
      expect(f[i].entrega <= "2026-11-06").toBe(true);
      if (i) expect(f[i].inicio >= f[i - 1].entrega).toBe(true);
    }
  });

  it("los pasos con mas horas reciben mas dias", () => {
    const f = repartirFechas(plan, HOY, "2026-12-04"); // 40 dias habiles
    const span = (p: (typeof f)[number]) => (new Date(`${p.entrega}T00:00:00Z`).getTime() - new Date(`${p.inicio}T00:00:00Z`).getTime()) / 86_400_000;
    const informe = f.find((p) => p.fase === "Informe")!; // 24 h
    const kick = f.find((p) => p.fase === "Kick off")!; // 4 h
    expect(span(informe)).toBeGreaterThan(span(kick));
  });

  it("no cae en fin de semana", () => {
    for (const p of repartirFechas(plan, HOY, "2026-12-31")) {
      for (const d of [p.inicio, p.entrega]) expect([0, 6]).not.toContain(new Date(`${d}T12:00:00Z`).getUTCDay());
    }
  });

  it("con menos dias que pasos, comparten dia y el ultimo cae en la entrega", () => {
    const f = repartirFechas(plan, "2026-10-12", "2026-10-14"); // 3 dias, 7 pasos
    expect(f).toHaveLength(7);
    expect(f.at(-1)?.entrega).toBe("2026-10-14");
    expect(new Set(f.map((p) => p.entrega)).size).toBeLessThanOrEqual(3);
    for (let i = 1; i < f.length; i++) expect(f[i].entrega >= f[i - 1].entrega).toBe(true);
  });

  it("un solo dia: todo cae ese dia", () => {
    const f = repartirFechas(plan, "2026-10-12", "2026-10-12");
    expect(f.every((p) => p.inicio === "2026-10-12" && p.entrega === "2026-10-12")).toBe(true);
  });

  it("una entrega en fin de semana termina el ultimo dia habil anterior", () => {
    expect(repartirFechas(plan, HOY, "2026-10-17").at(-1)?.entrega).toBe("2026-10-16"); // sabado -> viernes
  });

  it("sin dias habiles (entrega antes del inicio) todo cae en la entrega", () => {
    expect(repartirFechas(plan, "2026-10-12", "2026-10-09").every((p) => p.entrega === "2026-10-09")).toBe(true);
    expect(repartirFechas([], HOY, "2026-11-06")).toEqual([]);
  });

  it("primer dia habil: hoy si lo es, el lunes si no", () => {
    expect(primerDiaHabil("2026-10-12")).toBe("2026-10-12");
    expect(primerDiaHabil("2026-10-10")).toBe("2026-10-12"); // sabado
  });
});

describe("avance y fases", () => {
  const p = (fase: string, o: Partial<PasoEstudio> = {}): PasoEstudio => ({ fase, horas: 10, hecho: false, iniciado: false, entrega: "2026-12-01", ...o });

  it("el avance se pondera por horas, y lo sin estimar pesa 4", () => {
    expect(avanceEstudio([{ horas: 30, hecho: true }, { horas: 10, hecho: false }])).toBe(0.75);
    expect(avanceEstudio([{ horas: null, hecho: true }, { horas: 4, hecho: false }])).toBe(0.5);
    expect(avanceEstudio([])).toBe(0);
  });

  it("estado de cada fase y fase actual", () => {
    const f = estadoDeFases([
      p("Propuesta", { hecho: true }), p("Kick off", { hecho: true }),
      p("Instrumentos", { hecho: true }), p("Instrumentos", { iniciado: true }), // a medias
      p("Campo", { entrega: "2026-10-01" }), // vencida
      p("Informe"),
    ], "2026-10-08");
    expect(f.map((x) => [x.fase, x.estado, x.actual])).toEqual([
      ["Propuesta", "completa", false], ["Kick off", "completa", false], ["Instrumentos", "en_curso", true],
      ["Campo", "vencida", false], ["Informe", "pendiente", false],
    ]);
  });

  it("solo salen las fases que tienen pasos y, si todo esta hecho, no hay fase actual", () => {
    const f = estadoDeFases([p("Propuesta", { hecho: true }), p("Informe", { hecho: true })], "2026-10-08");
    expect(f.map((x) => x.fase)).toEqual(["Propuesta", "Informe"]);
    expect(f.some((x) => x.actual)).toBe(false);
  });

  it("una fase con un paso vencido y otro hecho esta vencida (lo atrasado manda sobre lo avanzado)", () => {
    const f = estadoDeFases([p("Campo", { hecho: true }), p("Campo", { entrega: "2026-09-01" })], "2026-10-08");
    expect(f[0].estado).toBe("vencida");
  });
});
