import { conUsuario, cuerpo, ok } from "@/lib/api";
import { crearEstudio, leerFiltroEstudios, listarEstudios } from "@/lib/estudios/servicio";

/* Estudios por fases: los de las unidades que la persona ve, con su avance y sus pasos. */
export const GET = conUsuario(async (req, u) => ok(await listarEstudios(u, leerFiltroEstudios(new URL(req.url).searchParams))), { herramienta: "tasks" });

export const POST = conUsuario(async (req, u) => ok(await crearEstudio(u, await cuerpo(req)), 201), { herramienta: "tasks" });
