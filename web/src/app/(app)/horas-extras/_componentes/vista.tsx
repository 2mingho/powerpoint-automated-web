"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Contador } from "@/components/ui/contador";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { Panel, Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import type { EntradaHoras } from "@/lib/horas-extras/agregados";
import { MESES, periodoAnterior, ROTULO_NIVEL, rotuloPeriodo, type Aviso, type Mitad, type Nivel, type Periodo } from "@/lib/horas-extras/reglas";
import type { DatosHorasExtras } from "@/lib/horas-extras/servicio";
import { FormularioHoras } from "./registro-form";

const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const mesCorto = (m: number) => MESES[m - 1].slice(0, 3);

/* Mismas tintas que el mapa de calor de Equipo: el color refuerza, las horas van siempre escritas. */
const FONDO: Record<Nivel, string> = { 0: "bg-superficie-2", 1: "bg-bien/15", 2: "bg-bien/35", 3: "bg-aviso/40", 4: "bg-alerta/40" };
const RANGOS: Record<Nivel, string> = { 0: "< 50 %", 1: "50–75 %", 2: "75–90 %", 3: "90–100 %", 4: "> 100 %" };
const TEXTO_AVISO: Record<Aviso, string> = { "": "", cerca: "Cerca del máximo", excedido: "Pasó del máximo" };

/*
 * Horas extras de la unidad. El servidor manda el reporte de la quincena vista y la matriz de su trimestre; aqui se
 * pintan. Registrar, editar y borrar salen solo a quien lidera la unidad (el servidor lo vuelve a comprobar). Pasarse
 * del maximo avisa y se ve en el mapa, pero no bloquea.
 */
export function VistaHorasExtras({ datos }: { datos: DatosHorasExtras }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [navegando, empezar] = useTransition();
  const { periodo, unidad, matriz, reporte, puedeEditar } = datos;
  const [formulario, setFormulario] = useState<{ registro: EntradaHoras | null } | null>(null);
  const [borrando, setBorrando] = useState<EntradaHoras | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const ir = (c: { periodo?: Partial<Periodo>; unidad?: number }) => {
    const p = { ...periodo, ...c.periodo };
    empezar(() => router.push(`/horas-extras?unidad=${c.unidad ?? unidad?.id ?? ""}&anio=${p.anio}&mes=${p.mes}&mitad=${p.mitad}`, { scroll: false }));
  };
  const mover = (delta: number) => {
    // Una quincena hacia delante o hacia atras.
    let p = periodo;
    if (delta < 0) p = periodoAnterior(p);
    else p = p.mitad === 15 ? { ...p, mitad: 30 } : p.mes === 12 ? { anio: p.anio + 1, mes: 1, mitad: 15 } : { anio: p.anio, mes: p.mes + 1, mitad: 15 };
    ir({ periodo: p });
  };

  const horasPorPersona = useMemo(() => new Map(matriz.filas.map((f) => [f.personaId, f.total])), [matriz.filas]);
  const hayHoras = matriz.total > 0;
  const filasCalor = matriz.filas.filter((f) => f.total > 0);
  const sinHoras = matriz.filas.filter((f) => f.total === 0);
  const excedidos = matriz.filas.filter((f) => f.aviso === "excedido").length;
  const cercanos = matriz.filas.filter((f) => f.aviso === "cerca").length;

  async function borrar() {
    if (!borrando) return;
    setTrabajando(true);
    try {
      await pedir(`/api/horas-extras/${borrando.id}`, { metodo: "DELETE" });
      avisar("Horas extras eliminadas.", { tipo: "exito" });
      setBorrando(null);
      router.refresh();
    } catch (e) {
      avisar(mensajeDe(e), { tipo: "error" });
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className={cx("flex flex-col gap-4 transition-opacity duration-[var(--dur)]", navegando && "opacity-60")} aria-busy={navegando}>
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Horas extras</h1>
        <p className="text-texto-2">{unidad ? `${unidad.nombre} · máximo ${num(unidad.limite)} h por persona y trimestre` : "Sin unidades"}</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {unidad && (
            <a href={`/api/horas-extras/exportar?unidad=${unidad.id}&anio=${periodo.anio}&mes=${periodo.mes}&mitad=${periodo.mitad}`} download
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] hover:bg-superficie-2">
              <Download aria-hidden className="size-4" />Exportar Excel
            </a>
          )}
          {puedeEditar && unidad && <Boton variante="primario" icono={<Plus className="size-4" aria-hidden />} onClick={() => setFormulario({ registro: null })}>Registrar horas</Boton>}
        </div>
      </header>

      <section aria-label="Reporte y unidad" className="flex flex-wrap items-end gap-3 rounded-md border border-hilo bg-superficie p-4 shadow-1">
        <div role="group" aria-label="Quincena" className="flex flex-col gap-1.5">
          <span className="rotulo">Reporte</span>
          <div className="inline-flex h-10 items-center overflow-hidden rounded-sm border border-hilo-fuerte">
            <button type="button" aria-label="Quincena anterior" onClick={() => mover(-1)} className="grid h-full w-10 place-items-center hover:bg-superficie-2"><ChevronLeft className="size-4" aria-hidden /></button>
            <span className="min-w-56 px-3 text-center font-mono text-sm font-medium cifras" aria-live="polite">{rotuloPeriodo(periodo, false)}</span>
            <button type="button" aria-label="Quincena siguiente" onClick={() => mover(1)} className="grid h-full w-10 place-items-center hover:bg-superficie-2"><ChevronRight className="size-4" aria-hidden /></button>
          </div>
        </div>
        <Campo etiqueta="Mes" className="w-40">
          {(a) => <Selector {...a} value={periodo.mes} onChange={(e) => ir({ periodo: { mes: Number(e.target.value) } })}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Selector>}
        </Campo>
        <Campo etiqueta="Quincena" className="w-44">
          {(a) => (
            <Selector {...a} value={periodo.mitad} onChange={(e) => ir({ periodo: { mitad: Number(e.target.value) as Mitad } })}>
              <option value={15}>1ra (hasta el 15)</option><option value={30}>2da (del 16 al fin)</option>
            </Selector>
          )}
        </Campo>
        {datos.unidades.length > 1 && (
          <Campo etiqueta="Unidad" className="min-w-52">
            {(a) => (
              <Selector {...a} value={unidad?.id ?? ""} onChange={(e) => ir({ unidad: Number(e.target.value) })}>
                {datos.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.editable ? "" : " (solo lectura)"}</option>)}
              </Selector>
            )}
          </Campo>
        )}
        {!puedeEditar && unidad && <p className="text-sm text-texto-2">Ves esta unidad por tu cargo de supervisión: solo quien la lidera registra horas.</p>}
      </section>

      <div role="group" aria-label="Cifras del reporte" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo shadow-1 md:grid-cols-4">
        <div className="bg-superficie"><Contador rotulo="Total del reporte" valor={reporte.total} texto={`${num(reporte.total)} h`} detalle={rotuloPeriodo(periodo, false)} /></div>
        <div className="bg-superficie"><Contador rotulo="Colaboradores" valor={reporte.colaboradores} /></div>
        <div className="bg-superficie"><Contador rotulo="Lunes a viernes" valor={reporte.laborables} texto={`${num(reporte.laborables)} h`} tono="info" /></div>
        <div className="bg-superficie"><Contador rotulo="Sábado y domingo" valor={reporte.finDeSemana} texto={`${num(reporte.finDeSemana)} h`} tono="violeta" /></div>
      </div>

      <Panel titulo={`Mapa de calor · T${datos.trimestre} ${periodo.anio}`} acciones={
        <span className="text-sm text-texto-2">
          {excedidos > 0 ? <strong className="text-alerta">{excedidos} pasada{excedidos === 1 ? "" : "s"} del máximo</strong> : cercanos > 0 ? <strong className="text-aviso">{cercanos} cerca del máximo</strong> : "todos dentro del máximo"}
        </span>
      }>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-hilo px-4 py-2 text-xs text-texto-2" aria-label="Leyenda del mapa de calor">
          {([0, 1, 2, 3, 4] as const).map((n) => (
            <li key={n} className="flex items-center gap-1.5">
              <span aria-hidden className={cx("size-3 rounded-[2px] border border-hilo", FONDO[n])} />{ROTULO_NIVEL[n]}<span className="font-mono cifras text-texto-3">{RANGOS[n]}</span>
            </li>
          ))}
        </ul>
        {!hayHoras ? (
          <Vacio titulo={`Sin horas extras en T${datos.trimestre} ${periodo.anio}`}>{puedeEditar ? "Registra horas extras de tu equipo: aquí verás cuánto lleva cada persona contra el máximo del trimestre." : "Cuando el líder de la unidad registre horas extras, las verás aquí."}</Vacio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-hilo">
                  <th scope="col" className="rotulo w-28 px-3 py-2 text-left sm:w-48 sm:px-4">Persona</th>
                  <th scope="col" className="rotulo w-28 px-1 py-2 text-center sm:w-40">Trimestre</th>
                  {matriz.periodos.map((p) => (
                    <th key={`${p.mes}-${p.mitad}`} scope="col" className="rotulo px-0.5 py-2 text-center">
                      <span className="font-mono cifras">{mesCorto(p.mes)} {p.mitad}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasCalor.map((f) => (
                  <tr key={f.personaId} className="border-b border-hilo last:border-b-0">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal sm:px-4"><span className="block truncate">{f.nombre}</span></th>
                    <td className="p-0.5">
                      <div tabIndex={0} role="img" aria-label={`${f.nombre}, trimestre: ${num(f.total)} de ${num(f.limite)} h${f.aviso ? `. ${TEXTO_AVISO[f.aviso]}` : ""}`}
                        title={`${num(f.total)} de ${num(f.limite)} h${f.restante >= 0 ? ` · quedan ${num(f.restante)}` : ` · ${num(-f.restante)} de más`}`}
                        className={cx("flex h-11 flex-col items-center justify-center rounded-sm leading-tight", FONDO[f.nivel], f.nivel >= 3 && "font-semibold")}>
                        <span className="font-mono cifras">{num(f.total)} / {num(f.limite)}</span>
                        <span className={cx("text-[0.6875rem]", f.aviso === "excedido" ? "text-alerta" : "text-texto-2")}>{f.aviso ? TEXTO_AVISO[f.aviso] : `quedan ${num(f.restante)}`}</span>
                      </div>
                    </td>
                    {f.celdas.map((c) => {
                      const actual = c.periodo.mes === periodo.mes && c.periodo.mitad === periodo.mitad;
                      const texto = `${f.nombre}, ${rotuloPeriodo(c.periodo, false)}: ${num(c.horas)} h (${ROTULO_NIVEL[c.nivel].toLowerCase()} frente al ritmo de ${num(Math.round(matriz.ritmo * 10) / 10)} h por quincena)`;
                      return (
                        <td key={`${c.periodo.mes}-${c.periodo.mitad}`} className="p-0.5">
                          <div tabIndex={0} role="img" aria-label={texto} title={texto}
                            className={cx("flex h-11 items-center justify-center rounded-sm font-mono cifras", FONDO[c.nivel], c.nivel >= 3 && "font-semibold", actual && "outline outline-2 -outline-offset-2 outline-texto")}>
                            {c.horas ? num(c.horas) : "—"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-hilo font-mono text-xs text-texto-2 cifras">
                  <th scope="row" className="px-3 py-2 text-left font-normal sm:px-4">Total</th>
                  <td className="py-2 text-center font-medium text-texto">{num(matriz.total)}</td>
                  {matriz.totalesPorPeriodo.map((t, i) => <td key={i} className="py-2 text-center">{t ? num(t) : "—"}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {sinHoras.length > 0 && hayHoras && (
          <details className="border-t border-hilo px-4 py-2 text-sm">
            <summary className="cursor-pointer text-texto-2">{sinHoras.length === 1 ? "1 persona sin horas extras" : `${sinHoras.length} personas sin horas extras`} este trimestre</summary>
            <p className="mt-2 text-texto-2">{sinHoras.map((f) => f.nombre).join(", ")}</p>
          </details>
        )}
        <p className="border-t border-hilo px-4 py-2 text-xs text-texto-3">Cada quincena se colorea contra el ritmo que lleva al máximo ({num(Math.round(matriz.ritmo * 10) / 10)} h por quincena); el trimestre, contra el máximo de {unidad ? num(unidad.limite) : 80} h. La quincena que ves está resaltada.</p>
      </Panel>

      <Panel titulo={`Reporte de la ${rotuloPeriodo(periodo, false)}`} acciones={<span className="font-mono text-sm text-texto-2 cifras">{num(reporte.total)} h · {reporte.colaboradores} {reporte.colaboradores === 1 ? "persona" : "personas"}</span>}>
        {!reporte.bloques.length ? (
          <Vacio titulo="Sin horas extras en este reporte" accion={puedeEditar && unidad ? <Boton variante="primario" onClick={() => setFormulario({ registro: null })}>Registrar horas</Boton> : undefined}>
            {puedeEditar ? "Registra las horas de cada persona con su día, detalle y horario. Se segmentan solas en lunes a viernes y sábado y domingo." : "Prueba con otra quincena."}
          </Vacio>
        ) : (
          <div>
            {reporte.bloques.map((b) => (
              <section key={b.personaId} aria-label={`Horas de ${b.nombre}`} className="border-b border-hilo last:border-b-0">
                <h3 className="flex items-baseline justify-between gap-3 bg-superficie-2 px-4 py-2 font-rotulo text-sm font-semibold uppercase tracking-[0.1em]">
                  <span>{b.nombre}</span>
                  <span className="font-mono text-xs font-normal normal-case tracking-normal text-texto-2 cifras">L-V {num(b.laborables)} · SAB-DOM {num(b.finDeSemana)} · <strong className="text-texto">{num(b.total)} h</strong></span>
                </h3>
                <ul>
                  {b.filas.map((f) => (
                    <li key={f.id} data-horas={f.id} className="grid gap-x-4 gap-y-1 border-t border-hilo px-4 py-2.5 first:border-t-0 md:grid-cols-[88px_minmax(0,1fr)_minmax(0,0.8fr)_64px_auto] md:items-center">
                      <p className="font-mono text-sm text-texto-2 cifras">{fecha(f.fecha)}<span className="block text-xs text-texto-3">{f.finDeSemana ? "SAB-DOM" : "L-V"}</span></p>
                      <p className="min-w-0 truncate" title={f.detalle}>{f.detalle}</p>
                      <p className="truncate text-sm text-texto-2" title={f.horario}>{f.horario || "—"}</p>
                      <p className="font-mono text-base font-medium cifras md:text-right">{num(f.horas)} h</p>
                      <div className="flex justify-end gap-1">
                        {puedeEditar && (
                          <>
                            <button type="button" aria-label={`Editar las horas de ${b.nombre} del ${fecha(f.fecha)}`} onClick={() => setFormulario({ registro: f })} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-texto"><Pencil className="size-4" aria-hidden /></button>
                            <button type="button" aria-label={`Eliminar las horas de ${b.nombre} del ${fecha(f.fecha)}`} onClick={() => setBorrando(f)} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-alerta"><Trash2 className="size-4" aria-hidden /></button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>

      {unidad && (
        <FormularioHoras abierto={formulario !== null} registro={formulario?.registro ?? null} personas={datos.personas} periodoVisto={periodo} limite={unidad.limite}
          horasDeCadaPersona={horasPorPersona}
          onCerrar={() => setFormulario(null)} onGuardado={(m, tipo) => { setFormulario(null); avisar(m, { tipo }); router.refresh(); }} />
      )}

      <Dialogo abierto={borrando !== null} onCerrar={() => setBorrando(null)} titulo="Eliminar horas extras" ancho="sm"
        pie={<><Boton onClick={() => setBorrando(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={borrar}>Eliminar horas</Boton></>}>
        {borrando && <p>Se eliminarán las <span className="font-mono cifras">{num(borrando.horas)} h</span> de <strong>{borrando.personaNombre}</strong> del {fecha(borrando.fecha)}. Quedan registradas en la actividad. No se puede deshacer.</p>}
      </Dialogo>
    </div>
  );
}
