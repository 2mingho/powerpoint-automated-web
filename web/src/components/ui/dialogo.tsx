"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

/*
 * <dialog> nativo: foco atrapado, Escape y capa superior sin librerias.
 * Usarlo solo cuando la tarea necesita interrumpir; casi todo cabe en el
 * panel lateral o en linea.
 */
export function Dialogo({
  abierto, onCerrar, titulo, children, pie, ancho = "md",
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      onClose={onCerrar}
      onClick={(e) => { if (e.target === ref.current) onCerrar(); }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-md border border-hilo bg-superficie p-0 text-texto shadow-3",
        "backdrop:bg-tinta/45 backdrop:backdrop-blur-[2px]",
        "open:motion-safe:animate-[entrada-aviso_var(--dur-vista)_var(--curva)]",
        ancho === "sm" ? "max-w-md" : ancho === "lg" ? "max-w-3xl" : "max-w-xl",
      )}
    >
      <header className="flex items-center justify-between border-b border-hilo px-5 py-3">
        <h2 id={idTitulo} className="font-rotulo text-lg font-semibold uppercase tracking-[0.1em]">{titulo}</h2>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-xl text-texto-3 hover:text-texto">×</button>
      </header>
      <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
      {pie && <footer className="flex justify-end gap-2 border-t border-hilo px-5 py-3">{pie}</footer>}
    </dialog>
  );
}
