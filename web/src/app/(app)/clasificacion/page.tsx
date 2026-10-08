import { Suspense } from "react";
import { Encabezado, EsqueletoFlujo, Puerta } from "../_datos/marco";
import { FlujoClasificacion } from "./flujo";

export const metadata = { title: "Clasificación" };

export default function Clasificacion() {
  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado titulo="Clasificación" descripcion="Etiqueta cada mención con una categoría y una temática según las palabras clave que definas. Guarda tus reglas como preset para reutilizarlas." />
      <Suspense fallback={<EsqueletoFlujo />}>
        <Puerta herramienta="classification">{() => <FlujoClasificacion />}</Puerta>
      </Suspense>
    </div>
  );
}
