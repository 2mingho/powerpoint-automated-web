import { conUsuario, cuerpo, ok } from "@/lib/api";
import { hoyNegocio } from "@/lib/reloj";
import { fijarMeta, metasDelAnio } from "@/lib/finanzas/servicio";

/* Metas del año (por defecto el actual): la de la dirección, si se puede ver, y la de cada unidad visible. */
export const GET = conUsuario(async (req, u) => ok(await metasDelAnio(u, new URL(req.url).searchParams.get("anio") ?? Number(hoyNegocio().slice(0, 4)))));

export const PUT = conUsuario(async (req, u) => ok(await fijarMeta(u, await cuerpo(req))));
