"use client";
import { useMemo } from "react";
import { cx } from "@/components/ui/cx";
import { Panel } from "@/components/ui/panel";
import { CLAVE_OTRAS, cargaPorPersona, entregasPorSemana, estadoPorCliente, repartoPor, type BarraEstado, type Porcion, type Semana } from "@/lib/panel/graficos";
import { GRUPOS_ESTADO, type FilaPanel, type Metrica } from "@/lib/panel/tipos";
import type { FiltrosCruzados } from "@/lib/seguimiento/filtros";
import { lunesDe } from "@/lib/tareas/fechas";
import { fechaCorta } from "../tareas/_componentes/cliente";

/*
 * Graficos del panel de Inicio. Cada uno es una lista de botones (se usan con
 * teclado y lector de pantalla) y un clic filtra a los demas; otro clic lo
 * quita. El elegido se resalta y el resto se atenua, pero el grafico no se
 * filtra a si mismo (ver lib/panel/graficos).
 *
 * Los colores salen de los tonos del catalogo de estados. Dos estados pueden
 * compartir tono, asi que el color nunca va solo: cada barra dice su desglose
 * en el nombre accesible y la leyenda lleva el nombre de cada estado.
 */

const numero = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 1 });

const FONDO_GRUPO: Record<string, string> = {
  pendiente: "bg-aviso", en_curso: "bg-info", revision: "bg-violeta", bloqueada: "bg-alerta", hecha: "bg-bien",
};

type Elegir = (dim: "cliente" | "persona" | "tipo" | "unidad" | "semana" | "estado", valor: string) => void;

type Comun = { filas: FilaPanel[]; filtros: FiltrosCruzados; hoy: string; metrica: Metrica; elegir: Elegir };

export function GraficosPanel({ filas, filtros, hoy, metrica, elegir }: Comun) {
  const clientes = useMemo(() => estadoPorCliente(filas, filtros, hoy, metrica), [filas, filtros, hoy, metrica]);
  const personas = useMemo(() => cargaPorPersona(filas, filtros, hoy, metrica), [filas, filtros, hoy, metrica]);
  const semanas = useMemo(() => entregasPorSemana(filas, filtros, hoy, metrica), [filas, filtros, hoy, metrica]);
  const tipos = useMemo(() => repartoPor(filas, filtros, hoy, metrica, "tipo", "Sin tipo"), [filas, filtros, hoy, metrica]);
  const unidades = useMemo(() => repartoPor(filas, filtros, hoy, metrica, "unidad", "Sin unidad"), [filas, filtros, hoy, metrica]);
  const unidad = metrica === "h" ? "h" : "tareas";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel titulo="Estado por cliente" acciones={<LeyendaEstados filtros={filtros} elegir={elegir} />}>
          <Barras barras={clientes.barras} omitidos={clientes.omitidos} activa={filtros.cliente} unidad={unidad} nombre="cliente"
            onElegir={(v) => elegir("cliente", v)} vacio="No hay tareas con nombre de cliente con estos filtros." />
        </Panel>
        <Panel titulo={filtros.estado ? "Tareas por persona" : "Carga por persona"}>
          <Barras barras={personas.barras} omitidos={personas.omitidos} activa={filtros.persona} unidad={unidad} nombre="persona"
            onElegir={(v) => elegir("persona", v)} vacio={filtros.estado ? "Nadie tiene tareas con estos filtros." : "Nadie tiene tareas abiertas con estos filtros."} />
        </Panel>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-4">
        <Panel titulo="Entregas por semana" className="lg:col-span-2" acciones={<LeyendaSemanas />}>
          <Semanas semanas={semanas.semanas} omitidas={semanas.omitidas} activa={filtros.semana} hoy={hoy} unidad={unidad} onElegir={(v) => elegir("semana", v)} />
        </Panel>
        <Panel titulo="Por tipo de cliente">
          <Dona porciones={tipos} activa={filtros.tipo} unidad={unidad} nombre="tipo de cliente" onElegir={(v) => elegir("tipo", v)} />
        </Panel>
        <Panel titulo="Por unidad">
          <Dona porciones={unidades} activa={filtros.unidad} unidad={unidad} nombre="unidad" onElegir={(v) => elegir("unidad", v)} />
        </Panel>
      </div>
    </div>
  );
}

function SinDatos({ texto }: { texto: string }) {
  return <p className="px-4 py-8 text-sm text-texto-2">{texto}</p>;
}

/* La leyenda es tambien un filtro de estado: pulsar un estado deja solo ese. */
function LeyendaEstados({ filtros, elegir }: { filtros: FiltrosCruzados; elegir: Elegir }) {
  return (
    <ul className="flex flex-wrap justify-end gap-x-1 text-xs text-texto-2" aria-label="Leyenda y filtro de estados">
      {GRUPOS_ESTADO.map((g) => (
        <li key={g.valor}>
          <button type="button" aria-pressed={filtros.estado === g.valor} onClick={() => elegir("estado", g.valor)}
            className={cx("inline-flex h-8 items-center gap-1.5 rounded-sm px-1.5 hover:bg-superficie-2", filtros.estado === g.valor && "bg-superficie-2 font-semibold text-texto")}>
            <span aria-hidden className={cx("size-2.5 rounded-[2px]", FONDO_GRUPO[g.valor])} />{g.rotulo}
          </button>
        </li>
      ))}
    </ul>
  );
}

function LeyendaSemanas() {
  return (
    <ul className="flex flex-wrap gap-x-3 text-xs text-texto-2" aria-label="Leyenda">
      {([["Completadas", "bg-bien"], ["Abiertas", "bg-info"], ["Vencidas", "bg-alerta"]] as const).map(([n, c]) => (
        <li key={n} className="flex items-center gap-1.5"><span aria-hidden className={cx("size-2.5 rounded-[2px]", c)} />{n}</li>
      ))}
    </ul>
  );
}

function descripcion(b: BarraEstado, unidad: string) {
  const partes = GRUPOS_ESTADO.filter((g) => b.porGrupo[g.valor] > 0).map((g) => `${numero.format(b.porGrupo[g.valor])} ${g.rotulo.toLowerCase()}`);
  return `${b.etiqueta}: ${numero.format(b.total)} ${unidad}${b.vencidas ? `, ${numero.format(b.vencidas)} vencidas` : ""}. ${partes.join(", ")}.`;
}

function Barras({ barras, omitidos, activa, unidad, nombre, onElegir, vacio }: {
  barras: BarraEstado[]; omitidos: number; activa: string; unidad: string; nombre: string; onElegir: (v: string) => void; vacio: string;
}) {
  if (!barras.length) return <SinDatos texto={vacio} />;
  const max = Math.max(...barras.map((b) => b.total), 0.0001);
  return (
    <>
      <ol aria-label={`Estado por ${nombre}`} className="divide-y divide-hilo">
        {barras.map((b) => {
          const elegida = activa === b.clave;
          return (
            <li key={b.clave}>
              <button type="button" onClick={() => onElegir(b.clave)} aria-pressed={elegida} aria-label={`${descripcion(b, unidad)} Filtrar el panel.`}
                className={cx("grid min-h-11 w-full grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] items-center gap-3 px-4 text-left transition-[background-color,opacity] duration-[var(--dur)] hover:bg-superficie-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem]",
                  elegida && "bg-superficie-2", activa && !elegida && "opacity-50")}>
                <span className={cx("truncate text-sm", elegida && "font-semibold")}>{b.etiqueta}</span>
                <span aria-hidden className="flex h-3.5 items-stretch">
                  <span className="flex h-full gap-[2px] transition-[width] duration-[var(--dur-vista)] ease-salida motion-reduce:transition-none" style={{ width: `${(b.total / max) * 100}%` }}>
                    {GRUPOS_ESTADO.filter((g) => b.porGrupo[g.valor] > 0).map((g, i, l) => (
                      <span key={g.valor} title={`${g.rotulo}: ${numero.format(b.porGrupo[g.valor])}`}
                        className={cx("h-full min-w-[3px]", FONDO_GRUPO[g.valor], i === l.length - 1 && "rounded-r-[4px]")} style={{ flexGrow: b.porGrupo[g.valor], flexBasis: 0 }} />
                    ))}
                  </span>
                </span>
                <span className="text-right font-mono text-sm cifras">
                  {numero.format(b.total)}
                  {b.vencidas > 0 && <span className="block text-[0.6875rem] leading-none text-alerta">{numero.format(b.vencidas)} venc.</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {omitidos > 0 && <p className="border-t border-hilo px-4 py-2 text-xs text-texto-3">Y {omitidos} más con menos {unidad === "h" ? "horas" : "tareas"}. Filtra para verlos.</p>}
    </>
  );
}

/* De abajo arriba: completadas, abiertas, vencidas; sin las que valen 0. */
function tramos(s: Semana) {
  return ([["hechas", "bg-bien"], ["abiertas", "bg-info"], ["vencidas", "bg-alerta"]] as const)
    .map(([clave, fondo]) => ({ clave, fondo, valor: s[clave] })).filter((r) => r.valor > 0);
}

function Semanas({ semanas, omitidas, activa, hoy, unidad, onElegir }: {
  semanas: Semana[]; omitidas: number; activa: string; hoy: string; unidad: string; onElegir: (v: string) => void;
}) {
  if (!semanas.length) return <SinDatos texto="No hay entregas con estos filtros." />;
  const max = Math.max(...semanas.map((s) => s.total), 0.0001);
  const actual = lunesDe(hoy);
  const salto = Math.ceil(semanas.length / 6);
  return (
    <div className="px-4 pb-3 pt-4">
      <ol aria-label="Entregas por semana" className="flex h-44 items-end gap-1">
        {semanas.map((s, i) => {
          const elegida = activa === s.lunes;
          const texto = `Semana del ${fechaCorta(s.lunes)}: ${numero.format(s.total)} ${unidad}. ${numero.format(s.hechas)} completadas, ${numero.format(s.abiertas)} abiertas, ${numero.format(s.vencidas)} vencidas.`;
          return (
            <li key={s.lunes} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <button type="button" onClick={() => onElegir(s.lunes)} aria-pressed={elegida} aria-label={`${texto} Filtrar el panel.`} title={texto}
                className={cx("group flex h-full w-full flex-col justify-end gap-1 rounded-sm transition-opacity duration-[var(--dur)] hover:bg-superficie-2", elegida && "bg-superficie-2", activa && !elegida && "opacity-50")}>
                <span aria-hidden className="flex w-full flex-col-reverse gap-[2px] transition-[height] duration-[var(--dur-vista)] ease-salida motion-reduce:transition-none" style={{ height: `${(s.total / max) * 82}%` }}>
                  {tramos(s).map((r, j, l) => (
                    <span key={r.clave} className={cx("min-h-[3px] w-full", r.fondo, j === l.length - 1 && "rounded-t-[3px]")} style={{ flexGrow: r.valor, flexBasis: 0 }} />
                  ))}
                </span>
                {/* Sin recorte: la etiqueta puede ser mas ancha que su columna; solo se pinta cada `salto` semanas. */}
                <span aria-hidden className={cx("relative block h-4 font-mono text-[0.625rem] leading-4 text-texto-3 cifras", s.lunes === actual && "font-bold text-texto")}>
                  {i % salto === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{fechaCorta(s.lunes)}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-xs text-texto-3">
        Semana de la entrega, desde su lunes. La actual, en negrita.{omitidas > 0 && ` Se muestran ${semanas.length} semanas; ${omitidas} más quedan fuera: acota el periodo.`}
      </p>
    </div>
  );
}

/* Tonos en orden; al repetirse se atenuan. El numero y el nombre de la leyenda son lo que de verdad identifica cada porcion. */
const TONOS = ["stroke-info", "stroke-bien", "stroke-aviso", "stroke-violeta", "stroke-alerta", "stroke-neutro"];
const FONDOS = ["bg-info", "bg-bien", "bg-aviso", "bg-violeta", "bg-alerta", "bg-neutro"];
const OPACIDAD = ["", "opacity-60", "opacity-35"];

function Dona({ porciones, activa, unidad, nombre, onElegir }: { porciones: Porcion[]; activa: string; unidad: string; nombre: string; onElegir: (v: string) => void }) {
  const total = porciones.reduce((s, p) => s + p.valor, 0);
  if (!porciones.length || total <= 0) return <SinDatos texto="Sin datos con estos filtros." />;
  const R = 15.9155; // circunferencia 100: el arco de cada porcion es su porcentaje
  const arcos = porciones.map((p, i) => ({ parte: (p.valor / total) * 100, antes: porciones.slice(0, i).reduce((a, q) => a + (q.valor / total) * 100, 0) }));
  const estilo = (i: number) => ({ tono: TONOS[i % TONOS.length], fondo: FONDOS[i % FONDOS.length], opacidad: OPACIDAD[Math.min(Math.floor(i / TONOS.length), OPACIDAD.length - 1)] });
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-4">
      <svg viewBox="0 0 42 42" className="size-32 -rotate-90" role="img" aria-label={`Reparto por ${nombre}: ${porciones.map((p) => `${p.etiqueta} ${numero.format(p.valor)}`).join(", ")}`}>
        <circle cx="21" cy="21" r={R} fill="none" className="stroke-hilo" strokeWidth="6" />
        {porciones.map((p, i) => {
          const { parte, antes } = arcos[i];
          const desfase = -antes;
          const e = estilo(i);
          return (
            <circle key={p.clave || "_"} cx="21" cy="21" r={R} fill="none" strokeWidth="6"
              strokeDasharray={`${Math.max(parte - 0.6, 0.1)} ${100 - Math.max(parte - 0.6, 0.1)}`} strokeDashoffset={desfase}
              className={cx(e.tono, e.opacidad, "transition-opacity duration-[var(--dur)]", activa && activa !== p.clave && "opacity-25")} />
          );
        })}
        <text x="21" y="21" textAnchor="middle" dominantBaseline="central" className="rotate-90 origin-center fill-texto font-mono text-[6px]" style={{ transformOrigin: "21px 21px" }}>{numero.format(total)}</text>
      </svg>
      <ul className="flex w-full flex-col" aria-label={`Por ${nombre}`}>
        {porciones.map((p, i) => {
          const e = estilo(i);
          const elegible = p.clave !== "" && p.clave !== CLAVE_OTRAS;
          const contenido = (
            <>
              <span aria-hidden className={cx("size-2.5 shrink-0 rounded-[2px]", e.fondo, e.opacidad)} />
              <span className={cx("min-w-0 flex-1 truncate text-left text-sm", activa === p.clave && "font-semibold")}>{p.etiqueta}</span>
              <span className="font-mono text-sm cifras">{numero.format(p.valor)}</span>
              <span className="w-10 text-right font-mono text-xs text-texto-3 cifras">{Math.round((p.valor / total) * 100)}%</span>
            </>
          );
          return (
            <li key={p.clave || "_"} className="border-t border-hilo first:border-t-0">
              {elegible ? (
                <button type="button" aria-pressed={activa === p.clave} onClick={() => onElegir(p.clave)} aria-label={`${p.etiqueta}: ${numero.format(p.valor)} ${unidad}. Filtrar el panel.`}
                  className={cx("flex min-h-10 w-full items-center gap-2 px-1 hover:bg-superficie-2", activa === p.clave && "bg-superficie-2", activa && activa !== p.clave && "opacity-50")}>{contenido}</button>
              ) : <div className="flex min-h-10 items-center gap-2 px-1 text-texto-2">{contenido}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
