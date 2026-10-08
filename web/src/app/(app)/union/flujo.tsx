"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Minus, Plus, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Panel } from "@/components/ui/panel";
import { cx } from "@/components/ui/cx";
import { BYTES_VISTA_PREVIA, extension } from "@/lib/datos/limites";
import type { Deteccion, ResultadoUnion } from "@/lib/datos/tipos";
import { BotonDescarga, etiquetaFormato } from "../_datos/deteccion";
import { Ranking } from "../_datos/graficos";
import { Cifras, numero, PanelProceso, Pasos, ZonaArchivos } from "../_datos/piezas";
import { FASES, pedirJson, useProcesoDatos } from "../_datos/proceso";

const PASOS = ["Archivos", "Columnas", "Proceso"];
type Modo = "predeterminado" | "avanzado";

async function detectarUno(f: File): Promise<Deteccion | string> {
  const fd = new FormData();
  const esCsv = !["xlsx", "xls"].includes(extension(f.name));
  fd.append("archivo", esCsv && f.size > BYTES_VISTA_PREVIA ? new File([f.slice(0, BYTES_VISTA_PREVIA)], f.name) : f);
  try { return await pedirJson<Deteccion>("/api/datos/union/detectar", { method: "POST", body: fd }); }
  catch (e) { return e instanceof Error ? e.message : "No se pudo leer."; }
}

/* Detecta cada archivo una vez y recuerda el resultado por nombre y tamano. */
function useDetecciones(archivos: File[]) {
  const [mapa, setMapa] = useState<Record<string, Deteccion | string>>({});
  const pedidos = useRef(new Set<string>());
  useEffect(() => {
    for (const f of archivos) {
      const k = `${f.name}:${f.size}`;
      if (pedidos.current.has(k)) continue;
      pedidos.current.add(k);
      void detectarUno(f).then((d) => setMapa((m) => ({ ...m, [k]: d })));
    }
  }, [archivos]);
  return archivos.map((f) => mapa[`${f.name}:${f.size}`] ?? null);
}

function EstadoArchivo({ d }: { d: Deteccion | string | null }) {
  if (d === null) return <span className="flex items-center gap-1.5 text-sm text-texto-3"><Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />Leyendo…</span>;
  if (typeof d === "string") return <span className="text-sm text-alerta">{d}</span>;
  return <span className="font-mono text-xs text-texto-2">{etiquetaFormato(d)}</span>;
}

export function FlujoUnion() {
  const [paso, setPaso] = useState(0);
  const [modo, setModo] = useState<Modo>("predeterminado");
  const [varios, setVarios] = useState<File[]>([]);
  const [archA, setArchA] = useState<File[]>([]);
  const [archB, setArchB] = useState<File[]>([]);
  // Lo que el usuario cambio a mano; el resto sale del emparejado por nombre.
  const [cambiosMapeo, setCambiosMapeo] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<{ id: number; nombre: string; valor: string }[]>([]);
  const proceso = useProcesoDatos<ResultadoUnion>();

  const archivos = modo === "predeterminado" ? varios : [...archA, ...archB];
  const detecciones = useDetecciones(archivos);
  const listas = detecciones.every((d) => d && typeof d !== "string");
  const columnasA = (modo === "avanzado" && detecciones[0] && typeof detecciones[0] !== "string") ? detecciones[0].columnas : [];
  const columnasB = (modo === "avanzado" && detecciones[1] && typeof detecciones[1] !== "string") ? detecciones[1].columnas : [];

  // Mapeo: mismas columnas por nombre (sin distinguir mayusculas) salvo cambio a mano.
  const mapeo: Record<string, string> = Object.fromEntries(columnasA.map((a) => [
    a, a in cambiosMapeo ? cambiosMapeo[a] : (columnasB.find((b) => b.trim().toLowerCase() === a.trim().toLowerCase()) ?? ""),
  ]));

  const puedeSeguir = (modo === "predeterminado" ? varios.length >= 2 : archA.length === 1 && archB.length === 1) && listas;

  // Matriz columna x archivo para el modo de apilar: que queda vacio y donde.
  const cobertura = useMemo(() => {
    if (modo !== "predeterminado" || !listas) return [];
    const todas: string[] = [];
    detecciones.forEach((d) => (d as Deteccion).columnas.forEach((c) => { const t = c.trim(); if (!todas.includes(t)) todas.push(t); }));
    return todas.map((c) => ({ columna: c, en: detecciones.map((d) => (d as Deteccion).columnas.some((x) => x.trim() === c)) }));
  }, [modo, listas, detecciones]);
  const incompletas = cobertura.filter((c) => c.en.some((x) => !x)).length;
  const mapeadas = Object.values(mapeo).filter(Boolean).length;

  function unir() {
    const fd = new FormData();
    if (modo === "predeterminado") {
      fd.set("modo", "predeterminado");
      varios.forEach((f) => fd.append("archivos", f));
    } else {
      fd.set("modo", "avanzado");
      fd.append("archivo_a", archA[0]);
      fd.append("archivo_b", archB[0]);
      // El servicio espera { columna_de_B: columna_de_A }.
      fd.set("mapeo", JSON.stringify(Object.fromEntries(Object.entries(mapeo).filter(([, b]) => b).map(([a, b]) => [b, a]))));
      fd.set("columnas_extra", JSON.stringify(extras.filter((e) => e.nombre.trim()).map((e) => ({ name: e.nombre.trim(), value: e.valor }))));
    }
    setPaso(2);
    void proceso.lanzar("/api/datos/union", fd);
  }

  const enMarcha = proceso.situacion === "subiendo" || proceso.situacion === "procesando";
  const r = proceso.resultado;

  return (
    <div className="flex flex-col gap-4">
      <Pasos pasos={PASOS} actual={paso} alElegir={enMarcha ? undefined : (i) => { proceso.reiniciar(); setPaso(i); }} />

      {paso === 0 && (
        <Panel titulo="Archivos" cuerpoClassName="flex flex-col gap-4 p-4">
          <div role="radiogroup" aria-label="Cómo unir" className="grid gap-2 md:grid-cols-2">
            {([
              ["predeterminado", "Apilar archivos iguales", "Dos o más exports con las mismas columnas, uno debajo de otro."],
              ["avanzado", "Mapear dos estructuras", "Dos archivos con columnas distintas: eliges cuál corresponde a cuál."],
            ] as const).map(([m, t, d]) => (
              <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => setModo(m)}
                className={cx("flex flex-col items-start gap-1 rounded-md border px-4 py-3 text-left transition-colors duration-[var(--dur)]",
                  modo === m ? "border-texto bg-superficie-2" : "border-hilo hover:bg-superficie-2")}>
                <span className="flex items-center gap-2 font-rotulo text-sm font-semibold uppercase tracking-[0.1em]">
                  <span className={cx("grid size-4 place-items-center rounded-full border", modo === m ? "border-texto" : "border-hilo-fuerte")}>
                    {modo === m && <span className="size-2 rounded-full bg-texto" />}
                  </span>{t}
                </span>
                <span className="text-sm text-texto-2">{d}</span>
              </button>
            ))}
          </div>

          {modo === "predeterminado" ? (
            <ZonaArchivos herramienta="file_merge" multiple archivos={varios} alCambiar={setVarios}
              titulo="Suelta aquí los archivos" ayuda="Dos o más CSV, TXT o Excel · hasta 200 MB en total." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2"><p className="rotulo">A · estructura base</p>
                <ZonaArchivos compacta herramienta="file_merge" archivos={archA} alCambiar={setArchA} titulo="Archivo principal" ayuda="Define las columnas del resultado." /></div>
              <div className="flex flex-col gap-2"><p className="rotulo">B · se adapta a A</p>
                <ZonaArchivos compacta herramienta="file_merge" archivos={archB} alCambiar={setArchB} titulo="Archivo secundario" ayuda="Sus columnas se asignan a las de A." /></div>
            </div>
          )}

          {archivos.length > 0 && (
            <ul className="divide-y divide-hilo rounded-md border border-hilo">
              {archivos.map((f, i) => (
                <li key={`${f.name}${i}`} className="flex flex-col gap-0.5 px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <span className="truncate text-sm">{modo === "avanzado" ? `${i === 0 ? "A" : "B"} · ` : ""}{f.name}</span>
                  <EstadoArchivo d={detecciones[i]} />
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-texto-3">{modo === "predeterminado" ? `${varios.length} archivo(s) · mínimo 2` : `${archA.length + archB.length} de 2 archivos`}</p>
            <Boton variante="primario" disabled={!puedeSeguir} onClick={() => setPaso(1)} icono={<ArrowRight className="size-4" aria-hidden />}>Continuar</Boton>
          </div>
        </Panel>
      )}

      {paso === 1 && modo === "predeterminado" && (
        <Panel titulo="Columnas" cuerpoClassName="flex flex-col gap-4 p-4">
          <p className="text-texto-2">
            {incompletas
              ? <><span className="font-mono text-texto cifras">{incompletas}</span> columna(s) no están en todos los archivos: en las filas de esos archivos quedarán vacías.</>
              : "Todos los archivos tienen las mismas columnas: se apilan tal cual."}
          </p>
          <div className="overflow-x-auto rounded-md border border-hilo" tabIndex={0} role="region" aria-label="Columnas por archivo">
            <table className="w-full min-w-max text-sm">
              <thead><tr className="border-b border-hilo bg-superficie-2">
                <th scope="col" className="h-9 px-3 text-left rotulo">Columna</th>
                {varios.map((f) => <th key={f.name} scope="col" className="max-w-40 truncate px-3 text-center rotulo" title={f.name}>{f.name}</th>)}
              </tr></thead>
              <tbody>
                {cobertura.map((c) => (
                  <tr key={c.columna} className="border-b border-hilo last:border-0">
                    <td className="h-9 max-w-64 truncate px-3">{c.columna}</td>
                    {c.en.map((si, i) => (
                      <td key={i} className="px-3 text-center">
                        {si ? <Check className="mx-auto size-4 text-bien" aria-label="Sí" /> : <Minus className="mx-auto size-4 text-texto-3" aria-label="No" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Boton variante="fantasma" onClick={() => setPaso(0)}>Volver</Boton>
            <Boton variante="primario" onClick={unir}>Unir archivos</Boton>
          </div>
        </Panel>
      )}

      {paso === 1 && modo === "avanzado" && (
        <Panel titulo="Qué columna de B va en cada columna de A" cuerpoClassName="flex flex-col gap-4 p-4">
          <p className="text-sm text-texto-2">Las columnas de B que no asignes se descartan. <span className="font-mono text-texto cifras">{mapeadas}</span> de {columnasA.length} asignadas.</p>
          <ul className="flex flex-col divide-y divide-hilo rounded-md border border-hilo">
            {columnasA.map((a) => (
              <li key={a} className="grid grid-cols-1 gap-2 px-3 py-2 md:grid-cols-[1fr_auto_1fr] md:items-center">
                <span className="truncate text-sm font-medium">{a}</span>
                <ArrowLeft className="hidden size-4 text-texto-3 md:block" aria-hidden />
                <Selector aria-label={`Columna de B para ${a}`} value={mapeo[a] ?? ""} onChange={(e) => setCambiosMapeo((m) => ({ ...m, [a]: e.target.value }))}>
                  <option value="">Sin asignar</option>
                  {columnasB.map((b) => <option key={b} value={b}>{b}</option>)}
                </Selector>
              </li>
            ))}
          </ul>
          <details className="rounded-md border border-hilo">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm text-texto-2 hover:text-texto">Añadir columnas con un valor fijo <span className="ml-2 text-texto-3">(p. ej. «Fuente = encuesta»)</span></summary>
            <div className="flex flex-col gap-3 border-t border-hilo p-4">
              {extras.map((e) => (
                <div key={e.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <Campo etiqueta="Nombre de la columna">{(a) => <Entrada {...a} value={e.nombre} onChange={(ev) => setExtras((xs) => xs.map((x) => (x.id === e.id ? { ...x, nombre: ev.target.value } : x)))} />}</Campo>
                  <Campo etiqueta="Valor">{(a) => <Entrada {...a} value={e.valor} onChange={(ev) => setExtras((xs) => xs.map((x) => (x.id === e.id ? { ...x, valor: ev.target.value } : x)))} />}</Campo>
                  <Boton variante="fantasma" aria-label="Quitar columna" icono={<X className="size-4" aria-hidden />} onClick={() => setExtras((xs) => xs.filter((x) => x.id !== e.id))} />
                </div>
              ))}
              <div><Boton tamano="sm" variante="secundario" icono={<Plus className="size-3.5" aria-hidden />} onClick={() => setExtras((xs) => [...xs, { id: Date.now(), nombre: "", valor: "" }])}>Añadir columna</Boton></div>
            </div>
          </details>
          <div className="flex items-center justify-between gap-3">
            <Boton variante="fantasma" onClick={() => setPaso(0)}>Volver</Boton>
            <Boton variante="primario" disabled={!mapeadas} onClick={unir}>Unir archivos</Boton>
          </div>
        </Panel>
      )}

      {paso === 2 && (
        <Panel titulo={proceso.situacion === "hecho" ? "Unión lista" : "Uniendo"} cuerpoClassName="p-4">
          <PanelProceso fases={FASES.union} situacion={proceso.situacion} proceso={proceso.proceso} enCola={proceso.enCola}
            alCancelar={proceso.cancelar} alReintentar={unir} alVolver={() => { proceso.reiniciar(); setPaso(1); }} />
        </Panel>
      )}

      {paso === 2 && r && (
        <Panel titulo="Resultado" acciones={<Boton tamano="sm" variante="fantasma" onClick={() => { proceso.reiniciar(); setVarios([]); setArchA([]); setArchB([]); setPaso(0); }}>Unir otros archivos</Boton>} cuerpoClassName="flex flex-col gap-5 p-4">
          <Cifras items={[
            { rotulo: "Filas", valor: numero(r.total_filas) },
            { rotulo: "Columnas", valor: numero(r.total_columnas) },
            { rotulo: "Archivos unidos", valor: numero(r.archivos_unidos) },
          ]} />
          <div className="grid gap-6 md:grid-cols-2">
            <figure className="flex flex-col gap-3">
              <figcaption className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">Filas que aporta cada archivo</figcaption>
              <Ranking titulo="Filas por archivo" datos={r.filas_por_archivo.map((f) => ({ etiqueta: f.nombre, valor: f.filas }))} />
            </figure>
            <div className="flex flex-col gap-3">
              <p className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">Columnas del resultado</p>
              <ul className="flex flex-wrap gap-1.5">{r.columnas.map((c) => <li key={c} className="rounded-sm border border-hilo px-2 py-0.5 text-sm text-texto-2">{c}</li>)}</ul>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hilo pt-4">
            <p className="text-sm text-texto-2">CSV en UTF-16 separado por tabuladores, como los exports de Meltwater. Disponible durante una hora.</p>
            <BotonDescarga descarga={r.descarga} texto="Descargar unión" />
          </div>
        </Panel>
      )}
    </div>
  );
}
