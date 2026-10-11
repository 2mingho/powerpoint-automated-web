import { Suspense } from "react";
import { exigirUsuario, tieneHerramienta } from "@/lib/auth/session";
import { cache } from "react";
import { Eye } from "lucide-react";
import { papel, puedeVerEquipo } from "@/lib/alcance";
import { unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import { veEstudios } from "@/lib/estudios/servicio";
import { unidadesQueVeGastos } from "@/lib/gastos/permisos";
import { unidadesQueVenHorasExtras } from "@/lib/horas-extras/permisos";
import { Armazon, NavMovil, NavRail, NavRailEsqueleto } from "@/components/shell/armazon";
import { NAVEGACION } from "@/components/shell/navegacion";
import { FichaClienteHost } from "@/components/clientes/ficha";
import { ProveedorAvisos } from "@/components/ui/avisos";
import { AccionesCabecera, AccionesCabeceraEsqueleto } from "@/components/cabecera/acciones-cabecera";

const PAPELES = { admin: "Administración", director: "Dirección", manager: "Manager", empleado: "Analista" } as const;

/* La navegacion se pide tres veces por peticion (barra, movil, cabecera): una sola consulta. */
const veIngresos = cache(async (u: Awaited<ReturnType<typeof exigirUsuario>>) => (await unidadesVisiblesFinanzas(u)).length > 0);

const veGastos = cache(async (u: Awaited<ReturnType<typeof exigirUsuario>>) => (await unidadesQueVeGastos(u)).length > 0);
const veHorasExtras = cache(async (u: Awaited<ReturnType<typeof exigirUsuario>>) => (await unidadesQueVenHorasExtras(u)).length > 0);

const conEstudios = cache(async (u: Awaited<ReturnType<typeof exigirUsuario>>) => veEstudios(u));

/* Solo se ofrece lo que se puede abrir: un enlace que acaba en 403 es una promesa rota. */
async function datosNav() {
  const u = await exigirUsuario();
  const [equipo, p, ingresos, estudios, gastos, horasExtras] = await Promise.all([puedeVerEquipo(u), papel(u), veIngresos(u), conEstudios(u), veGastos(u), veHorasExtras(u)]);
  const items = NAVEGACION.filter((i) =>
    (!i.herramienta || tieneHerramienta(u, i.herramienta)) && (!i.soloEquipo || equipo) && (!i.soloIngresos || ingresos) && (!i.soloEstudios || estudios) && (!i.soloGastos || gastos) && (!i.soloHorasExtras || horasExtras) && (!i.soloAdmin || u.isAdmin));
  return { items, usuario: { nombre: u.username, papel: PAPELES[p], unidad: u.areaName } };
}

async function Nav() { const d = await datosNav(); return <NavRail {...d} />; }
async function Movil() { const d = await datosNav(); return <NavMovil {...d} />; }
async function Cabecera() {
  const [u, d] = await Promise.all([exigirUsuario(), datosNav()]);
  return <AccionesCabecera items={d.items} tourPendiente={!u.tourCompletado} puedeTareas={tieneHerramienta(u, "tasks")} />;
}

/* Mientras un administrador ve la aplicacion como otra persona, un aviso fijo lo dice y ofrece volver. */
async function AvisoSuplantacion() {
  const u = await exigirUsuario();
  if (!u.suplantadoPor) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-aviso bg-aviso/15 px-4 py-2 text-sm backdrop-blur">
      <Eye aria-hidden className="size-4 shrink-0" />
      <span>Estás viendo la aplicación como <strong>{u.username}</strong>. Lo que hagas queda registrado.</span>
      <form method="post" action="/api/sesion/suplantacion/detener" className="ml-auto">
        <button type="submit" className="rounded-sm border border-texto px-3 py-1 font-rotulo text-xs font-semibold uppercase tracking-[0.1em] hover:bg-superficie-2">Volver a mi cuenta</button>
      </form>
    </div>
  );
}

export default function LayoutApp({ children }: LayoutProps<"/">) {
  return (
    <ProveedorAvisos>
      <Armazon
        nav={<Suspense fallback={<NavRailEsqueleto />}><Nav /></Suspense>}
        navMovil={<Suspense fallback={null}><Movil /></Suspense>}
        campana={<Suspense fallback={<AccionesCabeceraEsqueleto />}><Cabecera /></Suspense>}
      >
        <Suspense fallback={null}><AvisoSuplantacion /></Suspense>
        {children}
        <Suspense fallback={null}><FichaClienteHost /></Suspense>
      </Armazon>
    </ProveedorAvisos>
  );
}
