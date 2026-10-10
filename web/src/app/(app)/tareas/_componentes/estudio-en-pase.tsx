"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BarraFases, PasosPorFase } from "@/components/estudios/fases";
import type { EstudioDTO } from "@/lib/estudios/servicio";
import type { TareaDTO } from "@/lib/tareas/tipos";
import { pedir, tonoEstado } from "./cliente";
import { useTareas } from "./estado";

/*
 * Si la tarea es un paso de un estudio, el pase muestra donde esta dentro de el: las
 * fases con su estado, el avance y todos los pasos (este resaltado). Se vuelve a
 * pedir cuando el paso cambia de estado o de fecha, porque eso mueve la barra.
 */
export function EstudioEnPase({ t }: { t: TareaDTO }) {
  const { estados } = useTareas();
  const [e, setE] = useState<EstudioDTO | "error" | null>(null);
  const idEstudio = t.estudio?.id;

  useEffect(() => {
    if (!idEstudio) return;
    const c = new AbortController();
    pedir<EstudioDTO>(`/api/estudios/${idEstudio}`, { senal: c.signal }).then(setE).catch((x) => { if ((x as Error).name !== "AbortError") setE("error"); });
    return () => c.abort();
  }, [idEstudio, t.estado, t.entrega]);

  if (!t.estudio) return null;
  return (
    <section aria-label="Estudio" className="flex flex-col gap-3 rounded-sm border border-hilo p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm"><span className="rotulo mr-2">Estudio</span><Link href={`/estudios?estudio=${t.estudio.id}`} className="font-medium underline-offset-4 hover:underline">{t.estudio.titulo}</Link>{t.fase && <span className="text-texto-2"> · {t.fase}</span>}</p>
        {e && e !== "error" && <span className="font-mono text-sm text-texto-2 cifras" title="Avance ponderado por horas">{Math.round(e.avance * 100)}%</span>}
      </header>
      {e === null && <p className="text-sm text-texto-3" aria-busy>Cargando el estudio…</p>}
      {e === "error" && <p className="text-sm text-texto-3">No se pudo cargar el estudio. <Link href={`/estudios?estudio=${t.estudio.id}`} className="underline underline-offset-4">Ábrelo aparte</Link>.</p>}
      {e && e !== "error" && (
        <>
          <BarraFases fases={e.fases} />
          <details className="group">
            <summary className="flex min-h-9 cursor-pointer items-center text-sm text-texto-2">Ver los {e.pasos.length} pasos</summary>
            <div className="pt-1"><PasosPorFase pasos={e.pasos} tonoDe={(n) => tonoEstado(estados, n)} actualId={t.id} /></div>
          </details>
        </>
      )}
    </section>
  );
}
