"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";
import { SECCIONES } from "./secciones";

/* Pestanas de seccion. En movil se desplazan dentro de su fila, nunca la pagina. */
export function NavegacionAdmin() {
  const ruta = usePathname();
  const items = [{ href: "/admin", rotulo: "Índice" }, ...SECCIONES];
  return (
    <nav aria-label="Secciones de administración" className="-mx-4 mb-5 overflow-x-auto border-b border-hilo px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1">
        {items.map((s) => {
          const activo = s.href === "/admin" ? ruta === "/admin" : ruta.startsWith(s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={activo ? "page" : undefined}
                className={cx(
                  "relative flex h-11 items-center px-3 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] transition-colors duration-[var(--dur)]",
                  activo ? "text-texto" : "text-texto-3 hover:text-texto",
                )}
              >
                {s.rotulo}
                <span aria-hidden className={cx("absolute inset-x-3 -bottom-px h-0.5 origin-left bg-texto transition-transform duration-[var(--dur)] ease-salida", activo ? "scale-x-100" : "scale-x-0")} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
