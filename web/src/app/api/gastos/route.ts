import { conUsuario, cuerpo, ok } from "@/lib/api";
import { enteroONulo } from "@/lib/admin/api";
import { crearGasto, datosDeGastos, leerAnioDeGastos } from "@/lib/gastos/servicio";

/* GET: lo que la persona ve de una unidad y un año (?unidad=&anio=). POST: registrar un gasto. */
export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  return ok(await datosDeGastos(u, enteroONulo(p.get("unidad")), leerAnioDeGastos(p.get("anio"))));
});

export const POST = conUsuario(async (req, u) => ok(await crearGasto(u, await cuerpo(req)), 201));
