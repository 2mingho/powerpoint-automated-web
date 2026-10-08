"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { pedir } from "@/lib/admin/cliente";

/*
 * Lista que vive en la URL: los filtros se reflejan en la barra de
 * direcciones (se pueden compartir y sobreviven a recargar) y los datos se
 * piden a la API JSON. Mientras recarga, la tabla mantiene lo anterior a media
 * opacidad: sin saltos ni esqueletos a mitad de uso.
 */
export function useListaRemota<T>(api: string, inicial: T, filtrosIniciales: Record<string, string>) {
  const [datos, setDatos] = useState(inicial);
  const [filtros, setFiltros] = useState(filtrosIniciales);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turno = useRef(0);

  const cargar = useCallback(async (f: Record<string, string>) => {
    const n = ++turno.current;
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "" && v != null));
    setCargando(true);
    try {
      const d = await pedir<T>(`${api}${qs.size ? `?${qs}` : ""}`);
      if (n !== turno.current) return;
      setDatos(d);
      setError(null);
      const url = `${window.location.pathname}${qs.size ? `?${qs}` : ""}`;
      window.history.replaceState(null, "", url);
    } catch (e) {
      if (n === turno.current) setError(e instanceof Error ? e.message : "No se pudo cargar.");
    } finally {
      if (n === turno.current) setCargando(false);
    }
  }, [api]);

  const actuales = useRef(filtrosIniciales);
  const cambiar = useCallback((parcial: Record<string, string>, reiniciarPagina = true) => {
    const nuevo = { ...actuales.current, ...parcial, ...(reiniciarPagina && !("p" in parcial) ? { p: "" } : {}) };
    actuales.current = nuevo;
    setFiltros(nuevo);
    void cargar(nuevo);
  }, [cargar]);

  const recargar = useCallback(() => cargar(actuales.current), [cargar]);
  return { datos, filtros, cambiar, recargar, cargando, error };
}

/* Texto que filtra al dejar de escribir (300 ms). */
export function BuscadorDiferido({ valor, onCambio, etiqueta, placeholder, className }: {
  valor: string; onCambio: (v: string) => void; etiqueta: string; placeholder?: string; className?: string;
}) {
  const [t, setT] = useState(valor);
  const ultimo = useRef(valor);
  useEffect(() => {
    if (t === ultimo.current) return;
    const id = setTimeout(() => { ultimo.current = t; onCambio(t); }, 300);
    return () => clearTimeout(id);
  }, [t, onCambio]);
  return (
    <input
      type="search" value={t} onChange={(e) => setT(e.target.value)} aria-label={etiqueta} placeholder={placeholder}
      className={cx("h-10 w-full rounded-sm border border-hilo-fuerte bg-superficie px-3 text-base text-texto placeholder:text-texto-3 focus:border-texto focus:outline-none focus:ring-2 focus:ring-texto/15 md:w-64", className)}
    />
  );
}

export function Paginacion({ pagina, paginas, total, onPagina, nombre }: { pagina: number; paginas: number; total: number; onPagina: (p: number) => void; nombre: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hilo px-4 py-2 text-sm text-texto-2">
      <span><span className="font-mono cifras text-texto">{total}</span> {nombre}</span>
      <div className="flex items-center gap-1">
        <span className="mr-2">Página <span className="font-mono cifras">{pagina}</span> de <span className="font-mono cifras">{paginas}</span></span>
        <button type="button" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)} aria-label="Página anterior"
          className="grid size-10 place-items-center rounded-sm text-texto-2 hover:bg-superficie-2 disabled:opacity-35"><ChevronLeft className="size-4" aria-hidden /></button>
        <button type="button" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)} aria-label="Página siguiente"
          className="grid size-10 place-items-center rounded-sm text-texto-2 hover:bg-superficie-2 disabled:opacity-35"><ChevronRight className="size-4" aria-hidden /></button>
      </div>
    </div>
  );
}

/* Superficie de tabla: cabecera con filtros, cuerpo que se atenua al recargar. */
export function Tabla({ cabecera, children, cargando, pie, error, etiqueta, className }: {
  cabecera?: ReactNode; children: ReactNode; cargando?: boolean; pie?: ReactNode; error?: string | null; etiqueta: string; className?: string;
}) {
  return (
    <section aria-label={etiqueta} className={cx("w-full min-w-0 self-start rounded-md border border-hilo bg-superficie shadow-1", className)}>
      {cabecera && <div className="flex flex-wrap items-center gap-2 border-b border-hilo px-4 py-3">{cabecera}</div>}
      {error && <p role="alert" className="border-b border-hilo px-4 py-2 text-sm text-alerta">{error} Los datos de abajo pueden no estar al día.</p>}
      <div aria-busy={cargando || undefined} className={cx("transition-opacity duration-[var(--dur)]", cargando && "opacity-55")}>{children}</div>
      {pie}
    </section>
  );
}

/* Rotulo de columna de tabla densa. */
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cx("rotulo h-10 px-4 text-left font-semibold", className)}>{children}</th>;
}

export const claseFila = "border-b border-hilo last:border-0 transition-colors duration-[var(--dur-instante)] hover:bg-superficie-2";
export const claseCelda = "h-11 px-4 align-middle";
