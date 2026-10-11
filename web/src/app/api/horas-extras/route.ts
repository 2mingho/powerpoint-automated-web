import { conUsuario, cuerpo, ok } from "@/lib/api";
import { enteroONulo } from "@/lib/admin/api";
import { crearRegistro, datosDeHorasExtras, leerPeriodoPedido } from "@/lib/horas-extras/servicio";

/* GET: el reporte de una quincena y la matriz de su trimestre (?unidad=&anio=&mes=&mitad=). POST: registrar horas extras. */
export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  return ok(await datosDeHorasExtras(u, enteroONulo(p.get("unidad")), leerPeriodoPedido(p)));
});

export const POST = conUsuario(async (req, u) => ok(await crearRegistro(u, await cuerpo(req)), 201));
