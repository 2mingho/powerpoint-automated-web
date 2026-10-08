"use client";
import { useState } from "react";
import { ArrowRight, Lightbulb, Loader2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Panel } from "@/components/ui/panel";
import { nombreSeparador } from "@/lib/datos/limites";
import type { ResultadoAnalisis } from "@/lib/datos/tipos";
import { BotonDescarga, etiquetaFormato, FormatoManual, useDeteccion, type Formato } from "../_datos/deteccion";
import { Histograma, MapaCorrelacion, Ranking } from "../_datos/graficos";
import { Cifras, numero, PanelProceso, Pasos, VistaPrevia, ZonaArchivos } from "../_datos/piezas";
import { FASES, useProcesoDatos } from "../_datos/proceso";

const PASOS = ["Archivo", "Formato", "Proceso"];

export function FlujoAnalisis() {
  const [paso, setPaso] = useState(0);
  const [archivo, setArchivo] = useState<File[]>([]);
  const [formato, setFormato] = useState<Formato>({ codificacion: "", separador: "" });
  const det = useDeteccion("/api/datos/analisis/detectar");
  const proceso = useProcesoDatos<ResultadoAnalisis>();

  const { detectar, limpiar } = det;
  function elegir(fs: File[]) {
    setArchivo(fs);
    setFormato({ codificacion: "", separador: "" });
    if (fs[0]) void detectar(fs[0]); else limpiar();
  }

  function analizar() {
    const fd = new FormData();
    fd.append("archivo", archivo[0]);
    // Lo detectado manda salvo que el usuario lo haya cambiado.
    const enc = formato.codificacion || det.datos?.codificacion || "";
    const sep = formato.separador || det.datos?.separador || "";
    if (enc) fd.set("codificacion", enc);
    if (sep) fd.set("separador", sep === "\t" ? "\\t" : sep);
    setPaso(2);
    void proceso.lanzar("/api/datos/analisis", fd);
  }

  const enMarcha = proceso.situacion === "subiendo" || proceso.situacion === "procesando";

  return (
    <div className="flex flex-col gap-4">
      <Pasos pasos={PASOS} actual={paso} alElegir={enMarcha ? undefined : (i) => { proceso.reiniciar(); setPaso(i); }} />

      {paso === 0 && (
        <Panel titulo="Archivo" cuerpoClassName="flex flex-col gap-4 p-4">
          <ZonaArchivos herramienta="csv_analysis" archivos={archivo} alCambiar={elegir}
            titulo="Suelta aquí el CSV" ayuda="CSV o TXT · hasta 150 MB. La codificación y el separador se detectan solos." />
          {det.cargando && <p className="flex items-center gap-2 text-sm text-texto-2"><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />Leyendo las primeras filas…</p>}
          {det.error && <p role="alert" className="text-sm text-alerta">{det.error}</p>}
          {det.datos && <VistaPrevia columnas={det.datos.columnas} filas={det.datos.vista_previa} />}
          <div className="flex justify-end">
            <Boton variante="primario" disabled={!det.datos || det.cargando} onClick={() => setPaso(1)} icono={<ArrowRight className="size-4" aria-hidden />}>Continuar</Boton>
          </div>
        </Panel>
      )}

      {paso === 1 && det.datos && (
        <Panel titulo="Formato" cuerpoClassName="flex flex-col gap-4 p-4">
          <p className="text-texto-2">Se leerá como <span className="font-mono text-texto">{etiquetaFormato(det.datos)}</span>. Si la vista previa se ve bien, analiza directamente.</p>
          <VistaPrevia columnas={det.datos.columnas} filas={det.datos.vista_previa.slice(0, 3)} />
          <FormatoManual formato={formato} alCambiar={setFormato} cargando={det.cargando} alRedetectar={() => void detectar(archivo[0], formato)} />
          <div className="flex items-center justify-between gap-3">
            <Boton variante="fantasma" onClick={() => setPaso(0)}>Volver</Boton>
            <Boton variante="primario" onClick={analizar}>Analizar</Boton>
          </div>
        </Panel>
      )}

      {paso === 2 && proceso.situacion !== "hecho" && (
        <Panel titulo="Analizando" cuerpoClassName="p-4">
          <PanelProceso fases={FASES.analisis} situacion={proceso.situacion} proceso={proceso.proceso} enCola={proceso.enCola}
            alCancelar={proceso.cancelar} alReintentar={analizar} alVolver={() => { proceso.reiniciar(); setPaso(1); }} />
        </Panel>
      )}

      {paso === 2 && proceso.resultado && <Resultado r={proceso.resultado} alNuevo={() => { proceso.reiniciar(); setArchivo([]); setPaso(0); }} />}
    </div>
  );
}

function Titulo({ children }: { children: string }) {
  return <h3 className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">{children}</h3>;
}

function Resultado({ r, alNuevo }: { r: ResultadoAnalisis; alNuevo: () => void }) {
  const faltantes = r.missing.columns_with_missing.filter((c) => c.missing_count > 0).slice(0, 10);
  const numericas = r.distributions.numeric;
  const categoricas = r.distributions.categorical;
  return (
    <div className="flex flex-col gap-4">
      <Panel
        titulo={<h2 className="min-w-0 truncate font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">{r.nombre_original}</h2>}
        acciones={<><Boton tamano="sm" variante="fantasma" onClick={alNuevo}>Analizar otro</Boton><BotonDescarga descarga={r.descarga} texto="Resumen CSV" /></>}
        cuerpoClassName="flex flex-col gap-5 p-4">
        <Cifras items={[
          { rotulo: "Filas", valor: numero(r.general.row_count) },
          { rotulo: "Columnas", valor: numero(r.general.column_count), detalle: `${r.general.numeric_columns.length} numéricas · ${r.general.categorical_columns.length} de texto` },
          { rotulo: "Celdas vacías", valor: `${r.missing.total_missing_percentage.toLocaleString("es-DO")}%`, detalle: `${numero(r.missing.total_missing_cells)} celdas` },
          { rotulo: "Tamaño", valor: `${r.file_info.file_size_mb.toLocaleString("es-DO")} MB`, detalle: `${r.file_info.encoding_used.toUpperCase()} · ${nombreSeparador(r.file_info.separator_used)}` },
        ]} />
        {r.insights.length > 0 && (
          <ul className="flex flex-col divide-y divide-hilo rounded-md border border-hilo">
            {r.insights.map((t) => (
              <li key={t} className="flex gap-3 px-4 py-3"><Lightbulb className="mt-0.5 size-4 shrink-0 text-texto-3" aria-hidden /><span className="max-w-[80ch]">{t}</span></li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel titulo="Valores faltantes" cuerpoClassName="p-4">
          {faltantes.length
            ? <Ranking titulo="Porcentaje de filas vacías por columna" color="var(--serie-2)" sufijo="%" datos={faltantes.map((c) => ({ etiqueta: c.column, valor: c.missing_percentage ?? 0 }))} />
            : <p className="text-sm text-texto-2">Ninguna columna tiene valores vacíos.</p>}
        </Panel>
        <Panel titulo="Columnas numéricas" cuerpoClassName="overflow-x-auto p-0">
          {r.numeric.stats.length ? (
            <table className="w-full min-w-[32rem] text-sm">
              <thead><tr className="border-b border-hilo bg-superficie-2">{["Columna", "Media", "Mediana", "Mín", "Máx"].map((h, i) => <th key={h} scope="col" className={`h-9 px-3 rotulo ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody>
                {r.numeric.stats.map((s) => (
                  <tr key={s.column} className="border-b border-hilo last:border-0">
                    <td className="max-w-48 truncate px-3 py-2">{s.column}</td>
                    {[s.mean, s.median, s.min, s.max].map((v, i) => <td key={i} className="px-3 py-2 text-right font-mono cifras">{v == null ? "—" : v.toLocaleString("es-DO", { maximumFractionDigits: 2 })}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="p-4 text-sm text-texto-2">El archivo no tiene columnas numéricas.</p>}
        </Panel>
      </div>

      {numericas.length > 0 && (
        <Panel titulo="Distribución de las columnas numéricas" cuerpoClassName="grid gap-6 p-4 md:grid-cols-2">
          {numericas.map((d) => (
            <figure key={d.column} className="flex min-w-0 flex-col gap-2">
              <figcaption><Titulo>{d.column}</Titulo></figcaption>
              <Histograma columna={d.column} bins={d.bins} counts={d.counts} />
            </figure>
          ))}
        </Panel>
      )}

      {categoricas.length > 0 && (
        <Panel titulo="Valores más frecuentes" cuerpoClassName="grid gap-6 p-4 md:grid-cols-2">
          {categoricas.map((d) => {
            const st = r.categorical.stats.find((s) => s.column === d.column);
            return (
              <figure key={d.column} className="flex min-w-0 flex-col gap-2">
                <figcaption className="flex items-baseline justify-between gap-2">
                  <Titulo>{d.column}</Titulo>
                  {st && <span className="font-mono text-xs text-texto-3 cifras">{numero(st.unique_count)} distintos</span>}
                </figcaption>
                <Ranking titulo={`Valores más frecuentes de ${d.column}`} datos={d.labels.map((l, i) => ({ etiqueta: l || "(vacío)", valor: d.counts[i] }))} />
              </figure>
            );
          })}
        </Panel>
      )}

      {r.correlation.matrix.length > 1 && (
        <Panel titulo="Correlación entre columnas numéricas" cuerpoClassName="flex flex-col gap-3 p-4">
          <p className="text-sm text-texto-2">De −1 a 1. Azul: suben juntas; rojo: cuando una sube, la otra baja. Cuanto más intenso, más fuerte la relación.</p>
          <MapaCorrelacion columnas={r.correlation.columns} matriz={r.correlation.matrix} />
        </Panel>
      )}
    </div>
  );
}
