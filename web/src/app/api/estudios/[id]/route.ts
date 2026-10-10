import { conUsuario, cuerpo, ok } from "@/lib/api";
import { idDeRuta } from "@/lib/admin/api";
import { borrarEstudio, editarEstudio, leerEstudio } from "@/lib/estudios/servicio";

export const GET = conUsuario<RouteContext<"/api/estudios/[id]">>(async (_req, u, ctx) => ok(await leerEstudio(u, await idDeRuta(ctx))), { herramienta: "tasks" });

export const PATCH = conUsuario<RouteContext<"/api/estudios/[id]">>(async (req, u, ctx) => ok(await editarEstudio(u, await idDeRuta(ctx), await cuerpo(req))), { herramienta: "tasks" });

export const DELETE = conUsuario<RouteContext<"/api/estudios/[id]">>(async (_req, u, ctx) => ok({ pasos: await borrarEstudio(u, await idDeRuta(ctx)) }), { herramienta: "tasks" });
