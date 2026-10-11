import { Suspense } from "react";
import { forbidden, redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth/session";
import { unidadesQueVeGastos } from "@/lib/gastos/permisos";
import { datosDeGastos, leerAnioDeGastos } from "@/lib/gastos/servicio";
import { enteroONulo } from "@/lib/admin/api";
import { Esqueleto } from "@/components/ui/panel";
import { VistaGastos } from "./_componentes/vista";

export const metadata = { title: "Gastos" };

/*
 * Gastos de la unidad: quien la lidera los registra y fija su presupuesto anual por categoria; quien la supervisa
 * los ve. Cada quien ve solo las unidades de lib/gastos/permisos.
 */
async function Datos({ searchParams }: { searchParams: PageProps<"/gastos">["searchParams"] }) {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  if (!(await unidadesQueVeGastos(u)).length) forbidden();
  const q = await searchParams;
  const unidad = enteroONulo(typeof q.unidad === "string" ? q.unidad : null);
  const d = await datosDeGastos(u, unidad, leerAnioDeGastos(typeof q.anio === "string" ? q.anio : undefined));
  return <VistaGastos datos={d} />;
}

function EsqueletoGastos() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando los gastos">
      <Esqueleto className="h-20" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-superficie p-4"><Esqueleto className="mb-2 h-3 w-20" /><Esqueleto className="h-9 w-24" /></div>)}
      </div>
      <Esqueleto className="h-56" />
      <Esqueleto className="h-64" />
    </div>
  );
}

export default function Gastos(props: PageProps<"/gastos">) {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <Suspense fallback={<><h1 className="mb-4 font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Gastos</h1><EsqueletoGastos /></>}>
        <Datos searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
