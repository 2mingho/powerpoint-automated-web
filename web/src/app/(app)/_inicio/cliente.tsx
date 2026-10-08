"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Contador } from "@/components/ui/contador";
import type { Contadores } from "@/lib/tareas/tipos";

/* Franja de Inicio: los mismos cuatro contadores que Mis tareas; cada uno abre la lista ya filtrada. */
export function FranjaInicio({ contadores }: { contadores: Contadores }) {
  const router = useRouter();
  const ir = (filtro: string) => router.push(`/tareas?filtro=${filtro}`);
  return (
    <div role="group" aria-label="Tus salidas" className="grid grid-cols-2 overflow-hidden rounded-md border border-hilo bg-superficie shadow-1 md:grid-cols-4 md:divide-x md:divide-hilo [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-hilo md:[&>*:nth-child(-n+2)]:border-b-0 [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-hilo md:[&>*:nth-child(odd)]:border-r-0">
      <Contador rotulo="Vencidas" valor={contadores.vencidas} tono="alerta" onClick={() => ir("vencidas")} />
      <Contador rotulo="Hoy" valor={contadores.hoy} tono="aviso" onClick={() => ir("hoy")} />
      <Contador rotulo="En curso" valor={contadores.enCurso} tono="info" onClick={() => ir("en_curso")} />
      <Contador rotulo="Bloqueadas" valor={contadores.bloqueadas} tono="violeta" onClick={() => ir("bloqueadas")} detalle="por dependencias abiertas" />
    </div>
  );
}

/*
 * Apunta el final de la visita al salir de la pagina (no al entrar): asi una
 * recarga sigue mostrando lo que cambio desde la visita anterior.
 */
export function MarcarVisita() {
  useEffect(() => {
    const marcar = () => {
      document.cookie = `nl_ultima_visita=${encodeURIComponent(new Date().toISOString())}; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
    };
    const alOcultar = () => { if (document.visibilityState === "hidden") marcar(); };
    document.addEventListener("visibilitychange", alOcultar);
    window.addEventListener("pagehide", marcar);
    // Navegar dentro de la app desmonta Inicio sin ocultar la pestaña.
    return () => { document.removeEventListener("visibilitychange", alOcultar); window.removeEventListener("pagehide", marcar); marcar(); };
  }, []);
  return null;
}
