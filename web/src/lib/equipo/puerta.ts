import "server-only";
import { ErrorApi } from "@/lib/api";
import { puedeVerEquipo } from "@/lib/alcance";
import type { UsuarioActual } from "@/lib/auth/session";
import { leerFiltros, resolverAlcance, type Alcance, type FiltrosEquipo } from "./datos";

/*
 * Puerta comun de /api/equipo/*: sin nada que supervisar, 403; una unidad
 * fuera del alcance, 403 (nunca datos de otra unidad, ni siquiera vacios con
 * nombre). La herramienta "tasks" la comprueba conUsuario.
 */
export async function puertaEquipo(u: UsuarioActual, req: Request): Promise<{ filtros: FiltrosEquipo; alcance: Alcance }> {
  if (!(await puedeVerEquipo(u))) throw new ErrorApi(403, "No supervisas ninguna unidad.");
  const filtros = leerFiltros(new URL(req.url).searchParams);
  const alcance = await resolverAlcance(u, filtros.unidad);
  if (alcance.ajena) throw new ErrorApi(403, "Esa unidad está fuera de tu alcance.");
  return { filtros, alcance };
}
