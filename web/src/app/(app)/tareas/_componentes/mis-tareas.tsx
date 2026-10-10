"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, SquareCheckBig, X } from "lucide-react";
import { useAvisos } from "@/components/ui/avisos";
import { Boton } from "@/components/ui/boton";
import { Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { cx } from "@/components/ui/cx";
import { AltaRapida, BarraFiltros, Franja, Segmentos, VISTAS } from "./barra";
import { Calendario } from "./calendario";
import { pedir } from "./cliente";
import { ProveedorTareas, useTareas, type Inicial } from "./estado";
import { Herramientas } from "./herramientas";
import { NuevaTarea } from "./nueva-tarea";
import { PanelSalidas } from "./panel-salidas";
import { Pase } from "./pase";
import { Tablero } from "./tablero";

export function MisTareas({ inicial }: { inicial: Inicial }) {
  return (
    <ProveedorTareas inicial={inicial}>
      <Pantalla />
    </ProveedorTareas>
  );
}

function Pantalla() {
  const ctx = useTareas();
  const { vista, seleccionada, seleccionar, cargando, truncada } = ctx;
  const [seleccionando, setSeleccionando] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<number>>(() => new Set());
  const alMarcar = (id: number) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const salirSeleccion = () => { setSeleccionando(false); setMarcadas(new Set()); };

  /* Escape cierra el pase; el foco vuelve a la fila. */
  const ultimoFoco = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (seleccionada) ultimoFoco.current = document.activeElement as HTMLElement;
  }, [seleccionada]);
  const cerrarPase = () => {
    seleccionar(null);
    requestAnimationFrame(() => ultimoFoco.current?.focus?.());
  };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && seleccionada && !document.querySelector("dialog[open]")) cerrarPase(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Mis tareas</h1>
        <button type="button" onClick={() => void ctx.recargar()} aria-label="Actualizar la lista"
          className="grid size-9 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto">
          <RefreshCw aria-hidden className={cx("size-4", cargando && "motion-safe:animate-spin")} />
        </button>
        <Segmentos etiqueta="Vista" opciones={VISTAS} valor={vista} alElegir={ctx.setVista} />
        <div className="ml-auto flex flex-wrap items-center gap-1 sm:gap-2">
          <Herramientas />
          {vista === "panel" && (
            <Boton variante={seleccionando ? "secundario" : "fantasma"} icono={<SquareCheckBig aria-hidden className="size-4" />}
              aria-pressed={seleccionando} aria-label={seleccionando ? "Terminar la selección" : "Seleccionar varias"}
              onClick={() => (seleccionando ? salirSeleccion() : setSeleccionando(true))} className="px-2.5 sm:px-4">
              <span className="hidden sm:inline">{seleccionando ? "Terminar" : "Seleccionar"}</span>
            </Boton>
          )}
          <NuevaTarea />
        </div>
      </header>

      <Franja />

      {vista === "panel" ? (
        <div className={cx("grid items-start gap-4", seleccionada ? "lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]" : "lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]")}>
          <section aria-label="Panel de salidas" className="flex min-w-0 flex-col gap-3">
            <AltaRapida />
            <BarraFiltros />
            <div className="overflow-clip rounded-md border border-hilo bg-superficie shadow-1">
              <PanelSalidas seleccionando={seleccionando} marcadas={marcadas} alMarcar={alMarcar} />
            </div>
            {truncada && <p className="text-sm text-texto-3">Se muestran las primeras 500 tareas. Usa los filtros para acotar.</p>}
          </section>
          <ContenedorPase alCerrar={cerrarPase} />
        </div>
      ) : (
        <>
          <BarraFiltros />
          {vista === "tablero" ? <Tablero /> : <Calendario />}
          {seleccionada && <ContenedorPase alCerrar={cerrarPase} flotante />}
        </>
      )}

      {seleccionando && <BarraMasiva marcadas={[...marcadas]} alTerminar={salirSeleccion} />}
    </div>
  );
}

/*
 * El pase va a la derecha en escritorio (columna fija, pegada al scroll) y
 * como hoja inferior en movil. En tablero y calendario es siempre flotante.
 */
function ContenedorPase({ alCerrar, flotante }: { alCerrar: () => void; flotante?: boolean }) {
  const { seleccionada } = useTareas();
  if (!seleccionada) {
    return flotante ? null : (
      <aside aria-label="Pase de la tarea" className="sticky top-20 hidden rounded-md border border-dashed border-hilo-fuerte p-6 lg:block">
        <p className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">Pase de la tarea</p>
        <p className="mt-2 text-sm text-texto-3">Elige una fila para ver su entrega, prioridad, unidad y responsable, y trabajar en ella sin salir del panel.</p>
      </aside>
    );
  }
  return (
    <>
      <button type="button" aria-label="Cerrar el pase" onClick={alCerrar}
        className={cx("fixed inset-0 z-40 bg-tinta/40 motion-safe:animate-[entrada-aviso_var(--dur)_var(--curva)]", !flotante && "lg:hidden")} />
      <aside aria-label="Pase de la tarea" role="dialog" aria-modal="true"
        className={cx(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-md border border-hilo bg-superficie shadow-3 pb-[env(safe-area-inset-bottom)]",
          "motion-safe:animate-[entrada-aviso_var(--dur-vista)_var(--curva)]",
          flotante
            ? "lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[440px] lg:rounded-none lg:rounded-l-md"
            : "lg:sticky lg:top-20 lg:z-auto lg:max-h-[calc(100dvh-6rem)] lg:rounded-md lg:shadow-1 lg:animate-none",
        )}>
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-hilo-fuerte lg:hidden" />
        <Pase key={seleccionada} id={seleccionada} alCerrar={alCerrar} />
      </aside>
    </>
  );
}

function BarraMasiva({ marcadas, alTerminar }: { marcadas: number[]; alTerminar: () => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [fecha, setFecha] = useState("");
  const [borrar, setBorrar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const n = marcadas.length;

  const aplicar = async (cuerpo: Record<string, unknown>, mensaje: string, deshacer?: () => Promise<void>) => {
    setOcupado(true);
    try {
      const r = await pedir<{ afectadas: number }>("/api/tareas/masivo", { cuerpo });
      avisar(mensaje.replace("{n}", String(r.afectadas)), { tipo: "exito", deshacer: deshacer ? () => void deshacer().then(() => ctx.recargar()) : undefined });
      await ctx.recargar();
      alTerminar();
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); } finally { setOcupado(false); }
  };

  return (
    <div role="toolbar" aria-label="Acciones sobre la selección"
      className="fixed inset-x-3 bottom-20 z-30 flex flex-wrap items-center gap-2 rounded-md border border-rail-hilo bg-pizarra px-3 py-2 text-white shadow-3 md:inset-x-auto md:bottom-5 md:left-1/2 md:-translate-x-1/2">
      <span className="font-mono text-sm cifras">{n}</span><span className="text-sm text-white/75">seleccionada{n === 1 ? "" : "s"}</span>
      <Selector aria-label="Cambiar estado de la selección" disabled={!n || ocupado} defaultValue="" className="h-9 w-auto border-rail-hilo bg-rail-2 text-white"
        onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) void aplicar({ accion: "editar", task_ids: marcadas, status: v }, `Estado cambiado en {n} tareas.`); }}>
        <option value="" disabled>Cambiar estado…</option>
        {ctx.estados.map((e) => <option key={e.nombre}>{e.nombre}</option>)}
      </Selector>
      <form className="flex items-center gap-1" onSubmit={(e) => {
        e.preventDefault();
        if (!fecha) return;
        const previas = Object.fromEntries(marcadas.map((id) => [id, ctx.tareas.find((t) => t.id === id)?.entrega]).filter(([, f]) => f));
        void aplicar({ accion: "editar", due_date_map: Object.fromEntries(marcadas.map((id) => [id, fecha])) }, "Entrega movida en {n} tareas.",
          async () => { await pedir("/api/tareas/masivo", { cuerpo: { accion: "editar", due_date_map: previas } }); });
      }}>
        <Entrada type="date" aria-label="Nueva fecha de entrega" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-9 w-auto border-rail-hilo bg-rail-2 text-white" />
        <Boton type="submit" tamano="sm" variante="secundario" disabled={!n || !fecha || ocupado} className="h-9 border-white/60 text-white hover:bg-white/10">Mover</Boton>
      </form>
      <Boton tamano="sm" variante="peligro" disabled={!n || ocupado} onClick={() => setBorrar(true)} className="h-9">Borrar</Boton>
      <button type="button" onClick={alTerminar} aria-label="Salir de la selección" className="grid size-9 place-items-center text-white/70 hover:text-white"><X aria-hidden className="size-4" /></button>
      <Dialogo abierto={borrar} onCerrar={() => setBorrar(false)} titulo={`Borrar ${n} tarea${n === 1 ? "" : "s"}`} ancho="sm" pie={
        <>
          <Boton variante="fantasma" onClick={() => setBorrar(false)}>Cancelar</Boton>
          <Boton variante="peligro" onClick={() => {
            setBorrar(false);
            void aplicar({ accion: "borrar", task_ids: marcadas }, "Borradas {n} tareas.",
              async () => { await Promise.all(marcadas.map((id) => pedir(`/api/tareas/${id}/restaurar`, { cuerpo: {} }).catch(() => {}))); });
          }}>Borrar</Boton>
        </>
      }>
        <p className="text-texto-2">Desaparecen de todas las vistas. Podrás deshacerlo durante unos segundos.</p>
      </Dialogo>
    </div>
  );
}
