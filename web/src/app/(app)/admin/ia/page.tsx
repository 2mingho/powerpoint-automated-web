import { Suspense } from "react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { ia, PRECIOS_CONOCIDOS, PROVEEDORES_IA } from "@/lib/admin/consultas";
import { Encabezado, EsqueletoTabla } from "../_componentes/encabezado";
import { PantallaIa } from "./_componentes/ia";

export const metadata = { title: "IA · Administración" };

async function Datos() {
  await exigirAdmin();
  return <PantallaIa inicial={await ia()} proveedores={[...PROVEEDORES_IA]} precios={PRECIOS_CONOCIDOS} />;
}

export default function Ia() {
  return (
    <>
      <Encabezado titulo="IA">
        Con qué proveedor y modelo se hace el análisis asistido de los reportes, y cuánto cuesta. Solo una conexión está activa a la vez. Las claves no se muestran nunca completas.
      </Encabezado>
      <Suspense fallback={<div className="flex flex-col gap-5"><EsqueletoTabla filas={3} columnas={6} /><EsqueletoTabla filas={4} columnas={6} /></div>}><Datos /></Suspense>
    </>
  );
}
