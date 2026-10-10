import { Suspense } from "react";
import { redirect } from "next/navigation";
import { tieneHerramienta, usuarioActual } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { hoyNegocio } from "@/lib/reloj";
import { leerFiltroEstudios, listarEstudios } from "@/lib/estudios/servicio";
import { unidadesEditables } from "@/lib/finanzas/permisos";
import { Esqueleto, Panel, Vacio } from "@/components/ui/panel";
import { catalogo } from "@/lib/tareas/base";
import { clientesVisibles, personasDelAmbito } from "@/lib/tareas/personas";
import { VistaEstudios } from "./_componentes/vista";

export const metadata = { title: "Estudios" };

/*
 * Estudios por fases: cada uno con su avance, la fase en que va y sus pasos. Los
 * pasos son tareas normales (se trabajan en Mis tareas); aqui se ve el conjunto.
 */
async function Datos({ searchParams }: { searchParams: PageProps<"/estudios">["searchParams"] }) {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  if (!tieneHerramienta(u, "tasks")) {
    return <Panel titulo="Estudios"><Vacio titulo="No tienes acceso a la gestión de tareas">Pide a un administrador que te dé acceso a «Gestión de Tareas» para ver los estudios.</Vacio></Panel>;
  }
  const q = await searchParams;
  const sp = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const filtro = leerFiltroEstudios(sp);
  const abierto = typeof q.estudio === "string" && /^\d+$/.test(q.estudio) ? Number(q.estudio) : null;

  const [lista, cat, personas, clientes, conEstudios, unidadesContrato] = await Promise.all([
    listarEstudios(u, filtro), catalogo(), personasDelAmbito(u), clientesVisibles(u),
    db.areas.findMany({ where: { has_studies: true }, select: { id: true } }),
    unidadesEditables(u, "contracts"),
  ]);
  const unidadesConEstudios = new Set(conEstudios.map((a) => a.id));
  return (
    <VistaEstudios
      estudios={lista.estudios} puedeCrear={lista.puedeCrear} estado={filtro.estado} abierto={abierto} estados={cat.estados}
      // Quien lidera un estudio es de una unidad que los hace.
      personas={personas.filter((p) => p.unidadId != null && unidadesConEstudios.has(p.unidadId))}
      clientes={clientes} unidadesContrato={unidadesContrato} hoy={hoyNegocio()}
    />
  );
}

function EsqueletoEstudios() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando los estudios">
      <div className="flex items-center justify-between"><Esqueleto className="h-8 w-48" /><Esqueleto className="h-10 w-36" /></div>
      <div className="space-y-2 rounded-md border border-hilo bg-superficie p-4">{Array.from({ length: 5 }).map((_, i) => <Esqueleto key={i} className="h-14" />)}</div>
    </div>
  );
}

export default function Estudios(props: PageProps<"/estudios">) {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Suspense fallback={<><h1 className="mb-4 font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Estudios</h1><EsqueletoEstudios /></>}>
        <Datos searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
