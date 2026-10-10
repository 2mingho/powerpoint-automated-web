"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign, Bell, Check, CheckCheck, CircleCheck, CircleX, Clock, Eye, Inbox, Landmark, MessageSquare, Repeat, TriangleAlert, UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui/cx";
import { pedir } from "@/components/ui/pedir";
import { haceCuanto } from "@/components/ui/fechas";
import { Esqueleto } from "@/components/ui/panel";

type Notificacion = {
  id: number; tipo: string; titulo: string; cuerpo: string; enlace: string | null; leida: boolean; creada: string;
};

const ICONOS: Record<string, LucideIcon> = {
  task_assigned: UserPlus, task_reassigned: Repeat, task_due_soon: Clock, task_overdue: TriangleAlert,
  task_comment: MessageSquare, mention: AtSign, request_received: Inbox, request_accepted: CircleCheck,
  request_rejected: CircleX, task_watching: Eye, finance_grant: Landmark,
};

const SONDEO_MS = 45_000;

/*
 * Campana de la cabecera (static/js/notifications.js). El contador se sondea
 * cada 45 s solo con la pestana a la vista; al volver a ella se refresca en el
 * acto. El panel es un desplegable, no un modal: se cierra con Escape o al
 * pulsar fuera, y no bloquea la pagina.
 *
 * Lo no leido queda encendido (amarillo: "cambio y no lo has visto") hasta
 * que se marca. Lo que llega con el panel abierto entra desde arriba.
 */
export function Campana() {
  const router = useRouter();
  const idPanel = useId();
  const [abierto, setAbierto] = useState(false);
  const [noLeidas, setNoLeidas] = useState<number | null>(null);
  const [items, setItems] = useState<Notificacion[] | null>(null);
  const [error, setError] = useState("");
  const [nuevas, setNuevas] = useState<Set<number>>(new Set());
  const vistas = useRef<Set<number> | null>(null);
  const previo = useRef<number | null>(null);
  const [pulso, setPulso] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  const abiertoRef = useRef(false);
  useEffect(() => { abiertoRef.current = abierto; }, [abierto]);

  const cargarLista = useCallback(async () => {
    const r = await pedir<{ items: Notificacion[]; noLeidas: number }>("/api/notificaciones?limite=20");
    if (!r.ok) { setError(r.error || "No se pudieron cargar las notificaciones."); return; }
    setError("");
    previo.current = r.datos.noLeidas;
    setNoLeidas(r.datos.noLeidas);
    // La primera carga no es "nueva": solo lo que aparece despues.
    if (vistas.current) {
      const llegadas = r.datos.items.filter((n) => !vistas.current!.has(n.id)).map((n) => n.id);
      if (llegadas.length) setNuevas((s) => new Set([...s, ...llegadas]));
    }
    vistas.current = new Set([...(vistas.current ?? []), ...r.datos.items.map((n) => n.id)]);
    setItems(r.datos.items);
  }, []);

  /* Si el numero sube, la cifra entra como una paleta y, con el panel abierto, la lista se refresca. */
  const cargarContador = useCallback(async () => {
    const r = await pedir<{ noLeidas: number }>("/api/notificaciones/contador");
    if (!r.ok) return;
    const n = r.datos.noLeidas;
    if (previo.current != null && n > previo.current) {
      setPulso((x) => x + 1);
      if (abiertoRef.current) void cargarLista();
    }
    previo.current = n;
    setNoLeidas(n);
  }, [cargarLista]);

  // Sondeo con la pestana visible: suscripcion a visibilitychange, la carga inicial va dentro.
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const arrancar = () => { if (t === null) t = setInterval(cargarContador, SONDEO_MS); };
    const parar = () => { if (t !== null) { clearInterval(t); t = null; } };
    const alCambiar = () => {
      if (document.hidden) parar();
      else { void cargarContador(); arrancar(); }
    };
    document.addEventListener("visibilitychange", alCambiar);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!document.hidden) { void cargarContador(); arrancar(); }
    return () => { document.removeEventListener("visibilitychange", alCambiar); parar(); };
  }, [cargarContador]);

  // Cerrar al pulsar fuera o con Escape (devuelve el foco a la campana).
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setAbierto(false); boton.current?.focus(); } };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierto]);

  const alternar = () => {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir) void cargarLista();
  };

  const marcar = async (n: Notificacion) => {
    if (n.leida) return;
    setItems((l) => l?.map((x) => (x.id === n.id ? { ...x, leida: true } : x)) ?? null);
    setNoLeidas((c) => (c == null ? c : Math.max(0, c - 1)));
    previo.current = Math.max(0, (previo.current ?? 1) - 1);
    const r = await pedir<{ noLeidas: number }>(`/api/notificaciones/${n.id}/leida`, { method: "POST" });
    if (r.ok) { previo.current = r.datos.noLeidas; setNoLeidas(r.datos.noLeidas); }
  };

  const abrirDestino = async (n: Notificacion) => {
    await marcar(n);
    setAbierto(false);
    if (n.enlace) router.push(n.enlace);
  };

  const marcarTodas = async () => {
    setItems((l) => l?.map((x) => ({ ...x, leida: true })) ?? null);
    previo.current = 0;
    setNoLeidas(0);
    const r = await pedir("/api/notificaciones/leer-todas", { method: "POST" });
    if (!r.ok) { setError(r.error); void cargarLista(); }
  };

  const hay = (noLeidas ?? 0) > 0;
  const etiqueta = hay ? `Notificaciones: ${noLeidas} sin leer` : "Notificaciones";

  return (
    <div ref={raiz} className="relative">
      <button ref={boton} type="button" onClick={alternar} aria-expanded={abierto} aria-controls={idPanel}
        aria-label={etiqueta} data-tour="campana"
        className={cx(
          "relative grid size-10 place-items-center rounded-sm text-texto-2 transition-colors duration-[var(--dur)] hover:bg-superficie-2 hover:text-texto",
          abierto && "bg-superficie-2 text-texto",
        )}>
        <Bell className="size-[1.125rem]" aria-hidden />
        {hay && (
          <span aria-hidden className="absolute right-1 top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center overflow-hidden rounded-sm bg-marca px-1 font-mono text-[0.6875rem] font-bold leading-none text-marca-tinta cifras">
            <span key={pulso} className={cx(pulso > 0 && "motion-safe:animate-[paleta_var(--dur-vista)_var(--curva)]")}>
              {noLeidas! > 99 ? "99+" : noLeidas}
            </span>
          </span>
        )}
      </button>

      {abierto && (
        <section id={idPanel} aria-label="Notificaciones"
          className="absolute right-0 top-full z-40 mt-2 flex w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-hilo bg-superficie text-texto shadow-3 motion-safe:animate-[entrada-aviso_var(--dur)_var(--curva)]">
          <header className="flex h-12 items-center justify-between gap-3 border-b border-hilo px-4">
            <h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">
              Notificaciones
              {hay && <span className="ml-2 font-mono text-xs font-medium tracking-normal text-texto-3 cifras">{noLeidas} sin leer</span>}
            </h2>
            <button type="button" onClick={marcarTodas} disabled={!hay}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 font-rotulo text-xs font-semibold uppercase tracking-[0.1em] text-texto-2 transition-colors hover:bg-superficie-2 hover:text-texto disabled:pointer-events-none disabled:opacity-40">
              <CheckCheck className="size-3.5" aria-hidden />Marcar todas
            </button>
          </header>

          <div className="max-h-[min(70dvh,34rem)] overflow-y-auto overscroll-contain">
            {error && (
              <div role="alert" className="flex items-center justify-between gap-3 border-b border-hilo px-4 py-3 text-sm text-alerta">
                {error}
                <button type="button" onClick={() => void cargarLista()} className="font-rotulo text-xs font-semibold uppercase tracking-[0.1em] text-texto hover:underline">Reintentar</button>
              </div>
            )}
            {items == null && !error && (
              <ul aria-hidden className="divide-y divide-hilo">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex gap-3 px-4 py-3"><Esqueleto className="size-4" /><div className="flex-1 space-y-2"><Esqueleto className="w-3/4" /><Esqueleto className="h-3 w-1/3" /></div></li>
                ))}
              </ul>
            )}
            {items?.length === 0 && (
              <div className="px-4 py-8">
                <p className="font-rotulo text-base font-semibold uppercase tracking-[0.08em]">Todo al día</p>
                <p className="mt-1 max-w-[38ch] text-sm text-texto-2">Aquí te avisamos cuando te asignen una tarea, te mencionen o respondan a una solicitud tuya.</p>
              </div>
            )}
            {!!items?.length && (
              <ul className="divide-y divide-hilo">
                {items.map((n) => (
                  <FilaNotificacion key={n.id} n={n} nueva={nuevas.has(n.id)} onAbrir={() => void abrirDestino(n)} onMarcar={() => void marcar(n)} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function FilaNotificacion({ n, nueva, onAbrir, onMarcar }: { n: Notificacion; nueva: boolean; onAbrir: () => void; onMarcar: () => void }) {
  const Icono = ICONOS[n.tipo] ?? Bell;
  return (
    <li data-leida={n.leida || undefined}
      className={cx(
        "group relative flex items-start transition-colors duration-[var(--dur-vista)] ease-salida",
        n.leida ? "bg-superficie" : "bg-marca/12 dark:bg-marca/[0.07]",
        nueva && "motion-safe:animate-[entrada-aviso_var(--dur-vista)_var(--curva)]",
      )}>
      <button type="button" onClick={onAbrir}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2 text-left hover:bg-superficie-2/70 focus-visible:-outline-offset-2">
        <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-sm", n.leida ? "text-texto-3" : "bg-marca text-marca-tinta")}>
          <Icono className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("block text-sm leading-5", n.leida ? "text-texto-2" : "font-semibold text-texto")}>{n.titulo}</span>
          {n.cuerpo && <span className="mt-0.5 line-clamp-2 block text-sm text-texto-2">{n.cuerpo}</span>}
          <span className="mt-1 block font-mono text-xs text-texto-3 cifras">
            <time dateTime={n.creada}>{haceCuanto(n.creada)}</time>
            {!n.leida && <span className="sr-only"> · sin leer</span>}
          </span>
        </span>
      </button>
      {!n.leida && (
        <button type="button" onClick={onMarcar} aria-label={`Marcar como leída: ${n.titulo}`} title="Marcar como leída"
          className="m-2 grid size-9 shrink-0 place-items-center rounded-sm text-texto-3 transition-colors hover:bg-superficie hover:text-texto">
          <Check className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}
