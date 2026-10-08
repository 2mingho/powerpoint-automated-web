"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Dialogo } from "@/components/ui/dialogo";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada, Selector } from "@/components/ui/campo";
import { Esqueleto } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { pedir } from "@/components/ui/pedir";
import { EVENTO_ABRIR_SOLICITUD, EVENTO_SOLICITUD_ENVIADA, type DetalleSolicitudEnviada } from "@/components/cabecera/eventos";

type Opciones = {
  unidades: { id: number; nombre: string }[];
  prioridades: { nombre: string }[];
  prioridadDefecto: string;
  hoy: string;
};

type Errores = Partial<Record<"titulo" | "unidad" | "entrega" | "general", string>>;

/*
 * "Solicitar a otra unidad" (templates/_solicitud_modal.html). Uno solo para
 * toda la app, montado en la cabecera: lo abre ?solicitar=1 en cualquier URL o
 * el evento "solicitud:abrir". Lo esencial arriba (titulo, unidad, prioridad,
 * fecha) y lo ocasional plegado (descripcion, cliente).
 *
 * El desplegable solo ofrece unidades a las que se puede solicitar: elegir la
 * propia fallaba en Flask despues de rellenar todo.
 */
export function DialogoSolicitud() {
  const { avisar } = useAvisos();
  const params = useSearchParams();
  const [abierto, setAbierto] = useState(false);
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [errorCarga, setErrorCarga] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const form = useRef<HTMLFormElement>(null);

  const cargar = useCallback(async () => {
    setErrorCarga("");
    const r = await pedir<Opciones>("/api/solicitudes/opciones");
    if (r.ok) setOpciones(r.datos);
    else setErrorCarga(r.error);
  }, []);

  const abrir = useCallback(() => {
    setErrores({});
    form.current?.reset();
    setAbierto(true);
    void cargar();
  }, [cargar]);

  useEffect(() => {
    window.addEventListener(EVENTO_ABRIR_SOLICITUD, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_SOLICITUD, abrir);
  }, [abrir]);

  // ?solicitar=1: se abre y el parametro se retira, para que recargar no lo vuelva a abrir.
  useEffect(() => {
    if (params.get("solicitar") !== "1") return;
    // La URL es la orden externa de abrir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    abrir();
    // Sin router.replace: una navegacion al servidor podria volver a montar la cabecera y cerrar el dialogo.
    const u = new URL(window.location.href);
    u.searchParams.delete("solicitar");
    window.history.replaceState(window.history.state, "", u);
  }, [params, abrir]);

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const titulo = String(f.get("titulo") ?? "").trim();
    const unidad = String(f.get("unidad") ?? "");
    const entrega = String(f.get("entrega") ?? "");
    const err: Errores = {};
    if (!titulo) err.titulo = "Escribe qué necesitas.";
    if (!unidad) err.unidad = "Elige a qué unidad se lo pides.";
    if (entrega && opciones && entrega < opciones.hoy) err.entrega = "La fecha ya pasó. Elige hoy o una posterior.";
    setErrores(err);
    if (Object.keys(err).length) {
      const primero = (["titulo", "unidad", "entrega"] as const).find((k) => err[k]);
      (e.currentTarget.elements.namedItem(primero === "unidad" ? "unidad" : primero ?? "titulo") as HTMLElement | null)?.focus();
      return;
    }
    setEnviando(true);
    const r = await pedir<{ solicitud: { id: number; destino: { nombre: string } } }>("/api/solicitudes", {
      method: "POST",
      json: {
        titulo, unidadDestinoId: Number(unidad), prioridad: String(f.get("prioridad") ?? ""), entrega,
        descripcion: String(f.get("descripcion") ?? ""), cliente: String(f.get("cliente") ?? ""),
      },
    });
    setEnviando(false);
    if (!r.ok) { setErrores({ general: r.error }); return; }
    setAbierto(false);
    const destino = r.datos.solicitud.destino.nombre;
    avisar(`Solicitud enviada a ${destino}. Te avisaremos cuando la resuelvan.`, { tipo: "exito" });
    window.dispatchEvent(new CustomEvent<DetalleSolicitudEnviada>(EVENTO_SOLICITUD_ENVIADA, { detail: { id: r.datos.solicitud.id, destino } }));
  };

  const sinUnidades = opciones && !opciones.unidades.length;

  return (
    <Dialogo abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Solicitar a otra unidad" ancho="md"
      pie={
        <>
          <Boton variante="fantasma" onClick={() => setAbierto(false)}>Cancelar</Boton>
          <Boton variante="primario" type="submit" form="form-solicitud" cargando={enviando} disabled={!opciones || !!sinUnidades}>
            {enviando ? "Enviando" : "Enviar solicitud"}
          </Boton>
        </>
      }>
      <form id="form-solicitud" ref={form} onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-texto-2">La unidad destino decide si la acepta y a quién se la asigna. Tú quedarás como observador de la tarea.</p>
        {errores.general && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{errores.general}</p>}
        {errorCarga && (
          <p role="alert" className="flex items-center justify-between gap-3 rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">
            {errorCarga}
            <button type="button" onClick={() => void cargar()} className="font-rotulo text-xs font-semibold uppercase tracking-[0.1em] text-texto hover:underline">Reintentar</button>
          </p>
        )}
        {sinUnidades && (
          <p role="status" className="rounded-sm border border-hilo bg-superficie-2 px-3 py-2 text-sm text-texto-2">
            Ya llevas todas las unidades registradas: crea la tarea directamente en vez de solicitarla.
          </p>
        )}

        <Campo etiqueta="Qué necesitas" error={errores.titulo}>
          {(a) => <Entrada {...a} name="titulo" maxLength={255} autoComplete="off" placeholder="Ej.: Informe de menciones de la campaña de octubre" autoFocus />}
        </Campo>

        <Campo etiqueta="Unidad destino" error={errores.unidad}>
          {(a) => opciones ? (
            <Selector {...a} name="unidad" defaultValue="" disabled={!!sinUnidades}>
              <option value="" disabled>Elige una unidad</option>
              {opciones.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          ) : <Esqueleto className="h-10" />}
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Prioridad">
            {(a) => opciones ? (
              <Selector {...a} name="prioridad" defaultValue={opciones.prioridadDefecto} key={opciones.prioridadDefecto}>
                {opciones.prioridades.map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
              </Selector>
            ) : <Esqueleto className="h-10" />}
          </Campo>
          <Campo etiqueta="Fecha deseada" ayuda="Opcional. La unidad puede ajustarla." error={errores.entrega}>
            {(a) => <Entrada {...a} name="entrega" type="date" min={opciones?.hoy} className="font-mono cifras" />}
          </Campo>
        </div>

        <details className="group rounded-sm border border-hilo">
          <summary className="flex h-10 cursor-pointer list-none items-center justify-between px-3 font-rotulo text-xs font-semibold uppercase tracking-[0.12em] text-texto-2 hover:text-texto [&::-webkit-details-marker]:hidden">
            Más detalles: descripción y cliente
            <ChevronDown aria-hidden className="size-4 text-texto-3 transition-transform duration-[var(--dur)] group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-4 border-t border-hilo p-3">
            <Campo etiqueta="Descripción">
              {(a) => <AreaTexto {...a} name="descripcion" rows={3} placeholder="Contexto, entregables, enlaces…" />}
            </Campo>
            <Campo etiqueta="Cliente">
              {(a) => <Entrada {...a} name="cliente" maxLength={100} autoComplete="off" />}
            </Campo>
          </div>
        </details>
      </form>
    </Dialogo>
  );
}
