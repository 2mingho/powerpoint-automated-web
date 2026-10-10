import { Suspense } from "react";
import { puedeVerEquipo } from "@/lib/alcance";
import { exigirUsuario, tieneHerramienta } from "@/lib/auth/session";
import { hoyNegocio } from "@/lib/reloj";
import { Esqueleto, Panel, Vacio } from "@/components/ui/panel";
import { catalogo } from "@/lib/tareas/base";
import { asegurarAvisosDeVencimiento } from "@/lib/tareas/avisos";
import { contarSalidas, leerFiltros, listarTareas } from "@/lib/tareas/consultas";
import { etiquetasVisibles } from "@/lib/tareas/etiquetas";
import { puedeImportar } from "@/lib/tareas/importar";
import { clientesInactivos, clientesVisibles, personasDelAmbito, unidadesParaFiltro } from "@/lib/tareas/personas";
import { MisTareas } from "./_componentes/mis-tareas";
import type { Vista } from "./_componentes/estado";

export const metadata = { title: "Mis tareas" };

async function Datos({ searchParams }: { searchParams: PageProps<"/tareas">["searchParams"] }) {
  const u = await exigirUsuario();
  if (!tieneHerramienta(u, "tasks")) {
    return (
      <Panel titulo="Mis tareas">
        <Vacio titulo="No tienes acceso a la gestión de tareas">Pide a un administrador que te dé acceso a «Gestión de Tareas» si lo necesitas para tu trabajo.</Vacio>
      </Panel>
    );
  }
  const sp = await searchParams;
  const filtros = leerFiltros(sp);
  const vistaCruda = typeof sp.vista === "string" ? sp.vista : "";
  const vista: Vista = vistaCruda === "tablero" || vistaCruda === "calendario" ? vistaCruda : "panel";
  const tarea = typeof sp.tarea === "string" && /^\d+$/.test(sp.tarea) ? Number(sp.tarea) : null;

  // Avisos de vencimiento del dia, como al abrir /tasks en Flask. Nunca rompe la pagina.
  await asegurarAvisosDeVencimiento(u.id).catch((e) => console.error("[tareas] avisos de vencimiento", e));

  const [cat, personas, clientes, etiquetas, unidades, importar, lista, contadores, lidera] = await Promise.all([
    catalogo(), personasDelAmbito(u), clientesVisibles(u), etiquetasVisibles(u), unidadesParaFiltro(u), puedeImportar(u),
    listarTareas(u, filtros), contarSalidas(u, filtros.alcance), puedeVerEquipo(u),
  ]);

  const inactivos = await clientesInactivos(clientes);

  return (
    <MisTareas inicial={{
      usuario: { id: u.id, nombre: u.username, esAdmin: u.isAdmin, unidadId: u.areaId, lidera },
      hoy: hoyNegocio(),
      estados: cat.estados,
      prioridades: cat.prioridades,
      personas, clientes, clientesInactivos: inactivos, etiquetas, unidades, puedeImportar: importar,
      filtros, vista, tarea,
      tareas: lista.tareas, truncada: lista.truncada, contadores,
    }} />
  );
}

function EsqueletoTareas() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Cargando tus tareas">
      <div className="flex items-center justify-between"><Esqueleto className="h-8 w-48" /><Esqueleto className="h-10 w-36" /></div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-superficie p-4"><Esqueleto className="mb-2 h-3 w-20" /><Esqueleto className="h-9 w-12" /></div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-2 rounded-md border border-hilo bg-superficie p-4">{Array.from({ length: 8 }).map((_, i) => <Esqueleto key={i} className="h-8" />)}</div>
        <Esqueleto className="hidden h-64 lg:block" />
      </div>
    </div>
  );
}

export default function PaginaTareas({ searchParams }: PageProps<"/tareas">) {
  return (
    <Suspense fallback={<EsqueletoTareas />}>
      <Datos searchParams={searchParams} />
    </Suspense>
  );
}
