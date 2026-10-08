import { conUsuario, cuerpo, ErrorApi, ok } from "@/lib/api";
import { crear, listar } from "@/lib/solicitudes/servicio";
import { esBandeja, leerNuevaSolicitud } from "@/lib/solicitudes/reglas";

/* GET ?bandeja=recibidas|enviadas|historial. Ver no exige la herramienta de tareas (como en Flask). */
export const GET = conUsuario(async (req, u) => {
  const b = new URL(req.url).searchParams.get("bandeja") ?? "recibidas";
  if (!esBandeja(b)) throw new ErrorApi(400, "Bandeja no válida.");
  return ok(await listar(u, b));
});

export const POST = conUsuario(async (req, u) => {
  const r = leerNuevaSolicitud(await cuerpo(req));
  if (!r.ok) throw new ErrorApi(400, r.error);
  return ok({ solicitud: await crear(u, r.datos) }, 201);
}, { herramienta: "tasks" });
