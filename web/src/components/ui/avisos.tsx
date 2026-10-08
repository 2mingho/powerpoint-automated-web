"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

type TipoAviso = "exito" | "error" | "info";
type Aviso = { id: number; tipo: TipoAviso; texto: string; deshacer?: () => void };

const Ctx = createContext<{ avisar: (texto: string, opts?: { tipo?: TipoAviso; deshacer?: () => void }) => void } | null>(null);

/*
 * Avisos efimeros abajo a la derecha (abajo del todo en movil). Uno con
 * "Deshacer" dura 6 s: completar sin poder deshacer convierte un mal toque
 * en un problema.
 */
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const sig = useRef(0);

  const quitar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);

  const avisar = useCallback((texto: string, opts?: { tipo?: TipoAviso; deshacer?: () => void }) => {
    const id = ++sig.current;
    setAvisos((a) => [...a.slice(-2), { id, tipo: opts?.tipo ?? "info", texto, deshacer: opts?.deshacer }]);
    setTimeout(() => quitar(id), opts?.deshacer ? 6000 : 3800);
  }, [quitar]);

  const valor = useMemo(() => ({ avisar }), [avisar]);

  return (
    <Ctx.Provider value={valor}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-20 z-50 flex flex-col items-end gap-2 md:inset-x-auto md:right-5 md:bottom-5">
        {avisos.map((a) => (
          <div key={a.id} role={a.tipo === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex w-full items-center gap-3 rounded-sm border bg-pizarra px-4 py-3 text-sm text-white shadow-3 md:w-auto md:min-w-80",
              "motion-safe:animate-[entrada-aviso_var(--dur-vista)_var(--curva)]",
              a.tipo === "error" ? "border-alerta" : "border-rail-hilo",
            )}>
            <span aria-hidden className={cx("size-2 shrink-0 rounded-full", a.tipo === "error" ? "bg-alerta" : a.tipo === "exito" ? "bg-bien" : "bg-marca")} />
            <span className="flex-1">{a.texto}</span>
            {a.deshacer && (
              <button type="button" onClick={() => { a.deshacer?.(); quitar(a.id); }}
                className="font-rotulo text-xs font-semibold uppercase tracking-[0.12em] text-marca hover:underline">
                Deshacer
              </button>
            )}
            <button type="button" onClick={() => quitar(a.id)} aria-label="Cerrar aviso" className="text-white/60 hover:text-white">×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useAvisos() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAvisos fuera de ProveedorAvisos");
  return c;
}
