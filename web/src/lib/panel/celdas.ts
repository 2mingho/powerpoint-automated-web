/*
 * Celdas del panel (logica pura): como se juntan las tareas en combinaciones y como viajan.
 *
 * El servidor las construye en dos caminos que dan el mismo resultado que tarea por tarea:
 *   - lo corriente llega ya agrupado por la base (una entrada por combinacion y dia de entrega, con su cuenta);
 *   - lo que necesita su fila real (las que vencen en los proximos dias, para el riesgo, y las cerradas en
 *     los ultimos 30 dias, para la puntualidad) entra una a una con entradaDeTarea.
 * acumularCeldas las junta por combinacion y semana, y codificar/decodificar las pasan al navegador
 * como numeros con diccionarios (un texto repetido no se manda mil veces).
 */
import { HORAS_POR_DEFECTO } from "@/lib/seguimiento/estado";
import { riesgoDe, type Riesgo, type TareaSeg } from "@/lib/seguimiento/riesgo";
import { lunesDe, sumarDias } from "@/lib/tareas/fechas";
import { GRUPOS_ESTADO, type CeldaPanel } from "./tipos";

type Grupo = (typeof GRUPOS_ESTADO)[number]["valor"];

/* Una o varias tareas con la misma combinacion y el mismo dia de entrega. */
export type Entrada = {
  unidad: string;
  cliente: string;
  persona: string;
  personaNombre: string;
  tipo: string;
  contrato: string;
  estado: Grupo;
  /* Dia de entrega (YYYY-MM-DD). */
  entrega: string;
  n: number;
  /* Horas TOTALES de las n tareas. */
  horas: number;
  riesgo: "" | "vencida" | "en_riesgo";
  tiempo: "" | "a" | "t";
};

/* El riesgo que el panel distingue: la "bloqueada" no cambia nada de lo que se cuenta ni se pinta. */
export function riesgoDelPanel(t: TareaSeg, hoy: string): Entrada["riesgo"] {
  const r: Riesgo = riesgoDe(t, hoy);
  return r === "vencida" || r === "en_riesgo" ? r : "";
}

/* Entrega puntual de una cerrada reciente: "a" si se cerro a mas tardar el dia de entrega. */
export function tiempoDe(entrega: string, hechaEl: string | null | undefined): Entrada["tiempo"] {
  if (!hechaEl) return "";
  return hechaEl <= entrega ? "a" : "t";
}

/* Entrada de una sola tarea: la misma cuenta que el panel hacia antes, fila por fila. */
export function entradaDeTarea(
  t: TareaSeg & { unidad: string; cliente: string; persona: string; personaNombre: string; tipo: string; contrato: string },
  hoy: string,
): Entrada {
  const desde = sumarDias(hoy, -30);
  const reciente = t.estado === "hecha" && !!t.hechaEl && !!t.entrega && t.hechaEl >= desde;
  return {
    unidad: t.unidad, cliente: t.cliente, persona: t.persona, personaNombre: t.personaNombre, tipo: t.tipo, contrato: t.contrato,
    estado: t.estado, entrega: t.entrega ?? "", n: 1, horas: t.horas,
    riesgo: riesgoDelPanel(t, hoy),
    tiempo: reciente ? tiempoDe(t.entrega!, t.hechaEl) : "",
  };
}

/*
 * Horas de un grupo de `n` tareas, de las que `conEstimacion` traen horas (sumadas en `estimadas`):
 * las demas cuentan con las de por defecto.
 */
export function horasDeGrupo(estimadas: number, conEstimacion: number, n: number): number {
  return estimadas + (n - conEstimacion) * HORAS_POR_DEFECTO;
}

const redondear = (x: number) => Math.round(x * 100) / 100;

/* Junta las entradas por combinacion y semana de entrega. El orden de salida es estable. */
export function acumularCeldas(entradas: Entrada[]): CeldaPanel[] {
  const mapa = new Map<string, CeldaPanel>();
  for (const e of entradas) {
    const semana = e.entrega ? lunesDe(e.entrega) : "";
    const clave = [e.unidad, e.cliente, e.persona, e.tipo, e.contrato, semana, e.estado, e.riesgo, e.tiempo].join("\u0001");
    const c = mapa.get(clave);
    if (c) {
      c.n += e.n;
      c.horas += e.horas;
    } else {
      mapa.set(clave, {
        estado: e.estado, entrega: semana || null, horas: e.horas, unidad: e.unidad, cliente: e.cliente, persona: e.persona, tipo: e.tipo,
        contrato: e.contrato, riesgo: e.riesgo, n: e.n, personaNombre: e.personaNombre, tiempo: e.tiempo,
      });
    }
  }
  const celdas = [...mapa.values()];
  for (const c of celdas) c.horas = redondear(c.horas);
  return celdas;
}

/* Lo que viaja al navegador: diccionarios de textos y una fila de numeros por celda. */
export type CeldasWire = {
  u: string[]; c: string[]; p: [string, string][]; t: string[]; k: string[]; s: string[];
  /* [unidad, cliente, persona, tipo, contrato, semana, grupo, riesgo, tiempo, n, horas]; -1 = sin valor. */
  f: number[][];
};

const RIESGOS: Entrada["riesgo"][] = ["", "vencida", "en_riesgo"];
const TIEMPOS: Entrada["tiempo"][] = ["", "a", "t"];
const GRUPOS = GRUPOS_ESTADO.map((g) => g.valor);

export function codificarCeldas(celdas: CeldaPanel[]): CeldasWire {
  const diccionario = <T,>() => ({ lista: [] as T[], indice: new Map<string, number>() });
  const dic = { u: diccionario<string>(), c: diccionario<string>(), p: diccionario<[string, string]>(), t: diccionario<string>(), k: diccionario<string>(), s: diccionario<string>() };
  const idx = <T,>(d: { lista: T[]; indice: Map<string, number> }, clave: string, valor: T) => {
    if (!clave) return -1;
    let i = d.indice.get(clave);
    if (i === undefined) { i = d.lista.length; d.lista.push(valor); d.indice.set(clave, i); }
    return i;
  };
  const f = celdas.map((c) => [
    idx(dic.u, c.unidad, c.unidad), idx(dic.c, c.cliente, c.cliente), idx(dic.p, c.persona, [c.persona, c.personaNombre] as [string, string]),
    idx(dic.t, c.tipo, c.tipo), idx(dic.k, c.contrato, c.contrato), idx(dic.s, c.entrega ?? "", c.entrega ?? ""),
    GRUPOS.indexOf(c.estado), RIESGOS.indexOf((c.riesgo ?? "") as Entrada["riesgo"]), TIEMPOS.indexOf(c.tiempo), c.n, c.horas,
  ]);
  return { u: dic.u.lista, c: dic.c.lista, p: dic.p.lista, t: dic.t.lista, k: dic.k.lista, s: dic.s.lista, f };
}

export function decodificarCeldas(w: CeldasWire): CeldaPanel[] {
  const de = (lista: string[], i: number) => (i >= 0 ? lista[i] : "");
  return w.f.map((r) => ({
    unidad: de(w.u, r[0]), cliente: de(w.c, r[1]),
    persona: r[2] >= 0 ? w.p[r[2]][0] : "", personaNombre: r[2] >= 0 ? w.p[r[2]][1] : "",
    tipo: de(w.t, r[3]), contrato: de(w.k, r[4]), entrega: r[5] >= 0 ? w.s[r[5]] : null,
    estado: GRUPOS[r[6]], riesgo: RIESGOS[r[7]], tiempo: TIEMPOS[r[8]], n: r[9], horas: r[10],
  }));
}
