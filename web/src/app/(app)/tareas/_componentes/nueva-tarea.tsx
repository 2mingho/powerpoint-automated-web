"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAvisos } from "@/components/ui/avisos";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { esFinDeSemana, generarFechasRecurrencia } from "@/lib/tareas/fechas";
import type { TareaDTO } from "@/lib/tareas/tipos";
import { pedir } from "./cliente";
import { useTareas } from "./estado";

/*
 * "Nueva tarea": lo esencial arriba (titulo, responsable, entrega, prioridad)
 * y lo ocasional plegado (cliente, direccion, presupuesto, fechas,
 * recurrencia). El boton es negro y al confirmarse se vuelve amarillo.
 */
export function NuevaTarea() {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [abierto, setAbierto] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const vacio = () => ({
    title: "", assignee_id: String(ctx.usuario.id), due_date: ctx.hoy, priority: ctx.prioridades.find((p) => p.esDefecto)?.nombre ?? "Media",
    status: ctx.estadoInicial, description: "", client: "", directorate: "", requested_by: "", budget_type: "", start_date: "", end_date: "",
    is_recurrent: false, recurrence_type: "Semanal", recurrence_end: "",
  });
  const [f, setF] = useState(vacio);
  const set = (k: keyof ReturnType<typeof vacio>, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const serie = f.is_recurrent && f.recurrence_end && f.due_date ? generarFechasRecurrencia(f.due_date, f.recurrence_type, f.recurrence_end).length : 0;

  const validar = () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = "Escribe qué hay que hacer.";
    if (!f.due_date) e.due_date = "La fecha de entrega es obligatoria.";
    if (f.start_date && f.end_date && f.end_date < f.start_date) e.end_date = "No puede ser anterior al inicio.";
    if (f.is_recurrent) {
      if (esFinDeSemana(f.due_date)) e.due_date = "Una serie no puede empezar en sábado o domingo.";
      if (!f.recurrence_end) e.recurrence_end = "Indica hasta cuándo se repite.";
      else if (f.recurrence_end < f.due_date) e.recurrence_end = "Debe ser posterior a la primera entrega.";
      else if (serie > 365) e.recurrence_end = `Generaría ${serie} tareas; el máximo es 365.`;
    }
    setErrores(e);
    return !Object.keys(e).length;
  };

  const crear = async () => {
    if (!validar()) return;
    setEnviando(true);
    try {
      const r = await pedir<{ tarea: TareaDTO; cuantas: number }>("/api/tareas", { cuerpo: { ...f, assignee_id: Number(f.assignee_id) } });
      setAbierto(false);
      setF(vacio());
      setConfirmado(true);
      setTimeout(() => setConfirmado(false), 1600);
      avisar(r.cuantas > 1 ? `Serie creada: ${r.cuantas} tareas.` : `Tarea creada: «${r.tarea.titulo}»`, { tipo: "exito" });
      ctx.fusionar(r.tarea);
      ctx.seleccionar(r.tarea.id);
      void ctx.recargar();
    } catch (e) {
      setErrores({ general: (e as Error).message });
    } finally { setEnviando(false); }
  };

  return (
    <>
      <Boton variante="primario" confirmado={confirmado} icono={<Plus aria-hidden className="size-4" />} onClick={() => { setErrores({}); setAbierto(true); }}>
        {confirmado ? "Creada" : "Nueva tarea"}
      </Boton>
      <Dialogo abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Nueva tarea" pie={
        <>
          <Boton variante="fantasma" onClick={() => setAbierto(false)}>Cancelar</Boton>
          <Boton variante="primario" cargando={enviando} onClick={() => void crear()}>{f.is_recurrent && serie > 1 ? `Crear ${serie} tareas` : "Crear tarea"}</Boton>
        </>
      }>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void crear(); }}>
          {errores.general && <p role="alert" className="text-sm text-alerta">{errores.general}</p>}
          <Campo etiqueta="Qué hay que hacer" error={errores.title}>
            {(a) => <Entrada {...a} autoFocus value={f.title} maxLength={255} onChange={(e) => set("title", e.target.value)} />}
          </Campo>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Campo etiqueta="Responsable">
              {(a) => (
                <Selector {...a} value={f.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
                  {ctx.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.id === ctx.usuario.id ? " (tú)" : ""}</option>)}
                </Selector>
              )}
            </Campo>
            <Campo etiqueta="Entrega" error={errores.due_date}>
              {(a) => <Entrada {...a} type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />}
            </Campo>
            <Campo etiqueta="Prioridad">
              {(a) => (
                <Selector {...a} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
                  {ctx.prioridades.map((p) => <option key={p.nombre}>{p.nombre}</option>)}
                </Selector>
              )}
            </Campo>
          </div>
          <Campo etiqueta="Descripción">
            {(a) => <AreaTexto {...a} value={f.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" />}
          </Campo>
          <details className="rounded-sm border border-hilo px-3 py-2">
            <summary className="cursor-pointer rotulo">Más datos: cliente, dirección, presupuesto, fechas</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo etiqueta="Cliente">{(a) => <Entrada {...a} list="clientes-nueva" value={f.client} maxLength={100} onChange={(e) => set("client", e.target.value)} />}</Campo>
              <datalist id="clientes-nueva">{ctx.clientes.map((c) => <option key={c} value={c} />)}</datalist>
              <Campo etiqueta="Dirección o gerencia">{(a) => <Entrada {...a} value={f.directorate} onChange={(e) => set("directorate", e.target.value)} />}</Campo>
              <Campo etiqueta="Solicitado por">{(a) => <Entrada {...a} value={f.requested_by} onChange={(e) => set("requested_by", e.target.value)} />}</Campo>
              <Campo etiqueta="Tipo de presupuesto">{(a) => <Entrada {...a} value={f.budget_type} onChange={(e) => set("budget_type", e.target.value)} />}</Campo>
              <Campo etiqueta="Inicio">{(a) => <Entrada {...a} type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />}</Campo>
              <Campo etiqueta="Finalización" error={errores.end_date}>{(a) => <Entrada {...a} type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} />}</Campo>
            </div>
          </details>
          <details className="rounded-sm border border-hilo px-3 py-2" open={f.is_recurrent}>
            <summary className="cursor-pointer rotulo">Repetir</summary>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.is_recurrent} onChange={(e) => set("is_recurrent", e.target.checked)} className="size-4 accent-[var(--texto)]" />
                Crear una serie (solo días laborables)
              </label>
              {f.is_recurrent && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Frecuencia">
                    {(a) => (
                      <Selector {...a} value={f.recurrence_type} onChange={(e) => set("recurrence_type", e.target.value)}>
                        <option>Diaria</option><option>Semanal</option><option>Mensual</option>
                      </Selector>
                    )}
                  </Campo>
                  <Campo etiqueta="Hasta" error={errores.recurrence_end} ayuda={serie ? `${serie} tarea${serie === 1 ? "" : "s"} en la serie.` : undefined}>
                    {(a) => <Entrada {...a} type="date" value={f.recurrence_end} onChange={(e) => set("recurrence_end", e.target.value)} />}
                  </Campo>
                </div>
              )}
            </div>
          </details>
        </form>
      </Dialogo>
    </>
  );
}
