import type { ReactNode } from "react";
import Link from "next/link";
import { exigirUsuario, tieneHerramienta, HERRAMIENTAS, type Herramienta, type UsuarioActual } from "@/lib/auth/session";
import { Esqueleto, Panel, Vacio } from "@/components/ui/panel";

/* Titulo de pantalla: rotulo grande y una linea que dice para que sirve. */
export function Encabezado({ titulo, descripcion, acciones }: { titulo: string; descripcion?: string; acciones?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div className="min-w-0">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">{titulo}</h1>
        {descripcion && <p className="mt-1 max-w-[70ch] text-texto-2">{descripcion}</p>}
      </div>
      {acciones && <div className="flex items-center gap-2">{acciones}</div>}
    </div>
  );
}

export function SinPermiso({ herramienta }: { herramienta: Herramienta }) {
  return (
    <Panel>
      <Vacio titulo="Sin acceso a esta herramienta">
        Tu cuenta no tiene habilitada «{HERRAMIENTAS[herramienta]}». Si la necesitas, pídesela a un administrador.
      </Vacio>
    </Panel>
  );
}

export function ErrorServicio({ mensaje, volver }: { mensaje: string; volver?: { href: string; texto: string } }) {
  return (
    <Panel>
      <Vacio titulo="No se pudo cargar" accion={volver ? <Link href={volver.href} className="font-rotulo text-sm font-semibold uppercase tracking-[0.1em] underline">{volver.texto}</Link> : undefined}>
        {mensaje}
      </Vacio>
    </Panel>
  );
}

/* Comprueba la herramienta y entrega el usuario. Va dentro de un Suspense. */
export async function Puerta({ herramienta, children }: { herramienta: Herramienta; children: (u: UsuarioActual) => ReactNode | Promise<ReactNode> }) {
  const u = await exigirUsuario();
  if (!tieneHerramienta(u, herramienta)) return <SinPermiso herramienta={herramienta} />;
  return <>{await children(u)}</>;
}

export function EsqueletoFlujo() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Esqueleto className="h-11 w-full" />
      <Esqueleto className="h-48 w-full" />
      <Esqueleto className="h-10 w-48" />
    </div>
  );
}
