/*
 * Estudios por fases (logica pura). Un estudio es una tarea de tipo "estudio" cuyos
 * pasos son tareas hijas, una por paso del plan, cada una con su fase. Aqui viven
 * las fases, el plan por defecto, el reparto de fechas y el avance; ni base ni reloj.
 */
import { HORAS_POR_DEFECTO } from "@/lib/seguimiento/estado";
import { habilesEntre } from "@/lib/seguimiento/riesgo";
import { esFinDeSemana, sumarDias } from "@/lib/tareas/fechas";

export const FASES = ["Propuesta", "Kick off", "Instrumentos", "Campo", "Procesamiento", "Informe", "Presentación"] as const;
export type Fase = (typeof FASES)[number];

export const METODOS = ["Cuantitativo", "Cualitativo", "Mixto"] as const;
export type Metodo = (typeof METODOS)[number];

export type PasoPlan = {
  nombre: string;
  fase: Fase;
  horas: number;
  /* Solo el campo distingue: un estudio cuantitativo omite el cualitativo y al reves; Mixto lleva ambos. */
  metodo?: "Cuantitativo" | "Cualitativo";
  checklist: string[];
};

/* Plan por defecto: un paso por fase, y dos de campo (uno por metodo). Cada unidad puede definir el suyo con plantillas con fase. */
export const PLAN_BASE: PasoPlan[] = [
  { nombre: "Propuesta", fase: "Propuesta", horas: 8, checklist: ["Levantar requerimientos con el cliente", "Definir alcance y metodología", "Enviar propuesta y cotización"] },
  { nombre: "Kick off con el cliente", fase: "Kick off", horas: 4, checklist: ["Preparar la agenda", "Reunión de arranque", "Acta de acuerdos"] },
  { nombre: "Diseño de instrumentos", fase: "Instrumentos", horas: 12, checklist: ["Borrador del instrumento", "Validación con el cliente", "Prueba piloto"] },
  { nombre: "Trabajo de campo cuantitativo", fase: "Campo", horas: 20, metodo: "Cuantitativo", checklist: ["Programar el cuestionario", "Capacitar al equipo de campo", "Levantar y supervisar las encuestas"] },
  { nombre: "Trabajo de campo cualitativo", fase: "Campo", horas: 20, metodo: "Cualitativo", checklist: ["Reclutar participantes", "Moderar sesiones o entrevistas", "Transcribir y codificar"] },
  { nombre: "Procesamiento y análisis", fase: "Procesamiento", horas: 16, checklist: ["Depurar la base", "Procesar y cruzar resultados", "Revisar hallazgos"] },
  { nombre: "Informe de resultados", fase: "Informe", horas: 24, checklist: ["Redactar el informe", "Revisión interna", "Entrega al cliente"] },
  { nombre: "Presentación de resultados", fase: "Presentación", horas: 8, checklist: ["Preparar la presentación", "Presentar al cliente", "Cierre y lecciones aprendidas"] },
];

const ordenFase = (f: string) => FASES.indexOf(f as Fase);

/* Los pasos que aplican al metodo, en el orden de las fases (estable dentro de cada una). */
export function planPara(metodo: Metodo, base: PasoPlan[] = PLAN_BASE): PasoPlan[] {
  return base
    .filter((p) => !p.metodo || metodo === "Mixto" || p.metodo === metodo)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ordenFase(a.p.fase) - ordenFase(b.p.fase) || a.i - b.i)
    .map((x) => x.p);
}

export type PasoFechado = PasoPlan & { inicio: string; entrega: string };

/*
 * Reparte los dias habiles entre `inicio` y `entrega` entre los pasos, en
 * secuencia y en proporcion a sus horas, sin pasar de la entrega final. Si hay
 * menos dias que pasos, los pasos comparten dia. El ultimo termina el ultimo dia
 * habil disponible. Sin dias habiles (entrega antes del inicio), todo cae en `entrega`.
 */
export function repartirFechas(plan: PasoPlan[], inicio: string, entrega: string): PasoFechado[] {
  const dias = habilesEntre(inicio, entrega);
  if (!plan.length) return [];
  if (!dias.length) return plan.map((p) => ({ ...p, inicio: entrega, entrega }));
  const n = dias.length;
  const total = plan.reduce((a, p) => a + p.horas, 0) || plan.length;
  let acumulado = 0;
  let finPrevio = -1;
  return plan.map((p, i) => {
    acumulado += p.horas || (total === plan.length ? 1 : 0);
    const esUltimo = i === plan.length - 1;
    const fin = esUltimo ? n - 1 : Math.min(n - 1, Math.max(finPrevio, Math.round((acumulado / total) * n) - 1, 0));
    const ini = Math.min(finPrevio + 1, fin);
    finPrevio = fin;
    return { ...p, inicio: dias[Math.max(0, ini)], entrega: dias[fin] };
  });
}

/* Primer dia habil desde `desde` (hoy si lo es). */
export function primerDiaHabil(desde: string): string {
  let d = desde;
  while (esFinDeSemana(d)) d = sumarDias(d, 1);
  return d;
}

export type PasoEstudio = { fase: string; horas: number | null; hecho: boolean; iniciado: boolean; entrega: string | null };

/* Avance ponderado por horas (una tarea sin estimar pesa lo de por defecto). 0 a 1; sin pasos, 0. */
export function avanceEstudio(pasos: Pick<PasoEstudio, "horas" | "hecho">[]): number {
  const peso = (p: Pick<PasoEstudio, "horas">) => p.horas ?? HORAS_POR_DEFECTO;
  const total = pasos.reduce((a, p) => a + peso(p), 0);
  return total ? pasos.filter((p) => p.hecho).reduce((a, p) => a + peso(p), 0) / total : 0;
}

export type EstadoFase = "completa" | "en_curso" | "vencida" | "pendiente";
export type FaseEstado = { fase: Fase; estado: EstadoFase; pasos: number; hechos: number; actual: boolean };

/*
 * Estado de cada fase que tiene pasos: completa si todos estan hechos; vencida si
 * algun paso abierto ya paso su fecha; en curso si algo se hizo o se inicio;
 * pendiente si no. La fase actual es la primera que no esta completa.
 */
export function estadoDeFases(pasos: PasoEstudio[], hoy: string): FaseEstado[] {
  const lista = FASES.filter((f) => pasos.some((p) => p.fase === f)).map((fase) => {
    const ps = pasos.filter((p) => p.fase === fase);
    const hechos = ps.filter((p) => p.hecho).length;
    const estado: EstadoFase = hechos === ps.length ? "completa"
      : ps.some((p) => !p.hecho && p.entrega && p.entrega < hoy) ? "vencida"
      : hechos > 0 || ps.some((p) => p.iniciado) ? "en_curso" : "pendiente";
    return { fase, estado, pasos: ps.length, hechos, actual: false };
  });
  const actual = lista.find((f) => f.estado !== "completa");
  if (actual) actual.actual = true;
  return lista;
}
