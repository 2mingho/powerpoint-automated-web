"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useAvisos } from "@/components/ui/avisos";
import { Dialogo } from "@/components/ui/dialogo";
import { Boton } from "@/components/ui/boton";
import { Esqueleto, Vacio } from "@/components/ui/panel";
import { cx } from "@/components/ui/cx";
import { PuntoTono } from "@/components/ui/estado";
import { diaSemana, lunesDe, sumarDias } from "@/lib/tareas/fechas";
import type { TareaDTO } from "@/lib/tareas/tipos";
import { consultaDeFiltros, fechaCorta, MESES_LARGOS, pedir, tonoEstado } from "./cliente";
import { useTareas } from "./estado";

/*
 * Calendario de mes ligero, sin librerias: seis semanas de lunes a domingo.
 * Mover una tarea de dia: arrastrarla a otra celda, o con el foco en ella
 * Alt+flechas (un dia a los lados, una semana arriba y abajo).
 */

const SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function Calendario() {
  const ctx = useTareas();
  const [mes, setMes] = useState(ctx.hoy.slice(0, 7));
  const [tareas, setTareas] = useState<TareaDTO[] | null>(null);
  const [error, setError] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set());
  const { avisar } = useAvisos();
  const [porBorrar, setPorBorrar] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);

  const inicio = lunesDe(`${mes}-01`);
  const dias = useMemo(() => Array.from({ length: 42 }, (_, i) => sumarDias(inicio, i)), [inicio]);
  const fin = dias[41];

  const cargar = useCallback(() =>
    pedir<{ tareas: TareaDTO[] }>(`/api/tareas?${consultaDeFiltros(ctx.filtros, { desde: inicio, hasta: fin })}`)
      .then((r) => { setTareas(r.tareas); setError(""); })
      .catch((e: Error) => setError(e.message)), [ctx.filtros, inicio, fin]);
  useEffect(() => { void cargar(); }, [cargar, ctx.version]);

  const porDia = useMemo(() => {
    const m = new Map<string, TareaDTO[]>();
    for (const t of tareas ?? []) m.set(t.entrega, [...(m.get(t.entrega) ?? []), t]);
    return m;
  }, [tareas]);

  const mover = async (t: TareaDTO, dia: string) => {
    if (dia === t.entrega) return;
    setTareas((l) => l?.map((x) => (x.id === t.id ? { ...x, entrega: dia } : x)) ?? l);
    const r = await ctx.guardar(t.id, { due_date: dia }, { mensaje: `«${t.titulo}» pasa al ${fechaCorta(dia)}.`, version: t.actualizada });
    if (r) setTareas((l) => l?.map((x) => (x.id === r.id ? { ...x, ...r } : x)) ?? l);
    else void cargar();
  };

  /* Borrar todo lo que vence un dia: se confirma con el numero a la vista y se puede deshacer. */
  const borrarDia = async () => {
    if (!porBorrar) return;
    const dia = porBorrar;
    setBorrando(true);
    try {
      const r = await pedir<{ borradas: number; marca: string }>(`/api/tareas/dia/${dia}`, { metodo: "DELETE" });
      setPorBorrar(null);
      avisar(`Se ${r.borradas === 1 ? "borró 1 tarea" : `borraron ${r.borradas} tareas`} del ${fechaCorta(dia)}.`, {
        tipo: "exito",
        deshacer: r.borradas ? () => { void pedir(`/api/tareas/dia/${dia}/restaurar`, { cuerpo: { marca: r.marca } }).then(() => { avisar("Borrado deshecho."); void cargar(); void ctx.recargar(); }); } : undefined,
      });
      void cargar();
      void ctx.recargar();
    } catch (e) {
      avisar((e as Error).message, { tipo: "error" });
    } finally {
      setBorrando(false);
    }
  };

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const alSoltar = ({ active, over }: DragEndEvent) => {
    const t = tareas?.find((x) => x.id === active.id);
    if (t && over) void mover(t, String(over.id));
  };

  const [a, m] = mes.split("-").map(Number);
  const cambiarMes = (d: number) => {
    const fecha = new Date(Date.UTC(a, m - 1 + d, 1));
    setMes(fecha.toISOString().slice(0, 7));
  };

  if (error && !tareas) return <Vacio titulo="No se pudo cargar el calendario" accion={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>{error}</Vacio>;

  return (
    <section aria-label="Calendario" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-rotulo text-lg font-semibold uppercase tracking-[0.1em]">{MESES_LARGOS[m - 1]} <span className="font-mono cifras">{a}</span></h2>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="grid size-10 place-items-center rounded-sm hover:bg-superficie-2"><ChevronLeft aria-hidden className="size-4" /></button>
          <Boton tamano="sm" variante="secundario" onClick={() => setMes(ctx.hoy.slice(0, 7))}>Hoy</Boton>
          <button type="button" onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="grid size-10 place-items-center rounded-sm hover:bg-superficie-2"><ChevronRight aria-hidden className="size-4" /></button>
        </div>
      </div>
      <p className="sr-only">Para mover una tarea de día, enfócala y usa Alt con las flechas.</p>
      {!tareas ? <Esqueleto className="h-[480px]" /> : (
        <DndContext sensors={sensores} onDragEnd={alSoltar}>
          {/* Escritorio: rejilla de seis semanas */}
          <div role="grid" aria-label={`${MESES_LARGOS[m - 1]} ${a}`} className="hidden overflow-hidden rounded-md border border-hilo bg-superficie shadow-1 md:block">
            <div role="row" className="grid grid-cols-7 border-b border-hilo bg-superficie-2">
              {SEMANA.map((d) => <span key={d} role="columnheader" className="rotulo px-2 py-2">{d}</span>)}
            </div>
            {Array.from({ length: 6 }, (_, s) => (
              <div key={s} role="row" className="grid grid-cols-7 border-b border-hilo last:border-b-0">
                {dias.slice(s * 7, s * 7 + 7).map((d) => (
                  <Dia key={d} dia={d} fuera={d.slice(0, 7) !== mes} tareas={porDia.get(d) ?? []} abierto={abiertos.has(d)}
                    alAbrir={() => setAbiertos((x) => new Set(x).add(d))} alMover={mover} alBorrar={() => setPorBorrar(d)} />
                ))}
              </div>
            ))}
          </div>
          {/* Movil: agenda del mes */}
          <ol className="flex flex-col gap-2 md:hidden">
            {dias.filter((d) => d.slice(0, 7) === mes && porDia.has(d)).map((d) => (
              <li key={d} className="rounded-md border border-hilo bg-superficie">
                <h3 className={cx("flex items-center gap-2 border-b border-hilo px-3 py-2 font-rotulo text-sm font-semibold uppercase tracking-[0.1em]", d === ctx.hoy && "text-texto")}>
                  {SEMANA[(diaSemana(d) + 6) % 7]} <span className="font-mono cifras">{fechaCorta(d)}</span>{d === ctx.hoy && <span className="text-xs text-texto-3">hoy</span>}
                  <button type="button" onClick={() => setPorBorrar(d)} aria-label={`Borrar las ${porDia.get(d)?.length ?? 0} tareas del ${fechaCorta(d)}`}
                    className="ml-auto grid size-9 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-alerta"><Trash2 aria-hidden className="size-4" /></button>
                </h3>
                <ul className="flex flex-col gap-1 p-2">{(porDia.get(d) ?? []).map((t) => <Ficha key={t.id} t={t} alMover={mover} />)}</ul>
              </li>
            ))}
            {![...porDia.keys()].some((d) => d.slice(0, 7) === mes) && <li><Vacio titulo="Mes sin entregas">No hay tareas con entrega en este mes con los filtros actuales.</Vacio></li>}
          </ol>
        </DndContext>
      )}
      <Dialogo abierto={porBorrar !== null} onCerrar={() => setPorBorrar(null)} titulo="Borrar las tareas del día" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setPorBorrar(null)}>Cancelar</Boton><Boton variante="peligro" cargando={borrando} onClick={() => void borrarDia()}>Borrar {porBorrar ? porDia.get(porBorrar)?.length ?? 0 : 0} tareas</Boton></>}>
        {porBorrar && <p>Se borran <strong className="font-mono cifras">{porDia.get(porBorrar)?.length ?? 0}</strong> tareas que vencen el <strong>{fechaCorta(porBorrar)}</strong>, de todas las personas de tu ámbito. Podrás deshacerlo durante unos segundos.</p>}
      </Dialogo>
      {tareas && <p className="text-sm text-texto-3">Arrastra una tarea a otro día para mover su entrega. Con el teclado: Alt + flechas.</p>}
    </section>
  );
}

function Dia({ dia, fuera, tareas, abierto, alAbrir, alMover, alBorrar }: {
  dia: string; fuera: boolean; tareas: TareaDTO[]; abierto: boolean; alAbrir: () => void; alMover: (t: TareaDTO, d: string) => void; alBorrar: () => void;
}) {
  const { hoy } = useTareas();
  const { setNodeRef, isOver } = useDroppable({ id: dia });
  const finde = diaSemana(dia) === 0 || diaSemana(dia) === 6;
  const visibles = abierto ? tareas : tareas.slice(0, 3);
  return (
    <div ref={setNodeRef} role="gridcell" aria-label={`${fechaCorta(dia)}: ${tareas.length} tareas`}
      className={cx("flex min-h-28 min-w-0 flex-col gap-1 border-r border-hilo p-1.5 last:border-r-0 transition-colors duration-[var(--dur)]",
        finde && "bg-superficie-2", fuera && "opacity-55", isOver && "bg-hundida")}>
      <div className="group/dia flex items-center justify-between">
        <span className={cx("self-start rounded-sm px-1 font-mono text-xs cifras", dia === hoy ? "bg-texto font-semibold text-superficie" : "text-texto-3")}>{Number(dia.slice(8))}</span>
        {tareas.length > 0 && (
          <button type="button" onClick={alBorrar} aria-label={`Borrar las ${tareas.length} tareas del ${fechaCorta(dia)}`} title="Borrar las tareas del día"
            className="grid size-6 place-items-center rounded-sm text-texto-3 opacity-0 transition-opacity hover:text-alerta focus-visible:opacity-100 group-hover/dia:opacity-100 [@media(hover:none)]:opacity-100">
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      <ul className="flex min-w-0 flex-col gap-1">
        {visibles.map((t) => <Ficha key={t.id} t={t} alMover={alMover} />)}
      </ul>
      {!abierto && tareas.length > 3 && (
        <button type="button" onClick={alAbrir} className="self-start px-1 text-xs text-texto-2 hover:text-texto">+{tareas.length - 3} más</button>
      )}
    </div>
  );
}

function Ficha({ t, alMover }: { t: TareaDTO; alMover: (t: TareaDTO, d: string) => void }) {
  const { estados, esFinal, seleccionar, hoy } = useTareas();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id });
  const vencida = !esFinal(t.estado) && t.entrega < hoy;
  return (
    <li ref={setNodeRef} style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cx("min-w-0", isDragging && "relative z-20")}>
      <button type="button" {...listeners} {...attributes} onClick={() => seleccionar(t.id)}
        onKeyDown={(e) => {
          if (!e.altKey) return;
          const paso = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (paso) { e.preventDefault(); alMover(t, sumarDias(t.entrega, paso)); }
        }}
        aria-label={`${t.titulo}, ${t.estado}, entrega ${fechaCorta(t.entrega)}`}
        className={cx("flex w-full items-center gap-1.5 rounded-[3px] border border-hilo bg-superficie px-1.5 py-1 text-left text-xs",
          esFinal(t.estado) && "text-texto-3 line-through", vencida && "text-alerta",
          isDragging ? "shadow-3" : "hover:border-hilo-fuerte")}>
        <PuntoTono tono={tonoEstado(estados, t.estado)} className="shrink-0" /><span className="truncate">{t.titulo}</span>
      </button>
    </li>
  );
}
