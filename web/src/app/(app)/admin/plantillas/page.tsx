import { Suspense } from "react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { plantillas } from "@/lib/admin/consultas";
import { MAX_PLANTILLA_BYTES } from "@/lib/admin/pptx";
import { Encabezado, EsqueletoTabla } from "../_componentes/encabezado";
import { PantallaPlantillas } from "./_componentes/plantillas";

export const metadata = { title: "Plantillas · Administración" };

async function Datos() {
  await exigirAdmin();
  return <PantallaPlantillas inicial={await plantillas()} maxBytes={MAX_PLANTILLA_BYTES} />;
}

export default function Plantillas() {
  return (
    <>
      <Encabezado titulo="Plantillas">
        Las plantillas PowerPoint con las que se generan los reportes. Se guardan en la base, no en disco: sobreviven a cada despliegue. Una subida con el mismo nombre que una del repositorio la sustituye.
      </Encabezado>
      <Suspense fallback={<EsqueletoTabla filas={4} columnas={5} />}><Datos /></Suspense>
    </>
  );
}
