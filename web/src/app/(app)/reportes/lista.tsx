"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Panel, Vacio } from "@/components/ui/panel";
import { CeldaEstado, type Tono } from "@/components/ui/estado";
import { Entrada } from "@/components/ui/campo";
import { ZONA_NEGOCIO } from "@/lib/reloj";
import type { ReporteResumen } from "@/lib/datos/tipos";

const formatoFecha = new Intl.DateTimeFormat("es-DO", { timeZone: ZONA_NEGOCIO, day: "2-digit", month: "short", year: "numeric" });
const formatoHora = new Intl.DateTimeFormat("es-DO", { timeZone: ZONA_NEGOCIO, hour: "2-digit", minute: "2-digit", hour12: false });

export function estadoIa(r: { estado_ia: string | null; disponible?: boolean }): { texto: string; tono: Tono } {
  if (r.disponible === false) return { texto: "Versión antigua", tono: "neutro" };
  if (r.estado_ia === "listo") return { texto: "Textos IA", tono: "bien" };
  if (r.estado_ia === "pendiente") return { texto: "IA pendiente", tono: "aviso" };
  return { texto: "Por reglas", tono: "neutro" };
}

function sinAcentos(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function ListaReportes({ reportes }: { reportes: ReporteResumen[] }) {
  const [q, setQ] = useState("");
  const visibles = useMemo(() => {
    const t = sinAcentos(q.trim());
    if (!t) return reportes;
    return reportes.filter((r) => sinAcentos(`${r.titulo} ${r.cliente} ${r.periodo ?? ""}`).includes(t));
  }, [q, reportes]);

  if (!reportes.length) {
    return (
      <Panel>
        <Vacio titulo="Todavía no tienes reportes"
          accion={<Link href="/reportes/nuevo" className="font-rotulo text-sm font-semibold uppercase tracking-[0.1em] underline">Generar el primero</Link>}>
          Exporta los widgets de Meltwater en .xlsx y suéltalos en «Generar reporte». El reporte queda guardado aquí con su propio enlace.
        </Vacio>
      </Panel>
    );
  }

  return (
    <Panel
      titulo={<h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Salidas <span className="ml-1 font-mono text-texto-3 cifras">{visibles.length}</span></h2>}
      acciones={
        <label className="relative block w-48 md:w-72">
          <span className="sr-only">Buscar reportes</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-3" aria-hidden />
          <Entrada type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente o periodo" className="h-9 pl-9" />
        </label>
      }
    >
      <div className="hidden grid-cols-[8.5rem_minmax(0,1.4fr)_minmax(0,1fr)_9rem] gap-4 border-b border-hilo px-4 py-2 md:grid">
        <span className="rotulo">Fecha</span><span className="rotulo">Reporte</span><span className="rotulo">Cliente</span><span className="rotulo">Estado</span>
      </div>
      {visibles.length === 0 ? (
        <Vacio titulo="Sin coincidencias">Ningún reporte coincide con «{q}». Prueba con otra parte del nombre del cliente.</Vacio>
      ) : (
        <ul className="divide-y divide-hilo">
          {visibles.map((r) => {
            const fecha = r.creado ? new Date(r.creado) : null;
            const e = estadoIa(r);
            return (
              <li key={r.token}>
                <Link href={`/reportes/${r.token}`}
                  className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-[var(--dur)] hover:bg-superficie-2 focus-visible:bg-superficie-2 md:min-h-11 md:grid-cols-[8.5rem_minmax(0,1.4fr)_minmax(0,1fr)_9rem] md:items-center md:py-2">
                  <span className="order-3 font-mono text-xs text-texto-3 cifras md:order-none md:text-sm md:text-texto-2">
                    {fecha ? <time dateTime={r.creado!}>{formatoFecha.format(fecha)} <span className="text-texto-3">{formatoHora.format(fecha)}</span></time> : "—"}
                  </span>
                  <span className="order-1 min-w-0 md:order-none">
                    <span className="block truncate font-medium">{r.periodo ? <><span className="hidden md:inline">Escucha social · </span>{r.periodo}</> : r.titulo}</span>
                    {r.menciones != null && <span className="block font-mono text-xs text-texto-3 cifras">{r.menciones.toLocaleString("es-DO")} menciones</span>}
                  </span>
                  <span className="order-4 truncate text-sm text-texto-2 md:order-none md:text-base md:text-texto">{r.cliente || "—"}</span>
                  <span className="order-2 justify-self-end md:order-none md:justify-self-start"><CeldaEstado texto={e.texto} tono={e.tono} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
