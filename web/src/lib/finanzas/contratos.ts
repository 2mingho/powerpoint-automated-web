/*
 * Reglas puras de contratos y metas de ingresos: validacion de lo que llega de un
 * formulario y el texto con que se confirma el prorrateo. Solo USD. Sin base ni reloj.
 */
import { esIsoValida } from "@/lib/tareas/fechas";
import { mesesDe } from "@/lib/seguimiento/finanzas";
import type { Leido } from "./concesiones";

export const TIPOS_CONTRATO = ["Fee", "Proyecto", "Asignación"] as const;
export type TipoContrato = (typeof TIPOS_CONTRATO)[number];

/* Tope de un monto: cabe de sobra en numeric(14,2) y evita ceros de mas por error. */
export const MONTO_MAX = 100_000_000_000;

export type DatosContrato = {
  clienteId: number;
  unidadId: number;
  tipo: TipoContrato;
  monto: number;
  inicio: string;
  fin: string;
  /* Unidad que asigna; solo con tipo Asignación. */
  asignaId: number | null;
  nota: string;
};

/* "15000", "15000.5" o "15000,50" (hasta dos decimales), o un numero. Sin separador de miles: seria ambiguo. */
export function leerMonto(crudo: unknown, { permitirCero = false } = {}): Leido<number> {
  const malo = { ok: false, error: "El monto debe ser un número en dólares, con hasta dos decimales y sin separador de miles." } as const;
  let n: number;
  if (typeof crudo === "number") n = crudo;
  else if (typeof crudo === "string" && /^\d+([.,]\d{1,2})?$/.test(crudo.trim())) n = Number(crudo.trim().replace(",", "."));
  else return malo;
  if (!Number.isFinite(n) || Math.round(n * 100) / 100 !== n) return malo;
  if (n < 0 || (n === 0 && !permitirCero)) return { ok: false, error: "El monto debe ser mayor que 0." };
  if (n > MONTO_MAX) return { ok: false, error: "El monto es demasiado grande." };
  return { ok: true, valor: n };
}

const entero = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

/*
 * Contrato completo (alta). Cliente y unidad son ids; que existan lo comprueba
 * quien guarda. El fin es posterior al inicio; solo una Asignación lleva unidad que asigna.
 */
export function leerContrato(crudo: Record<string, unknown>): Leido<DatosContrato> {
  const clienteId = entero(crudo.clienteId);
  if (!clienteId) return { ok: false, error: "Elige el cliente del contrato." };
  const unidadId = entero(crudo.unidadId);
  if (!unidadId) return { ok: false, error: "Elige la unidad del contrato." };
  const tipo = TIPOS_CONTRATO.find((t) => t === crudo.tipo);
  if (!tipo) return { ok: false, error: `El tipo de contrato debe ser ${TIPOS_CONTRATO.join(", ")}.` };
  const monto = leerMonto(crudo.monto);
  if (!monto.ok) return monto;
  const inicio = typeof crudo.inicio === "string" ? crudo.inicio : "";
  const fin = typeof crudo.fin === "string" ? crudo.fin : "";
  if (!esIsoValida(inicio) || !esIsoValida(fin)) return { ok: false, error: "Indica las fechas de inicio y de fin del contrato." };
  if (fin <= inicio) return { ok: false, error: "La fecha de fin debe ser posterior a la de inicio." };
  if (Number(fin.slice(0, 4)) - Number(inicio.slice(0, 4)) > 20) return { ok: false, error: "Un contrato no puede durar más de 20 años." };
  let asignaId: number | null = null;
  if (crudo.asignaId !== undefined && crudo.asignaId !== null && crudo.asignaId !== "") {
    if (tipo !== "Asignación") return { ok: false, error: "Solo una Asignación indica qué unidad asigna." };
    asignaId = entero(crudo.asignaId);
    if (!asignaId) return { ok: false, error: "La unidad que asigna no es válida." };
    if (asignaId === unidadId) return { ok: false, error: "La unidad que asigna debe ser distinta de la que presta el servicio." };
  }
  const nota = typeof crudo.nota === "string" ? crudo.nota.trim() : "";
  if (nota.length > 500) return { ok: false, error: "La nota admite hasta 500 caracteres." };
  return { ok: true, valor: { clienteId, unidadId, tipo, monto: monto.valor, inicio, fin, asignaId, nota } };
}

/* Año de una meta: entero de 2000 a 2100. */
export function leerAnio(crudo: unknown): Leido<number> {
  const n = typeof crudo === "string" && /^\d{4}$/.test(crudo) ? Number(crudo) : crudo;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 2000 || n > 2100) return { ok: false, error: "El año debe estar entre 2000 y 2100." };
  return { ok: true, valor: n };
}

/* "US$15,000", "US$1,250.50": completo, con centavos solo si los hay. */
export function usd(n: number): string {
  const redondeado = Math.round(n * 100) / 100;
  return `US$${redondeado.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(redondeado) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/* Abreviado para ejes y cifras grandes: US$850, US$6.5k, US$143k, US$1.2M. */
export function usdS(n: number): string {
  const a = Math.abs(n);
  const f = (v: number, sufijo: string) => `${n < 0 ? "-" : ""}US$${(Math.round(v * 10) / 10).toString()}${sufijo}`;
  if (a >= 1_000_000) return f(a / 1_000_000, "M");
  if (a >= 10_000) return f(Math.round(a / 1000), "k");
  if (a >= 1_000) return f(a / 1000, "k");
  return `${n < 0 ? "-" : ""}US$${Math.round(a)}`;
}

/* La confirmacion del prorrateo: "US$1,250 por mes durante 12 meses". */
export function textoDeProrrateo(c: { monto: number; inicio: string; fin: string }): string {
  const n = mesesDe(c).length;
  if (!n) return "";
  return `${usd(c.monto / n)} por mes durante ${n} ${n === 1 ? "mes" : "meses"}`;
}
