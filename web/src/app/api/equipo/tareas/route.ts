import { conUsuario, ok } from "@/lib/api";
import { MAX_FILAS, opcionesEquipo, tareasEquipo } from "@/lib/equipo/datos";
import { puertaEquipo } from "@/lib/equipo/puerta";

/* Tabla filtrable de tareas del alcance (api/team/tasks + filters). */
export const GET = conUsuario(async (req, u) => {
  const { filtros, alcance } = await puertaEquipo(u, req);
  const [t, opciones] = await Promise.all([tareasEquipo(u, alcance, filtros), opcionesEquipo(u, alcance)]);
  return ok({ ...t, max: MAX_FILAS, opciones });
}, { herramienta: "tasks" });
