import { conUsuario, ok } from "@/lib/api";
import { LIMITES } from "@/lib/datos/limites";
import { reenviarSubida, servicioGet } from "@/lib/datos/servicio";
import type { ReporteResumen } from "@/lib/datos/tipos";

/* Mis reportes (solo los propios), con busqueda opcional ?q=. */
export const GET = conUsuario(async (req, u) => {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const datos = await servicioGet<{ reportes: ReporteResumen[] }>(`/reportes${q ? `?q=${encodeURIComponent(q)}` : ""}`, u);
  return ok(datos);
}, { herramienta: "reports" });

/* Lanza la generacion: 202 con el id del trabajo. */
export const POST = conUsuario(async (req, u) => reenviarSubida(req, "/reportes", u, LIMITES.reports), { herramienta: "reports" });
