import { Suspense } from "react";
import { Encabezado, EsqueletoFlujo, Puerta } from "../_datos/marco";
import { FlujoUnion } from "./flujo";

export const metadata = { title: "Unión de archivos" };

export default function Union() {
  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado titulo="Unión de archivos" descripcion="Junta varios exports en uno solo. Si tienen las mismas columnas, se apilan; si no, eliges qué columna corresponde a cuál." />
      <Suspense fallback={<EsqueletoFlujo />}>
        <Puerta herramienta="file_merge">{() => <FlujoUnion />}</Puerta>
      </Suspense>
    </div>
  );
}
