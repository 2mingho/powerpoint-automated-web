"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useAvisos } from "@/components/ui/avisos";
import type { Contadores, EstadoCatalogo, EtiquetaDTO, Filtros, PersonaDTO, PrioridadCatalogo, TareaDTO } from "@/lib/tareas/tipos";
import { puedeCerrar } from "@/lib/seguimiento/estado";
import { consultaDeFiltros, ErrorPeticion, pedir } from "./cliente";

/*
 * Estado de Mis tareas: la lista, los contadores, los filtros y la tarea
 * seleccionada. Cada tarea guarda sus cambios en fila: dos clics seguidos
 * mandarian el mismo expected_updated_at y el segundo chocaria (409 falso).
 */

export type Vista = "panel" | "tablero" | "calendario";

export type Inicial = {
  /* lidera: admin o quien tiene unidades a cargo; aprueba tareas con revisor y cambia revisores ajenos. */
  usuario: { id: number; nombre: string; esAdmin: boolean; unidadId: number | null; lidera: boolean };
  hoy: string;
  estados: EstadoCatalogo[];
  prioridades: PrioridadCatalogo[];
  personas: PersonaDTO[];
  clientes: string[];
  etiquetas: Array<EtiquetaDTO & { gestionable: boolean }>;
  unidades: Array<{ id: number; name: string }>;
  puedeImportar: boolean;
  filtros: Filtros;
  vista: Vista;
  tarea: number | null;
  tareas: TareaDTO[];
  contadores: Contadores;
  truncada: boolean;
};

/* Cuerpo del PUT (nombres de Flask) a campos del DTO, para el cambio optimista. */
export type Cambios = Partial<{ status: string; due_date: string; priority: string; assignee_id: number; title: string }> & Record<string, string | number | undefined>;

function aplicar(t: TareaDTO, c: Cambios, personas: PersonaDTO[]): TareaDTO {
  const n = { ...t };
  if (c.status !== undefined) n.estado = c.status;
  if (c.due_date !== undefined) n.entrega = c.due_date;
  if (c.priority !== undefined) n.prioridad = c.priority;
  if (c.title !== undefined) n.titulo = c.title;
  if (c.assignee_id !== undefined) {
    n.asignadoId = c.assignee_id;
    n.asignado = personas.find((p) => p.id === c.assignee_id)?.nombre ?? n.asignado;
  }
  return n;
}

type Ctx = Inicial & {
  tareas: TareaDTO[];
  contadores: Contadores;
  truncada: boolean;
  cargando: boolean;
  error: string;
  etiquetas: Inicial["etiquetas"];
  setEtiquetas: (e: Inicial["etiquetas"]) => void;
  filtros: Filtros;
  setFiltros: (f: Partial<Filtros>) => void;
  vista: Vista;
  setVista: (v: Vista) => void;
  seleccionada: number | null;
  seleccionar: (id: number | null) => void;
  recargar: () => Promise<void>;
  /* Version de la lista: sube con cada recarga (el tablero y el calendario se refrescan con ella). */
  version: number;
  guardar: (id: number, cambios: Cambios, opts?: { mensaje?: string; deshacer?: boolean; version?: string }) => Promise<TareaDTO | null>;
  completar: (id: number) => void;
  fusionar: (t: TareaDTO) => void;
  quitar: (ids: number[]) => void;
  completadasSesion: Set<number>;
  esFinal: (estado: string) => boolean;
  /* Falso si la tarea tiene revisor y yo no soy ni el revisor ni quien lidera: debe pasar a revision. */
  puedeCompletar: (t: Pick<TareaDTO, "estado" | "revisorId">) => boolean;
  estadoFinal: string;
  estadoInicial: string;
};

const Contexto = createContext<Ctx | null>(null);
export function useTareas() {
  const c = useContext(Contexto);
  if (!c) throw new Error("useTareas fuera de ProveedorTareas");
  return c;
}

export function ProveedorTareas({ inicial, children }: { inicial: Inicial; children: ReactNode }) {
  const { avisar } = useAvisos();
  const [mapa, setMapa] = useState(() => new Map(inicial.tareas.map((t) => [t.id, t])));
  const mapaRef = useRef(mapa);
  useEffect(() => { mapaRef.current = mapa; }, [mapa]);
  const [contadores, setContadores] = useState(inicial.contadores);
  const [truncada, setTruncada] = useState(inicial.truncada);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [filtros, setFiltrosEstado] = useState(inicial.filtros);
  const [vista, setVistaEstado] = useState<Vista>(inicial.vista);
  const [seleccionada, setSeleccionada] = useState<number | null>(inicial.tarea);
  // ?tarea=ID que llega navegando sin salir de /tareas (campana, paleta, Inicio): abre ese pase.
  const pedida = useSearchParams().get("tarea");
  const [pedidaPrevia, setPedidaPrevia] = useState(pedida);
  if (pedida !== pedidaPrevia) {
    setPedidaPrevia(pedida);
    if (pedida && /^\d+$/.test(pedida)) setSeleccionada(Number(pedida));
  }
  const [etiquetas, setEtiquetas] = useState(inicial.etiquetas);
  const [version, setVersion] = useState(0);
  const [completadasSesion, setCompletadasSesion] = useState<Set<number>>(() => new Set());
  const colas = useRef(new Map<number, Promise<unknown>>());
  const pendientes = useRef(new Map<number, number>());
  const turno = useRef(0);
  const guardarRef = useRef<Ctx["guardar"] | null>(null);

  const finales = useMemo(() => new Set(inicial.estados.filter((e) => e.esFinal).map((e) => e.nombre)), [inicial.estados]);
  const esFinal = useCallback((e: string) => finales.has(e), [finales]);
  const estadoFinal = inicial.estados.find((e) => e.esFinal)?.nombre ?? "Completado";
  const estadoInicial = inicial.estados.find((e) => e.esInicial)?.nombre ?? inicial.estados[0]?.nombre ?? "Pendiente";

  /* La URL refleja filtros, vista y seleccion: se puede compartir y recargar. */
  useEffect(() => {
    const extra: Record<string, string> = {};
    if (vista !== "panel") extra.vista = vista;
    if (seleccionada) extra.tarea = String(seleccionada);
    const q = consultaDeFiltros({ ...filtros, alcance: filtros.alcance === "mias" ? ("" as Filtros["alcance"]) : filtros.alcance }, extra);
    const url = `${window.location.pathname}${q ? `?${q}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [filtros, vista, seleccionada]);

  const filtrosRef = useRef(filtros);
  useEffect(() => { filtrosRef.current = filtros; }, [filtros]);

  const recargar = useCallback(async () => {
    const mio = ++turno.current;
    setCargando(true);
    try {
      const d = await pedir<{ tareas: TareaDTO[]; contadores: Contadores; truncada: boolean }>(`/api/tareas?${consultaDeFiltros(filtrosRef.current)}`);
      if (mio !== turno.current) return;
      setMapa((previo) => {
        const nuevo = new Map<number, TareaDTO>();
        for (const t of d.tareas) {
          const local = previo.get(t.id);
          // Mientras haya cambios en cola, o si la copia local es mas reciente, manda la local.
          if (local && ((pendientes.current.get(t.id) ?? 0) > 0 || local.actualizada > t.actualizada)) nuevo.set(t.id, local);
          else nuevo.set(t.id, t);
        }
        // Lo completado en esta visita sigue a la vista aunque ya no llegue.
        for (const [id, t] of previo) if (!nuevo.has(id) && completadasSesion.has(id)) nuevo.set(id, t);
        return nuevo;
      });
      setContadores(d.contadores);
      setTruncada(d.truncada);
      setError("");
      setVersion((v) => v + 1);
    } catch (e) {
      if (mio === turno.current) setError(e instanceof ErrorPeticion ? e.message : "No se pudo cargar tu trabajo.");
    } finally {
      if (mio === turno.current) setCargando(false);
    }
  }, [completadasSesion]);

  const setFiltros = useCallback((f: Partial<Filtros>) => {
    setFiltrosEstado((prev) => ({ ...prev, ...f }));
  }, []);

  /* Recarga al cambiar filtros (la busqueda espera a que se deje de escribir). */
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    const t = setTimeout(() => { void recargar(); }, 250);
    return () => clearTimeout(t);
  }, [filtros, recargar]);

  /* Cada 60 s mientras la pestaña este visible, y al volver a ella. */
  useEffect(() => {
    const tic = () => { if (document.visibilityState === "visible") void recargar(); };
    const i = setInterval(tic, 60_000);
    document.addEventListener("visibilitychange", tic);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", tic); };
  }, [recargar]);

  const fusionar = useCallback((t: TareaDTO) => {
    setMapa((m) => {
      const n = new Map(m);
      const previa = m.get(t.id);
      // El PUT trae la fila completa con sus contadores; se conserva lo que el detalle no trae.
      n.set(t.id, previa ? { ...previa, ...t } : t);
      return n;
    });
  }, []);

  const quitar = useCallback((ids: number[]) => {
    setMapa((m) => { const n = new Map(m); ids.forEach((id) => n.delete(id)); return n; });
  }, []);

  const recontar = useCallback(async () => {
    try { setContadores(await pedir<Contadores>(`/api/tareas/contadores?alcance=${filtrosRef.current.alcance}`)); } catch { /* el siguiente refresco lo arregla */ }
  }, []);

  const guardar = useCallback<Ctx["guardar"]>((id, cambios, opts = {}) => {
    const anterior = colas.current.get(id) ?? Promise.resolve();
    pendientes.current.set(id, (pendientes.current.get(id) ?? 0) + 1);
    const original = mapaRef.current.get(id);
    if (original) {
      setMapa((m) => { const n = new Map(m); const t = m.get(id); if (t) n.set(id, aplicar(t, cambios, inicial.personas)); return n; });
      if (cambios.status !== undefined && finales.has(cambios.status)) setCompletadasSesion((s) => new Set(s).add(id));
    }
    const previo: Cambios = {};
    if (original) {
      if (cambios.status !== undefined) previo.status = original.estado;
      if (cambios.due_date !== undefined) previo.due_date = original.entrega;
      if (cambios.priority !== undefined) previo.priority = original.prioridad;
      if (cambios.assignee_id !== undefined) previo.assignee_id = original.asignadoId;
    }
    const siguiente = anterior.catch(() => {}).then(async () => {
      const actual = mapaRef.current.get(id);
      try {
        const r = await pedir<{ tarea: TareaDTO }>(`/api/tareas/${id}`, {
          metodo: "PUT", cuerpo: { ...cambios, expected_updated_at: actual?.actualizada ?? opts.version ?? "" },
        });
        fusionar(r.tarea);
        void recontar();
        if (opts.mensaje) {
          avisar(opts.mensaje, opts.deshacer === false ? { tipo: "exito" } : {
            tipo: "exito",
            deshacer: () => { void guardarRef.current?.(id, previo, { mensaje: "Cambio deshecho.", deshacer: false }); },
          });
        }
        return r.tarea;
      } catch (e) {
        if (e instanceof ErrorPeticion && e.status === 409 && e.datos.tarea) {
          fusionar(e.datos.tarea as TareaDTO);
          avisar("Otra persona cambió esta tarea antes. Ya ves su versión: revisa y vuelve a intentarlo.", { tipo: "error" });
        } else {
          // Vuelve a lo que habia: la fila regresa a su sitio en vez de mentir.
          if (original) setMapa((m) => { const n = new Map(m); n.set(id, original); return n; });
          avisar(e instanceof Error ? e.message : "No se pudo guardar.", { tipo: "error" });
        }
        return null;
      } finally {
        pendientes.current.set(id, (pendientes.current.get(id) ?? 1) - 1);
      }
    });
    colas.current.set(id, siguiente);
    return siguiente;
  }, [avisar, finales, fusionar, inicial.personas, recontar]);

  useEffect(() => { guardarRef.current = guardar; }, [guardar]);

  const puedeCompletar = useCallback<Ctx["puedeCompletar"]>(
    (t) => finales.has(t.estado) || puedeCerrar(t.revisorId, inicial.usuario.id, inicial.usuario.lidera),
    [finales, inicial.usuario.id, inicial.usuario.lidera],
  );

  const completar = useCallback((id: number) => {
    const t = mapaRef.current.get(id);
    if (!t || !puedeCompletar(t)) return;
    const hecha = finales.has(t.estado);
    const corto = t.titulo.length > 40 ? `${t.titulo.slice(0, 40)}…` : t.titulo;
    void guardar(id, { status: hecha ? estadoInicial : estadoFinal }, { mensaje: hecha ? `Reabierta: «${corto}»` : `Completada: «${corto}»` });
  }, [estadoFinal, estadoInicial, finales, guardar, puedeCompletar]);

  const seleccionar = useCallback((id: number | null) => setSeleccionada(id), []);
  const setVista = useCallback((v: Vista) => setVistaEstado(v), []);

  const tareas = useMemo(() => [...mapa.values()], [mapa]);

  const valor: Ctx = {
    ...inicial, tareas, contadores, truncada, cargando, error, etiquetas, setEtiquetas, filtros, setFiltros, vista, setVista,
    seleccionada, seleccionar, recargar, version, guardar, completar, fusionar, quitar, completadasSesion, esFinal, puedeCompletar, estadoFinal, estadoInicial,
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
