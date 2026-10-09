"use client";
import { useCallback, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { BYTES_VISTA_PREVIA, CODIFICACIONES, extension, nombreSeparador, SEPARADORES } from "@/lib/datos/limites";
import type { Descarga, Deteccion } from "@/lib/datos/tipos";
import { pedirJson } from "./proceso";

export type Formato = { codificacion: string; separador: string };

/*
 * Deteccion de formato de un archivo tabular. De un CSV solo viaja el
 * principio (2 MB): para ensenar cinco filas no hace falta subir 150 MB.
 */
export function useDeteccion(url: string) {
  const [estado, setEstado] = useState<{ cargando: boolean; datos: Deteccion | null; error: string | null }>({ cargando: false, datos: null, error: null });

  const detectar = useCallback(async (archivo: File, formato?: Formato) => {
    setEstado((e) => ({ ...e, cargando: true, error: null }));
    const fd = new FormData();
    const esCsv = !["xlsx", "xls"].includes(extension(archivo.name));
    fd.append("archivo", esCsv && archivo.size > BYTES_VISTA_PREVIA ? new File([archivo.slice(0, BYTES_VISTA_PREVIA)], archivo.name) : archivo);
    if (formato?.codificacion) fd.append("codificacion", formato.codificacion);
    if (formato?.separador) fd.append("separador", formato.separador);
    try {
      const datos = await pedirJson<Deteccion>(url, { method: "POST", body: fd });
      setEstado({ cargando: false, datos, error: null });
      return datos;
    } catch (e) {
      setEstado({ cargando: false, datos: null, error: e instanceof Error ? e.message : "No se pudo leer el archivo." });
      return null;
    }
  }, [url]);

  const limpiar = useCallback(() => setEstado({ cargando: false, datos: null, error: null }), []);
  return { ...estado, detectar, limpiar };
}

export function etiquetaFormato(d: Deteccion) {
  if (d.tipo !== "csv") return `Excel (.${d.tipo}) · ${d.columnas.length} columnas`;
  return `${(d.codificacion ?? "").toUpperCase()} · ${nombreSeparador(d.separador)} · ${d.columnas.length} columnas`;
}

/* Forzar codificacion y separador cuando la vista previa sale mal. */
export function FormatoManual({ formato, alCambiar, alRedetectar, cargando, deshabilitado }: {
  formato: Formato; alCambiar: (f: Formato) => void; alRedetectar: () => void; cargando?: boolean; deshabilitado?: boolean;
}) {
  return (
    <details className="rounded-md border border-hilo">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm text-texto-2 hover:text-texto">
        Formato del archivo <span className="ml-2 text-texto-3">(cámbialo solo si la vista previa se ve mal)</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-hilo p-4 md:flex-row md:items-end">
        <Campo etiqueta="Codificación" className="md:w-56">
          {(a) => (
            <Selector {...a} value={formato.codificacion} disabled={deshabilitado} onChange={(e) => alCambiar({ ...formato, codificacion: e.target.value })}>
              {CODIFICACIONES.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </Selector>
          )}
        </Campo>
        <Campo etiqueta="Separador" className="md:w-56">
          {(a) => (
            <Selector {...a} value={formato.separador} disabled={deshabilitado} onChange={(e) => alCambiar({ ...formato, separador: e.target.value })}>
              {SEPARADORES.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </Selector>
          )}
        </Campo>
        <Boton variante="secundario" onClick={alRedetectar} disabled={cargando || deshabilitado}
          icono={cargando ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}>
          Volver a leer
        </Boton>
      </div>
    </details>
  );
}

export function urlDescarga(d: Descarga) {
  return `/api/datos/descargas/${d.tipo}/${d.id}?nombre=${encodeURIComponent(d.nombre)}`;
}

export function BotonDescarga({ descarga, texto }: { descarga: Descarga; texto: string }) {
  return (
    <a href={urlDescarga(descarga)} download={descarga.nombre}
      className="inline-flex h-10 items-center gap-2 rounded-sm bg-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] text-superficie transition-colors duration-[var(--dur)] hover:bg-pizarra active:bg-marca active:text-marca-tinta dark:hover:bg-white/85">
      <Download className="size-4" aria-hidden />{texto}
    </a>
  );
}
