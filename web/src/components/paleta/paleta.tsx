"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as Iconos from "lucide-react";
import { cx } from "@/components/ui/cx";
import type { ItemNav } from "@/components/shell/navegacion";
import { abrirNuevaTarea, EVENTO_ABRIR_PALETA, iniciarTour } from "@/components/cabecera/eventos";
import { buscarTareas, type TareaEncontrada } from "./buscar-tareas";

type Comando = {
  id: string;
  grupo: "Acciones" | "Ir a" | "Tareas";
  titulo: string;
  detalle?: string;
  claves?: string;
  icono: string;
  ejecutar: () => void;
};

function Icono({ nombre, className }: { nombre: string; className?: string }) {
  const C = (Iconos as unknown as Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>>)[nombre];
  return C ? <C className={className} aria-hidden /> : null;
}

const SIN_TAREAS: TareaEncontrada[] = [];

const normalizar = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function alternarTema() {
  const raiz = document.documentElement;
  const nuevo = raiz.dataset.theme === "dark" ? "light" : "dark";
  raiz.dataset.theme = nuevo;
  try { localStorage.setItem("nl-tema", nuevo); } catch { /* modo privado */ }
}

/*
 * Paleta de comandos (Ctrl/Cmd + K), portada de static/js/main.js. Navegacion
 * filtrada por permisos (los mismos items que la barra lateral, ya filtrados
 * en el servidor), acciones y busqueda de tareas en GET /api/tareas?q=. Si esa
 * busqueda no responde, la paleta sigue funcionando sin el grupo de tareas.
 */
export function Paleta({ items, puedeTareas }: { items: ItemNav[]; puedeTareas: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const idLista = useId();
  const [abierta, setAbierta] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [indice, setIndice] = useState(0);
  const [resultado, setResultado] = useState<{ q: string; tareas: TareaEncontrada[] }>({ q: "", tareas: [] });
  const [oscuro, setOscuro] = useState(false);
  const abiertaRef = useRef(false);
  useEffect(() => { abiertaRef.current = abierta; }, [abierta]);

  const abrir = useCallback(() => {
    setConsulta("");
    setIndice(0);
    setOscuro(document.documentElement.dataset.theme === "dark");
    setAbierta(true);
  }, []);
  const cerrar = useCallback(() => setAbierta(false), []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierta && !d.open) { d.showModal(); entrada.current?.focus(); }
    if (!abierta && d.open) d.close();
  }, [abierta]);

  // Atajo global y evento "paleta:abrir".
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (abiertaRef.current) setAbierta(false); else abrir();
      }
    };
    window.addEventListener("keydown", tecla);
    window.addEventListener(EVENTO_ABRIR_PALETA, abrir);
    return () => { window.removeEventListener("keydown", tecla); window.removeEventListener(EVENTO_ABRIR_PALETA, abrir); };
  }, [abrir]);

  // Tareas en el servidor, con espera corta y cancelando la anterior. Lo pintado se deriva de la consulta.
  const q = consulta.trim();
  const buscable = abierta && puedeTareas && q.length >= 2;
  useEffect(() => {
    if (!buscable) return;
    const control = new AbortController();
    const t = setTimeout(async () => {
      const r = await buscarTareas(q, control.signal);
      if (!control.signal.aborted) setResultado({ q, tareas: r });
    }, 220);
    return () => { clearTimeout(t); control.abort(); };
  }, [q, buscable]);
  const tareas = buscable && resultado.q === q ? resultado.tareas : SIN_TAREAS;
  const buscando = buscable && resultado.q !== q;

  const ir = useCallback((href: string) => { cerrar(); router.push(href); }, [cerrar, router]);

  const comandos = useMemo<Comando[]>(() => {
    const acciones: Comando[] = [];
    if (puedeTareas) {
      acciones.push({ id: "nueva-tarea", grupo: "Acciones", titulo: "Nueva tarea", claves: "crear", icono: "Plus", ejecutar: () => {
        // En Mis tareas ya montada, el parametro no vuelve a cambiar: se pide por evento.
        if (pathname === "/tareas") { cerrar(); abrirNuevaTarea(); } else ir("/tareas?nueva=1");
      } });
      acciones.push({
        id: "solicitar", grupo: "Acciones", titulo: "Solicitar trabajo a otra unidad", claves: "solicitud pedir nueva", icono: "Send",
        ejecutar: () => {
          const p = new URLSearchParams(window.location.search);
          p.set("solicitar", "1");
          ir(`${pathname}?${p.toString()}`);
        },
      });
    }
    acciones.push(
      { id: "tema", grupo: "Acciones", titulo: oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro", claves: "tema oscuro claro modo", icono: oscuro ? "Sun" : "Moon", ejecutar: () => { cerrar(); alternarTema(); } },
      { id: "tour", grupo: "Acciones", titulo: "Ver el tour de bienvenida", claves: "ayuda recorrido guia", icono: "Compass", ejecutar: () => { cerrar(); iniciarTour(); } },
      // Al final: un Enter mal dado no deberia echarte.
      { id: "salir", grupo: "Acciones", titulo: "Cerrar sesión", claves: "salir logout", icono: "LogOut", ejecutar: () => { cerrar(); window.location.assign(new URL("/api/sesion/salir", window.location.origin).href); } },
    );
    const navegacion: Comando[] = items.map((i) => ({
      id: `nav:${i.href}`, grupo: "Ir a", titulo: i.rotulo, icono: i.icono, ejecutar: () => ir(i.href),
    }));
    const deTareas: Comando[] = tareas.map((t) => ({
      id: `tarea:${t.id}`, grupo: "Tareas", titulo: t.titulo, detalle: t.detalle, icono: "CircleCheck",
      ejecutar: () => ir(`/tareas?tarea=${t.id}`),
    }));
    const n = normalizar(q);
    const coincide = (c: Comando) => !n || normalizar(`${c.titulo} ${c.detalle ?? ""} ${c.claves ?? ""}`).includes(n);
    // Con texto, primero adonde ir; sin texto, primero que hacer.
    const locales = n ? [...navegacion, ...acciones] : [...acciones, ...navegacion];
    return [...locales.filter(coincide), ...deTareas];
  }, [items, tareas, q, puedeTareas, oscuro, pathname, ir, cerrar]);

  const activo = comandos[Math.min(indice, comandos.length - 1)];

  useEffect(() => {
    if (!activo) return;
    lista.current?.querySelector(`[data-id="${CSS.escape(activo.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activo]);

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndice((i) => Math.min(i + 1, comandos.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndice((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setIndice(0); }
    else if (e.key === "End") { e.preventDefault(); setIndice(comandos.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); activo?.ejecutar(); }
  };

  let grupoAnterior = "";

  return (
    <dialog ref={ref} onClose={cerrar} aria-label="Paleta de comandos"
      onClick={(e) => { if (e.target === ref.current) cerrar(); }}
      className={cx(
        "mx-auto mb-auto mt-[10dvh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-md border border-hilo bg-superficie p-0 text-texto shadow-3",
        "backdrop:bg-tinta/45 backdrop:backdrop-blur-[2px] open:motion-safe:animate-[entrada-aviso_var(--dur)_var(--curva)]",
      )}>
      <div className="flex h-14 items-center gap-3 border-b border-hilo px-4">
        <Iconos.Search className="size-4 shrink-0 text-texto-3" aria-hidden />
        <input ref={entrada} value={consulta} onChange={(e) => { setConsulta(e.target.value); setIndice(0); }} onKeyDown={alTeclear}
          role="combobox" aria-expanded="true" aria-controls={idLista} aria-autocomplete="list"
          aria-activedescendant={activo ? `${idLista}-${activo.id}` : undefined}
          aria-label="Buscar una tarea, una pantalla o una acción"
          placeholder={puedeTareas ? "Busca una tarea, una pantalla o una acción" : "Busca una pantalla o una acción"}
          className="h-full min-w-0 flex-1 bg-transparent text-lg text-texto placeholder:text-texto-3"
          // El :focus-visible global (sin capa) gana a las utilidades; aqui el foco ya lo dice el dialogo abierto.
          style={{ outline: "none" }} />
        <kbd className="hidden rounded-sm border border-hilo px-1.5 font-mono text-xs text-texto-3 sm:inline">Esc</kbd>
      </div>

      <div ref={lista} id={idLista} role="listbox" aria-label="Resultados" className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain py-1">
        {comandos.map((c, i) => {
          const cabecera = c.grupo !== grupoAnterior ? c.grupo : null;
          grupoAnterior = c.grupo;
          const sel = c === activo;
          return (
            <div key={c.id} role="presentation">
              {cabecera && <p role="presentation" className="rotulo px-4 pb-1 pt-3">{cabecera}</p>}
              <div id={`${idLista}-${c.id}`} data-id={c.id} role="option" aria-selected={sel}
                onClick={() => c.ejecutar()} onPointerMove={() => { if (!sel) setIndice(i); }}
                className={cx(
                  "mx-1 flex h-11 cursor-pointer items-center gap-3 rounded-sm px-3 text-base",
                  sel ? "bg-superficie-2 text-texto" : "text-texto-2",
                )}>
                <span aria-hidden className={cx("h-5 w-[3px] shrink-0 rounded-full transition-colors duration-[var(--dur-instante)]", sel ? "bg-marca" : "bg-transparent")} />
                <Icono nombre={c.icono} className="size-4 shrink-0" />
                <span className={cx("min-w-0 flex-1 truncate", sel && "font-medium")}>{c.titulo}</span>
                {c.detalle && <span className="max-w-[45%] shrink-0 truncate text-sm text-texto-3">{c.detalle}</span>}
                {sel && <Iconos.CornerDownLeft className="size-3.5 shrink-0 text-texto-3" aria-hidden />}
              </div>
            </div>
          );
        })}
        {buscando && (
          <div role="presentation" className="flex h-11 items-center gap-3 px-4 text-sm text-texto-3" aria-live="polite">
            <span className="esqueleto h-3 w-3" aria-hidden />Buscando tareas…
          </div>
        )}
        {!comandos.length && !buscando && (
          <p className="px-4 py-6 text-sm text-texto-2">
            Nada coincide con «{consulta.trim()}». Prueba con el nombre de una tarea, un cliente o una pantalla.
          </p>
        )}
      </div>

      <footer className="hidden items-center gap-4 border-t border-hilo px-4 py-2 text-xs text-texto-3 sm:flex">
        <span><kbd className="mr-1 font-mono">↑ ↓</kbd> moverse</span>
        <span><kbd className="mr-1 font-mono">Enter</kbd> abrir</span>
        <span><kbd className="mr-1 font-mono">Esc</kbd> cerrar</span>
      </footer>
    </dialog>
  );
}

/* Boton de la cabecera: en escritorio parece un buscador con su atajo; en movil, un icono. */
export function BotonPaleta({ onAbrir }: { onAbrir: () => void }) {
  const [mac, setMac] = useState(false);
  // navigator solo existe en el cliente.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)); }, []);
  return (
    <button type="button" onClick={onAbrir} data-tour="paleta" aria-keyshortcuts="Control+K Meta+K"
      aria-label="Buscar o ir a (Ctrl + K)"
      className={cx(
        "flex h-10 items-center gap-2 rounded-sm text-texto-2 transition-colors duration-[var(--dur)] hover:text-texto",
        "w-10 justify-center hover:bg-superficie-2 md:w-64 md:justify-start md:border md:border-hilo md:bg-superficie md:px-3 md:hover:border-hilo-fuerte md:hover:bg-superficie",
      )}>
      <Iconos.Search className="size-4 shrink-0" aria-hidden />
      <span className="hidden flex-1 text-left text-sm text-texto-3 md:inline">Buscar o ir a…</span>
      <kbd className="hidden rounded-sm border border-hilo bg-superficie-2 px-1.5 font-mono text-[0.6875rem] text-texto-3 md:inline">{mac ? "⌘ K" : "Ctrl K"}</kbd>
    </button>
  );
}
