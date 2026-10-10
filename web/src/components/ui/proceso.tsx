"use client";
import { cx } from "./cx";

export type FaseProceso = { clave: string; rotulo: string };
export type EstadoProceso = { fase: string; progreso?: number; mensaje?: string; error?: string };

/*
 * Panel de salida para procesos largos (generar reporte, clasificar, unir,
 * subir). Cada fase es una fila del panel: EN COLA -> EN CURSO -> HECHO. La
 * fase activa lleva progreso real cuando el servidor lo da; si no, una barra
 * indeterminada. Nunca una pantalla quieta sin decir que pasa.
 */
export function ProcesoSalida({ fases, estado }: { fases: FaseProceso[]; estado: EstadoProceso }) {
  const indice = fases.findIndex((f) => f.clave === estado.fase);
  const terminado = estado.fase === "hecho";
  return (
    <ol className="divide-y divide-hilo rounded-md border border-hilo bg-superficie" aria-live="polite">
      {fases.map((f, i) => {
        const hecho = terminado || i < indice;
        const activo = !terminado && i === indice;
        const fallo = activo && !!estado.error;
        return (
          <li key={f.clave} className="flex items-center gap-4 px-4 py-3">
            <span className="w-6 font-mono text-xs text-texto-3 cifras">{String(i + 1).padStart(2, "0")}</span>
            <span className={cx("flex-1 font-rotulo text-sm font-semibold uppercase tracking-[0.1em]", hecho || activo ? "text-texto" : "text-texto-3")}>
              {f.rotulo}
              {activo && estado.mensaje && <span className="ml-2 font-sans text-sm normal-case tracking-normal text-texto-2">{estado.mensaje}</span>}
              {fallo && <span className="mt-1 block font-sans text-sm normal-case tracking-normal text-alerta">{estado.error}</span>}
              {activo && !fallo && (
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-hundida">
                  {typeof estado.progreso === "number"
                    ? <span className="block h-full bg-texto transition-[width] duration-[var(--dur-vista)] ease-salida" style={{ width: `${Math.max(2, Math.min(100, estado.progreso))}%` }} />
                    : <span className="block h-full w-1/3 bg-texto motion-safe:animate-[indeterminado_1.2s_var(--curva)_infinite]" />}
                </span>
              )}
            </span>
            <span className={cx(
              "inline-flex h-6 min-w-24 items-center justify-center rounded-sm border px-2 font-rotulo text-xs font-semibold uppercase tracking-[0.1em]",
              fallo ? "border-alerta text-alerta" : hecho ? "border-bien/40 text-bien" : activo ? "border-marca bg-marca text-marca-tinta" : "border-hilo text-texto-3",
            )}>
              {fallo ? "Falló" : hecho ? "Hecho" : activo ? (typeof estado.progreso === "number" ? `${Math.round(estado.progreso)}%` : "En curso") : "En cola"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
