"use client";
import { useState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { leerPresupuesto } from "@/lib/gastos/reglas";

/* Presupuesto anual de una categoria. Con 0 se quita. */
export function FormularioPresupuesto({ abierto, categoria, monto, unidadId, anio, categorias, onCerrar, onGuardado }: {
  abierto: boolean;
  /* null = presupuesto de una categoria nueva. */
  categoria: string | null;
  monto: number;
  unidadId: number;
  anio: number;
  categorias: string[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={categoria ? `Presupuesto ${anio}: ${categoria}` : `Nuevo presupuesto ${anio}`} ancho="sm">
      {abierto && <Campos key={categoria ?? "nuevo"} {...{ categoria, monto, unidadId, anio, categorias, onCerrar, onGuardado }} />}
    </Dialogo>
  );
}

function Campos({ categoria, monto, unidadId, anio, categorias, onCerrar, onGuardado }: Omit<Parameters<typeof FormularioPresupuesto>[0], "abierto">) {
  const [cat, setCat] = useState(categoria ?? "");
  const [valor, setValor] = useState(monto > 0 ? String(monto) : "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    const cuerpo = { unidadId, anio, categoria: cat, monto: valor.trim() === "" ? 0 : valor.trim() };
    const l = leerPresupuesto(cuerpo, categorias);
    if (!l.ok) { setError(l.error); return; }
    setGuardando(true);
    try {
      await pedir("/api/gastos/presupuestos", { metodo: "PUT", cuerpo });
      onGuardado(l.valor.monto === 0 ? `Presupuesto de ${l.valor.categoria} quitado.` : `Presupuesto de ${l.valor.categoria} guardado.`);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
      <Campo etiqueta="Categoría">
        {(a) => (
          <>
            <Entrada {...a} list="categorias-presupuesto" autoComplete="off" maxLength={60} value={cat} readOnly={!!categoria} onChange={(e) => setCat(e.target.value)} />
            <datalist id="categorias-presupuesto">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
          </>
        )}
      </Campo>
      <Campo etiqueta={`Presupuesto de ${anio} (US$)`} ayuda="Lo que puede gastar la unidad en la categoría durante el año. Déjalo vacío o en 0 para quitarlo.">
        {(a) => <Entrada {...a} inputMode="decimal" autoComplete="off" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="5000" />}
      </Campo>
      <div className="flex justify-end gap-2 pt-1">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>Guardar presupuesto</Boton>
      </div>
    </form>
  );
}
