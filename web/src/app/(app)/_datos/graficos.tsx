"use client";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cx } from "@/components/ui/cx";
import "./viz.css";

/*
 * Graficos del modulo Datos. Reglas (skill dataviz):
 * - Barras de 24px como maximo, extremo redondeado de 4px, una sola base.
 * - Lineas de 2px; la rejilla es un hilo recesivo.
 * - El texto nunca lleva el color de la serie: la identidad la da la marca.
 * - Todo valor que da el globo tambien esta escrito o en una tabla.
 * Los rankings y los repartos son HTML: etiquetas que nunca se recortan,
 * accesibles con lector de pantalla y que imprimen bien.
 */

export const SERIES = ["var(--serie-1)", "var(--serie-2)", "var(--serie-3)", "var(--serie-4)", "var(--serie-5)", "var(--serie-6)"];

const fmt = (n: number) => n.toLocaleString("es-DO");
const compacto = (n: number) =>
  Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1)} B` : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)} k` : fmt(n);

/* ── Ranking horizontal ───────────────────────────────────────────── */

export type ItemRanking = { etiqueta: string; valor: number; nota?: string; apagado?: boolean };

export function Ranking({ datos, color = "var(--serie-1)", sufijo, titulo }: { datos: ItemRanking[]; color?: string; sufijo?: string; titulo: string }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  if (!datos.length) return <p className="py-6 text-sm text-texto-3">Sin datos para este gráfico.</p>;
  return (
    <ul className="viz flex flex-col gap-1.5" aria-label={titulo}>
      {datos.map((d) => (
        <li key={d.etiqueta} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 md:grid-cols-[minmax(0,12rem)_1fr]" title={d.nota}>
          <span className={cx("truncate text-sm", d.apagado ? "text-texto-3" : "text-texto-2")}>{d.etiqueta}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-5 min-w-0.5 rounded-r-[4px] motion-safe:transition-[width] motion-safe:duration-[var(--dur-vista)]"
              style={{ width: `${(d.valor / max) * 82}%`, background: d.apagado ? "var(--serie-otras)" : color }}
              aria-hidden
            />
            <span className="shrink-0 font-mono text-xs text-texto cifras">{fmt(d.valor)}{sufijo}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Leyenda (siempre que hay dos series o mas) ───────────────────── */

export function Leyenda({ items, linea }: { items: { etiqueta: string; color: string; valor?: string; discontinua?: boolean }[]; linea?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-texto-2">
      {items.map((it) => (
        <li key={it.etiqueta} className="flex items-center gap-2">
          {linea
            ? <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: it.color, opacity: it.discontinua ? 0.9 : 1 }} />
            : <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: it.color }} />}
          {it.etiqueta}
          {it.valor && <span className="font-mono text-xs text-texto cifras">{it.valor}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ── Reparto (una barra apilada al 100 %) ─────────────────────────── */

export function Reparto({ partes, titulo }: { partes: { etiqueta: string; valor: number; color: string }[]; titulo: string }) {
  const total = partes.reduce((s, p) => s + p.valor, 0) || 1;
  const [activa, setActiva] = useState<string | null>(null);
  return (
    <div className="viz flex flex-col gap-3">
      <div role="img" aria-label={`${titulo}: ${partes.map((p) => `${p.etiqueta} ${Math.round((p.valor / total) * 1000) / 10}%`).join(", ")}`}
        className="flex h-6 gap-0.5 overflow-hidden rounded-[4px]">
        {partes.filter((p) => p.valor > 0).map((p) => (
          <span key={p.etiqueta} style={{ width: `${(p.valor / total) * 100}%`, background: p.color }}
            onPointerEnter={() => setActiva(p.etiqueta)} onPointerLeave={() => setActiva(null)}
            className={cx("h-full transition-opacity duration-[var(--dur)]", activa && activa !== p.etiqueta && "opacity-50")} />
        ))}
      </div>
      <Leyenda items={partes.map((p) => ({ etiqueta: p.etiqueta, color: p.color, valor: `${(Math.round((p.valor / total) * 1000) / 10).toLocaleString("es-DO")}%` }))} />
    </div>
  );
}

/* ── Apiladas al 100 % por fila (sentimiento por red) ─────────────── */

export function Apiladas100({ filas, claves }: {
  filas: { etiqueta: string; valores: Record<string, number> }[];
  claves: { clave: string; etiqueta: string; color: string }[];
}) {
  return (
    <div className="viz flex flex-col gap-3">
      <Leyenda items={claves.map((c) => ({ etiqueta: c.etiqueta, color: c.color }))} />
      <ul className="flex flex-col gap-2">
        {filas.map((f) => {
          const total = claves.reduce((s, c) => s + (f.valores[c.clave] ?? 0), 0) || 1;
          const texto = claves.map((c) => `${c.etiqueta} ${Math.round(((f.valores[c.clave] ?? 0) / total) * 100)}%`).join(", ");
          return (
            <li key={f.etiqueta} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 md:grid-cols-[minmax(0,11rem)_1fr_auto]">
              <span className="truncate text-sm text-texto-2">{f.etiqueta}</span>
              <span role="img" aria-label={`${f.etiqueta}: ${texto}`} title={texto} className="flex h-5 gap-0.5 overflow-hidden rounded-[4px]">
                {claves.map((c) => {
                  const v = f.valores[c.clave] ?? 0;
                  return v > 0 ? <span key={c.clave} className="h-full" style={{ width: `${(v / total) * 100}%`, background: c.color }} /> : null;
                })}
              </span>
              <span className="w-14 text-right font-mono text-xs text-texto cifras">{Math.round(((f.valores[claves[claves.length - 1].clave] ?? 0) / total) * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Globo de los graficos de recharts ────────────────────────────── */

type Carga = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };

function Globo({ active, payload, label, nombres }: { active?: boolean; payload?: Carga[]; label?: string | number; nombres?: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-hilo bg-superficie px-3 py-2 text-sm shadow-2">
      <p className="mb-1 font-mono text-xs text-texto-3 cifras">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
          <strong className="font-mono font-medium cifras">{typeof p.value === "number" ? fmt(p.value) : p.value}</strong>
          <span className="text-texto-2">{nombres?.[String(p.dataKey)] ?? p.name}</span>
        </p>
      ))}
    </div>
  );
}

/* ── Tendencia (este periodo frente al anterior) ──────────────────── */

export function Tendencia({ etiquetas, actual, previo, titulo }: { etiquetas: string[]; actual: number[]; previo?: number[]; titulo: string }) {
  const datos = etiquetas.map((e, i) => ({ e, actual: actual[i] ?? 0, previo: previo?.[i] }));
  const hayPrevio = !!previo?.length;
  const nombres = { actual: "Este periodo", previo: "Periodo anterior" };
  const tablaId = useId();
  return (
    <figure className="viz flex flex-col gap-3">
      {hayPrevio && <Leyenda linea items={[{ etiqueta: "Este periodo", color: "var(--serie-1)" }, { etiqueta: "Periodo anterior", color: "var(--serie-previa)", discontinua: true }]} />}
      <div className="h-60 w-full" role="img" aria-label={`${titulo}. Valores en la tabla siguiente.`} aria-describedby={tablaId}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="e" tickLine={false} axisLine={{ stroke: "var(--eje)" }} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={compacto} />
            <Tooltip content={(p) => <Globo {...(p as object)} nombres={nombres} />} cursor={{ stroke: "var(--eje)", strokeWidth: 1 }} />
            {hayPrevio && <Line type="monotone" dataKey="previo" stroke="var(--serie-previa)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
            <Line type="monotone" dataKey="actual" stroke="var(--serie-1)" strokeWidth={2} dot={false}
              activeDot={{ r: 4, stroke: "var(--superficie)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm print:hidden">
        <summary className="cursor-pointer text-texto-3 hover:text-texto">Ver los datos en tabla</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-sm border border-hilo">
          <table id={tablaId} className="w-full text-sm">
            <thead className="sticky top-0 bg-superficie-2"><tr><th className="h-8 px-3 text-left rotulo">Fecha</th><th className="px-3 text-right rotulo">Este periodo</th>{hayPrevio && <th className="px-3 text-right rotulo">Anterior</th>}</tr></thead>
            <tbody>{datos.map((d) => <tr key={d.e} className="border-t border-hilo"><td className="h-8 px-3">{d.e}</td><td className="px-3 text-right font-mono">{fmt(d.actual)}</td>{hayPrevio && <td className="px-3 text-right font-mono text-texto-2">{d.previo != null ? fmt(d.previo) : "—"}</td>}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/* ── Histograma de una columna numerica ───────────────────────────── */

export function Histograma({ bins, counts, columna }: { bins: (number | null)[]; counts: number[]; columna: string }) {
  const datos = bins.map((b, i) => ({ b: b == null ? "—" : compacto(Math.round(b * 100) / 100), n: counts[i] ?? 0 }));
  return (
    <div className="viz h-44 w-full" role="img" aria-label={`Distribución de ${columna}: ${counts.length} intervalos`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 4, right: 20, bottom: 0, left: 0 }} barCategoryGap={1}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="b" tickLine={false} axisLine={{ stroke: "var(--eje)" }} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={compacto} allowDecimals={false} />
          <Tooltip content={(p) => <Globo {...(p as object)} nombres={{ n: "filas" }} />} cursor={{ fill: "var(--superficie-2)" }} />
          <Bar dataKey="n" fill="var(--serie-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Matriz de correlacion (divergente: azul positiva, rojo negativa) ─ */

export function MapaCorrelacion({ columnas, matriz }: { columnas: string[]; matriz: { column: string; correlations: Record<string, number | null> }[] }) {
  return (
    <div className="viz overflow-x-auto" role="region" aria-label="Matriz de correlación" tabIndex={0}>
      <table className="border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th />
            {columnas.map((c) => <th key={c} scope="col" className="max-w-24 truncate px-1 pb-1 text-left font-normal text-texto-3" title={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {matriz.map((fila) => (
            <tr key={fila.column}>
              <th scope="row" className="max-w-32 truncate pr-2 text-left font-normal text-texto-2" title={fila.column}>{fila.column}</th>
              {columnas.map((c) => {
                const v = fila.correlations[c];
                const peso = v == null ? 0 : Math.min(1, Math.abs(v));
                const polo = v != null && v < 0 ? "var(--div-neg)" : "var(--div-pos)";
                return (
                  <td key={c} title={`${fila.column} · ${c}: ${v == null ? "sin dato" : v.toFixed(2)}`}
                    className={cx("h-9 w-14 rounded-[3px] text-center font-mono cifras", peso > 0.55 ? "text-white" : "text-texto")}
                    style={{ background: `color-mix(in oklab, ${polo} ${Math.round(peso * 100)}%, var(--div-medio))` }}>
                    {v == null ? "—" : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
