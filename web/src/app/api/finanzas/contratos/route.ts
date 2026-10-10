import { conUsuario, cuerpo, ok } from "@/lib/api";
import { crearContrato, leerFiltroContratos, listarContratos } from "@/lib/finanzas/servicio";

/* Contratos de las unidades que la persona ve (con `anio`, solo los que tocan ese año y su aporte mes a mes). */
export const GET = conUsuario(async (req, u) => ok(await listarContratos(u, leerFiltroContratos(new URL(req.url).searchParams))));

export const POST = conUsuario(async (req, u) => ok(await crearContrato(u, await cuerpo(req)), 201));
