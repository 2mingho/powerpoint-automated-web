/*
 * Contratos prorrateados por mes (logica pura). Portado del MVP: monthsOf,
 * perMonth, inYear y finRows. Solo USD. Quien puede ver cada contrato lo
 * decide el servidor con alcanceUnidades antes de llegar aqui.
 *
 * Un contrato reparte su monto en partes iguales entre los meses naturales que
 * toca, de inicio a fin, aunque empiece o termine a mitad de mes.
 */
export type ContratoFin = { monto: number; inicio: string; fin: string };

/* Meses "YYYY-MM" que toca el contrato; vacio si faltan fechas o fin < inicio. */
export function mesesDe(c: Pick<ContratoFin, "inicio" | "fin">): string[] {
  const out: string[] = [];
  if (!c.inicio || !c.fin || c.fin < c.inicio) return out;
  let [a, m] = c.inicio.split("-").map(Number);
  const [ea, em] = c.fin.split("-").map(Number);
  while ((a < ea || (a === ea && m <= em)) && out.length <= 600) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return out;
}

export function porMes(c: ContratoFin): number {
  const n = mesesDe(c).length;
  return n ? (Number(c.monto) || 0) / n : 0;
}

/* Ingreso del contrato que cae en ese ano. */
export function enAnio(c: ContratoFin, anio: number): number {
  return mesesDe(c).filter((m) => m.startsWith(`${anio}-`)).length * porMes(c);
}

export type FilaFin<C extends ContratoFin> = { contrato: C; meses: number[]; total: number };

/* Una fila por contrato con su ingreso de cada mes del ano; se omiten los que no tocan el ano. */
export function filasFin<C extends ContratoFin>(contratos: C[], anio: number, filtro?: (c: C) => boolean): FilaFin<C>[] {
  return contratos
    .filter((c) => !filtro || filtro(c))
    .map((contrato) => {
      const pm = porMes(contrato);
      const meses = Array<number>(12).fill(0);
      for (const m of mesesDe(contrato)) if (m.startsWith(`${anio}-`)) meses[Number(m.slice(5)) - 1] += pm;
      return { contrato, meses, total: meses.reduce((a, b) => a + b, 0) };
    })
    .filter((f) => f.total > 0);
}

/* Suma de los meses [desde, hasta) (indices 0..11) de todas las filas. */
export function sumarMeses(filas: { meses: number[] }[], desde: number, hasta: number): number {
  return filas.reduce((s, f) => s + f.meses.slice(desde, hasta).reduce((x, z) => x + z, 0), 0);
}

/* Meses transcurridos del ano: los 12 de uno pasado, ninguno de uno futuro. */
export function mesActualDe(anio: number, hoy: string): number {
  const actual = Number(hoy.slice(0, 4));
  return anio === actual ? Number(hoy.slice(5, 7)) : anio < actual ? 12 : 0;
}
