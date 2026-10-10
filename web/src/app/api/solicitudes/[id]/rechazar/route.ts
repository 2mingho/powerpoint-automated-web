import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { rechazar } from "@/lib/solicitudes/servicio";
import { leerMotivo } from "@/lib/solicitudes/reglas";

export const POST = conUsuario<RouteContext<"/api/solicitudes/[id]/rechazar">>(async (req, u, ctx) => {
  const { id } = await ctx.params;
  const r = leerMotivo(await cuerpo(req));
  if (!r.ok) throw new ErrorApi(400, r.error);
  return ok({ solicitud: await rechazar(u, Number(id), r.motivo) });
}, { herramienta: "tasks" });
