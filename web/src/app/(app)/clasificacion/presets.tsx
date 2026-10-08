"use client";
import { useCallback, useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { useAvisos } from "@/components/ui/avisos";
import type { ReglaCategoria } from "@/lib/datos/tipos";
import { pedirJson } from "../_datos/proceso";

type Preset = { id: number; nombre: string; creado: string | null };

/* Barra de presets: elegir, guardar como, sobrescribir, renombrar y borrar. */
export function BarraPresets({ reglas, alCargar }: { reglas: () => ReglaCategoria[]; alCargar: (r: ReglaCategoria[]) => void }) {
  const { avisar } = useAvisos();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [elegido, setElegido] = useState<number | null>(null);
  const [dialogo, setDialogo] = useState<null | "guardar" | "renombrar" | "borrar">(null);
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarLista = useCallback(async () => {
    try {
      const r = await pedirJson<{ presets: Preset[] }>("/api/datos/clasificacion/presets");
      setPresets(r.presets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los presets.");
      setPresets([]);
    }
  }, []);
  useEffect(() => {
    let vivo = true;
    pedirJson<{ presets: Preset[] }>("/api/datos/clasificacion/presets")
      .then((r) => { if (vivo) setPresets(r.presets); })
      .catch((e: Error) => { if (vivo) { setError(e.message); setPresets([]); } });
    return () => { vivo = false; };
  }, []);

  async function elegir(id: number | null) {
    setElegido(id);
    if (!id) return;
    try {
      const p = await pedirJson<{ reglas: ReglaCategoria[]; nombre: string }>(`/api/datos/clasificacion/presets/${id}`);
      alCargar(p.reglas);
      avisar(`Reglas de «${p.nombre}» cargadas.`, { tipo: "exito" });
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo cargar el preset.", { tipo: "error" });
    }
  }

  async function confirmar() {
    setOcupado(true);
    try {
      if (dialogo === "guardar") {
        const p = await pedirJson<{ id: number; nombre: string }>("/api/datos/clasificacion/presets", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre, reglas: reglas() }),
        });
        await cargarLista();
        setElegido(p.id);
        avisar(`Preset «${p.nombre}» guardado.`, { tipo: "exito" });
      } else if (dialogo === "renombrar" && elegido) {
        await pedirJson(`/api/datos/clasificacion/presets/${elegido}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }),
        });
        await cargarLista();
        avisar("Preset renombrado.", { tipo: "exito" });
      } else if (dialogo === "borrar" && elegido) {
        await pedirJson(`/api/datos/clasificacion/presets/${elegido}`, { method: "DELETE" });
        setElegido(null);
        await cargarLista();
        avisar("Preset eliminado.", { tipo: "exito" });
      }
      setDialogo(null);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo completar.", { tipo: "error" });
    } finally {
      setOcupado(false);
    }
  }

  async function sobrescribir() {
    if (!elegido) return;
    try {
      await pedirJson(`/api/datos/clasificacion/presets/${elegido}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reglas: reglas() }),
      });
      avisar("Reglas guardadas en el preset.", { tipo: "exito" });
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo guardar.", { tipo: "error" });
    }
  }

  const actual = presets?.find((p) => p.id === elegido);

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-end">
      <Campo etiqueta="Preset" className="md:w-72" error={error ?? undefined}>
        {(a) => (
          <Selector {...a} value={elegido ?? ""} disabled={!presets} onChange={(e) => void elegir(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{presets === null ? "Cargando…" : presets.length ? "Elegir un preset guardado" : "Aún no tienes presets"}</option>
            {presets?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Selector>
        )}
      </Campo>
      <div className="flex flex-wrap gap-2">
        <Boton tamano="md" variante="secundario" icono={<Save className="size-4" aria-hidden />} onClick={() => { setNombre(""); setDialogo("guardar"); }}>Guardar como…</Boton>
        {actual && (
          <>
            <Boton variante="fantasma" onClick={sobrescribir}>Sobrescribir</Boton>
            <Boton variante="fantasma" onClick={() => { setNombre(actual.nombre); setDialogo("renombrar"); }}>Renombrar</Boton>
            <Boton variante="fantasma" aria-label={`Eliminar el preset ${actual.nombre}`} icono={<Trash2 className="size-4" aria-hidden />} onClick={() => setDialogo("borrar")} />
          </>
        )}
      </div>

      <Dialogo abierto={dialogo !== null} onCerrar={() => setDialogo(null)} ancho="sm"
        titulo={dialogo === "borrar" ? "Eliminar preset" : dialogo === "renombrar" ? "Renombrar preset" : "Guardar preset"}
        pie={
          <>
            <Boton variante="fantasma" onClick={() => setDialogo(null)}>Cancelar</Boton>
            <Boton variante={dialogo === "borrar" ? "peligro" : "primario"} cargando={ocupado}
              disabled={dialogo !== "borrar" && !nombre.trim()} onClick={confirmar}>
              {dialogo === "borrar" ? "Eliminar" : dialogo === "renombrar" ? "Renombrar" : "Guardar preset"}
            </Boton>
          </>
        }>
        {dialogo === "borrar" ? (
          <p>Se eliminará «{actual?.nombre}». Las clasificaciones ya hechas no cambian.</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) void confirmar(); }}>
            <Campo etiqueta="Nombre" ayuda="Por ejemplo: Reglas economía abril.">
              {(a) => <Entrada {...a} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} autoFocus />}
            </Campo>
          </form>
        )}
      </Dialogo>
    </div>
  );
}
