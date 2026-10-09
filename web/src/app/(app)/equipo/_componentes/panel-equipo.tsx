"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Entrada, Selector } from "@/components/ui/campo";
import { Contador } from "@/components/ui/contador";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { CeldaEstado, type Tono } from "@/components/ui/estado";
import { Panel, Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { fDia } from "@/lib/admin/formato";
import type { FilaTareaEquipo, PanelEquipo } from "@/lib/equipo/datos";
import { NombreCliente } from "@/components/clientes/ficha";
import { CargaPorPersona, Leyenda, Tendencia, VencidasPorUnidad } from "./graficos";
import { MapaDeCalor } from "./mapa-calor";

type Tareas = { total: number; tareas: FilaTareaEquipo[]; max: number; opciones: { personas: { id: number; nombre: string }[]; clientes: string[] } };
type Datos = { panel: PanelEquipo; tareas: Tareas };
type Filtros = Record<string, string>;

const VISTAS: { clave: string; rotulo: string; tono: Tono; campo: keyof PanelEquipo["contadores"]; detalle: string }[] = [
  { clave: "abiertas", rotulo: "Abiertas", tono: "neutro", campo: "abiertas", detalle: "sin terminar" },
  { clave: "vencidas", rotulo: "Vencidas", tono: "alerta", campo: "vencidas", detalle: "pasada la entrega" },
  { clave: "semana", rotulo: "Completadas", tono: "bien", campo: "completadasSemana", detalle: "esta semana" },
  { clave: "riesgo", rotulo: "En riesgo", tono: "aviso", campo: "enRiesgo", detalle: "vencen en 2 días" },
];

function qs(f: Filtros) {
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  return p.size ? `?${p}` : "";
}

export function PanelDeEquipo({ inicial, filtrosIniciales, esAdmin, ajena = false }: { inicial: Datos; filtrosIniciales: Filtros; esAdmin: boolean; ajena?: boolean }) {
  const { avisar } = useAvisos();
  const [panel, setPanel] = useState(inicial.panel);
  const [tareas, setTareas] = useState(inicial.tareas);
  const [filtros, setFiltros] = useState<Filtros>(filtrosIniciales);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fueraDeAlcance, setFueraDeAlcance] = useState(ajena);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const turno = useRef(0);
  const actuales = useRef(filtrosIniciales);

  const tonoDe = useMemo(() => new Map(panel.estados.map((e) => [e.nombre, e.color])), [panel.estados]);
  const presentes = useMemo(() => new Set(panel.carga.flatMap((f) => f.segmentos.map((s) => s.estado))), [panel.carga]);

  const cargar = useCallback(async (f: Filtros, conPanel: boolean) => {
    const n = ++turno.current;
    setCargando(true);
    try {
      const [p, t] = await Promise.all([
        conPanel ? pedir<PanelEquipo>(`/api/equipo${qs({ unidad: f.unidad ?? "" })}`) : Promise.resolve(null),
        pedir<Tareas>(`/api/equipo/tareas${qs(f)}`),
      ]);
      if (n !== turno.current) return;
      if (p) setPanel(p);
      setTareas(t);
      setError(null);
      setFueraDeAlcance(false);
      setSeleccion(new Set());
      window.history.replaceState(null, "", `/equipo${qs(f)}`);
    } catch (e) {
      if (n === turno.current) setError(mensajeDe(e));
    } finally {
      if (n === turno.current) setCargando(false);
    }
  }, []);

  const cambiar = useCallback((parcial: Filtros) => {
    const conPanel = "unidad" in parcial;
    const nuevo = { ...actuales.current, ...parcial, ...(conPanel ? { asignado: "", cliente: "" } : {}) };
    actuales.current = nuevo;
    setFiltros(nuevo);
    void cargar(nuevo, conPanel);
  }, [cargar]);

  const recargar = () => cargar(actuales.current, true);
  const hayFiltro = !!(filtros.estado || filtros.asignado || filtros.cliente || filtros.q || filtros.vista);

  const unidadNombre = filtros.unidad ? panel.unidades.find((u) => String(u.id) === filtros.unidad)?.nombre : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Equipo</h1>
          <p className="mt-1 text-texto-2">
            {unidadNombre ?? (panel.unidades.length === 1 ? panel.unidades[0].nombre : `${panel.unidades.length} unidades`)}
            <span className="text-texto-3"> · hoy {fDia(panel.hoy)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {panel.unidades.length > 1 && (
            <Selector aria-label="Unidad" value={filtros.unidad ?? ""} onChange={(e) => cambiar({ unidad: e.target.value })} className="w-full sm:w-56">
              <option value="">{esAdmin ? "Todas las unidades" : "Todo mi alcance"}</option>
              {panel.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          )}
          <a href={`/api/equipo/csv${qs(filtros)}`} download
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] text-texto hover:bg-superficie-2">
            <Download className="size-4" aria-hidden />Exportar CSV
          </a>
        </div>
      </header>

      {fueraDeAlcance && (
        <p role="alert" className="rounded-md border border-aviso/40 bg-superficie px-4 py-3 text-sm">
          Esa unidad está fuera de tu alcance, así que no se muestra nada de ella. Elige una de las tuyas en el selector.
        </p>
      )}
      {error && <p role="alert" className="rounded-md border border-alerta/40 bg-superficie px-4 py-3 text-sm text-alerta">{error} Lo de abajo puede no estar al día.</p>}

      <section aria-label="Franja de salidas" className="grid grid-cols-2 divide-hilo overflow-hidden rounded-md border border-hilo bg-superficie shadow-1 md:grid-cols-4 md:divide-x">
        {VISTAS.map((v, i) => (
          <div key={v.clave} className={cx(i % 2 === 1 && "border-l border-hilo md:border-l-0", i > 1 && "border-t border-hilo md:border-t-0")}>
            <Contador rotulo={v.rotulo} valor={panel.contadores[v.campo]} tono={v.tono} detalle={v.detalle}
              activo={filtros.vista === v.clave} onClick={() => cambiar({ vista: filtros.vista === v.clave ? "" : v.clave })} />
          </div>
        ))}
      </section>

      <Panel titulo="Carga por semana" acciones={<span className="text-xs text-texto-3">horas abiertas contra capacidad</span>}>
        <MapaDeCalor calor={panel.calor} activa={filtros.asignado ? Number(filtros.asignado) : null}
          onPersona={(id) => cambiar({ asignado: filtros.asignado === String(id) ? "" : String(id) })} />
      </Panel>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel titulo="Carga por persona" acciones={<span className="text-xs text-texto-3">abiertas por estado</span>}>
          <div className="border-b border-hilo px-4 py-2"><Leyenda estados={panel.estados} presentes={presentes} /></div>
          <CargaPorPersona filas={panel.carga} estados={panel.estados} activa={filtros.asignado ? Number(filtros.asignado) : null}
            onPersona={(id) => cambiar({ asignado: filtros.asignado === String(id) ? "" : String(id) })} />
        </Panel>
        <div className="flex min-w-0 flex-col gap-5">
          <Panel titulo="Vencidas por unidad">
            <VencidasPorUnidad filas={panel.porUnidad} onUnidad={panel.unidades.length > 1 ? (id) => cambiar({ unidad: String(id) }) : undefined} />
          </Panel>
          <Panel titulo="Tendencia" acciones={<span className="text-xs text-texto-3">8 semanas</span>}>
            <Tendencia puntos={panel.tendencia} />
          </Panel>
        </div>
      </div>

      <TablaTareas
        tareas={tareas} filtros={filtros} estados={panel.estados.map((e) => e.nombre)} tonoDe={tonoDe} hoy={panel.hoy} finales={new Set(panel.estados.filter((e) => e.esFinal).map((e) => e.nombre))} cargando={cargando} hayFiltro={hayFiltro}
        cambiar={cambiar} esAdmin={esAdmin} seleccion={seleccion} setSeleccion={setSeleccion}
        onLote={async (msg, deshacer) => { avisar(msg, { tipo: "exito", deshacer }); await recargar(); }}
        onError={(m) => avisar(m, { tipo: "error" })}
        recargar={recargar}
      />
    </div>
  );
}

function TablaTareas({ tareas, filtros, estados, tonoDe, hoy, finales, cargando, hayFiltro, cambiar, esAdmin, seleccion, setSeleccion, onLote, onError, recargar }: {
  tareas: Tareas; filtros: Filtros; estados: string[]; tonoDe: Map<string, Tono>; hoy: string; finales: Set<string>; cargando: boolean; hayFiltro: boolean; cambiar: (f: Filtros) => void;
  esAdmin: boolean; seleccion: Set<number>; setSeleccion: (s: Set<number>) => void; onLote: (m: string, deshacer?: () => void) => Promise<void>; onError: (m: string) => void; recargar: () => Promise<void>;
}) {
  const [busca, setBusca] = useState(filtros.q ?? "");
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const todas = tareas.tareas.length > 0 && tareas.tareas.every((t) => seleccion.has(t.id));
  const conmutar = (id: number) => { const s = new Set(seleccion); if (s.has(id)) s.delete(id); else s.add(id); setSeleccion(s); };

  return (
    <section aria-label="Tareas del alcance" className="rounded-md border border-hilo bg-superficie shadow-1">
      <div className="flex flex-wrap items-center gap-2 border-b border-hilo px-4 py-3">
        <h2 className="mr-2 font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Tareas</h2>
        <Entrada type="search" aria-label="Buscar por título" placeholder="Buscar por título" value={busca} className="w-full md:w-56"
          onChange={(e) => { const v = e.target.value; setBusca(v); clearTimeout(temporizador.current); temporizador.current = setTimeout(() => cambiar({ q: v }), 300); }} />
        <Selector aria-label="Estado" value={filtros.estado ?? ""} onChange={(e) => cambiar({ estado: e.target.value })} className="w-full sm:w-44">
          <option value="">Todos los estados</option>
          {estados.map((e) => <option key={e} value={e}>{e}</option>)}
        </Selector>
        <Selector aria-label="Responsable" value={filtros.asignado ?? ""} onChange={(e) => cambiar({ asignado: e.target.value })} className="w-full sm:w-44">
          <option value="">Todas las personas</option>
          {tareas.opciones.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
        <Selector aria-label="Cliente" value={filtros.cliente ?? ""} onChange={(e) => cambiar({ cliente: e.target.value })} className="w-full sm:w-44">
          <option value="">Todos los clientes</option>
          {tareas.opciones.clientes.map((c) => <option key={c} value={c}>{c}</option>)}
        </Selector>
        {hayFiltro && (
          <Boton variante="fantasma" tamano="sm" icono={<X className="size-3.5" aria-hidden />} onClick={() => { setBusca(""); cambiar({ estado: "", asignado: "", cliente: "", q: "", vista: "" }); }}>Quitar filtros</Boton>
        )}
        <span className="ml-auto text-sm text-texto-3">
          {tareas.total > tareas.tareas.length
            ? <>Mostrando <span className="font-mono cifras text-texto">{tareas.tareas.length}</span> de <span className="font-mono cifras text-texto">{tareas.total}</span>; el CSV las trae todas</>
            : <><span className="font-mono cifras text-texto">{tareas.total}</span> tarea{tareas.total === 1 ? "" : "s"}</>}
        </span>
      </div>

      {esAdmin && seleccion.size > 0 && <BarraLote ids={[...seleccion]} estados={estados} personas={tareas.opciones.personas} onHecho={onLote} onError={onError} onLimpiar={() => setSeleccion(new Set())} recargar={recargar} />}

      <div aria-busy={cargando || undefined} className={cx("transition-opacity duration-[var(--dur)]", cargando && "opacity-55")}>
        {tareas.tareas.length === 0 ? (
          <Vacio titulo={hayFiltro ? "Ninguna tarea con ese filtro" : "Sin tareas en este alcance"}
            accion={hayFiltro ? <Boton variante="secundario" onClick={() => { setBusca(""); cambiar({ estado: "", asignado: "", cliente: "", q: "", vista: "" }); }}>Quitar filtros</Boton> : undefined}>
            {hayFiltro ? "Prueba con otro estado o persona, o pulsa de nuevo el contador activo." : "Cuando las personas de tus unidades tengan tareas, aparecerán aquí por fecha de entrega."}
          </Vacio>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="hidden border-b border-hilo md:table-header-group">
              <tr>
                {esAdmin && <th scope="col" className="w-10 pl-4"><input type="checkbox" aria-label="Seleccionar todas las visibles" className="size-4 accent-[var(--texto)]" checked={todas}
                  onChange={(e) => setSeleccion(e.target.checked ? new Set(tareas.tareas.map((t) => t.id)) : new Set())} /></th>}
                {["Entrega", "Tarea", "Unidad", "Responsable", "Prioridad", "Estado"].map((c, i) => (
                  <th key={c} scope="col" className={cx("rotulo h-10 px-4 text-left font-semibold", i === 2 && "hidden lg:table-cell", i === 4 && "hidden xl:table-cell")}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tareas.tareas.map((t) => {
                const vencida = t.vence < hoy && !finales.has(t.estado);
                return (
                  <tr key={t.id} className={cx("grid grid-cols-[auto_1fr_auto] items-center gap-x-3 border-b border-hilo px-4 py-2 last:border-0 hover:bg-superficie-2 md:table-row md:p-0", seleccion.has(t.id) && "bg-superficie-2")}>
                    {esAdmin && <td className="md:h-11 md:pl-4"><input type="checkbox" aria-label={`Seleccionar ${t.titulo}`} className="size-4 accent-[var(--texto)]" checked={seleccion.has(t.id)} onChange={() => conmutar(t.id)} /></td>}
                    <td className={cx("font-mono text-xs md:h-11 md:px-4", vencida ? "text-alerta" : "text-texto-2", !esAdmin && "col-span-1")}><time dateTime={t.vence}>{fDia(t.vence)}</time></td>
                    <td className="min-w-0 md:h-11 md:max-w-0 md:px-4 md:w-[40%]">
                      <span className="block truncate font-medium">{t.titulo}</span>
                      {t.cliente && <NombreCliente id={t.clienteId} nombre={t.cliente} className="block text-xs text-texto-3" />}
                    </td>
                    <td className="hidden text-texto-2 lg:table-cell lg:h-11 lg:px-4">{t.unidad ?? "—"}</td>
                    <td className="col-start-2 text-texto-2 md:h-11 md:px-4">{t.asignado}</td>
                    <td className="hidden text-texto-2 xl:table-cell xl:h-11 xl:px-4">{t.prioridad}</td>
                    <td className="col-start-3 row-start-1 md:h-11 md:px-4"><CeldaEstado texto={t.estado} tono={tonoDe.get(t.estado) ?? "neutro"} cambio={t.actualizada ?? undefined} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* Edicion y borrado masivo, solo para admin (como /api/admin/tasks/bulk-* de Flask). */
function BarraLote({ ids, estados, personas, onHecho, onError, onLimpiar, recargar }: {
  ids: number[]; estados: string[]; personas: { id: number; nombre: string }[];
  onHecho: (m: string, deshacer?: () => void) => Promise<void>; onError: (m: string) => void; onLimpiar: () => void; recargar: () => Promise<void>;
}) {
  const [estado, setEstado] = useState("");
  const [asignado, setAsignado] = useState("");
  const [vence, setVence] = useState("");
  const [borrar, setBorrar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function aplicar() {
    setOcupado(true);
    try {
      const r = await pedir<{ actualizadas: number }>("/api/admin/tareas/lote", { cuerpo: { ids, estado, asignadoId: asignado || null, vence } });
      setEstado(""); setAsignado(""); setVence("");
      await onHecho(`${r.actualizadas} tarea(s) actualizadas.`);
    } catch (e) { onError(mensajeDe(e)); } finally { setOcupado(false); }
  }
  async function eliminar() {
    setOcupado(true);
    try {
      const r = await pedir<{ eliminadas: number; ids: number[] }>("/api/admin/tareas/borrar", { cuerpo: { ids } });
      setBorrar(false);
      await onHecho(`${r.eliminadas} tarea(s) eliminadas.`, async () => {
        try { await pedir("/api/admin/tareas/restaurar", { cuerpo: { ids: r.ids } }); await recargar(); } catch (e) { onError(mensajeDe(e)); }
      });
    } catch (e) { onError(mensajeDe(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hilo bg-superficie-2 px-4 py-2 motion-safe:animate-[entrada-aviso_var(--dur)_var(--curva)]" role="region" aria-label="Acciones en lote">
      <span className="text-sm"><span className="font-mono cifras font-semibold">{ids.length}</span> seleccionada{ids.length === 1 ? "" : "s"}</span>
      <Selector aria-label="Nuevo estado" value={estado} onChange={(e) => setEstado(e.target.value)} className="h-9 w-40"><option value="">Estado…</option>{estados.map((e) => <option key={e}>{e}</option>)}</Selector>
      <Selector aria-label="Reasignar a" value={asignado} onChange={(e) => setAsignado(e.target.value)} className="h-9 w-44"><option value="">Reasignar a…</option>{personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>
      <Entrada type="date" aria-label="Nueva entrega" value={vence} onChange={(e) => setVence(e.target.value)} className="h-9 w-40 font-mono" />
      <Boton variante="primario" tamano="sm" cargando={ocupado} disabled={!estado && !asignado && !vence} onClick={aplicar}>Aplicar</Boton>
      <Boton variante="peligro" tamano="sm" onClick={() => setBorrar(true)}>Eliminar</Boton>
      <Boton variante="fantasma" tamano="sm" onClick={onLimpiar}>Quitar selección</Boton>
      <Dialogo abierto={borrar} onCerrar={() => setBorrar(false)} titulo="Eliminar tareas" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(false)}>Cancelar</Boton><Boton variante="peligro" cargando={ocupado} onClick={eliminar}>Eliminar {ids.length}</Boton></>}>
        <p>Se eliminarán <strong className="font-mono">{ids.length}</strong> tarea(s) y sus repeticiones. Tendrás unos segundos para deshacerlo.</p>
      </Dialogo>
    </div>
  );
}
