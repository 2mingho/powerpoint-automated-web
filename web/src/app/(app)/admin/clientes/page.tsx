import { Suspense } from "react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { leerFiltrosClientes, listarClientes } from "@/lib/clientes/admin";
import { Encabezado, EsqueletoTabla } from "../_componentes/encabezado";
import { PantallaClientes } from "./_componentes/clientes";

export const metadata = { title: "Clientes · Administración" };

async function Datos({ searchParams }: { searchParams: PageProps<"/admin/clientes">["searchParams"] }) {
  await exigirAdmin();
  const sp = await searchParams;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
  const f = leerFiltrosClientes(p);
  return <PantallaClientes inicial={await listarClientes(f)} filtrosIniciales={{ q: f.q, estado: f.estado, p: f.pagina > 1 ? String(f.pagina) : "" }} />;
}

export default function Clientes(props: PageProps<"/admin/clientes">) {
  return (
    <>
      <Encabezado titulo="Clientes">Cada cliente es uno solo para todas las unidades. Aquí se une lo que se escribió distinto y se asigna su líder de cuenta.</Encabezado>
      <Suspense fallback={<EsqueletoTabla filas={10} columnas={5} />}><Datos searchParams={props.searchParams} /></Suspense>
    </>
  );
}
