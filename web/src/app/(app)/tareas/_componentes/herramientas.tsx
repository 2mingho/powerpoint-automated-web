"use client";
import { useEffect, useState } from "react";
import { FileDown, FileUp, LayoutTemplate, Pencil, Tag, Trash2 } from "lucide-react";
import { useAvisos } from "@/components/ui/avisos";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { PuntoTono, type Tono } from "@/components/ui/estado";
import { Esqueleto } from "@/components/ui/panel";
import { ProcesoSalida, type EstadoProceso } from "@/components/ui/proceso";
import { cx } from "@/components/ui/cx";
import type { FilaVistaPrevia } from "@/lib/tareas/csv";
import type { EtiquetaDTO, PlantillaDTO, TareaDTO } from "@/lib/tareas/tipos";
import { consultaDeFiltros, pedir } from "./cliente";
import { useTareas } from "./estado";

/* Plantillas, etiquetas y CSV: lo que no se usa a diario va detras de un boton. */
export function Herramientas() {
  const [abierto, setAbierto] = useState<"" | "plantillas" | "etiquetas" | "csv">("");
  const cerrar = () => setAbierto("");
  return (
    <>
      <Boton variante="fantasma" icono={<LayoutTemplate aria-hidden className="size-4" />} onClick={() => setAbierto("plantillas")} aria-label="Plantillas" className="px-2.5 sm:px-4"><span className="hidden sm:inline">Plantillas</span></Boton>
      <Boton variante="fantasma" icono={<Tag aria-hidden className="size-4" />} onClick={() => setAbierto("etiquetas")} aria-label="Etiquetas" className="px-2.5 sm:px-4"><span className="hidden sm:inline">Etiquetas</span></Boton>
      <Boton variante="fantasma" icono={<FileDown aria-hidden className="size-4" />} onClick={() => setAbierto("csv")} aria-label="CSV" className="px-2.5 sm:px-4"><span className="hidden sm:inline">CSV</span></Boton>
      {abierto === "plantillas" && <Plantillas alCerrar={cerrar} />}
      {abierto === "etiquetas" && <Etiquetas alCerrar={cerrar} />}
      {abierto === "csv" && <Csv alCerrar={cerrar} />}
    </>
  );
}

/* ─── Plantillas ─── */
const PLANTILLA_VACIA = { nombre: "", titulo: "", descripcion: "", prioridad: "", dias: "0", checklist: "" };

function Plantillas({ alCerrar }: { alCerrar: () => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [lista, setLista] = useState<PlantillaDTO[] | null>(null);
  const [editando, setEditando] = useState<PlantillaDTO | "nueva" | null>(null);
  const [usando, setUsando] = useState<PlantillaDTO | null>(null);
  const [f, setF] = useState(PLANTILLA_VACIA);
  const [uso, setUso] = useState({ asignado: String(ctx.usuario.id), fecha: "" });
  const [error, setError] = useState("");

  const cargar = () => pedir<{ plantillas: PlantillaDTO[] }>("/api/tareas/plantillas").then((r) => setLista(r.plantillas)).catch((e) => setError(e.message));
  useEffect(() => { void cargar(); }, []);

  const editar = (p: PlantillaDTO | "nueva") => {
    setError("");
    setEditando(p);
    setF(p === "nueva" ? { ...PLANTILLA_VACIA, prioridad: ctx.prioridades.find((x) => x.esDefecto)?.nombre ?? "" }
      : { nombre: p.nombre, titulo: p.datos.title, descripcion: p.datos.description, prioridad: p.datos.priority, dias: String(p.datos.due_offset_days), checklist: p.datos.checklist.join("\n") });
  };
  const guardar = async () => {
    const cuerpo = {
      name: f.nombre,
      payload: { title: f.titulo, description: f.descripcion, priority: f.prioridad, due_offset_days: Number(f.dias || 0), checklist: f.checklist.split("\n").map((s) => s.trim()).filter(Boolean) },
    };
    try {
      if (editando === "nueva") await pedir("/api/tareas/plantillas", { cuerpo });
      else if (editando) await pedir(`/api/tareas/plantillas/${editando.id}`, { metodo: "PUT", cuerpo });
      setEditando(null);
      avisar("Plantilla guardada.", { tipo: "exito" });
      void cargar();
    } catch (e) { setError((e as Error).message); }
  };
  const borrar = async (p: PlantillaDTO) => {
    try { await pedir(`/api/tareas/plantillas/${p.id}`, { metodo: "DELETE" }); avisar(`Plantilla «${p.nombre}» borrada.`); void cargar(); }
    catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  const usar = async () => {
    if (!usando) return;
    try {
      const r = await pedir<{ tarea: TareaDTO }>(`/api/tareas/plantillas/${usando.id}/usar`, { cuerpo: { assignee_id: Number(uso.asignado), due_date: uso.fecha } });
      avisar(`Tarea creada desde «${usando.nombre}».`, { tipo: "exito" });
      ctx.fusionar(r.tarea);
      ctx.seleccionar(r.tarea.id);
      void ctx.recargar();
      alCerrar();
    } catch (e) { setError((e as Error).message); }
  };

  const titulo = usando ? `Usar «${usando.nombre}»` : editando ? (editando === "nueva" ? "Nueva plantilla" : "Editar plantilla") : "Plantillas de tarea";
  const pie = usando ? (
    <><Boton variante="fantasma" onClick={() => setUsando(null)}>Volver</Boton><Boton variante="primario" onClick={() => void usar()}>Crear tarea</Boton></>
  ) : editando ? (
    <><Boton variante="fantasma" onClick={() => setEditando(null)}>Volver</Boton><Boton variante="primario" onClick={() => void guardar()}>Guardar plantilla</Boton></>
  ) : (
    <><Boton variante="fantasma" onClick={alCerrar}>Cerrar</Boton><Boton variante="secundario" onClick={() => editar("nueva")} disabled={!ctx.usuario.unidadId}>Nueva plantilla</Boton></>
  );

  return (
    <Dialogo abierto onCerrar={alCerrar} titulo={titulo} pie={pie}>
      {error && <p role="alert" className="mb-3 text-sm text-alerta">{error}</p>}
      {usando ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-texto-2">Crea «{usando.datos.title}» con {usando.datos.checklist.length} pasos de checklist. Sin fecha, vence en {usando.datos.due_offset_days} días laborables.</p>
          <Campo etiqueta="Responsable">{(a) => (
            <Selector {...a} value={uso.asignado} onChange={(e) => setUso({ ...uso, asignado: e.target.value })}>
              {ctx.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Selector>
          )}</Campo>
          <Campo etiqueta="Entrega (opcional)">{(a) => <Entrada {...a} type="date" value={uso.fecha} onChange={(e) => setUso({ ...uso, fecha: e.target.value })} />}</Campo>
        </div>
      ) : editando ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
          <Campo etiqueta="Nombre de la plantilla">{(a) => <Entrada {...a} value={f.nombre} maxLength={100} onChange={(e) => setF({ ...f, nombre: e.target.value })} />}</Campo>
          <Campo etiqueta="Título de la tarea">{(a) => <Entrada {...a} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />}</Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Prioridad">{(a) => (
              <Selector {...a} value={f.prioridad} onChange={(e) => setF({ ...f, prioridad: e.target.value })}>
                {ctx.prioridades.map((p) => <option key={p.nombre}>{p.nombre}</option>)}
              </Selector>
            )}</Campo>
            <Campo etiqueta="Días laborables hasta la entrega" ayuda="De 0 a 90.">{(a) => <Entrada {...a} type="number" min={0} max={90} value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} />}</Campo>
          </div>
          <Campo etiqueta="Descripción">{(a) => <AreaTexto {...a} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} className="min-h-16" />}</Campo>
          <Campo etiqueta="Checklist" ayuda="Un paso por línea; máximo 30.">{(a) => <AreaTexto {...a} value={f.checklist} onChange={(e) => setF({ ...f, checklist: e.target.value })} />}</Campo>
        </form>
      ) : !lista ? <Esqueleto className="h-24" /> : (
        <ul className="divide-y divide-hilo rounded-sm border border-hilo">
          {lista.map((p) => (
            <li key={p.id} className="flex min-h-12 items-center gap-2 px-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.nombre}</p>
                <p className="truncate text-xs text-texto-3">{p.unidad} · {p.datos.checklist.length} pasos · {p.datos.due_offset_days} d</p>
              </div>
              <Boton tamano="sm" variante="secundario" onClick={() => { setError(""); setUsando(p); }}>Usar</Boton>
              <button type="button" aria-label={`Editar «${p.nombre}»`} onClick={() => editar(p)} className="grid size-9 place-items-center text-texto-3 hover:text-texto"><Pencil aria-hidden className="size-4" /></button>
              <button type="button" aria-label={`Borrar «${p.nombre}»`} onClick={() => void borrar(p)} className="grid size-9 place-items-center text-texto-3 hover:text-alerta"><Trash2 aria-hidden className="size-4" /></button>
            </li>
          ))}
          {!lista.length && <li className="p-4 text-sm text-texto-3">Tu unidad aún no tiene plantillas. Crea una para las tareas que se repiten con los mismos pasos.</li>}
        </ul>
      )}
    </Dialogo>
  );
}

/* ─── Etiquetas ─── */
const COLORES: Array<{ clave: Tono; rotulo: string }> = [
  { clave: "neutro", rotulo: "Acero" }, { clave: "info", rotulo: "Azul" }, { clave: "aviso", rotulo: "Ámbar" },
  { clave: "alerta", rotulo: "Rojo" }, { clave: "bien", rotulo: "Verde" }, { clave: "violeta", rotulo: "Violeta" },
];

function SelectorColor({ valor, alCambiar, etiqueta }: { valor: Tono; alCambiar: (t: Tono) => void; etiqueta: string }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex gap-1">
      {COLORES.map((c) => (
        <button key={c.clave} type="button" role="radio" aria-checked={valor === c.clave} aria-label={c.rotulo} onClick={() => alCambiar(c.clave)}
          className={cx("grid size-8 place-items-center rounded-sm border", valor === c.clave ? "border-texto" : "border-transparent hover:border-hilo")}>
          <PuntoTono tono={c.clave} className="size-3" />
        </button>
      ))}
    </div>
  );
}

function Etiquetas({ alCerrar }: { alCerrar: () => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState<Tono>("info");
  const [comun, setComun] = useState(false);
  const [error, setError] = useState("");
  const recargar = async () => {
    const r = await pedir<{ etiquetas: Array<EtiquetaDTO & { gestionable: boolean }> }>("/api/tareas/etiquetas");
    ctx.setEtiquetas(r.etiquetas);
  };
  const crear = async () => {
    setError("");
    try {
      await pedir("/api/tareas/etiquetas", { cuerpo: { nombre, color, comun } });
      setNombre("");
      await recargar();
    } catch (e) { setError((e as Error).message); }
  };
  const editar = async (id: number, datos: { nombre?: string; color?: Tono }) => {
    try { await pedir(`/api/tareas/etiquetas/${id}`, { metodo: "PUT", cuerpo: datos }); await recargar(); void ctx.recargar(); }
    catch (e) { avisar((e as Error).message, { tipo: "error" }); await recargar(); }
  };
  const borrar = async (id: number, n: string) => {
    try { await pedir(`/api/tareas/etiquetas/${id}`, { metodo: "DELETE" }); avisar(`Etiqueta «${n}» borrada y quitada de sus tareas.`); await recargar(); void ctx.recargar(); }
    catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  return (
    <Dialogo abierto onCerrar={alCerrar} titulo="Etiquetas" pie={<Boton variante="fantasma" onClick={alCerrar}>Cerrar</Boton>}>
      <form className="mb-4 flex flex-col gap-2 rounded-sm border border-hilo p-3" onSubmit={(e) => { e.preventDefault(); void crear(); }}>
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta="Nueva etiqueta" error={error} className="min-w-40 flex-1">{(a) => <Entrada {...a} value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} />}</Campo>
          <Boton type="submit" variante="secundario" disabled={!nombre.trim()}>Crear etiqueta</Boton>
        </div>
        <SelectorColor valor={color} alCambiar={setColor} etiqueta="Color de la etiqueta nueva" />
        {ctx.usuario.esAdmin && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={comun} onChange={(e) => setComun(e.target.checked)} className="size-4 accent-[var(--texto)]" />Común a todas las unidades</label>
        )}
      </form>
      <ul className="divide-y divide-hilo rounded-sm border border-hilo">
        {ctx.etiquetas.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            {e.gestionable ? (
              <>
                <Entrada aria-label={`Nombre de «${e.nombre}»`} defaultValue={e.nombre} maxLength={40} className="h-9 min-w-32 flex-1"
                  onBlur={(x) => x.target.value.trim() && x.target.value.trim() !== e.nombre && void editar(e.id, { nombre: x.target.value })} />
                <SelectorColor valor={e.color} alCambiar={(c) => void editar(e.id, { color: c })} etiqueta={`Color de «${e.nombre}»`} />
                <button type="button" aria-label={`Borrar «${e.nombre}»`} onClick={() => void borrar(e.id, e.nombre)} className="grid size-9 place-items-center text-texto-3 hover:text-alerta"><Trash2 aria-hidden className="size-4" /></button>
              </>
            ) : (
              <span className="flex items-center gap-2 text-sm"><PuntoTono tono={e.color} />{e.nombre}<span className="text-xs text-texto-3">común · la gestiona administración</span></span>
            )}
            {e.unidad && e.gestionable && <span className="w-full text-xs text-texto-3">{e.unidad}</span>}
          </li>
        ))}
        {!ctx.etiquetas.length && <li className="p-4 text-sm text-texto-3">Aún no hay etiquetas. Crea la primera arriba: sirven para filtrar y para ver de un vistazo de qué va cada tarea.</li>}
      </ul>
    </Dialogo>
  );
}

/* ─── CSV ─── */
type Previa = { rows: FilaVistaPrevia[]; total_rows: number; ok_rows: number; warning_rows: number; error_rows: number };
type Resultado = { total_rows: number; imported_rows: number; failed_rows: number; remaining_rows: FilaVistaPrevia[] };

function Csv({ alCerrar }: { alCerrar: () => void }) {
  const ctx = useTareas();
  const [proceso, setProceso] = useState<EstadoProceso | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<{ mensaje: string; faltan?: string[]; sobran?: string[] } | null>(null);
  const exportar = `/api/tareas/csv/exportar?${consultaDeFiltros(ctx.filtros)}`;

  const leer = async (archivo: File) => {
    setError(null); setPrevia(null); setResultado(null);
    setProceso({ fase: "subir", progreso: 30, mensaje: archivo.name });
    const form = new FormData();
    form.set("csv_file", archivo);
    try {
      setProceso({ fase: "validar" });
      const r = await pedir<Previa>("/api/tareas/csv/vista-previa", { form });
      setPrevia(r);
      setProceso(null);
    } catch (e) {
      const d = (e as { datos?: { details?: { missing_headers?: string[]; unexpected_headers?: string[] } } }).datos?.details;
      setError({ mensaje: (e as Error).message, faltan: d?.missing_headers, sobran: d?.unexpected_headers });
      setProceso(null);
    }
  };
  const importar = async () => {
    if (!previa) return;
    setProceso({ fase: "guardar" });
    try {
      const r = await pedir<Resultado>("/api/tareas/csv/importar", { cuerpo: { rows: previa.rows.map((f) => ({ row_number: f.row_number, fields: f.fields })) } });
      setResultado(r);
      setPrevia(null);
      setProceso({ fase: "hecho" });
      void ctx.recargar();
    } catch (e) { setError({ mensaje: (e as Error).message }); setProceso(null); }
  };

  const validas = previa ? previa.ok_rows + previa.warning_rows : 0;
  return (
    <Dialogo abierto onCerrar={alCerrar} titulo="Importar y exportar CSV" ancho="lg" pie={
      <>
        <Boton variante="fantasma" onClick={alCerrar}>Cerrar</Boton>
        {previa && <Boton variante="primario" disabled={!validas} onClick={() => void importar()}>Importar {validas} fila{validas === 1 ? "" : "s"} válida{validas === 1 ? "" : "s"}</Boton>}
      </>
    }>
      <div className="flex flex-col gap-4">
        <section className="flex flex-wrap items-center gap-3 rounded-sm border border-hilo p-3">
          <p className="flex-1 text-sm text-texto-2">Descarga lo que ves ahora en tu lista (con tus filtros), con las columnas del formato de importación.</p>
          <a href={exportar} download className="inline-flex h-10 items-center gap-2 rounded-sm border border-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] hover:bg-superficie-2">
            <FileDown aria-hidden className="size-4" />Exportar CSV
          </a>
        </section>
        {ctx.puedeImportar ? (
          <section className="flex flex-col gap-3">
            <label className="flex cursor-pointer flex-col items-start gap-2 rounded-sm border border-dashed border-hilo-fuerte p-4 hover:bg-superficie-2">
              <span className="flex items-center gap-2 font-rotulo text-sm font-semibold uppercase tracking-[0.1em]"><FileUp aria-hidden className="size-4" />Elegir archivo para importar</span>
              <span className="text-sm text-texto-3">Columnas: Fecha De inicio, Fecha De finalizacion, Fecha De entrega, Director o Gerencia, Cliente, Titulo, Solicitado por, Asignar a, Descripcion, Tipo de Presupuesto, Prioridad, Recurrencia.</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Archivo CSV" onChange={(e) => { const a = e.target.files?.[0]; if (a) void leer(a); e.target.value = ""; }} />
            </label>
            {proceso && (
              <ProcesoSalida fases={[{ clave: "subir", rotulo: "Subir archivo" }, { clave: "validar", rotulo: "Validar filas" }, { clave: "guardar", rotulo: "Crear tareas" }]} estado={proceso} />
            )}
            {error && (
              <div role="alert" className="rounded-sm border border-alerta/40 p-3 text-sm">
                <p className="text-alerta">{error.mensaje}</p>
                {!!error.faltan?.length && <p className="mt-1 text-texto-2">Faltan: {error.faltan.join(", ")}.</p>}
                {!!error.sobran?.length && <p className="mt-1 text-texto-2">Sobran: {error.sobran.join(", ")}.</p>}
              </div>
            )}
            {previa && <TablaPrevia filas={previa.rows} resumen={`${previa.total_rows} filas: ${previa.ok_rows} correctas, ${previa.warning_rows} con avisos, ${previa.error_rows} con errores (no se importarán).`} />}
            {resultado && (
              <div className="flex flex-col gap-2">
                <p className="text-sm"><span className="font-mono cifras">{resultado.imported_rows}</span> tareas creadas · <span className="font-mono cifras">{resultado.failed_rows}</span> filas sin importar.</p>
                {resultado.remaining_rows.length > 0 && <TablaPrevia filas={resultado.remaining_rows} resumen="Corrige estas filas en tu archivo y vuelve a importarlo." />}
              </div>
            )}
          </section>
        ) : (
          <p className="text-sm text-texto-3">Importar tareas es para quien lidera una unidad o administra. Pide a tu líder que cargue el archivo.</p>
        )}
      </div>
    </Dialogo>
  );
}

function TablaPrevia({ filas, resumen }: { filas: FilaVistaPrevia[]; resumen: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-texto-2">{resumen}</p>
      <div className="max-h-72 overflow-auto rounded-sm border border-hilo">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-superficie-2">
            <tr><th className="rotulo px-2 py-1.5 text-left">Fila</th><th className="rotulo px-2 py-1.5 text-left">Título</th><th className="rotulo px-2 py-1.5 text-left">Entrega</th><th className="rotulo px-2 py-1.5 text-left">Asignar a</th><th className="rotulo px-2 py-1.5 text-left">Resultado</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.row_number} className="border-t border-hilo align-top">
                <td className="px-2 py-1.5 font-mono cifras">{f.row_number}</td>
                <td className="px-2 py-1.5">{f.fields.title || <span className="text-texto-3">—</span>}</td>
                <td className="px-2 py-1.5 font-mono cifras">{f.parsed.due_date || f.fields.due_date}</td>
                <td className="px-2 py-1.5">{f.parsed.assignee_resolved || f.fields.assignee}</td>
                <td className="px-2 py-1.5">
                  <span className={cx("font-rotulo text-xs font-semibold uppercase tracking-[0.1em]", f.status === "error" ? "text-alerta" : f.status === "warning" ? "text-aviso" : "text-bien")}>
                    {f.status === "error" ? "Error" : f.status === "warning" ? "Aviso" : "Correcta"}
                  </span>
                  {f.issues.map((i, k) => <p key={k} className={cx("text-xs", i.severity === "error" ? "text-alerta" : "text-texto-3")}>{i.column}: {i.message}</p>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
