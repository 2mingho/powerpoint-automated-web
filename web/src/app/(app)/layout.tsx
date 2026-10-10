import { Suspense } from "react";
import { exigirUsuario, tieneHerramienta } from "@/lib/auth/session";
import { cache } from "react";
import { papel, puedeVerEquipo } from "@/lib/alcance";
import { unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import { Armazon, NavMovil, NavRail, NavRailEsqueleto } from "@/components/shell/armazon";
import { NAVEGACION } from "@/components/shell/navegacion";
import { FichaClienteHost } from "@/components/clientes/ficha";
import { ProveedorAvisos } from "@/components/ui/avisos";
import { AccionesCabecera, AccionesCabeceraEsqueleto } from "@/components/cabecera/acciones-cabecera";

const PAPELES = { admin: "Administración", director: "Dirección", manager: "Manager", empleado: "Analista" } as const;

/* La navegacion se pide tres veces por peticion (barra, movil, cabecera): una sola consulta. */
const veIngresos = cache(async (u: Awaited<ReturnType<typeof exigirUsuario>>) => (await unidadesVisiblesFinanzas(u)).length > 0);

/* Solo se ofrece lo que se puede abrir: un enlace que acaba en 403 es una promesa rota. */
async function datosNav() {
  const u = await exigirUsuario();
  const [equipo, p, ingresos] = await Promise.all([puedeVerEquipo(u), papel(u), veIngresos(u)]);
  const items = NAVEGACION.filter((i) =>
    (!i.herramienta || tieneHerramienta(u, i.herramienta)) && (!i.soloEquipo || equipo) && (!i.soloIngresos || ingresos) && (!i.soloAdmin || u.isAdmin));
  return { items, usuario: { nombre: u.username, papel: PAPELES[p], unidad: u.areaName } };
}

async function Nav() { const d = await datosNav(); return <NavRail {...d} />; }
async function Movil() { const d = await datosNav(); return <NavMovil {...d} />; }
async function Cabecera() {
  const [u, d] = await Promise.all([exigirUsuario(), datosNav()]);
  return <AccionesCabecera items={d.items} tourPendiente={!u.tourCompletado} puedeTareas={tieneHerramienta(u, "tasks")} />;
}

export default function LayoutApp({ children }: LayoutProps<"/">) {
  return (
    <ProveedorAvisos>
      <Armazon
        nav={<Suspense fallback={<NavRailEsqueleto />}><Nav /></Suspense>}
        navMovil={<Suspense fallback={null}><Movil /></Suspense>}
        campana={<Suspense fallback={<AccionesCabeceraEsqueleto />}><Cabecera /></Suspense>}
      >
        {children}
        <Suspense fallback={null}><FichaClienteHost /></Suspense>
      </Armazon>
    </ProveedorAvisos>
  );
}
