"use client";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cx } from "./cx";
import { Selector } from "./campo";
import type { Direccion, Orden } from "@/lib/orden";

/*
 * Orden de tablas. En escritorio, el encabezado de cada columna es un boton: lo
 * pulsas para ordenar, otra vez para invertir y una tercera para volver al orden
 * de la pantalla. En movil no hay encabezados; ahi se ordena con un selector.
 * El estado del orden vive en quien lo usa; la columna activa lo dice con aria-sort.
 */

export function ColumnaOrdenable<C extends string>({ etiqueta, col, orden, onOrden, className, alinear }: {
  etiqueta: string;
  col: C;
  orden: Orden<C> | null;
  onOrden: (col: C) => void;
  className?: string;
  alinear?: "derecha";
}) {
  const activa = orden?.col === col;
  return (
    <span role="columnheader" aria-sort={activa ? (orden!.dir === "asc" ? "ascending" : "descending") : "none"} className={cx("flex", alinear === "derecha" && "justify-end", className)}>
      <button type="button" onClick={() => onOrden(col)} aria-label={`Ordenar por ${etiqueta.toLowerCase()}`}
        className={cx("rotulo inline-flex min-h-8 items-center gap-1 rounded-sm px-1 -mx-1 hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto", activa && "text-texto")}>
        {etiqueta}
        {activa ? (orden!.dir === "asc" ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />) : <ChevronsUpDown aria-hidden className="size-3 opacity-40" />}
      </button>
    </span>
  );
}

/* Para pantallas sin encabezados: una lista de columnas y un boton de direccion. `vacio` es el orden predeterminado. */
export function SelectorOrden<C extends string>({ opciones, orden, onCambiar, vacio, className }: {
  opciones: { col: C; etiqueta: string }[];
  orden: Orden<C> | null;
  onCambiar: (o: Orden<C> | null) => void;
  vacio: string;
  className?: string;
}) {
  const invertir = () => orden && onCambiar({ col: orden.col, dir: (orden.dir === "asc" ? "desc" : "asc") as Direccion });
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="rotulo shrink-0">Ordenar</span>
        <Selector value={orden?.col ?? ""} onChange={(e) => onCambiar(e.target.value ? { col: e.target.value as C, dir: orden?.dir ?? "asc" } : null)} className="h-9">
          <option value="">{vacio}</option>
          {opciones.map((o) => <option key={o.col} value={o.col}>{o.etiqueta}</option>)}
        </Selector>
      </label>
      <button type="button" disabled={!orden} onClick={invertir} aria-label={orden?.dir === "desc" ? "Orden descendente: pasar a ascendente" : "Orden ascendente: pasar a descendente"}
        className="grid size-9 shrink-0 place-items-center rounded-sm border border-hilo-fuerte hover:bg-superficie-2 disabled:opacity-40">
        {orden?.dir === "desc" ? <ArrowDown aria-hidden className="size-4" /> : <ArrowUp aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
