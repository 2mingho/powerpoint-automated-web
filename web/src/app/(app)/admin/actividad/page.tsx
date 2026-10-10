import { Suspense } from "react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { actividad, leerFiltrosActividad } from "@/lib/admin/consultas";
import { db } from "@/lib/db";
import { Encabezado, EsqueletoTabla } from "../_componentes/encabezado";
import { PantallaActividad } from "./_componentes/actividad";

export const metadata = { title: "Actividad · Administración" };

async function Datos({ searchParams }: { searchParams: PageProps<"/admin/actividad">["searchParams"] }) {
  await exigirAdmin();
  const sp = await searchParams;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
  const f = leerFiltrosActividad(p);
  const [datos, personas] = await Promise.all([
    actividad(f),
    db.users.findMany({ orderBy: { username: "asc" }, select: { id: true, username: true } }),
  ]);
  return (
    <PantallaActividad inicial={datos} personas={personas.map((x) => ({ id: x.id, nombre: x.username }))}
      filtrosIniciales={{ usuario: f.usuario ? String(f.usuario) : "", accion: f.accion, desde: f.desde, hasta: f.hasta, p: f.pagina > 1 ? String(f.pagina) : "" }} />
  );
}

export default function Actividad(props: PageProps<"/admin/actividad">) {
  return (
    <>
      <Encabezado titulo="Actividad">Quién hizo qué y cuándo. Cada cambio de esta sección también queda aquí.</Encabezado>
      <Suspense fallback={<EsqueletoTabla filas={12} columnas={4} />}><Datos searchParams={props.searchParams} /></Suspense>
    </>
  );
}
