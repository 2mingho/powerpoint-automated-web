"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Plus, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Panel } from "@/components/ui/panel";
import type { ReglaCategoria, ResultadoClasificacion } from "@/lib/datos/tipos";
import { BotonDescarga, etiquetaFormato, FormatoManual, useDeteccion, type Formato } from "../_datos/deteccion";
import { Ranking } from "../_datos/graficos";
import { Cifras, numero, PanelProceso, Pasos, VistaPrevia, ZonaArchivos } from "../_datos/piezas";
import { FASES, useProcesoDatos } from "../_datos/proceso";
import { BarraPresets } from "./presets";

const PASOS = ["Archivo", "Reglas", "Proceso"];

type Tematica = { id: number; nombre: string; palabras: string };
type Categoria = { id: number; nombre: string; tematicas: Tematica[] };

let sig = 1;
const nuevaTematica = (nombre = "", palabras = ""): Tematica => ({ id: sig++, nombre, palabras });
const nuevaCategoria = (nombre = ""): Categoria => ({ id: sig++, nombre, tematicas: [nuevaTematica()] });

function aReglas(cats: Categoria[]): ReglaCategoria[] {
  return cats.map((c) => ({
    category: c.nombre.trim() || "Sin nombre",
    tematicas: c.tematicas.map((t) => ({ name: t.nombre.trim() || "General", keywords: t.palabras.split(",").map((k) => k.trim()).filter(Boolean) })),
  }));
}

function deReglas(r: ReglaCategoria[]): Categoria[] {
  return r.map((c) => ({ id: sig++, nombre: c.category, tematicas: c.tematicas.map((t) => nuevaTematica(t.name, t.keywords.join(", "))) }));
}

const COLUMNAS_TEXTO = ["Hit Sentence", "Headline", "Texto", "Text", "Mensaje", "Contenido"];

export function FlujoClasificacion() {
  const [paso, setPaso] = useState(0);
  const [archivo, setArchivo] = useState<File[]>([]);
  const [formato, setFormato] = useState<Formato>({ codificacion: "", separador: "" });
  const det = useDeteccion("/api/datos/clasificacion/detectar");
  const [colTexto, setColTexto] = useState("");
  const [colKeywords, setColKeywords] = useState("");
  const [usarKeywords, setUsarKeywords] = useState(false);
  const [defecto, setDefecto] = useState("Sin Clasificar");
  const [categorias, setCategorias] = useState<Categoria[]>([nuevaCategoria("")]);
  const [errorReglas, setErrorReglas] = useState<string | null>(null);
  const proceso = useProcesoDatos<ResultadoClasificacion>();
  const primeraCategoria = useRef<HTMLInputElement>(null);

  const { detectar, limpiar } = det;
  function elegir(fs: File[]) {
    setArchivo(fs);
    setFormato({ codificacion: "", separador: "" });
    if (!fs[0]) { limpiar(); return; }
    void detectar(fs[0]).then((d) => {
      if (!d) return;
      setColTexto(COLUMNAS_TEXTO.find((c) => d.columnas.includes(c)) ?? d.columnas[0] ?? "");
      setColKeywords(d.columnas.find((c) => /^keywords?$/i.test(c)) ?? "");
    });
  }

  useEffect(() => { if (paso === 1) primeraCategoria.current?.focus(); }, [paso]);

  const columnas = det.datos?.columnas ?? [];

  function editarCat(id: number, cambio: Partial<Categoria>) { setCategorias((cs) => cs.map((c) => (c.id === id ? { ...c, ...cambio } : c))); }
  function editarTem(catId: number, temId: number, cambio: Partial<Tematica>) {
    setCategorias((cs) => cs.map((c) => (c.id === catId ? { ...c, tematicas: c.tematicas.map((t) => (t.id === temId ? { ...t, ...cambio } : t)) } : c)));
  }

  function clasificar() {
    const reglas = aReglas(categorias);
    if (!reglas.some((c) => c.tematicas.some((t) => t.keywords.length))) {
      setErrorReglas("Añade al menos una temática con palabras clave.");
      return;
    }
    setErrorReglas(null);
    const fd = new FormData();
    fd.append("archivo", archivo[0]);
    fd.set("reglas", JSON.stringify(reglas));
    fd.set("columna_texto", colTexto);
    fd.set("etiqueta_defecto", defecto.trim() || "Sin Clasificar");
    fd.set("usar_keywords", usarKeywords ? "1" : "0");
    if (usarKeywords && colKeywords) fd.set("columna_keywords", colKeywords);
    if (formato.codificacion) fd.set("codificacion", formato.codificacion);
    if (formato.separador) fd.set("separador", formato.separador);
    setPaso(2);
    void proceso.lanzar("/api/datos/clasificacion", fd);
  }

  const enMarcha = proceso.situacion === "subiendo" || proceso.situacion === "procesando";
  const r = proceso.resultado;

  return (
    <div className="flex flex-col gap-4">
      <Pasos pasos={PASOS} actual={paso} alElegir={enMarcha ? undefined : (i) => { proceso.reiniciar(); setPaso(i); }} />

      {paso === 0 && (
        <Panel titulo="Archivo de menciones" cuerpoClassName="flex flex-col gap-4 p-4">
          <ZonaArchivos herramienta="classification" archivos={archivo} alCambiar={elegir}
            titulo="Suelta aquí el archivo" ayuda="CSV, TXT o Excel con una mención por fila · hasta 150 MB. La codificación y el separador se detectan solos." />
          {det.cargando && <p className="flex items-center gap-2 text-sm text-texto-2"><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />Leyendo las primeras filas…</p>}
          {det.error && <p role="alert" className="text-sm text-alerta">{det.error}</p>}
          {det.datos && (
            <>
              <p className="text-sm text-texto-2">Detectado: <span className="font-mono text-texto">{etiquetaFormato(det.datos)}</span></p>
              <VistaPrevia columnas={det.datos.columnas} filas={det.datos.vista_previa} resaltar={[colTexto]} />
            </>
          )}
          {archivo[0] && (det.datos || det.error) && det.datos?.tipo !== "xlsx" && (
            <FormatoManual formato={formato} alCambiar={setFormato} cargando={det.cargando} alRedetectar={() => void detectar(archivo[0], formato)} />
          )}
          <div className="flex justify-end">
            <Boton variante="primario" disabled={!det.datos || det.cargando} onClick={() => setPaso(1)} icono={<ArrowRight className="size-4" aria-hidden />}>Continuar</Boton>
          </div>
        </Panel>
      )}

      {paso === 1 && (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); clasificar(); }} noValidate>
          <Panel titulo="Qué columna se lee" cuerpoClassName="grid gap-4 p-4 md:grid-cols-2">
            <Campo etiqueta="Columna de texto" ayuda="Donde se buscan las palabras clave.">
              {(a) => (
                <Selector {...a} value={colTexto} onChange={(e) => setColTexto(e.target.value)}>
                  {columnas.map((c) => <option key={c} value={c}>{c}</option>)}
                </Selector>
              )}
            </Campo>
            <Campo etiqueta="Etiqueta para lo no clasificado">
              {(a) => <Entrada {...a} value={defecto} onChange={(e) => setDefecto(e.target.value)} maxLength={100} />}
            </Campo>
          </Panel>

          <Panel titulo="Reglas" cuerpoClassName="flex flex-col gap-4 p-4">
            <BarraPresets reglas={() => aReglas(categorias)} alCargar={(rs) => setCategorias(rs.length ? deReglas(rs) : [nuevaCategoria()])} />
            <ol className="flex flex-col gap-3">
              {categorias.map((c, ci) => (
                <li key={c.id} className="rounded-md border border-hilo">
                  <div className="flex items-end gap-2 border-b border-hilo bg-superficie-2 px-3 py-3">
                    <Campo etiqueta={`Categoría ${ci + 1}`} className="flex-1">
                      {(a) => <Entrada {...a} ref={ci === 0 ? primeraCategoria : undefined} value={c.nombre} placeholder="Ej.: Economía" onChange={(e) => editarCat(c.id, { nombre: e.target.value })} />}
                    </Campo>
                    {categorias.length > 1 && (
                      <Boton variante="fantasma" aria-label={`Quitar la categoría ${c.nombre || ci + 1}`} onClick={() => setCategorias((cs) => cs.filter((x) => x.id !== c.id))} icono={<X className="size-4" aria-hidden />} />
                    )}
                  </div>
                  <ul className="flex flex-col divide-y divide-hilo">
                    {c.tematicas.map((t, ti) => (
                      <li key={t.id} className="grid gap-2 px-3 py-3 md:grid-cols-[14rem_1fr_auto] md:items-end">
                        <Campo etiqueta="Temática">
                          {(a) => <Entrada {...a} value={t.nombre} placeholder="Ej.: Precios" onChange={(e) => editarTem(c.id, t.id, { nombre: e.target.value })} />}
                        </Campo>
                        <Campo etiqueta="Palabras clave, separadas por comas">
                          {(a) => <Entrada {...a} value={t.palabras} placeholder="inflación, precios, costo de vida" onChange={(e) => editarTem(c.id, t.id, { palabras: e.target.value })} />}
                        </Campo>
                        {c.tematicas.length > 1 && (
                          <Boton variante="fantasma" aria-label={`Quitar la temática ${t.nombre || ti + 1}`} icono={<X className="size-4" aria-hidden />}
                            onClick={() => editarCat(c.id, { tematicas: c.tematicas.filter((x) => x.id !== t.id) })} />
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-hilo px-3 py-2">
                    <Boton tamano="sm" variante="fantasma" icono={<Plus className="size-3.5" aria-hidden />} onClick={() => editarCat(c.id, { tematicas: [...c.tematicas, nuevaTematica()] })}>Añadir temática</Boton>
                  </div>
                </li>
              ))}
            </ol>
            <div>
              <Boton variante="secundario" icono={<Plus className="size-4" aria-hidden />} onClick={() => setCategorias((cs) => [...cs, nuevaCategoria()])}>Añadir categoría</Boton>
            </div>
            <details className="rounded-md border border-hilo">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm text-texto-2 hover:text-texto">Opciones avanzadas</summary>
              <div className="flex flex-col gap-3 border-t border-hilo p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={usarKeywords} onChange={(e) => setUsarKeywords(e.target.checked)} className="mt-0.5 size-4 accent-[var(--texto)]" />
                  <span>
                    <span className="block font-medium">Segunda pasada por la columna de palabras clave</span>
                    <span className="block text-sm text-texto-2">Lo que el texto no clasifique se intenta con esa columna.</span>
                  </span>
                </label>
                {usarKeywords && (
                  <Campo etiqueta="Columna de palabras clave" className="md:w-80">
                    {(a) => (
                      <Selector {...a} value={colKeywords} onChange={(e) => setColKeywords(e.target.value)}>
                        <option value="">Keywords (por defecto)</option>
                        {columnas.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Selector>
                    )}
                  </Campo>
                )}
              </div>
            </details>
            {errorReglas && <p role="alert" className="text-sm text-alerta">{errorReglas}</p>}
            <div className="flex items-center justify-between gap-3">
              <Boton variante="fantasma" onClick={() => setPaso(0)}>Volver</Boton>
              <Boton type="submit" variante="primario">Clasificar</Boton>
            </div>
          </Panel>
        </form>
      )}

      {paso === 2 && (
        <Panel titulo={proceso.situacion === "hecho" ? "Clasificación lista" : "Clasificando"} cuerpoClassName="p-4">
          <PanelProceso fases={FASES.clasificacion} situacion={proceso.situacion} proceso={proceso.proceso} enCola={proceso.enCola}
            alCancelar={proceso.cancelar} alReintentar={clasificar} alVolver={() => { proceso.reiniciar(); setPaso(1); }} />
        </Panel>
      )}

      {paso === 2 && r && <ResultadoClasif r={r} alNueva={() => { proceso.reiniciar(); setArchivo([]); setPaso(0); }} />}
    </div>
  );
}

function ResultadoClasif({ r, alNueva }: { r: ResultadoClasificacion; alNueva: () => void }) {
  const tasa = r.total_filas ? Math.round((r.clasificadas / r.total_filas) * 1000) / 10 : 0;
  const cats = Object.entries(r.stats).filter(([k]) => k !== r.etiqueta_defecto).sort((a, b) => b[1].total - a[1].total);
  return (
    <Panel titulo="Resultado" acciones={<Boton tamano="sm" variante="fantasma" onClick={alNueva}>Clasificar otro archivo</Boton>} cuerpoClassName="flex flex-col gap-6 p-4">
      <Cifras items={[
        { rotulo: "Filas", valor: numero(r.total_filas) },
        { rotulo: "Clasificadas", valor: `${tasa.toLocaleString("es-DO")}%`, detalle: `${numero(r.clasificadas)} filas` },
        { rotulo: r.etiqueta_defecto, valor: numero(r.sin_clasificar) },
        { rotulo: "Categoría principal", valor: <span className="block truncate font-sans text-xl">{r.insights.top_category === "N/A" ? "—" : r.insights.top_category}</span>, detalle: r.insights.top_count ? `${numero(r.insights.top_count)} menciones` : undefined },
      ]} />
      <div className="grid gap-6 md:grid-cols-2">
        <figure className="flex flex-col gap-3">
          <figcaption className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">Menciones por categoría</figcaption>
          <Ranking titulo="Menciones por categoría" datos={[...cats.map(([k, v]) => ({ etiqueta: k, valor: v.total })), ...(r.sin_clasificar ? [{ etiqueta: r.etiqueta_defecto, valor: r.sin_clasificar, apagado: true }] : [])]} />
        </figure>
        <div className="flex flex-col gap-2">
          <p className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">Desglose por temática</p>
          <ul className="divide-y divide-hilo rounded-md border border-hilo">
            {cats.map(([cat, d]) => (
              <li key={cat}>
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 hover:bg-superficie-2">
                    <span className="truncate">{cat}</span><span className="font-mono text-sm cifras">{numero(d.total)}</span>
                  </summary>
                  <ul className="border-t border-hilo bg-superficie-2 px-3 py-2 text-sm">
                    {Object.entries(d.tematicas).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                      <li key={t} className="flex justify-between py-1 text-texto-2"><span className="truncate">{t}</span><span className="font-mono cifras">{numero(n)}</span></li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
            {!cats.length && <li className="px-3 py-4 text-sm text-texto-3">Ninguna mención coincidió con las reglas. Revisa las palabras clave o la columna de texto.</li>}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hilo pt-4">
        <p className="text-sm text-texto-2">El archivo trae dos columnas nuevas, <span className="font-mono">Categoria</span> y <span className="font-mono">Tematica</span>. Disponible durante una hora.</p>
        <BotonDescarga descarga={r.descarga} texto="Descargar clasificado" />
      </div>
    </Panel>
  );
}
