import { Suspense } from "react";
import { exigirUsuario } from "@/lib/auth/session";
import { Esqueleto, Panel, Vacio } from "@/components/ui/panel";

export const metadata = { title: "Inicio" };

async function Saludo() {
  const u = await exigirUsuario();
  return <Vacio titulo={`Hola, ${u.username}`}>La base de la nueva app está en marcha.</Vacio>;
}

export default function Inicio() {
  return (
    <Panel titulo="Inicio">
      <Suspense fallback={<div className="p-4"><Esqueleto className="w-48" /></div>}><Saludo /></Suspense>
    </Panel>
  );
}
