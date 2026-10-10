"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Contador } from "@/components/ui/contador";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { Panel, Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import {
  filtrarContratos, origenDeMeta, porMesPorUnidad, resumenIngresos, SIN_FILTRO_ING, tablaMensual, tarjetasPorUnidad,
  type ContratoIng, type FiltroIng, type MetasIng,
} from "@/lib/finanzas/agregados";
import { TIPOS_CONTRATO, usd, usdS } from "@/lib/finanzas/contratos";
import type { DatosIngresos } from "@/lib/finanzas/ingresos";
import type { ContratoDTO } from "@/lib/finanzas/servicio";
import { Acumulado, BarraMeta, ColumnasMes, LeyendaUnidades, TablaMensual } from "./graficos";
import { FormularioContrato } from "./contrato-form";
import { MetaEditable } from "./meta-editable";
import { SelectorOrden } from "@/components/ui/orden";
import { ordenarPor, type Orden } from "@/lib/orden";

type ColContrato = "cliente" | "unidad" | "tipo" | "inicio" | "monto" | "anio";
const ORDEN_CONTRATOS: { col: ColContrato; etiqueta: string }[] = [
  { col: "cliente", etiqueta: "Cliente" }, { col: "unidad", etiqueta: "Unidad" }, { col: "tipo", etiqueta: "Tipo" },
  { col: "inicio", etiqueta: "Inicio" }, { col: "monto", etiqueta: "Monto" }, { col: "anio", etiqueta: "Aporte del año" },
];
const CLAVE_CONTRATO: Record<ColContrato, (c: ContratoDTO) => string | number> = {
  cliente: (c) => c.cliente.nombre, unidad: (c) => c.unidad.nombre, tipo: (c) => c.tipo, inicio: (c) => c.inicio, monto: (c) => c.monto, anio: (c) => c.anio?.total ?? 0,
};
const pct = (n: number) => `${(n * 100).toFixed(n >= 1 ? 0 : 1)}%`;
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/*
 * Vista Ingresos. El servidor manda solo los contratos y metas de las unidades
 * que la persona ve; aqui se filtran y se suman. Los botones de crear y editar
 * salen solo donde hay concesion (el servidor lo vuelve a comprobar).
 */
export function VistaIngresos({ datos }: { datos: DatosIngresos }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [navegando, empezar] = useTransition();
  const [filtro, setFiltro] = useState<FiltroIng>(SIN_FILTRO_ING);
  const [por, setPor] = useState<"cliente" | "unidad">("cliente");
  const [formulario, setFormulario] = useState<{ contrato: ContratoDTO | null } | null>(null);
  const [borrando, setBorrando] = useState<ContratoDTO | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [orden, setOrden] = useState<Orden<ColContrato> | null>(null);
  const { anio, hoy } = datos;

  const contratos: ContratoIng[] = useMemo(() => datos.contratos.map((c) => ({
    id: c.id, monto: c.monto, inicio: c.inicio, fin: c.fin, tipo: c.tipo,
    cliente: { id: c.cliente.id, nombre: c.cliente.nombre, tipo: c.cliente.tipo }, unidad: c.unidad,
  })), [datos.contratos]);
  const metas: MetasIng = useMemo(() => ({
    direccion: datos.direccion && datos.direccion.monto > 0 ? datos.direccion.monto : null,
    unidades: Object.fromEntries(datos.unidades.filter((u) => u.monto > 0).map((u) => [u.unidadId as number, u.monto])),
  }), [datos]);
  const unidadesLista = useMemo(() => datos.unidades.map((u) => ({ id: u.unidadId as number, nombre: u.nombre })), [datos.unidades]);

  const r = useMemo(() => resumenIngresos(contratos, metas, anio, hoy, filtro), [contratos, metas, anio, hoy, filtro]);
  const tarjetas = useMemo(() => tarjetasPorUnidad(contratos, unidadesLista, metas, anio, filtro), [contratos, unidadesLista, metas, anio, filtro]);
  const series = useMemo(() => porMesPorUnidad(r.filas), [r.filas]);
  const origen = origenDeMeta(metas);
  const clientesDelAnio = useMemo(() => [...new Map(contratos.map((c) => [c.cliente.id, c.cliente.nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es")), [contratos]);
  const porContrato = !!filtro.clienteId;
  const tabla = useMemo(() => tablaMensual(r.filas, por, porContrato), [r.filas, por, porContrato]);
  const dtoPorId = useMemo(() => new Map(datos.contratos.map((c) => [c.id, c])), [datos.contratos]);
  const visibles = useMemo(() => new Set(filtrarContratos(contratos, filtro).map((c) => c.id)), [contratos, filtro]);
  const filtrada = datos.contratos.filter((c) => visibles.has(c.id));
  const lista = useMemo(() => (orden ? ordenarPor(filtrada, CLAVE_CONTRATO[orden.col], orden.dir) : filtrada), [filtrada, orden]);
  const puedeCrear = datos.puedeCrearEn.length > 0;
  const hayFiltros = !!(filtro.unidadId || filtro.clienteId || filtro.tipo);

  const irAnio = (a: number) => empezar(() => router.push(`/ingresos?anio=${a}`, { scroll: false }));
  const poner = (c: Partial<FiltroIng>) => setFiltro((f) => ({ ...f, ...c }));
  const nombreUnidad = datos.unidades.find((u) => u.unidadId === filtro.unidadId)?.nombre ?? "";
  const nombreCliente = clientesDelAnio.find(([id]) => id === filtro.clienteId)?.[1] ?? "";

  const chips = [
    filtro.unidadId && { k: "unidad", texto: `Unidad: ${nombreUnidad}`, quitar: () => poner({ unidadId: null }) },
    filtro.clienteId && { k: "cliente", texto: `Cliente: ${nombreCliente}`, quitar: () => poner({ clienteId: null }) },
    filtro.tipo && { k: "tipo", texto: `Tipo: ${filtro.tipo}`, quitar: () => poner({ tipo: "" }) },
  ].filter((x): x is { k: string; texto: string; quitar: () => void } => !!x);

  async function borrar() {
    if (!borrando) return;
    setTrabajando(true);
    try {
      await pedir(`/api/finanzas/contratos/${borrando.id}`, { metodo: "DELETE" });
      avisar(`Contrato de ${borrando.cliente.nombre} eliminado.`, { tipo: "exito" });
      setBorrando(null);
      router.refresh();
    } catch (e) {
      avisar(mensajeDe(e), { tipo: "error" });
    } finally {
      setTrabajando(false);
    }
  }

  const acotado = !!(filtro.clienteId || filtro.tipo);

  return (
    <div className={cx("flex flex-col gap-4 transition-opacity duration-[var(--dur)]", navegando && "opacity-60")} aria-busy={navegando}>
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Ingresos</h1>
        <p className="text-texto-2">Contratos repartidos por mes, contra las metas del año</p>
        {puedeCrear && (
          <Boton variante="primario" className="ml-auto" icono={<Plus className="size-4" aria-hidden />} onClick={() => setFormulario({ contrato: null })}>Nuevo contrato</Boton>
        )}
      </header>

      <section aria-label="Filtros" className="flex flex-col gap-3 rounded-md border border-hilo bg-superficie p-4 shadow-1">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[auto_repeat(3,minmax(0,1fr))] md:items-end">
          <div role="group" aria-label="Año" className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
            <span className="rotulo">Año</span>
            <div className="inline-flex h-10 items-center overflow-hidden rounded-sm border border-hilo-fuerte">
              <button type="button" aria-label={`Año ${anio - 1}`} onClick={() => irAnio(anio - 1)} className="grid h-full w-10 place-items-center hover:bg-superficie-2"><ChevronLeft className="size-4" aria-hidden /></button>
              <span className="min-w-16 px-2 text-center font-mono text-lg font-medium cifras" aria-live="polite">{anio}</span>
              <button type="button" aria-label={`Año ${anio + 1}`} onClick={() => irAnio(anio + 1)} className="grid h-full w-10 place-items-center hover:bg-superficie-2"><ChevronRight className="size-4" aria-hidden /></button>
            </div>
          </div>
          <Campo etiqueta="Unidad">
            {(a) => (
              <Selector {...a} value={filtro.unidadId ?? ""} onChange={(e) => poner({ unidadId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Todas</option>
                {datos.unidades.map((u) => <option key={u.unidadId} value={u.unidadId ?? ""}>{u.nombre}</option>)}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Cliente">
            {(a) => (
              <Selector {...a} value={filtro.clienteId ?? ""} onChange={(e) => poner({ clienteId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Todos</option>
                {clientesDelAnio.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Tipo de contrato">
            {(a) => (
              <Selector {...a} value={filtro.tipo} onChange={(e) => poner({ tipo: e.target.value })}>
                <option value="">Todos</option>
                {TIPOS_CONTRATO.map((t) => <option key={t} value={t}>{t}</option>)}
              </Selector>
            )}
          </Campo>
        </div>
        {hayFiltros && (
          <ul aria-label="Filtros activos" className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <li key={c.k}>
                <button type="button" onClick={c.quitar} aria-label={`Quitar el filtro ${c.texto}`} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-sm border border-hilo-fuerte bg-superficie-2 pl-2.5 pr-1.5 text-sm hover:border-texto-3">
                  <span className="truncate">{c.texto}</span><X aria-hidden className="size-4 shrink-0 text-texto-3" />
                </button>
              </li>
            ))}
            <li><Boton variante="fantasma" onClick={() => setFiltro(SIN_FILTRO_ING)}>Quitar todos los filtros</Boton></li>
          </ul>
        )}
      </section>

      {datos.truncado && (
        <p role="status" className="rounded-sm border border-aviso/40 bg-aviso/10 px-3 py-2 text-sm">Hay más de 2.000 contratos en este año y se muestran los más recientes. Filtra por unidad para verlos todos.</p>
      )}

      {!datos.contratos.length ? (
        <Panel titulo={`Contratos de ${anio}`}>
          <Vacio titulo={`Sin contratos con ingreso en ${anio}`} accion={puedeCrear ? <Boton variante="primario" onClick={() => setFormulario({ contrato: null })}>Nuevo contrato</Boton> : undefined}>
            {puedeCrear ? "Registra un contrato: su monto se reparte por mes y aparece aquí contra la meta." : "Cuando alguien con permiso registre contratos de tus unidades, los verás aquí. Prueba con otro año."}
          </Vacio>
        </Panel>
      ) : (
        <>
          <Panel titulo="Avance contra la meta" acciones={r.meta !== null ? <span className="font-mono text-sm text-texto-2 cifras">meta {usd(r.meta)}</span> : <span className="text-sm text-texto-3">sin meta</span>}>
            <div className="grid grid-cols-2 gap-px overflow-hidden border-b border-hilo bg-hilo md:grid-cols-5">
              <div className="bg-superficie"><Contador compacto rotulo="Contratado" valor={r.contratado} texto={usdS(r.contratado)} detalle={usd(r.contratado)} /></div>
              <div className="bg-superficie"><Contador compacto rotulo="Devengado" valor={r.devengado} texto={usdS(r.devengado)} tono="info" detalle={r.mesActual ? `a ${r.mesActual === 12 ? "fin de año" : "este mes"}` : "aún no empieza"} /></div>
              <div className="bg-superficie"><Contador compacto rotulo="Por devengar" valor={r.porDevengar} texto={usdS(r.porDevengar)} detalle={usd(r.porDevengar)} /></div>
              {acotado ? (
                <div className="bg-superficie"><Contador compacto rotulo="En la meta" valor={r.participacion ?? 0} texto={r.participacion === null ? "—" : pct(r.participacion)} tono="bien" detalle={r.participacion === null ? "sin meta" : "de la meta"} /></div>
              ) : (
                <div className="bg-superficie"><Contador compacto rotulo="Falta por contratar" valor={r.faltaPorContratar ?? 0} texto={r.faltaPorContratar === null ? "—" : usdS(r.faltaPorContratar)} tono="aviso" detalle={r.faltaPorContratar === null ? "sin meta" : usd(r.faltaPorContratar)} /></div>
              )}
              <div className="bg-superficie">
                <Contador compacto rotulo="Contra el ritmo" valor={Math.abs(r.contraRitmo ?? 0)} tono={r.contraRitmo !== null && r.contraRitmo < 0 ? "alerta" : "bien"}
                  texto={r.contraRitmo === null ? "—" : `${r.contraRitmo > 0 ? "+" : r.contraRitmo < 0 ? "-" : ""}${usdS(Math.abs(r.contraRitmo))}`}
                  detalle={r.contraRitmo === null ? (acotado ? "con filtro no aplica" : "sin meta") : r.contraRitmo >= 0 ? "adelantados" : "atrasados"} />
              </div>
              <div aria-hidden className="bg-superficie md:hidden" />
            </div>
            <div className="flex flex-col gap-4 p-4">
              <BarraMeta meta={r.meta} contratado={r.contratado} devengado={r.devengado} ritmo={r.ritmo} />
              {!filtro.unidadId && (origen.fijada !== null || origen.sumaUnidades > 0) && (
                <p className="text-sm text-texto-2">
                  {origen.fijada === null
                    ? <>La meta es la <strong>suma de las metas de las unidades</strong> que ves: <span className="font-mono text-texto cifras">{usd(origen.sumaUnidades)}</span>. Se calcula sola.</>
                    : <>Meta <strong>fijada a mano</strong>: <span className="font-mono text-texto cifras">{usd(origen.fijada)}</span>. Las unidades suman <span className="font-mono text-texto cifras">{usd(origen.sumaUnidades)}</span>.</>}
                </p>
              )}
              {datos.direccion?.puedeEditar && !filtro.unidadId && (
                <div className="max-w-sm">
                  <MetaEditable key={`d${anio}${datos.direccion.monto}`} anio={anio} unidadId={null} nombre="la dirección" monto={datos.direccion.monto} puedeEditar
                    etiqueta={`Meta total ${anio} fijada a mano (US$)`} placeholder={origen.sumaUnidades > 0 ? `Suma: ${origen.sumaUnidades}` : "Suma de las unidades"}
                    ayuda="Opcional. Déjala vacía para que sea la suma de las metas de las unidades." volverALaSuma={datos.direccion.monto > 0} />
                </div>
              )}
            </div>
          </Panel>

          <section aria-label="Unidades" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tarjetas.map((t) => {
              const u = datos.unidades.find((x) => x.unidadId === t.unidadId)!;
              const elegida = filtro.unidadId === t.unidadId;
              return (
                <article key={t.unidadId} className={cx("flex flex-col gap-3 rounded-md border bg-superficie p-4 shadow-1", elegida ? "border-texto" : "border-hilo")}>
                  <header className="flex items-baseline justify-between gap-2">
                    <button type="button" aria-pressed={elegida} onClick={() => poner({ unidadId: elegida ? null : t.unidadId })} className="min-w-0 truncate text-left font-rotulo text-sm font-semibold uppercase tracking-[0.12em] underline-offset-4 hover:underline">{t.nombre}</button>
                    {t.porMeta !== null && <span className="font-mono text-sm text-texto-2 cifras">{pct(t.porMeta)}</span>}
                  </header>
                  <p className="font-mono text-2xl font-medium cifras" title={usd(t.total)}>{usdS(t.total)}</p>
                  <div role="img" aria-label={t.meta ? `${usd(t.total)} de una meta de ${usd(t.meta)}` : `${usd(t.total)}, sin meta`} className="h-2 rounded-sm bg-hundida">
                    <div className="h-full rounded-sm bg-info transition-[width] duration-[var(--dur-vista)] ease-salida motion-reduce:transition-none" style={{ width: `${Math.min(100, (t.porMeta ?? 0) * 100)}%` }} />
                  </div>
                  {t.pesoEnMeta !== null && <p className="text-xs text-texto-3">Pesa <span className="font-mono cifras">{pct(t.pesoEnMeta)}</span> de la meta total</p>}
                  <MetaEditable key={`${t.unidadId}-${anio}-${u.monto}`} anio={anio} unidadId={t.unidadId} nombre={t.nombre} monto={u.monto} puedeEditar={u.puedeEditar} />
                </article>
              );
            })}
          </section>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel titulo="Ingreso por mes" acciones={undefined}>
              <div className="px-4 pt-3"><LeyendaUnidades series={series} /></div>
              {r.contratado > 0 ? <ColumnasMes series={series} mesActual={r.mesActual} metaMensual={r.metaMensual} /> : <p className="px-4 py-8 text-sm text-texto-2">Con estos filtros no hay ingreso en {anio}.</p>}
            </Panel>
            <Panel titulo="Acumulado del año">
              {r.contratado > 0 ? <Acumulado acumulado={r.acumulado} mesActual={r.mesActual} meta={r.meta} /> : <p className="px-4 py-8 text-sm text-texto-2">Con estos filtros no hay ingreso en {anio}.</p>}
            </Panel>
          </div>

          <Panel titulo="Mes a mes" acciones={
            !porContrato ? (
              <div role="group" aria-label="Agrupar por" className="inline-flex h-8 overflow-hidden rounded-sm border border-hilo-fuerte">
                {([["cliente", "Por cliente"], ["unidad", "Por unidad"]] as const).map(([v, t]) => (
                  <button key={v} type="button" aria-pressed={por === v} onClick={() => setPor(v)}
                    className={cx("px-3 font-rotulo text-xs font-semibold uppercase tracking-[0.1em]", por === v ? "bg-texto text-superficie" : "text-texto-2 hover:bg-superficie-2")}>{t}</button>
                ))}
              </div>
            ) : <span className="text-sm text-texto-2">Contratos de {nombreCliente}</span>
          }>
            {tabla.length ? (
              <TablaMensual filas={tabla} etiqueta={porContrato ? "Contrato" : por === "cliente" ? "Cliente" : "Unidad"} meta={r.meta} metaMensual={r.metaMensual} mesActual={r.mesActual}
                ariaLabel={`Ingreso mensual de ${anio} en dólares`}
                onElegir={(clave) => {
                  if (clave.startsWith("cl")) poner({ clienteId: Number(clave.slice(2)) });
                  else if (clave.startsWith("u")) poner({ unidadId: Number(clave.slice(1)) });
                }} />
            ) : <p className="px-4 py-8 text-sm text-texto-2">Con estos filtros no hay contratos con ingreso en {anio}.</p>}
          </Panel>

          <Panel titulo="Contratos" acciones={<span className="font-mono text-sm text-texto-2 cifras">{lista.length}</span>}>
            {lista.length > 1 && <SelectorOrden className="border-b border-hilo px-4 py-2" opciones={ORDEN_CONTRATOS} orden={orden} onCambiar={setOrden} vacio="Más recientes primero" />}
            {!lista.length ? <Vacio titulo="Ningún contrato con estos filtros" accion={<Boton onClick={() => setFiltro(SIN_FILTRO_ING)}>Quitar todos los filtros</Boton>} /> : (
              <ul>
                {lista.map((c) => (
                  <li key={c.id} className="grid gap-x-4 gap-y-1 border-b border-hilo px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <button type="button" onClick={() => poner({ clienteId: c.cliente.id })} className="block max-w-full truncate text-left font-medium underline-offset-4 hover:underline">{c.cliente.nombre}</button>
                      <p className="truncate text-sm text-texto-2">{c.unidad.nombre} · {c.tipo}{c.asigna ? ` · asigna ${c.asigna.nombre}` : ""}</p>
                    </div>
                    <p className="font-mono text-sm text-texto-2 cifras">{fecha(c.inicio)} – {fecha(c.fin)}<span className="block text-xs text-texto-3">{c.meses} {c.meses === 1 ? "mes" : "meses"}</span></p>
                    <p className="font-mono text-sm cifras"><span title="Monto total">{usd(c.monto)}</span><span className="block text-xs text-texto-3">{usd(c.porMes)} por mes</span></p>
                    <p className="font-mono text-sm cifras md:text-right"><span className="text-xs text-texto-3">{anio}: </span><strong>{usd(c.anio?.total ?? 0)}</strong>{r.meta ? <span className="block text-xs text-texto-3 md:text-right">{(((c.anio?.total ?? 0) / r.meta) * 100).toFixed(1)}% de la meta</span> : null}</p>
                    <div className="flex justify-end gap-1">
                      {c.puedeEditar && (
                        <>
                          <button type="button" aria-label={`Editar el contrato de ${c.cliente.nombre} en ${c.unidad.nombre}`} onClick={() => setFormulario({ contrato: dtoPorId.get(c.id)! })} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-texto"><Pencil className="size-4" aria-hidden /></button>
                          <button type="button" aria-label={`Eliminar el contrato de ${c.cliente.nombre} en ${c.unidad.nombre}`} onClick={() => setBorrando(c)} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-alerta"><Trash2 className="size-4" aria-hidden /></button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      <FormularioContrato
        abierto={formulario !== null}
        contrato={formulario?.contrato ?? null}
        unidades={datos.puedeCrearEn}
        todasLasUnidades={datos.todasLasUnidades}
        clientes={datos.clientes}
        anio={anio}
        onCerrar={() => setFormulario(null)}
        onGuardado={(m) => { setFormulario(null); avisar(m, { tipo: "exito" }); router.refresh(); }}
      />

      <Dialogo abierto={borrando !== null} onCerrar={() => setBorrando(null)} titulo="Eliminar contrato" ancho="sm"
        pie={<><Boton onClick={() => setBorrando(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={borrar}>Eliminar contrato</Boton></>}>
        {borrando && <p>Se eliminará el contrato de <strong>{borrando.cliente.nombre}</strong> en {borrando.unidad.nombre} por <span className="font-mono cifras">{usd(borrando.monto)}</span>. Sus ingresos salen de todos los años. No se puede deshacer.</p>}
      </Dialogo>
    </div>
  );
}
