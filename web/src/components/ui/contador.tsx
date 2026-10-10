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
  rotulo, valor, tono = "neutro", activo, onClick, detalle, texto, compacto,
}: {
  rotulo: string;
  valor: number;
  tono?: Tono;
  activo?: boolean;
  onClick?: () => void;
  detalle?: string;
  /* Lo que se pinta en lugar del numero ("50 %", "—"); `valor` sigue decidiendo el tono. */
  texto?: string;
  /* Cifra mas chica en pantallas estrechas, para importes largos como "US$188k". */
  compacto?: boolean;
}) {
  const [clave, setClave] = useState(0);
  const previo = useRef(valor);
  useEffect(() => {
    if (previo.current !== valor) setClave((k) => k + 1);
    previo.current = valor;
  }, [valor]);

  /* Sin onClick es una cifra, no un boton: no promete una accion que no tiene. */
  const Etiqueta = onClick ? "button" : "div";
  return (
    <Etiqueta
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": activo } : {})}
      className={cx(
        "group relative flex min-w-0 flex-col items-start gap-1 px-4 py-3 text-left",
        onClick && "transition-colors duration-[var(--dur)] hover:bg-superficie-2",
        "after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-texto after:transition-transform after:duration-[var(--dur)] after:ease-salida",
        activo && "after:scale-x-100",
      )}
    >
      <span className="rotulo">{rotulo}</span>
      <span className="relative block h-10 overflow-hidden">
        <span
          key={clave}
          className={cx(
            "block font-mono font-medium cifras", compacto ? "text-2xl sm:text-3xl" : "text-3xl",
            tonoTexto[valor === 0 ? "neutro" : tono],
            valor === 0 && "text-texto-3",
            clave > 0 && "motion-safe:animate-[paleta_var(--dur-vista)_var(--curva)]",
          )}
        >
          {texto ?? valor}
        </span>
      </span>
      {detalle && <span className="text-xs text-texto-3">{detalle}</span>}
    </Etiqueta>
  );
}
