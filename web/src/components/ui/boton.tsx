"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

type Variante = "primario" | "secundario" | "fantasma" | "peligro";
type Tamano = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-sm font-rotulo font-semibold uppercase tracking-[0.1em] " +
  "transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--dur)] ease-salida " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-45 select-none whitespace-nowrap";

const variantes: Record<Variante, string> = {
  // Negro en reposo; amarillo al pulsar o confirmar, como el CHECK IN del panel.
  primario: "bg-texto text-superficie hover:bg-pizarra dark:hover:bg-white/85 active:bg-marca active:text-marca-tinta data-[confirmado=true]:bg-marca data-[confirmado=true]:text-marca-tinta",
  secundario: "border border-texto bg-transparent text-texto hover:bg-superficie-2 active:bg-hundida",
  fantasma: "bg-transparent text-texto-2 hover:bg-superficie-2 hover:text-texto",
  peligro: "border border-alerta text-alerta hover:bg-alerta hover:text-white",
};

const tamanos: Record<Tamano, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export type BotonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  tamano?: Tamano;
  cargando?: boolean;
  icono?: ReactNode;
  confirmado?: boolean;
};

export const Boton = forwardRef<HTMLButtonElement, BotonProps>(function Boton(
  { variante = "secundario", tamano = "md", cargando, icono, confirmado, className, children, disabled, ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type={resto.type ?? "button"}
      data-confirmado={confirmado ? "true" : undefined}
      aria-busy={cargando || undefined}
      disabled={disabled || cargando}
      className={cx(base, variantes[variante], tamanos[tamano], className)}
      {...resto}
    >
      {cargando ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden /> : icono}
      {children}
    </button>
  );
});
