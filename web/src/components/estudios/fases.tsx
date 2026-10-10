"use client";
import Link from "next/link";
import { Check, CircleDot, TriangleAlert } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { CeldaEstado, type Tono } from "@/components/ui/estado";
import { FASES } from "@/lib/estudios/plan";
import type { EstudioDTO } from "@/lib/estudios/servicio";
import { fDia } from "@/lib/admin/formato";

/*
 * Piezas de un estudio que se repiten en la vista de estudios y en el pase de una
 * tarea: la barra de fases y los pasos agrupados por fase. El estado de cada fase se
 * dice con icono y texto, no solo con color.
 */

const ESTILO = {
  completa: { clase: "border-bien/50 bg-bien/10 text-bien", icono: Check, texto: "completa" },
  en_curso: { clase: "border-info/50 bg-info/10 text-info", icono: CircleDot, texto: "en curso" },
  vencida: { clase: "border-alerta/50 bg-alerta/10 text-alerta", icono: TriangleAlert, texto: "vencida" },
  pendiente: { clase: "border-hilo-fuerte text-texto-3", icono: null, texto: "pendiente" },
} as const;

export function BarraFases({ fases }: { fases: EstudioDTO["fases"] }) {
  if (!fases.length) return null;
  return (
    <ol aria-label="Fases del estudio" className="flex flex-wrap gap-1.5">
      {fases.map((f) => {
        const e = ESTILO[f.estado];
        const Icono = e.icono;
        return (
          <li key={f.fase} aria-current={f.actual ? "step" : undefined}
            className={cx("inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-medium", e.clase, f.actual && "ring-2 ring-texto/30 ring-offset-1 ring-offset-superficie")}>
            {Icono && <Icono aria-hidden className="size-3.5" />}
            <span>{f.fase}</span>
            <span className="font-mono text-[0.6875rem] opacity-80 cifras">{f.hechos}/{f.pasos}</span>
            <span className="sr-only"> — {e.texto}{f.actual ? ", fase actual" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* Los pasos, agrupados por fase en el orden del estudio. `actualId` resalta la tarea que se esta mirando. */
export function PasosPorFase({ pasos, tonoDe, actualId, alAbrir }: { pasos: EstudioDTO["pasos"]; tonoDe: (estado: string) => Tono; actualId?: number; alAbrir?: () => void }) {
  const grupos = [...FASES, ""].map((fase) => ({ fase, pasos: pasos.filter((p) => p.fase === fase) })).filter((g) => g.pasos.length);
  return (
    <div className="flex flex-col gap-3">
      {grupos.map((g) => (
        <section key={g.fase || "sin"} aria-label={g.fase || "Sin fase"}>
          <h4 className="rotulo mb-1">{g.fase || "Sin fase"}</h4>
          <ul>
            {g.pasos.map((p) => (
              <li key={p.id} className="border-t border-hilo first:border-t-0">
                <Link href={`/tareas?tarea=${p.id}`} onClick={alAbrir} aria-current={p.id === actualId ? "true" : undefined}
                  className={cx("grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-2 py-1.5 hover:bg-superficie-2 md:grid-cols-[minmax(0,1fr)_88px_110px_120px]", p.id === actualId && "bg-superficie-2")}>
                  <span className="min-w-0">
                    <span className={cx("block truncate", p.hecho && "text-texto-3 line-through", p.id === actualId && "font-semibold")}>{p.titulo}</span>
                    <span className="block truncate text-xs text-texto-3 md:hidden">{p.asignado} · {fDia(p.entrega)}</span>
                  </span>
                  <span className="hidden font-mono text-sm text-texto-2 cifras md:block">{fDia(p.entrega)}</span>
                  <span className="hidden truncate text-sm text-texto-2 md:block">{p.asignado}</span>
                  <span className="justify-self-end md:justify-self-start"><CeldaEstado texto={p.estado} tono={tonoDe(p.estado)} className="max-w-full truncate" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
