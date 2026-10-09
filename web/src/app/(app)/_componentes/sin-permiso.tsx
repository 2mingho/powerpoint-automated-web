import Link from "next/link";
import { Lock } from "lucide-react";

/* Estado "sin permisos": dice que pasa y como seguir. Lo usan los forbidden.tsx de admin y equipo. */
export function SinPermiso({ texto }: { texto: string }) {
  return (
    <section aria-labelledby="sin-permiso" className="mx-auto mt-6 max-w-xl rounded-md border border-hilo bg-superficie p-6 shadow-1">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-sm bg-superficie-2 text-texto-2"><Lock className="size-5" aria-hidden /></span>
        <div>
          <p className="font-mono text-xs text-texto-3 cifras">403</p>
          <h1 id="sin-permiso" className="font-rotulo text-xl font-semibold uppercase tracking-[0.08em]">Sin permisos</h1>
        </div>
      </div>
      <p className="mt-4 max-w-[60ch] text-texto-2">{texto}</p>
      <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-sm bg-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] text-superficie hover:bg-pizarra">
        Volver al inicio
      </Link>
    </section>
  );
}
