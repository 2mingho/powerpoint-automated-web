import { Suspense } from "react";
import { Encabezado, EsqueletoFlujo, Puerta } from "../_datos/marco";
import { FlujoAnalisis } from "./flujo";

export const metadata = { title: "Análisis CSV" };

export default function Analisis() {
  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado titulo="Análisis CSV" descripcion="Un vistazo rápido a cualquier CSV: tamaño, valores faltantes, estadísticas, valores más frecuentes y correlaciones." />
      <Suspense fallback={<EsqueletoFlujo />}>
        <Puerta herramienta="csv_analysis">{() => <FlujoAnalisis />}</Puerta>
      </Suspense>
    </div>
  );
}
