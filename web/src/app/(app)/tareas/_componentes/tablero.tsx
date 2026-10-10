"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Lock } from "lucide-react";
import { useAvisos } from "@/components/ui/avisos";
import { Boton } from "@/components/ui/boton";
import { PuntoTono } from "@/components/ui/estado";
import { Esqueleto, Vacio } from "@/components/ui/panel";
import { cx } from "@/components/ui/cx";
import type { TareaDTO } from "@/lib/tareas/tipos";
import { consultaDeFiltros, ErrorPeticion, fechaCorta, pedir, relativo } from "./cliente";
import { useTareas } from "./estado";

/*
 * Tablero: una columna por estado del catalogo. Arrastrar con raton, dedo o
 * teclado (espacio para coger, flechas para mover, espacio para soltar).
 * Reordenar dentro de la columna no cuenta como edicion; cambiar de columna
 * si, y si otra persona cambio la tarea entretanto el servidor responde 409.
 */

type Columnas = Record<string, TareaDTO[]>;
const COL = "col:";

export function Tablero() {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [columnas, setColumnas] = useState<Columnas | null>(null);
  const [error, setError] = useState("");
  const [dias, setDias] = useState(14);
  const [activa, setActiva] = useState<TareaDTO | null>(null);
  const origen = useRef<{ estado: string; columnas: Columnas } | null>(null);

  const cargar = useCallback(() =>
    pedir<{ tareas: TareaDTO[]; truncada: boolean }>(`/api/tareas/tablero?${consultaDeFiltros(ctx.filtros, { cerradas_dias: String(dias) })}`)
      .then((r) => {
        const c: Columnas = Object.fromEntries(ctx.estados.map((e) => [e.nombre, []]));
        for (const t of r.tareas) (c[t.estado] ??= []).push(t);
        setColumnas(c);
        setError("");
      })
      .catch((e: Error) => setError(e.message)), [ctx.filtros, ctx.estados, dias]);

  useEffect(() => { void cargar(); }, [cargar, ctx.version]);

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnaDe = (id: string | number, c: Columnas) => {
    if (typeof id === "string" && id.startsWith(COL)) return id.slice(COL.length);
    return Object.keys(c).find((k) => c[k].some((t) => t.id === id));
  };

  const titulo = (id: string | number) => {
    if (typeof id === "string" && id.startsWith(COL)) return `la columna ${id.slice(COL.length)}`;
    return `«${columnas && Object.values(columnas).flat().find((t) => t.id === id)?.titulo}»`;
  };
  const anuncios: Announcements = {
    onDragStart: ({ active }) => `Has cogido ${titulo(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${titulo(active.id)} está sobre ${titulo(over.id)}.` : `${titulo(active.id)} ya no está sobre una columna.`),
    onDragEnd: ({ active, over }) => (over ? `${titulo(active.id)} se soltó en ${titulo(over.id)}.` : `${titulo(active.id)} se soltó.`),
    onDragCancel: ({ active }) => `Movimiento cancelado. ${titulo(active.id)} vuelve a su sitio.`,
  };

  const alEmpezar = ({ active }: DragStartEvent) => {
    if (!columnas) return;
    const est = columnaDe(active.id, columnas)!;
    origen.current = { estado: est, columnas };
    setActiva(columnas[est].find((t) => t.id === active.id) ?? null);
  };

  /* Entre columnas la tarjeta se mueve en vivo para que se vea donde caera. */
  const alPasar = ({ active, over }: DragOverEvent) => {
    if (!over || !columnas) return;
    const de = columnaDe(active.id, columnas);
    const a = columnaDe(over.id, columnas);
    if (!de || !a || de === a) return;
    setColumnas((c) => {
      if (!c) return c;
      const tarjeta = c[de].find((t) => t.id === active.id)!;
      const destino = c[a].filter((t) => t.id !== active.id);
      const i = typeof over.id === "number" ? destino.findIndex((t) => t.id === over.id) : destino.length;
      destino.splice(i < 0 ? destino.length : i, 0, tarjeta);
      return { ...c, [de]: c[de].filter((t) => t.id !== active.id), [a]: destino };
    });
  };

  const alSoltar = async ({ active, over }: DragEndEvent) => {
    setActiva(null);
    const inicio = origen.current;
    origen.current = null;
    if (!over || !columnas || !inicio) { if (inicio) setColumnas(inicio.columnas); return; }
    const estado = columnaDe(active.id, columnas)!;
    let lista = columnas[estado];
    const desde = lista.findIndex((t) => t.id === active.id);
    let hasta = typeof over.id === "number" ? lista.findIndex((t) => t.id === over.id) : lista.length - 1;
    if (hasta < 0) hasta = desde;
    if (desde !== hasta) {
      lista = [...lista];
      const [x] = lista.splice(desde, 1);
      lista.splice(hasta, 0, x);
    }
    const i = lista.findIndex((t) => t.id === active.id);
    const tarea = lista[i];
    if (estado === inicio.estado && i === inicio.columnas[estado].findIndex((t) => t.id === active.id)) { setColumnas(inicio.columnas); return; }
    setColumnas({ ...columnas, [estado]: lista });
    try {
      const r = await pedir<{ tarea: TareaDTO; aviso: string; siguiente?: { id: number; entrega: string } | null }>(`/api/tareas/${tarea.id}/mover`, {
        cuerpo: { status: estado, anterior_id: lista[i - 1]?.id ?? null, siguiente_id: lista[i + 1]?.id ?? null, expected_updated_at: tarea.actualizada },
      });
      setColumnas((c) => (c ? { ...c, [estado]: c[estado].map((t) => (t.id === r.tarea.id ? r.tarea : t)) } : c));
      ctx.fusionar(r.tarea);
      if (estado !== inicio.estado) {
        avisar(r.aviso || `«${tarea.titulo}» pasa a ${estado}.`, r.aviso ? { tipo: "error" } : {
          tipo: "exito",
          deshacer: () => void pedir(`/api/tareas/${tarea.id}/mover`, { cuerpo: { status: inicio.estado, expected_updated_at: r.tarea.actualizada } }).then(() => { void cargar(); void ctx.recargar(); }),
        });
        void ctx.recargar();
        if (r.siguiente) {
          avisar(`Se creó la siguiente de la serie, para el ${fechaCorta(r.siguiente.entrega)}.`, { tipo: "exito" });
          void cargar();
        }
      }
    } catch (e) {
      setColumnas(inicio.columnas);
      if (e instanceof ErrorPeticion && e.status === 409) {
        avisar("Otra persona cambió esta tarea antes. El tablero ya muestra su versión.", { tipo: "error" });
        void cargar();
      } else avisar((e as Error).message, { tipo: "error" });
    }
  };

  if (error && !columnas) return <Vacio titulo="No se pudo cargar el tablero" accion={<Boton onClick={() => void cargar()}>Reintentar</Boton>}>{error}</Vacio>;
  if (!columnas) {
    return <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">{ctx.estados.map((e) => <Esqueleto key={e.nombre} className="h-64" />)}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      <DndContext sensors={sensores} collisionDetection={closestCorners} onDragStart={alEmpezar} onDragOver={alPasar} onDragEnd={(e) => void alSoltar(e)}
        onDragCancel={() => { if (origen.current) setColumnas(origen.current.columnas); origen.current = null; setActiva(null); }}
        accessibility={{ announcements: anuncios, screenReaderInstructions: { draggable: "Pulsa espacio para coger la tarjeta. Muévela con las flechas y pulsa espacio para soltarla, o Escape para cancelar." } }}>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
          {ctx.estados.map((e) => (
            <Columna key={e.nombre} nombre={e.nombre} tono={e.color} final={e.esFinal} tareas={columnas[e.nombre] ?? []} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
          {activa ? <Tarjeta t={activa} flotando /> : null}
        </DragOverlay>
      </DndContext>
      <p className="text-sm text-texto-3">
        Las columnas finales muestran lo cerrado en los últimos <span className="font-mono cifras">{dias}</span> días.{" "}
        {dias < 90 && <button type="button" onClick={() => setDias(90)} className="underline hover:text-texto">Ver 90 días</button>}
      </p>
    </div>
  );
}

function Columna({ nombre, tono, final, tareas }: { nombre: string; tono: TareaDTO["etiquetas"][number]["color"]; final: boolean; tareas: TareaDTO[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COL}${nombre}` });
  const ids = useMemo(() => tareas.map((t) => t.id), [tareas]);
  return (
    <section aria-label={`${nombre}: ${tareas.length} tareas`} className="flex w-[82vw] shrink-0 snap-start flex-col rounded-md border border-hilo bg-superficie-2 sm:w-72 xl:w-auto xl:flex-1">
      <header className="flex h-11 items-center gap-2 border-b border-hilo px-3">
        <PuntoTono tono={tono} />
        <h3 className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em]">{nombre}</h3>
        <span className="ml-auto font-mono text-xs text-texto-3 cifras">{tareas.length}</span>
      </header>
      <SortableContext id={nombre} items={ids} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className={cx("flex min-h-32 flex-1 flex-col gap-2 p-2 transition-colors duration-[var(--dur)]", isOver && "bg-hundida")}>
          {tareas.map((t) => <TarjetaOrdenable key={t.id} t={t} />)}
          {!tareas.length && <li className="px-2 py-6 text-center text-sm text-texto-3">{final ? "Suelta aquí lo terminado." : "Sin tareas en este estado."}</li>}
        </ul>
      </SortableContext>
    </section>
  );
}

function TarjetaOrdenable({ t }: { t: TareaDTO }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
      aria-roledescription="tarjeta arrastrable" className={cx("touch-manipulation rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-texto", isDragging && "opacity-40")}>
      <Tarjeta t={t} />
    </li>
  );
}

function Tarjeta({ t, flotando }: { t: TareaDTO; flotando?: boolean }) {
  const { hoy, esFinal, seleccionar, seleccionada } = useTareas();
  const vencida = !esFinal(t.estado) && t.entrega < hoy;
  return (
    <div onClick={() => seleccionar(t.id)}
      className={cx("flex cursor-grab flex-col gap-1.5 rounded-sm border bg-superficie p-2.5 active:cursor-grabbing",
        flotando ? "border-texto shadow-3" : "border-hilo shadow-1 hover:border-hilo-fuerte", seleccionada === t.id && "border-texto")}>
      <p className={cx("text-sm font-medium leading-snug", esFinal(t.estado) && "text-texto-3 line-through")}>{t.titulo}</p>
      <div className="flex items-center gap-2 text-xs text-texto-3">
        <span className={cx("font-mono cifras", vencida && "text-alerta")}>{fechaCorta(t.entrega)}</span>
        <span className={cx(vencida && "text-alerta")}>{relativo(t.entrega, hoy)}</span>
        <span className="ml-auto truncate">{t.asignado}</span>
      </div>
      {(t.etiquetas.length > 0 || t.bloqueadaPorAbiertas > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
          {t.bloqueadaPorAbiertas > 0 && <span className="inline-flex items-center gap-1 text-alerta"><Lock aria-hidden className="size-3" />Bloqueada</span>}
          {t.etiquetas.slice(0, 3).map((e) => <span key={e.id} className="inline-flex items-center gap-1"><PuntoTono tono={e.color} />{e.nombre}</span>)}
        </div>
      )}
    </div>
  );
}
