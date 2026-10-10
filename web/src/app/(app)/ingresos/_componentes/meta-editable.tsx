"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { leerMonto, usd } from "@/lib/finanzas/contratos";

/* Meta anual de una unidad (o de la direccion). Solo se pinta el campo si la persona puede fijarla; si no, la cifra. */
export function MetaEditable({ anio, unidadId, nombre, monto, puedeEditar, etiqueta, placeholder = "Sin meta", ayuda, volverALaSuma }: {
  anio: number; unidadId: number | null; nombre: string; monto: number; puedeEditar: boolean;
  etiqueta?: string; placeholder?: string; ayuda?: string;
  /* Con un valor fijado: boton para quitarlo y volver a la suma de las unidades. */
  volverALaSuma?: boolean;
}) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [valor, setValor] = useState(monto ? String(monto) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  if (!puedeEditar) {
    return <p className="text-sm text-texto-2">Meta {anio}: <span className="font-mono text-texto cifras">{monto ? usd(monto) : "sin meta"}</span></p>;
  }

  async function enviar(monto: number) {
    setError("");
    setGuardando(true);
    try {
      await pedir("/api/finanzas/metas", { metodo: "PUT", cuerpo: { anio, unidadId, monto } });
      avisar(monto ? `Meta ${anio} de ${nombre}: ${usd(monto)}.` : unidadId === null ? `Meta ${anio}: vuelve a ser la suma de las unidades.` : `Meta ${anio} de ${nombre} quitada.`, { tipo: "exito" });
      router.refresh();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }
  const quitar = () => enviar(0);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    const m = valor.trim() ? leerMonto(valor, { permitirCero: true }) : ({ ok: true, valor: 0 } as const);
    if (!m.ok) { setError(m.error); return; }
    await enviar(m.valor);
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="rotulo">{etiqueta ?? `Meta ${anio} (US$)`}</span>
          <Entrada inputMode="decimal" autoComplete="off" value={valor} placeholder={placeholder} aria-label={`Meta ${anio} de ${nombre}`} aria-invalid={error ? true : undefined}
            onChange={(e) => setValor(e.target.value)} className="h-9" />
        </label>
        <Boton type="submit" tamano="sm" className="h-9" cargando={guardando} disabled={valor.trim() === (monto ? String(monto) : "")}>Guardar</Boton>
      </div>
      {error && <p role="alert" className="text-xs text-alerta">{error}</p>}
      {ayuda && <p className="text-xs text-texto-3">{ayuda}</p>}
      {volverALaSuma && (
        <Boton tamano="sm" variante="fantasma" className="self-start" disabled={guardando} onClick={() => { setValor(""); void quitar(); }}>Volver a la suma de las unidades</Boton>
      )}
    </form>
  );
}
