"use client";
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, Circle, CircleCheck, Link2, ListChecks, Lock, MessageSquare, Repeat, Square, SquareCheck } from "lucide-react";
import { CeldaEstado, PuntoTono } from "@/components/ui/estado";
import { Vacio, Esqueleto } from "@/components/ui/panel";
import { Boton } from "@/components/ui/boton";
import { cx } from "@/components/ui/cx";
import type { TareaDTO } from "@/lib/tareas/tipos";
import { fechaCorta, GRUPOS, grupoDe, ordenarTareas, relativo, tonoEstado, type Grupo } from "./cliente";
import { useTareas } from "./estado";

/*
 * Panel de salidas: ENTREGA · TAREA · UNIDAD · RESPONSABLE · ESTADO, por
 * entrega y en grupos. Cabeceras y filas son hermanas de una sola lista: asi,
 * cuando una tarea cambia de estado o de fecha, su fila se desplaza a su
 * nuevo sitio (FLIP con layout) en vez de desaparecer y reaparecer, y su
 * CeldaEstado sigue siendo la misma y se enciende.
 */

const COLUMNAS = "grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[40px_88px_minmax(0,1fr)_140px] xl:grid-cols-[40px_88px_minmax(0,1fr)_128px_136px_140px]";

export function PanelSalidas({ seleccionando, marcadas, alMarcar }: {
  seleccionando: boolean;
  marcadas: Set<number>;
  alMarcar: (id: number) => void;
}) {
  const { tareas, hoy, prioridades, esFinal, completadasSesion, cargando, error, recargar, version, filtros } = useTareas();
  const [abiertas, setAbiertas] = useState<Set<Grupo>>(() => new Set());
  const reducido = useReducedMotion();

  const grupos = useMemo(() => {
    const orden = ordenarTareas(tareas, prioridades.map((p) => p.nombre));
    const por = new Map<Grupo, TareaDTO[]>(GRUPOS.map((g) => [g.clave, []]));
    for (const t of orden) por.get(grupoDe(t, hoy, esFinal))!.push(t);
    // Completadas: las mas recientes arriba.
    por.get("completadas")!.sort((a, b) => (a.actualizada < b.actualizada ? 1 : -1));
    return por;
  }, [tareas, prioridades, hoy, esFinal]);

  if (error && !tareas.length) {
    return (
      <Vacio titulo="No se pudo cargar tu trabajo" accion={<Boton variante="secundario" onClick={() => void recargar()}>Reintentar</Boton>}>
        {error}
      </Vacio>
    );
  }
  if (cargando && version === 0 && !tareas.length) {
    return <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Esqueleto key={i} className="h-8" />)}</div>;
  }
  if (!tareas.length) {
    const conFiltro = filtros.q || filtros.filtro || filtros.prioridad || filtros.persona || filtros.cliente || filtros.etiqueta || filtros.unidad;
    return (
      <Vacio titulo={conFiltro ? "Nada coincide con estos filtros" : "No tienes salidas pendientes"}>
        {conFiltro
          ? "Quita algún filtro o cambia el alcance para ver más tareas."
          : <>Escribe arriba qué hay que hacer y pulsa Intro: <span className="font-mono text-sm">Revisar informe @persona mañana !alta</span>.</>}
      </Vacio>
    );
  }

  const filas: Array<{ tipo: "cabecera"; g: Grupo; rotulo: string; n: number } | { tipo: "fila"; t: TareaDTO }> = [];
  for (const g of GRUPOS) {
    const lista = grupos.get(g.clave)!;
    if (!lista.length) continue;
    filas.push({ tipo: "cabecera", g: g.clave, rotulo: g.rotulo, n: lista.length });
    const plegado = g.clave === "completadas" && !abiertas.has("completadas");
    for (const t of lista) if (!plegado || completadasSesion.has(t.id)) filas.push({ tipo: "fila", t });
  }

  const transicion = reducido ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <div role="table" aria-label="Panel de salidas" aria-busy={cargando || undefined} className="min-w-0">
      <div role="row" className={cx("sticky top-14 z-10 hidden h-9 items-center border-b border-hilo bg-superficie pr-3 md:grid", COLUMNAS)}>
        <span role="columnheader"><span className="sr-only">Completar</span></span>
        <span role="columnheader" className="rotulo">Entrega</span>
        <span role="columnheader" className="rotulo">Tarea</span>
        <span role="columnheader" className="rotulo hidden xl:block">Unidad</span>
        <span role="columnheader" className="rotulo hidden xl:block">Responsable</span>
        <span role="columnheader" className="rotulo">Estado</span>
      </div>
      <ul className="relative">
        {filas.map((f) =>
          f.tipo === "cabecera" ? (
            <motion.li key={`g-${f.g}`} layout="position" transition={transicion}
              className="flex h-9 items-center gap-2 border-b border-hilo bg-superficie-2 px-3">
              <h3 className={cx("font-rotulo text-xs font-semibold uppercase tracking-[0.14em]", f.g === "vencidas" ? "text-alerta" : "text-texto-2")}>{f.rotulo}</h3>
              <span className="font-mono text-xs text-texto-3 cifras">{f.n}</span>
              {f.g === "completadas" && (
                <button type="button" aria-expanded={abiertas.has("completadas")}
                  onClick={() => setAbiertas((s) => { const n = new Set(s); if (n.has("completadas")) n.delete("completadas"); else n.add("completadas"); return n; })}
                  className="ml-auto inline-flex h-8 items-center gap-1 rounded-sm px-2 font-rotulo text-xs font-semibold uppercase tracking-[0.1em] text-texto-2 hover:bg-superficie hover:text-texto">
                  {abiertas.has("completadas") ? "Plegar" : "Ver todas"}
                  <ChevronDown aria-hidden className={cx("size-3.5 transition-transform duration-[var(--dur)]", abiertas.has("completadas") && "rotate-180")} />
                </button>
              )}
            </motion.li>
          ) : (
            <Fila key={f.t.id} t={f.t} transicion={transicion} seleccionando={seleccionando} marcada={marcadas.has(f.t.id)} alMarcar={alMarcar} />
          ),
        )}
      </ul>
    </div>
  );
}

function Fila({ t, transicion, seleccionando, marcada, alMarcar }: {
  t: TareaDTO;
  transicion: object;
  seleccionando: boolean;
  marcada: boolean;
  alMarcar: (id: number) => void;
}) {
  const { hoy, estados, esFinal, completar, seleccionar, seleccionada } = useTareas();
  const hecha = esFinal(t.estado);
  const vencida = !hecha && t.entrega < hoy;
  const activa = seleccionada === t.id;

  return (
    <motion.li layout="position" transition={transicion} role="row" data-tarea={t.id} aria-selected={activa}
      onClick={() => (seleccionando ? alMarcar(t.id) : seleccionar(t.id))}
      className={cx(
        "group grid min-h-11 cursor-pointer items-center border-b border-hilo bg-superficie pr-3 transition-colors duration-[var(--dur)]",
        COLUMNAS,
        activa ? "bg-hundida" : "hover:bg-superficie-2",
      )}>
      <span role="cell" className="flex justify-center">
        {seleccionando ? (
          <button type="button" aria-pressed={marcada} aria-label={`${marcada ? "Quitar" : "Añadir"} «${t.titulo}» de la selección`}
            onClick={(e) => { e.stopPropagation(); alMarcar(t.id); }}
            className="grid size-10 place-items-center text-texto-2 hover:text-texto">
            {marcada ? <SquareCheck aria-hidden className="size-[18px] text-texto" /> : <Square aria-hidden className="size-[18px]" />}
          </button>
        ) : (
          <button type="button" aria-label={hecha ? `Reabrir «${t.titulo}»` : `Completar «${t.titulo}»`}
            onClick={(e) => { e.stopPropagation(); completar(t.id); }}
            className={cx("grid size-10 place-items-center rounded-sm transition-colors", hecha ? "text-bien" : "text-texto-3 hover:text-bien")}>
            {hecha ? <CircleCheck aria-hidden className="size-[18px]" /> : <Circle aria-hidden className="size-[18px]" />}
          </button>
        )}
      </span>
      <span role="cell" className="hidden flex-col leading-tight md:flex">
        <span className={cx("font-mono text-sm font-medium leading-5 cifras", vencida ? "text-alerta" : "text-texto")}>{fechaCorta(t.entrega)}</span>
        <span className={cx("text-xs leading-4", vencida ? "text-alerta" : "text-texto-3")}>{relativo(t.entrega, hoy)}</span>
      </span>
      <span role="cell" className="min-w-0 py-1">
        <button type="button" onClick={(e) => { e.stopPropagation(); if (seleccionando) alMarcar(t.id); else seleccionar(t.id); }}
          className={cx("block max-w-full truncate text-left text-sm font-medium leading-5", hecha ? "text-texto-3 line-through decoration-texto-3/60" : "text-texto")}>
          {t.titulo}
        </button>
        <Meta t={t} vencida={vencida} />
      </span>
      <span role="cell" className="hidden truncate text-sm text-texto-2 xl:block">{t.unidad}</span>
      <span role="cell" className="hidden truncate text-sm text-texto-2 xl:block">{t.asignado}</span>
      <span role="cell" className="flex justify-end md:justify-start">
        <CeldaEstado texto={t.estado} tono={tonoEstado(estados, t.estado)} cambio={`${t.estado}|${t.entrega}|${t.actualizada}`} className="max-w-full truncate" />
      </span>
    </motion.li>
  );
}

function Meta({ t, vencida }: { t: TareaDTO; vencida: boolean }) {
  const { hoy } = useTareas();
  return (
    <span className="flex min-w-0 items-center gap-2.5 text-xs leading-4 text-texto-3">
      {/* En movil la entrega y el responsable van aqui; en escritorio tienen columna. */}
      <span className={cx("font-mono cifras md:hidden", vencida && "text-alerta")}>{fechaCorta(t.entrega)} · {relativo(t.entrega, hoy)}</span>
      <span className="truncate md:hidden">{t.asignado}</span>
      {t.cliente && <span className="hidden truncate md:inline">{t.cliente}</span>}
      {t.bloqueadaPorAbiertas > 0 && (
        <span className="inline-flex items-center gap-1 text-alerta" title="Espera a otras tareas abiertas">
          <Lock aria-hidden className="size-3" />Bloqueada
        </span>
      )}
      {t.bloqueaA > 0 && <span className="hidden items-center gap-1 md:inline-flex" title={`Otras ${t.bloqueaA} esperan por esta`}><Link2 aria-hidden className="size-3" /><span className="font-mono cifras">{t.bloqueaA}</span></span>}
      {t.checklistTotal > 0 && (
        <span className="inline-flex items-center gap-1"><ListChecks aria-hidden className="size-3" /><span className="font-mono cifras">{t.checklistHechos}/{t.checklistTotal}</span></span>
      )}
      {t.comentarios > 0 && <span className="inline-flex items-center gap-1"><MessageSquare aria-hidden className="size-3" /><span className="font-mono cifras">{t.comentarios}</span><span className="sr-only">comentarios</span></span>}
      {t.recurrente && <Repeat aria-label="Recurrente" className="size-3" />}
      {t.etiquetas.slice(0, 3).map((e) => (
        <span key={e.id} className="hidden items-center gap-1 lg:inline-flex"><PuntoTono tono={e.color} />{e.nombre}</span>
      ))}
    </span>
  );
}
