"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Contador } from "@/components/ui/contador";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { Panel, Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { usd, usdS } from "@/lib/finanzas/contratos";
import { ROTULO_ESTADO, type Estado } from "@/lib/gastos/reglas";
import { MESES } from "@/lib/horas-extras/reglas";
import type { DatosGastos, GastoDTO } from "@/lib/gastos/servicio";
import { FormularioGasto } from "./gasto-form";
import { FormularioPresupuesto } from "./presupuesto-form";

const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pct = (n: number) => `${Math.round(n * 100)} %`;
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const COLOR_ESTADO: Record<Estado, string> = { sin_presupuesto: "bg-texto-3", bien: "bg-bien", cerca: "bg-aviso", excedido: "bg-alerta" };
const TEXTO_ESTADO: Record<Estado, string> = { sin_presupuesto: "text-texto-3", bien: "text-bien", cerca: "text-aviso", excedido: "text-alerta" };

/*
 * Gastos de una unidad. El servidor manda lo que la persona ve (solo las unidades de su mando) y los totales ya
 * calculados; aqui se filtra la lista. Crear, editar y fijar presupuesto salen solo a quien lidera la unidad (el
 * servidor lo vuelve a comprobar).
 */
export function VistaGastos({ datos }: { datos: DatosGastos }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [navegando, empezar] = useTransition();
  const { anio, unidadId, puedeEditar, resumen: r } = datos;
  const hoy = datos.hoy;

  const [formulario, setFormulario] = useState<{ gasto: GastoDTO | null } | null>(null);
  const [presupuesto, setPresupuesto] = useState<{ categoria: string | null; monto: number } | null>(null);
  const [borrando, setBorrando] = useState<GastoDTO | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [mes, setMes] = useState("");
  const [q, setQ] = useState("");

  const unidad = datos.unidades.find((u) => u.id === unidadId);
  const ir = (cambios: { anio?: number; unidad?: number }) =>
    empezar(() => router.push(`/gastos?unidad=${cambios.unidad ?? unidadId ?? ""}&anio=${cambios.anio ?? anio}`, { scroll: false }));

  const lista = useMemo(() => {
    const buscado = sinTildes(q.trim());
    return datos.gastos.filter((g) =>
      (!categoria || sinTildes(g.categoria) === sinTildes(categoria)) && (!mes || g.fecha.slice(5, 7) === mes)
      && (!buscado || sinTildes(`${g.descripcion} ${g.proveedor} ${g.nota} ${g.categoria}`).includes(buscado)));
  }, [datos.gastos, categoria, mes, q]);
  const totalLista = lista.reduce((a, g) => a + g.monto, 0);
  const hayFiltros = !!(categoria || mes || q.trim());
  const presupuestoDe = new Map(datos.presupuestos.map((p) => [p.categoria.toLowerCase(), p.monto]));
  const maxMes = Math.max(1, ...r.porMes.map((m) => m.gastado));

  async function borrar() {
    if (!borrando) return;
    setTrabajando(true);
    try {
      await pedir(`/api/gastos/${borrando.id}`, { metodo: "DELETE" });
      avisar("Gasto eliminado.", { tipo: "exito" });
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
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Gastos</h1>
        <p className="text-texto-2">{unidad ? `${unidad.nombre} · presupuesto anual por categoría` : "Sin unidades"}</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {unidadId && (
            <a href={`/api/gastos/exportar?unidad=${unidadId}&anio=${anio}`} download
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] hover:bg-superficie-2">
              <Download aria-hidden className="size-4" />Exportar CSV
            </a>
          )}
          {puedeEditar && unidadId && <Boton variante="primario" icono={<Plus className="size-4" aria-hidden />} onClick={() => setFormulario({ gasto: null })}>Nuevo gasto</Boton>}
        </div>
      </header>

      <section aria-label="Año y unidad" className="flex flex-wrap items-end gap-3 rounded-md border border-hilo bg-superficie p-4 shadow-1">
        <div role="group" aria-label="Año" className="flex flex-col gap-1.5">
          <span className="rotulo">Año</span>
          <div className="inline-flex h-10 items-center overflow-hidden rounded-sm border border-hilo-fuerte">
            <button type="button" aria-label={`Año ${anio - 1}`} onClick={() => ir({ anio: anio - 1 })} className="grid h-full w-10 place-items-center hover:bg-superficie-2"><ChevronLeft className="size-4" aria-hidden /></button>
            <span className="min-w-16 px-2 text-center font-mono text-lg font-medium cifras" aria-live="polite">{anio}</span>
            <button type="button" aria-label={`Año ${anio + 1}`} onClick={() => ir({ anio: anio + 1 })} className="grid h-full w-10 place-items-center hover:bg-superficie-2"><ChevronRight className="size-4" aria-hidden /></button>
          </div>
        </div>
        {datos.unidades.length > 1 && (
          <Campo etiqueta="Unidad" className="min-w-52">
            {(a) => (
              <Selector {...a} value={unidadId ?? ""} onChange={(e) => ir({ unidad: Number(e.target.value) })}>
                {datos.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.editable ? "" : " (solo lectura)"}</option>)}
              </Selector>
            )}
          </Campo>
        )}
        {!puedeEditar && unidad && <p className="text-sm text-texto-2">Ves esta unidad por tu cargo de supervisión: solo quien la lidera registra gastos.</p>}
      </section>

      <div role="group" aria-label="Cifras del año" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo shadow-1 md:grid-cols-4">
        <div className="bg-superficie"><Contador compacto rotulo="Gastado" valor={r.gastado} texto={usdS(r.gastado)} detalle={usd(r.gastado)} /></div>
        <div className="bg-superficie"><Contador compacto rotulo="Presupuesto" valor={r.presupuesto} texto={r.presupuesto ? usdS(r.presupuesto) : "—"} detalle={r.presupuesto ? usd(r.presupuesto) : "sin presupuesto"} /></div>
        <div className="bg-superficie">
          <Contador compacto rotulo={r.restante !== null && r.restante < 0 ? "Excedido en" : "Disponible"} valor={Math.abs(r.restante ?? 0)} texto={r.restante === null ? "—" : usdS(Math.abs(r.restante))}
            tono={r.estado === "excedido" ? "alerta" : r.estado === "cerca" ? "aviso" : "bien"} detalle={r.restante === null ? "sin presupuesto" : usd(Math.abs(r.restante))} />
        </div>
        <div className="bg-superficie">
          <Contador compacto rotulo="Presupuesto usado" valor={r.porcentaje ?? 0} texto={r.porcentaje === null ? "—" : pct(r.porcentaje)}
            tono={r.estado === "excedido" ? "alerta" : r.estado === "cerca" ? "aviso" : "info"} detalle={ROTULO_ESTADO[r.estado]} />
        </div>
      </div>

      {datos.truncado && <p role="status" className="rounded-sm border border-aviso/40 bg-aviso/10 px-3 py-2 text-sm">Hay más de 5.000 gastos este año y se muestran los más recientes. Las cifras sí cuentan todos.</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel titulo="Gasto por mes">
          <ul className="grid grid-cols-12 items-end gap-1 px-4 pb-3 pt-6" aria-label={`Gasto mensual de ${anio} en dólares`}>
            {r.porMes.map((m) => (
              <li key={m.mes} title={`${MESES[m.mes - 1]}: ${usd(m.gastado)}`} aria-label={`${MESES[m.mes - 1]}: ${usd(m.gastado)}`} className="flex h-40 min-w-0 flex-col items-center justify-end gap-1">
                <span className="font-mono text-[10px] text-texto-3 cifras">{m.gastado ? usdS(m.gastado).replace("US$", "") : ""}</span>
                <span className={cx("w-full rounded-t-[2px]", m.gastado ? "bg-texto" : "bg-hilo")} style={{ height: `${Math.max(m.gastado ? 4 : 2, (m.gastado / maxMes) * 100)}%` }} />
                <span className="text-[11px] text-texto-2">{MESES[m.mes - 1].slice(0, 3)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel titulo="Por categoría" acciones={puedeEditar && unidadId ? <Boton tamano="sm" variante="secundario" icono={<Plus className="size-3.5" aria-hidden />} onClick={() => setPresupuesto({ categoria: null, monto: 0 })}>Presupuesto</Boton> : undefined}>
          {!r.porCategoria.length ? (
            <Vacio titulo={`Sin gastos ni presupuesto en ${anio}`}>{puedeEditar ? "Registra un gasto o fija un presupuesto por categoría para ver aquí el avance." : "Cuando el líder de la unidad registre gastos, los verás aquí."}</Vacio>
          ) : (
            <ul>
              {r.porCategoria.map((c) => (
                <li key={c.categoria} className="grid gap-x-3 gap-y-1.5 border-b border-hilo px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <button type="button" onClick={() => setCategoria((x) => (sinTildes(x) === sinTildes(c.categoria) ? "" : c.categoria))} aria-pressed={sinTildes(categoria) === sinTildes(c.categoria)}
                        className="truncate text-left font-medium underline-offset-4 hover:underline" title={`Ver solo los gastos de ${c.categoria}`}>{c.categoria}</button>
                      <span className="shrink-0 font-mono text-sm cifras"><strong>{usd(c.gastado)}</strong>{c.presupuesto > 0 && <span className="text-texto-3"> de {usd(c.presupuesto)}</span>}</span>
                    </div>
                    <div role="img" aria-label={c.porcentaje === null ? "Sin presupuesto" : `${pct(c.porcentaje)} del presupuesto: ${ROTULO_ESTADO[c.estado]}`} title={c.porcentaje === null ? "Sin presupuesto" : `${pct(c.porcentaje)} del presupuesto`}
                      className="mt-1.5 h-2 overflow-hidden rounded-full bg-hilo">
                      <span className={cx("block h-full rounded-full", COLOR_ESTADO[c.estado])} style={{ width: `${c.porcentaje === null ? (c.gastado > 0 ? 100 : 0) : Math.min(100, c.porcentaje * 100)}%`, opacity: c.estado === "sin_presupuesto" ? 0.35 : 1 }} />
                    </div>
                    <p className={cx("mt-1 text-xs", TEXTO_ESTADO[c.estado])}>
                      {c.estado === "sin_presupuesto" ? "Sin presupuesto" : c.estado === "excedido" ? `Excedido en ${usd(-c.restante)}` : `${ROTULO_ESTADO[c.estado]} · quedan ${usd(c.restante)}`}
                    </p>
                  </div>
                  {puedeEditar && (
                    <button type="button" aria-label={`${c.presupuesto > 0 ? "Editar" : "Fijar"} el presupuesto de ${c.categoria}`} onClick={() => setPresupuesto({ categoria: c.categoria, monto: presupuestoDe.get(c.categoria.toLowerCase()) ?? c.presupuesto })}
                      className="grid size-10 place-items-center justify-self-end rounded-sm text-texto-3 hover:bg-hundida hover:text-texto"><Pencil className="size-4" aria-hidden /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel titulo="Gastos" acciones={<span className="font-mono text-sm text-texto-2 cifras">{lista.length} · {usd(totalLista)}</span>}>
        <div className="grid grid-cols-2 gap-3 border-b border-hilo px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-end">
          <Campo etiqueta="Categoría">
            {(a) => (
              <Selector {...a} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Todas</option>
                {r.porCategoria.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria}</option>)}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Mes">
            {(a) => (
              <Selector {...a} value={mes} onChange={(e) => setMes(e.target.value)}>
                <option value="">Todo el año</option>
                {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Buscar" className="col-span-2 md:col-span-1">{(a) => <Entrada {...a} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Descripción, proveedor o nota" />}</Campo>
          {hayFiltros && <Boton variante="fantasma" className="col-span-2 md:col-span-1" onClick={() => { setCategoria(""); setMes(""); setQ(""); }}>Quitar filtros</Boton>}
        </div>
        {!datos.gastos.length ? (
          <Vacio titulo={`Sin gastos en ${anio}`} accion={puedeEditar && unidadId ? <Boton variante="primario" onClick={() => setFormulario({ gasto: null })}>Registrar un gasto</Boton> : undefined}>
            {puedeEditar ? "Registra los gastos de la unidad: cada uno suma a su categoría y se mide contra su presupuesto." : "El líder de la unidad aún no ha registrado gastos de este año."}
          </Vacio>
        ) : !lista.length ? (
          <Vacio titulo="Ningún gasto con estos filtros" accion={<Boton onClick={() => { setCategoria(""); setMes(""); setQ(""); }}>Quitar filtros</Boton>} />
        ) : (
          <ul>
            {lista.map((g) => (
              <li key={g.id} data-gasto={g.id} className="grid gap-x-4 gap-y-1 border-b border-hilo px-4 py-3 last:border-b-0 md:grid-cols-[88px_minmax(0,1fr)_auto_auto] md:items-center">
                <p className="font-mono text-sm text-texto-2 cifras">{fecha(g.fecha)}</p>
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.descripcion}</p>
                  <p className="truncate text-sm text-texto-2">{g.categoria}{g.proveedor ? ` · ${g.proveedor}` : ""}{g.nota ? ` · ${g.nota}` : ""}</p>
                </div>
                <p className="font-mono text-base font-medium cifras md:text-right" title={g.registradoPor ? `Registrado por ${g.registradoPor}` : undefined}>{usd(g.monto)}</p>
                <div className="flex justify-end gap-1">
                  {puedeEditar && (
                    <>
                      <button type="button" aria-label={`Editar el gasto «${g.descripcion}»`} onClick={() => setFormulario({ gasto: g })} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-texto"><Pencil className="size-4" aria-hidden /></button>
                      <button type="button" aria-label={`Eliminar el gasto «${g.descripcion}»`} onClick={() => setBorrando(g)} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-alerta"><Trash2 className="size-4" aria-hidden /></button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {unidadId && (
        <>
          <FormularioGasto abierto={formulario !== null} gasto={formulario?.gasto ?? null} unidadId={unidadId} categorias={datos.categorias} hoy={hoy}
            onCerrar={() => setFormulario(null)} onGuardado={(m) => { setFormulario(null); avisar(m, { tipo: "exito" }); router.refresh(); }} />
          <FormularioPresupuesto abierto={presupuesto !== null} categoria={presupuesto?.categoria ?? null} monto={presupuesto?.monto ?? 0} unidadId={unidadId} anio={anio} categorias={datos.categorias}
            onCerrar={() => setPresupuesto(null)} onGuardado={(m) => { setPresupuesto(null); avisar(m, { tipo: "exito" }); router.refresh(); }} />
        </>
      )}

      <Dialogo abierto={borrando !== null} onCerrar={() => setBorrando(null)} titulo="Eliminar gasto" ancho="sm"
        pie={<><Boton onClick={() => setBorrando(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={borrar}>Eliminar gasto</Boton></>}>
        {borrando && <p>Se eliminará «{borrando.descripcion}» ({borrando.categoria}) por <span className="font-mono cifras">{usd(borrando.monto)}</span>. Queda registrado en la actividad. No se puede deshacer.</p>}
      </Dialogo>
    </div>
  );
}
