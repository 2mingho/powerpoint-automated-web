import { Suspense } from "react";
import { exigirUsuario, tieneHerramienta } from "@/lib/auth/session";
import { ambitoUnidades } from "@/lib/alcance";
import { prioridades } from "@/lib/catalogo";
import { ErrorApi } from "@/lib/api";
import { hoyNegocio } from "@/lib/reloj";
import { listar, obtener, type SolicitudVista } from "@/lib/solicitudes/servicio";
import { esBandeja, salioDeLaBandeja, type Bandeja } from "@/lib/solicitudes/reglas";
import { Esqueleto } from "@/components/ui/panel";
import { Bandejas } from "./_componentes/bandejas";
import { BotonNuevaSolicitud } from "./_componentes/boton-nueva";

export const metadata = { title: "Solicitudes" };

type Busqueda = PageProps<"/solicitudes">["searchParams"];

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  const u = await exigirUsuario();
  const p = await searchParams;
  const pedida = typeof p.solicitud === "string" ? Number(p.solicitud) : null;

  // Abierta desde una notificacion: se elige la bandeja donde vive.
  let seleccion: SolicitudVista | null = null;
  let avisoSeleccion = "";
  if (pedida) {
    try { seleccion = await obtener(u, pedida); }
    catch (e) { if (e instanceof ErrorApi) avisoSeleccion = "Esa solicitud no existe o no tienes acceso a ella."; else throw e; }
  }

  let bandeja: Bandeja | null = esBandeja(p.bandeja) ? p.bandeja : null;
  if (!bandeja && seleccion) {
    bandeja = salioDeLaBandeja(seleccion.resuelta) ? "historial" : seleccion.esMia ? "enviadas" : "recibidas";
  }

  const [inicialRecibidas, ambito, lista] = await Promise.all([
    listar(u, bandeja ?? "recibidas"),
    ambitoUnidades(u),
    prioridades(),
  ]);
  let inicial = inicialRecibidas;
  // Lo de hoy primero: sin nada por decidir pero con algo esperando respuesta, se abre en Enviadas.
  if (!bandeja) {
    bandeja = "recibidas";
    if (inicial.contadores.recibidas === 0 && inicial.contadores.enviadas > 0) {
      bandeja = "enviadas";
      inicial = await listar(u, "enviadas");
    }
  }

  return (
    <Bandejas
      // Otra solicitud pedida por URL (campana) sin salir de /solicitudes: bandejas nuevas con esa abierta.
      key={pedida ?? "bandejas"}
      inicial={inicial}
      bandejaInicial={bandeja}
      seleccionInicial={seleccion}
      avisoSeleccion={avisoSeleccion}
      tonosPrioridad={Object.fromEntries(lista.map((x) => [x.nombre, x.color]))}
      hoy={hoyNegocio()}
      sinUnidad={!ambito.length}
      puedeSolicitar={tieneHerramienta(u, "tasks")}
    />
  );
}

async function Accion() {
  const u = await exigirUsuario();
  return tieneHerramienta(u, "tasks") ? <BotonNuevaSolicitud /> : null;
}

function EsqueletoBandejas() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="grid grid-cols-3 rounded-md border border-hilo bg-superficie">
        {[0, 1, 2].map((i) => <div key={i} className="space-y-2 px-4 py-3"><Esqueleto className="h-3 w-20" /><Esqueleto className="h-8 w-10" /></div>)}
      </div>
      <div className="rounded-md border border-hilo bg-superficie">
        <div className="h-12 border-b border-hilo" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-11 items-center gap-4 border-b border-hilo px-4 last:border-0">
            <Esqueleto className="w-16" /><Esqueleto className="flex-1" /><Esqueleto className="hidden w-32 md:block" /><Esqueleto className="w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PaginaSolicitudes({ searchParams }: PageProps<"/solicitudes">) {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.08em]">Solicitudes</h1>
        <Suspense fallback={null}><Accion /></Suspense>
      </div>
      <Suspense fallback={<EsqueletoBandejas />}><Contenido searchParams={searchParams} /></Suspense>
    </div>
  );
}
