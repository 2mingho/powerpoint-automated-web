"use client";
import { useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import type { EntradaHoras } from "@/lib/horas-extras/agregados";
import { avisoDeLimite, leerRegistro, MESES, periodoDe, rotuloPeriodo, type Mitad, type Periodo } from "@/lib/horas-extras/reglas";
import type { ResultadoRegistro } from "@/lib/horas-extras/servicio";
import { esFinDeSemana, esIsoValida } from "@/lib/tareas/fechas";

const mismoPeriodo = (a: Periodo, b: Periodo) => a.anio === b.anio && a.mes === b.mes && a.mitad === b.mitad;
const posicion = (p: Periodo) => p.anio * 24 + (p.mes - 1) * 2 + (p.mitad === 30 ? 1 : 0);

/*
 * Alta y edicion de horas extras. Se escribe el dia trabajado, el horario como texto libre (hay turnos partidos:
 * «6:00-09:00 AM y 14:00-3:00 PM») y las horas. Se segmenta solo en L-V o SAB-DOM por el dia. El reporte donde cuenta es
 * el que se esta viendo, salvo que el dia sea de uno posterior; se puede cambiar para registrar tarde (dias de finales
 * de agosto en la 2da quincena de septiembre). El servidor vuelve a validar y dice como va la persona contra su maximo.
 */
export function FormularioHoras({ abierto, registro, personas, periodoVisto, limite, horasDeCadaPersona, onCerrar, onGuardado }: {
  abierto: boolean;
  registro: EntradaHoras | null;
  personas: { id: number; nombre: string }[];
  periodoVisto: Periodo;
  limite: number;
  /* Horas que ya lleva cada persona en el trimestre visto, para avisar antes de guardar. */
  horasDeCadaPersona: Map<number, number>;
  onCerrar: () => void;
  onGuardado: (mensaje: string, tipo: "exito" | "info") => void;
}) {
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={registro ? "Editar horas extras" : "Registrar horas extras"} ancho="md">
      {abierto && <Campos key={registro?.id ?? "nuevo"} {...{ registro, personas, periodoVisto, limite, horasDeCadaPersona, onCerrar, onGuardado }} />}
    </Dialogo>
  );
}

function Campos({ registro, personas, periodoVisto, limite, horasDeCadaPersona, onCerrar, onGuardado }: Omit<Parameters<typeof FormularioHoras>[0], "abierto">) {
  const [personaId, setPersonaId] = useState(registro ? String(registro.personaId) : "");
  const [fecha, setFecha] = useState(registro?.fecha ?? "");
  const [horas, setHoras] = useState(registro ? String(registro.horas) : "");
  const [horario, setHorario] = useState(registro?.horario ?? "");
  const [detalle, setDetalle] = useState(registro?.detalle ?? "");
  const [periodo, setPeriodo] = useState<Periodo>(registro?.periodo ?? periodoVisto);
  const [manual, setManual] = useState(!!registro);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const alCambiarFecha = (f: string) => {
    setFecha(f);
    // Mientras nadie toque el reporte, es el visto; si el dia es de uno posterior, ese.
    if (!manual && /^\d{4}-\d{2}-\d{2}$/.test(f)) {
      const propio = periodoDe(f);
      setPeriodo(posicion(propio) > posicion(periodoVisto) ? propio : periodoVisto);
    }
  };
  const cambiarPeriodo = (p: Partial<Periodo>) => { setManual(true); setPeriodo((x) => ({ ...x, ...p })); };

  const cuerpo = { personaId: Number(personaId) || null, fecha, detalle, horario, horas: horas.trim(), periodo };
  const lectura = leerRegistro(cuerpo);
  // Cuanto llevaria la persona en el trimestre: lo que ya tiene (sin este registro si se edita) mas lo nuevo.
  const previas = (horasDeCadaPersona.get(Number(personaId)) ?? 0) - (registro && registro.personaId === Number(personaId) ? registro.horas : 0);
  const nuevas = lectura.ok ? lectura.valor.horas : 0;
  const llevaria = Math.round((previas + nuevas) * 100) / 100;
  const aviso = nuevas > 0 ? avisoDeLimite(llevaria, limite) : "";

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!lectura.ok) { setError(lectura.error); return; }
    setGuardando(true);
    try {
      const r = await pedir<ResultadoRegistro>(registro ? `/api/horas-extras/${registro.id}` : "/api/horas-extras", {
        metodo: registro ? "PATCH" : "POST", cuerpo: registro ? { fecha, detalle, horario, horas: horas.trim(), periodo } : cuerpo,
      });
      const quien = personas.find((p) => p.id === Number(personaId))?.nombre ?? registro?.personaNombre ?? "La persona";
      const base = registro ? "Horas extras actualizadas." : "Horas extras registradas.";
      if (r.aviso === "excedido") onGuardado(`${base} ${quien} lleva ${r.horasTrimestre} h este trimestre: se pasó del máximo de ${r.limite}.`, "info");
      else if (r.aviso === "cerca") onGuardado(`${base} ${quien} lleva ${r.horasTrimestre} de ${r.limite} h este trimestre.`, "info");
      else onGuardado(base, "exito");
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
      <Campo etiqueta="Persona">
        {(a) => (
          <Selector {...a} value={personaId} onChange={(e) => setPersonaId(e.target.value)} disabled={!!registro}>
            <option value="">Elige una persona</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            {registro && !personas.some((p) => p.id === registro.personaId) && <option value={registro.personaId}>{registro.personaNombre}</option>}
          </Selector>
        )}
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Día trabajado">{(a) => <Entrada {...a} type="date" value={fecha} onChange={(e) => alCambiarFecha(e.target.value)} />}</Campo>
        <Campo etiqueta="Horas" ayuda="Hasta dos decimales: 2.5">
          {(a) => <Entrada {...a} inputMode="decimal" autoComplete="off" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="3" />}
        </Campo>
      </div>
      <Campo etiqueta="Horario" ayuda="Texto libre, p. ej. 5:00 PM-8:00 PM o 6:00-09:00 AM y 14:00-3:00 PM. Opcional.">
        {(a) => <Entrada {...a} maxLength={120} value={horario} onChange={(e) => setHorario(e.target.value)} />}
      </Campo>
      <Campo etiqueta="Detalle">{(a) => <Entrada {...a} maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Cobertura medios turno AM" />}</Campo>

      <fieldset className="flex flex-col gap-2 rounded-sm border border-hilo px-3 pb-3 pt-2">
        <legend className="rotulo px-1">Cuenta en el reporte</legend>
        <div className="grid grid-cols-3 gap-2">
          <Selector aria-label="Año del reporte" value={periodo.anio} onChange={(e) => cambiarPeriodo({ anio: Number(e.target.value) })}>
            {[periodoVisto.anio - 1, periodoVisto.anio, periodoVisto.anio + 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector>
          <Selector aria-label="Mes del reporte" value={periodo.mes} onChange={(e) => cambiarPeriodo({ mes: Number(e.target.value) })}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Selector>
          <Selector aria-label="Quincena del reporte" value={periodo.mitad} onChange={(e) => cambiarPeriodo({ mitad: Number(e.target.value) as Mitad })}>
            <option value={15}>1ra (hasta el 15)</option>
            <option value={30}>2da (del 16 al fin)</option>
          </Selector>
        </div>
        <p className="text-sm text-texto-2" aria-live="polite">
          {rotuloPeriodo(periodo, false)}{!mismoPeriodo(periodo, periodoVisto) ? "" : " (el que estás viendo)"}.
          {" "}El día cuenta como <strong>{esIsoValida(fecha) && esFinDeSemana(fecha) ? "SAB-DOM" : "L-V"}</strong>.
        </p>
      </fieldset>

      {aviso && (
        <p role="status" className={`rounded-sm border px-3 py-2 text-sm ${aviso === "excedido" ? "border-alerta/50 text-alerta" : "border-aviso/50"}`}>
          {aviso === "excedido"
            ? `Con estas horas, la persona llevaría ${llevaria} h este trimestre y se pasaría del máximo de ${limite}. Puedes guardarlas igual.`
            : `Con estas horas llevaría ${llevaria} de ${limite} h este trimestre: casi en el máximo.`}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>{registro ? "Guardar cambios" : "Registrar horas"}</Boton>
      </div>
    </form>
  );
}
