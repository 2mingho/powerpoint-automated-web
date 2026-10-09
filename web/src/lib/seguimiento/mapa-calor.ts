/*
 * Mapa de calor de carga: personas x semanas (logica pura). Cada celda es la
 * razon entre las horas abiertas que caen en la semana y la capacidad semanal
 * de la persona. Una tarea sin estimar cuenta HORAS_POR_DEFECTO y se marca, para
 * que nadie lea ese numero como un dato real.
 */
import { sumarDias, lunesDe } from "@/lib/tareas/fechas";
import { CAPACIDAD_ESTANDAR, HORAS_POR_DEFECTO } from "./estado";
import { nivelDeCarga, repartoSemanal, type TareaSeg } from "./riesgo";

export type PersonaCarga = { id: number; nombre: string; capacidad: number | null };
export type TareaDeCarga = TareaSeg & { personaId: number; estimada: boolean };

export type CeldaCalor = {
  semana: string;
  horas: number;
  razon: number;
  nivel: 0 | 1 | 2 | 3 | 4;
  /* Tareas que aportan horas a esta semana, y cuantas de ellas no estan estimadas. */
  tareas: number;
  sinEstimar: number;
};

export type FilaCalor = { personaId: number; nombre: string; capacidad: number; celdas: CeldaCalor[]; pico: number };

/* Lunes de esta semana y de las siguientes (`n` en total). */
export function semanasDesde(hoy: string, n = 4): string[] {
  const primera = lunesDe(hoy);
  return Array.from({ length: n }, (_, i) => sumarDias(primera, 7 * i));
}

/*
 * Una fila por persona con capacidad mayor que 0 (con 0 no recibe carga y no
 * se pinta), de la mas cargada a la menos. Las tareas de personas que no estan
 * en `personas` se ignoran: quien llama decide a quien se muestra.
 */
export function mapaDeCalor(personas: PersonaCarga[], tareas: TareaDeCarga[], semanas: string[], hoy: string): FilaCalor[] {
  const porPersona = new Map<number, TareaDeCarga[]>();
  for (const t of tareas) porPersona.set(t.personaId, [...(porPersona.get(t.personaId) ?? []), t]);

  const filas: FilaCalor[] = [];
  for (const p of personas) {
    const capacidad = p.capacidad ?? CAPACIDAD_ESTANDAR;
    if (capacidad <= 0) continue;
    const celdas: CeldaCalor[] = semanas.map((semana) => ({ semana, horas: 0, razon: 0, nivel: 0, tareas: 0, sinEstimar: 0 }));
    const acumulado = semanas.map(() => 0);
    for (const t of porPersona.get(p.id) ?? []) {
      const horas = t.estimada ? t.horas : HORAS_POR_DEFECTO;
      repartoSemanal({ ...t, horas }, semanas, hoy).forEach((h, i) => {
        if (h <= 0) return;
        acumulado[i] += h;
        celdas[i].tareas++;
        if (!t.estimada) celdas[i].sinEstimar++;
      });
    }
    celdas.forEach((c, i) => {
      c.horas = Math.round(acumulado[i]);
      c.razon = acumulado[i] / capacidad;
      c.nivel = nivelDeCarga(c.razon);
    });
    filas.push({ personaId: p.id, nombre: p.nombre, capacidad, celdas, pico: Math.max(0, ...celdas.map((c) => c.razon)) });
  }
  return filas.sort((a, b) => b.pico - a.pico || a.nombre.localeCompare(b.nombre, "es"));
}
