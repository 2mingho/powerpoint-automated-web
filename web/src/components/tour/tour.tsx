"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Boton } from "@/components/ui/boton";
import { useAvisos } from "@/components/ui/avisos";
import { cx } from "@/components/ui/cx";
import type { ItemNav } from "@/components/shell/navegacion";
import { EVENTO_INICIAR_TOUR } from "@/components/cabecera/eventos";

/*
 * Tour de bienvenida (static/js/tour.js), adaptado a la navegacion nueva.
 *
 * Como en Flask, ningun paso se escribe "para el rol X": cada paso de modulo
 * sale de los items de navegacion que el servidor ya filtro por permisos, asi
 * que a nadie se le ensena una herramienta que no tiene. Ilumina el enlace
 * visible (barra lateral en escritorio, barra inferior en movil); si no lo hay
 * a la vista (p. ej. esta en "Mas" del movil), el paso se centra en vez de
 * iluminar un hueco. No cruza paginas: todo se ensena desde la navegacion.
 *
 * Salir a medias tambien cuenta como visto (repetir la oferta en cada carga
 * seria una trampa); se relanza desde la paleta o el boton de ayuda.
 */

type Paso = { id: string; titulo: string; texto: string; objetivo?: () => Element | null; oferta?: boolean; ultimo?: boolean };

const MARGEN = 12;

function visible(el: Element) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}
function primeroVisible(selector: string) {
  return [...document.querySelectorAll(selector)].find(visible) ?? null;
}
/* En movil la barra inferior solo lleva lo diario: lo demas vive en «Más», y es lo que se ilumina. */
const enlace = (href: string) => () =>
  primeroVisible(`nav[aria-label="Principal"] a[href="${href}"]`) ?? primeroVisible('[data-tour="mas"]');

function guion(items: ItemNav[]): Paso[] {
  const hay = (href: string) => items.some((i) => i.href === href);
  const datos = items.filter((i) => i.grupo === "datos");
  const pasos: Paso[] = [
    {
      id: "bienvenida", oferta: true, titulo: "Bienvenido a Newlink",
      texto: "Un recorrido de menos de dos minutos por lo que tú puedes usar. Puedes salir cuando quieras y repetirlo después.",
    },
    {
      id: "navegacion", objetivo: () => primeroVisible('nav[aria-label="Principal"]'), titulo: "Todo lo tuyo está aquí",
      texto: "Solo aparecen las herramientas habilitadas para tu cuenta: si algo no está, no es que esté escondido, es que no lo tienes asignado.",
    },
    {
      id: "buscador", objetivo: () => primeroVisible('[data-tour="paleta"]'), titulo: "Un atajo que sirve para todo",
      texto: "Pulsa Ctrl + K (⌘ + K en Mac) en cualquier pantalla para buscar una tarea, saltar a otra pantalla o crear algo sin navegar.",
    },
    {
      id: "notificaciones", objetivo: () => primeroVisible('[data-tour="campana"]'), titulo: "Aquí te enteras de todo",
      texto: "Te avisamos cuando te asignan una tarea, cuando te mencionan y cuando aceptan o rechazan una solicitud tuya. Cada aviso te lleva a lo que lo provocó.",
    },
  ];
  if (hay("/tareas")) pasos.push({
    id: "tareas", objetivo: enlace("/tareas"), titulo: "Tus tareas, por hora de entrega",
    texto: "Lo que vence hoy, lo que está en curso y lo que está bloqueado, en un panel de salidas. Lo que cambia se queda encendido en amarillo hasta que lo ves.",
  });
  pasos.push({
    id: "solicitudes", objetivo: enlace("/solicitudes"), titulo: "Lo que pides y lo que te piden",
    texto: "Cuando algo no te toca, no lo asignas: lo solicitas a otra unidad. Quien la lidera decide si lo acepta y a quién se lo da, y tú quedas como observador de la tarea.",
  });
  if (hay("/equipo")) pasos.push({
    id: "equipo", objetivo: enlace("/equipo"), titulo: "El panel de tu equipo",
    texto: "Las cifras que importan de tus unidades —vencidas, bloqueadas, quién va más cargado— antes que los filtros.",
  });
  if (datos.length) pasos.push({
    id: "datos", objetivo: enlace(datos[0].href), titulo: "Herramientas de datos",
    texto: `${datos.map((d) => d.rotulo).join(", ")}. Los procesos largos te muestran sus fases y su progreso real mientras trabajan.`,
  });
  if (hay("/admin")) pasos.push({
    id: "admin", objetivo: enlace("/admin"), titulo: "Administración",
    texto: "Usuarios y permisos, unidades y sus líderes, estados y prioridades. Si alguien no puede solicitar o aceptar trabajo, casi siempre se arregla en las unidades.",
  });
  pasos.push({
    id: "final", ultimo: true, titulo: "Eso es todo",
    texto: "Si quieres repetir el recorrido, está en el botón de ayuda de la cabecera y en la paleta (Ctrl + K).",
  });
  return pasos;
}

type Caja = { top: number; left: number; width: number; height: number };

export function Tour({ items, pendiente }: { items: ItemNav[]; pendiente: boolean }) {
  const { avisar } = useAvisos();
  const pathname = usePathname();
  const [activo, setActivo] = useState(false);
  const [indice, setIndice] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  const [posGlobo, setPosGlobo] = useState<{ top: number; left: number } | null>(null);
  const globo = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const ofrecido = useRef(false);
  const pasos = useMemo(() => guion(items), [items]);
  const paso = pasos[indice];

  const terminar = useCallback((completado: boolean) => {
    setActivo(false);
    setCaja(null);
    void fetch("/api/tour/completado", { method: "POST" }).catch(() => undefined);
    if (completado) avisar("Tour terminado. Puedes repetirlo desde el botón de ayuda.", { tipo: "exito" });
  }, [avisar]);

  const iniciar = useCallback(() => {
    void fetch("/api/tour/reiniciar", { method: "POST" }).catch(() => undefined);
    setIndice(0);
    setActivo(true);
  }, []);

  // Primer acceso: se ofrece una vez, cuando la pagina ya esta montada.
  useEffect(() => {
    if (!pendiente || ofrecido.current) return;
    // La marca se pone al dispararse, no al programarse: en modo estricto el efecto se monta dos veces.
    const t = setTimeout(() => { ofrecido.current = true; setIndice(0); setActivo(true); }, 500);
    return () => clearTimeout(t);
  }, [pendiente]);

  useEffect(() => {
    window.addEventListener(EVENTO_INICIAR_TOUR, iniciar);
    return () => window.removeEventListener(EVENTO_INICIAR_TOUR, iniciar);
  }, [iniciar]);

  // Si se navega con el tour abierto, se cierra sin marcarlo (pasa al pulsar un enlace del propio paso).
  const rutaInicial = useRef(pathname);
  useEffect(() => {
    if (activo && pathname !== rutaInicial.current) setActivo(false);
    rutaInicial.current = pathname;
  }, [pathname, activo]);

  const medir = useCallback(() => {
    if (!activo || !paso) return;
    const el = paso.objetivo?.() ?? null;
    if (!el) { setCaja(null); return; }
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
    }
    const m = el.getBoundingClientRect();
    setCaja({ top: m.top - 6, left: m.left - 6, width: m.width + 12, height: m.height + 12 });
  }, [activo, paso]);

  // Medir el DOM es la sincronizacion con un sistema externo que pide useLayoutEffect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => { medir(); }, [medir]);

  useEffect(() => {
    if (!activo) return;
    let pendienteRaf = 0;
    const pronto = () => { cancelAnimationFrame(pendienteRaf); pendienteRaf = requestAnimationFrame(medir); };
    window.addEventListener("resize", pronto);
    window.addEventListener("scroll", pronto, true);
    return () => { window.removeEventListener("resize", pronto); window.removeEventListener("scroll", pronto, true); cancelAnimationFrame(pendienteRaf); };
  }, [activo, medir]);

  // Globo: debajo si cabe, si no encima; junto a lo alto y estrecho (la barra lateral), a la derecha.
  useLayoutEffect(() => {
    if (!activo || !globo.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!caja) { setPosGlobo(null); return; }
    const ancho = globo.current.offsetWidth;
    const alto = globo.current.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = caja.top + caja.height + MARGEN;
    let left = caja.left;
    if (caja.height > vh * 0.6) { top = Math.max(MARGEN, caja.top + 40); left = caja.left + caja.width + MARGEN; }
    else if (top + alto > vh - MARGEN) top = caja.top - alto - MARGEN;
    left = Math.max(MARGEN, Math.min(left, vw - ancho - MARGEN));
    top = Math.max(MARGEN, Math.min(top, vh - alto - MARGEN));
    setPosGlobo({ top, left });
  }, [caja, activo, indice]);

  // Foco al titulo de cada paso: el lector de pantalla lo anuncia y el teclado queda dentro.
  useEffect(() => { if (activo) titulo.current?.focus(); }, [activo, indice]);

  const siguiente = useCallback(() => {
    if (!paso || paso.ultimo || indice >= pasos.length - 1) { terminar(true); return; }
    setIndice((i) => i + 1);
  }, [paso, indice, pasos.length, terminar]);
  const atras = useCallback(() => setIndice((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!activo) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); terminar(false); }
      else if (e.key === "ArrowRight") { e.preventDefault(); siguiente(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); atras(); }
      else if (e.key === "Tab" && globo.current) {
        // Foco atrapado en el globo.
        const f = [...globo.current.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='-1']")];
        const botones = f.filter((x) => x.tagName === "BUTTON");
        if (!botones.length) return;
        const primero = botones[0], ultimo = botones[botones.length - 1];
        if (e.shiftKey && (document.activeElement === primero || document.activeElement === titulo.current)) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [activo, siguiente, atras, terminar]);

  if (!activo || !paso) return null;

  const centrado = !caja;
  const numero = indice + 1;

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="tour-titulo" aria-describedby="tour-texto" data-tour-activo>
      {/* La capa bloquea la pagina; el recorte deja ver lo iluminado. */}
      <div aria-hidden className={cx("absolute inset-0", centrado ? "bg-tinta/55" : "bg-transparent")} />
      {caja && (
        <div aria-hidden
          className="pointer-events-none absolute rounded-sm outline-2 outline-marca motion-safe:transition-[top,left,width,height] motion-safe:duration-[var(--dur)] motion-safe:ease-salida"
          style={{ ...caja, boxShadow: "0 0 0 200vmax color-mix(in srgb, var(--tinta) 55%, transparent)" }} />
      )}
      <div ref={globo} key={paso.id}
        className={cx(
          "absolute w-[min(22rem,calc(100vw-2rem))] rounded-md border border-hilo bg-superficie p-5 text-texto shadow-3",
          "motion-safe:animate-[entrada-aviso_var(--dur)_var(--curva)]",
          centrado && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        )}
        style={!centrado && posGlobo ? { top: posGlobo.top, left: posGlobo.left } : !centrado ? { visibility: "hidden" } : undefined}>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-texto-3 cifras" aria-label={`Paso ${numero} de ${pasos.length}`}>
            {String(numero).padStart(2, "0")} / {String(pasos.length).padStart(2, "0")}
          </span>
          <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-hundida">
            <span className="block h-full bg-texto motion-safe:transition-[width] motion-safe:duration-[var(--dur)]" style={{ width: `${(numero / pasos.length) * 100}%` }} />
          </span>
        </div>
        <h2 id="tour-titulo" ref={titulo} tabIndex={-1} className="mt-3 font-rotulo text-xl font-semibold uppercase tracking-[0.06em] focus:outline-none">{paso.titulo}</h2>
        <p id="tour-texto" className="mt-2 text-base text-texto-2">{paso.texto}</p>
        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => terminar(false)}
            className="h-10 rounded-sm px-1 text-sm text-texto-3 underline-offset-4 hover:text-texto hover:underline">
            {paso.oferta ? "Ahora no" : "Salir del tour"}
          </button>
          <div className="flex gap-2">
            {indice > 0 && <Boton tamano="sm" variante="fantasma" onClick={atras} className="h-10">Atrás</Boton>}
            <Boton tamano="sm" variante="primario" onClick={siguiente} className="h-10">
              {paso.oferta ? "Empezar" : paso.ultimo ? "Terminar" : "Siguiente"}
            </Boton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
