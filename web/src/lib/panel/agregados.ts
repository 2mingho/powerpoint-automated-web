/*
 * Cifras del panel de Inicio sobre las tareas visibles (logica pura). Cada cifra
 * respeta los filtros cruzados; las de estado omiten el filtro de estado para que
 * el boton elegido siga mostrando su numero y los demas no se vacien.
 */
import { pasaFiltros, type Dimension, type FiltrosCruzados } from "@/lib/seguimiento/filtros";
import { puntualidad, riesgoDe } from "@/lib/seguimiento/riesgo";
import type { FilaPanel, Metrica } from "./tipos";

export const valorDe = (f: FilaPanel, m: Metrica) => (m === "h" ? f.horas : 1);

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

export function resumen(filas: FilaPanel[], f: FiltrosCruzados, hoy: string, m: Metrica): Resumen {
  const todas = filas.filter((t) => pasaFiltros(t, f, hoy));
  const sinEstado = filas.filter((t) => pasaFiltros(t, f, hoy, "estado"));
  const suma = (l: FilaPanel[]) => redondear(l.reduce((a, t) => a + valorDe(t, m), 0));
  return {
    clientes: new Set(todas.filter((t) => t.cliente).map((t) => t.cliente)).size,
    tareas: suma(todas),
    completadas: suma(sinEstado.filter((t) => t.estado === "hecha")),
    abiertas: suma(sinEstado.filter((t) => t.estado !== "hecha")),
    vencidas: suma(sinEstado.filter((t) => riesgoDe(t, hoy) === "vencida")),
    aTiempo: puntualidad(todas.map((t) => ({ ...t, esEntrega: true })), hoy),
  };
}

export type Opcion = { valor: string; etiqueta: string; n: number };

type DimensionDeLista = Extract<Dimension, "unidad" | "cliente" | "persona" | "tipo" | "contrato">;

/*
 * Valores que puede tomar una dimension dado el resto de filtros: sin ellos
 * se elegiria una combinacion vacia. Mantiene el valor elegido aunque ya no haya filas.
 */
export function opcionesDe(filas: FilaPanel[], f: FiltrosCruzados, hoy: string, dim: DimensionDeLista): Opcion[] {
  const cuenta = new Map<string, Opcion>();
  for (const t of filas) {
    if (!pasaFiltros(t, f, hoy, dim)) continue;
    const valor = t[dim];
    if (!valor) continue;
    const o = cuenta.get(valor);
    if (o) o.n++;
    else cuenta.set(valor, { valor, etiqueta: dim === "persona" ? t.personaNombre : valor, n: 1 });
  }
  const elegido = f[dim];
  if (elegido && !cuenta.has(elegido)) {
    const t = filas.find((x) => x[dim] === elegido);
    cuenta.set(elegido, { valor: elegido, etiqueta: dim === "persona" ? (t?.personaNombre ?? elegido) : elegido, n: 0 });
  }
  return [...cuenta.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es", { sensitivity: "base" }));
}
