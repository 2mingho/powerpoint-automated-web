import { Suspense } from "react";
import { forbidden, redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth/session";
import { datosIngresos } from "@/lib/finanzas/ingresos";
import { unidadesVisiblesFinanzas } from "@/lib/finanzas/permisos";
import { leerAnio } from "@/lib/finanzas/contratos";
import { hoyNegocio } from "@/lib/reloj";
import { Esqueleto } from "@/components/ui/panel";
import { VistaIngresos } from "./_componentes/vista";

export const metadata = { title: "Ingresos" };

/*
 * Ingresos: contratos prorrateados por mes contra las metas del año. Entra quien
 * supervisa una unidad o puede editar sus contratos o metas; cada quien ve solo
 * esas unidades (lib/finanzas/permisos).
 */
async function Datos({ searchParams }: { searchParams: PageProps<"/ingresos">["searchParams"] }) {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  if (!(await unidadesVisiblesFinanzas(u)).length) forbidden();
  const q = await searchParams;
  const pedido = leerAnio(typeof q.anio === "string" ? q.anio : undefined);
  const anio = pedido.ok ? pedido.valor : Number(hoyNegocio().slice(0, 4));
  const d = await datosIngresos(u, anio);
  return <VistaIngresos datos={d} />;
}

function EsqueletoIngresos() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando los ingresos">
      <Esqueleto className="h-24" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="bg-superficie p-4"><Esqueleto className="mb-2 h-3 w-20" /><Esqueleto className="h-9 w-24" /></div>)}
      </div>
      <Esqueleto className="h-48" />
      <Esqueleto className="h-64" />
    </div>
  );
}

export default function Ingresos(props: PageProps<"/ingresos">) {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Suspense fallback={<><h1 className="mb-4 font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Ingresos</h1><EsqueletoIngresos /></>}>
        <Datos searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
