"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { CeldaEstado, type Tono } from "@/components/ui/estado";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Campo, Entrada, Selector } from "@/components/ui/campo";
import { Esqueleto } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { cx } from "@/components/ui/cx";
import { pedir } from "@/components/ui/pedir";
import { entregaRelativa, momentoCorto } from "@/components/ui/fechas";
import type { SolicitudVista } from "@/lib/solicitudes/servicio";
import { MIN_MOTIVO, TONO_ESTADO } from "@/lib/solicitudes/reglas";

const TONO_TEXTO: Record<Tono, string> = {
  neutro: "text-texto", info: "text-info", aviso: "text-aviso", alerta: "text-alerta", bien: "text-bien", violeta: "text-violeta",
};

type PropsDetalle = {
  s: SolicitudVista | null;
  hoy: string;
  tonosPrioridad: Record<string, Tono>;
  encendida: boolean;
  onCerrar: () => void;
  onResuelta: (s: SolicitudVista) => void;
  onRefrescar: () => void;
};

function useEsAncho() {
  const [ancho, setAncho] = useState<boolean | null>(null);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const f = () => setAncho(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return ancho;
}

/*
 * El pase de la solicitud: celdas rotuladas, su recorrido por fases y las
 * decisiones. En escritorio vive a la derecha del panel; en movil sube como
 * hoja desde abajo.
 */
export function Detalle(p: PropsDetalle) {
  const ancho = useEsAncho();
  return (
    <>
      <aside aria-label="Detalle de la solicitud"
        className="sticky top-[4.5rem] hidden max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-md border border-hilo bg-superficie shadow-1 lg:block">
        {p.s ? <Pase key={p.s.id} {...p} s={p.s} /> : (
          <div className="px-5 py-10">
            <p className="font-rotulo text-base font-semibold uppercase tracking-[0.08em]">Elige una solicitud</p>
            <p className="mt-1 text-sm text-texto-2">Verás su recorrido, quién la pidió y, si te toca, podrás aceptarla o rechazarla aquí.</p>
          </div>
        )}
      </aside>
      {ancho === false && p.s && <Hoja onCerrar={p.onCerrar}><Pase key={p.s.id} {...p} s={p.s} /></Hoja>}
    </>
  );
}

function Hoja({ onCerrar, children }: { onCerrar: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onCerrar} aria-label="Detalle de la solicitud"
      onClick={(e) => { if (e.target === ref.current) onCerrar(); }}
      className="mx-0 mb-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-md border-t border-hilo bg-superficie p-0 pb-[env(safe-area-inset-bottom)] text-texto shadow-3 backdrop:bg-tinta/45 open:motion-safe:animate-[entrada-aviso_var(--dur-vista)_var(--curva)]">
      {children}
    </dialog>
  );
}

type Modo = "ver" | "aceptar" | "rechazar" | "cancelar";

function Pase({ s, hoy, tonosPrioridad, encendida, onCerrar, onResuelta, onRefrescar }: PropsDetalle & { s: SolicitudVista }) {
  const [modo, setModo] = useState<Modo>("ver");
  const entrega = entregaRelativa(s.entrega, hoy);
  const pendiente = s.estado === "Pendiente";

  return (
    <article className="flex flex-col">
      <header className="flex h-12 items-center gap-3 border-b border-hilo px-5">
        <span className="font-mono text-sm text-texto-3 cifras">#{String(s.id).padStart(5, "0")}</span>
        <CeldaEstado texto={s.estado} tono={TONO_ESTADO[s.estado]} cambio={s.estado} encendidaInicial={encendida} />
        <button type="button" onClick={onCerrar} aria-label="Cerrar detalle"
          className="ml-auto grid size-9 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto">
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="px-5 pb-4 pt-4">
        <h2 className="text-lg font-semibold leading-snug text-texto [overflow-wrap:anywhere]">{s.titulo}</h2>
        {s.cliente && <p className="mt-1 text-sm text-texto-2">Cliente: {s.cliente}</p>}
      </div>

      <dl className="mx-5 grid grid-cols-2 overflow-hidden rounded-sm border border-hilo">
        <Celda rotulo="Entrega">
          <span className={cx("font-mono cifras", pendiente ? TONO_TEXTO[entrega.tono] : "text-texto")}>
            {s.entrega ? (entrega.texto === "Hoy" ? `Hoy · ${s.entrega.slice(8, 10)}/${s.entrega.slice(5, 7)}` : entrega.texto) : "Sin fecha"}
          </span>
        </Celda>
        <Celda rotulo="Prioridad" borde="izq">
          <span className={TONO_TEXTO[tonosPrioridad[s.prioridad] ?? "neutro"]}>{s.prioridad}</span>
        </Celda>
        <Celda rotulo="Para" borde="arriba">{s.destino.nombre}</Celda>
        <Celda rotulo="De" borde="ambos">
          {s.solicitante.nombre}
          <span className="block truncate text-sm text-texto-3">{s.origen?.nombre ?? "Sin unidad"}</span>
        </Celda>
      </dl>

      {s.descripcion && (
        <div className="px-5 pt-4">
          <p className="rotulo">Descripción</p>
          <p className="mt-1 whitespace-pre-wrap text-base text-texto-2 [overflow-wrap:anywhere]">{s.descripcion}</p>
        </div>
      )}

      <Recorrido s={s} hoy={hoy} />

      {pendiente && (
        <div className="border-t border-hilo px-5 py-4">
          {modo === "ver" && <Decisiones s={s} onModo={setModo} />}
          {modo === "aceptar" && <FormAceptar s={s} hoy={hoy} onVolver={() => setModo("ver")} onResuelta={onResuelta} onRefrescar={onRefrescar} />}
          {modo === "rechazar" && <FormRechazar s={s} onVolver={() => setModo("ver")} onResuelta={onResuelta} onRefrescar={onRefrescar} />}
          {modo === "cancelar" && <ConfirmarCancelar s={s} onVolver={() => setModo("ver")} onResuelta={onResuelta} onRefrescar={onRefrescar} />}
        </div>
      )}
    </article>
  );
}

function Celda({ rotulo, borde, children }: { rotulo: string; borde?: "izq" | "arriba" | "ambos"; children: React.ReactNode }) {
  return (
    <div className={cx("min-w-0 px-3 py-2.5",
      (borde === "izq" || borde === "ambos") && "border-l border-hilo",
      (borde === "arriba" || borde === "ambos") && "border-t border-hilo")}>
      <dt className="rotulo">{rotulo}</dt>
      <dd className="mt-0.5 truncate text-base text-texto">{children}</dd>
    </div>
  );
}

/* Fases: Enviada -> Aceptada / Rechazada / Cancelada -> Tarea creada. */
function Recorrido({ s, hoy }: { s: SolicitudVista; hoy: string }) {
  type Fase = { clave: string; rotulo: string; estado: "hecho" | "activo" | "cola" | "fallo" | "omitida"; insignia: string; detalle?: React.ReactNode };
  const resuelta = s.resuelta ? `${momentoCorto(s.resuelta, hoy)} · ${s.resueltaPor?.nombre ?? ""}` : "";
  const fases: Fase[] = [
    { clave: "enviada", rotulo: "Enviada", estado: "hecho", insignia: "Hecho", detalle: `${momentoCorto(s.enviada, hoy)} · ${s.solicitante.nombre}` },
  ];
  if (s.estado === "Pendiente") {
    fases.push({ clave: "decision", rotulo: "Decisión", estado: "activo", insignia: "En espera", detalle: `La resuelve quien lidera ${s.destino.nombre}.` });
    fases.push({ clave: "tarea", rotulo: "Tarea creada", estado: "cola", insignia: "En cola" });
  } else if (s.estado === "Aceptada") {
    fases.push({ clave: "decision", rotulo: "Aceptada", estado: "hecho", insignia: "Hecho", detalle: resuelta });
    fases.push({
      clave: "tarea", rotulo: "Tarea creada", estado: "hecho", insignia: "Hecho",
      detalle: s.tareaId ? (
        <Link href={`/tareas?tarea=${s.tareaId}`} className="inline-flex items-center gap-1 font-medium text-texto underline decoration-hilo-fuerte hover:decoration-texto">
          Abrir tarea <span className="font-mono cifras">#{s.tareaId}</span><ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      ) : "La tarea ya no existe.",
    });
  } else {
    fases.push({
      clave: "decision", rotulo: s.estado, estado: "fallo", insignia: s.estado,
      detalle: <>{resuelta}{s.motivo && <span className="mt-1 block text-texto">Motivo: {s.motivo}</span>}</>,
    });
    fases.push({ clave: "tarea", rotulo: "Tarea creada", estado: "omitida", insignia: "No aplica" });
  }

  return (
    <section aria-label="Recorrido" className="px-5 pt-5">
      <p className="rotulo mb-2">Recorrido</p>
      <ol className="divide-y divide-hilo rounded-sm border border-hilo">
        {fases.map((f, i) => (
          <li key={f.clave} className="flex items-start gap-3 px-3 py-2.5">
            <span className="mt-0.5 w-5 font-mono text-xs text-texto-3 cifras">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <p className={cx("font-rotulo text-sm font-semibold uppercase tracking-[0.1em]", f.estado === "cola" || f.estado === "omitida" ? "text-texto-3" : "text-texto")}>{f.rotulo}</p>
              {f.detalle && <div className="mt-0.5 text-sm text-texto-2 [overflow-wrap:anywhere]">{f.detalle}</div>}
            </div>
            <span className={cx(
              "inline-flex h-6 shrink-0 items-center rounded-sm border px-2 font-rotulo text-xs font-semibold uppercase tracking-[0.1em]",
              f.estado === "hecho" && "border-bien/40 text-bien",
              f.estado === "activo" && "border-aviso/40 text-aviso",
              f.estado === "cola" && "border-hilo text-texto-3",
              f.estado === "omitida" && "border-hilo text-texto-3",
              f.estado === "fallo" && (s.estado === "Rechazada" ? "border-alerta/40 text-alerta" : "border-neutro/35 text-neutro"),
            )}>{f.insignia}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Decisiones({ s, onModo }: { s: SolicitudVista; onModo: (m: Modo) => void }) {
  if (!s.puedeResolver && !s.puedeCancelar) {
    return <p className="text-sm text-texto-2">La decide quien lidera {s.destino.nombre}. Te avisaremos cuando la resuelvan.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {s.puedeResolver && (
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="primario" onClick={() => onModo("aceptar")} icono={<Check className="size-4" aria-hidden />}>Aceptar</Boton>
          <Boton variante="secundario" onClick={() => onModo("rechazar")} icono={<X className="size-4" aria-hidden />}>Rechazar</Boton>
        </div>
      )}
      {s.puedeCancelar && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-texto-2">{s.esMia ? "¿Ya no la necesitas?" : "La pidió otra persona."}</p>
          <Boton variante="fantasma" tamano="sm" onClick={() => onModo("cancelar")}>Cancelar solicitud</Boton>
        </div>
      )}
    </div>
  );
}

type PropsAccion = { s: SolicitudVista; onVolver: () => void; onResuelta: (s: SolicitudVista) => void; onRefrescar: () => void };

/* Si otro la resolvio antes (409), se trae el estado real y se ensena. */
async function alConflicto(s: SolicitudVista, onResuelta: (s: SolicitudVista) => void, onRefrescar: () => void) {
  const r = await pedir<{ solicitud: SolicitudVista }>(`/api/solicitudes/${s.id}`);
  if (r.ok) onResuelta(r.datos.solicitud); else onRefrescar();
}

function FormAceptar({ s, hoy, onVolver, onResuelta, onRefrescar }: PropsAccion & { hoy: string }) {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState<{ usuarios: { id: number; nombre: string }[]; entrega: string } | null>(null);
  const [errorCarga, setErrorCarga] = useState("");
  const [responsable, setResponsable] = useState("");
  const [entrega, setEntrega] = useState(s.entrega || hoy);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const selector = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let vivo = true;
    void pedir<{ usuarios: { id: number; nombre: string }[]; entrega: string }>(`/api/solicitudes/${s.id}/asignables`).then((r) => {
      if (!vivo) return;
      if (!r.ok) { setErrorCarga(r.error); return; }
      setDatos(r.datos);
      if (r.datos.usuarios.length === 1) setResponsable(String(r.datos.usuarios[0].id));
      setTimeout(() => selector.current?.focus(), 0);
    });
    return () => { vivo = false; };
  }, [s.id]);

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responsable) { setError("Elige a quién se le asigna la tarea."); selector.current?.focus(); return; }
    setEnviando(true);
    setError("");
    const r = await pedir<{ solicitud: SolicitudVista; tareaId: number }>(`/api/solicitudes/${s.id}/aceptar`, {
      method: "POST", json: { responsableId: Number(responsable), entrega },
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.status === 409 ? "Alguien la resolvió antes que tú. Este es su estado actual." : r.error);
      if (r.status === 409) await alConflicto(s, onResuelta, onRefrescar);
      return;
    }
    const nombre = datos?.usuarios.find((u) => String(u.id) === responsable)?.nombre ?? "";
    avisar(`Solicitud aceptada. Tarea #${r.datos.tareaId} asignada a ${nombre}.`, { tipo: "exito" });
    onResuelta(r.datos.solicitud);
  };

  return (
    <form onSubmit={confirmar} noValidate className="flex flex-col gap-3">
      <p className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em]">Aceptar y crear la tarea</p>
      <p className="text-sm text-texto-2">Se crea en {s.destino.nombre}, visible para quien la pidió, que queda como observador.</p>
      {errorCarga ? <p role="alert" className="text-sm text-alerta">{errorCarga}</p> : (
        <Campo etiqueta="Responsable" error={error || (datos && !datos.usuarios.length ? `${s.destino.nombre} no tiene a nadie activo. Avisa a un administrador.` : undefined)}>
          {(a) => datos ? (
            <Selector {...a} ref={selector} value={responsable} onChange={(e) => { setResponsable(e.target.value); setError(""); }} disabled={!datos.usuarios.length}>
              <option value="" disabled>Elige a quién se asigna</option>
              {datos.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          ) : <Esqueleto className="h-10" />}
        </Campo>
      )}
      <Campo etiqueta="Entrega">
        {(a) => <Entrada {...a} type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} className="font-mono cifras" />}
      </Campo>
      <div className="mt-1 flex justify-end gap-2">
        <Boton variante="fantasma" onClick={onVolver} disabled={enviando}>Volver</Boton>
        <Boton variante="primario" type="submit" cargando={enviando} disabled={!datos?.usuarios.length}>{enviando ? "Creando" : "Crear tarea"}</Boton>
      </div>
    </form>
  );
}

function FormRechazar({ s, onVolver, onResuelta, onRefrescar }: PropsAccion) {
  const { avisar } = useAvisos();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (motivo.trim().length < MIN_MOTIVO) { setError(`Escribe el motivo (mínimo ${MIN_MOTIVO} caracteres). Le llega a quien la pidió.`); return; }
    setEnviando(true);
    const r = await pedir<{ solicitud: SolicitudVista }>(`/api/solicitudes/${s.id}/rechazar`, { method: "POST", json: { motivo: motivo.trim() } });
    setEnviando(false);
    if (!r.ok) {
      setError(r.status === 409 ? "Alguien la resolvió antes que tú. Este es su estado actual." : r.error);
      if (r.status === 409) await alConflicto(s, onResuelta, onRefrescar);
      return;
    }
    avisar(`Solicitud rechazada. Avisamos a ${s.solicitante.nombre}.`, { tipo: "exito" });
    onResuelta(r.datos.solicitud);
  };

  return (
    <form onSubmit={confirmar} noValidate className="flex flex-col gap-3">
      <p className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em]">Rechazar la solicitud</p>
      <Campo etiqueta="Motivo" error={error} ayuda="Le llega a quien la pidió. Sé concreto: qué falta o a quién debería pedírselo.">
        {(a) => <AreaTexto {...a} autoFocus value={motivo} rows={3} onChange={(e) => { setMotivo(e.target.value); setError(""); }}
          placeholder="Ej.: Falta el detalle del cliente y la fecha objetivo." />}
      </Campo>
      <div className="mt-1 flex justify-end gap-2">
        <Boton variante="fantasma" onClick={onVolver} disabled={enviando}>Volver</Boton>
        <Boton variante="peligro" type="submit" cargando={enviando}>{enviando ? "Rechazando" : "Rechazar solicitud"}</Boton>
      </div>
    </form>
  );
}

function ConfirmarCancelar({ s, onVolver, onResuelta, onRefrescar }: PropsAccion) {
  const { avisar } = useAvisos();
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const confirmar = async () => {
    setEnviando(true);
    const r = await pedir<{ solicitud: SolicitudVista }>(`/api/solicitudes/${s.id}/cancelar`, { method: "POST" });
    setEnviando(false);
    if (!r.ok) {
      setError(r.status === 409 ? "Ya la resolvieron. Este es su estado actual." : r.error);
      if (r.status === 409) await alConflicto(s, onResuelta, onRefrescar);
      return;
    }
    avisar("Solicitud cancelada.", { tipo: "exito" });
    onResuelta(r.datos.solicitud);
  };
  return (
    <div role="group" aria-label="Confirmar cancelación" className="flex flex-col gap-3">
      <p className="text-sm text-texto">¿Cancelar «{s.titulo}»? {s.destino.nombre} dejará de tenerla por decidir. No se puede deshacer.</p>
      {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
      <div className="flex justify-end gap-2">
        <Boton variante="fantasma" onClick={onVolver} disabled={enviando} autoFocus>Volver</Boton>
        <Boton variante="peligro" onClick={confirmar} cargando={enviando}>{enviando ? "Cancelando" : "Sí, cancelar"}</Boton>
      </div>
    </div>
  );
}
