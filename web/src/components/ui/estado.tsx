"use client";
import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";

export type Tono = "neutro" | "info" | "aviso" | "alerta" | "bien" | "violeta";

const tonos: Record<Tono, string> = {
  neutro: "text-neutro border-neutro/35",
  info: "text-info border-info/35",
  aviso: "text-aviso border-aviso/40",
  alerta: "text-alerta border-alerta/40",
  bien: "text-bien border-bien/40",
  violeta: "text-violeta border-violeta/40",
};

/*
 * Celda de estado del panel de salidas. Es el movimiento firma:
 *
 * - `cambio` (cualquier valor que cambie cuando el estado cambia, p. ej.
 *   updated_at) enciende la celda en amarillo Newlink.
 * - Se queda encendida hasta que se ve: 8 s con la celda en pantalla, o al
 *   pasar el raton / enfocarla. No se apaga sola si nadie la mira.
 * - Con reduced-motion no hay animacion, solo el cambio de color.
 *
 * El amarillo marca atencion ("esto cambio"), nunca el estado en si: el
 * estado lo dicen el texto y su tono.
 */
export function CeldaEstado({
  texto, tono = "neutro", cambio, encendidaInicial = false, className,
}: {
  texto: string;
  tono?: Tono;
  cambio?: string | number;
  encendidaInicial?: boolean;
  className?: string;
}) {
  const [encendida, setEncendida] = useState(encendidaInicial);
  const anterior = useRef(cambio);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (anterior.current !== undefined && cambio !== anterior.current) setEncendida(true);
    anterior.current = cambio;
  }, [cambio]);

  useEffect(() => {
    if (!encendida || !ref.current) return;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const obs = new IntersectionObserver(([e]) => {
      clearTimeout(temporizador);
      if (e.isIntersecting) temporizador = setTimeout(() => setEncendida(false), 8000);
    }, { threshold: 0.6 });
    obs.observe(ref.current);
    return () => { obs.disconnect(); clearTimeout(temporizador); };
  }, [encendida]);

  return (
    <span
      ref={ref}
      onPointerEnter={() => encendida && setTimeout(() => setEncendida(false), 1200)}
      onFocus={() => encendida && setEncendida(false)}
      data-encendida={encendida || undefined}
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 font-rotulo text-xs font-semibold uppercase tracking-[0.1em]",
        "transition-[background-color,color,border-color] duration-[var(--dur-vista)] ease-salida",
        encendida ? "border-marca bg-marca text-marca-tinta" : tonos[tono],
        className,
      )}
    >
      {encendida && <span className="size-1.5 rounded-full bg-marca-tinta motion-safe:animate-pulse" aria-hidden />}
      {texto}
      {encendida && <span className="sr-only"> (cambió hace poco)</span>}
    </span>
  );
}

/* Punto de tono para leyendas y filtros. */
export function PuntoTono({ tono, className }: { tono: Tono; className?: string }) {
  return <span aria-hidden className={cx("inline-block size-2 rounded-full bg-current", tonos[tono].split(" ")[0], className)} />;
}
