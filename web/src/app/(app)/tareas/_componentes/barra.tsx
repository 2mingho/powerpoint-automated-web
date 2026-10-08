"use client";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Columns3, ListFilter, Rows3, Search, X } from "lucide-react";
import { Contador } from "@/components/ui/contador";
import { Entrada, Selector } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { interpretarAlta } from "@/lib/tareas/alta-rapida";
import type { Alcance, FiltroRapido } from "@/lib/tareas/tipos";
import { fechaCorta, relativo } from "./cliente";
import { useTareas, type Vista } from "./estado";
import { useAvisos } from "@/components/ui/avisos";
import { pedir } from "./cliente";
import type { TareaDTO } from "@/lib/tareas/tipos";

/* Franja de salidas: cuatro contadores que filtran al pulsarlos. */
export function Franja() {
  const { contadores, filtros, setFiltros } = useTareas();
  const elegir = (f: FiltroRapido) => setFiltros({ filtro: filtros.filtro === f ? "" : f });
  return (
    <div role="group" aria-label="Salidas" className="grid grid-cols-2 divide-hilo overflow-hidden rounded-md border border-hilo bg-superficie shadow-1 md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-hilo md:[&>*:nth-child(-n+2)]:border-b-0 [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-hilo md:[&>*:nth-child(odd)]:border-r-0">
      <Contador rotulo="Vencidas" valor={contadores.vencidas} tono="alerta" activo={filtros.filtro === "vencidas"} onClick={() => elegir("vencidas")} />
      <Contador rotulo="Hoy" valor={contadores.hoy} tono="aviso" activo={filtros.filtro === "hoy"} onClick={() => elegir("hoy")} />
      <Contador rotulo="En curso" valor={contadores.enCurso} tono="info" activo={filtros.filtro === "en_curso"} onClick={() => elegir("en_curso")} />
      <Contador rotulo="Bloqueadas" valor={contadores.bloqueadas} tono="violeta" activo={filtros.filtro === "bloqueadas"} onClick={() => elegir("bloqueadas")} detalle="por dependencias abiertas" />
    </div>
  );
}

const ALCANCES: Array<{ clave: Alcance; rotulo: string }> = [
  { clave: "mias", rotulo: "Asignadas a mí" },
  { clave: "creadas", rotulo: "Creadas por mí" },
  { clave: "unidad", rotulo: "Mi unidad" },
];

export const VISTAS: Array<{ clave: Vista; rotulo: string; icono: React.ReactNode }> = [
  { clave: "panel", rotulo: "Panel", icono: <Rows3 aria-hidden className="size-4" /> },
  { clave: "tablero", rotulo: "Tablero", icono: <Columns3 aria-hidden className="size-4" /> },
  { clave: "calendario", rotulo: "Calendario", icono: <CalendarDays aria-hidden className="size-4" /> },
];

export function Segmentos<T extends string>({ opciones, valor, alElegir, etiqueta }: {
  opciones: Array<{ clave: T; rotulo: string; icono?: React.ReactNode }>;
  valor: T;
  alElegir: (v: T) => void;
  etiqueta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex shrink-0 rounded-sm border border-hilo bg-superficie p-0.5">
      {opciones.map((o) => (
        <button key={o.clave} type="button" role="radio" aria-checked={valor === o.clave} onClick={() => alElegir(o.clave)}
          className={cx("inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[3px] px-3 text-sm transition-colors duration-[var(--dur)]",
            valor === o.clave ? "bg-texto font-semibold text-superficie" : "text-texto-2 hover:text-texto")}>
          {o.icono}<span className={cx(!!o.icono && "sr-only sm:not-sr-only")}>{o.rotulo}</span>
        </button>
      ))}
    </div>
  );
}

/* Alcance, busqueda, vista y filtros plegados. */
export function BarraFiltros() {
  const { filtros, setFiltros, prioridades, personas, clientes, etiquetas, unidades, usuario } = useTareas();
  const [q, setQ] = useState(filtros.q);
  useEffect(() => {
    const t = setTimeout(() => { if (q !== filtros.q && (q.length === 0 || q.length >= 2)) setFiltros({ q }); }, 300);
    return () => clearTimeout(t);
  }, [q, filtros.q, setFiltros]);
  const activos = [filtros.prioridad, filtros.persona, filtros.cliente, filtros.etiqueta, filtros.unidad].filter(Boolean).length;
  const [abierto, setAbierto] = useState(activos > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-4 flex max-w-[100vw] overflow-x-auto px-4 md:mx-0 md:px-0">
          <Segmentos etiqueta="Alcance" opciones={ALCANCES} valor={filtros.alcance} alElegir={(a) => setFiltros({ alcance: a })} />
        </div>
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Buscar tareas</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-3" />
          <Entrada type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, descripción o cliente" className="pl-9" />
        </label>
        <button type="button" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}
          className={cx("inline-flex h-10 items-center gap-2 rounded-sm border px-3 text-sm", activos ? "border-texto text-texto" : "border-hilo text-texto-2 hover:text-texto")}>
          <ListFilter aria-hidden className="size-4" />Filtros{activos > 0 && <span className="font-mono text-xs cifras">{activos}</span>}
        </button>
      </div>
      {abierto && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Selector aria-label="Prioridad" value={filtros.prioridad} onChange={(e) => setFiltros({ prioridad: e.target.value })}>
            <option value="">Toda prioridad</option>
            {prioridades.map((p) => <option key={p.nombre}>{p.nombre}</option>)}
          </Selector>
          <Selector aria-label="Persona" value={filtros.persona} onChange={(e) => setFiltros({ persona: e.target.value })}>
            <option value="">Toda persona</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Selector>
          <Selector aria-label="Cliente" value={filtros.cliente} onChange={(e) => setFiltros({ cliente: e.target.value })}>
            <option value="">Todo cliente</option>
            {clientes.map((c) => <option key={c}>{c}</option>)}
          </Selector>
          <Selector aria-label="Etiqueta" value={filtros.etiqueta} onChange={(e) => setFiltros({ etiqueta: e.target.value })}>
            <option value="">Toda etiqueta</option>
            {etiquetas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </Selector>
          {usuario.esAdmin && (
            <Selector aria-label="Unidad" value={filtros.unidad} onChange={(e) => setFiltros({ unidad: e.target.value })}>
              <option value="">Toda unidad</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Selector>
          )}
          <label className="flex h-10 items-center gap-2 rounded-sm border border-hilo px-3 text-sm">
            <input type="checkbox" checked={filtros.filtro === "vencidas"} onChange={(e) => setFiltros({ filtro: e.target.checked ? "vencidas" : "" })} className="size-4 accent-[var(--texto)]" />
            Solo vencidas
          </label>
          {activos > 0 && (
            <button type="button" onClick={() => setFiltros({ prioridad: "", persona: "", cliente: "", etiqueta: "", unidad: "" })}
              className="inline-flex h-10 items-center gap-1 px-2 text-sm text-texto-2 hover:text-texto"><X aria-hidden className="size-4" />Quitar filtros</button>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * Alta rapida, como en la bandeja de Flask: una linea con @persona, una fecha
 * al final (hoy, mañana, lunes…) y !prioridad. La vista previa dice que se va
 * a crear antes de pulsar Intro.
 */
export function AltaRapida() {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const alta = useMemo(() => {
    const nombres = ctx.personas.map((p) => ({ id: p.id, nombre: p.nombre }));
    if (!nombres.some((p) => p.id === ctx.usuario.id)) nombres.push({ id: ctx.usuario.id, nombre: ctx.usuario.nombre });
    return interpretarAlta(texto, {
      hoy: ctx.hoy, miId: ctx.usuario.id, personas: nombres,
      prioridades: ctx.prioridades.map((p) => p.nombre), prioridadDefecto: ctx.prioridades.find((p) => p.esDefecto)?.nombre ?? "Media",
    });
  }, [texto, ctx.personas, ctx.usuario, ctx.hoy, ctx.prioridades]);

  const persona = alta.asignado === ctx.usuario.id ? "para ti" : `para ${ctx.personas.find((p) => p.id === alta.asignado)?.nombre ?? ""}`;
  const vista = !texto.trim() ? "" : alta.problema ? alta.problema : !alta.titulo ? "Falta el título: escribe qué hay que hacer."
    : `Se creará «${alta.titulo}» · ${persona} · ${relativo(alta.fecha, ctx.hoy)} (${fechaCorta(alta.fecha)}) · prioridad ${alta.prioridad}`;

  const crear = async () => {
    if (alta.problema || !alta.titulo) { avisar(alta.problema || "Escribe qué hay que hacer.", { tipo: "error" }); return; }
    setEnviando(true);
    try {
      const r = await pedir<{ tarea: TareaDTO }>("/api/tareas", { cuerpo: { title: alta.titulo, assignee_id: alta.asignado, due_date: alta.fecha, priority: alta.prioridad } });
      setTexto("");
      ctx.fusionar(r.tarea);
      avisar(`Tarea creada${alta.asignado !== ctx.usuario.id ? ` ${persona}` : ""}: «${r.tarea.titulo}»`, { tipo: "exito" });
      void ctx.recargar();
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); } finally { setEnviando(false); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void crear(); }} className="flex flex-col gap-1">
      <label htmlFor="alta-rapida" className="sr-only">Alta rápida de tarea</label>
      <Entrada id="alta-rapida" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={enviando} autoComplete="off"
        placeholder="Nueva tarea rápida: «Revisar informe @persona mañana !alta» y pulsa Intro"
        aria-describedby="alta-rapida-vista" aria-invalid={alta.problema ? true : undefined} />
      <p id="alta-rapida-vista" aria-live="polite" className={cx("min-h-5 px-1 text-xs", alta.problema ? "text-alerta" : "text-texto-3")}>{vista}</p>
    </form>
  );
}
