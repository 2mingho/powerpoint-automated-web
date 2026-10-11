import { Suspense } from "react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { leerFiltrosUsuarios, listarUsuarios, opcionesPersonas } from "@/lib/admin/consultas";
import { Encabezado, EsqueletoTabla } from "../_componentes/encabezado";
import { PantallaPersonas } from "./_componentes/personas";

export const metadata = { title: "Personas · Administración" };

function aParams(sp: Record<string, string | string[] | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
  return p;
}

async function Datos({ searchParams }: { searchParams: PageProps<"/admin/personas">["searchParams"] }) {
  const yo = await exigirAdmin();
  const params = aParams(await searchParams);
  const f = leerFiltrosUsuarios(params);
  const [lista, opciones] = await Promise.all([listarUsuarios(f), opcionesPersonas()]);
  return (
    <PantallaPersonas
      inicial={lista}
      opciones={opciones}
      yoId={yo.id}
      puedeSuplantar={!yo.suplantadoPor}
      filtrosIniciales={{ q: f.q, rol: f.rol, unidad: f.unidad, estado: f.estado, p: f.pagina > 1 ? String(f.pagina) : "" }}
    />
  );
}

export default function Personas(props: PageProps<"/admin/personas">) {
  return (
    <>
      <Encabezado titulo="Personas">Cuentas, roles y herramientas a las que entra cada persona. El papel de mando no se asigna aquí: sale de Organización.</Encabezado>
      <Suspense fallback={<EsqueletoTabla filas={10} columnas={6} />}><Datos searchParams={props.searchParams} /></Suspense>
    </>
  );
}
