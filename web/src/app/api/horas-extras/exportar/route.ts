import { conUsuario, ErrorApi } from "@/lib/api";
import { enteroONulo } from "@/lib/admin/api";
import { hoyNegocio } from "@/lib/reloj";
import { libroDeHorasExtras } from "@/lib/horas-extras/excel";
import { datosParaLibro, leerPeriodoPedido } from "@/lib/horas-extras/servicio";

/* Excel de horas extras de una unidad: GENERALES del año y el reporte de la quincena (?unidad=&anio=&mes=&mitad=). */
export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  const unidad = enteroONulo(p.get("unidad"));
  if (!unidad) throw new ErrorApi(400, "Elige la unidad.");
  const d = await datosParaLibro(u, unidad, leerPeriodoPedido(p));
  const buf = await libroDeHorasExtras({ ...d, generadoPor: u.username, hoy: hoyNegocio() });
  const nombre = `Reporte HE - ${d.periodo.mitad === 15 ? "1ra" : "2da"}. Quincena - ${d.periodo.mes}-${d.periodo.anio}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="horas-extras-${d.periodo.anio}-${String(d.periodo.mes).padStart(2, "0")}-${d.periodo.mitad}.xlsx"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Cache-Control": "no-store",
    },
  });
});
