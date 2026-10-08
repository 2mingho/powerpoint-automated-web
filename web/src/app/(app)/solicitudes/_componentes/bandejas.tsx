"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Contador } from "@/components/ui/contador";
import { CeldaEstado, type Tono } from "@/components/ui/estado";
import { Boton } from "@/components/ui/boton";
import { Panel, Vacio, Esqueleto } from "@/components/ui/panel";
import { cx } from "@/components/ui/cx";
import { pedir } from "@/components/ui/pedir";
import { entregaRelativa, momentoCorto } from "@/components/ui/fechas";
import { EVENTO_SOLICITUD_ENVIADA, type DetalleSolicitudEnviada } from "@/components/cabecera/eventos";
import type { Listado, SolicitudVista } from "@/lib/solicitudes/servicio";
import { ordenarBandeja, TONO_ESTADO, type Bandeja } from "@/lib/solicitudes/reglas";
import { Detalle } from "./detalle";
import { BotonNuevaSolicitud } from "./boton-nueva";

const SONDEO_MS = 45_000;
const CLAVE_VISTAS = "nl-solicitudes-vistas";
const TONO_TEXTO: Record<Tono, string> = {
  neutro: "text-texto-3", info: "text-info", aviso: "text-aviso", alerta: "text-alerta", bien: "text-bien", violeta: "text-violeta",
};

/* Ultimo estado visto de cada solicitud, para encender lo que cambio desde la ultima visita. */
function leerVistas(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CLAVE_VISTAS) ?? "{}") ?? {}; } catch { return {}; }
}
function guardarVistas(lista: SolicitudVista[]) {
  try {
    const v = leerVistas();
    for (const s of lista) v[s.id] = s.estado;
    const claves = Object.keys(v);
    // Acotado: solo las ultimas 500.
    for (const k of claves.slice(0, Math.max(0, claves.length - 500))) delete v[k];
    localStorage.setItem(CLAVE_VISTAS, JSON.stringify(v));
  } catch { /* sin almacenamiento solo se pierde el encendido entre visitas */ }
}

type Props = {
  inicial: Listado;
  bandejaInicial: Bandeja;
  seleccionInicial: SolicitudVista | null;
  avisoSeleccion: string;
  tonosPrioridad: Record<string, Tono>;
  hoy: string;
  sinUnidad: boolean;
  puedeSolicitar: boolean;
};

export function Bandejas(p: Props) {
  const [bandeja, setBandeja] = useState<Bandeja>(p.bandejaInicial);
  const [listas, setListas] = useState<Partial<Record<Bandeja, SolicitudVista[]>>>({ [p.bandejaInicial]: p.inicial.solicitudes });
  const [contadores, setContadores] = useState(p.inicial.contadores);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [encendidas, setEncendidas] = useState<Set<number>>(new Set());
  const [seleccion, setSeleccion] = useState<SolicitudVista | null>(() => {
    if (p.seleccionInicial) return p.seleccionInicial;
    // Lo de hoy primero: en escritorio el pase abre en lo primero por decidir.
    const primera = p.inicial.solicitudes.find((s) => s.estado === "Pendiente" && s.puedeResolver);
    return p.bandejaInicial === "recibidas" ? primera ?? null : null;
  });
  // La que se elige sola (lo primero por decidir) se ve en el pase de escritorio, pero no abre la hoja del movil.
  const [automatica, setAutomatica] = useState(!p.seleccionInicial);
  const [aviso, setAviso] = useState(p.avisoSeleccion);
  const reducir = useReducedMotion();
  const bandejaRef = useRef(bandeja);
  useEffect(() => { bandejaRef.current = bandeja; }, [bandeja]);

  const marcarVistas = useCallback((lista: SolicitudVista[]) => {
    const previas = leerVistas();
    const cambiaron = lista.filter((s) => previas[s.id] && previas[s.id] !== s.estado).map((s) => s.id);
    if (cambiaron.length) setEncendidas((e) => new Set([...e, ...cambiaron]));
    guardarVistas(lista);
  }, []);

  // localStorage es un sistema externo: solo se puede leer despues de montar.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { marcarVistas(p.inicial.solicitudes); }, [marcarVistas, p.inicial.solicitudes]);

  const cargar = useCallback(async (b: Bandeja, silencioso = false) => {
    if (!silencioso) { setCargando(true); setError(""); }
    const r = await pedir<Listado>(`/api/solicitudes?bandeja=${b}`);
    if (!silencioso) setCargando(false);
    if (!r.ok) { if (!silencioso) setError(r.error); return null; }
    setListas((l) => ({ ...l, [b]: r.datos.solicitudes }));
    setContadores(r.datos.contadores);
    marcarVistas(r.datos.solicitudes);
    // El pase sigue a la fila: si cambio en el servidor, se ve el estado nuevo.
    setSeleccion((s) => (s ? r.datos.solicitudes.find((x) => x.id === s.id) ?? s : s));
    return r.datos;
  }, [marcarVistas]);

  // Sondeo con la pestana visible, y al volver a ella.
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const arrancar = () => { if (t === null) t = setInterval(() => void cargar(bandejaRef.current, true), SONDEO_MS); };
    const parar = () => { if (t !== null) { clearInterval(t); t = null; } };
    const alCambiar = () => { if (document.hidden) parar(); else { void cargar(bandejaRef.current, true); arrancar(); } };
    document.addEventListener("visibilitychange", alCambiar);
    if (!document.hidden) arrancar();
    return () => { document.removeEventListener("visibilitychange", alCambiar); parar(); };
  }, [cargar]);

  // Recien enviada desde el formulario global: se ensena en Enviadas, seleccionada.
  useEffect(() => {
    const alEnviar = async (e: Event) => {
      const { id } = (e as CustomEvent<DetalleSolicitudEnviada>).detail ?? {};
      setBandeja("enviadas");
      const d = await cargar("enviadas", true);
      const nueva = d?.solicitudes.find((s) => s.id === id);
      if (nueva) { setAutomatica(true); setSeleccion(nueva); setEncendidas((x) => new Set([...x, nueva.id])); }
    };
    window.addEventListener(EVENTO_SOLICITUD_ENVIADA, alEnviar);
    return () => window.removeEventListener(EVENTO_SOLICITUD_ENVIADA, alEnviar);
  }, [cargar]);

  // La URL dice donde estas: recargar o compartir lleva al mismo sitio.
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("bandeja", bandeja);
    if (seleccion) u.searchParams.set("solicitud", String(seleccion.id)); else u.searchParams.delete("solicitud");
    if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u);
  }, [bandeja, seleccion]);

  const cambiarBandeja = (b: Bandeja) => {
    setBandeja(b);
    setAviso("");
    if (!listas[b]) void cargar(b); else void cargar(b, true);
  };

  /* Tras aceptar, rechazar o cancelar: la fila se queda, cambia de estado (encendida) y se desplaza a su sitio. */
  const alResolver = useCallback((s: SolicitudVista) => {
    setSeleccion(s);
    setListas((l) => {
      const n: typeof l = {};
      for (const [k, lista] of Object.entries(l) as [Bandeja, SolicitudVista[]][]) {
        const reemplazada = lista.map((x) => (x.id === s.id ? s : x));
        n[k] = k === "historial" ? reemplazada : ordenarBandeja(reemplazada);
      }
      return n;
    });
    guardarVistas([s]);
    void cargar(bandejaRef.current, true);
  }, [cargar]);

  const lista = listas[bandeja];
  const filas = useMemo(() => lista ?? [], [lista]);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Bandejas" data-tour="bandejas"
        className="grid grid-cols-3 divide-x divide-hilo overflow-hidden rounded-md border border-hilo bg-superficie shadow-1 [&>button]:w-full">
        <Contador rotulo="Recibidas" valor={contadores.recibidas} tono="aviso" activo={bandeja === "recibidas"} detalle="por decidir" onClick={() => cambiarBandeja("recibidas")} />
        <Contador rotulo="Enviadas" valor={contadores.enviadas} tono="info" activo={bandeja === "enviadas"} detalle="esperan respuesta" onClick={() => cambiarBandeja("enviadas")} />
        <Contador rotulo="Historial" valor={contadores.historial} activo={bandeja === "historial"} detalle="resueltas" onClick={() => cambiarBandeja("historial")} />
      </nav>

      {aviso && (
        <p role="status" className="flex items-center justify-between gap-3 rounded-sm border border-hilo bg-superficie px-4 py-2 text-sm text-texto-2">
          {aviso}
          <button type="button" onClick={() => setAviso("")} className="font-rotulo text-xs font-semibold uppercase tracking-[0.1em] text-texto hover:underline">Entendido</button>
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel cuerpoClassName="flex flex-col" className="min-h-[20rem]">
          <div aria-label={`Bandeja ${bandeja}`} role="region" aria-busy={cargando || undefined}>
            <div className="hidden h-10 items-center gap-3 border-b border-hilo px-4 md:grid md:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,11rem)_5.5rem_7.5rem]">
              <span className="rotulo">Enviada</span>
              <span className="rotulo">Solicitud</span>
              <span className="rotulo">{bandeja === "recibidas" ? "De" : bandeja === "enviadas" ? "Para" : "De / Para"}</span>
              <span className="rotulo">Entrega</span>
              <span className="rotulo">Estado</span>
            </div>

            {error && (
              <div role="alert" className="flex flex-col items-start gap-3 px-4 py-8">
                <p className="font-rotulo text-lg font-semibold uppercase tracking-[0.08em]">No se pudo cargar la bandeja</p>
                <p className="text-texto-2">{error}</p>
                <Boton tamano="sm" onClick={() => void cargar(bandeja)}>Reintentar</Boton>
              </div>
            )}

            {!error && !lista && (
              <div aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex h-11 items-center gap-4 border-b border-hilo px-4"><Esqueleto className="w-16" /><Esqueleto className="flex-1" /><Esqueleto className="w-20" /></div>
                ))}
              </div>
            )}

            {!error && lista && !filas.length && <Vacia bandeja={bandeja} sinUnidad={p.sinUnidad} puedeSolicitar={p.puedeSolicitar} />}

            {!error && !!filas.length && (
              <ul className={cx("divide-y divide-hilo transition-opacity duration-[var(--dur)]", cargando && "opacity-60")}>
                {filas.map((s) => (
                  <motion.li key={s.id} layout={reducir ? false : "position"} transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}>
                    <Fila s={s} bandeja={bandeja} hoy={p.hoy} tonosPrioridad={p.tonosPrioridad}
                      seleccionada={seleccion?.id === s.id} soloEscritorio={automatica} encendida={encendidas.has(s.id)}
                      onElegir={() => { setAutomatica(false); setSeleccion(s); }} />
                  </motion.li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Detalle s={seleccion} automatica={automatica} hoy={p.hoy} tonosPrioridad={p.tonosPrioridad} encendida={!!seleccion && encendidas.has(seleccion.id)}
          onCerrar={() => setSeleccion(null)} onResuelta={alResolver} onRefrescar={() => void cargar(bandeja, true)} />
      </div>
    </div>
  );
}

function Fila({ s, bandeja, hoy, tonosPrioridad, seleccionada, soloEscritorio, encendida, onElegir }: {
  s: SolicitudVista; bandeja: Bandeja; hoy: string; tonosPrioridad: Record<string, Tono>;
  seleccionada: boolean; soloEscritorio: boolean; encendida: boolean; onElegir: () => void;
}) {
  // Elegida sola: solo se marca donde se ve su pase (escritorio).
  const fondo = !seleccionada ? "hover:bg-superficie-2/60" : soloEscritorio ? "hover:bg-superficie-2/60 lg:bg-superficie-2" : "bg-superficie-2";
  const filo = !seleccionada ? "scale-y-0" : soloEscritorio ? "scale-y-0 lg:scale-y-100" : "scale-y-100";
  const pendiente = s.estado === "Pendiente";
  const entrega = pendiente ? entregaRelativa(s.entrega, hoy) : { texto: s.entrega ? entregaRelativa(s.entrega, hoy).texto : "Sin fecha", tono: "neutro" as const };
  const origen = s.origen?.nombre ?? "Sin unidad";
  const dePara = bandeja === "recibidas"
    ? <><span className="text-texto">{origen}</span><span className="text-texto-3"> · {s.solicitante.nombre}</span></>
    : bandeja === "enviadas"
      ? <span className="text-texto">{s.destino.nombre}</span>
      : <span className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate">{origen}</span><ArrowRight className="size-3 shrink-0 text-texto-3" aria-label="a" /><span className="min-w-0 truncate text-texto">{s.destino.nombre}</span></span>;
  const tonoPrioridad = tonosPrioridad[s.prioridad] ?? "neutro";

  return (
    <button type="button" onClick={onElegir} aria-current={seleccionada || undefined}
      aria-label={`${s.titulo}. ${s.estado}. ${bandeja === "enviadas" ? "Para" : "De"} ${bandeja === "enviadas" ? s.destino.nombre : origen}`}
      className={cx(
        "relative grid w-full gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors duration-[var(--dur-instante)]",
        "grid-cols-[minmax(0,1fr)_auto] md:h-11 md:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,11rem)_5.5rem_7.5rem] md:items-center md:py-0",
        fondo,
        !pendiente && "text-texto-2",
      )}>
      <span aria-hidden className={cx("absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-texto transition-transform duration-[var(--dur)] ease-salida", filo)} />
      <time dateTime={s.enviada} className="order-3 col-span-2 font-mono text-xs text-texto-3 cifras md:order-none md:col-span-1 md:text-sm">
        {momentoCorto(s.enviada, hoy)}
        <span className="md:hidden"> · {bandeja === "enviadas" ? `Para ${s.destino.nombre}` : `De ${origen}`} · Entrega {entrega.texto}</span>
      </time>
      <span className="order-1 flex min-w-0 items-center gap-2 md:order-none">
        <span className={cx("truncate", pendiente ? "font-medium text-texto" : "")}>{s.titulo}</span>
        {pendiente && tonoPrioridad === "alerta" && (
          <span className={cx("shrink-0 font-rotulo text-[0.6875rem] font-semibold uppercase tracking-[0.1em]", TONO_TEXTO[tonoPrioridad])}>{s.prioridad}</span>
        )}
      </span>
      <span className="hidden min-w-0 truncate text-sm md:block">{dePara}</span>
      <span className={cx("hidden font-mono text-sm cifras md:block", TONO_TEXTO[entrega.tono], entrega.tono === "neutro" && "text-texto-2")}>{entrega.texto}</span>
      <span className="order-2 md:order-none">
        <CeldaEstado texto={s.estado} tono={TONO_ESTADO[s.estado]} cambio={s.estado} encendidaInicial={encendida} />
      </span>
    </button>
  );
}

function Vacia({ bandeja, sinUnidad, puedeSolicitar }: { bandeja: Bandeja; sinUnidad: boolean; puedeSolicitar: boolean }) {
  if (bandeja === "recibidas") {
    return sinUnidad ? (
      <Vacio titulo="Nadie te puede solicitar trabajo todavía">
        No tienes una unidad asignada, así que no te llegan solicitudes. Lo que tú pidas lo sigues en Enviadas. Si deberías tener unidad, avisa a un administrador.
      </Vacio>
    ) : (
      <Vacio titulo="Nada por decidir">
        Cuando otra unidad le pida trabajo a la tuya, aparecerá aquí. Quien lidera la unidad lo acepta, eligiendo a quién se le asigna, o lo rechaza con un motivo.
      </Vacio>
    );
  }
  if (bandeja === "enviadas") {
    return (
      <Vacio titulo="No has pedido nada estas semanas" accion={puedeSolicitar ? <BotonNuevaSolicitud tamano="sm" /> : undefined}>
        Cuando algo no te toca, no lo asignes: pídeselo a la unidad que lo hace. Ella decide quién se encarga y tú quedas como observador de la tarea.
      </Vacio>
    );
  }
  return <Vacio titulo="Sin historial todavía">Las solicitudes aceptadas, rechazadas o canceladas quedan aquí, con quién las resolvió y cuándo.</Vacio>;
}
