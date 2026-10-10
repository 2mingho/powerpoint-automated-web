"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

/*
 * Panel lateral de edicion: entra desde la derecha (abajo en movil, a pantalla
 * completa) sin tapar la tabla de la que viene en escritorio. Es un <dialog>
 * no modal: Escape lo cierra y el foco entra en el primer campo. Para lo
 * destructivo se usa Dialogo; esto es para editar.
 */
export function PanelLateral({
  abierto, onCerrar, titulo, subtitulo, children, pie,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  subtitulo?: ReactNode;
  children: ReactNode;
  pie?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    if (!abierto) return;
    previo.current = document.activeElement;
    const t = setTimeout(() => {
      ref.current?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea,button[data-autofoco]")?.focus();
    }, 30);
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", tecla);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", tecla);
      (previo.current as HTMLElement | null)?.focus?.();
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;
  return (
    <>
      <button type="button" aria-label="Cerrar panel" onClick={onCerrar} className="fixed inset-0 z-40 bg-tinta/30 md:bg-tinta/10" />
      <aside
        ref={ref}
        role="dialog"
        aria-label={titulo}
        className={cx(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-md border border-hilo bg-superficie shadow-3",
          "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[440px] md:rounded-none md:border-y-0 md:border-r-0",
          "motion-safe:animate-[entrada-lateral_var(--dur-vista)_var(--curva)]",
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-hilo px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-rotulo text-lg font-semibold uppercase tracking-[0.1em] text-texto">{titulo}</h2>
            {subtitulo && <div className="mt-0.5 text-sm text-texto-2">{subtitulo}</div>}
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="-mr-2 grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto">
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap justify-end gap-2 border-t border-hilo px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{pie}</footer>}
      </aside>
      <style>{`@keyframes entrada-lateral{from{transform:translateY(16px);opacity:0}}@media (min-width:768px){@keyframes entrada-lateral{from{transform:translateX(24px);opacity:0}}}`}</style>
    </>
  );
}
