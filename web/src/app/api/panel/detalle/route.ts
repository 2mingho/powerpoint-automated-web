import { conUsuario, ok } from "@/lib/api";
import { hoyNegocio } from "@/lib/reloj";
import { leerPeriodo, rangoDePeriodo } from "@/lib/seguimiento/periodo";
import { detallePanel, leerFiltrosDetalle, leerOrdenDetalle, MAX_PAGINA_DETALLE, PAGINA_DETALLE } from "@/lib/panel/detalle";

/*
 * GET: una pagina de las tareas del detalle del Panel, con el periodo y los filtros cruzados aplicados en la
 * base. ?periodo=&desde=&hasta= (como en la pagina), ?unidad=&cliente=&persona=&tipo=&contrato=&semana=&estado=,
 * ?orden=entrega|tarea|persona|unidad|estado|horas&dir=asc|desc, ?offset= y ?limite= (hasta 100).
 */
export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  const rango = rangoDePeriodo(leerPeriodo(p.get("periodo")), hoyNegocio(), { desde: p.get("desde"), hasta: p.get("hasta") });
  const entero = (k: string, defecto: number) => { const n = Number(p.get(k)); return Number.isInteger(n) && n >= 0 ? n : defecto; };
  const limite = Math.min(MAX_PAGINA_DETALLE, Math.max(1, entero("limite", PAGINA_DETALLE)));
  return ok(await detallePanel(u, rango, leerFiltrosDetalle(p), leerOrdenDetalle(p), entero("offset", 0), limite));
}, { herramienta: "tasks" });
