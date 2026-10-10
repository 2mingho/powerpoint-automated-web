import type { ReactNode } from "react";
import { cx } from "./cx";

/* Panel de trabajo: superficie con cabecera de rotulo y acciones. Nunca va dentro de otro panel. */
export function Panel({
  titulo, acciones, children, className, cuerpoClassName, id,
}: {
  titulo?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
  cuerpoClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} aria-label={typeof titulo === "string" ? titulo : undefined}
      className={cx("flex min-w-0 flex-col rounded-md border border-hilo bg-superficie shadow-1", className)}>
      {(titulo || acciones) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-hilo px-4">
          {typeof titulo === "string" ? <h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em] text-texto">{titulo}</h2> : titulo}
          {acciones && <div className="flex items-center gap-2">{acciones}</div>}
        </header>
      )}
      <div className={cx("min-h-0 flex-1", cuerpoClassName)}>{children}</div>
    </section>
  );
}

/* Estado vacio que ensena la interfaz, no "nada aqui". */
export function Vacio({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-10">
      <p className="font-rotulo text-lg font-semibold uppercase tracking-[0.08em] text-texto">{titulo}</p>
      {children && <div className="max-w-[60ch] text-texto-2">{children}</div>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  );
}

export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden className={cx("esqueleto h-4", className)} />;
}
