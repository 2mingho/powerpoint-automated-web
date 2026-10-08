"use client";
import { CircleHelp } from "lucide-react";
import type { ItemNav } from "@/components/shell/navegacion";
import { Campana } from "@/components/notificaciones/campana";
import { BotonPaleta, Paleta } from "@/components/paleta/paleta";
import { Tour } from "@/components/tour/tour";
import { DialogoSolicitud } from "@/components/solicitudes/dialogo-solicitud";
import { abrirPaleta, iniciarTour } from "./eventos";

/*
 * Lo que vive en la cabecera de toda la app: buscador (paleta), ayuda (tour)
 * y campana, mas lo que se abre desde cualquier sitio (formulario de
 * solicitud). Llega por el slot `campana` del armazon, ya con los items de
 * navegacion filtrados por permisos en el servidor.
 */
export function AccionesCabecera({ items, tourPendiente, puedeTareas }: {
  items: ItemNav[];
  tourPendiente: boolean;
  puedeTareas: boolean;
}) {
  return (
    <div className="flex items-center gap-1 md:gap-2">
      <BotonPaleta onAbrir={abrirPaleta} />
      <button type="button" onClick={iniciarTour} aria-label="Ver el tour de bienvenida" title="Ver el tour de bienvenida"
        className="grid size-10 place-items-center rounded-sm text-texto-2 transition-colors duration-[var(--dur)] hover:bg-superficie-2 hover:text-texto">
        <CircleHelp className="size-[1.125rem]" aria-hidden />
      </button>
      <Campana />
      <Paleta items={items} puedeTareas={puedeTareas} />
      <Tour items={items} pendiente={tourPendiente} />
      {puedeTareas && <DialogoSolicitud />}
    </div>
  );
}

export function AccionesCabeceraEsqueleto() {
  return (
    <div className="flex items-center gap-1 md:gap-2" aria-hidden>
      <div className="esqueleto h-10 w-10 md:w-64" />
      <div className="size-10" />
      <div className="size-10" />
    </div>
  );
}
