import { conUsuario, ErrorApi } from "@/lib/api";
import { tieneHerramienta, type Herramienta } from "@/lib/auth/session";
import { reenviarDescarga } from "@/lib/datos/servicio";

const HERRAMIENTA: Record<string, Herramienta> = {
  classified: "classification",
  union: "file_merge",
  csv_summary: "csv_analysis",
};

/* El resultado de un proceso. El servicio comprueba que sea tuyo; lo de otro es 404. */
export const GET = conUsuario(async (req, u, ctx: RouteContext<"/api/datos/descargas/[tipo]/[id]">) => {
  const { tipo, id } = await ctx.params;
  const h = HERRAMIENTA[tipo];
  if (!h || !/^[0-9a-f]{32}$/.test(id)) throw new ErrorApi(404, "Descarga no encontrada.");
  if (!tieneHerramienta(u, h)) throw new ErrorApi(403, "No tienes acceso a esta herramienta.");
  const nombre = new URL(req.url).searchParams.get("nombre")?.slice(0, 150) ?? "";
  return reenviarDescarga(`/descargas/${tipo}/${id}${nombre ? `?nombre=${encodeURIComponent(nombre)}` : ""}`, u);
});
