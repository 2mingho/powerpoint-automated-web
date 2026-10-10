"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, TriangleAlert, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Contador } from "@/components/ui/contador";
import { CeldaEstado, type Tono } from "@/components/ui/estado";
import { cx } from "@/components/ui/cx";
import { Panel, Vacio } from "@/components/ui/panel";
import { NombreCliente } from "@/components/clientes/ficha";
import { opcionesDe, resumen } from "@/lib/panel/agregados";
import { decodificarCeldas, type CeldasWire } from "@/lib/panel/celdas";
import { GRUPOS_ESTADO, type EstadoPanel, type FilaDetalle, type Metrica } from "@/lib/panel/tipos";
import { alternar, SIN_FILTROS, type FiltrosCruzados } from "@/lib/seguimiento/filtros";
import { PERIODOS, ROTULO_PERIODO, type Periodo } from "@/lib/seguimiento/periodo";
import { riesgoDe } from "@/lib/seguimiento/riesgo";
import { ColumnaOrdenable, SelectorOrden } from "@/components/ui/orden";
import { alternarOrden, type Orden } from "@/lib/orden";
import { ErrorPeticion, fechaCorta, pedir, relativo } from "../tareas/_componentes/cliente";
import { GraficosPanel } from "./graficos-panel";
import { BloqueIngresos } from "./ingresos-panel";
import type { IngresosPanel } from "@/lib/panel/datos";

const PAGINA_INICIAL = 40;
const PAGINA = 60;
const numero = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 1 });

type ColDetalle = "entrega" | "tarea" | "persona" | "unidad" | "estado" | "horas";
const COLUMNAS_DETALLE: { col: ColDetalle; etiqueta: string }[] = [
  { col: "entrega", etiqueta: "Entrega" }, { col: "tarea", etiqueta: "Tarea" }, { col: "persona", etiqueta: "Persona" },
  { col: "unidad", etiqueta: "Unidad" }, { col: "estado", etiqueta: "Estado" }, { col: "horas", etiqueta: "Horas" },
];

type Seleccion = "unidad" | "cliente" | "persona" | "tipo" | "contrato" | "estado" | "semana";

const ROTULO_ESTADO: Record<string, string> = {
  ...Object.fromEntries(GRUPOS_ESTADO.map((g) => [g.valor, g.rotulo])),
  vencida: "Vencidas",
  abierta: "Abiertas",
};

/*
 * Panel de Inicio: filtros cruzados estilo Power BI sobre las tareas que la
 * persona puede ver. El servidor manda CELDAS (combinaciones ya agrupadas por la
 * base, ver lib/panel/celdas.ts) y aqui se filtran al instante: cada lista de
 * opciones se calcula sin su propio filtro, para que elegir un cliente no deje
 * la lista de clientes con una sola entrada. Las tareas sueltas del detalle se
 * piden al servidor por paginas, con los mismos filtros.
 */
export function PanelInicio({
  celdas, tareas, detalle, estados, hoy, periodo, desde, hasta, truncado, tope, ingresos,
}: {
  celdas: CeldasWire;
  /* Tareas del periodo (todas, no las celdas). */
  tareas: number;
  /* Primera pagina del detalle, sin filtros ni orden. */
  detalle: { filas: FilaDetalle[]; total: number };
  estados: EstadoPanel[];
  hoy: string;
  periodo: Periodo;
  desde: string;
  hasta: string;
  truncado: boolean;
  tope: number;
  ingresos: IngresosPanel | null;
}) {
  const router = useRouter();
  const [cambiando, empezar] = useTransition();
  const [filtros, setFiltros] = useState<FiltrosCruzados>(SIN_FILTROS);
  const [metrica, setMetrica] = useState<Metrica>("n");
  const [orden, setOrden] = useState<Orden<ColDetalle> | null>(null);
  const filas = useMemo(() => decodificarCeldas(celdas), [celdas]);

  const tono = useMemo(() => new Map(estados.map((e) => [e.nombre, e.tono as Tono])), [estados]);
  const cifras = useMemo(() => resumen(filas, filtros, hoy, metrica), [filas, filtros, hoy, metrica]);
  const opciones = useMemo(() => ({
    unidad: opcionesDe(filas, filtros, hoy, "unidad"),
    cliente: opcionesDe(filas, filtros, hoy, "cliente"),
    persona: opcionesDe(filas, filtros, hoy, "persona"),
    tipo: opcionesDe(filas, filtros, hoy, "tipo"),
    contrato: opcionesDe(filas, filtros, hoy, "contrato"),
  }), [filas, filtros, hoy]);
  /*
   * Detalle: la pagina que ve la persona. Sin filtros ni orden es la que mando el servidor con la pagina; con
   * ellos se pide a /api/panel/detalle (filtrado en la base) y "Mostrar mas" agrega la siguiente pagina.
   * `clave` identifica que consulta es: una respuesta que llega para otra clave se descarta.
   */
  const hayFiltros = Object.entries(filtros).some(([k, v]) => k !== "desde" && k !== "hasta" && v);
  const clave = JSON.stringify([periodo, desde, hasta, filtros, orden]);
  const sinFiltrar = !hayFiltros && !orden;
  const [remoto, setRemoto] = useState<{ clave: string; filas: FilaDetalle[]; total: number } | null>(null);
  const [errorDetalle, setErrorDetalle] = useState("");
  const [pidiendoMas, setPidiendoMas] = useState(false);
  const turno = useRef(0);
  const consulta = useCallback((offset: number, limite: number) => {
    const q = new URLSearchParams({ periodo, offset: String(offset), limite: String(limite) });
    if (periodo === "rango") { if (desde) q.set("desde", desde); if (hasta) q.set("hasta", hasta); }
    for (const dim of ["unidad", "cliente", "persona", "tipo", "contrato", "semana", "estado"] as const) if (filtros[dim]) q.set(dim, filtros[dim]);
    if (orden) { q.set("orden", orden.col); q.set("dir", orden.dir); }
    return pedir<{ filas: FilaDetalle[]; total: number }>(`/api/panel/detalle?${q}`);
  }, [periodo, desde, hasta, filtros, orden]);

  useEffect(() => {
    if (sinFiltrar) return;
    const contador = turno;
    const mio = ++contador.current;
    consulta(0, PAGINA_INICIAL)
      .then((d) => { if (mio === contador.current) { setRemoto({ clave, ...d }); setErrorDetalle(""); } })
      .catch((e) => { if (mio === contador.current) setErrorDetalle(e instanceof ErrorPeticion ? e.message : "No se pudo cargar el detalle."); });
    return () => { contador.current++; };
  }, [clave, sinFiltrar, consulta]);

  const propio = remoto && remoto.clave === clave ? remoto : null;
  // Sin filtros, lo del servidor sirve hasta que se pida mas (entonces `remoto` ya trae todo lo cargado).
  const mostrada = propio ?? (sinFiltrar ? detalle : null);
  // Mientras llega la consulta nueva se sigue viendo lo anterior (atenuado) en vez de vaciar la tabla.
  const visible = mostrada ?? remoto ?? detalle;
  const desactualizado = !mostrada && !errorDetalle;
  const filasDetalle = visible.filas;
  const totalDetalle = visible.total;
  const mostrarMas = async () => {
    if (!mostrada) return;
    setPidiendoMas(true);
    try {
      const d = await consulta(mostrada.filas.length, PAGINA);
      setRemoto({ clave, filas: [...mostrada.filas, ...d.filas], total: d.total });
    } catch (e) {
      setErrorDetalle(e instanceof ErrorPeticion ? e.message : "No se pudo cargar más.");
    } finally { setPidiendoMas(false); }
  };
  const alOrdenar = (col: ColDetalle) => { setOrden((o) => alternarOrden(o, col, col === "horas" ? "desc" : "asc")); setErrorDetalle(""); };
  /* Lo urgente primero: lo abierto por entrega ascendente y, al final, lo cerrado por entrega descendente. */

  const cambiar = (f: FiltrosCruzados) => { setFiltros(f); setErrorDetalle(""); };
  const poner = (dim: Seleccion, valor: string) => cambiar({ ...filtros, [dim]: valor });
  const alternarEstado = (valor: string) => poner("estado", filtros.estado === valor ? "" : valor);
  /* Un clic en un grafico pone el valor y otro igual lo quita. */
  const elegir = (dim: Seleccion, valor: string) => cambiar(alternar(filtros, dim, valor));

  /* El periodo vive en la URL: cambiarlo pide otras filas al servidor. */
  const ir = (p: Periodo, d = desde, h = hasta) => {
    const q = new URLSearchParams({ vista: "panel" });
    if (p !== "mes") q.set("periodo", p);
    if (p === "rango") { if (d) q.set("desde", d); if (h) q.set("hasta", h); }
    empezar(() => router.replace(`/?${q}`, { scroll: false }));
  };

  const activos: { dim: Seleccion; rotulo: string; texto: string }[] = [];
  const nombreDe = (dim: "unidad" | "cliente" | "persona" | "tipo" | "contrato") => opciones[dim].find((o) => o.valor === filtros[dim])?.etiqueta ?? filtros[dim];
  if (filtros.unidad) activos.push({ dim: "unidad", rotulo: "Unidad", texto: nombreDe("unidad") });
  if (filtros.cliente) activos.push({ dim: "cliente", rotulo: "Cliente", texto: nombreDe("cliente") });
  if (filtros.persona) activos.push({ dim: "persona", rotulo: "Persona", texto: nombreDe("persona") });
  if (filtros.tipo) activos.push({ dim: "tipo", rotulo: "Tipo de cliente", texto: nombreDe("tipo") });
  if (filtros.contrato) activos.push({ dim: "contrato", rotulo: "Contrato", texto: nombreDe("contrato") });
  if (filtros.semana) activos.push({ dim: "semana", rotulo: "Semana", texto: `del ${fechaCorta(filtros.semana)}` });
  if (filtros.estado) activos.push({ dim: "estado", rotulo: "Estado", texto: ROTULO_ESTADO[filtros.estado] ?? filtros.estado });

  const enHoras = metrica === "h";
  const sufijo = enHoras ? "horas estimadas" : undefined;

  return (
    <div className={cx("flex flex-col gap-4 transition-opacity duration-[var(--dur)]", cambiando && "opacity-60")} aria-busy={cambiando}>
      <section aria-label="Filtros del panel" className="flex flex-col gap-3 rounded-md border border-hilo bg-superficie p-4 shadow-1">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,200px)_auto_1fr] md:items-end">
          <Campo etiqueta="Periodo de entrega">
            {(a) => (
              <Selector {...a} value={periodo} onChange={(e) => ir(e.target.value as Periodo)}>
                {PERIODOS.map((p) => <option key={p} value={p}>{ROTULO_PERIODO[p]}</option>)}
              </Selector>
            )}
          </Campo>
          <div role="group" aria-label="Qué se cuenta" className="flex flex-col gap-1.5">
            <span className="rotulo">Se cuenta</span>
            <div className="inline-flex h-10 overflow-hidden rounded-sm border border-hilo-fuerte">
              {([["n", "Tareas"], ["h", "Horas"]] as const).map(([valor, rotulo]) => (
                <button key={valor} type="button" aria-pressed={metrica === valor} onClick={() => setMetrica(valor)}
                  className={cx("min-w-20 px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] transition-colors duration-[var(--dur)]",
                    metrica === valor ? "bg-texto text-superficie" : "text-texto-2 hover:bg-superficie-2")}>
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          {periodo === "rango" && (
            <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-1 md:max-w-sm">
              <Campo etiqueta="Desde">{(a) => <Entrada {...a} type="date" value={desde} onChange={(e) => ir("rango", e.target.value, hasta)} />}</Campo>
              <Campo etiqueta="Hasta">{(a) => <Entrada {...a} type="date" value={hasta} onChange={(e) => ir("rango", desde, e.target.value)} />}</Campo>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <FiltroLista etiqueta="Unidad" todas="Todas" valor={filtros.unidad} opciones={opciones.unidad} onChange={(v) => poner("unidad", v)} />
          <FiltroLista etiqueta="Cliente" todas="Todos" valor={filtros.cliente} opciones={opciones.cliente} onChange={(v) => poner("cliente", v)} />
          <FiltroLista etiqueta="Persona" todas="Todas" valor={filtros.persona} opciones={opciones.persona} onChange={(v) => poner("persona", v)} />
          <FiltroLista etiqueta="Tipo de cliente" todas="Todos" valor={filtros.tipo} opciones={opciones.tipo} onChange={(v) => poner("tipo", v)} />
          {(ingresos || opciones.contrato.length > 0) && (
            <FiltroLista etiqueta="Tipo de contrato" todas="Todos" valor={filtros.contrato} opciones={opciones.contrato} onChange={(v) => poner("contrato", v)} />
          )}
          <Campo etiqueta="Estado">
            {(a) => (
              <Selector {...a} value={filtros.estado} onChange={(e) => poner("estado", e.target.value)}>
                <option value="">Todos</option>
                {GRUPOS_ESTADO.map((g) => <option key={g.valor} value={g.valor}>{g.rotulo}</option>)}
                <option value="abierta">Abiertas</option>
                <option value="vencida">Vencidas</option>
              </Selector>
            )}
          </Campo>
        </div>

        {activos.length > 0 && (
          <ul aria-label="Filtros activos" className="flex flex-wrap items-center gap-2">
            {activos.map((a) => (
              <li key={a.dim}>
                <button type="button" onClick={() => poner(a.dim, "")} aria-label={`Quitar el filtro ${a.rotulo}: ${a.texto}`}
                  className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-sm border border-hilo-fuerte bg-superficie-2 pl-2.5 pr-1.5 text-sm hover:border-texto-3">
                  <span className="text-texto-3">{a.rotulo}:</span>
                  <span className="truncate font-medium">{a.texto}</span>
                  <X aria-hidden className="size-4 shrink-0 text-texto-3" />
                </button>
              </li>
            ))}
            <li><Boton variante="fantasma" onClick={() => cambiar(SIN_FILTROS)}>Quitar todos los filtros</Boton></li>
          </ul>
        )}
      </section>

      <div role="group" aria-label="Cifras del panel" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo shadow-1 md:grid-cols-3 lg:grid-cols-6">
        <div className="bg-superficie"><Contador rotulo="Clientes" valor={cifras.clientes} /></div>
        <div className="bg-superficie"><Contador rotulo={enHoras ? "Horas" : "Tareas"} valor={cifras.tareas} texto={numero.format(cifras.tareas)} detalle={sufijo} /></div>
        <div className="bg-superficie"><Contador rotulo="Completadas" valor={cifras.completadas} texto={numero.format(cifras.completadas)} tono="bien" activo={filtros.estado === "hecha"} onClick={() => alternarEstado("hecha")} detalle={sufijo} /></div>
        <div className="bg-superficie"><Contador rotulo="Abiertas" valor={cifras.abiertas} texto={numero.format(cifras.abiertas)} tono="info" activo={filtros.estado === "abierta"} onClick={() => alternarEstado("abierta")} detalle={sufijo} /></div>
        <div className="bg-superficie"><Contador rotulo="Vencidas" valor={cifras.vencidas} texto={numero.format(cifras.vencidas)} tono="alerta" activo={filtros.estado === "vencida"} onClick={() => alternarEstado("vencida")} detalle={sufijo} /></div>
        <div className="bg-superficie">
          <Contador rotulo="A tiempo" valor={cifras.aTiempo ?? 0} texto={cifras.aTiempo == null ? "—" : `${cifras.aTiempo} %`} tono={cifras.aTiempo != null && cifras.aTiempo < 70 ? "aviso" : "bien"}
            detalle={cifras.aTiempo == null ? "sin cierres en 30 días" : "cierres de 30 días"} />
        </div>
      </div>

      {ingresos && <BloqueIngresos ingresos={ingresos} filtros={filtros} hoy={hoy} />}

      {filas.length > 0 && <GraficosPanel filas={filas} filtros={filtros} hoy={hoy} metrica={metrica} elegir={elegir} />}

      {truncado && (
        <p role="status" className="rounded-sm border border-aviso/40 bg-aviso/10 px-3 py-2 text-sm">
          Este periodo tiene más de {numero.format(tope)} combinaciones distintas de unidad, cliente, persona y semana: las cifras y los gráficos usan las {numero.format(tope)} de entrega más próxima a hoy. Acota el periodo para verlo todo.
        </p>
      )}

      <Panel titulo="Detalle" acciones={<span className="font-mono text-sm text-texto-2 cifras">{numero.format(totalDetalle)} {totalDetalle === 1 ? "tarea" : "tareas"}</span>}>
        {!tareas ? (
          <Vacio titulo="Sin tareas con entrega en este periodo">Prueba con otro periodo o con «Todo». Solo cuentan las tareas que puedes ver.</Vacio>
        ) : errorDetalle && !mostrada ? (
          <Vacio titulo="No se pudo cargar el detalle" accion={<Boton variante="secundario" onClick={() => cambiar({ ...filtros })}>Reintentar</Boton>}>{errorDetalle}</Vacio>
        ) : !desactualizado && !totalDetalle ? (
          <Vacio titulo="Ninguna tarea con estos filtros" accion={<Boton onClick={() => cambiar(SIN_FILTROS)}>Quitar todos los filtros</Boton>}>
            Los filtros se combinan entre sí; quita alguno para ampliar el resultado.
          </Vacio>
        ) : (
          <>
            <SelectorOrden className="border-b border-hilo px-4 py-2 md:hidden" opciones={COLUMNAS_DETALLE} orden={orden} vacio="Lo urgente primero"
              onCambiar={(o) => { setOrden(o); setErrorDetalle(""); }} />
            <div role="table" aria-label="Tareas que cumplen los filtros" aria-busy={desactualizado || undefined} className={cx("transition-opacity duration-[var(--dur)]", desactualizado && "opacity-60")}>
              <div role="row" className="hidden h-9 items-center gap-3 border-b border-hilo px-4 md:grid md:grid-cols-[88px_minmax(0,1fr)_130px_130px_130px_64px]">
                {COLUMNAS_DETALLE.map((c) => <ColumnaOrdenable key={c.col} etiqueta={c.etiqueta} col={c.col} orden={orden} onOrden={alOrdenar} alinear={c.col === "horas" ? "derecha" : undefined} />)}
              </div>
              {filasDetalle.map((t) => <FilaTabla key={t.id} t={t} hoy={hoy} tono={tono.get(t.estadoNombre) ?? "neutro"} />)}
            </div>
            {errorDetalle && <p role="alert" className="border-t border-hilo px-4 py-2 text-sm text-alerta">{errorDetalle}</p>}
            {totalDetalle > filasDetalle.length && (
              <div className="flex justify-center border-t border-hilo p-3">
                <Boton variante="secundario" onClick={() => void mostrarMas()} disabled={pidiendoMas}>
                  Mostrar {Math.min(PAGINA, totalDetalle - filasDetalle.length)} más
                </Boton>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function FiltroLista({ etiqueta, todas, valor, opciones, onChange }: {
  etiqueta: string; todas: string; valor: string; opciones: { valor: string; etiqueta: string; n: number }[]; onChange: (v: string) => void;
}) {
  return (
    <Campo etiqueta={etiqueta}>
      {(a) => (
        <Selector {...a} value={valor} onChange={(e) => onChange(e.target.value)}>
          <option value="">{todas}</option>
          {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta} ({o.n})</option>)}
        </Selector>
      )}
    </Campo>
  );
}

function FilaTabla({ t, hoy, tono }: { t: FilaDetalle; hoy: string; tono: Tono }) {
  const riesgo = riesgoDe(t, hoy);
  const vencida = riesgo === "vencida";
  return (
    <div role="row" className="grid min-h-12 grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-hilo px-4 py-1.5 last:border-b-0 hover:bg-superficie-2 md:grid-cols-[88px_minmax(0,1fr)_130px_130px_130px_64px]">
      <span role="cell" className="flex flex-col leading-tight">
        {t.entrega ? (
          <>
            <span className="font-mono text-sm font-medium cifras">{fechaCorta(t.entrega)}</span>
            <span className={cx("flex items-center gap-1 text-xs", vencida ? "font-semibold text-alerta" : riesgo === "en_riesgo" ? "text-aviso" : "text-texto-3")}>
              {vencida && <TriangleAlert aria-hidden className="size-3 shrink-0" />}
              {riesgo === "en_riesgo" && <Clock aria-hidden className="size-3 shrink-0" />}
              {(vencida || riesgo === "en_riesgo") && <span className="sr-only">{vencida ? "Vencida, " : "En riesgo, "}</span>}
              {relativo(t.entrega, hoy)}
            </span>
          </>
        ) : <span className="text-texto-3">—</span>}
      </span>
      <span role="cell" className="min-w-0">
        <Link href={`/tareas?tarea=${t.id}`} className="block truncate font-medium underline-offset-4 hover:underline">{t.titulo}</Link>
        {t.cliente && <NombreCliente id={t.clienteId} nombre={t.cliente} className="block max-w-full truncate text-left text-xs text-texto-3" />}
      </span>
      <span role="cell" className="hidden truncate text-sm text-texto-2 md:block">{t.personaNombre}</span>
      <span role="cell" className="hidden truncate text-sm text-texto-2 md:block">{t.unidad}</span>
      <span role="cell" className="flex justify-end md:justify-start"><CeldaEstado texto={t.estadoNombre} tono={tono} /></span>
      <span role="cell" className="hidden text-right font-mono text-sm cifras md:block" title={t.estimada ? undefined : "Sin estimar: cuenta con las horas por defecto"}>
        {numero.format(t.horas)}{t.estimada ? "" : "*"}
      </span>
    </div>
  );
}
