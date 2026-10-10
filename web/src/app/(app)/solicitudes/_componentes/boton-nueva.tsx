"use client";
import { Plus } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { abrirSolicitud } from "@/components/cabecera/eventos";

export function BotonNuevaSolicitud({ tamano = "md" }: { tamano?: "sm" | "md" }) {
  return (
    <Boton variante="primario" tamano={tamano} onClick={abrirSolicitud} icono={<Plus className="size-4" aria-hidden />}>
      Nueva solicitud
    </Boton>
  );
}
