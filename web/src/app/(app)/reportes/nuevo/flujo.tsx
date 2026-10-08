"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada } from "@/components/ui/campo";
import { Panel } from "@/components/ui/panel";
import { cx } from "@/components/ui/cx";
import type { PrevisualizacionReporte, ResultadoReporte } from "@/lib/datos/tipos";
import { PanelProceso, Pasos, ZonaArchivos } from "../../_datos/piezas";
import { FASES, pedirJson, useProcesoDatos } from "../../_datos/proceso";

const PASOS = ["Archivos", "Opciones", "Proceso"];

export function FlujoReporte() {
  const router = useRouter();
  const [paso, setPaso] = useState(0);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [vista, setVista] = useState<PrevisualizacionReporte | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [autores, setAutores] = useState("");
  const [usarIa, setUsarIa] = useState(true);
  const [analisis, setAnalisis] = useState("");
  const [abriendo, setAbriendo] = useState(false);
  const tituloRef = useRef<HTMLInputElement>(null);

  const proceso = useProcesoDatos<ResultadoReporte>({
    alTerminar: (r) => {
      setAbriendo(true);
      // Un instante para ver todas las fases en "Hecho" antes de salir.
      setTimeout(() => router.push(`/reportes/${r.token}`), 700);
    },
  });

  // Vista previa: que widget es cada archivo, en cuanto se sueltan.
  const vistaEnCurso = useRef<AbortController | null>(null);
  function cambiarArchivos(lista: File[]) {
    setArchivos(lista);
    vistaEnCurso.current?.abort();
    setErrorVista(null);
    if (!lista.length) { setVista(null); setLeyendo(false); return; }
    const control = new AbortController();
    vistaEnCurso.current = control;
    const fd = new FormData();
    lista.forEach((a) => fd.append("archivos", a));
    setLeyendo(true);
    pedirJson<PrevisualizacionReporte>("/api/datos/reportes/previsualizar", { method: "POST", body: fd, signal: control.signal })
      .then(setVista)
      .catch((e: Error) => { if (!control.signal.aborted) setErrorVista(e.message); })
      .finally(() => { if (!control.signal.aborted) setLeyendo(false); });
  }
  useEffect(() => () => vistaEnCurso.current?.abort(), []);

  useEffect(() => { if (paso === 1) tituloRef.current?.focus(); }, [paso]);

  const reconocidos = vista?.archivos.filter((a) => a.widget && !a.error).length ?? 0;
  const autoresLimpio = autores.replace(/[.,\s]/g, "");
  const errorAutores = autoresLimpio && !/^\d+$/.test(autoresLimpio) ? "Escribe solo el número, por ejemplo 12480." : undefined;

  function generar() {
    if (errorAutores) return;
    const fd = new FormData();
    archivos.forEach((a) => fd.append("archivos", a));
    fd.set("titulo", titulo.trim() || "Mi Reporte");
    if (autoresLimpio) fd.set("autores_unicos", autoresLimpio);
    fd.set("textos_ia", usarIa ? "1" : "0");
    if (analisis.trim()) fd.set("analisis_meltwater", analisis.trim());
    setPaso(2);
    void proceso.lanzar("/api/datos/reportes", fd);
  }

  const enMarcha = proceso.situacion === "subiendo" || proceso.situacion === "procesando";

  return (
    <div className="flex flex-col gap-4">
      <Pasos pasos={PASOS} actual={paso} alElegir={enMarcha || abriendo ? undefined : (i) => { proceso.reiniciar(); setPaso(i); }} />

      {paso === 0 && (
        <Panel titulo="Archivos de Meltwater" cuerpoClassName="flex flex-col gap-4 p-4">
          <ZonaArchivos herramienta="reports" multiple archivos={archivos} alCambiar={cambiarArchivos}
            titulo="Suelta aquí los widgets" ayuda="o haz clic para elegirlos · varios .xlsx a la vez, hasta 60 MB en total" />

          {leyendo && <p className="flex items-center gap-2 text-sm text-texto-2"><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />Reconociendo los widgets…</p>}
          {errorVista && <p role="alert" className="text-sm text-alerta">{errorVista}</p>}

          {vista && !leyendo && (
            <div className="flex flex-col gap-3">
              <table className="w-full text-sm">
                <caption className="sr-only">Widgets reconocidos</caption>
                <thead>
                  <tr className="border-b border-hilo">
                    <th scope="col" className="h-9 text-left rotulo">Archivo</th>
                    <th scope="col" className="hidden text-left rotulo md:table-cell">Widget</th>
                    <th scope="col" className="text-right rotulo">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {vista.archivos.map((a) => (
                    <tr key={a.nombre} className="border-b border-hilo last:border-0">
                      <td className="py-2.5 pr-3 align-top">
                        <span className="block truncate">{a.nombre}</span>
                        <span className="block text-xs text-texto-3 md:hidden">{a.etiqueta ?? "Sin reconocer"}</span>
                        {a.error && <span className="mt-0.5 block text-xs text-alerta">{a.error}</span>}
                      </td>
                      <td className="hidden py-2.5 pr-3 align-top text-texto-2 md:table-cell">{a.etiqueta ?? "—"}</td>
                      <td className="py-2.5 text-right align-top">
                        {a.error
                          ? <span className="inline-flex items-center gap-1 font-rotulo text-xs font-semibold uppercase tracking-[0.1em] text-alerta"><AlertTriangle className="size-3.5" aria-hidden />No se usará</span>
                          : <span className="inline-flex items-center gap-1 font-rotulo text-xs font-semibold uppercase tracking-[0.1em] text-bien"><CheckCircle2 className="size-3.5" aria-hidden />Listo</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {vista.faltan.length > 0 && (
                <details className="rounded-md border border-hilo bg-superficie-2 px-4 py-3 text-sm">
                  <summary className="cursor-pointer text-texto-2">
                    Faltan <span className="font-mono cifras">{vista.faltan.length}</span> widgets: el reporte se genera sin esas secciones
                  </summary>
                  <ul className="mt-2 grid gap-1 md:grid-cols-2">
                    {vista.faltan.map((f) => <li key={f.clave}><span className="text-texto">{f.etiqueta}</span> <span className="text-texto-3">· {f.aporta}</span></li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-texto-3">
              {vista ? <><span className="font-mono text-texto cifras">{reconocidos}</span> de 10 widgets reconocidos</> : "Ningún archivo todavía"}
            </p>
            <Boton variante="primario" disabled={!reconocidos || leyendo} onClick={() => setPaso(1)} icono={<ArrowRight className="size-4" aria-hidden />}>
              Continuar
            </Boton>
          </div>
        </Panel>
      )}

      {paso === 1 && (
        <Panel titulo="Opciones del reporte" cuerpoClassName="flex flex-col gap-4 p-4">
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); generar(); }} noValidate>
            <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
              <Campo etiqueta="Nombre del reporte" ayuda="Suele ser el cliente o la campaña. Sale en la portada.">
                {(a) => <Entrada {...a} ref={tituloRef} value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={255} placeholder="Ej.: Rendición de cuentas" />}
              </Campo>
              <Campo etiqueta="Autores únicos" ayuda="Lo muestra Meltwater en pantalla. Opcional." error={errorAutores}>
                {(a) => <Entrada {...a} inputMode="numeric" value={autores} onChange={(e) => setAutores(e.target.value)} placeholder="12,480" className="font-mono" />}
              </Campo>
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-hilo px-4 py-3 hover:bg-superficie-2">
              <input type="checkbox" checked={usarIa} onChange={(e) => setUsarIa(e.target.checked)} className="mt-0.5 size-4 accent-[var(--texto)]" />
              <span>
                <span className="block font-medium">Redactar los textos con IA</span>
                <span className="block text-sm text-texto-2">Si no hay proveedor configurado o falla, el reporte sale igual con los textos por reglas.</span>
              </span>
            </label>
            <details className="group rounded-md border border-hilo">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm text-texto-2 hover:text-texto">Opciones avanzadas</summary>
              <div className="border-t border-hilo p-4">
                <Campo etiqueta="Análisis de Meltwater" ayuda="Pega el análisis que genera Meltwater: da contexto a la IA. No se muestra en el reporte.">
                  {(a) => <AreaTexto {...a} rows={6} value={analisis} onChange={(e) => setAnalisis(e.target.value)} disabled={!usarIa} />}
                </Campo>
              </div>
            </details>
            <div className="flex items-center justify-between gap-3">
              <Boton variante="fantasma" onClick={() => setPaso(0)}>Volver</Boton>
              <Boton type="submit" variante="primario" disabled={!!errorAutores}>Generar reporte</Boton>
            </div>
          </form>
        </Panel>
      )}

      {paso === 2 && (
        <Panel titulo={abriendo ? "Reporte listo" : "Generando el reporte"} cuerpoClassName="p-4">
          <PanelProceso
            fases={FASES.reporte}
            situacion={proceso.situacion}
            proceso={proceso.proceso}
            enCola={proceso.enCola}
            alCancelar={proceso.cancelar}
            alReintentar={generar}
            alVolver={() => { proceso.reiniciar(); setPaso(1); }}
            pie={abriendo ? <p className={cx("flex items-center gap-2 text-sm text-texto-2")}><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />Abriendo el reporte…</p> : null}
          />
        </Panel>
      )}
    </div>
  );
}
