"use client";
import { useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, AreaTexto, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { leerContrato, TIPOS_CONTRATO, textoDeProrrateo } from "@/lib/finanzas/contratos";
import type { ContratoDTO } from "@/lib/finanzas/servicio";

type Unidad = { id: number; nombre: string };

/*
 * Alta y edicion de un contrato. El monto es el TOTAL en dolares y se reparte en
 * partes iguales entre los meses que toca: mientras se escribe, el formulario
 * dice cuanto es por mes, y al guardar lo confirma. El servidor vuelve a validar.
 */
export function FormularioContrato({ abierto, contrato, unidades, todasLasUnidades, clientes, anio, onCerrar, onGuardado }: {
  abierto: boolean;
  contrato: ContratoDTO | null;
  /* Donde puede crear/editar (las concedidas). */
  unidades: Unidad[];
  todasLasUnidades: Unidad[];
  clientes: { id: number; nombre: string }[];
  anio: number;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={contrato ? "Editar contrato" : "Nuevo contrato"} ancho="md">
      {abierto && <Campos key={contrato?.id ?? "nuevo"} {...{ contrato, unidades, todasLasUnidades, clientes, anio, onCerrar, onGuardado }} />}
    </Dialogo>
  );
}

function Campos({ contrato, unidades, todasLasUnidades, clientes, anio, onCerrar, onGuardado }: Omit<Parameters<typeof FormularioContrato>[0], "abierto">) {
  const [clienteId, setClienteId] = useState(contrato ? String(contrato.cliente.id) : "");
  const [unidadId, setUnidadId] = useState(contrato ? String(contrato.unidad.id) : unidades.length === 1 ? String(unidades[0].id) : "");
  const [tipo, setTipo] = useState<string>(contrato?.tipo ?? "Fee");
  const [monto, setMonto] = useState(contrato ? String(contrato.monto) : "");
  const [inicio, setInicio] = useState(contrato?.inicio ?? `${anio}-01-01`);
  const [fin, setFin] = useState(contrato?.fin ?? `${anio}-12-31`);
  const [asignaId, setAsignaId] = useState(contrato?.asigna ? String(contrato.asigna.id) : "");
  const [nota, setNota] = useState(contrato?.nota ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cuerpo = { clienteId: Number(clienteId) || null, unidadId: Number(unidadId) || null, tipo, monto: monto.trim(), inicio, fin, asignaId: tipo === "Asignación" && asignaId ? Number(asignaId) : null, nota };
  const lectura = leerContrato(cuerpo);
  const prorrateo = lectura.ok ? textoDeProrrateo(lectura.valor) : "";
  // La unidad actual siempre se ofrece al editar, aunque ya no sea de las concedidas (se ve; cambiarla exige poder editar la nueva).
  const opcionesUnidad = contrato && !unidades.some((u) => u.id === contrato.unidad.id) ? [{ id: contrato.unidad.id, nombre: contrato.unidad.nombre }, ...unidades] : unidades;

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!lectura.ok) { setError(lectura.error); return; }
    setGuardando(true);
    try {
      const r = await pedir<{ prorrateo: string }>(contrato ? `/api/finanzas/contratos/${contrato.id}` : "/api/finanzas/contratos", { metodo: contrato ? "PATCH" : "POST", cuerpo });
      onGuardado(`${contrato ? "Contrato actualizado" : "Contrato guardado"}. ${r.prorrateo}.`);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
      <Campo etiqueta="Cliente">
        {(a) => (
          <Selector {...a} value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
            <option value="">Elige un cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Selector>
        )}
      </Campo>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Unidad que presta el servicio">
          {(a) => (
            <Selector {...a} value={unidadId} onChange={(e) => setUnidadId(e.target.value)} required>
              <option value="">Elige una unidad</option>
              {opcionesUnidad.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          )}
        </Campo>
        <Campo etiqueta="Tipo de contrato">
          {(a) => <Selector {...a} value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS_CONTRATO.map((t) => <option key={t} value={t}>{t}</option>)}</Selector>}
        </Campo>
      </div>
      {tipo === "Asignación" && (
        <Campo etiqueta="Unidad que asigna" ayuda="Opcional: la unidad que traslada este trabajo.">
          {(a) => (
            <Selector {...a} value={asignaId} onChange={(e) => setAsignaId(e.target.value)}>
              <option value="">Ninguna</option>
              {todasLasUnidades.filter((u) => String(u.id) !== unidadId).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          )}
        </Campo>
      )}
      <Campo etiqueta="Monto total (US$)" ayuda="El total del contrato, no el mensual. Sin separador de miles; hasta dos decimales.">
        {(a) => <Entrada {...a} inputMode="decimal" autoComplete="off" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="15000" />}
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Inicio">{(a) => <Entrada {...a} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />}</Campo>
        <Campo etiqueta="Fin">{(a) => <Entrada {...a} type="date" value={fin} onChange={(e) => setFin(e.target.value)} />}</Campo>
      </div>
      <p aria-live="polite" className="min-h-6 rounded-sm bg-superficie-2 px-3 py-1.5 font-mono text-sm cifras">
        {prorrateo ? <>Se reparte en <strong>{prorrateo}</strong>.</> : <span className="text-texto-3">Con el monto y las fechas verás cuánto es por mes.</span>}
      </p>
      <Campo etiqueta="Nota" ayuda="Opcional.">{(a) => <AreaTexto {...a} rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} />}</Campo>
      <div className="flex justify-end gap-2 pt-1">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>{contrato ? "Guardar cambios" : "Crear contrato"}</Boton>
      </div>
    </form>
  );
}
