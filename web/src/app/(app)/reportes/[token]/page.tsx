import { Suspense } from "react";
import { ErrorApi } from "@/lib/api";
import { servicioGet } from "@/lib/datos/servicio";
import type { DetalleReporte } from "@/lib/datos/tipos";
import { Esqueleto, Panel } from "@/components/ui/panel";
import { ErrorServicio, Puerta } from "../../_datos/marco";
import { VistaReporte } from "./vista";

export const metadata = { title: "Reporte" };

async function Reporte({ params, userId }: { params: PageProps<"/reportes/[token]">["params"]; userId: number }) {
  const { token } = await params;
  const r = await servicioGet<DetalleReporte>(`/reportes/${encodeURIComponent(token)}`, { id: userId })
    .then((detalle) => ({ ok: true as const, detalle }))
    .catch((e: unknown) => ({
      ok: false as const,
      mensaje: e instanceof ErrorApi && e.status === 404 ? "Ese reporte no existe. Revisa el enlace o búscalo en tus reportes."
        : e instanceof ErrorApi ? e.message : "Error inesperado.",
    }));
  if (!r.ok) return <ErrorServicio mensaje={r.mensaje} volver={{ href: "/reportes", texto: "Ir a mis reportes" }} />;
  return <VistaReporte detalle={r.detalle} />;
}

function EsqueletoReporte() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Esqueleto className="h-11 w-full" />
      <Panel cuerpoClassName="flex flex-col gap-4 p-6">
        <Esqueleto className="h-10 w-2/3" />
        <Esqueleto className="h-4 w-1/3" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Esqueleto key={i} className="h-16" />)}</div>
        <Esqueleto className="h-60 w-full" />
      </Panel>
    </div>
  );
}

export default function PaginaReporte({ params }: PageProps<"/reportes/[token]">) {
  return (
    <div className="mx-auto max-w-5xl">
      <Suspense fallback={<EsqueletoReporte />}>
        <Puerta herramienta="reports">{(u) => <Reporte params={params} userId={u.id} />}</Puerta>
      </Suspense>
    </div>
  );
}
