import type { ReactNode } from "react";
import { Esqueleto } from "@/components/ui/panel";

/* Titulo de la seccion: el titular habla solo, sin antetitulo. */
export function Encabezado({ titulo, children, acciones }: { titulo: string; children?: ReactNode; acciones?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em] text-texto">{titulo}</h1>
        {children && <p className="mt-1 max-w-[70ch] text-texto-2">{children}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

/* Esqueleto de tabla densa: filas de 44px separadas por hilos. */
export function EsqueletoTabla({ filas = 8, columnas = 5 }: { filas?: number; columnas?: number }) {
  return (
    <div className="rounded-md border border-hilo bg-superficie shadow-1" aria-busy="true" aria-label="Cargando">
      <div className="flex h-12 items-center gap-3 border-b border-hilo px-4">
        <Esqueleto className="h-8 w-56" /><Esqueleto className="h-8 w-32" /><Esqueleto className="h-8 w-32" />
      </div>
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="flex h-11 items-center gap-6 border-b border-hilo px-4 last:border-0">
          {Array.from({ length: columnas }).map((__, j) => <Esqueleto key={j} className={j === 0 ? "w-40" : "w-20"} />)}
        </div>
      ))}
    </div>
  );
}
