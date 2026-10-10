"use client";
import { useMemo, useState, useTransition } from "react";
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
import { GRUPOS_ESTADO, type EstadoPanel, type FilaPanel, type Metrica } from "@/lib/panel/tipos";
import { pasaFiltros, SIN_FILTROS, type FiltrosCruzados } from "@/lib/seguimiento/filtros";
import { PERIODOS, ROTULO_PERIODO, type Periodo } from "@/lib/seguimiento/periodo";
import { riesgoDe } from "@/lib/seguimiento/riesgo";
import { fechaCorta, relativo } from "../tareas/_componentes/cliente";

const PAGINA_INICIAL = 40;
const PAGINA = 60;
const numero = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 1 });

type Seleccion = "unidad" | "cliente" | "persona" | "tipo" | "estado";

const ROTULO_ESTADO: Record<string, string> = {
  ...Object.fromEntries(GRUPOS_ESTADO.map((g) => [g.valor, g.rotulo])),
  vencida: "Vencidas",
  abierta: "Abiertas",
};

/*
 * Panel de Inicio: filtros cruzados estilo Power BI sobre las tareas que la
 * persona puede ver. El servidor manda las filas del periodo (ya acotadas por
 * visibilidad) y aqui se filtran al instante: cada lista de opciones se
 * calcula sin su propio filtro, para que elegir un cliente no deje la lista de
 * clientes con una sola entrada.
 */
export function PanelInicio({
  filas, estados, hoy, periodo, desde, hasta, truncado, tope,
}: {
  filas: FilaPanel[];
  estados: EstadoPanel[];
  hoy: string;
  periodo: Periodo;
  desde: string;
  hasta: string;
  truncado: boolean;
  tope: number;
}) {
  const router = useRouter();
  const [cambiando, empezar] = useTransition();
  const [filtros, setFiltros] = useState<FiltrosCruzados>(SIN_FILTROS);
  const [metrica, setMetrica] = useState<Metrica>("n");
  const [limite, setLimite] = useState(PAGINA_INICIAL);

  const tono = useMemo(() => new Map(estados.map((e) => [e.nombre, e.tono as Tono])), [estados]);
  const cifras = useMemo(() => resumen(filas, filtros, hoy, metrica), [filas, filtros, hoy, metrica]);
  const opciones = useMemo(() => ({
    unidad: opcionesDe(filas, filtros, hoy, "unidad"),
    cliente: opcionesDe(filas, filtros, hoy, "cliente"),
    persona: opcionesDe(filas, filtros, hoy, "persona"),
    tipo: opcionesDe(filas, filtros, hoy, "tipo"),
  }), [filas, filtros, hoy]);
  /* Lo urgente primero: lo abierto por entrega ascendente y, al final, lo cerrado por entrega descendente. */
  const detalle = useMemo(() => filas.filter((t) => pasaFiltros(t, filtros, hoy)).sort((a, b) => {
    const cerradaA = a.estado === "hecha", cerradaB = b.estado === "hecha";
    if (cerradaA !== cerradaB) return cerradaA ? 1 : -1;
    const x = a.entrega ?? "9999", y = b.entrega ?? "9999";
    return x === y ? a.id - b.id : cerradaA ? (x < y ? 1 : -1) : x < y ? -1 : 1;
  }), [filas, filtros, hoy]);

  const cambiar = (f: FiltrosCruzados) => { setFiltros(f); setLimite(PAGINA_INICIAL); };
  const poner = (dim: Seleccion, valor: string) => cambiar({ ...filtros, [dim]: valor });
  const alternarEstado = (valor: string) => poner("estado", filtros.estado === valor ? "" : valor);

  /* El periodo vive en la URL: cambiarlo pide otras filas al servidor. */
  const ir = (p: Periodo, d = desde, h = hasta) => {
    const q = new URLSearchParams({ vista: "panel" });
    if (p !== "mes") q.set("periodo", p);
    if (p === "rango") { if (d) q.set("desde", d); if (h) q.set("hasta", h); }
    empezar(() => router.replace(`/?${q}`, { scroll: false }));
  };

  const activos: { dim: Seleccion; rotulo: string; texto: string }[] = [];
  const nombreDe = (dim: "unidad" | "cliente" | "persona" | "tipo") => opciones[dim].find((o) => o.valor === filtros[dim])?.etiqueta ?? filtros[dim];
  if (filtros.unidad) activos.push({ dim: "unidad", rotulo: "Unidad", texto: nombreDe("unidad") });
  if (filtros.cliente) activos.push({ dim: "cliente", rotulo: "Cliente", texto: nombreDe("cliente") });
  if (filtros.persona) activos.push({ dim: "persona", rotulo: "Persona", texto: nombreDe("persona") });
  if (filtros.tipo) activos.push({ dim: "tipo", rotulo: "Tipo de cliente", texto: nombreDe("tipo") });
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

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <FiltroLista etiqueta="Unidad" todas="Todas" valor={filtros.unidad} opciones={opciones.unidad} onChange={(v) => poner("unidad", v)} />
          <FiltroLista etiqueta="Cliente" todas="Todos" valor={filtros.cliente} opciones={opciones.cliente} onChange={(v) => poner("cliente", v)} />
          <FiltroLista etiqueta="Persona" todas="Todas" valor={filtros.persona} opciones={opciones.persona} onChange={(v) => poner("persona", v)} />
          <FiltroLista etiqueta="Tipo de cliente" todas="Todos" valor={filtros.tipo} opciones={opciones.tipo} onChange={(v) => poner("tipo", v)} />
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

      {truncado && (
        <p role="status" className="rounded-sm border border-aviso/40 bg-aviso/10 px-3 py-2 text-sm">
          Hay más de {numero.format(tope)} tareas en este periodo y se muestran las {numero.format(tope)} de entrega más próxima. Acota el periodo para verlas todas.
        </p>
      )}

      <Panel titulo="Detalle" acciones={<span className="font-mono text-sm text-texto-2 cifras">{detalle.length} {detalle.length === 1 ? "tarea" : "tareas"}</span>}>
        {!filas.length ? (
          <Vacio titulo="Sin tareas con entrega en este periodo">Prueba con otro periodo o con «Todo». Solo cuentan las tareas que puedes ver.</Vacio>
        ) : !detalle.length ? (
          <Vacio titulo="Ninguna tarea con estos filtros" accion={<Boton onClick={() => cambiar(SIN_FILTROS)}>Quitar todos los filtros</Boton>}>
            Los filtros se combinan entre sí; quita alguno para ampliar el resultado.
          </Vacio>
        ) : (
          <>
            <div role="table" aria-label="Tareas que cumplen los filtros">
              <div role="row" className="hidden h-9 items-center gap-3 border-b border-hilo px-4 md:grid md:grid-cols-[88px_minmax(0,1fr)_130px_130px_130px_64px]">
                <span role="columnheader" className="rotulo">Entrega</span>
                <span role="columnheader" className="rotulo">Tarea</span>
                <span role="columnheader" className="rotulo">Persona</span>
                <span role="columnheader" className="rotulo">Unidad</span>
                <span role="columnheader" className="rotulo">Estado</span>
                <span role="columnheader" className="rotulo text-right">Horas</span>
              </div>
              {detalle.slice(0, limite).map((t) => <FilaDetalle key={t.id} t={t} hoy={hoy} tono={tono.get(t.estadoNombre) ?? "neutro"} />)}
            </div>
            {detalle.length > limite && (
              <div className="flex justify-center border-t border-hilo p-3">
                <Boton variante="secundario" onClick={() => setLimite((l) => l + PAGINA)}>
                  Mostrar {Math.min(PAGINA, detalle.length - limite)} más
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

function FilaDetalle({ t, hoy, tono }: { t: FilaPanel; hoy: string; tono: Tono }) {
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
