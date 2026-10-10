import { conUsuario, cuerpo, ok } from "@/lib/api";
import { crearPlantilla, listarPlantillas } from "@/lib/tareas/plantillas";

export const GET = conUsuario(async (_req, u) => ok({ plantillas: await listarPlantillas(u) }), { herramienta: "tasks" });
export const POST = conUsuario(async (req, u) => ok({ plantilla: await crearPlantilla(u, await cuerpo(req)) }, 201), { herramienta: "tasks" });
