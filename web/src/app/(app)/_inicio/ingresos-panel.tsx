"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { porMesPorUnidad, resumenIngresos, SIN_FILTRO_ING, type MetasIng } from "@/lib/finanzas/agregados";
import { usd, usdS } from "@/lib/finanzas/contratos";
import type { IngresosPanel } from "@/lib/panel/datos";
import type { FiltrosCruzados } from "@/lib/seguimiento/filtros";
import { BarraMeta } from "../ingresos/_componentes/graficos";

const pct = (n: number) => `${(n * 100).toFixed(n >= 1 ? 0 : 1)}%`;

/*
 * Ingresos del año en el Panel: lo contratado contra la meta, respetando los
 * filtros cruzados (unidad, cliente, tipo de cliente y tipo de contrato). Solo
 * llega si la persona ve los ingresos de alguna unidad. El detalle esta en Ingresos.
 */
export function BloqueIngresos({ ingresos, filtros, hoy }: { ingresos: IngresosPanel; filtros: FiltrosCruzados; hoy: string }) {
  const { anio, contratos, metas, unidades } = ingresos;
  // Los filtros del panel son nombres; los contratos traen unidad, cliente y tipo de cliente por nombre.
  const propios = contratos.filter((c) =>
    (!filtros.unidad || c.unidad.nombre === filtros.unidad) && (!filtros.cliente || c.cliente.nombre === filtros.cliente)
    && (!filtros.tipo || c.cliente.tipo === filtros.tipo) && (!filtros.contrato || c.tipo === filtros.contrato));
  // Con una unidad elegida se mide contra la meta de esa unidad; si no, contra la meta total (fijada o suma de las unidades).
  const unidadElegida = filtros.unidad ? unidades.find((u) => u.nombre === filtros.unidad)?.id ?? null : null;
  const m: MetasIng = filtros.unidad ? { direccion: null, unidades: unidadElegida && metas.unidades[unidadElegida] ? { [unidadElegida]: metas.unidades[unidadElegida] } : {} } : metas;
  const r = resumenIngresos(propios, m, anio, hoy, SIN_FILTRO_ING);
  const porUnidad = porMesPorUnidad(r.filas).map((s) => ({ id: s.unidadId, nombre: s.nombre, total: s.total, meta: metas.unidades[s.unidadId] ?? 0 }));
  const hayFiltros = !!(filtros.unidad || filtros.cliente || filtros.tipo || filtros.contrato);

  return (
    <Panel titulo={`Ingresos ${anio}`} acciones={<Link href={`/ingresos?anio=${anio}`} className="inline-flex items-center gap-1 text-sm text-texto-2 underline-offset-4 hover:text-texto hover:underline">Ver ingresos<ArrowRight aria-hidden className="size-4" /></Link>}>
      {!propios.length ? (
        <p className="px-4 py-6 text-sm text-texto-2">{hayFiltros ? "Ningún contrato de tus unidades coincide con estos filtros." : `Aún no hay contratos con ingreso en ${anio}.`}</p>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <p><span className="rotulo">Contratado</span><span className="block font-mono text-2xl font-medium cifras" title={usd(r.contratado)}>{usdS(r.contratado)}</span></p>
            <p><span className="rotulo">Devengado</span><span className="block font-mono text-2xl font-medium text-info cifras" title={usd(r.devengado)}>{usdS(r.devengado)}</span></p>
            {r.meta !== null && <p><span className="rotulo">Meta</span><span className="block font-mono text-2xl font-medium cifras" title={usd(r.meta)}>{usdS(r.meta)}<span className="ml-2 text-sm text-texto-2">{pct(r.contratado / r.meta)}</span></span></p>}
          </div>
          <BarraMeta meta={r.meta} contratado={r.contratado} devengado={r.devengado} ritmo={r.ritmo} />
          {!filtros.unidad && porUnidad.length > 1 && (
            <ul aria-label="Ingresos por unidad" className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {porUnidad.map((u) => (
                <li key={u.id} className="flex items-baseline justify-between gap-2 border-t border-hilo py-1.5 text-sm">
                  <span className="min-w-0 truncate">{u.nombre}</span>
                  <span className="font-mono cifras" title={usd(u.total)}>{usdS(u.total)}{u.meta > 0 && <span className="ml-1.5 text-xs text-texto-3">{pct(u.total / u.meta)}</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
