"use client";
import { Boton } from "@/components/ui/boton";
import { Entrada, Selector } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Vacio } from "@/components/ui/panel";
import { fFechaHora } from "@/lib/admin/formato";
import type { DatosActividad } from "@/lib/admin/consultas";
import { BuscadorDiferido, claseFila, Paginacion, Tabla, Th, useListaRemota } from "../../_componentes/comunes";

export function PantallaActividad({ inicial, personas, filtrosIniciales }: {
  inicial: DatosActividad; personas: { id: number; nombre: string }[]; filtrosIniciales: Record<string, string>;
}) {
  const { datos, filtros, cambiar, cargando, error } = useListaRemota<DatosActividad>("/api/admin/actividad", inicial, filtrosIniciales);
  const hayFiltro = !!(filtros.usuario || filtros.accion || filtros.desde || filtros.hasta);
  return (
    <Tabla
      etiqueta="Registro de actividad"
      cargando={cargando}
      error={error}
      cabecera={<>
        <Selector aria-label="Persona" value={filtros.usuario ?? ""} onChange={(e) => cambiar({ usuario: e.target.value })} className="w-full sm:w-52">
          <option value="">Todas las personas</option>
          {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
        <BuscadorDiferido valor={filtros.accion ?? ""} onCambio={(accion) => cambiar({ accion })} etiqueta="Acción" placeholder="Acción, p. ej. user_kick" className="md:w-56" />
        <label className="flex items-center gap-2 text-sm text-texto-2">Desde
          <Entrada type="date" value={filtros.desde ?? ""} onChange={(e) => cambiar({ desde: e.target.value })} className="w-40 font-mono" />
        </label>
        <label className="flex items-center gap-2 text-sm text-texto-2">Hasta
          <Entrada type="date" value={filtros.hasta ?? ""} onChange={(e) => cambiar({ hasta: e.target.value })} className="w-40 font-mono" />
        </label>
        {hayFiltro && <Boton variante="fantasma" tamano="sm" onClick={() => cambiar({ usuario: "", accion: "", desde: "", hasta: "" })}>Quitar filtros</Boton>}
      </>}
      pie={<Paginacion pagina={datos.pagina} paginas={datos.paginas} total={datos.total} nombre={datos.total === 1 ? "registro" : "registros"} onPagina={(p) => cambiar({ p: String(p) }, false)} />}
    >
      {datos.filas.length === 0 ? (
        <Vacio titulo={hayFiltro ? "Nada en ese filtro" : "Sin actividad"}>{hayFiltro ? "Amplía las fechas o quita la persona o la acción." : "Aquí aparecerá cada inicio de sesión y cada cambio."}</Vacio>
      ) : (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="hidden border-b border-hilo md:table-header-group">
            <tr><Th className="w-36">Fecha y hora</Th><Th className="w-40">Persona</Th><Th className="w-48">Acción</Th><Th>Detalle</Th><Th className="hidden w-32 lg:table-cell">IP</Th></tr>
          </thead>
          <tbody>
            {datos.filas.map((l) => (
              <tr key={l.id} className={cx(claseFila, "grid grid-cols-[auto_1fr] gap-x-3 px-4 py-2 md:table-row md:p-0")}>
                <td className="font-mono text-xs text-texto-3 md:h-11 md:px-4"><time dateTime={l.cuando ?? undefined}>{fFechaHora(l.cuando)}</time></td>
                <td className="truncate md:h-11 md:px-4">
                  <button type="button" className="hover:underline" onClick={() => cambiar({ usuario: String(l.usuarioId) })} title="Ver solo a esta persona">{l.usuario}</button>
                </td>
                <td className="col-span-2 truncate font-mono text-xs md:h-11 md:px-4">{l.accion}</td>
                <td className="col-span-2 truncate text-texto-2 md:h-11 md:px-4" title={l.detalle}>{l.detalle || "—"}</td>
                <td className="hidden font-mono text-xs text-texto-3 lg:table-cell lg:h-11 lg:px-4">{l.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Tabla>
  );
}
