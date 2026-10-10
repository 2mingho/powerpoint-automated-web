/*
 * Periodos del panel de Inicio (los atajos de fecha del MVP). Logica pura: el
 * "hoy" lo pasa quien llama. "mes" es el predeterminado.
 */
import { esIsoValida, lunesDe, sumarDias } from "@/lib/tareas/fechas";

export const PERIODOS = ["semana", "mes", "ultimos30", "proximos30", "todo", "rango"] as const;
export type Periodo = (typeof PERIODOS)[number];

export const ROTULO_PERIODO: Record<Periodo, string> = {
  semana: "Esta semana",
  mes: "Este mes",
  ultimos30: "Últimos 30 días",
  proximos30: "Próximos 30 días",
  todo: "Todo",
  rango: "Fechas",
};

export type RangoFechas = { desde: string; hasta: string };

export function leerPeriodo(crudo: unknown): Periodo {
  return typeof crudo === "string" && (PERIODOS as readonly string[]).includes(crudo) ? (crudo as Periodo) : "mes";
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/* Rango de entrega, extremos incluidos; "" deja el extremo abierto. `rango` toma las fechas dadas si son validas. */
export function rangoDePeriodo(p: Periodo, hoy: string, manual?: { desde?: unknown; hasta?: unknown }): RangoFechas {
  switch (p) {
    case "semana": { const l = lunesDe(hoy); return { desde: l, hasta: sumarDias(l, 6) }; }
    case "mes": {
      const [a, m] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
      return { desde: `${hoy.slice(0, 8)}01`, hasta: `${hoy.slice(0, 8)}${String(ultimoDiaDelMes(a, m)).padStart(2, "0")}` };
    }
    case "ultimos30": return { desde: sumarDias(hoy, -30), hasta: hoy };
    case "proximos30": return { desde: hoy, hasta: sumarDias(hoy, 30) };
    case "todo": return { desde: "", hasta: "" };
    case "rango": {
      const v = (x: unknown) => (typeof x === "string" && esIsoValida(x) ? x : "");
      let desde = v(manual?.desde);
      let hasta = v(manual?.hasta);
      if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
      return { desde, hasta };
    }
  }
}
