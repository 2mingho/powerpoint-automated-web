import { Suspense } from "react";
import { forbidden, redirect } from "next/navigation";
import { usuarioActual, tieneHerramienta } from "@/lib/auth/session";
import { puedeVerEquipo } from "@/lib/alcance";
import { leerFiltros, MAX_FILAS, opcionesEquipo, panelEquipo, resolverAlcance, tareasEquipo } from "@/lib/equipo/datos";
import { Esqueleto } from "@/components/ui/panel";
import { PanelDeEquipo } from "./_componentes/panel-equipo";

export const metadata = { title: "Equipo" };

/*
 * Panel de equipo (/tasks/team-dashboard de Flask). Entra quien supervisa algo
 * (puedeVerEquipo) y tiene la herramienta de tareas. Una unidad fuera del
 * alcance en la URL no muestra nada de ella: el panel sale vacio con el aviso.
 */
async function Datos({ searchParams }: { searchParams: PageProps<"/equipo">["searchParams"] }) {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  if (!tieneHerramienta(u, "tasks") || !(await puedeVerEquipo(u))) forbidden();

  const filtros = leerFiltros(await searchParams);
  const alcance = await resolverAlcance(u, filtros.unidad);
  if (alcance.ajena) {
    const todas = await resolverAlcance(u, null);
    const panel = await panelEquipo(u, { ...todas, elegidas: [] });
    return <PanelDeEquipo esAdmin={u.isAdmin} ajena inicial={{ panel, tareas: { total: 0, tareas: [], max: MAX_FILAS, opciones: { personas: [], clientes: [] } } }} filtrosIniciales={{}} />;
  }
  const [panel, t, opciones] = await Promise.all([panelEquipo(u, alcance), tareasEquipo(u, alcance, filtros), opcionesEquipo(u, alcance)]);
  const f: Record<string, string> = {};
  if (filtros.unidad) f.unidad = String(filtros.unidad);
  if (filtros.estado) f.estado = filtros.estado;
  if (filtros.asignado) f.asignado = String(filtros.asignado);
  if (filtros.cliente) f.cliente = filtros.cliente;
  if (filtros.q) f.q = filtros.q;
  if (filtros.vista) f.vista = filtros.vista;
  return <PanelDeEquipo esAdmin={u.isAdmin} inicial={{ panel, tareas: { ...t, max: MAX_FILAS, opciones } }} filtrosIniciales={f} />;
}

function EsqueletoEquipo() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Cargando el panel">
      <div className="grid grid-cols-2 divide-hilo rounded-md border border-hilo bg-superficie md:grid-cols-4 md:divide-x">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex flex-col gap-2 px-4 py-3"><Esqueleto className="w-24" /><Esqueleto className="h-9 w-14" /></div>)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="h-72 rounded-md border border-hilo bg-superficie p-4"><Esqueleto className="w-full" /></div>
        <div className="h-72 rounded-md border border-hilo bg-superficie p-4"><Esqueleto className="w-full" /></div>
      </div>
      <div className="h-96 rounded-md border border-hilo bg-superficie p-4"><Esqueleto className="w-full" /></div>
    </div>
  );
}

export default function Equipo(props: PageProps<"/equipo">) {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Suspense fallback={<><h1 className="mb-4 font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Equipo</h1><EsqueletoEquipo /></>}>
        <Datos searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
