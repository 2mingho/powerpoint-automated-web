"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Rotulo emergente de los controles que son solo un icono. Un unico componente montado en el layout raiz,
 * por delegacion de eventos: cualquier boton, enlace o pestaña sin texto visible que tenga nombre accesible
 * (aria-label o title) enseña ese nombre al pasar el raton por encima o al llegar a el con el teclado. Asi
 * un icono nuevo no necesita acordarse de nada: basta con que, como exige la accesibilidad, tenga nombre.
 *
 *   - Con raton aparece tras una breve espera (no tapa lo que se atraviesa de paso); con teclado, al instante.
 *   - Se oculta al salir, al pulsar, al desplazar y con Escape.
 *   - Reemplaza al title nativo mientras se ve (si no, saldrian los dos).
 *   - Va en la capa superior (popover): se ve tambien sobre los dialogos modales.
 *   - Lo que tiene texto visible no lo necesita. `data-sin-sugerencia` lo excluye.
 *   - En tactil no hay "pasar por encima": ahi el nombre sigue disponible para lectores de pantalla.
 */

/* Controles, y tambien los iconos informativos: un svg con nombre, o algo que lleva `title` o `data-sugerencia`. */
const OBJETIVOS = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary, svg[aria-label], [data-sugerencia], [title]';
const ESPERA_MS = 400;
const SEPARACION = 8;
const MARGEN = 8;

/*
 * Oculto solo a la vista, como sr-only: una caja de 1 px absoluta. Se mira el estilo calculado y no la clase,
 * porque `sr-only sm:not-sr-only` lo deshace en pantallas anchas y ahi el texto SI se ve.
 */
function soloParaLectores(el: Element): boolean {
  const e = getComputedStyle(el);
  return e.position === "absolute" && parseFloat(e.width) <= 1 && parseFloat(e.height) <= 1;
}

/* Texto que se ve de verdad: sin lo que solo leen los lectores, lo oculto, los iconos ni las cifras sueltas. */
function tieneTextoVisible(control: Element): boolean {
  const recorrido = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
  for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
    const texto = n.textContent?.trim();
    // Una cifra suelta (un contador junto a un icono) no explica el icono: sigue necesitando rotulo.
    if (!texto || /^[\d\s/%.,+·-]*$/.test(texto)) continue;
    let oculto = false;
    for (let p = n.parentElement; p; p = p.parentElement) {
      if (p.getAttribute("aria-hidden") === "true" || soloParaLectores(p) || (p.checkVisibility && !p.checkVisibility())) { oculto = true; break; }
      if (p === control) break;
    }
    if (!oculto) return true;
  }
  return false;
}

/* El nombre accesible: el explicito y, si no, el texto que solo leen los lectores (un icono con su sr-only). */
function nombreDe(el: Element): string {
  return (el.getAttribute("data-sugerencia") || el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim().replace(/\s+/g, " ");
}

/* El control sobre el que se esta, si es solo un icono con nombre. */
function controlConIcono(origen: EventTarget | null): { el: Element; texto: string } | null {
  if (!(origen instanceof Element)) return null;
  const el = origen.closest(OBJETIVOS);
  if (!el || el.hasAttribute("data-sin-sugerencia") || el.matches(":disabled, [aria-disabled='true']")) return null;
  // Un `title` sobre un texto largo (un nombre cortado) lo cubre el title nativo; el rotulo es para iconos.
  if (el.textContent && el.textContent.trim().length > 40 && !el.matches("button, a[href], [role]")) return null;
  const texto = nombreDe(el);
  if (!texto || tieneTextoVisible(el)) return null;
  return { el, texto };
}

export function Sugerencias() {
  const [visible, setVisible] = useState<{ el: Element; texto: string } | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tituloGuardado = useRef<{ el: Element; titulo: string } | null>(null);

  useEffect(() => {
    const restaurarTitulo = () => {
      const g = tituloGuardado.current;
      if (g) { if (g.el.isConnected && !g.el.hasAttribute("title")) g.el.setAttribute("title", g.titulo); tituloGuardado.current = null; }
    };
    const ocultar = () => {
      if (espera.current) { clearTimeout(espera.current); espera.current = null; }
      restaurarTitulo();
      setVisible(null);
    };
    const mostrar = (c: { el: Element; texto: string }) => {
      restaurarTitulo();
      const titulo = c.el.getAttribute("title");
      if (titulo !== null) { tituloGuardado.current = { el: c.el, titulo }; c.el.removeAttribute("title"); }
      setVisible(c);
    };
    const alEntrar = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const c = controlConIcono(e.target);
      if (!c) return;
      if (espera.current) clearTimeout(espera.current);
      // El title nativo sale a ~1 s: se quita ya para que nunca compita con el rotulo.
      const titulo = c.el.getAttribute("title");
      if (titulo !== null) { tituloGuardado.current = { el: c.el, titulo }; c.el.removeAttribute("title"); }
      espera.current = setTimeout(() => mostrar(c), ESPERA_MS);
    };
    const alSalir = (e: PointerEvent) => {
      const c = controlConIcono(e.target);
      if (c && e.relatedTarget instanceof Node && c.el.contains(e.relatedTarget)) return;
      ocultar();
    };
    const alEnfocar = (e: FocusEvent) => {
      // Solo con teclado: el foco que deja un clic de raton no debe volver a abrirlo.
      if (!(e.target instanceof Element) || !e.target.matches(":focus-visible")) return;
      const c = controlConIcono(e.target);
      if (c) mostrar(c);
    };
    const alTecla = (e: KeyboardEvent) => { if (e.key === "Escape") ocultar(); };
    document.addEventListener("pointerover", alEntrar);
    document.addEventListener("pointerout", alSalir);
    document.addEventListener("pointerdown", ocultar, true);
    document.addEventListener("focusin", alEnfocar);
    document.addEventListener("focusout", ocultar);
    document.addEventListener("keydown", alTecla);
    window.addEventListener("scroll", ocultar, true);
    window.addEventListener("resize", ocultar);
    return () => {
      ocultar();
      document.removeEventListener("pointerover", alEntrar);
      document.removeEventListener("pointerout", alSalir);
      document.removeEventListener("pointerdown", ocultar, true);
      document.removeEventListener("focusin", alEnfocar);
      document.removeEventListener("focusout", ocultar);
      document.removeEventListener("keydown", alTecla);
      window.removeEventListener("scroll", ocultar, true);
      window.removeEventListener("resize", ocultar);
    };
  }, []);

  /* Se coloca encima del control (o debajo si no cabe) y se mantiene dentro de la ventana. */
  useLayoutEffect(() => {
    const c = caja.current;
    if (!c) return;
    // Sin control (o si ya no esta en la pagina) no hay rotulo que enseñar.
    if (!visible || !visible.el.isConnected) { if (c.matches(":popover-open")) c.hidePopover(); return; }
    if (!c.matches(":popover-open")) c.showPopover();
    const r = visible.el.getBoundingClientRect();
    const w = c.offsetWidth, h = c.offsetHeight;
    const arriba = r.top - h - SEPARACION >= MARGEN;
    const top = arriba ? r.top - h - SEPARACION : r.bottom + SEPARACION;
    const left = Math.min(Math.max(MARGEN, r.left + r.width / 2 - w / 2), window.innerWidth - w - MARGEN);
    c.style.top = `${top}px`;
    c.style.left = `${left}px`;
  }, [visible]);

  return (
    <div ref={caja} popover="manual" role="tooltip" data-sugerencia-activa={visible ? "" : undefined}
      className="pointer-events-none fixed inset-auto m-0 max-w-[16rem] overflow-visible rounded-sm border-0 bg-texto px-2 py-1 text-xs font-medium leading-4 text-superficie shadow-3">
      {visible?.texto}
    </div>
  );
}
