import { conUsuario, ok } from "@/lib/api";
import { panelEquipo } from "@/lib/equipo/datos";
import { puertaEquipo } from "@/lib/equipo/puerta";

/* Agregados del panel: contadores, carga por persona, tendencia y vencidas por unidad. */
export const GET = conUsuario(async (req, u) => {
  const { alcance } = await puertaEquipo(u, req);
  return ok(await panelEquipo(u, alcance));
}, { herramienta: "tasks" });
