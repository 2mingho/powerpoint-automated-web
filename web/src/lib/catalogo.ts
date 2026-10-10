import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/*
 * Estados y prioridades de tarea (services/catalogo.py). Lo que importa no es
 * leer dos tablas: es que el codigo deje de razonar con nombres. "Completado"
 * no es una etiqueta sino una condicion (es_final), y renombrarlo no puede
 * romper vencimientos ni indicadores.
 */

const ESTADOS_RESPALDO = ["Pendiente", "En Progreso", "Bloqueado", "En Revisión", "Completado"];
const FINALES_RESPALDO = ["Completado"];
const PRIORIDADES_RESPALDO = ["Alta", "Media", "Baja"];

export type Tono = "neutro" | "info" | "aviso" | "alerta" | "bien" | "violeta";

export type Estado = { nombre: string; orden: number; color: Tono; esInicial: boolean; esFinal: boolean };
export type Prioridad = { nombre: string; orden: number; color: Tono; esDefecto: boolean };

export const estados = cache(async (): Promise<Estado[]> => {
  try {
    const filas = await db.task_statuses.findMany({ orderBy: [{ orden: "asc" }, { nombre: "asc" }] });
    if (filas.length) {
      return filas.map((e) => ({
        nombre: e.nombre, orden: e.orden, color: e.color as Tono, esInicial: e.es_inicial, esFinal: e.es_final,
      }));
    }
  } catch { /* base anterior al catalogo */ }
  return ESTADOS_RESPALDO.map((nombre, i) => ({
    nombre, orden: (i + 1) * 10, color: "neutro", esInicial: i === 0, esFinal: FINALES_RESPALDO.includes(nombre),
  }));
});

export const prioridades = cache(async (): Promise<Prioridad[]> => {
  try {
    const filas = await db.task_priorities.findMany({ orderBy: [{ orden: "desc" }, { nombre: "asc" }] });
    if (filas.length) {
      return filas.map((p) => ({ nombre: p.nombre, orden: p.orden, color: p.color as Tono, esDefecto: p.es_defecto }));
    }
  } catch { /* idem */ }
  return PRIORIDADES_RESPALDO.map((nombre, i) => ({
    nombre, orden: (3 - i) * 10, color: "neutro", esDefecto: nombre === "Media",
  }));
});

export async function estadosValidos() { return (await estados()).map((e) => e.nombre); }
export async function estadosFinales() {
  const f = (await estados()).filter((e) => e.esFinal).map((e) => e.nombre);
  return f.length ? f : FINALES_RESPALDO;
}
export async function estadoInicial() {
  const lista = await estados();
  return (lista.find((e) => e.esInicial) ?? lista[0])?.nombre ?? "Pendiente";
}
export async function prioridadesValidas() { return (await prioridades()).map((p) => p.nombre); }
export async function prioridadPorDefecto() {
  const lista = await prioridades();
  return (lista.find((p) => p.esDefecto) ?? lista[Math.floor(lista.length / 2)])?.nombre ?? "Media";
}
