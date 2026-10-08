import { conUsuario, cuerpo, ok } from "@/lib/api";
import { crearEtiqueta, etiquetasVisibles } from "@/lib/tareas/etiquetas";

export const GET = conUsuario(async (_req, u) => ok({ etiquetas: await etiquetasVisibles(u) }), { herramienta: "tasks" });
export const POST = conUsuario(async (req, u) => ok({ etiqueta: await crearEtiqueta(u, await cuerpo(req)) }, 201), { herramienta: "tasks" });
