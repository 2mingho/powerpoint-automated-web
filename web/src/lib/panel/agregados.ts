/*
 * Cifras del panel de Inicio sobre las tareas visibles (logica pura). Cada cifra
 * respeta los filtros cruzados; las de estado omiten el filtro de estado para que
 * el boton elegido siga mostrando su numero y los demas no se vacien.
 */
import { pasaFiltros, riesgoEfectivo, type Dimension, type FiltrosCruzados } from "@/lib/seguimiento/filtros";
import type { CeldaPanel, Metrica } from "./tipos";

/* Lo que aporta una celda: sus horas o sus tareas segun lo que se cuente. */
export const valorDe = (f: CeldaPanel, m: Metrica) => (m === "h" ? f.horas : f.n);

/*
 * % de entregas cerradas en los ultimos 30 dias que llegaron a tiempo; null si no hubo ninguna: no se
 * inventa un 100 %. Cuenta tareas (no horas) aunque la metrica sea horas, como siempre.
 */
export function puntualidadDe(celdas: CeldaPanel[]): number | null {
  let a = 0, t = 0;
  for (const c of celdas) {
    if (c.tiempo === "a") a += c.n;
    else if (c.tiempo === "t") t += c.n;
  }
  return a + t ? Math.round((100 * a) / (a + t)) : null;
}

export type Resumen = {
  clientes: number;
  tareas: number;
  completadas: number;
  abiertas: number;
  vencidas: number;
  /* % de cierres de los ultimos 30 dias que llegaron a su fecha; null si no hubo. */
  aTiempo: number | null;
};

const redondear = (n: number) => Math.round(n * 100) / 100;

export function resumen(filas: CeldaPanel[], f: FiltrosCruzados, hoy: string, m: Metrica): Resumen {
  const todas = filas.filter((t) => pasaFiltros(t, f, hoy));
  const sinEstado = filas.filter((t) => pasaFiltros(t, f, hoy, "estado"));
  const suma = (l: CeldaPanel[]) => redondear(l.reduce((a, t) => a + valorDe(t, m), 0));
  return {
    clientes: new Set(todas.filter((t) => t.cliente).map((t) => t.cliente)).size,
    tareas: suma(todas),
    completadas: suma(sinEstado.filter((t) => t.estado === "hecha")),
    abiertas: suma(sinEstado.filter((t) => t.estado !== "hecha")),
    vencidas: suma(sinEstado.filter((t) => riesgoEfectivo(t, hoy) === "vencida")),
    aTiempo: puntualidadDe(todas),
  };
}

export type Opcion = { valor: string; etiqueta: string; n: number };

type DimensionDeLista = Extract<Dimension, "unidad" | "cliente" | "persona" | "tipo" | "contrato">;

/*
 * Valores que puede tomar una dimension dado el resto de filtros: sin ellos
 * se elegiria una combinacion vacia. Mantiene el valor elegido aunque ya no haya filas.
 */
export function opcionesDe(filas: CeldaPanel[], f: FiltrosCruzados, hoy: string, dim: DimensionDeLista): Opcion[] {
  const cuenta = new Map<string, Opcion>();
  for (const t of filas) {
    if (!pasaFiltros(t, f, hoy, dim)) continue;
    const valor = t[dim];
    if (!valor) continue;
    const o = cuenta.get(valor);
    if (o) o.n += t.n;
    else cuenta.set(valor, { valor, etiqueta: dim === "persona" ? t.personaNombre : valor, n: t.n });
  }
  const elegido = f[dim];
  if (elegido && !cuenta.has(elegido)) {
    const t = filas.find((x) => x[dim] === elegido);
    cuenta.set(elegido, { valor: elegido, etiqueta: dim === "persona" ? (t?.personaNombre ?? elegido) : elegido, n: 0 });
  }
  return [...cuenta.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es", { sensitivity: "base" }));
}
