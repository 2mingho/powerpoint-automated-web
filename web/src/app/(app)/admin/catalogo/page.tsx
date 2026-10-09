import { Suspense } from "react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { catalogo } from "@/lib/admin/consultas";
import { Encabezado, EsqueletoTabla } from "../_componentes/encabezado";
import { PantallaCatalogo } from "./_componentes/catalogo";

export const metadata = { title: "Catálogo · Administración" };

async function Datos() {
  await exigirAdmin();
  return <PantallaCatalogo inicial={await catalogo()} />;
}

export default function Catalogo() {
  return (
    <>
      <Encabezado titulo="Catálogo">
        Estados y prioridades de tarea. Arrastra para cambiar el orden en que aparecen. «Terminado» es una marca, no un nombre: renombrar un estado reescribe las tareas que lo usan.
      </Encabezado>
      <Suspense fallback={<div className="grid gap-5 xl:grid-cols-2"><EsqueletoTabla filas={5} columnas={4} /><EsqueletoTabla filas={3} columnas={4} /></div>}><Datos /></Suspense>
    </>
  );
}
