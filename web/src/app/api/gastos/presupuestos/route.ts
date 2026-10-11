import { conUsuario, cuerpo, ok } from "@/lib/api";
import { fijarPresupuesto } from "@/lib/gastos/servicio";

/* PUT: fija el presupuesto anual de una categoria (monto 0 lo quita). */
export const PUT = conUsuario(async (req, u) => ok(await fijarPresupuesto(u, await cuerpo(req))));
