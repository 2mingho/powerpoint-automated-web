import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ErrorApi } from "@/lib/api";
import { servicioGet } from "@/lib/datos/servicio";
import type { ReporteResumen } from "@/lib/datos/tipos";
import { Esqueleto, Panel } from "@/components/ui/panel";
import { Encabezado, ErrorServicio, Puerta } from "../_datos/marco";
import { ListaReportes } from "./lista";

export const metadata = { title: "Mis reportes" };

async function Datos({ userId }: { userId: number }) {
  try {
    const { reportes } = await servicioGet<{ reportes: ReporteResumen[] }>("/reportes", { id: userId });
    return <ListaReportes reportes={reportes} />;
  } catch (e) {
    return <ErrorServicio mensaje={e instanceof ErrorApi ? e.message : "Error inesperado."} volver={{ href: "/reportes", texto: "Reintentar" }} />;
  }
}

function EsqueletoLista() {
  return (
    <Panel>
      <div className="flex flex-col divide-y divide-hilo" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-11 items-center gap-4 px-4"><Esqueleto className="w-24" /><Esqueleto className="flex-1" /><Esqueleto className="w-20" /></div>
        ))}
      </div>
    </Panel>
  );
}

export default function MisReportes() {
  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Mis reportes"
        descripcion="Cada reporte guardado tiene su enlace: vuelve a él, retoca sus textos o descárgalo en PDF."
        acciones={
          <Link href="/reportes/nuevo" className="inline-flex h-10 items-center gap-2 rounded-sm bg-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] text-superficie hover:bg-pizarra active:bg-marca active:text-marca-tinta dark:hover:bg-white/85">
            <Plus className="size-4" aria-hidden />Nuevo reporte
          </Link>
        }
      />
      <Suspense fallback={<EsqueletoLista />}>
        <Puerta herramienta="reports">{(u) => <Datos userId={u.id} />}</Puerta>
      </Suspense>
    </div>
  );
}
