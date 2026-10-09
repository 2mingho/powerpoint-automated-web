"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, FileSpreadsheet, RotateCcw, Upload, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { cx } from "@/components/ui/cx";
import { ProcesoSalida, type FaseProceso } from "@/components/ui/proceso";
import { tamano, validarArchivo, type HerramientaDatos } from "@/lib/datos/limites";
import type { Situacion } from "./proceso";

export const numero = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("es-DO"));

/* ── Pasos: Archivo → Opciones → Proceso ─────────────────────────────── */

export function Pasos({ pasos, actual, alElegir }: { pasos: string[]; actual: number; alElegir?: (i: number) => void }) {
  return (
    <ol aria-label="Pasos" className="flex divide-x divide-hilo overflow-hidden rounded-md border border-hilo bg-superficie">
      {pasos.map((p, i) => {
        const hecho = i < actual;
        const activo = i === actual;
        const puede = hecho && !!alElegir;
        const contenido = (
          <>
            <span className={cx(
              "grid size-6 shrink-0 place-items-center rounded-sm font-mono text-xs cifras transition-colors duration-[var(--dur)]",
              activo ? "bg-texto text-superficie" : hecho ? "bg-hundida text-texto" : "border border-hilo text-texto-3",
            )}>
              {hecho ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cx("truncate font-rotulo text-sm font-semibold uppercase tracking-[0.1em]", activo ? "text-texto" : "hidden text-texto-3 md:inline")}>{p}</span>
          </>
        );
        return (
          <li key={p} className="min-w-0 flex-1" aria-current={activo ? "step" : undefined}>
            {puede ? (
              <button type="button" onClick={() => alElegir!(i)} className="flex h-11 w-full items-center gap-2.5 px-3 text-left hover:bg-superficie-2 md:px-4">
                {contenido}
              </button>
            ) : (
              <div className="flex h-11 items-center gap-2.5 px-3 md:px-4">{contenido}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ── Zona de archivos: arrastrar y soltar, con validacion inmediata ───── */

export function ZonaArchivos({
  herramienta, multiple, archivos, alCambiar, titulo, ayuda, compacta, detalleDe,
}: {
  /* Estado de cada archivo (p. ej. el widget reconocido), en su propia fila. */
  detalleDe?: (f: File) => { texto?: ReactNode; estado?: ReactNode } | undefined;
  herramienta: HerramientaDatos;
  multiple?: boolean;
  archivos: File[];
  alCambiar: (f: File[]) => void;
  titulo: string;
  ayuda: string;
  compacta?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);

  function anadir(lista: FileList | null) {
    if (!lista?.length) return;
    const nuevos = Array.from(lista);
    const base = multiple ? archivos.filter((a) => !nuevos.some((n) => n.name === a.name)) : [];
    const aceptados: File[] = [];
    const fallos: string[] = [];
    let acumulado = base.reduce((s, a) => s + a.size, 0);
    for (const f of multiple ? nuevos : nuevos.slice(0, 1)) {
      const e = validarArchivo(herramienta, f, acumulado);
      if (e) fallos.push(e);
      else { aceptados.push(f); acumulado += f.size; }
    }
    setErrores(fallos);
    if (aceptados.length) alCambiar([...base, ...aceptados]);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => { e.preventDefault(); setEncima(false); anadir(e.dataTransfer.files); }}
        className={cx(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 text-center",
          "transition-[background-color,border-color] duration-[var(--dur)] ease-salida",
          "focus-within:border-texto focus-within:border-solid",
          compacta ? "py-6" : "py-10",
          encima ? "border-solid border-texto bg-superficie-2" : "border-hilo-fuerte bg-superficie hover:border-texto-3 hover:bg-superficie-2",
        )}
      >
        <span className={cx("grid size-10 place-items-center rounded-sm transition-colors", encima ? "bg-texto text-superficie" : "bg-hundida text-texto-2")}>
          <Upload className="size-5" aria-hidden />
        </span>
        <span className="font-rotulo text-base font-semibold uppercase tracking-[0.08em]">{encima ? "Suelta para añadir" : titulo}</span>
        <span className="max-w-[52ch] text-sm text-texto-2">{ayuda}</span>
        <input
          ref={input} id={id} type="file" multiple={multiple} className="sr-only"
          onChange={(e) => anadir(e.target.files)}
          aria-describedby={errores.length ? `${id}-e` : undefined}
        />
      </label>
      {errores.length > 0 && (
        <ul id={`${id}-e`} role="alert" className="flex flex-col gap-1 text-sm text-alerta">
          {errores.map((e) => <li key={e} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{e}</li>)}
        </ul>
      )}
      {archivos.length > 0 && (
        <ul className="divide-y divide-hilo rounded-md border border-hilo bg-superficie">
          {archivos.map((a) => {
            const d = detalleDe?.(a);
            return (
            <li key={a.name} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
              <FileSpreadsheet className="size-4 shrink-0 text-texto-3" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{a.name}</span>
                {d?.texto && <span className="block text-xs text-texto-3">{d.texto}</span>}
              </span>
              {d?.estado}
              <span className="hidden font-mono text-xs text-texto-3 cifras md:inline">{tamano(a.size)}</span>
              <button type="button" onClick={() => alCambiar(archivos.filter((x) => x !== a))}
                aria-label={`Quitar ${a.name}`} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto">
                <X className="size-4" aria-hidden />
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Proceso: ProcesoSalida + cancelar / reintentar ─────────────────── */

export function PanelProceso({
  fases, situacion, proceso, enCola, alCancelar, alReintentar, alVolver, pie,
}: {
  fases: FaseProceso[];
  situacion: Situacion;
  proceso: { fase: string; progreso?: number; mensaje?: string; error?: string; detalle?: string[] };
  enCola?: boolean;
  alCancelar: () => void;
  alReintentar: () => void;
  alVolver: () => void;
  pie?: ReactNode;
}) {
  const enMarcha = situacion === "subiendo" || situacion === "procesando";
  const terminoMal = situacion === "fallido" || situacion === "cancelado";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-texto-2" aria-live="polite">
          {situacion === "hecho" ? "Proceso terminado." :
            situacion === "cancelado" ? "Proceso cancelado. No se guardó nada." :
              situacion === "fallido" ? "El proceso no terminó." :
                enCola ? (proceso.mensaje ?? "En cola") : "Procesando. Puedes seguir aquí: el avance es real."}
        </p>
        <div className="flex gap-2">
          {enMarcha && <Boton variante="secundario" tamano="sm" onClick={alCancelar} icono={<X className="size-3.5" aria-hidden />}>Cancelar</Boton>}
          {terminoMal && (
            <>
              <Boton variante="fantasma" tamano="sm" onClick={alVolver}>Cambiar opciones</Boton>
              <Boton variante="primario" tamano="sm" onClick={alReintentar} icono={<RotateCcw className="size-3.5" aria-hidden />}>Reintentar</Boton>
            </>
          )}
        </div>
      </div>
      <ProcesoSalida fases={fases} estado={{ ...proceso, fase: situacion === "hecho" ? "hecho" : proceso.fase }} />
      {proceso.detalle && proceso.detalle.length > 0 && terminoMal && (
        <ul className="flex flex-col gap-1 rounded-md border border-alerta/40 bg-superficie px-4 py-3 text-sm text-texto-2">
          {proceso.detalle.map((d) => <li key={d} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerta" aria-hidden />{d}</li>)}
        </ul>
      )}
      {pie}
    </div>
  );
}

/* ── Vista previa de columnas ──────────────────────────────────────── */

export function VistaPrevia({ columnas, filas, resaltar = [] }: { columnas: string[]; filas: Record<string, string>[]; resaltar?: string[] }) {
  if (!columnas.length) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-hilo" role="region" aria-label="Vista previa del archivo" tabIndex={0}>
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-superficie-2">
          <tr>
            {columnas.map((c) => (
              <th key={c} scope="col" className={cx("h-9 max-w-64 truncate border-b border-hilo px-3 text-left rotulo", resaltar.includes(c) && "text-texto")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-superficie">
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-hilo last:border-0">
              {columnas.map((c) => <td key={c} className="h-9 max-w-64 truncate px-3 text-texto-2" title={f[c]}>{f[c]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Fila de cifras (resultados) ───────────────────────────────────── */

export function Cifras({ items }: { items: { rotulo: string; valor: ReactNode; detalle?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 divide-hilo rounded-md border border-hilo bg-superficie md:flex md:divide-x">
      {items.map((it, i) => (
        <div key={it.rotulo} className={cx("flex min-w-0 flex-1 flex-col gap-1 px-4 py-3", i >= 2 && "border-t border-hilo md:border-t-0", i % 2 === 1 && "border-l border-hilo md:border-l-0")}>
          <dt className="rotulo">{it.rotulo}</dt>
          <dd className="font-mono text-2xl font-medium cifras">{it.valor}</dd>
          {it.detalle && <dd className="text-xs text-texto-3">{it.detalle}</dd>}
        </div>
      ))}
    </dl>
  );
}
