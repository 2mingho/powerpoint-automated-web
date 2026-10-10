"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { CeldaEstado } from "@/components/ui/estado";
import { Esqueleto } from "@/components/ui/panel";
import { fDia } from "@/lib/admin/formato";
import type { FichaCliente } from "@/lib/clientes/ficha";
import { posicionarFicha } from "@/lib/clientes/posicion";
import { usd, usdS } from "@/lib/finanzas/contratos";

/*
 * Ficha flotante de un cliente. Un solo contenedor para toda la aplicacion:
 *  - Raton: aparece a los 120 ms de pasar el cursor, sigue abierta mientras el
 *    cursor este sobre ella y se cierra 200 ms despues de salir.
 *  - Teclado: abre con el foco (o con Enter) y Escape la cierra devolviendo el foco.
 *  - Toque: no hay "pasar el cursor", asi que un toque la abre y otro la cierra;
 *    en pantallas estrechas sale como hoja inferior, sobre la barra de navegacion.
 * Se cierra al hacer scroll, cambiar de ruta o pulsar fuera.
 */

type Abierta = { id: number; nombre: string; ancla: HTMLElement; enfocar: boolean };

let actual: Abierta | null = null;
const oyentes = new Set<() => void>();
let tAbrir: ReturnType<typeof setTimeout> | undefined;
let tCerrar: ReturnType<typeof setTimeout> | undefined;

function emitir() { oyentes.forEach((o) => o()); }
function suscribir(o: () => void) { oyentes.add(o); return () => { oyentes.delete(o); }; }
const leer = () => actual;
const servidor = () => null;

function abrir(a: Abierta) { clearTimeout(tAbrir); clearTimeout(tCerrar); actual = a; emitir(); }
function cerrar() { clearTimeout(tAbrir); clearTimeout(tCerrar); if (actual) { actual = null; emitir(); } }
function programarAbrir(a: Abierta) { clearTimeout(tCerrar); clearTimeout(tAbrir); tAbrir = setTimeout(() => abrir(a), 120); }
function programarCerrar() { clearTimeout(tAbrir); clearTimeout(tCerrar); tCerrar = setTimeout(cerrar, 200); }
function mantener() { clearTimeout(tCerrar); }

/* El nombre de un cliente que abre su ficha. Va dentro de filas clicables: el toque la abre sin seleccionar la fila. */
export function NombreCliente({ id, nombre, className, children }: { id: number | null; nombre: string; className?: string; children?: ReactNode }) {
  const tipo = useRef("mouse");
  const abierta = useSyncExternalStore(suscribir, leer, servidor);
  const meAbierto = abierta?.id === id;
  if (!id) return <span className={className}>{children ?? nombre}</span>;
  const datos = (ancla: HTMLElement, enfocar: boolean): Abierta => ({ id, nombre, ancla, enfocar });

  return (
    <button
      type="button" aria-haspopup="dialog" aria-expanded={meAbierto}
      aria-label={`Ficha del cliente ${nombre}`}
      onPointerDown={(e) => { tipo.current = e.pointerType; }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") programarAbrir(datos(e.currentTarget, false)); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") programarCerrar(); }}
      onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) programarAbrir(datos(e.currentTarget, false)); }}
      onBlur={programarCerrar}
      onClick={(e) => {
        if (tipo.current === "touch") { e.stopPropagation(); if (meAbierto) cerrar(); else abrir(datos(e.currentTarget, false)); return; }
        // Teclado (detail 0): abre y lleva el foco a la ficha. Con el raton ya se abrio al pasar; el clic no cambia la fila.
        if (e.detail === 0) { e.stopPropagation(); abrir(datos(e.currentTarget, true)); }
      }}
      className={cx("max-w-full truncate rounded-sm text-left underline-offset-2 decoration-hilo-fuerte hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-texto", className)}
    >
      {children ?? nombre}
    </button>
  );
}

type Estado = { id: number; fase: "cargando" } | { id: number; fase: "listo"; ficha: FichaCliente } | { id: number; fase: "error"; mensaje: string };
const cache = new Map<number, { ficha: FichaCliente; hasta: number }>();
const TTL = 60_000;

/* Montado una vez en el armazon: pinta la ficha de lo que haya abierto. */
export function FichaClienteHost() {
  const abierta = useSyncExternalStore(suscribir, leer, servidor);
  const ruta = usePathname();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [estrecha, setEstrecha] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const idAbierta = abierta?.id ?? null;

  const cargar = useCallback(async (id: number) => {
    const c = cache.get(id);
    if (c && c.hasta > Date.now()) { setEstado({ id, fase: "listo", ficha: c.ficha }); return; }
    setEstado({ id, fase: "cargando" });
    try {
      const r = await fetch(`/api/clientes/${id}/ficha`, { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 404 ? "No hay tareas de este cliente que puedas ver." : d.error ?? "No se pudo cargar la ficha.");
      cache.set(id, { ficha: d as FichaCliente, hasta: Date.now() + TTL });
      setEstado((e) => (e?.id === id ? { id, fase: "listo", ficha: d as FichaCliente } : e));
    } catch (e) {
      setEstado((s) => (s?.id === id ? { id, fase: "error", mensaje: (e as Error).message } : s));
    }
  }, []);

  // Datos al abrir otro cliente (los que ya se pidieron salen de memoria durante un minuto).
  useEffect(() => {
    if (idAbierta == null) return;
    void cargar(idAbierta);
  }, [idAbierta, cargar]);

  // Cierres: scroll, ruta, Escape (devuelve el foco) y pulsar fuera.
  useEffect(() => {
    if (!abierta) return;
    const ancla = abierta.ancla;
    const alScroll = (e: Event) => { if (!caja.current?.contains(e.target as Node)) cerrar(); };
    const alTeclado = (e: KeyboardEvent) => { if (e.key === "Escape") { cerrar(); ancla.focus({ preventScroll: true }); } };
    const alPulsar = (e: PointerEvent) => { const t = e.target as Node; if (!caja.current?.contains(t) && !ancla.contains(t)) cerrar(); };
    window.addEventListener("scroll", alScroll, true);
    window.addEventListener("keydown", alTeclado);
    document.addEventListener("pointerdown", alPulsar);
    return () => { window.removeEventListener("scroll", alScroll, true); window.removeEventListener("keydown", alTeclado); document.removeEventListener("pointerdown", alPulsar); };
  }, [abierta]);
  useEffect(() => { cerrar(); }, [ruta]);

  // Posicion: se mide con el contenido que haya (carga, ficha o error) y se recalcula al cambiar.
  useLayoutEffect(() => {
    if (!abierta || !caja.current) return;
    const angosta = window.innerWidth < 640;
    // Medir tras pintar es el punto de este efecto: el tamano real de la ficha no se conoce antes.
    setEstrecha(angosta);
    if (angosta) return;
    const r = abierta.ancla.getBoundingClientRect();
    const t = caja.current.getBoundingClientRect();
    setPos(posicionarFicha(r, { w: t.width, h: t.height }, { w: window.innerWidth, h: window.innerHeight }));
  }, [abierta, estado]);

  // El foco solo se acepta en algo visible: la ficha esta `invisible` hasta medir su posicion, asi que se pide cuando ya hay posicion.
  const lista = estrecha || pos !== null;
  useEffect(() => {
    const c = caja.current;
    if (abierta?.enfocar && estado && lista && c && !c.contains(document.activeElement)) c.focus({ preventScroll: true });
  }, [abierta, estado, lista]);

  if (!abierta) return null;
  const e = estado?.id === abierta.id ? estado : null;

  return (
    <div
      ref={caja} role="dialog" tabIndex={-1} aria-label={`Cliente: ${abierta.nombre}`} aria-busy={e?.fase === "cargando" || undefined}
      onPointerEnter={mantener} onPointerLeave={(ev) => { if (ev.pointerType === "mouse") programarCerrar(); }}
      style={estrecha || !pos ? undefined : { left: pos.left, top: pos.top }}
      className={cx(
        "fixed z-50 rounded-md border border-hilo bg-superficie text-texto shadow-3 outline-none motion-safe:animate-[entrada-aviso_var(--dur)_var(--curva)]",
        estrecha ? "inset-x-3 bottom-20 max-h-[70dvh] overflow-y-auto" : "w-80 max-w-[calc(100vw-1rem)]",
        !estrecha && !pos && "invisible",
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-hilo px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-rotulo text-lg font-semibold uppercase tracking-[0.06em]">{abierta.nombre}</p>
          {e?.fase === "listo" && (e.ficha.tipo || e.ficha.lider) && (
            <p className="truncate text-sm text-texto-2">{[e.ficha.tipo, e.ficha.lider && `Líder: ${e.ficha.lider}`].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {e?.fase === "listo" && !e.ficha.activo && <CeldaEstado texto="Inactivo" tono="neutro" />}
          {estrecha && <button type="button" onClick={cerrar} aria-label="Cerrar ficha" className="grid size-10 place-items-center rounded-sm text-texto-3 hover:text-texto"><X className="size-4" aria-hidden /></button>}
        </div>
      </header>
      <Cuerpo estado={e} nombre={abierta.nombre} reintentar={() => { cache.delete(abierta.id); void cargar(abierta.id); }} />
    </div>
  );
}

function Cuerpo({ estado, nombre, reintentar }: { estado: Estado | null; nombre: string; reintentar: () => void }) {
  if (!estado || estado.fase === "cargando") {
    return <div className="space-y-3 px-4 py-4"><Esqueleto className="h-10" /><Esqueleto className="h-4 w-2/3" /><Esqueleto className="h-4 w-1/2" /></div>;
  }
  if (estado.fase === "error") {
    return (
      <div className="px-4 py-4 text-sm">
        <p role="alert" className="text-texto-2">{estado.mensaje}</p>
        <button type="button" onClick={reintentar} className="mt-2 rounded-sm border border-hilo-fuerte px-3 py-1.5 font-rotulo text-xs font-semibold uppercase tracking-[0.1em] hover:bg-superficie-2">Reintentar</button>
      </div>
    );
  }
  const f = estado.ficha;
  const pct = f.aTiempo.porcentaje;
  return (
    <div className="flex flex-col">
      <dl className="grid grid-cols-3 divide-x divide-hilo border-b border-hilo">
        <Cifra rotulo="Abiertas" valor={String(f.abiertas)} />
        <Cifra rotulo="Vencidas" valor={String(f.vencidas)} tono={f.vencidas ? "alerta" : undefined} />
        <Cifra rotulo="A tiempo" valor={pct == null ? "—" : `${pct} %`} nota={pct == null ? "sin cierres en 30 días" : `${f.aTiempo.cerradas} cerrada${f.aTiempo.cerradas === 1 ? "" : "s"} en 30 días`} />
      </dl>
      {f.contratado && (
        <p className="flex items-baseline justify-between gap-2 border-b border-hilo px-4 py-2 text-sm">
          <span><span className="rotulo mr-2">Contratado {f.contratado.anio}</span><span className="font-mono font-medium cifras" title={usd(f.contratado.total)}>{usdS(f.contratado.total)}</span></span>
          <Link href={`/ingresos?anio=${f.contratado.anio}`} onClick={cerrar} className="shrink-0 text-texto underline underline-offset-4">Ver ingresos</Link>
        </p>
      )}
      <section aria-label="Próximas entregas" className="px-4 py-3">
        <h3 className="rotulo mb-1.5">Próximas entregas</h3>
        {f.proximas.length === 0 ? <p className="text-sm text-texto-3">Nada abierto con fecha por delante.</p> : (
          <ol className="flex flex-col">
            {f.proximas.map((t) => (
              <li key={t.id}>
                <Link href={`/tareas?tarea=${t.id}`} onClick={cerrar} className="grid min-h-10 grid-cols-[3.25rem_1fr] items-center gap-2 rounded-sm text-sm hover:bg-superficie-2">
                  <span className="font-mono text-xs cifras text-texto-2">{fDia(t.entrega)}</span>
                  <span className="min-w-0"><span className="block truncate">{t.titulo}</span><span className="block truncate text-xs text-texto-3">{t.asignado} · {t.estado}</span></span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hilo px-4 py-2 text-sm">
        <span className="min-w-0 truncate text-texto-3">{f.unidades.join(" · ")}</span>
        <Link href={`/tareas?alcance=unidad&cliente=${encodeURIComponent(nombre)}`} onClick={cerrar} className="shrink-0 text-texto underline underline-offset-4">Ver sus tareas</Link>
      </footer>
    </div>
  );
}

function Cifra({ rotulo, valor, tono, nota }: { rotulo: string; valor: string; tono?: "alerta"; nota?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5" title={nota}>
      <dt className="rotulo">{rotulo}</dt>
      <dd className={cx("font-mono text-2xl font-medium cifras", tono === "alerta" ? "text-alerta" : "text-texto")}>{valor}</dd>
    </div>
  );
}
