"use client";
import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";
import type { Tono } from "./estado";

const tonoTexto: Record<Tono, string> = {
  neutro: "text-texto", info: "text-info", aviso: "text-aviso", alerta: "text-alerta", bien: "text-bien", violeta: "text-violeta",
};

/*
 * Contador de la franja de salidas. Es un boton: filtra lo que cuenta.
 * Cuando el numero cambia, la cifra nueva entra desde abajo (como una paleta)
 * y el rotulo se enciende un instante. Cifras tabulares, nunca saltan de ancho.
 */
export function Contador({
  rotulo, valor, tono = "neutro", activo, onClick, detalle,
}: {
  rotulo: string;
  valor: number;
  tono?: Tono;
  activo?: boolean;
  onClick?: () => void;
  detalle?: string;
}) {
  const [clave, setClave] = useState(0);
  const previo = useRef(valor);
  useEffect(() => {
    if (previo.current !== valor) setClave((k) => k + 1);
    previo.current = valor;
  }, [valor]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cx(
        "group relative flex min-w-0 flex-col items-start gap-1 px-4 py-3 text-left",
        "transition-colors duration-[var(--dur)] hover:bg-superficie-2",
        "after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-texto after:transition-transform after:duration-[var(--dur)] after:ease-salida",
        activo && "after:scale-x-100",
      )}
    >
      <span className="rotulo">{rotulo}</span>
      <span className="relative block h-10 overflow-hidden">
        <span
          key={clave}
          className={cx(
            "block font-mono text-3xl font-medium cifras",
            tonoTexto[valor === 0 ? "neutro" : tono],
            valor === 0 && "text-texto-3",
            clave > 0 && "motion-safe:animate-[paleta_var(--dur-vista)_var(--curva)]",
          )}
        >
          {valor}
        </span>
      </span>
      {detalle && <span className="text-xs text-texto-3">{detalle}</span>}
    </button>
  );
}
