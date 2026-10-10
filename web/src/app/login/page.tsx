import Image from "next/image";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth/session";
import { FormularioLogin } from "./formulario";

export const metadata = { title: "Entrar" };

async function Formulario({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await usuarioActual()) redirect("/");
  const { destino } = await searchParams;
  return <FormularioLogin destino={typeof destino === "string" ? destino : "/"} />;
}

export default function PaginaLogin({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh md:grid-cols-[1fr_minmax(380px,460px)]">
      <section className="relative hidden flex-col justify-between bg-rail p-10 text-rail-fuerte md:flex">
        <div className="flex items-center gap-3">
          <Image src="/logo-newlink.png" alt="Newlink" width={36} height={36} className="rounded-[3px]" priority />
          <span className="font-rotulo text-sm font-semibold uppercase tracking-[0.24em]">Data Intelligence</span>
        </div>
        <div>
          <p className="font-rotulo text-6xl font-semibold uppercase leading-[0.95] tracking-[0.02em]">
            Lo que se dice,<br />convertido en<br /><span className="text-marca">trabajo en marcha.</span>
          </p>
          <p className="mt-6 max-w-[48ch] text-rail-texto">Reportes de social listening y el trabajo de cada unidad, en un solo panel.</p>
        </div>
        <p className="font-mono text-xs text-rail-texto/70 cifras">NEWLINK · DATA INTEL</p>
      </section>
      <section className="flex flex-col justify-center bg-superficie px-6 py-12 md:px-12">
        <div className="mb-8 flex items-center gap-3 md:hidden">
          <Image src="/logo-newlink.png" alt="Newlink" width={32} height={32} className="rounded-[3px]" />
          <span className="font-rotulo text-sm font-semibold uppercase tracking-[0.2em]">Data Intelligence</span>
        </div>
        <h1 className="font-rotulo text-3xl font-semibold uppercase tracking-[0.06em]">Entrar</h1>
        <p className="mb-8 mt-2 text-texto-2">Usa tu cuenta de Newlink.</p>
        <Suspense fallback={<div className="h-56" />}><Formulario searchParams={searchParams} /></Suspense>
      </section>
    </main>
  );
}
