"use client";
import { useEffect, useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { fDia } from "@/lib/admin/formato";
import { METODOS } from "@/lib/estudios/plan";
import type { EstudioDTO } from "@/lib/estudios/servicio";
import type { PersonaDTO } from "@/lib/tareas/tipos";

type Previa = { nombre: string; fase: string; horas: number; inicio: string; entrega: string }[];

/*
 * Alta y edicion de un estudio. Al crear, muestra los pasos y fechas que saldran
 * (el mismo calculo del servidor) antes de guardar. El monto es opcional y solo se
 * ofrece si la persona puede registrar contratos de la unidad de quien lo lidera.
 */
export function FormularioEstudio({ abierto, estudio, personas, clientes, unidadesContrato, hoy, onCerrar, onGuardado }: {
  abierto: boolean;
  estudio: EstudioDTO | null;
  personas: PersonaDTO[];
  clientes: string[];
  unidadesContrato: number[];
  hoy: string;
  onCerrar: () => void;
  onGuardado: (mensaje: string, id: number) => void;
}) {
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={estudio ? "Editar estudio" : "Nuevo estudio"} ancho="lg">
      {abierto && <Campos key={estudio?.id ?? "nuevo"} {...{ estudio, personas, clientes, unidadesContrato, hoy, onCerrar, onGuardado }} />}
    </Dialogo>
  );
}

function Campos({ estudio, personas, clientes, unidadesContrato, hoy, onCerrar, onGuardado }: Omit<Parameters<typeof FormularioEstudio>[0], "abierto">) {
  const [titulo, setTitulo] = useState(estudio?.titulo ?? "");
  const [cliente, setCliente] = useState(estudio?.cliente ?? "");
  const [metodo, setMetodo] = useState<string>(estudio?.metodo || "Cuantitativo");
  const [responsable, setResponsable] = useState(estudio ? String(estudio.responsableId) : personas.length === 1 ? String(personas[0].id) : "");
  const [entrega, setEntrega] = useState(estudio?.entrega ?? "");
  const [monto, setMonto] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);

  const unidadResp = personas.find((p) => String(p.id) === responsable)?.unidadId ?? null;
  const puedeMonto = !estudio && unidadResp != null && unidadesContrato.includes(unidadResp);
  // Hasta que no hay responsable y entrega, no hay plan que mostrar.
  const listoParaPrevia = !estudio && !!responsable && /^\d{4}-\d{2}-\d{2}$/.test(entrega) && entrega >= hoy;

  useEffect(() => {
    if (!listoParaPrevia) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/estudios/plan?metodo=${encodeURIComponent(metodo)}&entrega=${entrega}&responsableId=${responsable}`, { signal: c.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).then((d: { pasos: Previa } | null) => setPrevia(d?.pasos ?? null)).catch(() => {});
    }, 250);
    return () => { clearTimeout(t); c.abort(); };
  }, [listoParaPrevia, metodo, entrega, responsable]);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!titulo.trim()) { setError("Ponle un nombre al estudio."); return; }
    if (!cliente.trim()) { setError("Indica el cliente del estudio."); return; }
    if (!responsable) { setError("Elige quién lidera el estudio."); return; }
    if (!entrega) { setError("Indica la entrega final."); return; }
    setGuardando(true);
    try {
      if (estudio) {
        await pedir(`/api/estudios/${estudio.id}`, { metodo: "PATCH", cuerpo: { titulo, cliente, metodo, responsableId: Number(responsable), entrega } });
        onGuardado("Estudio actualizado.", estudio.id);
      } else {
        const r = await pedir<{ id: number; pasos: number; contrato: string }>("/api/estudios", { cuerpo: { titulo, cliente, metodo, responsableId: Number(responsable), entrega, ...(monto.trim() ? { monto: monto.trim() } : {}) } });
        onGuardado(`Estudio creado con ${r.pasos} pasos.${r.contrato ? ` Contrato: ${r.contrato}.` : ""}`, r.id);
      }
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
      <Campo etiqueta="Nombre del estudio">{(a) => <Entrada {...a} value={titulo} maxLength={200} autoComplete="off" onChange={(e) => setTitulo(e.target.value)} />}</Campo>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Cliente">
          {(a) => (
            <>
              <Entrada {...a} list="clientes-estudio" value={cliente} maxLength={100} autoComplete="off" onChange={(e) => setCliente(e.target.value)} />
              <datalist id="clientes-estudio">{clientes.map((c) => <option key={c} value={c} />)}</datalist>
            </>
          )}
        </Campo>
        <Campo etiqueta="Quién lo lidera">
          {(a) => (
            <Selector {...a} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="">Elige una persona</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.unidad}</option>)}
            </Selector>
          )}
        </Campo>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="rotulo mb-1">Tipo de estudio</legend>
        <div className="inline-flex h-10 self-start overflow-hidden rounded-sm border border-hilo-fuerte">
          {METODOS.map((m) => (
            <button key={m} type="button" aria-pressed={metodo === m} onClick={() => setMetodo(m)}
              className={cx("px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em]", metodo === m ? "bg-texto text-superficie" : "text-texto-2 hover:bg-superficie-2")}>{m}</button>
          ))}
        </div>
        {!estudio && <p className="text-sm text-texto-3">{metodo === "Mixto" ? "Lleva trabajo de campo cuantitativo y cualitativo." : `Omite el trabajo de campo ${metodo === "Cuantitativo" ? "cualitativo" : "cuantitativo"}.`} Cambiarlo después no rehace los pasos.</p>}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Entrega final" ayuda={estudio ? "Mover la entrega final no mueve las fechas de los pasos." : undefined}>
          {(a) => <Entrada {...a} type="date" value={entrega} min={estudio ? undefined : hoy} onChange={(e) => setEntrega(e.target.value)} />}
        </Campo>
        {puedeMonto && (
          <Campo etiqueta="Monto del contrato (US$)" ayuda="Opcional. Registra un contrato de tipo Proyecto de hoy a la entrega.">
            {(a) => <Entrada {...a} inputMode="decimal" autoComplete="off" value={monto} placeholder="Sin contrato" onChange={(e) => setMonto(e.target.value)} />}
          </Campo>
        )}
      </div>

      {!estudio && (
        <section aria-label="Pasos que se crearán" aria-live="polite" className="rounded-sm border border-hilo">
          <h3 className="rotulo border-b border-hilo px-3 py-2">{previa ? `Se crearán ${previa.length} pasos` : "Pasos que se crearán"}</h3>
          {previa && listoParaPrevia ? (
            <ol className="max-h-56 overflow-y-auto">
              {previa.map((p, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-hilo px-3 py-1.5 text-sm last:border-b-0">
                  <span className="min-w-0 truncate"><span className="text-texto-3">{p.fase} · </span>{p.nombre}</span>
                  <span className="font-mono text-xs text-texto-2 cifras">{fDia(p.inicio)}{p.inicio !== p.entrega ? ` – ${fDia(p.entrega)}` : ""} · {p.horas} h</span>
                </li>
              ))}
            </ol>
          ) : <p className="px-3 py-3 text-sm text-texto-3">Elige quién lo lidera y la entrega final para ver los pasos y sus fechas.</p>}
        </section>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>{estudio ? "Guardar cambios" : "Crear estudio"}</Boton>
      </div>
    </form>
  );
}
