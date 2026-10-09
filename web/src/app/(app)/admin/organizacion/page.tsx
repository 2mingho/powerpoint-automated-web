import { Suspense } from "react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { organizacion } from "@/lib/admin/consultas";
import { Encabezado, EsqueletoTabla } from "../_componentes/encabezado";
import { PantallaOrganizacion } from "./_componentes/organizacion";

export const metadata = { title: "Organización · Administración" };

async function Datos() {
  await exigirAdmin();
  return <PantallaOrganizacion inicial={await organizacion()} />;
}

export default function Organizacion() {
  return (
    <>
      <Encabezado titulo="Organización">
        Solo se configuran dos cosas: quién lidera cada unidad y a quién reporta cada persona. El papel y las unidades que alcanza cada uno se deducen, y se ven aquí.
      </Encabezado>
      <Suspense fallback={<EsqueletoTabla filas={12} columnas={3} />}><Datos /></Suspense>
    </>
  );
}
