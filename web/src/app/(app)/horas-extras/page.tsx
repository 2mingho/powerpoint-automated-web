import { Suspense } from "react";
import { forbidden, redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth/session";
import { enteroONulo } from "@/lib/admin/api";
import { unidadesQueVenHorasExtras } from "@/lib/horas-extras/permisos";
import { datosDeHorasExtras, leerPeriodoPedido } from "@/lib/horas-extras/servicio";
import { Esqueleto } from "@/components/ui/panel";
import { VistaHorasExtras } from "./_componentes/vista";

export const metadata = { title: "Horas extras" };

/*
 * Horas extras de la unidad: quien la lidera las registra por quincena y ve el mapa de calor del trimestre contra el
 * maximo por persona. Solo las unidades que las llevan (las activa un administrador).
 */
async function Datos({ searchParams }: { searchParams: PageProps<"/horas-extras">["searchParams"] }) {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  if (!(await unidadesQueVenHorasExtras(u)).length) forbidden();
  const q = await searchParams;
  const p = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const d = await datosDeHorasExtras(u, enteroONulo(p.get("unidad")), leerPeriodoPedido(p));
  return <VistaHorasExtras datos={d} />;
}

function EsqueletoHoras() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando las horas extras">
      <Esqueleto className="h-20" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-superficie p-4"><Esqueleto className="mb-2 h-3 w-20" /><Esqueleto className="h-9 w-16" /></div>)}
      </div>
      <Esqueleto className="h-72" />
      <Esqueleto className="h-64" />
    </div>
  );
}

export default function HorasExtras(props: PageProps<"/horas-extras">) {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Suspense fallback={<><h1 className="mb-4 font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Horas extras</h1><EsqueletoHoras /></>}>
        <Datos searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
