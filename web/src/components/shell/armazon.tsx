"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import * as Iconos from "lucide-react";
import { cx } from "@/components/ui/cx";
import { GRUPOS, type ItemNav } from "./navegacion";

function Icono({ nombre, className }: { nombre: string; className?: string }) {
  const C = (Iconos as unknown as Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>>)[nombre];
  return C ? <C className={className} aria-hidden /> : null;
}

function esActivo(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/reportes") return pathname === "/reportes" || (pathname.startsWith("/reportes/") && !pathname.startsWith("/reportes/nuevo"));
  return pathname === href || pathname.startsWith(href + "/");
}

/* El tema vive en data-theme de <html>; se observa para que el icono siga cualquier cambio (paleta incluida). */
function suscribirTema(aviso: () => void) {
  const obs = new MutationObserver(aviso);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const leerTema = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function SelectorTema() {
  const tema = useSyncExternalStore(suscribirTema, leerTema, () => null);
  const cambiar = () => {
    const nuevo = tema === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nuevo;
    try { localStorage.setItem("nl-tema", nuevo); } catch { /* modo privado */ }
  };
  return (
    <button type="button" onClick={cambiar} aria-label={tema === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className="grid size-9 place-items-center rounded-sm text-rail-texto transition-colors hover:bg-rail-2 hover:text-rail-fuerte">
      {tema === "dark" ? <Iconos.Sun className="size-4" aria-hidden /> : <Iconos.Moon className="size-4" aria-hidden />}
    </button>
  );
}

function EnlaceRail({ item }: { item: ItemNav }) {
  const a = esActivo(usePathname(), item.href);
  return (
    <Link href={item.href} aria-current={a ? "page" : undefined}
      className={cx(
        "relative flex h-9 items-center gap-3 rounded-sm px-3 text-sm transition-colors duration-[var(--dur)]",
        a ? "bg-rail-2 font-semibold text-rail-fuerte" : "text-rail-texto hover:bg-rail-2/70 hover:text-rail-fuerte",
      )}>
      <span aria-hidden className={cx("absolute inset-y-1.5 left-0 w-[3px] origin-center rounded-r bg-marca transition-transform duration-[var(--dur)] ease-salida", a ? "scale-y-100" : "scale-y-0")} />
      <Icono nombre={item.icono} className={cx("size-4 shrink-0", a && "text-marca")} />
      {item.rotulo}
    </Link>
  );
}

export type UsuarioArmazon = { nombre: string; papel: string; unidad: string | null };

/* Navegacion de la barra lateral y del menu "Mas" del movil (llega por streaming). */
export function NavRail({ items, usuario }: { items: ItemNav[]; usuario: UsuarioArmazon }) {
  const grupos = (Object.keys(GRUPOS) as ItemNav["grupo"][])
    .map((g) => ({ g, lista: items.filter((i) => i.grupo === g) }))
    .filter((x) => x.lista.length);
  return (
    <>
      <nav aria-label="Principal" className="flex-1 overflow-y-auto px-2 py-4">
        {grupos.map(({ g, lista }) => (
          <div key={g} className="mb-5">
            <p className="px-3 pb-1.5 font-rotulo text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-rail-texto/60">{GRUPOS[g]}</p>
            <div className="flex flex-col gap-0.5">{lista.map((i) => <EnlaceRail key={i.href} item={i} />)}</div>
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2 border-t border-rail-hilo p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-rail-fuerte">{usuario.nombre}</p>
          <p className="truncate text-xs text-rail-texto">{usuario.papel}{usuario.unidad ? ` · ${usuario.unidad}` : ""}</p>
        </div>
        <SelectorTema />
        {/* POST: un GET con efectos lo dispararia cualquier pagina ajena. */}
        <form method="post" action="/api/sesion/salir">
          <button type="submit" aria-label="Cerrar sesión" className="grid size-9 place-items-center rounded-sm text-rail-texto hover:bg-rail-2 hover:text-rail-fuerte">
            <Iconos.LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </>
  );
}

export function NavRailEsqueleto() {
  return (
    <div className="flex-1 space-y-2 px-4 py-6" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-5 rounded-sm bg-rail-2" />)}
    </div>
  );
}

/* Barra inferior del movil: lo de todos los dias y "Mas" con el resto. */
export function NavMovil({ items, usuario }: { items: ItemNav[]; usuario: UsuarioArmazon }) {
  const pathname = usePathname();
  // Abierto solo en la ruta donde se abrio: navegar lo cierra sin efectos.
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const abierto = abiertoEn === pathname;
  const setAbierto = (v: boolean) => setAbiertoEn(v ? pathname : null);
  return (
    <>
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 flex h-16 border-t border-rail-hilo bg-rail pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.filter((i) => i.movil).map((i) => {
          const a = esActivo(pathname, i.href);
          return (
            <Link key={i.href} href={i.href} aria-current={a ? "page" : undefined}
              className={cx("relative flex flex-1 flex-col items-center justify-center gap-1 font-rotulo text-[0.6875rem] font-semibold uppercase tracking-[0.08em]", a ? "text-rail-fuerte" : "text-rail-texto")}>
              <span aria-hidden className={cx("absolute inset-x-5 top-0 h-[3px] rounded-b bg-marca transition-transform duration-[var(--dur)]", a ? "scale-x-100" : "scale-x-0")} />
              <Icono nombre={i.icono} className={cx("size-5", a && "text-marca")} />
              {i.rotulo}
            </Link>
          );
        })}
        <button type="button" onClick={() => setAbierto(true)} aria-expanded={abierto}
          className="flex flex-1 flex-col items-center justify-center gap-1 font-rotulo text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-rail-texto">
          <Iconos.Menu className="size-5" aria-hidden />Más
        </button>
      </nav>
      {abierto && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" className="absolute inset-0 bg-tinta/50" aria-label="Cerrar menú" onClick={() => setAbierto(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col overflow-y-auto rounded-t-md bg-rail pb-[env(safe-area-inset-bottom)] shadow-3 motion-safe:animate-[entrada-aviso_var(--dur-vista)_var(--curva)]">
            <NavRail items={items} usuario={usuario} />
          </div>
        </div>
      )}
    </>
  );
}

/* Marco estatico: se prerenderiza y sale al instante; lo del usuario llega por los slots. */
export function Armazon({ nav, navMovil, campana, children }: {
  nav: ReactNode; navMovil: ReactNode; campana?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-marca focus:px-3 focus:py-2 focus:text-marca-tinta">
        Saltar al contenido
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-rail md:flex">
        <Link href="/" className="flex h-14 items-center gap-3 border-b border-rail-hilo px-4">
          <Image src="/logo-newlink.png" alt="Newlink" width={28} height={28} className="rounded-[3px]" priority />
          <span className="font-rotulo text-sm font-semibold uppercase tracking-[0.2em] text-rail-fuerte">Data Intel</span>
        </Link>
        {nav}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-hilo bg-fondo/90 px-4 backdrop-blur md:px-6">
          <Image src="/logo-newlink.png" alt="Newlink" width={24} height={24} className="rounded-[3px] md:hidden" />
          <div id="barra-titulo" className="min-w-0 flex-1" />
          {campana}
        </header>
        <main id="contenido" className="flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-8">{children}</main>
      </div>
      {navMovil}
    </div>
  );
}
