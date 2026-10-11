"use client";
import { useState } from "react";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { leerGasto } from "@/lib/gastos/reglas";
import type { GastoDTO } from "@/lib/gastos/servicio";

/*
 * Alta y edicion de un gasto. La categoria se escribe o se elige de las ya usadas: "viajes" y "Viajes" son la misma
 * (el servidor la normaliza). El monto es en dolares. El servidor vuelve a validar.
 */
export function FormularioGasto({ abierto, gasto, unidadId, categorias, hoy, onCerrar, onGuardado }: {
  abierto: boolean;
  gasto: GastoDTO | null;
  unidadId: number;
  categorias: string[];
  hoy: string;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={gasto ? "Editar gasto" : "Nuevo gasto"} ancho="md">
      {abierto && <Campos key={gasto?.id ?? "nuevo"} {...{ gasto, unidadId, categorias, hoy, onCerrar, onGuardado }} />}
    </Dialogo>
  );
}

function Campos({ gasto, unidadId, categorias, hoy, onCerrar, onGuardado }: Omit<Parameters<typeof FormularioGasto>[0], "abierto">) {
  const [fecha, setFecha] = useState(gasto?.fecha ?? hoy);
  const [categoria, setCategoria] = useState(gasto?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(gasto?.descripcion ?? "");
  const [monto, setMonto] = useState(gasto ? String(gasto.monto) : "");
  const [proveedor, setProveedor] = useState(gasto?.proveedor ?? "");
  const [nota, setNota] = useState(gasto?.nota ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cuerpo = { unidadId, fecha, categoria, descripcion, monto: monto.trim(), proveedor, nota };

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    const l = leerGasto(cuerpo, categorias);
    if (!l.ok) { setError(l.error); return; }
    setGuardando(true);
    try {
      await pedir(gasto ? `/api/gastos/${gasto.id}` : "/api/gastos", { metodo: gasto ? "PATCH" : "POST", cuerpo });
      onGuardado(gasto ? "Gasto actualizado." : "Gasto registrado.");
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Fecha">{(a) => <Entrada {...a} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />}</Campo>
        <Campo etiqueta="Monto (US$)" ayuda="Hasta dos decimales, sin separador de miles.">
          {(a) => <Entrada {...a} inputMode="decimal" autoComplete="off" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="45.50" />}
        </Campo>
      </div>
      <Campo etiqueta="Categoría" ayuda="Elige una o escribe una nueva.">
        {(a) => (
          <>
            <Entrada {...a} list="categorias-gasto" autoComplete="off" maxLength={60} value={categoria} onChange={(e) => setCategoria(e.target.value)} />
            <datalist id="categorias-gasto">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
          </>
        )}
      </Campo>
      <Campo etiqueta="Descripción">{(a) => <Entrada {...a} maxLength={300} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué se compró o pagó" />}</Campo>
      <Campo etiqueta="Proveedor" ayuda="Opcional.">{(a) => <Entrada {...a} maxLength={120} value={proveedor} onChange={(e) => setProveedor(e.target.value)} />}</Campo>
      <Campo etiqueta="Nota" ayuda="Opcional: número de comprobante, aprobación…">{(a) => <AreaTexto {...a} rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} />}</Campo>
      <div className="flex justify-end gap-2 pt-1">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>{gasto ? "Guardar cambios" : "Registrar gasto"}</Boton>
      </div>
    </form>
  );
}
