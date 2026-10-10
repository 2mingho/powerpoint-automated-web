import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const control =
  "w-full rounded-sm border border-hilo-fuerte bg-superficie px-3 text-base text-texto placeholder:text-texto-3 " +
  "transition-[border-color,box-shadow] duration-[var(--dur)] hover:border-texto-3 " +
  "focus:border-texto focus:outline-none focus:ring-2 focus:ring-texto/15 " +
  "aria-[invalid=true]:border-alerta disabled:opacity-50";

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Entrada(
  { className, ...p }, ref,
) {
  return <input ref={ref} className={cx(control, "h-10", className)} {...p} />;
});

export const Selector = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Selector(
  { className, ...p }, ref,
) {
  return <select ref={ref} className={cx(control, "h-10 pr-8", className)} {...p} />;
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AreaTexto(
  { className, ...p }, ref,
) {
  return <textarea ref={ref} className={cx(control, "min-h-24 py-2", className)} {...p} />;
});

/* Etiqueta + control + ayuda o error, con los ids enlazados. El control recibe id y aria por render-prop. */
export function Campo({
  etiqueta, ayuda, error, children, className,
}: {
  etiqueta: string;
  ayuda?: string;
  error?: string;
  className?: string;
  children: (a: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const desc = error ? `${id}-e` : ayuda ? `${id}-a` : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="rotulo">{etiqueta}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": desc })}
      {error ? <p id={desc} className="text-sm text-alerta">{error}</p> : ayuda ? <p id={desc} className="text-sm text-texto-3">{ayuda}</p> : null}
    </div>
  );
}
