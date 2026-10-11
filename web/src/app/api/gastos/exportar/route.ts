import { conUsuario, ErrorApi } from "@/lib/api";
import { enteroONulo } from "@/lib/admin/api";
import { gastosDeUnidadCsv, leerAnioDeGastos } from "@/lib/gastos/servicio";

/* CSV de los gastos de una unidad y un año (?unidad=&anio=). */
export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  const unidad = enteroONulo(p.get("unidad"));
  if (!unidad) throw new ErrorApi(400, "Elige la unidad.");
  const anio = leerAnioDeGastos(p.get("anio"));
  const csv = await gastosDeUnidadCsv(u, unidad, anio);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gastos-${anio}.csv"`, "Cache-Control": "no-store" } });
});
