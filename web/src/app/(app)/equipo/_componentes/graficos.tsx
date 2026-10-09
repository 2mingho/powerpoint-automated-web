"use client";
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { cx } from "@/components/ui/cx";
import type { Tono } from "@/components/ui/estado";
import type { Estado } from "@/lib/catalogo";
import type { FilaCarga, FilaUnidad, PuntoTendencia } from "@/lib/equipo/agregados";
import { fDia } from "@/lib/admin/formato";

/*
 * Graficos del panel de equipo. Reglas (skill dataviz + mundo del producto):
 *  - Color por estado = tono del catalogo; el texto nunca lleva el color.
 *  - Los tonos de estado no son una paleta categorica: dos estados pueden
 *    compartir tono. Por eso cada segmento tiene ademas hueco de 2px, opacidad
 *    escalonada si repite tono, leyenda con nombre, tooltip y tabla.
 *  - Entrada una sola vez y sutil; con reduced-motion no hay animacion.
 */

const FONDO: Record<Tono, string> = {
  neutro: "bg-neutro", info: "bg-info", aviso: "bg-aviso", alerta: "bg-alerta", bien: "bg-bien", violeta: "bg-violeta",
};
const OPACIDAD = ["opacity-100", "opacity-60", "opacity-35"];

/* Una sola entrada por montaje: tras el primer pintado, los cambios ya no animan la aparicion. */
function useEntrada() {
  const reducido = useReducedMotion();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return { visible: visible || !!reducido, animar: !reducido };
}

export function estiloEstados(estados: Estado[]) {
  const vistos = new Map<string, number>();
  const m = new Map<string, { tono: Tono; clase: string }>();
  for (const e of estados) {
    const n = vistos.get(e.color) ?? 0;
    vistos.set(e.color, n + 1);
    m.set(e.nombre, { tono: e.color, clase: cx(FONDO[e.color] ?? "bg-neutro", OPACIDAD[Math.min(n, OPACIDAD.length - 1)]) });
  }
  return m;
}

export function Leyenda({ estados, presentes }: { estados: Estado[]; presentes: Set<string> }) {
  const estilo = estiloEstados(estados);
  const lista = estados.filter((e) => presentes.has(e.nombre));
  if (lista.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-2" aria-label="Leyenda de estados">
      {lista.map((e) => (
        <li key={e.nombre} className="flex items-center gap-1.5"><span aria-hidden className={cx("size-2.5 rounded-[2px]", estilo.get(e.nombre)?.clase)} />{e.nombre}</li>
      ))}
    </ul>
  );
}

export function CargaPorPersona({ filas, estados, onPersona, activa }: {
  filas: FilaCarga[]; estados: Estado[]; onPersona: (id: number) => void; activa: number | null;
}) {
  const { visible, animar } = useEntrada();
  const estilo = useMemo(() => estiloEstados(estados), [estados]);
  const max = Math.max(1, ...filas.map((f) => f.total));
  const [punta, setPunta] = useState<{ x: number; y: number; texto: string } | null>(null);

  if (!filas.length) return <p className="px-4 py-8 text-texto-2">Nadie tiene tareas abiertas en este alcance. Cuando se asigne trabajo, aquí se verá quién va más cargado.</p>;

  return (
    <div className="relative">
      <ol className="divide-y divide-hilo" aria-label="Tareas abiertas por persona">
        {filas.map((f, i) => (
          <li key={f.personaId}>
            <button type="button" onClick={() => onPersona(f.personaId)} aria-pressed={activa === f.personaId}
              aria-label={`${f.nombre}: ${f.total} abiertas${f.vencidas ? `, ${f.vencidas} vencidas` : ""}. ${f.segmentos.map((s) => `${s.n} ${s.estado}`).join(", ")}. Filtrar la tabla.`}
              className={cx("grid min-h-11 w-full grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3.5rem] items-center gap-3 px-4 text-left transition-colors duration-[var(--dur)] hover:bg-superficie-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_5.5rem]",
                activa === f.personaId && "bg-superficie-2")}>
              <span className="truncate text-sm">{f.nombre}</span>
              <span className="flex h-3.5 items-stretch" aria-hidden>
                <span
                  className={cx("flex h-full gap-[2px] origin-left", animar && "transition-transform duration-[var(--dur-vista)] ease-salida")}
                  style={{ width: `${(f.total / max) * 100}%`, transform: visible ? "scaleX(1)" : "scaleX(0)", transitionDelay: animar ? `${Math.min(i, 8) * 25}ms` : undefined }}
                >
                  {f.segmentos.map((s, j) => (
                    <span key={s.estado}
                      onPointerMove={(e) => setPunta({ x: e.clientX, y: e.clientY, texto: `${f.nombre} · ${s.estado}: ${s.n}` })}
                      onPointerLeave={() => setPunta(null)}
                      className={cx("h-full min-w-[3px] transition-[filter] hover:brightness-110", estilo.get(s.estado)?.clase ?? "bg-neutro",
                        j === f.segmentos.length - 1 && "rounded-r-[4px]")}
                      style={{ flexGrow: s.n, flexBasis: 0 }} />
                  ))}
                </span>
              </span>
              <span className="text-right font-mono text-sm cifras">
                {f.total}
                {f.vencidas > 0 && <span className="block text-[0.6875rem] leading-none text-alerta sm:ml-1.5 sm:inline">{f.vencidas} venc.</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {punta && (
        <div role="tooltip" className="pointer-events-none fixed z-50 rounded-sm bg-pizarra px-2.5 py-1.5 text-xs text-white shadow-2" style={{ left: punta.x + 12, top: punta.y - 34 }}>{punta.texto}</div>
      )}
    </div>
  );
}

export function VencidasPorUnidad({ filas, onUnidad }: { filas: FilaUnidad[]; onUnidad?: (id: number) => void }) {
  const { visible, animar } = useEntrada();
  const max = Math.max(1, ...filas.map((f) => f.vencidas));
  if (!filas.length) return <p className="px-4 py-8 text-texto-2">No hay unidades en este alcance.</p>;
  const total = filas.reduce((s, f) => s + f.vencidas, 0);
  return (
    <ol className="divide-y divide-hilo" aria-label="Tareas vencidas por unidad">
      {filas.map((f, i) => (
        <li key={f.unidadId}>
          <button type="button" disabled={!onUnidad} onClick={() => onUnidad?.(f.unidadId)}
            className="grid min-h-11 w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 px-4 text-left hover:bg-superficie-2 disabled:hover:bg-transparent">
            <span className="truncate text-sm">{f.nombre}</span>
            <span className="flex items-center gap-2">
              <span className="h-3.5 flex-1" aria-hidden>
                {f.vencidas > 0 && (
                  <span className={cx("block h-full origin-left rounded-r-[4px] bg-alerta", animar && "transition-transform duration-[var(--dur-vista)] ease-salida")}
                    style={{ width: `${(f.vencidas / max) * 100}%`, transform: visible ? "scaleX(1)" : "scaleX(0)", transitionDelay: animar ? `${i * 30}ms` : undefined }} />
                )}
              </span>
              <span className="w-24 text-right text-xs text-texto-3">
                <span className={cx("font-mono text-sm cifras", f.vencidas ? "text-texto" : "text-texto-3")}>{f.vencidas}</span> de <span className="font-mono cifras">{f.abiertas}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
      {total === 0 && <li className="px-4 py-2 text-sm text-bien">Ninguna unidad tiene tareas vencidas.</li>}
    </ol>
  );
}

function PuntaTendencia({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-hilo bg-superficie px-3 py-2 text-xs shadow-2">
      <p className="mb-1 text-texto-3">Semana del {fDia(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: p.color }} />
          <span className="font-mono text-sm font-semibold text-texto cifras">{p.value}</span>
          <span className="text-texto-2">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

export function Tendencia({ puntos }: { puntos: PuntoTendencia[] }) {
  const reducido = useReducedMotion();
  const [animar, setAnimar] = useState(!reducido);
  const max = Math.max(4, ...puntos.flatMap((p) => [p.creadas, p.completadas]));
  const ultimo = puntos[puntos.length - 1];
  const vacio = puntos.every((p) => p.creadas === 0 && p.completadas === 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-xs text-texto-2" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-info" />Creadas{ultimo ? <span className="font-mono text-texto cifras">{ultimo.creadas}</span> : null}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-bien" />Completadas{ultimo ? <span className="font-mono text-texto cifras">{ultimo.completadas}</span> : null}</span>
        <span className="text-texto-3">esta semana</span>
      </div>
      <div className="relative h-56 px-1 pt-2" role="img" aria-label={`Tareas creadas y completadas por semana, ${puntos.length} semanas. ${puntos.map((p) => `Semana del ${fDia(p.semana)}: ${p.creadas} creadas, ${p.completadas} completadas`).join(". ")}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={puntos} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--hilo)" strokeWidth={1} />
            <XAxis dataKey="semana" tickFormatter={(v: string) => fDia(v)} tick={{ fill: "var(--texto-3)", fontSize: 11, fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={{ stroke: "var(--hilo-fuerte)" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis allowDecimals={false} domain={[0, max]} tick={{ fill: "var(--texto-3)", fontSize: 11, fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} width={36} />
            <Tooltip content={PuntaTendencia} cursor={{ stroke: "var(--hilo-fuerte)", strokeWidth: 1 }} />
            <Line type="monotone" dataKey="creadas" name="Creadas" stroke="var(--tono-info)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              dot={puntos.length === 1 ? { r: 4, strokeWidth: 2, stroke: "var(--superficie)", fill: "var(--tono-info)" } : false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--superficie)" }}
              isAnimationActive={animar} animationDuration={500} animationEasing="ease-out" onAnimationEnd={() => setAnimar(false)} />
            <Line type="monotone" dataKey="completadas" name="Completadas" stroke="var(--tono-bien)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              dot={puntos.length === 1 ? { r: 4, strokeWidth: 2, stroke: "var(--superficie)", fill: "var(--tono-bien)" } : false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--superficie)" }}
              isAnimationActive={animar} animationDuration={500} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
        {vacio && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-texto-3">Sin movimiento en estas semanas.</p>}
      </div>
      <details className="border-t border-hilo px-4 py-2 text-sm">
        <summary className="cursor-pointer text-texto-2">Ver como tabla</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th className="rotulo py-1">Semana</th><th className="rotulo py-1 text-right">Creadas</th><th className="rotulo py-1 text-right">Completadas</th></tr></thead>
          <tbody>{puntos.map((p) => <tr key={p.semana} className="border-t border-hilo"><td className="py-1 font-mono text-xs">{fDia(p.semana)}</td><td className="py-1 text-right font-mono cifras">{p.creadas}</td><td className="py-1 text-right font-mono cifras">{p.completadas}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
