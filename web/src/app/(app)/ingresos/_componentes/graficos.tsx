"use client";
import { cx } from "@/components/ui/cx";
import { usd, usdS } from "@/lib/finanzas/contratos";
import type { FilaTabla, SerieUnidad } from "@/lib/finanzas/agregados";

/*
 * Graficos de la vista Ingresos. Barras y columnas de HTML y una linea de SVG:
 * ligeros, con los tonos del sistema y sin depender solo del color (leyenda con
 * nombre y cifra, y la tabla mes a mes debajo dice lo mismo en numeros).
 */

export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const entero = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/* Una unidad = un tono; al pasar de seis se repiten atenuados. La leyenda y la tabla identifican de verdad. */
const FONDOS = ["bg-info", "bg-bien", "bg-aviso", "bg-violeta", "bg-alerta", "bg-neutro"];
const OPACIDADES = ["", "opacity-60", "opacity-35"];
export function estiloUnidad(i: number) {
  return cx(FONDOS[i % FONDOS.length], OPACIDADES[Math.min(Math.floor(i / FONDOS.length), OPACIDADES.length - 1)]);
}

/* Contratado (claro) y devengado (lleno) contra la meta (marca) y el ritmo esperado a hoy (punteada). */
export function BarraMeta({ meta, contratado, devengado, ritmo }: { meta: number | null; contratado: number; devengado: number; ritmo: number | null }) {
  const tope = Math.max(meta ?? 0, contratado, 1);
  const pct = (v: number) => `${Math.min(100, (v / tope) * 100)}%`;
  const texto = `Devengado ${usd(devengado)}, contratado ${usd(contratado)}${meta !== null ? `, meta ${usd(meta)}` : ", sin meta"}${ritmo !== null ? `, ritmo esperado ${usd(ritmo)}` : ""}.`;
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={texto} className="relative h-5 rounded-sm bg-hundida">
        <span className="absolute inset-y-0 left-0 rounded-sm bg-info/35 transition-[width] duration-[var(--dur-vista)] ease-salida motion-reduce:transition-none" style={{ width: pct(contratado) }} />
        <span className="absolute inset-y-0 left-0 rounded-sm bg-info transition-[width] duration-[var(--dur-vista)] ease-salida motion-reduce:transition-none" style={{ width: pct(devengado) }} />
        {meta !== null && <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-texto" style={{ left: `calc(${pct(meta)} - 1px)` }} />}
        {ritmo !== null && <span aria-hidden className="absolute -inset-y-1 border-l-2 border-dashed border-texto-2" style={{ left: `calc(${pct(ritmo)} - 1px)` }} />}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-2" aria-hidden>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-info" />Devengado</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-info/35" />Contratado</li>
        {meta !== null && <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-texto" />Meta</li>}
        {ritmo !== null && <li className="flex items-center gap-1.5"><span className="h-3 border-l-2 border-dashed border-texto-2" />Ritmo esperado</li>}
      </ul>
    </div>
  );
}

export function LeyendaUnidades({ series }: { series: { unidadId: number; nombre: string; total: number }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-2" aria-label="Unidades">
      {series.map((s, i) => (
        <li key={s.unidadId} className="flex items-center gap-1.5"><span aria-hidden className={cx("size-2.5 rounded-[2px]", estiloUnidad(i))} />{s.nombre}<span className="font-mono text-texto cifras">{usdS(s.total)}</span></li>
      ))}
    </ul>
  );
}

/* Ingreso por mes, apilado por unidad. Los meses por venir se atenuan; la linea punteada es la meta mensual. */
export function ColumnasMes({ series, mesActual, metaMensual }: { series: SerieUnidad[]; mesActual: number; metaMensual: number | null }) {
  const totales = MESES.map((_, i) => series.reduce((a, s) => a + s.meses[i], 0));
  const tope = Math.max(metaMensual ?? 0, ...totales, 1);
  return (
    <div className="px-4 pb-3 pt-4">
      <div className="relative h-40">
        {metaMensual !== null && (
          <span aria-hidden className="absolute inset-x-0 z-10 border-t-2 border-dashed border-texto-2" style={{ bottom: `${(metaMensual / tope) * 100}%` }}>
            <span className="absolute right-0 -top-5 rounded-sm bg-superficie px-1 font-mono text-[0.625rem] text-texto-2 cifras">meta {usdS(metaMensual)}/mes</span>
          </span>
        )}
        <ol aria-label="Ingreso por mes" className="absolute inset-0 flex items-end gap-1 sm:gap-2">
          {MESES.map((m, i) => {
            const total = totales[i];
            const detalle = `${m}: ${usd(total)}${i >= mesActual ? " (por venir)" : ""}`;
            return (
              <li key={m} title={detalle} aria-label={detalle} className={cx("flex h-full min-w-0 flex-1 flex-col justify-end", i >= mesActual && "opacity-55")}>
                <span aria-hidden className="mb-0.5 hidden text-center font-mono text-[0.625rem] text-texto-3 cifras sm:block">{total > 0 ? usdS(total) : ""}</span>
                <span aria-hidden className="flex w-full flex-col-reverse gap-[2px]" style={{ height: `${(total / tope) * 85}%` }}>
                  {series.map((s, j) => s.meses[i] > 0 && (
                    <span key={s.unidadId} className={cx("w-full min-h-[3px]", estiloUnidad(j))} style={{ flexGrow: s.meses[i], flexBasis: 0 }} />
                  ))}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <ol aria-hidden className="mt-1 flex gap-1 sm:gap-2">
        {MESES.map((m, i) => <li key={m} className={cx("min-w-0 flex-1 text-center font-mono text-[0.625rem] uppercase text-texto-3", i + 1 === mesActual && "font-bold text-texto")}>{m}</li>)}
      </ol>
    </div>
  );
}

/* Ingreso acumulado: solido hasta el mes actual, punteado despues, contra la recta de 0 a la meta. */
export function Acumulado({ acumulado, mesActual, meta }: { acumulado: number[]; mesActual: number; meta: number | null }) {
  const W = 600, H = 190, X0 = 8, X1 = 592, Y0 = 12, Y1 = 170;
  const tope = Math.max(meta ?? 0, acumulado[11] ?? 0, 1);
  const x = (i: number) => X0 + ((X1 - X0) * i) / 11;
  const y = (v: number) => Y1 - ((Y1 - Y0) * v) / tope;
  const punto = (i: number) => `${x(i).toFixed(1)},${y(acumulado[i]).toFixed(1)}`;
  const hasta = Math.min(mesActual, 12);
  const solido = hasta >= 1 ? acumulado.slice(0, hasta).map((_, i) => punto(i)).join(" ") : "";
  const porVenir = acumulado.slice(Math.max(hasta - 1, 0)).map((_, k) => punto(Math.max(hasta - 1, 0) + k)).join(" ");
  const resumen = `Acumulado del año: ${usd(acumulado[11] ?? 0)}${meta !== null ? ` de una meta de ${usd(meta)}` : ""}.`;
  return (
    <div className="px-4 pb-3 pt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={resumen}>
        {[0, 0.5, 1].map((t) => <line key={t} x1={X0} x2={X1} y1={y(tope * t)} y2={y(tope * t)} className="stroke-hilo" strokeWidth="1" />)}
        {meta !== null && <line x1={x(0)} y1={y(0)} x2={x(11)} y2={y(meta)} className="stroke-texto-3" strokeWidth="1.5" strokeDasharray="3 4" />}
        {porVenir && <polyline points={porVenir} fill="none" className="stroke-info" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />}
        {solido && <polyline points={solido} fill="none" className="stroke-info" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {hasta >= 1 && <circle cx={x(hasta - 1)} cy={y(acumulado[hasta - 1])} r="4" className="fill-info stroke-superficie" strokeWidth="2" />}
        {MESES.map((m, i) => <text key={m} x={x(i)} y={H - 4} textAnchor="middle" className="fill-texto-3 font-mono uppercase" fontSize="10">{m}</text>)}
        <text x={X0} y={y(tope) - 3} className="fill-texto-3 font-mono" fontSize="10">{usdS(tope)}</text>
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-2">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-info" />Ingreso acumulado{hasta >= 1 && <span className="font-mono text-texto cifras">{usdS(acumulado[hasta - 1])} a hoy</span>}</li>
        {meta !== null && <li className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t-2 border-dotted border-texto-3" />Camino a la meta</li>}
      </ul>
    </div>
  );
}

/* Tabla mes a mes: lo que el grafico no deja leer. La primera columna queda fija al desplazar. */
export function TablaMensual({ filas, etiqueta, meta, metaMensual, mesActual, onElegir, ariaLabel }: {
  filas: FilaTabla[]; etiqueta: string; meta: number | null; metaMensual: number | null; mesActual: number; onElegir?: (clave: string) => void; ariaLabel: string;
}) {
  const totales = MESES.map((_, i) => filas.reduce((a, f) => a + f.meses[i], 0));
  const total = filas.reduce((a, f) => a + f.total, 0);
  const celda = (v: number) => (v > 0 ? entero.format(Math.round(v)) : "—");
  return (
    <div className="overflow-x-auto">
      <table aria-label={ariaLabel} className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hilo">
            <th scope="col" className="rotulo sticky left-0 z-10 h-9 w-44 bg-superficie px-4 text-left">{etiqueta}</th>
            {MESES.map((m, i) => <th key={m} scope="col" className={cx("rotulo h-9 px-2 text-right", i >= mesActual && "opacity-55")}>{m}</th>)}
            <th scope="col" className="rotulo h-9 px-2 text-right">Total</th>
            {meta !== null && <th scope="col" className="rotulo h-9 px-4 text-right">% meta</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} className="border-b border-hilo hover:bg-superficie-2">
              <th scope="row" className="sticky left-0 z-10 max-w-44 truncate bg-superficie px-4 py-2 text-left font-medium">
                {onElegir && !f.contratoId ? <button type="button" onClick={() => onElegir(f.clave)} className="max-w-full truncate text-left underline-offset-4 hover:underline">{f.etiqueta}</button> : f.etiqueta}
              </th>
              {f.meses.map((v, i) => <td key={i} className={cx("px-2 py-2 text-right font-mono cifras", v === 0 && "text-texto-3", i >= mesActual && "opacity-55")}>{celda(v)}</td>)}
              <td className="px-2 py-2 text-right font-mono font-semibold cifras">{entero.format(Math.round(f.total))}</td>
              {meta !== null && <td className="px-4 py-2 text-right font-mono text-texto-2 cifras">{((f.total / meta) * 100).toFixed(1)}%</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-b border-hilo bg-superficie-2 font-semibold">
            <th scope="row" className="sticky left-0 z-10 bg-superficie-2 px-4 py-2 text-left">Total</th>
            {totales.map((v, i) => <td key={i} className={cx("px-2 py-2 text-right font-mono cifras", i >= mesActual && "opacity-55")}>{celda(v)}</td>)}
            <td className="px-2 py-2 text-right font-mono cifras">{entero.format(Math.round(total))}</td>
            {meta !== null && <td className="px-4 py-2 text-right font-mono cifras">{((total / meta) * 100).toFixed(1)}%</td>}
          </tr>
          {metaMensual !== null && (
            <tr className="text-texto-2">
              <th scope="row" className="sticky left-0 z-10 bg-superficie px-4 py-2 text-left font-normal">Meta mensual</th>
              {MESES.map((m) => <td key={m} className="px-2 py-2 text-right font-mono cifras">{entero.format(Math.round(metaMensual))}</td>)}
              <td className="px-2 py-2 text-right font-mono cifras">{entero.format(Math.round(meta ?? 0))}</td>
              <td />
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
