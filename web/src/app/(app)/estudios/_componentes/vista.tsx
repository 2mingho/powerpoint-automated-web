"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { NombreCliente } from "@/components/clientes/ficha";
import { BarraFases, PasosPorFase } from "@/components/estudios/fases";
import { useAvisos } from "@/components/ui/avisos";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { Panel, Vacio } from "@/components/ui/panel";
import { fDia } from "@/lib/admin/formato";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import type { EstudioDTO, FiltroEstudios } from "@/lib/estudios/servicio";
import { usd, usdS } from "@/lib/finanzas/contratos";
import type { EstadoCatalogo, PersonaDTO } from "@/lib/tareas/tipos";
import { tonoEstado } from "../../tareas/_componentes/cliente";
import { FormularioEstudio } from "./formulario";

const ESTADOS: { valor: FiltroEstudios["estado"]; rotulo: string }[] = [
  { valor: "abiertos", rotulo: "Abiertos" },
  { valor: "cerrados", rotulo: "Cerrados" },
  { valor: "todos", rotulo: "Todos" },
];

const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function VistaEstudios({ estudios, puedeCrear, estado, abierto, estados, personas, clientes, unidadesContrato, hoy }: {
  estudios: EstudioDTO[];
  puedeCrear: boolean;
  estado: FiltroEstudios["estado"];
  abierto: number | null;
  estados: EstadoCatalogo[];
  personas: PersonaDTO[];
  clientes: string[];
  unidadesContrato: number[];
  hoy: string;
}) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [busqueda, setBusqueda] = useState("");
  const [desplegado, setDesplegado] = useState<Set<number>>(() => new Set(abierto ? [abierto] : []));
  const [formulario, setFormulario] = useState<{ estudio: EstudioDTO | null } | null>(null);
  const [borrando, setBorrando] = useState<EstudioDTO | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const enfocado = useRef<HTMLLIElement | null>(null);

  // Llegar con ?estudio=ID (desde un aviso o desde el pase) lo abre y lo trae a la vista.
  useEffect(() => { if (abierto) enfocado.current?.scrollIntoView({ block: "center" }); }, [abierto]);

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return q ? estudios.filter((e) => sinTildes(`${e.titulo} ${e.cliente} ${e.responsable}`).includes(q)) : estudios;
  }, [estudios, busqueda]);

  const alternar = (id: number) => setDesplegado((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tonoDe = (n: string) => tonoEstado(estados, n);

  async function borrar() {
    if (!borrando) return;
    setTrabajando(true);
    try {
      const r = await pedir<{ pasos: number }>(`/api/estudios/${borrando.id}`, { metodo: "DELETE" });
      const id = borrando.id;
      avisar(`Estudio «${borrando.titulo}» eliminado con sus ${r.pasos} pasos.`, {
        tipo: "exito",
        deshacer: () => { void pedir(`/api/tareas/${id}/restaurar`, { cuerpo: {} }).then(() => { avisar("Borrado deshecho."); router.refresh(); }).catch((e) => avisar(mensajeDe(e), { tipo: "error" })); },
      });
      setBorrando(null);
      router.refresh();
    } catch (e) {
      avisar(mensajeDe(e), { tipo: "error" });
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Estudios</h1>
        <p className="text-texto-2">Avance por fases; los pasos se trabajan como tareas</p>
        {puedeCrear && <Boton variante="primario" className="ml-auto" icono={<Plus className="size-4" aria-hidden />} onClick={() => setFormulario({ estudio: null })}>Nuevo estudio</Boton>}
      </header>

      <section aria-label="Filtros" className="flex flex-wrap items-center gap-3">
        <nav aria-label="Estado de los estudios" className="inline-flex h-10 overflow-hidden rounded-sm border border-hilo-fuerte">
          {ESTADOS.map((e) => (
            <Link key={e.valor} href={e.valor === "abiertos" ? "/estudios" : `/estudios?estado=${e.valor}`} aria-current={estado === e.valor ? "page" : undefined}
              className={cx("grid place-items-center px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em]", estado === e.valor ? "bg-texto text-superficie" : "text-texto-2 hover:bg-superficie-2")}>{e.rotulo}</Link>
          ))}
        </nav>
        <Entrada type="search" aria-label="Buscar un estudio" placeholder="Buscar por nombre, cliente o responsable" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="max-w-sm" />
        <span className="ml-auto font-mono text-sm text-texto-2 cifras">{visibles.length} {visibles.length === 1 ? "estudio" : "estudios"}</span>
      </section>

      {!visibles.length ? (
        <Panel titulo="Estudios">
          <Vacio titulo={estudios.length ? "Ningún estudio coincide" : estado === "cerrados" ? "Aún no hay estudios cerrados" : "No hay estudios abiertos"}
            accion={puedeCrear && !estudios.length ? <Boton variante="primario" onClick={() => setFormulario({ estudio: null })}>Nuevo estudio</Boton> : undefined}>
            {estudios.length ? "Prueba con otra búsqueda." : puedeCrear ? "Crea un estudio: se arman solos sus pasos, fases y fechas." : "Cuando tu unidad cree estudios, los verás aquí con su avance."}
          </Vacio>
        </Panel>
      ) : (
        <div className="overflow-clip rounded-md border border-hilo bg-superficie shadow-1">
          <div role="row" className="hidden h-9 items-center gap-4 border-b border-hilo px-4 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_150px_minmax(0,0.9fr)_minmax(0,1fr)_110px]" aria-hidden>
            <span className="rotulo">Estudio</span><span className="rotulo">Tipo · Responsable</span><span className="rotulo">Avance</span><span className="rotulo">Fase</span><span className="rotulo">Siguiente entrega</span><span className="rotulo text-right">Contrato</span>
          </div>
          <ul>
            {visibles.map((s) => {
              const abiertoAhora = desplegado.has(s.id);
              return (
                <li key={s.id} ref={s.id === abierto ? enfocado : undefined} className="border-b border-hilo last:border-b-0">
                  <div className="grid items-center gap-x-4 gap-y-1 px-4 py-2.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_150px_minmax(0,0.9fr)_minmax(0,1fr)_110px]">
                    <button type="button" aria-expanded={abiertoAhora} aria-controls={`estudio-${s.id}`} onClick={() => alternar(s.id)}
                      className="flex min-h-11 min-w-0 items-center gap-2 rounded-sm text-left hover:text-texto">
                      <ChevronDown aria-hidden className={cx("size-4 shrink-0 text-texto-3 transition-transform duration-[var(--dur)]", !abiertoAhora && "-rotate-90")} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{s.titulo}</span>
                        <span className="block truncate text-sm text-texto-3">{s.cliente}</span>
                      </span>
                      {s.vencidos > 0 && (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-alerta" title={`${s.vencidos} pasos vencidos`}>
                          <TriangleAlert aria-hidden className="size-3.5" /><span className="font-mono cifras">{s.vencidos}</span><span className="sr-only"> pasos vencidos</span>
                        </span>
                      )}
                    </button>
                    <p className="truncate text-sm text-texto-2"><span className="lg:block">{s.metodo}</span><span className="lg:block"><span className="lg:hidden"> · </span>{s.responsable}</span></p>
                    <div className="flex items-center gap-2" title="Avance ponderado por las horas de cada paso">
                      <div role="img" aria-label={`Avance ${Math.round(s.avance * 100)}%`} className="h-2 min-w-0 flex-1 rounded-sm bg-hundida"><div className="h-full rounded-sm bg-bien transition-[width] duration-[var(--dur-vista)] ease-salida motion-reduce:transition-none" style={{ width: `${s.avance * 100}%` }} /></div>
                      <span className="w-10 text-right font-mono text-sm cifras">{Math.round(s.avance * 100)}%</span>
                    </div>
                    <p className="truncate text-sm">{s.faseActual ?? <span className="text-bien">Completo</span>}</p>
                    <p className="truncate text-sm text-texto-2">{s.siguiente ? <><span className="font-mono cifras">{fDia(s.siguiente.entrega)}</span> · {s.siguiente.titulo.split(" · ").pop()}</> : <span className="text-texto-3">—</span>}</p>
                    <p className="text-sm lg:text-right">
                      {s.contrato.visible ? (s.contrato.monto !== null ? <span className="font-mono cifras" title={`${usd(s.contrato.monto)} · ${s.contrato.tipo}`}>{usdS(s.contrato.monto)}</span> : <span className="text-aviso">Sin contrato</span>) : null}
                    </p>
                  </div>
                  {abiertoAhora && <Detalle s={s} tonoDe={tonoDe} alEditar={() => setFormulario({ estudio: s })} alBorrar={() => setBorrando(s)} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <FormularioEstudio
        abierto={formulario !== null} estudio={formulario?.estudio ?? null} personas={personas} clientes={clientes} unidadesContrato={unidadesContrato} hoy={hoy}
        onCerrar={() => setFormulario(null)}
        onGuardado={(m, id) => { setFormulario(null); setDesplegado((d) => new Set(d).add(id)); avisar(m, { tipo: "exito" }); router.refresh(); }}
      />

      <Dialogo abierto={borrando !== null} onCerrar={() => setBorrando(null)} titulo="Eliminar estudio" ancho="sm"
        pie={<><Boton onClick={() => setBorrando(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={borrar}>Eliminar estudio</Boton></>}>
        {borrando && <p>Se elimina <strong>{borrando.titulo}</strong> y sus <span className="font-mono cifras">{borrando.pasos.length}</span> pasos: desaparecen de las listas de tareas. Podrás deshacerlo durante unos segundos.</p>}
      </Dialogo>
    </div>
  );
}

function Detalle({ s, tonoDe, alEditar, alBorrar }: { s: EstudioDTO; tonoDe: (n: string) => ReturnType<typeof tonoEstado>; alEditar: () => void; alBorrar: () => void }) {
  return (
    <div id={`estudio-${s.id}`} className="flex flex-col gap-4 border-t border-hilo bg-superficie-2/50 px-4 py-4 lg:pl-10">
      <BarraFases fases={s.fases} />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        <div><dt className="rotulo">Cliente</dt><dd>{s.clienteId ? <NombreCliente id={s.clienteId} nombre={s.cliente} className="font-medium" /> : s.cliente}</dd></div>
        <div><dt className="rotulo">Entrega final</dt><dd className="font-mono cifras">{fDia(s.entrega)}</dd></div>
        <div><dt className="rotulo">Lo lidera</dt><dd>{s.responsable}</dd></div>
        <div><dt className="rotulo">Unidad</dt><dd>{s.unidad}</dd></div>
        {s.contrato.visible && (
          <div className="col-span-2">
            <dt className="rotulo">Contrato</dt>
            <dd>{s.contrato.monto !== null ? <><span className="font-mono cifras">{usd(s.contrato.monto)}</span> · {s.contrato.tipo} · <Link href="/ingresos" className="underline underline-offset-4">Ver ingresos</Link></> : <span className="text-aviso">Sin contrato registrado para este cliente en {s.unidad}</span>}</dd>
          </div>
        )}
      </dl>
      {s.pasos.length ? <PasosPorFase pasos={s.pasos} tonoDe={tonoDe} /> : <p className="text-sm text-texto-3">Este estudio no tiene pasos.</p>}
      {s.puedeEditar && (
        <div className="flex flex-wrap gap-2">
          <Boton tamano="sm" icono={<Pencil className="size-3.5" aria-hidden />} onClick={alEditar}>Editar</Boton>
          <Boton tamano="sm" variante="fantasma" icono={<Trash2 className="size-3.5" aria-hidden />} onClick={alBorrar} className="ml-auto">Eliminar estudio</Boton>
        </div>
      )}
    </div>
  );
}
