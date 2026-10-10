import { conUsuario, cuerpo, ok } from "@/lib/api";
import { contarSalidas, leerFiltros, limiteDeVentana, listarTareas, listarVentana } from "@/lib/tareas/consultas";
import { crearTarea } from "@/lib/tareas/mutaciones";

/*
 * GET lista del panel (o del calendario con ?desde=&hasta=). Con ?limite=N
 * (1-50, la busqueda de la paleta) solo las N primeras y sin contadores.
 * Con ?antes=N y/o ?despues=N (0-500): ventana alrededor de hoy, las N mas cercanas por cada lado (el panel).
 * POST alta.
 */
export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  const f = leerFiltros(p);
  const limite = Number(p.get("limite"));
  if (Number.isInteger(limite) && limite >= 1 && limite <= 50) return ok(await listarTareas(u, f, undefined, limite));
  const desde = p.get("desde") ?? "";
  const hasta = p.get("hasta") ?? "";
  if (!(desde || hasta) && (p.has("antes") || p.has("despues"))) {
    const [lista, contadores] = await Promise.all([
      listarVentana(u, f, limiteDeVentana(p.get("antes")), limiteDeVentana(p.get("despues"))),
      contarSalidas(u, f.alcance),
    ]);
    return ok({ ...lista, contadores });
  }
  const [lista, contadores] = await Promise.all([
    listarTareas(u, f, desde || hasta ? { desde, hasta } : undefined),
    contarSalidas(u, f.alcance),
  ]);
  return ok({ ...lista, contadores });
}, { herramienta: "tasks" });

export const POST = conUsuario(async (req, u) => ok(await crearTarea(u, await cuerpo(req)), 201), { herramienta: "tasks" });
