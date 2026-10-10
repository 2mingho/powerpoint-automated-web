import { Suspense } from "react";
import { Encabezado, EsqueletoFlujo, Puerta } from "../../_datos/marco";
import { FlujoReporte } from "./flujo";

export const metadata = { title: "Generar reporte" };

export default function NuevoReporte() {
  return (
    <div className="mx-auto max-w-4xl">
      <Encabezado titulo="Generar reporte" descripcion="Suelta los .xlsx que exportas de Meltwater: cada uno se reconoce por su hoja, da igual cómo se llame el archivo." />
      <Suspense fallback={<EsqueletoFlujo />}>
        <Puerta herramienta="reports">{() => <FlujoReporte />}</Puerta>
      </Suspense>
    </div>
  );
}
